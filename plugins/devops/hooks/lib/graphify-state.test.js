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
