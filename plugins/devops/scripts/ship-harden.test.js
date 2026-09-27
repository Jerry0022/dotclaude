import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { run, addedLines } = require("./ship-harden.js");
const SCRIPT = path.join(import.meta.dirname, "ship-harden.js");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const lf = (s) => s.replace(/\r\n/g, "\n");

let root;
let work;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-harden-"));
  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  work = path.join(root, "work");
  git(root, "clone", "-q", origin, work);
  git(work, "config", "user.email", "t@t");
  git(work, "config", "user.name", "t");
  fs.writeFileSync(path.join(work, "a.js"), "export function a() {\n  return 1;\n}\n");
  fs.writeFileSync(path.join(work, "old.test.js"), "test.only('pre-existing', () => {});\n");
  git(work, "add", "-A"); git(work, "commit", "-q", "-m", "init"); git(work, "push", "-q", "origin", "main");
  git(work, "checkout", "-q", "-b", "feat/x");
});
afterEach(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows */ } });

function commit(files) {
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(work, f), body);
  git(work, "add", "-A"); git(work, "commit", "-q", "-m", "change");
}

describe("ship-harden — the auto-harden ship path as a script", () => {
  test("empty diff → not applicable", () => {
    expect(run({ base: "main", cwd: work, files: [] })).toMatchObject({ applicable: false, reason: "empty diff" });
  });

  test("H1 and H2 are fixed mechanically, only on added lines", () => {
    commit({
      "b.test.js": "describe.only('x', () => {\n  fit('y', () => {});\n});\n",
      "a.js": "export function a() {\n  debugger;\n  return 1;\n}\n",
    });
    const r = run({ base: "main", cwd: work, files: [] });
    expect(r.applicable).toBe(true);
    expect(r.fixed.map((f) => f.id).sort()).toEqual(["H1", "H1", "H2"]);
    expect(lf(fs.readFileSync(path.join(work, "b.test.js"), "utf8"))).toBe("describe('x', () => {\n  it('y', () => {});\n});\n");
    expect(lf(fs.readFileSync(path.join(work, "a.js"), "utf8"))).toBe("export function a() {\n  return 1;\n}\n");
    // The pre-existing .only in an untouched file is not this ship's finding.
    expect(fs.readFileSync(path.join(work, "old.test.js"), "utf8")).toContain("test.only");
  });

  test("strict: nothing is applied, every finding reported", () => {
    commit({ "a.js": "export function a() {\n  debugger;\n  return 1;\n}\n" });
    const r = run({ base: "main", cwd: work, strict: true, files: [] });
    expect(r.fixed).toEqual([]);
    expect(r.findings).toEqual([expect.objectContaining({ id: "H2", file: "a.js", line: 2 })]);
    expect(fs.readFileSync(path.join(work, "a.js"), "utf8")).toContain("debugger;");
  });

  test("report-only checks H3–H7, H3 first", () => {
    commit({
      "c.js": [
        "// TODO tidy this",
        "try { x(); } catch {}",
        "setInterval(tick, 1000);",
        "const apiKey = '" + "abcdefghijklmnopqrstuvwxyz" + "';", // split so this fixture is no finding itself
      ].join("\n") + "\n",
      "d.test.js": "test.skip('later', () => {});\n",
    });
    const r = run({ base: "main", cwd: work, files: [] });
    expect(r.findings[0].id).toBe("H3");
    expect(r.findings.map((f) => f.id).sort()).toEqual(["H3", "H4", "H5", "H6", "H7"]);
    expect(r.fixed).toEqual([]);
  });

  test("a catch with a comment, clearInterval in the file, and CHANGELOG are no findings", () => {
    commit({
      "e.js": "try { x(); } catch { /* optional */ }\nconst t = setInterval(f, 1);\nclearInterval(t);\n",
      "CHANGELOG.md": "- TODO in prose\n",
    });
    expect(run({ base: "main", cwd: work, files: [] }).findings).toEqual([]);
  });

  test("uncommitted changes count too; the file scope narrows", () => {
    fs.writeFileSync(path.join(work, "f.js"), "debugger;\n");
    fs.writeFileSync(path.join(work, "g.js"), "debugger;\n");
    git(work, "add", "-N", "f.js", "g.js");
    const r = run({ base: "main", cwd: work, strict: true, files: ["f.js"] });
    expect(r.findings.map((f) => f.file)).toEqual(["f.js"]);
  });

  test("CLI prints one JSON object and exits 0", () => {
    commit({ "a.js": "export function a() {\n  debugger;\n  return 1;\n}\n" });
    const res = spawnSync(process.execPath, [SCRIPT, "--invoked-by=ship", "--base=main", `--cwd=${work}`, "--dry-run"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.findings).toEqual([expect.objectContaining({ id: "H2", detail: "mechanical fix available (dry run)" })]);
    expect(fs.readFileSync(path.join(work, "a.js"), "utf8")).toContain("debugger;");
  });

  test("addedLines reads -U0 hunks with their new line numbers", () => {
    const diff = "+++ b/x.js\n@@ -1,0 +3,2 @@\n+one\n+two\n";
    expect([...addedLines(diff)]).toEqual([["x.js", [{ line: 3, text: "one" }, { line: 4, text: "two" }]]]);
  });
});

describe("ship-harden — fixture strings are no code (first real run, 2026-09-27)", () => {
  test("a .only / debugger / TODO / setInterval inside a string literal or regex is left alone", () => {
    commit({
      "h.test.js": [
        "const fixture = \"describe.only('x', () => {})\";",
        "const src = 'debugger;';",
        "const re = /\b(TODO|FIXME)\b/;",
        "const code = `setInterval(tick, 1)`;",
        "it('real', () => {}); // TODO: a real comment",
      ].join("\n") + "\n",
    });
    const r = run({ base: "main", cwd: work, files: [] });
    expect(r.fixed).toEqual([]);
    expect(r.findings).toEqual([expect.objectContaining({ id: "H7", line: 5 })]);
    expect(fs.readFileSync(path.join(work, "h.test.js"), "utf8")).toContain("describe.only('x'");
  });
});
