import { describe, test, expect, vi, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// The README hook of skill-restructure PR 3: setup-readme is no skill any
// more; the first substantial README write of a session gets a pointer to
// deep-knowledge/readme-standards.md.

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.readme.standards.js");
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const { isReadmeWrite } = require("./pre.readme.standards.js");

describe("isReadmeWrite", () => {
  test.each([
    ["Write", { file_path: "C:\\repo\\README.md", content: "# x" }],
    ["Write", { file_path: "/repo/readme.markdown", content: "# x" }],
    ["Write", { file_path: "/repo/packages/a/README", content: "x" }],
    ["Edit", { file_path: "/repo/README.md", old_string: "## A\nold", new_string: "## A\nnew" }],
    ["Edit", { file_path: "/repo/README.md", old_string: "x", new_string: "y", replace_all: true }],
  ])("%s %j → yes", (tool, input) => {
    expect(isReadmeWrite(tool, input)).toBe(true);
  });

  test.each([
    ["Edit", { file_path: "/repo/README.md", old_string: "**Version: 1.2.3**", new_string: "**Version: 1.2.4**" }],
    ["Write", { file_path: "/repo/docs/guide.md", content: "x" }],
    ["Write", { file_path: "/repo/README-old.md", content: "x" }],
    ["Write", { file_path: "/repo/node_modules/pkg/README.md", content: "x" }],
    ["Write", { file_path: "/repo/.claude/skill-usage/README.md", content: "x" }],
    ["Read", { file_path: "/repo/README.md" }],
    ["Write", {}],
  ])("%s %j → no", (tool, input) => {
    expect(isReadmeWrite(tool, input)).toBe(false);
  });
});

const dirs = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readme-standards-"));
  dirs.push(dir);
  for (const sub of [".claude", ".tmp", ".home"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  return dir;
}

let sid = 0;
function run(dir, payload) {
  const tmp = path.join(dir, ".tmp");
  const home = path.join(dir, ".home");
  const r = spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, ...payload }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, TMPDIR: tmp, TEMP: tmp, TMP: tmp, HOME: home, USERPROFILE: home },
  });
  expect(r.status).toBe(0);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "";
}

describe("pre.readme.standards (spawned)", () => {
  test("first README write points at the doc, the second is silent", () => {
    const dir = project();
    const session_id = `readme-${process.pid}-${++sid}`;
    const payload = { session_id, tool_name: "Write", tool_input: { file_path: path.join(dir, "README.md"), content: "# x" } };
    const first = run(dir, payload);
    expect(first).toContain("deep-knowledge/readme-standards.md");
    expect(first).toContain("README.md");
    expect(first).toMatch(/Not a skill/);
    expect(run(dir, payload)).toBe("");
  });

  test("an old setup-readme extension is named as a project override", () => {
    const dir = project();
    const ext = path.join(dir, ".claude", "skills", "setup-readme");
    fs.mkdirSync(ext, { recursive: true });
    fs.writeFileSync(path.join(ext, "reference.md"), "# overrides\n");
    const ctx = run(dir, { session_id: `readme-${process.pid}-${++sid}`, tool_name: "Write", tool_input: { file_path: path.join(dir, "README.md"), content: "# x" } });
    expect(ctx).toContain(".claude/skills/setup-readme/reference.md");
  });

  test("a version-bump edit and a non-README file stay silent; bad stdin exits 0", () => {
    const dir = project();
    const s = `readme-${process.pid}-${++sid}`;
    expect(run(dir, { session_id: s, tool_name: "Edit", tool_input: { file_path: path.join(dir, "README.md"), old_string: "1.0.0", new_string: "1.0.1" } })).toBe("");
    expect(run(dir, { session_id: s, tool_name: "Write", tool_input: { file_path: path.join(dir, "index.js"), content: "x" } })).toBe("");
    const bad = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    expect(bad.status).toBe(0);
    expect(bad.stdout).toBe("");
  });

  test("hooks.json registers it for Write|Edit", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8"));
    const entry = cfg.hooks.PreToolUse.find((e) => e.hooks.some((h) => h.command.includes("pre.readme.standards.js")));
    expect(entry).toBeTruthy();
    expect(entry.matcher).toBe("Write|Edit");
  });
});
