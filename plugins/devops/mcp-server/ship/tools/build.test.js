import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// zod is a runtime dep of the MCP server, not installed in the test env. The
// handler never invokes the schema (only MCP registration does), so a minimal
// chainable stub suffices to load the module.
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  return { z: { object: () => node, string: () => node, boolean: () => node, number: () => node } };
});

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
  execFileSync: vi.fn(() => ""),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  readdirSync: vi.fn(() => []),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Green-result store (#762) — covered for real in lib/test-results.test.js.
vi.mock("../lib/test-results.js", () => ({
  treeKey: vi.fn(() => null),
  findGreen: vi.fn(() => null),
  recordResult: vi.fn(() => null),
  usualDurationMs: vi.fn(() => null),
}));

// Real parsers; only the machine probes are stubbed (no 500 ms CPU sample, no live lock file).
vi.mock("../lib/test-step.js", async (importOriginal) => ({
  ...(await importOriginal()),
  sampleCpu: vi.fn(async () => ({ busyPct: 10, cores: 8 })),
  readLockHolder: vi.fn(() => null),
}));

import { handler, latestCacheVersion } from "./build.js";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { treeKey, findGreen, recordResult, usualDurationMs } from "../lib/test-results.js";
import { sampleCpu, readLockHolder } from "../lib/test-step.js";

const PLUGIN_ROOT = "/plugin-root";
const CWD = "/consumer-repo";

// Normalize backslashes so path assertions are OS-agnostic (node:path.join
// emits `\` on win32).
const norm = (s) => String(s).replace(/\\/g, "/");
function execCommands() {
  return execSync.mock.calls.map((c) => norm(c[0]));
}

let savedPluginRoot;

beforeEach(() => {
  vi.clearAllMocks();
  savedPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  // Pin pluginRoot() to a known dir via the authoritative env var so scriptPath
  // resolves deterministically (pluginRoot step 1: env set + existsSync true).
  process.env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  existsSync.mockImplementation((p) => {
    const s = norm(p);
    if (s === PLUGIN_ROOT) return true; // pluginRoot resolves here
    if (s.endsWith("/deep-knowledge")) return true; // project has a root deep-knowledge/
    return false; // package.json absent → no build/lint/test commands
  });
  execSync.mockReturnValue(""); // every generator + build-id succeeds by default
  readFileSync.mockImplementation(() => "{}"); // clearAllMocks keeps per-test implementations
  spawnSync.mockImplementation(() => ({ status: 0, stdout: "", stderr: "" }));
  treeKey.mockImplementation(() => null);
  findGreen.mockImplementation(() => null);
  recordResult.mockImplementation(() => null);
  usualDurationMs.mockImplementation(() => null);
  sampleCpu.mockImplementation(async () => ({ busyPct: 10, cores: 8 }));
  readLockHolder.mockImplementation(() => null);
});

afterEach(() => {
  if (savedPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
  else process.env.CLAUDE_PLUGIN_ROOT = savedPluginRoot;
});

describe("ship_build — script-path resolution", () => {
  test("resolves generator + build-id scripts under the plugin root (lazy accessors CALLED)", async () => {
    await handler({ cwd: CWD, buildCmd: null, lintCmd: null, testCmd: null, buildIdOnly: false });
    const cmds = execCommands();
    // The plugin deep-knowledge index generator ran with a resolved path.
    expect(cmds.some((c) => c.includes("scripts/gen-dk-index.mjs"))).toBe(true);
    // The build-id script ran (getBuildId).
    expect(cmds.some((c) => c.includes("scripts/build-id.js"))).toBe(true);
    // Every resolved command points under the pinned plugin root.
    expect(cmds.some((c) => c.includes(`${PLUGIN_ROOT}/scripts/`))).toBe(true);
  });

  test("buildIdOnly short-circuits to the build-id hash", async () => {
    execSync.mockReturnValue("deadbeef\n");
    const res = await handler({ cwd: CWD, buildCmd: null, lintCmd: null, testCmd: null, buildIdOnly: true });
    expect(res).toEqual({ success: true, buildId: "deadbeef", skipped: true });
  });
});

describe("ship_build — project deep-knowledge index (F5 regression)", () => {
  test("project deep-knowledge generator runs with the RESOLVED path, not a stringified arrow fn", async () => {
    await handler({ cwd: CWD, buildCmd: null, lintCmd: null, testCmd: null, buildIdOnly: false });

    const projectDkCall = execCommands().find(
      (c) => c.includes("deep-knowledge") && c.includes("gen-dk-index.mjs"),
    );
    // The project deep-knowledge index MUST be regenerated (existsSync → true).
    expect(projectDkCall).toBeDefined();
    // F5: `${DK_INDEX_SCRIPT}` (no parens) stringified the arrow function into
    // the command (`() => scriptPath("gen-dk-index.mjs")`). The fix `${DK_INDEX_SCRIPT()}`
    // substitutes the resolved path — so the command must contain NEITHER the
    // arrow token NOR the accessor name.
    expect(projectDkCall).not.toContain("=>");
    expect(projectDkCall).not.toContain("scriptPath");
    // It targets the project's deep-knowledge dir as the argument.
    expect(projectDkCall).toContain(`${CWD}/deep-knowledge`);
  });

  test("project deep-knowledge generator is skipped when the dir is absent", async () => {
    existsSync.mockImplementation((p) => norm(p) === PLUGIN_ROOT); // no deep-knowledge dir
    await handler({ cwd: CWD, buildCmd: null, lintCmd: null, testCmd: null, buildIdOnly: false });
    const projectDkCall = execCommands().find(
      (c) => c.includes("deep-knowledge") && c.includes("gen-dk-index.mjs"),
    );
    expect(projectDkCall).toBeUndefined();
  });
});

describe("ship_build — generator failures surfaced, not swallowed", () => {
  test("a failing deep-knowledge generator produces a warning in the result", async () => {
    execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("gen-dk-index.mjs")) throw new Error("generator boom");
      return "";
    });

    const res = await handler({ cwd: CWD, buildCmd: null, lintCmd: null, testCmd: null, buildIdOnly: false });

    expect(res.success).toBe(true); // generator failure is non-fatal to the build
    expect(Array.isArray(res.warnings)).toBe(true);
    expect(res.warnings.some((w) => /dk-index/.test(w.generator))).toBe(true);
    expect(res.warnings.some((w) => /boom/.test(w.error))).toBe(true);
  });

  test("all generators succeed → empty warnings array", async () => {
    const res = await handler({ cwd: CWD, buildCmd: null, lintCmd: null, testCmd: null, buildIdOnly: false });
    expect(res.success).toBe(true);
    expect(res.warnings).toEqual([]);
  });
});

describe("ship_build — README roster generator (stale MCP server regression)", () => {
  // 2026-09-25: the session's ship server ran from cache devops/0.201.4 while the
  // repo was at 0.203.0; its bundled gen-readme-sections.mjs did not know
  // SubagentStart and rewrote README.md + architecture.html with 57 of 58 hooks.
  const SRC = "/dotclaude";
  const REPO_GEN = `${SRC}/plugins/devops/scripts/gen-readme-sections.mjs`;
  const BUNDLED_GEN = `${PLUGIN_ROOT}/scripts/gen-readme-sections.mjs`;
  const readmeCalls = () => execCommands().filter((c) => c.includes("gen-readme-sections.mjs"));
  const build = (cwd) => handler({ cwd, buildCmd: null, lintCmd: null, testCmd: null, buildIdOnly: false });

  function pluginSourceRepo({ repoGenerator, repoVersion = null, bundledVersion = null }) {
    existsSync.mockImplementation((p) => {
      const s = norm(p);
      if (s === PLUGIN_ROOT || s === `${SRC}/plugins/devops`) return true;
      if (s === REPO_GEN) return repoGenerator;
      return false;
    });
    const versions = {
      [`${SRC}/plugins/devops/.claude-plugin/plugin.json`]: repoVersion,
      [`${PLUGIN_ROOT}/.claude-plugin/plugin.json`]: bundledVersion,
    };
    readFileSync.mockImplementation((p) => {
      const version = versions[norm(p)];
      if (!version) throw new Error(`ENOENT: ${p}`);
      return JSON.stringify({ name: "devops", version });
    });
  }

  test("plugin source repo runs its OWN generator, never the older bundled one", async () => {
    pluginSourceRepo({ repoGenerator: true, repoVersion: "0.203.0", bundledVersion: "0.201.4" });
    const res = await build(SRC);
    const calls = readmeCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`"${REPO_GEN}" "${SRC}"`);
    expect(calls[0]).not.toContain(BUNDLED_GEN);
    expect(res.warnings).toEqual([]);
  });

  test("consumer repo keeps the bundled generator (unchanged behavior)", async () => {
    await build(CWD);
    const calls = readmeCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`"${BUNDLED_GEN}" "${CWD}"`);
  });

  test.each([
    ["older", "0.201.4", "0.203.0"],
    ["numerically older (not lexicographic)", "0.99.0", "0.100.0"],
    ["unknown version", null, "0.203.0"],
    ["repo version unknown", "0.203.0", null],
  ])("repo without its own generator + %s bundled one → markers left untouched, warning", async (_, bundledVersion, repoVersion) => {
    pluginSourceRepo({ repoGenerator: false, repoVersion, bundledVersion });
    const res = await build(SRC);
    expect(readmeCalls()).toEqual([]);
    const warning = res.warnings.find((w) => w.generator === "readme-sections");
    expect(warning?.error).toMatch(/skipped/);
    expect(res.success).toBe(true);
  });

  test.each([
    ["same", "0.203.0", "0.203.0"],
    ["newer", "0.204.0", "0.203.0"],
  ])("repo without its own generator + %s bundled one → bundled runs", async (_, bundledVersion, repoVersion) => {
    pluginSourceRepo({ repoGenerator: false, repoVersion, bundledVersion });
    const res = await build(SRC);
    const calls = readmeCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`"${BUNDLED_GEN}" "${SRC}"`);
    expect(res.warnings).toEqual([]);
  });
});

describe("latestCacheVersion (AUD-C047)", () => {
  test("numeric semver order, not lexicographic", () => {
    expect(latestCacheVersion(["0.183.9", "0.183.12", "0.99.40"])).toBe("0.183.12");
    expect(latestCacheVersion(["0.9.0", "0.10.0"])).toBe("0.10.0");
  });
  test("non-semver names only when nothing else exists", () => {
    expect(latestCacheVersion(["zzz-temp", "0.2.0"])).toBe("0.2.0");
    expect(latestCacheVersion(["b", "a"])).toBe("b");
    expect(latestCacheVersion([])).toBeNull();
  });
});

const TEST = "npm run test";
const testCall = () => spawnSync.mock.calls.find((c) => String(c[0]).includes(TEST));
const buildWithTests = (extra = {}) => handler({ cwd: CWD, buildCmd: null, lintCmd: null, testCmd: TEST, buildIdOnly: false, ...extra });
const red = (stdout, stderr = "") => ({ status: 1, stdout, stderr });

describe("ship_build — harness-side failures are named, not read as red tests", () => {
  test("passes a large maxBuffer so chatty green output is not ENOBUFS-killed", async () => {
    await buildWithTests();
    expect(testCall()[1].maxBuffer).toBeGreaterThanOrEqual(32 * 1024 * 1024);
  });

  test("ENOBUFS is reported as failure kind output-overflow", async () => {
    const e = new Error("spawnSync ENOBUFS"); e.code = "ENOBUFS";
    spawnSync.mockImplementation(() => ({ status: null, stdout: "", stderr: "", error: e }));
    const res = await buildWithTests();
    expect(res.success).toBe(false);
    expect(res.failedAt).toBe("test");
    const step = res.steps.find((s) => s.step === "test");
    expect(step.failure).toBe("output-overflow");
    expect(step.output).toMatch(/not by a failing test/);
    expect(res.failureKind).toBeUndefined();
  });

  test("I2: the step limit defaults to 300 s and is configurable", async () => {
    await buildWithTests();
    expect(testCall()[1].timeout).toBe(300_000);
    spawnSync.mockClear();
    await buildWithTests({ stepTimeoutSec: 600 });
    expect(testCall()[1].timeout).toBe(600_000);
  });

  test("I2: a timed-out step names the limit in the result (timeoutHit)", async () => {
    const e = new Error("spawnSync ETIMEDOUT"); e.code = "ETIMEDOUT";
    spawnSync.mockImplementation(() => ({ status: null, signal: "SIGTERM", stdout: "", stderr: "", error: e }));
    const res = await buildWithTests();
    expect(res.failedAt).toBe("test");
    expect(res.timeoutHit).toMatchObject({ step: "test", limitSec: 300 });
    expect(res.timeoutHit.note).toMatch(/300 s step limit.*stepTimeoutSec/);
    const step = res.steps.find((s) => s.step === "test");
    expect(step.failure).toBe("timeout");
    expect(step.output).toMatch(/300 s limit/);
  });

  test("I2: a red test carries no timeoutHit", async () => {
    spawnSync.mockImplementation(() => red(" FAIL  a.test.js > x\n"));
    const res = await buildWithTests();
    expect(res.failedAt).toBe("test");
    expect(res.timeoutHit).toBeUndefined();
  });
});

describe("ship_build — green-result reuse by tree hash (#762)", () => {
  const KEY = { treeHash: "a".repeat(40), method: "worktree" };

  test("a matching green record skips the test run and reports testsReused", async () => {
    treeKey.mockImplementation(() => KEY);
    findGreen.mockImplementation(() => ({ treeHash: KEY.treeHash, testCmd: TEST, passed: true, at: "2026-10-20T10:00:00.000Z", source: "agent" }));
    const res = await buildWithTests();
    expect(res.success).toBe(true);
    expect(testCall()).toBeUndefined();
    expect(res.testsReused).toEqual({ treeHash: KEY.treeHash, at: "2026-10-20T10:00:00.000Z", source: "agent", testCmd: TEST });
    expect(res.steps.find((s) => s.step === "test")).toMatchObject({ success: true, reused: true });
    expect(findGreen).toHaveBeenCalledWith(CWD, { treeHash: KEY.treeHash, testCmd: TEST });
  });

  test("no record → runs, and a green run on an unchanged tree is recorded", async () => {
    treeKey.mockImplementation(() => KEY);
    const res = await buildWithTests();
    expect(testCall()).toBeDefined();
    expect(res.testsReused).toBeUndefined();
    expect(recordResult).toHaveBeenCalledWith(CWD, expect.objectContaining({ treeHash: KEY.treeHash, testCmd: TEST, passed: true, source: "ship_build" }));
  });

  test("tree changed during the run → not recorded", async () => {
    let n = 0;
    treeKey.mockImplementation(() => (n++ === 0 ? KEY : { treeHash: "b".repeat(40), method: "worktree" }));
    await buildWithTests();
    expect(recordResult).not.toHaveBeenCalled();
  });

  test("reuseGreen:false always runs", async () => {
    treeKey.mockImplementation(() => KEY);
    findGreen.mockImplementation(() => ({ treeHash: KEY.treeHash, testCmd: TEST, passed: true, at: "x", source: "agent" }));
    const res = await buildWithTests({ reuseGreen: false });
    expect(testCall()).toBeDefined();
    expect(res.testsReused).toBeUndefined();
  });

  test("a red run is never recorded", async () => {
    treeKey.mockImplementation(() => KEY);
    spawnSync.mockImplementation(() => red(" FAIL  a.test.js > x\n"));
    await buildWithTests();
    expect(recordResult).not.toHaveBeenCalled();
  });
});

describe("ship_build — red test step: retry, classification, names (#762)", () => {
  const EPERM = "Error: EPERM, operation not permitted, rmdir 'C:\\Users\\x\\AppData\\Local\\Temp\\vitest-iso-123'";

  test("EPERM temp-cleanup red → one retry; green retry passes the step", async () => {
    let n = 0;
    spawnSync.mockImplementation(() => (n++ === 0 ? red("Unhandled Errors\n", EPERM) : { status: 0, stdout: "ok", stderr: "" }));
    const res = await buildWithTests();
    expect(res.success).toBe(true);
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(res.steps.find((s) => s.step === "test").retried).toMatchObject({ secondPassed: true });
  });

  test("EPERM twice and no failing test → failureKind environment", async () => {
    spawnSync.mockImplementation(() => red("Unhandled Errors\n", EPERM));
    const res = await buildWithTests();
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(res.failureKind).toBe("environment");
    expect(res.failingTests).toEqual([]);
  });

  test("a plain red run is not retried, failureKind test, every failing name returned past the output tail", async () => {
    const names = Array.from({ length: 300 }, (_, i) => `plugins/f${i}.test.js > suite > case number ${i}`);
    spawnSync.mockImplementation(() => red(names.map((n) => ` FAIL  ${n}\n${"x".repeat(200)}`).join("\n")));
    const res = await buildWithTests();
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(res.failureKind).toBe("test");
    expect(res.failingTests).toEqual(names);
    expect(res.steps.find((s) => s.step === "test").output.length).toBeLessThanOrEqual(4000);
  });

  test("stdout and stderr both reach the output (stderr no longer hides the vitest summary)", async () => {
    spawnSync.mockImplementation(() => red(" FAIL  a.test.js > x\n", "[suite-lock] acquired after 2 s\n"));
    const res = await buildWithTests();
    const out = res.steps.find((s) => s.step === "test").output;
    expect(out).toContain("FAIL  a.test.js > x");
    expect(out).toContain("[suite-lock]");
  });
});

describe("ship_build — load signal (#762)", () => {
  test("a lock wait from the suite-lock stderr lines is returned as load", async () => {
    spawnSync.mockImplementation(() => ({
      status: 0, stdout: "",
      stderr: "[suite-lock] another full test run is active (pid 4242, C:/other) — waiting for it to finish\n[suite-lock] acquired after 312 s\n",
    }));
    const res = await buildWithTests();
    expect(res.success).toBe(true);
    expect(res.load).toMatchObject({ lockWaitMs: 312_000, holder: { pid: 4242, cwd: "C:/other" } });
    expect(res.load.note).toMatch(/312 s on the machine-wide test lock/);
  });

  test("a live lock holder at start or a busy CPU is reported", async () => {
    readLockHolder.mockImplementation(() => ({ pid: 7, cwd: "C:/x", heldMs: 1000 }));
    sampleCpu.mockImplementation(async () => ({ busyPct: 97, cores: 8 }));
    const res = await buildWithTests();
    expect(res.load).toMatchObject({ holder: { pid: 7 }, cpuBusyPct: 97 });
  });

  test("an unloaded run carries no load field", async () => {
    const res = await buildWithTests();
    expect(res.load).toBeUndefined();
  });
});

