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
} from "./graphify-state.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gstate-"));
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
  const waitForSentinel = async (cwd, timeoutMs = 5000) => {
    const start = Date.now();
    for (;;) {
      const s = readSentinel(cwd);
      if (s !== null) return s;
      if (Date.now() - start > timeoutMs) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  test("successful command → 'ok' sentinel", async () => {
    const dir = tmp();
    const okCmd = process.platform === "win32" ? "ver" : "true";
    expect(bgWithSentinel(okCmd, [], dir)).toBe(true);
    expect(await waitForSentinel(dir)).toEqual({ status: "ok" });
    clearSentinel(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 10000);

  test("failing command → parseable 'fail' sentinel (not 'unknown')", async () => {
    const dir = tmp();
    const failCmd = process.platform === "win32" ? "findstr" : "false";
    const failArgs = process.platform === "win32" ? ["/x", "nomatch", "nul"] : [];
    expect(bgWithSentinel(failCmd, failArgs, dir)).toBe(true);
    const s = await waitForSentinel(dir);
    expect(s).not.toBeNull();
    expect(s.status).toBe("fail"); // the regression this guards against
    clearSentinel(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }, 10000);
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
  let dir;
  beforeEach(() => { dir = tmp(); });
  afterEach(() => {
    clearUpdateLock(dir);
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
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "gstate-fresh-"));
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
