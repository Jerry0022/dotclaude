// AUD-028: a lib that fails to load — half-written during a plugin update —
// must make these hooks a silent no-op, not a hook error on every call.
// Harness: each hook is copied into a temp `hooks/<event>/` dir whose sibling
// `hooks/lib/` holds a no-op plugin-guard and libs that throw on require.
import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const HOOKS = [
  {
    rel: "pre-tool-use/pre.main.guard.js",
    input: { tool_name: "Bash", tool_input: { command: "git commit -m x" } },
  },
  {
    rel: "pre-tool-use/pre.edit.branch.js",
    input: { tool_name: "Edit", tool_input: { file_path: "a.txt" } },
  },
  {
    rel: "user-prompt-submit/prompt.ship.detect.js",
    input: { prompt: "ship it", session_id: "w4-1" },
  },
];

const BROKEN_LIBS = [
  "git-timeout", "ship-sentinel", "session-id", "ship-intent",
  "ship-unshipped", "context-size", "ship-compact",
];

function harness(rel, brokenLib) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w4-libload-"));
  dirs.push(root);
  const hooks = path.join(root, "hooks");
  fs.mkdirSync(path.join(hooks, "lib"), { recursive: true });
  fs.mkdirSync(path.join(hooks, path.dirname(rel)), { recursive: true });
  fs.copyFileSync(path.join(HOOKS_DIR, rel), path.join(hooks, rel));
  fs.writeFileSync(path.join(hooks, "lib", "plugin-guard.js"), "module.exports = {};\n");
  for (const lib of BROKEN_LIBS) {
    const body = brokenLib === "*" || brokenLib === lib
      ? "throw new SyntaxError('half-written lib');\n"
      : "module.exports = {};\n";
    fs.writeFileSync(path.join(hooks, "lib", `${lib}.js`), body);
  }
  return path.join(hooks, rel);
}

describe("hooks with a lib that fails to load exit 0 silently (AUD-028)", () => {
  for (const { rel, input } of HOOKS) {
    test(`${rel}: every lib broken`, () => {
      const hook = harness(rel, "*");
      const cwd = path.dirname(hook);
      const res = spawnSync(process.execPath, [hook], {
        cwd,
        input: JSON.stringify({ ...input, cwd }),
        encoding: "utf8",
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
      expect(res.stdout).toBe("");
    });

    test(`${rel}: a broken plugin-guard itself`, () => {
      const hook = harness(rel, "none");
      fs.writeFileSync(
        path.join(path.dirname(hook), "..", "lib", "plugin-guard.js"),
        "module.exports = {; // truncated\n",
      );
      const cwd = path.dirname(hook);
      const res = spawnSync(process.execPath, [hook], {
        cwd,
        input: JSON.stringify({ ...input, cwd }),
        encoding: "utf8",
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe("");
    });
  }
});
