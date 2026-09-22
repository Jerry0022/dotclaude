import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readState,
  hasConsent,
  isDeclined,
  isUndecided,
  markRefresh,
  refreshFlagPath,
  markQueryDone,
  queryDone,
  consentPath,
  isGraphifyQueryCommand,
  sentinelPath,
  bgWindowless,
  bgWithSentinel,
  readSentinel,
  clearSentinel,
  isEnabled,
  isDeclinedAnywhere,
  globalConsentPath,
  readGlobalState,
  runBgEntrypointChild,
  updateInFlight,
  updateLockPath,
  writeUpdateLock,
  clearUpdateLock,
  globalUpdatesInFlight,
  updateGlobalCap,
  releaseRefresh,
  declineCount,
  declineCountPath,
  noteDecline,
  clearDeclines,
  isProjectDir,
  findRepoRoot,
  mainCheckoutRoot,
  graphifyBin,
  refreshUpdateLockFile,
  clearUpdateLockFile,
  lockBaseDir,
  GATE_STATE_TTL_MS,
  bypassCount,
  bypassCountPath,
  noteBypass,
  clearBypassStreak,
  relentFlagPath,
  markRelented,
  isRelented,
  lastBlockedPath,
  getLastBlocked,
  setLastBlocked,
  markLastBlockedBypassed,
  gateQuerySlotPath,
  acquireGateQuerySlot,
} from "./graphify-state.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const GSTATE_JS = fileURLToPath(new URL("./graphify-state.js", import.meta.url));

// A disposable PROJECT dir: bgWithSentinel refuses to build anywhere that is not
// inside a git work tree (a session started in $HOME once crawled the whole home
// directory for hours), so every fixture that expects a spawn carries a `.git`
// marker. The marker is inert for the consent/flag tests that share this helper.
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-"));
  fs.mkdirSync(path.join(dir, ".git"));
  return dir;
}

/** A disposable NON-project dir (no `.git` anywhere up to the temp root). */
function tmpBare() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gstate-bare-"));
}

describe("consent record", () => {
  let dir;
  beforeEach(() => {
    dir = tmp();
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("no record → null, not consented, not declined", () => {
    expect(readState(dir)).toBeNull();
    expect(hasConsent(dir)).toBe(false);
    expect(isDeclined(dir)).toBe(false);
  });

  test("consent:true → hasConsent, not declined", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ consent: true, autoBuild: true }));
    expect(hasConsent(dir)).toBe(true);
    expect(isDeclined(dir)).toBe(false);
  });

  test("consent:false → declined, not consented", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ consent: false }));
    expect(hasConsent(dir)).toBe(false);
    expect(isDeclined(dir)).toBe(true);
  });

  test("malformed json → null (fail safe, no throw)", () => {
    fs.writeFileSync(consentPath(dir), "{ not json");
    expect(readState(dir)).toBeNull();
    expect(hasConsent(dir)).toBe(false);
    expect(isDeclined(dir)).toBe(false);
  });
});

describe("isUndecided — offer eligibility", () => {
  let dir;
  beforeEach(() => {
    dir = tmp();
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("no record → undecided", () => {
    expect(isUndecided(dir)).toBe(true);
  });
  test("consent:true → decided (not undecided)", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ consent: true }));
    expect(isUndecided(dir)).toBe(false);
  });
  test("consent:false → decided (not undecided)", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ consent: false }));
    expect(isUndecided(dir)).toBe(false);
  });
});

describe("isEnabled / isDeclinedAnywhere — default-on opt-out gate", () => {
  let dir; // project dir
  let homeDir; // faked global home (~/.claude/graphify.json)
  let origHome;
  let origUserProfile;

  beforeEach(() => {
    dir = tmp();
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-home-"));
    fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
    // os.homedir() honors HOME (POSIX) / USERPROFILE (win32) — override both so
    // globalConsentPath() resolves under our disposable temp dir on either OS.
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch {}
  });

  test("globalConsentPath resolves under the (faked) home dir", () => {
    expect(globalConsentPath()).toBe(path.join(homeDir, ".claude", "graphify.json"));
  });

  test("no project record, no global record → enabled by default (opt-out model)", () => {
    expect(readGlobalState()).toBeNull();
    expect(isEnabled(dir)).toBe(true);
    expect(isDeclinedAnywhere(dir)).toBe(false);
  });

  test("record present but no consent key → still enabled (no explicit opt-out)", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ autoBuild: true }));
    expect(isEnabled(dir)).toBe(true);
  });

  test("project consent:false → disabled", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ consent: false }));
    expect(isEnabled(dir)).toBe(false);
    expect(isDeclinedAnywhere(dir)).toBe(true);
  });

  test("global consent:false (no project record) → disabled machine-wide", () => {
    fs.writeFileSync(globalConsentPath(), JSON.stringify({ consent: false }));
    expect(readGlobalState()).toEqual({ consent: false });
    expect(isEnabled(dir)).toBe(false);
    expect(isDeclinedAnywhere(dir)).toBe(true);
  });

  test("project consent:true + global consent:false → still disabled (either opt-out wins)", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ consent: true }));
    fs.writeFileSync(globalConsentPath(), JSON.stringify({ consent: false }));
    expect(isEnabled(dir)).toBe(false);
  });

  test("project consent:true, no global opt-out → enabled", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ consent: true }));
    expect(isEnabled(dir)).toBe(true);
  });

  test("R5: present-but-unparseable PROJECT record → treated as declined (fails CLOSED, not open)", () => {
    fs.writeFileSync(consentPath(dir), "{ not json");
    // readState/readGlobalState stay null on corruption (low-level, unchanged) —
    // it is isEnabled's job to distinguish absent from corrupt-but-present.
    expect(readState(dir)).toBeNull();
    expect(isEnabled(dir)).toBe(false);
    expect(isDeclinedAnywhere(dir)).toBe(true);
  });

  test("R5: present-but-unparseable GLOBAL record → treated as declined (fails CLOSED, not open)", () => {
    fs.writeFileSync(globalConsentPath(), "{ not json");
    expect(readGlobalState()).toBeNull();
    expect(isEnabled(dir)).toBe(false);
    expect(isDeclinedAnywhere(dir)).toBe(true);
  });

  test("R5: truly-absent project AND global records → still enabled (default-on unaffected)", () => {
    expect(fs.existsSync(consentPath(dir))).toBe(false);
    expect(fs.existsSync(globalConsentPath())).toBe(false);
    expect(isEnabled(dir)).toBe(true);
    expect(isDeclinedAnywhere(dir)).toBe(false);
  });
});

describe("markRefresh — stale-graph refresh throttle", () => {
  test("first call true then throttled; independent per project", () => {
    const d = tmp();
    expect(markRefresh(d, 60_000)).toBe(true);   // first → allowed, stamps flag
    expect(markRefresh(d, 60_000)).toBe(false);  // within cooldown → throttled
    expect(fs.existsSync(refreshFlagPath(d))).toBe(true);
    const d2 = tmp();
    expect(markRefresh(d2, 60_000)).toBe(true);  // different project → independent
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(d2, { recursive: true, force: true }); } catch {}
  });

  test("allowed again once the cooldown has elapsed", () => {
    const d = tmp();
    expect(markRefresh(d, 60_000)).toBe(true);
    expect(markRefresh(d, 60_000)).toBe(false); // throttled
    // Backdate the flag past the cooldown → next call allowed again.
    const past = new Date(Date.now() - 120_000);
    fs.utimesSync(refreshFlagPath(d), past, past);
    expect(markRefresh(d, 60_000)).toBe(true);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  });
});

describe("per-session query flag", () => {
  test("markQueryDone makes queryDone true; isolated per session + project", () => {
    const dir = tmp();
    expect(queryDone("s1", dir)).toBe(false);
    markQueryDone("s1", dir);
    expect(queryDone("s1", dir)).toBe(true);
    expect(queryDone("s2", dir)).toBe(false); // different session
    expect(queryDone("s1", tmp())).toBe(false); // different project
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
});

describe("adaptive gate relent — bypass streak + relent flag (Requirement B3)", () => {
  test("bypassCount starts at 0 and increments with noteBypass", () => {
    const dir = tmp();
    expect(bypassCount("s1", dir)).toBe(0);
    expect(noteBypass("s1", dir)).toBe(1);
    expect(noteBypass("s1", dir)).toBe(2);
    expect(bypassCount("s1", dir)).toBe(2);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("clearBypassStreak resets the count to 0", () => {
    const dir = tmp();
    noteBypass("s1", dir);
    noteBypass("s1", dir);
    clearBypassStreak("s1", dir);
    expect(bypassCount("s1", dir)).toBe(0);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("isolated per (session, project)", () => {
    const dir = tmp();
    noteBypass("s1", dir);
    expect(bypassCount("s2", dir)).toBe(0);         // different session
    expect(bypassCount("s1", tmp())).toBe(0);        // different project
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("isRelented is false until markRelented; then true for that (session, cwd) only", () => {
    const dir = tmp();
    expect(isRelented("s1", dir)).toBe(false);
    markRelented("s1", dir);
    expect(isRelented("s1", dir)).toBe(true);
    expect(isRelented("s2", dir)).toBe(false);
    expect(isRelented("s1", tmp())).toBe(false);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("bypassCountPath / relentFlagPath are stable and session+cwd scoped", () => {
    const dir = tmp();
    expect(bypassCountPath("s1", dir)).toBe(bypassCountPath("s1", dir));
    expect(bypassCountPath("s1", dir)).not.toBe(bypassCountPath("s2", dir));
    expect(relentFlagPath("s1", dir)).not.toBe(relentFlagPath("s1", tmp()));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  describe("TTL (~12h, Requirement 5) — stale state reads as absent, never as approval", () => {
    test("bypassCount reads 0 once the streak is older than GATE_STATE_TTL_MS", () => {
      const dir = tmp();
      noteBypass("s1", dir);
      const stale = JSON.parse(fs.readFileSync(bypassCountPath("s1", dir), "utf8"));
      fs.writeFileSync(bypassCountPath("s1", dir), JSON.stringify({ ...stale, ts: Date.now() - GATE_STATE_TTL_MS - 1000 }));
      expect(bypassCount("s1", dir)).toBe(0);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    });

    test("isRelented reads false once the relent flag is older than GATE_STATE_TTL_MS", () => {
      const dir = tmp();
      markRelented("s1", dir);
      fs.writeFileSync(relentFlagPath("s1", dir), String(Date.now() - GATE_STATE_TTL_MS - 1000));
      expect(isRelented("s1", dir)).toBe(false);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    });

    test("getLastBlocked reads null once the record is older than GATE_STATE_TTL_MS", () => {
      const dir = tmp();
      setLastBlocked("s1", dir, "Grep:x:{}");
      const cur = getLastBlocked("s1", dir);
      expect(cur.key).toBe("Grep:x:{}");
      fs.writeFileSync(lastBlockedPath("s1", dir), JSON.stringify({ ...cur, ts: Date.now() - GATE_STATE_TTL_MS - 1000 }));
      expect(getLastBlocked("s1", dir)).toBe(null);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    });
  });
});

describe("last-blocked record — setLastBlocked / getLastBlocked / markLastBlockedBypassed", () => {
  test("null when nothing has been blocked yet", () => {
    const dir = tmp();
    expect(getLastBlocked("s1", dir)).toBe(null);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("setLastBlocked records a fresh, un-bypassed entry", () => {
    const dir = tmp();
    setLastBlocked("s1", dir, "Grep:x:{}");
    expect(getLastBlocked("s1", dir)).toMatchObject({ key: "Grep:x:{}", bypassed: false });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("markLastBlockedBypassed flips bypassed without changing the key", () => {
    const dir = tmp();
    setLastBlocked("s1", dir, "Grep:x:{}");
    markLastBlockedBypassed("s1", dir);
    expect(getLastBlocked("s1", dir)).toMatchObject({ key: "Grep:x:{}", bypassed: true });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("markLastBlockedBypassed is a no-op when there is nothing to mark", () => {
    const dir = tmp();
    expect(() => markLastBlockedBypassed("s1", dir)).not.toThrow();
    expect(getLastBlocked("s1", dir)).toBe(null);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("a NEW setLastBlocked replaces the previous entry entirely", () => {
    const dir = tmp();
    setLastBlocked("s1", dir, "Grep:x:{}");
    markLastBlockedBypassed("s1", dir);
    setLastBlocked("s1", dir, "Grep:y:{}");
    expect(getLastBlocked("s1", dir)).toMatchObject({ key: "Grep:y:{}", bypassed: false });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("isolated per (session, project)", () => {
    const dir = tmp();
    setLastBlocked("s1", dir, "Grep:x:{}");
    expect(getLastBlocked("s2", dir)).toBe(null);
    expect(getLastBlocked("s1", tmp())).toBe(null);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
});

describe("acquireGateQuerySlot — machine-wide gate-query concurrency cap (Requirement 2)", () => {
  let origLockDir, isoLockDir, origMax, origStale;
  beforeEach(() => {
    origLockDir = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    isoLockDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatequeue-lockiso-"));
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = isoLockDir;
    origMax = process.env.DOTCLAUDE_GATE_QUERY_MAX;
    origStale = process.env.DOTCLAUDE_GATE_QUERY_STALE_MS;
  });
  afterEach(() => {
    try { fs.rmSync(isoLockDir, { recursive: true, force: true }); } catch {}
    if (origLockDir === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR; else process.env.DOTCLAUDE_GRAPHLOCK_DIR = origLockDir;
    if (origMax === undefined) delete process.env.DOTCLAUDE_GATE_QUERY_MAX; else process.env.DOTCLAUDE_GATE_QUERY_MAX = origMax;
    if (origStale === undefined) delete process.env.DOTCLAUDE_GATE_QUERY_STALE_MS; else process.env.DOTCLAUDE_GATE_QUERY_STALE_MS = origStale;
  });

  test("acquires up to the cap (default 2), then the next call is refused", () => {
    const r1 = acquireGateQuerySlot();
    const r2 = acquireGateQuerySlot();
    const r3 = acquireGateQuerySlot();
    expect(typeof r1).toBe("function");
    expect(typeof r2).toBe("function");
    expect(r3).toBe(null);
    r1(); r2();
  });

  test("releasing a slot frees it up for the next acquirer", () => {
    const r1 = acquireGateQuerySlot();
    const r2 = acquireGateQuerySlot();
    expect(acquireGateQuerySlot()).toBe(null);
    r1();
    const r3 = acquireGateQuerySlot();
    expect(typeof r3).toBe("function");
    r2(); r3();
  });

  test("a stale slot (older than the stale window) is reclaimed, not treated as busy", () => {
    process.env.DOTCLAUDE_GATE_QUERY_STALE_MS = "50";
    fs.writeFileSync(gateQuerySlotPath(0), JSON.stringify({ pid: 999999, ts: Date.now() - 1000 }));
    fs.writeFileSync(gateQuerySlotPath(1), JSON.stringify({ pid: 999999, ts: Date.now() - 1000 }));
    const r = acquireGateQuerySlot();
    expect(typeof r).toBe("function");
    r();
  });

  test("DOTCLAUDE_GATE_QUERY_MAX overrides the default cap", () => {
    process.env.DOTCLAUDE_GATE_QUERY_MAX = "1";
    const r1 = acquireGateQuerySlot();
    expect(typeof r1).toBe("function");
    expect(acquireGateQuerySlot()).toBe(null);
    r1();
  });
});

describe("isGraphifyQueryCommand — only real query runs relent the gate", () => {
  test.each([
    ['graphify query "x"', true],
    ['  graphify query "what calls foo"', true],
    ['cd sub && graphify query "x"', true],
    ['graphify query "x" | head', true],
    ['ANTHROPIC_LOG=1 graphify query "x"', false], // env prefix not handled — acceptable, errs safe
  ])("run detection: %s", (cmd, expected) => {
    expect(isGraphifyQueryCommand(cmd)).toBe(expected);
  });

  test.each([
    ['echo "graphify query"', 'echo mention'],
    ['grep -r "graphify query" .', 'grep mention'],
    ['git commit -m "add graphify query support"', 'commit message'],
    ['# graphify query is great', 'comment'],
    ['cat graphify-query-notes.md', 'filename'],
  ])("does NOT relent on mention: %s (%s)", (cmd) => {
    expect(isGraphifyQueryCommand(cmd)).toBe(false);
  });

  test("non-string input is safe", () => {
    expect(isGraphifyQueryCommand(undefined)).toBe(false);
    expect(isGraphifyQueryCommand(null)).toBe(false);
  });
});

describe("bgWindowless — sentinel-less background runner", () => {
  const waitFor = async (p, timeoutMs = 8000) => {
    const start = Date.now();
    while (!fs.existsSync(p)) {
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return true;
  };

  test("runs the command through the detached runner but writes NO sentinel", async () => {
    const dir = tmp();
    const marker = path.join(dir, "marker.txt");
    // A tiny writer script the runner will execute — proves the runner actually
    // ran the command, without stressing shell quoting (mkdtemp paths have no spaces).
    const writer = path.join(dir, "writer.cjs");
    fs.writeFileSync(writer, `require("fs").writeFileSync(process.argv[2], "ran");`);
    // Bare `node` (not process.execPath) — the real callers pass bare command
    // names too, and the win32 runner-shell mangles an absolute exe path that
    // contains spaces (e.g. "C:\\Program Files\\nodejs\\node.exe").
    expect(bgWindowless("node", [writer, marker], dir)).toBe(true);
    expect(await waitFor(marker)).toBe(true);        // command executed + survived
    expect(fs.existsSync(sentinelPath(dir))).toBe(false); // NO sentinel written
    clearSentinel(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 12000);
});

describe("background-build sentinel — read/clear", () => {
  let dir;
  beforeEach(() => { dir = tmp(); });
  afterEach(() => {
    clearSentinel(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("no sentinel → null", () => {
    expect(readSentinel(dir)).toBeNull();
  });

  test.each([
    ["ok\r\n", { status: "ok" }],
    ["fail\r\n", { status: "fail", code: null }], // win32 shape — no exit code available
    ["fail:9\n", { status: "fail", code: 9 }],    // POSIX shape
    ["fail:\r\n", { status: "unknown" }],          // garbage stays distinguishable
  ])("parses %j", (content, expected) => {
    fs.writeFileSync(sentinelPath(dir), content);
    expect(readSentinel(dir)).toEqual(expected);
  });

  test("clearSentinel removes and is a no-op when absent", () => {
    fs.writeFileSync(sentinelPath(dir), "ok");
    clearSentinel(dir);
    expect(readSentinel(dir)).toBeNull();
    expect(() => clearSentinel(dir)).not.toThrow();
  });

  test("sentinelPath is stable per cwd and distinct across cwds", () => {
    expect(sentinelPath(dir)).toBe(sentinelPath(dir));
    expect(sentinelPath(dir)).not.toBe(sentinelPath(tmp()));
  });
});

// End-to-end through the REAL detached Node runner (spawnBgRunner) — the runner
// executes the command as a windowless, non-detached child and writes the
// sentinel from Node's `exit` event, so both ok and non-zero exits are reported
// on every platform. Detached spawn → poll.
describe("background-build sentinel — bgWithSentinel end-to-end", () => {
  // Poll for the sentinel on a generous budget with a short interval — never a
  // fixed wait. A healthy run settles in well under a second and returns
  // immediately; a full-suite run (56 files, many parallel workers) starves the
  // detached runner's node boot + child spawn far more than an isolated run
  // does, and a tight budget turns that starvation into a false failure.
  const SETTLE_MS = 30000;
  const POLL_MS = 25;
  const waitForSentinel = async (cwd, timeoutMs = SETTLE_MS) => {
    const start = Date.now();
    for (;;) {
      const s = readSentinel(cwd);
      if (s !== null) return s;
      if (Date.now() - start > timeoutMs) return null;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  };
  const waitForGone = async (p, timeoutMs = 10000) => {
    const start = Date.now();
    while (fs.existsSync(p)) {
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return true;
  };

  // Isolate the lock dir — the actual cause of this pair going flaky. Both tests
  // assert that bgWithSentinel SPAWNS, but its machine-wide cap counts every live
  // `dotclaude-graphupdate-*.lock` in the SHARED os.tmpdir(): real graphify builds
  // on the machine, other worktrees, and leftovers from a runner killed before it
  // cleared its own lock (win32 recycles PIDs, so a stale lock can read as live).
  // With the default cap of 2, two such foreign locks flip the expected spawn into
  // a skip and bgWithSentinel returns false — reproduced exactly, as this pair
  // failing under a loaded full-suite run and passing in isolation. An isolated
  // lock dir makes the count start at 0 every test, so the spawn precondition no
  // longer depends on machine state. Same isolation the two describes below use.
  let origLockDir, isoDir;
  beforeEach(() => {
    origLockDir = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    isoDir = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-e2e-lockiso-"));
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = isoDir;
  });
  afterEach(() => {
    try { fs.rmSync(isoDir, { recursive: true, force: true }); } catch {}
    if (origLockDir === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    else process.env.DOTCLAUDE_GRAPHLOCK_DIR = origLockDir;
  });

  test("successful command → 'ok' sentinel", async () => {
    const dir = tmp();
    const okCmd = process.platform === "win32" ? "ver" : "true";
    expect(bgWithSentinel(okCmd, [], dir)).toBe(true);
    expect(await waitForSentinel(dir)).toEqual({ status: "ok" });
    // Let the runner release its lock before teardown removes the iso dir, so
    // this test never leaves a live-PID lock behind for a later run to trip on.
    await waitForGone(updateLockPath(dir));
    clearSentinel(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 45000);

  test("failing command → parseable 'fail' sentinel (not 'unknown')", async () => {
    const dir = tmp();
    const failCmd = process.platform === "win32" ? "findstr" : "false";
    const failArgs = process.platform === "win32" ? ["/x", "nomatch", "nul"] : [];
    expect(bgWithSentinel(failCmd, failArgs, dir)).toBe(true);
    const s = await waitForSentinel(dir);
    expect(s).not.toBeNull();
    expect(s.status).toBe("fail"); // the regression this guards against
    await waitForGone(updateLockPath(dir));
    clearSentinel(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 45000);
});

// Direct-call tests for the runner's child-spawn logic — the shell-less default
// (the Windows-Terminal-delegation window fix) plus the one-shot shell retry
// for `.cmd`/`.bat` shims. Window visibility itself is not unit-testable; these
// pin the command-construction/fallback semantics the fix must not break.
describe("runBgEntrypointChild — shell-less default + shim fallback", () => {
  const testWin = process.platform === "win32" ? test : test.skip;
  const runChild = (cmd, args, cwd) =>
    new Promise((resolve) => {
      let sentinel;
      runBgEntrypointChild(cmd, args, cwd, (text) => { sentinel = text; }, () => resolve(sentinel));
    });

  let dir;
  beforeEach(() => { dir = tmp(); });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("exit 0 through the shell-less path → 'ok'", async () => {
    expect(await runChild("node", ["-e", "process.exit(0)"], dir)).toBe("ok");
  }, 10000);

  test("non-zero exit → 'fail:<code>' (exit code preserved)", async () => {
    expect(await runChild("node", ["-e", "process.exit(3)"], dir)).toBe("fail:3");
  }, 10000);

  test("nonexistent command → settles as 'fail' (never hangs, never throws)", async () => {
    expect(await runChild("definitely-not-a-real-cmd-x9z", [], dir)).toMatch(/^fail/);
  }, 10000);

  testWin(".cmd shim → falls back to the shell exactly once and still reports 'ok'", async () => {
    // spawn() without shell cannot exec a .cmd (sync EINVAL since the
    // CVE-2024-27980 hardening) — the runner must retry through cmd.exe.
    const shim = path.join(dir, "shim.cmd");
    fs.writeFileSync(shim, "@exit /b 0\r\n");
    expect(await runChild(shim, [], dir)).toBe("ok");
  }, 10000);

  testWin(".cmd shim with non-zero exit → shell retry preserves the code", async () => {
    const shim = path.join(dir, "shimfail.cmd");
    fs.writeFileSync(shim, "@exit /b 7\r\n");
    expect(await runChild(shim, [], dir)).toBe("fail:7");
  }, 10000);
});

// ── graphify-update concurrency mutex ────────────────────────────────────────
// Regression guard for the RAM-exhaustion bug: the SessionStart (10-min) and
// PreToolUse (2-min) spawn throttles only DEBOUNCE — when a single
// `graphify update .` runs longer than the throttle window (large repo) and a
// trigger (e.g. the */10 git-sync cron creating a fresh session) fires at least
// as often, runs stacked without bound (measured: 12 concurrent, ~29 GB commit).
// bgWithSentinel now takes a PID lock so at most ONE build runs per project.
describe("updateInFlight / updateLockPath — graphify-update concurrency mutex", () => {
  // Isolate the lock dir here too. These tests write locks holding a LIVE pid
  // (this very process), and unisolated they land in the shared os.tmpdir() —
  // the same pool bgWithSentinel's machine-wide cap counts. An interrupted run
  // leaks one, and win32 PID reuse can later make it read as live, so the suite
  // would seed exactly the foreign-lock contamination that made the end-to-end
  // pair flaky. Keep this file's locks out of the shared pool.
  let dir, origLockDir, isoDir;
  beforeEach(() => {
    origLockDir = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    isoDir = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-mutex-lockiso-"));
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = isoDir;
    dir = tmp();
  });
  afterEach(() => {
    clearUpdateLock(dir);
    try { fs.rmSync(isoDir, { recursive: true, force: true }); } catch {}
    if (origLockDir === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    else process.env.DOTCLAUDE_GRAPHLOCK_DIR = origLockDir;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("no lock file → not in flight", () => {
    expect(updateInFlight(dir)).toBe(false);
  });

  test("lock with a LIVE pid → in flight (blocks a second spawn)", () => {
    writeUpdateLock(dir, process.pid); // this test process is alive by definition
    expect(updateInFlight(dir)).toBe(true);
  });

  test("lock with a DEAD pid → not in flight (never wedges on a crashed runner)", () => {
    // 2147483647 names no live process → process.kill(pid, 0) throws ESRCH.
    fs.writeFileSync(updateLockPath(dir), JSON.stringify({ pid: 2147483647, ts: Date.now() }));
    expect(updateInFlight(dir)).toBe(false);
  });

  test("lock older than the stale window → not in flight even if the pid is live", () => {
    fs.writeFileSync(updateLockPath(dir), JSON.stringify({ pid: process.pid, ts: Date.now() - 46 * 60 * 1000 }));
    expect(updateInFlight(dir)).toBe(false);
  });

  test("corrupt lock → not in flight (fail-open: allow a fresh spawn)", () => {
    fs.writeFileSync(updateLockPath(dir), "{ not json");
    expect(updateInFlight(dir)).toBe(false);
  });

  test("updateLockPath stable per cwd, distinct across cwds, distinct from sentinelPath", () => {
    expect(updateLockPath(dir)).toBe(updateLockPath(dir));
    expect(updateLockPath(dir)).not.toBe(updateLockPath(tmp()));
    expect(updateLockPath(dir)).not.toBe(sentinelPath(dir));
  });

  test("clearUpdateLock removes the lock and is a no-op when absent", () => {
    writeUpdateLock(dir, process.pid);
    expect(updateInFlight(dir)).toBe(true);
    clearUpdateLock(dir);
    expect(updateInFlight(dir)).toBe(false);
    expect(() => clearUpdateLock(dir)).not.toThrow();
  });
});

describe("bgWithSentinel — concurrency guard (never stack graphify update)", () => {
  const waitForSentinel = async (cwd, timeoutMs = 5000) => {
    const start = Date.now();
    for (;;) {
      const s = readSentinel(cwd);
      if (s !== null) return s;
      if (Date.now() - start > timeoutMs) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const waitForGone = async (p, timeoutMs = 5000) => {
    const start = Date.now();
    while (fs.existsSync(p)) {
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
    return true;
  };

  // Isolate the lock dir so bgWithSentinel's global-cap check counts only THIS
  // test's locks — not real graphify builds on the machine running the suite,
  // which could otherwise trip the cap and flip an expected spawn into a skip.
  let origLockDir;
  beforeEach(() => {
    origLockDir = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-lockiso-"));
  });
  afterEach(() => {
    try { fs.rmSync(process.env.DOTCLAUDE_GRAPHLOCK_DIR, { recursive: true, force: true }); } catch {}
    if (origLockDir === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    else process.env.DOTCLAUDE_GRAPHLOCK_DIR = origLockDir;
  });

  test("skips (returns false, writes NO sentinel) when a build is already in flight", () => {
    const dir = tmp();
    writeUpdateLock(dir, process.pid); // simulate a live in-flight runner
    // Pre-seed a sentinel: a real spawn unlinks it first, so if it survives the
    // call, bgWithSentinel skipped without spawning.
    fs.writeFileSync(sentinelPath(dir), "ok");
    expect(bgWithSentinel("node", ["-e", "process.exit(0)"], dir)).toBe(false);
    expect(fs.existsSync(sentinelPath(dir))).toBe(true); // untouched → no spawn
    clearUpdateLock(dir);
    clearSentinel(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("spawns and writes a lock when none is in flight; runner clears the lock on exit", async () => {
    const dir = tmp();
    const okCmd = process.platform === "win32" ? "ver" : "true";
    expect(updateInFlight(dir)).toBe(false);
    expect(bgWithSentinel(okCmd, [], dir)).toBe(true);
    // Lock is written synchronously right after the spawn issues (the detached
    // runner has not booted node yet, so it cannot have cleared it).
    expect(fs.existsSync(updateLockPath(dir))).toBe(true);
    // Build finishes → sentinel appears AND the runner cleared its lock.
    expect(await waitForSentinel(dir)).toEqual({ status: "ok" });
    expect(await waitForGone(updateLockPath(dir))).toBe(true);
    clearSentinel(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 10000);
});

// ── machine-wide concurrency cap ─────────────────────────────────────────────
// The per-project lock does nothing ACROSS projects — N worktrees each get their
// own build, so a multi-worktree machine ran several heavy builds at once (RAM +
// disk saturation). bgWithSentinel now also caps the TOTAL live builds across all
// cwds at updateGlobalCap() (default 2). Lock dir is isolated per test so the
// count reflects only what the test wrote.
describe("globalUpdatesInFlight / machine-wide cap", () => {
  let origLockDir, origCap, isoDir;
  beforeEach(() => {
    origLockDir = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    origCap = process.env.DOTCLAUDE_GRAPH_MAX_BUILDS;
    isoDir = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-cap-"));
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = isoDir;
  });
  afterEach(() => {
    try { fs.rmSync(isoDir, { recursive: true, force: true }); } catch {}
    if (origLockDir === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    else process.env.DOTCLAUDE_GRAPHLOCK_DIR = origLockDir;
    if (origCap === undefined) delete process.env.DOTCLAUDE_GRAPH_MAX_BUILDS;
    else process.env.DOTCLAUDE_GRAPH_MAX_BUILDS = origCap;
  });

  test("default cap is 2; positive env override respected; invalid → default", () => {
    delete process.env.DOTCLAUDE_GRAPH_MAX_BUILDS;
    expect(updateGlobalCap()).toBe(2);
    process.env.DOTCLAUDE_GRAPH_MAX_BUILDS = "5";
    expect(updateGlobalCap()).toBe(5);
    process.env.DOTCLAUDE_GRAPH_MAX_BUILDS = "0";
    expect(updateGlobalCap()).toBe(2);
    process.env.DOTCLAUDE_GRAPH_MAX_BUILDS = "abc";
    expect(updateGlobalCap()).toBe(2);
  });

  test("counts only live, non-stale locks across cwds", () => {
    expect(globalUpdatesInFlight()).toBe(0);
    writeUpdateLock("/proj/a", process.pid);
    writeUpdateLock("/proj/b", process.pid);
    expect(globalUpdatesInFlight()).toBe(2);
    // dead pid + stale stamp are ignored, exactly like updateInFlight
    fs.writeFileSync(updateLockPath("/proj/c"), JSON.stringify({ pid: 2147483647, ts: Date.now() }));
    fs.writeFileSync(updateLockPath("/proj/d"), JSON.stringify({ pid: process.pid, ts: Date.now() - 46 * 60 * 1000 }));
    expect(globalUpdatesInFlight()).toBe(2);
  });

  test("bgWithSentinel skips (no spawn) when the global cap is reached, even for a fresh cwd", () => {
    process.env.DOTCLAUDE_GRAPH_MAX_BUILDS = "2";
    writeUpdateLock("/proj/a", process.pid);
    writeUpdateLock("/proj/b", process.pid); // 2 live across other cwds → cap reached
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-fresh-"));
    expect(updateInFlight(fresh)).toBe(false);        // this cwd itself is free…
    fs.writeFileSync(sentinelPath(fresh), "ok");       // pre-seed to prove no spawn
    expect(bgWithSentinel("node", ["-e", "process.exit(0)"], fresh)).toBe(false); // …but cap blocks
    expect(fs.existsSync(sentinelPath(fresh))).toBe(true); // untouched → no spawn
    clearSentinel(fresh);
    try { fs.rmSync(fresh, { recursive: true, force: true }); } catch {}
  });

  test("bgWithSentinel spawns when still below the cap", async () => {
    process.env.DOTCLAUDE_GRAPH_MAX_BUILDS = "2";
    writeUpdateLock("/proj/a", process.pid); // 1 live < cap 2
    const okCmd = process.platform === "win32" ? "ver" : "true";
    const fresh = tmp(); // a project (carries .git) — a bare dir is refused before the cap is even consulted
    expect(bgWithSentinel(okCmd, [], fresh)).toBe(true);
    // let it settle so the detached runner clears its own lock before teardown
    const start = Date.now();
    while (readSentinel(fresh) === null && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    clearSentinel(fresh);
    try { fs.rmSync(fresh, { recursive: true, force: true }); } catch {}
  }, 10000);
});

// ---------------------------------------------------------------------------
// #291 — a declined spawn must not spend the caller's throttle token
// ---------------------------------------------------------------------------

describe("releaseRefresh — declined spawn gives the cooldown back", () => {
  test("released slot lets the next self-heal attempt run immediately", () => {
    const d = tmp();
    expect(markRefresh(d, 120_000)).toBe(true);   // first attempt takes the slot
    expect(markRefresh(d, 120_000)).toBe(false);  // throttled for 2 min

    // The spawn was declined (PID lock / global cap), so nothing ran — the
    // cooldown must not be charged for it.
    releaseRefresh(d);
    expect(markRefresh(d, 120_000)).toBe(true);
    expect(fs.existsSync(refreshFlagPath(d))).toBe(true);
  });

  test("releasing without a flag is a no-op", () => {
    const d = tmp();
    expect(() => releaseRefresh(d)).not.toThrow();
    expect(markRefresh(d, 120_000)).toBe(true);
  });
});

describe("decline bookkeeping — a permanently starved project is visible", () => {
  let origLockDir, isoDir;
  beforeEach(() => {
    origLockDir = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    isoDir = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-decline-iso-"));
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = isoDir;
  });
  afterEach(() => {
    try { fs.rmSync(isoDir, { recursive: true, force: true }); } catch {}
    if (origLockDir === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    else process.env.DOTCLAUDE_GRAPHLOCK_DIR = origLockDir;
  });

  test("counts consecutive declines per project, independently", () => {
    const a = tmp(), b = tmp();
    expect(declineCount(a)).toBe(0);
    expect(noteDecline(a)).toBe(1);
    expect(noteDecline(a)).toBe(2);
    expect(declineCount(a)).toBe(2);
    expect(declineCount(b)).toBe(0); // a neighbour's streak is not ours
  });

  test("clearDeclines resets the streak", () => {
    const d = tmp();
    noteDecline(d); noteDecline(d);
    clearDeclines(d);
    expect(declineCount(d)).toBe(0);
  });

  test("a garbled counter file reads as 0 rather than throwing", () => {
    const d = tmp();
    fs.writeFileSync(declineCountPath(d), "not-a-number");
    expect(declineCount(d)).toBe(0);
    expect(noteDecline(d)).toBe(1);
  });

  test("bgWithSentinel records a decline when the per-project lock is held", () => {
    const d = tmp();
    writeUpdateLock(d, process.pid); // this project already has a live build
    expect(bgWithSentinel("ver", [], d)).toBe(false);
    expect(declineCount(d)).toBe(1);
    clearUpdateLock(d);
  });

  test("bgWithSentinel records a decline when the machine-wide cap is reached", () => {
    const d = tmp();
    // Fill the cap with foreign live locks, then attempt this project's build.
    for (let i = 0; i < updateGlobalCap(); i++) writeUpdateLock(tmp(), process.pid);
    expect(globalUpdatesInFlight()).toBeGreaterThanOrEqual(updateGlobalCap());
    expect(bgWithSentinel("ver", [], d)).toBe(false);
    expect(declineCount(d)).toBe(1);
  });
});

// ── auto-build eligibility: only ever crawl a project ────────────────────────
// Regression guard for the home-directory crawl: a session whose cwd was $HOME
// ran the SessionStart refresh, and `graphify update .` spent hours (3+ GB RSS,
// ~5 CPU-hours) walking AppData, every checkout on the machine and everything
// else under the profile. The build is only ever meaningful inside a git work
// tree, and the home directory is never one for this purpose — even when it is
// itself a dotfiles repo.
describe("isProjectDir / findRepoRoot — auto-build eligibility", () => {
  let origHome, origUserProfile, fakeHome;
  beforeEach(() => {
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-home-"));
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch {}
  });

  test("a dir with no .git anywhere above it is not a project", () => {
    const d = tmpBare();
    expect(findRepoRoot(d)).toBeNull();
    expect(isProjectDir(d)).toBe(false);
  });

  test("a git checkout is a project, and so is any subdirectory of it", () => {
    const root = tmp(); // carries .git
    const sub = path.join(root, "src", "deep");
    fs.mkdirSync(sub, { recursive: true });
    expect(findRepoRoot(sub)).toBe(root);
    expect(isProjectDir(root)).toBe(true);
    expect(isProjectDir(sub)).toBe(true);
  });

  test("a linked worktree (.git is a FILE, not a dir) is a project", () => {
    const d = tmpBare();
    fs.writeFileSync(path.join(d, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
    expect(isProjectDir(d)).toBe(true);
  });

  test("the home directory is never a project — not even as a dotfiles repo", () => {
    expect(isProjectDir(fakeHome)).toBe(false);
    fs.mkdirSync(path.join(fakeHome, ".git"));
    expect(isProjectDir(fakeHome)).toBe(false);
    // A subdir whose nearest repo root IS the home dir inherits the refusal.
    const docs = path.join(fakeHome, "Documents");
    fs.mkdirSync(docs);
    expect(isProjectDir(docs)).toBe(false);
  });

  test("garbage input is not a project (never throws)", () => {
    expect(isProjectDir("")).toBe(false);
    expect(isProjectDir(null)).toBe(false);
    expect(isProjectDir(path.join(os.tmpdir(), "does-not-exist-" + Date.now()))).toBe(false);
  });
});

describe("bgWithSentinel — refuses to build outside a project", () => {
  let origLockDir, isoDir;
  beforeEach(() => {
    origLockDir = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    isoDir = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-proj-iso-"));
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = isoDir;
  });
  afterEach(() => {
    try { fs.rmSync(isoDir, { recursive: true, force: true }); } catch {}
    if (origLockDir === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    else process.env.DOTCLAUDE_GRAPHLOCK_DIR = origLockDir;
  });

  test("non-project cwd → no spawn, no lock, no sentinel, and NOT a 'decline' either", () => {
    const d = tmpBare();
    // Pre-seed a sentinel: a real spawn unlinks it first — surviving means no spawn.
    fs.writeFileSync(sentinelPath(d), "ok");
    expect(bgWithSentinel("node", ["-e", "process.exit(0)"], d)).toBe(false);
    expect(fs.existsSync(sentinelPath(d))).toBe(true);
    expect(fs.existsSync(updateLockPath(d))).toBe(false);
    // Ineligible is not starved: the decline streak (issue #291 reporting) must
    // not count a cwd that can never build.
    expect(declineCount(d)).toBe(0);
    clearSentinel(d);
  });
});

// ── update-lock heartbeat: a live long build must stay "in flight" ──────────
// Regression guard for the double build: updateInFlight() treats a lock older
// than the 45-min stale window as dead WITHOUT consulting the pid, so a build
// that legitimately ran longer (the home-directory crawl took hours) lost its
// lock and a second `graphify update .` started on the same cwd, overwriting
// the lock with its own pid. The runner now refreshes its lock stamp while the
// child runs, so "stale" means "no heartbeat for 45 min" — a crashed runner or
// a recycled pid — never merely "a long build".
describe("update-lock heartbeat — refreshUpdateLockFile / clearUpdateLockFile", () => {
  let dir;
  beforeEach(() => { dir = tmpBare(); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  test("owned lock → stamp refreshed, pid kept, reports 'owned'", () => {
    const lock = path.join(dir, "x.lock");
    const old = Date.now() - 60 * 60 * 1000;
    fs.writeFileSync(lock, JSON.stringify({ pid: 4242, ts: old }));
    expect(refreshUpdateLockFile(lock, 4242)).toBe("owned");
    const after = JSON.parse(fs.readFileSync(lock, "utf8"));
    expect(after.pid).toBe(4242);
    expect(after.ts).toBeGreaterThan(old);
  });

  test("foreign lock → untouched, reports 'foreign'", () => {
    const lock = path.join(dir, "x.lock");
    const body = JSON.stringify({ pid: 1, ts: 123 });
    fs.writeFileSync(lock, body);
    expect(refreshUpdateLockFile(lock, 4242)).toBe("foreign");
    expect(fs.readFileSync(lock, "utf8")).toBe(body);
  });

  test("missing or corrupt lock → nothing written, reports 'missing'", () => {
    const lock = path.join(dir, "x.lock");
    expect(refreshUpdateLockFile(lock, 4242)).toBe("missing");
    expect(fs.existsSync(lock)).toBe(false);
    fs.writeFileSync(lock, "{not json");
    expect(refreshUpdateLockFile(lock, 4242)).toBe("missing");
  });

  test("clearUpdateLockFile removes an owned lock but never a foreign one", () => {
    const lock = path.join(dir, "x.lock");
    fs.writeFileSync(lock, JSON.stringify({ pid: 4242, ts: Date.now() }));
    expect(clearUpdateLockFile(lock, 4242)).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
    fs.writeFileSync(lock, JSON.stringify({ pid: 1, ts: Date.now() }));
    expect(clearUpdateLockFile(lock, 4242)).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    expect(clearUpdateLockFile(lock, 1)).toBe(true); // the owner may
    expect(clearUpdateLockFile(lock, 1)).toBe(false); // absent → no-op, no throw
  });
});

describe("update-lock heartbeat — the --bg-run runner keeps its lock fresh", () => {
  const POLL_MS = 25;
  const waitUntil = async (pred, timeoutMs = 30000) => {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return true;
  };
  const readLock = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

  let origLockDir, origHb, isoDir;
  beforeEach(() => {
    origLockDir = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    origHb = process.env.DOTCLAUDE_GRAPH_HEARTBEAT_MS;
    isoDir = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-hb-iso-"));
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = isoDir;
    process.env.DOTCLAUDE_GRAPH_HEARTBEAT_MS = "100"; // inherited by the runner
  });
  afterEach(() => {
    try { fs.rmSync(isoDir, { recursive: true, force: true }); } catch {}
    if (origLockDir === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    else process.env.DOTCLAUDE_GRAPHLOCK_DIR = origLockDir;
    if (origHb === undefined) delete process.env.DOTCLAUDE_GRAPH_HEARTBEAT_MS;
    else process.env.DOTCLAUDE_GRAPH_HEARTBEAT_MS = origHb;
  });

  test("a live build older than the stale window is back 'in flight' after one heartbeat", async () => {
    const d = tmp();
    const lock = updateLockPath(d);
    // A child that outlives several heartbeats: the shape of a long build.
    expect(bgWithSentinel("node", ["-e", "setTimeout(()=>{},2500)"], d)).toBe(true);
    const { pid } = readLock(lock);
    // Age the stamp past the stale window — exactly what wall-clock did to the
    // real 3-hour build. Without a heartbeat this is where the second build slipped in.
    fs.writeFileSync(lock, JSON.stringify({ pid, ts: Date.now() - 46 * 60 * 1000 }));
    expect(updateInFlight(d)).toBe(false);
    expect(await waitUntil(() => { const l = readLock(lock); return !!l && l.pid === pid && Date.now() - l.ts < 45 * 60 * 1000; })).toBe(true);
    expect(updateInFlight(d)).toBe(true); // the live runner re-asserted its lock
    // …and still releases it when the child exits.
    expect(await waitUntil(() => readSentinel(d) !== null)).toBe(true);
    expect(await waitUntil(() => !fs.existsSync(lock), 10000)).toBe(true);
    clearSentinel(d);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }, 40000);

  test("the runner never refreshes or removes a lock another runner owns", async () => {
    const d = tmp();
    const lock = updateLockPath(d);
    const sentinel = sentinelPath(d);
    // Seed a foreign live lock (this very process poses as the other runner),
    // then start a runner DIRECTLY for the same cwd — bypassing bgWithSentinel,
    // which would rightly decline. This is the shape of the overwrite bug's
    // aftermath: two runners, one lock file.
    const foreign = JSON.stringify({ pid: process.pid, ts: Date.now() });
    fs.writeFileSync(lock, foreign);
    const runner = spawn(process.execPath, [GSTATE_JS, "--bg-run", sentinel, lock, d, "node", "-e", "setTimeout(()=>{},600)"], {
      cwd: d, stdio: "ignore", windowsHide: true,
    });
    const exited = new Promise((resolve) => runner.on("exit", resolve));
    await exited;
    expect(readSentinel(d)).toEqual({ status: "ok" }); // its own build ran fine
    expect(fs.readFileSync(lock, "utf8")).toBe(foreign); // the foreign lock survived, byte for byte
    clearSentinel(d);
    fs.unlinkSync(lock);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }, 30000);
});

describe("state dir isolation — sentinel lives beside the locks", () => {
  test("sentinelPath honors DOTCLAUDE_GRAPHLOCK_DIR like updateLockPath does", () => {
    const orig = process.env.DOTCLAUDE_GRAPHLOCK_DIR;
    const iso = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-sent-iso-"));
    process.env.DOTCLAUDE_GRAPHLOCK_DIR = iso;
    try {
      const d = tmpBare();
      expect(lockBaseDir()).toBe(iso);
      expect(path.dirname(sentinelPath(d))).toBe(iso);
      expect(path.dirname(updateLockPath(d))).toBe(iso);
    } finally {
      if (orig === undefined) delete process.env.DOTCLAUDE_GRAPHLOCK_DIR;
      else process.env.DOTCLAUDE_GRAPHLOCK_DIR = orig;
      try { fs.rmSync(iso, { recursive: true, force: true }); } catch {}
    }
  });
});

describe("graphifyBin — the build binary is overridable", () => {
  test("defaults to the bare name; DOTCLAUDE_GRAPHIFY_BIN wins when set and non-empty", () => {
    const orig = process.env.DOTCLAUDE_GRAPHIFY_BIN;
    try {
      delete process.env.DOTCLAUDE_GRAPHIFY_BIN;
      expect(graphifyBin()).toBe("graphify");
      process.env.DOTCLAUDE_GRAPHIFY_BIN = "";
      expect(graphifyBin()).toBe("graphify");
      process.env.DOTCLAUDE_GRAPHIFY_BIN = "/opt/tools/graphify-shim";
      expect(graphifyBin()).toBe("/opt/tools/graphify-shim");
    } finally {
      if (orig === undefined) delete process.env.DOTCLAUDE_GRAPHIFY_BIN;
      else process.env.DOTCLAUDE_GRAPHIFY_BIN = orig;
    }
  });
});

describe("mainCheckoutRoot — linked worktree → primary checkout", () => {
  /** A primary checkout (.git DIR) plus a linked worktree whose .git FILE points back at it. */
  function pair({ relative = false } = {}) {
    const main = tmp();
    const wtGitDir = path.join(main, ".git", "worktrees", "feature-x");
    fs.mkdirSync(wtGitDir, { recursive: true });
    const wt = tmpBare();
    const target = relative ? path.relative(wt, wtGitDir) : wtGitDir;
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${target}\n`);
    return { main, wt };
  }

  test("resolves the primary checkout from a linked worktree, and from its subdirs", () => {
    const { main, wt } = pair();
    expect(mainCheckoutRoot(wt)).toBe(main);
    const sub = path.join(wt, "plugins", "devops");
    fs.mkdirSync(sub, { recursive: true });
    expect(mainCheckoutRoot(sub)).toBe(main);
  });

  test("a relative gitdir resolves against the worktree root", () => {
    const { main, wt } = pair({ relative: true });
    expect(mainCheckoutRoot(wt)).toBe(main);
  });

  test("null for a primary checkout (.git is a directory)", () => {
    expect(mainCheckoutRoot(tmp())).toBeNull();
  });

  test("null when the gitdir does not point into a <main>/.git/worktrees/<name> layout", () => {
    const wt = tmpBare();
    fs.writeFileSync(path.join(wt, ".git"), "gitdir: /somewhere/else\n");
    expect(mainCheckoutRoot(wt)).toBeNull();
  });

  test("null when the primary .git it points at does not exist (stale worktree)", () => {
    const wt = tmpBare();
    const ghost = path.join(os.tmpdir(), "gstate-ghost-" + Date.now(), ".git", "worktrees", "x");
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${ghost}\n`);
    expect(mainCheckoutRoot(wt)).toBeNull();
  });

  test("null outside any repo and on garbage input (never throws)", () => {
    expect(mainCheckoutRoot(tmpBare())).toBeNull();
    expect(mainCheckoutRoot("")).toBeNull();
    expect(mainCheckoutRoot(null)).toBeNull();
  });
});
