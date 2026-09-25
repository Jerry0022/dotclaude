import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// zod is a runtime dep of the MCP server, not installed in the test env. The
// handler never invokes the schema (only MCP registration does), so a minimal
// chainable stub suffices to load the module.
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  return { z: { object: () => node, string: () => node, boolean: () => node } };
});

vi.mock("node:child_process", () => ({ execSync: vi.fn(() => "") }));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  readdirSync: vi.fn(() => []),
}));

import { handler } from "./build.js";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

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
