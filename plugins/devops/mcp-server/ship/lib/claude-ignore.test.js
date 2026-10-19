import { describe, test, expect } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";
import { claudeIgnoreCheck, migrateCommand } from "./claude-ignore.js";

const require = createRequire(import.meta.url);
const ri = require("../../../hooks/lib/runtime-ignores.js");

const CWD = path.resolve("/repo");
const reader = (files) => (p) => {
  const key = path.resolve(p).replace(/\\/g, "/");
  for (const [k, v] of Object.entries(files)) if (path.resolve(k).replace(/\\/g, "/") === key) return v;
  return null;
};

describe("ship_preflight claude-ignore check", () => {
  test("a ship that does not touch .gitignore, info/exclude or .claude/ gets no check", () => {
    const res = claudeIgnoreCheck({ cwd: CWD, files: ["src/a.js", "README.md"], read: () => { throw new Error("must not read"); } });
    expect(res).toBeNull();
  });

  test("touching .claude/ with a current block → ok, no warning", () => {
    const res = claudeIgnoreCheck({ cwd: CWD, files: [".claude/settings.json"], read: reader({ "/repo/.gitignore": ri.applyBlock("node_modules/\n") }) });
    expect(res).toEqual({ name: "claude-ignore", ok: true, issues: [] });
  });

  test("a deviation is a non-blocking warning carrying the migrate command", () => {
    const res = claudeIgnoreCheck({
      cwd: CWD,
      files: [".gitignore"],
      commonDir: "/repo/.git",
      read: reader({
        "/repo/.gitignore": ".claude/worktrees/\n",
        "/repo/.git/info/exclude": `${ri.LEGACY_START} >>>\n.claude/batch.md\n${ri.LEGACY_END} <<<\n`,
      }),
      pluginRoot: "/plugin",
    });
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual(["missing-block", "duplicate-lines", "exclude-block"]);
    expect(res.fix).toBe(migrateCommand(CWD, "/plugin"));
    expect(res.fix).toMatch(/^node "\/plugin\/scripts\/claude-ignore\.js" migrate "/);
    expect(res.warning).toContain(res.fix);
  });

  test("committed files under the block: a warning with the git rm --cached fix, no migrate when nothing else deviates", () => {
    const res = claudeIgnoreCheck({
      cwd: CWD, files: [".claude/launch.json"], tracked: [".claude/launch.json"],
      read: reader({ "/repo/.gitignore": ri.applyBlock("") }), pluginRoot: "/plugin",
    });
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual(["tracked-local"]);
    expect(res.fix).toBeUndefined();
    expect(res.untrack).toBe('git rm --cached -- ".claude/launch.json"');
    expect(res.warning).toContain(res.untrack);
  });

  test("policy deviations are listed but are not issues", () => {
    const res = claudeIgnoreCheck({ cwd: CWD, files: [".gitignore"], read: reader({ "/repo/.gitignore": ri.applyBlock(".claude/settings.json\n") }) });
    expect(res.issues).toEqual([]);
    expect(res.warning).toBeUndefined();
    expect(res.policy).toEqual([".claude/settings.json ignores .claude/settings.json (versioned by policy)"]);
  });
});
