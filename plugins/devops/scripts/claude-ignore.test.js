import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { checkRepo, migrateRepo, writeEnvExamples, dotenvKeys, blankJson } = require("./claude-ignore.js");
const ri = require("../hooks/lib/runtime-ignores.js");

const tmp = [];
function repo() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ci-")));
  tmp.push(d);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: d });
  return d;
}
afterEach(() => { while (tmp.length) fs.rmSync(tmp.pop(), { recursive: true, force: true }); });

describe("claude-ignore migrate / check", () => {
  test("migrate moves a repo to the canonical layout and is idempotent", () => {
    const d = repo();
    fs.writeFileSync(path.join(d, ".gitignore"), "node_modules/\r\n.claude/worktrees/\r\n.claude/settings.local.json\r\n");
    const exclude = path.join(d, ".git", "info", "exclude");
    fs.writeFileSync(exclude, `# keep me\n${ri.LEGACY_START} >>>\n.claude/batch.md\n${ri.LEGACY_END} <<<\n**/.claude/scheduled_tasks.lock\n`);
    expect(checkRepo(d).ok).toBe(false);
    const first = migrateRepo(d);
    expect(first.gitignore.changed).toBe(true);
    expect(first.exclude.changed).toBe(true);
    const gi = fs.readFileSync(path.join(d, ".gitignore"), "utf8");
    expect(gi).toContain("\r\n");
    expect(gi).toContain(ri.BLOCK_START);
    expect(fs.readFileSync(exclude, "utf8")).toBe("# keep me\n");
    expect(checkRepo(d)).toMatchObject({ ok: true, issues: [] });
    const second = migrateRepo(d);
    expect(second.gitignore.changed).toBe(false);
    expect(second.exclude.changed).toBe(false);
  });

  test("a linked worktree's migrate cleans the shared info/exclude", () => {
    const d = repo();
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "0"], { cwd: d });
    const wt = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ci-wt-"))), "w");
    tmp.push(path.dirname(wt));
    execFileSync("git", ["worktree", "add", "-q", "-b", "w", wt], { cwd: d });
    fs.writeFileSync(path.join(d, ".git", "info", "exclude"), `${ri.LEGACY_START} >>>\n.claude/batch.md\n${ri.LEGACY_END} <<<\n`);
    migrateRepo(wt);
    expect(fs.readFileSync(path.join(d, ".git", "info", "exclude"), "utf8")).not.toContain(".claude/");
    expect(fs.existsSync(path.join(wt, ".gitignore"))).toBe(true);
  });

  test("migrate removes the session-start fallback block from info/exclude", () => {
    const d = repo();
    const exclude = path.join(d, ".git", "info", "exclude");
    fs.writeFileSync(exclude, ri.applyExcludeFallback("# keep me\n"));
    fs.writeFileSync(path.join(d, ".gitignore"), "node_modules/\n");
    expect(checkRepo(d).issues.map((i) => i.code)).toEqual(["missing-block"]);
    expect(migrateRepo(d).exclude.changed).toBe(true);
    expect(fs.readFileSync(exclude, "utf8")).toBe("# keep me\n");
    expect(checkRepo(d)).toMatchObject({ ok: true, issues: [] });
  });

  test("committed files the block ignores are reported with the git rm --cached fix, never untracked", () => {
    const d = repo();
    fs.mkdirSync(path.join(d, ".claude"));
    fs.writeFileSync(path.join(d, ".claude", "launch.json"), "{}");
    fs.writeFileSync(path.join(d, ".claude", "settings.json"), "{}");
    execFileSync("git", ["add", "-A"], { cwd: d });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "0"], { cwd: d });
    const m = migrateRepo(d);
    expect(m.tracked).toEqual([".claude/launch.json"]);
    expect(m.untrack).toBe('git rm --cached -- ".claude/launch.json"');
    const c = checkRepo(d);
    expect(c.ok).toBe(false);
    expect(c.issues.map((i) => i.code)).toEqual(["tracked-local"]);
    expect(c.issues[0].detail).toContain('git rm --cached -- ".claude/launch.json"');
    expect(execFileSync("git", ["ls-files"], { cwd: d, encoding: "utf8" })).toContain(".claude/launch.json");
  });
});

describe("claude-ignore env-example — key names only, never values", () => {
  test("dotenv keys become KEY= lines; existing examples only gain missing keys", () => {
    const d = repo();
    fs.writeFileSync(path.join(d, ".env"), "API_KEY=sk-live-supersecretvalue123\nexport DB_URL=postgres://u:p@h/db\n# comment\nAPI_KEY=dup\n");
    fs.writeFileSync(path.join(d, ".env.local"), "EXTRA_TOKEN=abcdef123456\n");
    const r = writeEnvExamples(d);
    const ex = fs.readFileSync(path.join(d, ".env.example"), "utf8");
    expect(r.written).toEqual([path.join(d, ".env.example")]);
    expect(ex).toMatch(/^API_KEY=$/m);
    expect(ex).toMatch(/^DB_URL=$/m);
    expect(ex).toMatch(/^EXTRA_TOKEN=$/m);
    expect(ex).not.toMatch(/supersecret|postgres|abcdef/);
    fs.writeFileSync(path.join(d, ".env"), "API_KEY=x\nNEW_ONE=y\n");
    writeEnvExamples(d);
    const again = fs.readFileSync(path.join(d, ".env.example"), "utf8");
    expect(again.match(/^API_KEY=$/gm)).toHaveLength(1);
    expect(again).toMatch(/^NEW_ONE=$/m);
  });

  test("*.local.json gets a blanked *.example.json; environment.local.ts is only reported", () => {
    const d = repo();
    fs.mkdirSync(path.join(d, "cfg"));
    fs.writeFileSync(path.join(d, "cfg", "app.local.json"), JSON.stringify({ apiKey: "secret-1234567890", port: 8080, debug: true, nested: { token: "t0k3n" }, list: ["a"] }));
    fs.writeFileSync(path.join(d, "environment.local.ts"), "export const env = { key: 'v' };");
    const r = writeEnvExamples(d);
    const out = JSON.parse(fs.readFileSync(path.join(d, "cfg", "app.example.json"), "utf8"));
    expect(out).toEqual({ apiKey: "", port: 0, debug: false, nested: { token: "" }, list: [""] });
    expect(r.skipped.some((s) => s.file.endsWith("environment.local.ts"))).toBe(true);
  });

  test("helpers", () => {
    expect(dotenvKeys("A=1\n  B = 2\nnot a line\nexport C=3\n")).toEqual(["A", "B", "C"]);
    expect(blankJson({ a: [1, 2], b: null })).toEqual({ a: [0], b: null });
  });
});
