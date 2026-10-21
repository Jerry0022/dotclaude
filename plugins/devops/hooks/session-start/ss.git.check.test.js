import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "ss.git.check.js");
let root, work;

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}
function commit(name) {
  writeFileSync(join(work, name), name);
  git(["add", "."], work);
  git(["commit", "-qm", name], work);
}
function runHook() {
  const r = spawnSync(process.execPath, [HOOK], {
    cwd: work, encoding: "utf8", input: JSON.stringify({ cwd: work }),
    env: { ...process.env, DEVOPS_ALLOW_MAIN: "1", HOME: root, USERPROFILE: root },
  });
  return r.stdout || "";
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gitcheck-"));
  const bare = join(root, "origin.git");
  work = join(root, "work");
  git(["init", "-q", "--bare", "-b", "main", bare], root);
  git(["init", "-q", "-b", "main", work], root);
  git(["config", "user.email", "t@example.com"], work);
  git(["config", "user.name", "Test"], work);
  git(["remote", "add", "origin", bare], work);
  commit("a.txt");
  git(["push", "-q", "-u", "origin", "main"], work);
}, 60_000);

afterAll(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });

describe("ss.git.check unpushed scope (main checkout)", () => {
  test("commits on abandoned local branches do not count when main is in sync", () => {
    git(["checkout", "-q", "-b", "abandoned"], work);
    commit("x1"); commit("x2"); commit("x3");
    git(["checkout", "-q", "main"], work);
    const out = runHook();
    expect(out).not.toMatch(/unpushed commit/);
    expect(out).not.toMatch(/do-ship/);
  }, 60_000);

  test("unpushed commits on the current branch are still reported", () => {
    commit("m1");
    expect(runHook()).toMatch(/1 unpushed commit\(s\)/);
  }, 60_000);
});
