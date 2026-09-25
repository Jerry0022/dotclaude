import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The project map only saves tokens when it is (a) actually put in front of
// Claude before a repo-wide search and (b) current. Observed 2026-09-25: the
// map every session loaded was from July (291 of 1074 files) — gitignored,
// regenerated only in throwaway worktrees — and a Grep/Glob scoped to the
// absolute project root slipped past both the block and the map injection.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.tokens.guard.js");

const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mapguard-home-"));
fs.mkdirSync(path.join(HOME_DIR, ".claude"), { recursive: true });
const METRICS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mapguard-metrics-")), "metrics.jsonl");
const dirs = [];

afterAll(() => {
  for (const d of [HOME_DIR, path.dirname(METRICS_FILE), ...dirs]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

const STALE_MAP = "<!-- AUTO-GENERATED -->\n# Project Map — stale\n\n291 tracked files.\n";

/** A git repo with three tracked files and (optionally) a stale map. */
function project({ map = true } = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mapguard-")));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
  );
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.js"), "const a = 1;\n");
  fs.writeFileSync(path.join(dir, "src", "b.js"), "const b = 2;\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
  execFileSync("git", ["add", "src", "README.md"], { cwd: dir, stdio: "pipe" });
  if (map) fs.writeFileSync(path.join(dir, ".claude", "project-map.md"), STALE_MAP);
  return dir;
}

function run(dir, sid, toolName, toolInput) {
  const res = spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, session_id: sid }),
    encoding: "utf8",
    env: { ...process.env, HOME: HOME_DIR, USERPROFILE: HOME_DIR, DOTCLAUDE_GRAPHIFY_METRICS: METRICS_FILE },
  });
  let context = "";
  try { context = JSON.parse(res.stdout).hookSpecificOutput.additionalContext; } catch {}
  return { status: res.status, stderr: res.stderr || "", context };
}

const sid = () => `mapguard-${crypto.randomUUID()}`;
// "ab" is too short for the graphify gate — these tests exercise only the
// broad-search path.
const grep = (dir, s, p) => run(dir, s, "Grep", p === undefined ? { pattern: "ab" } : { pattern: "ab", path: p });
const events = () => (fs.existsSync(METRICS_FILE)
  ? fs.readFileSync(METRICS_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : []);

describe("pre.tokens.guard — project map is current when injected", () => {
  test("the first repo-wide search injects a REGENERATED map, not the stale copy on disk", () => {
    const dir = project();
    const s = sid();
    const r = grep(dir, s);
    expect(r.status).toBe(0);
    expect(r.context).toContain("[project-map]");
    expect(r.context).toContain("3 tracked files");
    expect(r.context).not.toContain("291 tracked files");
    expect(fs.readFileSync(path.join(dir, ".claude", "project-map.md"), "utf8")).toContain("3 tracked files");
    expect(events().some((e) => e.event === "map_injected" && e.sid === s)).toBe(true);
  });

  test("no map on disk → none is created at search time", () => {
    const dir = project({ map: false });
    const r = grep(dir, sid());
    expect(r.context).not.toContain("[project-map]");
    expect(fs.existsSync(path.join(dir, ".claude", "project-map.md"))).toBe(false);
  });
});

describe("pre.tokens.guard — a path at the project root is repo-wide", () => {
  test.each([
    ["absolute root", (dir) => dir],
    ["root with trailing separator", (dir) => dir + path.sep],
    ["relative ./", () => "./"],
  ])("Grep with %s: map on the first call, block on the next, retry proceeds", (_, toPath) => {
    const dir = project();
    const s = sid();
    const first = grep(dir, s, toPath(dir));
    expect(first.status).toBe(0);
    expect(first.context).toContain("[project-map]");

    const second = grep(dir, s, toPath(dir));
    expect(second.status).toBe(2);
    expect(second.stderr).toContain("HIGH TOKEN COST");
    expect(second.stderr).toContain("project-map.md");

    expect(grep(dir, s, toPath(dir)).status).toBe(0);
  });

  test("Glob '**' scoped to the absolute root counts as repo-wide too", () => {
    const dir = project();
    const s = sid();
    const first = run(dir, s, "Glob", { pattern: "**/*.js", path: dir });
    expect(first.status).toBe(0);
    expect(first.context).toContain("[project-map]");
    expect(run(dir, s, "Glob", { pattern: "**/*.js", path: dir }).status).toBe(2);
  });

  test("a subdirectory path stays unguarded (no map, no block)", () => {
    const dir = project();
    const s = sid();
    for (let i = 0; i < 2; i++) {
      const r = grep(dir, s, path.join(dir, "src"));
      expect(r.status).toBe(0);
      expect(r.context).toBe("");
    }
  });
});
