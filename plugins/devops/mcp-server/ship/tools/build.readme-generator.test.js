import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// zod is a runtime dep of the MCP server, not installed in the test env (see
// build.test.js). Everything else here is real: fs, child_process, node.
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  return { z: { object: () => node, string: () => node, boolean: () => node } };
});

import { handler } from "./build.js";

// Reproduces the 2026-09-25 incident end to end: the session's ship server was
// spawned from cache devops/0.201.4, the plugin-source repo was at 0.203.0, and
// ship_build rewrote the README roster with the server's bundled generator —
// 57 hooks instead of 58, SubagentStart gone.
const README = [
  "# dotclaude",
  "Hooks: <!--devops:count:hooks-->58<!--/devops:count:hooks-->",
  "<!--devops:block:hook-lifecycle-->",
  "#### SubagentStart — runs when a subagent is spawned",
  "<!--/devops:block:hook-lifecycle-->",
  "",
].join("\n");

// A stand-in generator that writes a fixed roster into README.md, the way the
// real one rewrites the marker blocks.
function fakeGenerator(hooks, lifecycle) {
  return [
    'import { readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const file = join(process.argv[2], "README.md");',
    'let s = readFileSync(file, "utf8");',
    `s = s.replace(/(<!--devops:count:hooks-->)[\\s\\S]*?(<!--\\/devops:count:hooks-->)/, (_, a, b) => a + ${JSON.stringify(String(hooks))} + b);`,
    `s = s.replace(/(<!--devops:block:hook-lifecycle-->)[\\s\\S]*?(<!--\\/devops:block:hook-lifecycle-->)/, (_, a, b) => a + ${JSON.stringify(`\n${lifecycle}\n`)} + b);`,
    'writeFileSync(file, s, "utf8");',
    "",
  ].join("\n");
}

function writePlugin(dir, version, generator) {
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "devops", version }));
  if (generator) writeFileSync(join(dir, "scripts", "gen-readme-sections.mjs"), generator);
}

let tmp, repo, serverPlugin, savedPluginRoot;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ship-build-readme-"));
  repo = join(tmp, "dotclaude");
  serverPlugin = join(tmp, "cache", "dotclaude", "devops", "0.201.4");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), README);
  // The server's bundled generator predates SubagentStart.
  writePlugin(serverPlugin, "0.201.4", fakeGenerator(57, "#### PostToolUse — runs after each tool call"));
  writeFileSync(join(serverPlugin, "scripts", "build-id.js"), 'console.log("fixture-build-id");\n');
  savedPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = serverPlugin;
});

afterEach(() => {
  if (savedPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
  else process.env.CLAUDE_PLUGIN_ROOT = savedPluginRoot;
  rmSync(tmp, { recursive: true, force: true });
});

const build = () => handler({ cwd: repo, buildCmd: null, lintCmd: null, testCmd: null, buildIdOnly: false });
const readme = () => readFileSync(join(repo, "README.md"), "utf8");

describe("ship_build on the plugin-source repo from an older MCP server", () => {
  test("the repo's own generator writes the roster — 58 hooks, SubagentStart kept", async () => {
    writePlugin(
      join(repo, "plugins", "devops"),
      "0.203.0",
      fakeGenerator(58, "#### SubagentStart — runs when a subagent is spawned"),
    );
    const res = await build();
    expect(res.success).toBe(true);
    expect(res.warnings.find((w) => w.generator === "readme-sections")).toBeUndefined();
    expect(readme()).toContain("<!--devops:count:hooks-->58<!--/devops:count:hooks-->");
    expect(readme()).toContain("SubagentStart");
  });

  test("no repo generator → the older bundled one does not touch the markers", async () => {
    writePlugin(join(repo, "plugins", "devops"), "0.203.0", null);
    const res = await build();
    expect(res.success).toBe(true);
    expect(readme()).toBe(README);
    expect(res.warnings.find((w) => w.generator === "readme-sections")?.error).toMatch(/v0\.201\.4.*v0\.203\.0/);
  });
});
