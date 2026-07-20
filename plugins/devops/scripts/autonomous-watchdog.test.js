import { describe, test, expect } from "vitest";
import path from "node:path";
import {
  buildRegisterPsCommand,
  buildRecoveryScript,
  pickSentinel,
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
