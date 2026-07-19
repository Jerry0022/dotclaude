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
import { existsSync } from "node:fs";

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
    expect(cmds.some((c) => c.includes("scripts/gen-dk-index.js"))).toBe(true);
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
      (c) => c.includes("deep-knowledge") && c.includes("gen-dk-index.js"),
    );
    // The project deep-knowledge index MUST be regenerated (existsSync → true).
    expect(projectDkCall).toBeDefined();
    // F5: `${DK_INDEX_SCRIPT}` (no parens) stringified the arrow function into
    // the command (`() => scriptPath("gen-dk-index.js")`). The fix `${DK_INDEX_SCRIPT()}`
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
      (c) => c.includes("deep-knowledge") && c.includes("gen-dk-index.js"),
    );
    expect(projectDkCall).toBeUndefined();
  });
});

describe("ship_build — generator failures surfaced, not swallowed", () => {
  test("a failing deep-knowledge generator produces a warning in the result", async () => {
    execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("gen-dk-index.js")) throw new Error("generator boom");
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
