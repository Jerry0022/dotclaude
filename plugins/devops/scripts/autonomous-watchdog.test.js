import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildRegisterPsCommand,
  buildRecoveryScript,
  pickSentinel,
  removeRegistrationsFor,
  runOpenIn,
  staleWatchdogTaskNames,
  sweepStaleWatchdogs,
  STALE_AFTER_MS,
} from "./autonomous-watchdog.js";

// A fire time with day-of-month > 12 so an accidental MM/DD vs DD/MM swap is
// detectable, built via the local-time constructor so the assertions are
// independent of the CI machine's timezone (getters read back the same
// components that were passed in).
const FIRE_AT = new Date(2026, 5, 13, 20, 5, 0); // 2026-06-13 20:05 local
const REG_OPTS = {
  taskName: "ClaudeAutonomousWatchdog-1700000000000",
  scriptPath: "C:\\Users\\dev\\AppData\\Local\\Temp\\claude-autonomous-watchdog-1700000000000.ps1",
  fireAt: FIRE_AT,
};

describe("buildRegisterPsCommand — culture-agnostic scheduling (de-DE regression)", () => {
  const cmd = buildRegisterPsCommand(REG_OPTS);

  test("passes the fire time as integer Get-Date components, not a date string", () => {
    expect(cmd).toContain("-Year 2026");
    expect(cmd).toContain("-Month 6");   // 0-based getMonth() + 1, no zero-pad
    expect(cmd).toContain("-Day 13");
    expect(cmd).toContain("-Hour 20");
    expect(cmd).toContain("-Minute 5");
    expect(cmd).toContain("New-ScheduledTaskTrigger -Once -At $at");
  });

  test("emits NO locale-dependent date string — the schtasks /SD trap", () => {
    // The old bug hard-coded en-US MM/DD/YYYY into schtasks /SD, which a de-DE
    // schtasks rejects with "FEHLER: Ungültiges Startdatum".
    expect(cmd).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/); // any slash-separated date
    expect(cmd).not.toContain("06/13/2026"); // the exact prior-bug string
    expect(cmd).not.toContain("/SD");
    expect(cmd).not.toContain("/ST");
    expect(cmd).not.toContain("schtasks");
  });

  test("registers via the culture-agnostic ScheduledTasks cmdlets", () => {
    expect(cmd).toContain("Register-ScheduledTask");
    expect(cmd).toContain("New-ScheduledTaskAction -Execute 'powershell.exe'");
    expect(cmd).toContain(`-TaskName '${REG_OPTS.taskName}'`);
    // The recovery .ps1 is wired in as the task action.
    expect(cmd).toContain(`-File "${REG_OPTS.scriptPath}"`);
  });

  test("fires even on battery (deadman must survive a laptop running AFK)", () => {
    expect(cmd).toContain("-AllowStartIfOnBatteries");
    expect(cmd).toContain("-DontStopIfGoingOnBatteries");
  });

  test("propagates a registration failure as a non-zero exit", () => {
    // Without Stop + exit 1, a failed Register-ScheduledTask would still exit 0
    // and the caller would falsely report the deadman as armed.
    expect(cmd).toContain("$ErrorActionPreference = 'Stop'");
    expect(cmd).toContain("exit 1");
  });

  test("single-quotes in task name / script path are PowerShell-escaped", () => {
    const tricky = buildRegisterPsCommand({
      ...REG_OPTS,
      taskName: "ClaudeAutonomousWatchdog-1",
      scriptPath: "C:\\Temp\\o'brien\\claude-autonomous-watchdog-1.ps1",
    });
    expect(tricky).toContain("o''brien"); // ' doubled, not left raw
    expect(tricky).not.toContain("o'brien");
  });

  test("uses local wall-clock getters (matches prior /ST semantics)", () => {
    // A fire time in a month/day that differs between UTC and most local zones
    // still serializes from the local getters, not UTC.
    const local = new Date(2026, 0, 1, 1, 30, 0); // Jan 1 2026 01:30 local
    const c = buildRegisterPsCommand({ ...REG_OPTS, fireAt: local });
    expect(c).toContain("-Year 2026");
    expect(c).toContain("-Month 1");
    expect(c).toContain("-Day 1");
    expect(c).toContain("-Hour 1");
    expect(c).toContain("-Minute 30");
  });
});

describe("buildRecoveryScript — mode-specific recovery", () => {
  const base = {
    hours: 8,
    flagPath: "C:\\proj\\AUTONOMOUS-DONE.flag",
    stalledPath: "C:\\proj\\AUTONOMOUS-STALLED.txt",
  };

  test("shutdown mode forces a power-off when the flag is missing", () => {
    const s = buildRecoveryScript({ ...base, action: "shutdown" });
    expect(s).toContain("shutdown.exe");
    expect(s).toContain("/s /t 0");
    expect(s).not.toContain("AUTONOMOUS-STALLED");
  });

  test("notify mode writes a visible stalled marker and never powers off", () => {
    const s = buildRecoveryScript({ ...base, action: "notify" });
    expect(s).toContain("Set-Content -Path 'C:\\proj\\AUTONOMOUS-STALLED.txt'");
    expect(s).not.toContain("shutdown.exe");
  });

  test("escapes single-quotes in the flag path", () => {
    const s = buildRecoveryScript({
      ...base,
      action: "shutdown",
      flagPath: "C:\\users\\o'brien\\AUTONOMOUS-DONE.flag",
    });
    expect(s).toContain("o''brien");
  });

  const resumeOpts = {
    ...base,
    action: "resume",
    recoveryFlagPath: "C:\\proj\\AUTONOMOUS-RECOVERY.flag",
    workingDir: "C:\\proj",
    resumePrompt: "RUN_BACKLOG_AUTOSTART: resume",
  };

  test("resume mode notifies AND arms a guarded one-shot claude relaunch", () => {
    const s = buildRecoveryScript(resumeOpts);
    // Still surfaces the visible stalled marker (a hang is never invisible).
    expect(s).toContain("Set-Content -Path 'C:\\proj\\AUTONOMOUS-STALLED.txt'");
    // Never powers the machine off.
    expect(s).not.toContain("shutdown.exe");
    // Relaunch is gated by a one-per-run recovery flag — no fork-bomb on
    // repeated fires of the same task.
    expect(s).toContain("$recoveryFlag = 'C:\\proj\\AUTONOMOUS-RECOVERY.flag'");
    expect(s).toContain("if (Test-Path $recoveryFlag)");
    // Relaunches claude with the resume prompt in the project working dir.
    expect(s).toContain("Get-Command claude");
    expect(s).toContain("Start-Process -FilePath $claude.Source");
    expect(s).toContain("'-p','RUN_BACKLOG_AUTOSTART: resume'");
    expect(s).toContain("-WorkingDirectory 'C:\\proj'");
  });

  test("resume mode degrades to notify-only when claude is not on PATH", () => {
    const s = buildRecoveryScript(resumeOpts);
    expect(s).toContain("claude not found on PATH — notify-only");
  });

  test("escapes single-quotes in the resume prompt", () => {
    const s = buildRecoveryScript({ ...resumeOpts, resumePrompt: "it's a resume" });
    expect(s).toContain("it''s a resume");
    expect(s).not.toContain("'-p','it's a resume'");
  });
});

describe("pickSentinel — parallel-session resolution (2026-07-05 incident)", () => {
  // Platform-neutral fake project roots.
  const ROOT = path.resolve("/", "proj");
  const mk = (name, dir) => ({
    file: path.join("/tmp", `claude-autonomous-watchdog-${name}.json`),
    data: {
      taskName: `ClaudeAutonomousWatchdog-${name}`,
      flagPath: path.join(dir, "AUTONOMOUS-DONE.flag"),
    },
  });
  const tijedeaWt = path.join(ROOT, "TIjedea", ".claude", "worktrees", "peaceful-visvesvaraya");
  const hllOverlay = path.join(ROOT, "hll-overlay");
  const A = mk("1", tijedeaWt);   // session A (TIjedea worktree)
  const B = mk("2", hllOverlay);  // session B (hll-overlay)

  test("no sentinels → no match, no candidates", () => {
    expect(pickSentinel([], tijedeaWt)).toEqual({ match: null, candidates: [] });
  });

  test("single sentinel → picked regardless of cwd (cwd-drift safe path)", () => {
    const r = pickSentinel([A], path.join(ROOT, "somewhere-else"));
    expect(r.match).toBe(A);
  });

  test("INCIDENT: two parallel sessions — each cwd resolves ONLY its own sentinel", () => {
    // Session A flags from its worktree root → must get A, never B.
    expect(pickSentinel([A, B], tijedeaWt).match).toBe(A);
    expect(pickSentinel([B, A], tijedeaWt).match).toBe(A); // order-independent
    // Session B flags from its project root → must get B.
    expect(pickSentinel([A, B], hllOverlay).match).toBe(B);
  });

  test("cwd in a SUBDIRECTORY of the project still resolves that project", () => {
    const r = pickSentinel([A, B], path.join(hllOverlay, "src", "deep"));
    expect(r.match).toBe(B);
  });

  test("nested roots: deepest matching flag directory wins", () => {
    const outer = mk("3", path.join(ROOT, "TIjedea"));
    const r = pickSentinel([outer, A, B], tijedeaWt);
    expect(r.match).toBe(A); // worktree sentinel, not the main-repo one
  });

  test("multiple sentinels + unrelated cwd → hard no-match (never guesses)", () => {
    const r = pickSentinel([A, B], path.join(ROOT, "unrelated"));
    expect(r.match).toBeNull();
    expect(r.candidates).toHaveLength(2);
  });

  test("prefix trap: sibling dir sharing a name prefix does NOT match", () => {
    // cwd /proj/hll-overlay-2 must not match flag dir /proj/hll-overlay
    const r = pickSentinel([A, B], path.join(ROOT, "hll-overlay-2"));
    expect(r.match).toBeNull();
  });

  test("tie with IDENTICAL flagPath → harmless duplicate, first wins", () => {
    const dup = { ...A, file: A.file.replace("-1.json", "-dup.json") };
    const r = pickSentinel([A, dup], tijedeaWt);
    expect(r.match).toBe(A);
  });

  test("tie with DIFFERENT flagPaths in same dir → ambiguous, no match", () => {
    const other = mk("4", tijedeaWt);
    other.data.flagPath = path.join(tijedeaWt, "OTHER.flag");
    const r = pickSentinel([A, other], tijedeaWt);
    expect(r.match).toBeNull();
  });

  test("sentinels without flagPath are ignored as candidates for matching", () => {
    const broken = { file: "/tmp/claude-autonomous-watchdog-x.json", data: { taskName: "ClaudeAutonomousWatchdog-9" } };
    const r = pickSentinel([broken, B], hllOverlay);
    expect(r.match).toBe(B);
  });
});

describe("watchdog tasks remove themselves (#544)", () => {
  const cmd = buildRegisterPsCommand(REG_OPTS);

  test("the trigger ends after its window and Task Scheduler deletes the expired task", () => {
    expect(cmd).toContain("$trigger.EndBoundary = $at.AddMinutes(30).ToString('s')");
    expect(cmd).toContain("-DeleteExpiredTaskAfter (New-TimeSpan -Seconds 0)");
  });

  test("a refused expiry setting still arms the deadman with the plain one-shot task", () => {
    expect(cmd.match(/Register-ScheduledTask /g)).toHaveLength(2);
    const fallback = cmd.slice(cmd.indexOf("  } catch {"));
    expect(fallback).toContain("New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries\n");
    expect(fallback).not.toContain("DeleteExpiredTaskAfter");
    expect(fallback).toContain("Register-ScheduledTask ");
  });
});

describe("staleWatchdogTaskNames — which leftovers a register sweeps", () => {
  const NOW = 1_790_425_000_000;
  const old = NOW - STALE_AFTER_MS - 1;
  const fresh = NOW - STALE_AFTER_MS + 60_000;
  const csv = [
    `"\\ClaudeAutonomousWatchdog-${old}","Nicht zutreffend","Bereit"`,
    `"\\ClaudeAutonomousWatchdog-${fresh}","26.09.2026 22:18:00","Bereit"`,
    `"\\Microsoft\\ClaudeAutonomousWatchdog-${old - 5}","N/A","Ready"`,
    `"\\OtherVendorTask-${old}","N/A","Ready"`,
    `"\\ClaudeAutonomousWatchdog-${old}","Nicht zutreffend","Bereit"`,
  ].join("\r\n");

  test("only root-level watchdog tasks past the stale age, once each", () => {
    expect(staleWatchdogTaskNames(csv, NOW)).toEqual([`ClaudeAutonomousWatchdog-${old}`]);
  });

  test("a registration inside the age window is never swept (its fire time may lie ahead)", () => {
    expect(staleWatchdogTaskNames(csv, NOW)).not.toContain(`ClaudeAutonomousWatchdog-${fresh}`);
    expect(STALE_AFTER_MS).toBeGreaterThan(24 * 3600_000);
  });

  test("empty or garbage listings yield nothing", () => {
    expect(staleWatchdogTaskNames("", NOW)).toEqual([]);
    expect(staleWatchdogTaskNames(undefined, NOW)).toEqual([]);
    expect(staleWatchdogTaskNames("FEHLER: Zugriff verweigert", NOW)).toEqual([]);
  });
});

describe("sweepStaleWatchdogs — best-effort cleanup at register", () => {
  const NOW = 1_790_425_000_000;
  const oldTs = NOW - STALE_AFTER_MS - 1;
  const freshTs = NOW - 3600_000;
  let tmp = null;
  afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; });

  function fakeSpawn(listing, deleteStatus = 0) {
    const calls = [];
    const spawn = (exe, args) => {
      calls.push([exe, ...args]);
      if (args[0] === "/Query") return { status: 0, stdout: listing, stderr: "" };
      return { status: deleteStatus, stdout: "", stderr: deleteStatus ? "FEHLER: nicht gefunden" : "" };
    };
    return { spawn, calls };
  }

  test("deletes stale tasks and stale helper scripts, keeps live ones and foreign files", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wd-sweep-"));
    const keep = [
      `claude-autonomous-watchdog-${freshTs}.ps1`,
      `claude-autonomous-watchdog-ClaudeAutonomousWatchdog-${oldTs}.json`,
      "claude-autonomous-watchdog.log",
    ];
    const drop = `claude-autonomous-watchdog-${oldTs}.ps1`;
    for (const f of [...keep, drop]) fs.writeFileSync(path.join(tmp, f), "x");
    const { spawn, calls } = fakeSpawn(
      `"\\ClaudeAutonomousWatchdog-${oldTs}","N/A","Ready"\r\n"\\ClaudeAutonomousWatchdog-${freshTs}","N/A","Ready"`);

    const swept = sweepStaleWatchdogs({ now: NOW, spawn, tmp });

    expect(swept).toEqual({ tasks: [`ClaudeAutonomousWatchdog-${oldTs}`], scripts: 1 });
    expect(calls).toContainEqual(["schtasks.exe", "/Delete", "/TN", `ClaudeAutonomousWatchdog-${oldTs}`, "/F"]);
    expect(calls.some((c) => c.includes("/Delete") && c.includes(`ClaudeAutonomousWatchdog-${freshTs}`))).toBe(false);
    expect(fs.readdirSync(tmp).sort()).toEqual([...keep].sort());
  });

  test("a task already gone counts as removed", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wd-sweep-"));
    const { spawn } = fakeSpawn(`"\\ClaudeAutonomousWatchdog-${oldTs}","N/A","Ready"`, 1);
    expect(sweepStaleWatchdogs({ now: NOW, spawn, tmp }).tasks).toEqual([`ClaudeAutonomousWatchdog-${oldTs}`]);
  });

  test("never throws — a failing schtasks leaves the leftovers for the next sweep", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wd-sweep-"));
    const spawn = () => { throw new Error("spawn EPERM"); };
    expect(sweepStaleWatchdogs({ now: NOW, spawn, tmp })).toEqual({ tasks: [], scripts: 0 });
  });

  test("deletes at most 25 tasks per call", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wd-sweep-"));
    const rows = Array.from({ length: 40 }, (_, i) => `"\\ClaudeAutonomousWatchdog-${oldTs - i}","N/A","Ready"`).join("\r\n");
    const { spawn, calls } = fakeSpawn(rows);
    expect(sweepStaleWatchdogs({ now: NOW, spawn, tmp }).tasks).toHaveLength(25);
    expect(calls.filter((c) => c[1] === "/Delete")).toHaveLength(25);
  });
});

describe("runOpenIn — an autonomous run still before its Step 8c", () => {
  const NOW = 1_790_425_000_000;
  let tmp = null;
  let proj = null;
  afterEach(() => {
    for (const d of [tmp, proj]) if (d) fs.rmSync(d, { recursive: true, force: true });
    tmp = proj = null;
  });

  function setup(fireAt, name = "claude-autonomous-watchdog-ClaudeAutonomousWatchdog-1.json") {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wd-open-"));
    proj = fs.mkdtempSync(path.join(os.tmpdir(), "wd-proj-"));
    const flagPath = path.join(proj, "AUTONOMOUS-DONE.flag");
    fs.writeFileSync(path.join(tmp, name), JSON.stringify({ taskName: "ClaudeAutonomousWatchdog-1", flagPath, fireAt: new Date(fireAt).toISOString() }));
    return flagPath;
  }

  test("armed watchdog, flag missing → open; the written flag closes it", () => {
    const flagPath = setup(NOW + 3600_000);
    expect(runOpenIn([proj], { now: NOW, tmp })).toBe(true);
    fs.writeFileSync(flagPath, "{}");
    expect(runOpenIn([proj], { now: NOW, tmp })).toBe(false);
  });

  test("a watchdog that already fired no longer holds anything", () => {
    setup(NOW - 1);
    expect(runOpenIn([proj], { now: NOW, tmp })).toBe(false);
  });

  test("another directory's run is not this one's", () => {
    setup(NOW + 3600_000);
    expect(runOpenIn([path.join(proj, "sub")], { now: NOW, tmp })).toBe(false);
    expect(runOpenIn([], { now: NOW, tmp })).toBe(false);
  });

  test("the legacy single sentinel counts too", () => {
    setup(NOW + 3600_000, "claude-autonomous-watchdog.json");
    expect(runOpenIn([proj + path.sep], { now: NOW, tmp })).toBe(true);
  });
});

describe("removeRegistrationsFor — a written flag removes its own task", () => {
  const created = [];
  afterEach(() => { for (const f of created.splice(0)) fs.rmSync(f, { force: true }); });

  function sentinel(taskName, flagPath) {
    const ts = `${Date.now()}${created.length}`;
    const scriptPath = path.join(os.tmpdir(), `claude-autonomous-watchdog-${ts}9.ps1`);
    const file = path.join(os.tmpdir(), `wd-test-sentinel-${ts}.json`);
    fs.writeFileSync(scriptPath, "x");
    fs.writeFileSync(file, "{}");
    created.push(scriptPath, file);
    return { file, data: { taskName, flagPath, scriptPath } };
  }

  test("deletes task, script and sentinel of the same flag path only", () => {
    const mine = sentinel("ClaudeAutonomousWatchdog-111", "C:\\proj\\AUTONOMOUS-DONE.flag");
    const other = sentinel("ClaudeAutonomousWatchdog-222", "C:\\other\\AUTONOMOUS-DONE.flag");
    const calls = [];
    const spawn = (exe, args) => { calls.push(args); return { status: 0, stdout: "", stderr: "" }; };

    const removed = removeRegistrationsFor("c:\\PROJ\\autonomous-done.flag", { spawn, sentinels: [mine, other] });

    expect(removed).toEqual(["ClaudeAutonomousWatchdog-111"]);
    expect(calls).toEqual([["/Delete", "/TN", "ClaudeAutonomousWatchdog-111", "/F"]]);
    expect(fs.existsSync(mine.file)).toBe(false);
    expect(fs.existsSync(mine.data.scriptPath)).toBe(false);
    expect(fs.existsSync(other.file)).toBe(true);
    expect(fs.existsSync(other.data.scriptPath)).toBe(true);
  });

  test("a tampered task name is never handed to schtasks", () => {
    const bad = sentinel("\\Microsoft\\Windows\\Defrag", "C:\\proj\\AUTONOMOUS-DONE.flag");
    const calls = [];
    const spawn = (exe, args) => { calls.push(args); return { status: 0 }; };
    expect(removeRegistrationsFor("C:\\proj\\AUTONOMOUS-DONE.flag", { spawn, sentinels: [bad] })).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("a failed delete is not reported as removed", () => {
    const mine = sentinel("ClaudeAutonomousWatchdog-333", "C:\\proj\\AUTONOMOUS-DONE.flag");
    const spawn = () => ({ status: 1, stdout: "", stderr: "FEHLER: Zugriff verweigert" });
    expect(removeRegistrationsFor("C:\\proj\\AUTONOMOUS-DONE.flag", { spawn, sentinels: [mine] })).toEqual([]);
  });
});
