import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// #423 — `git ls-files --cached` still lists a tracked file that was deleted
// in the working tree but not staged; `git hash-object --stdin-paths` then
// failed on that one path and every card in the session read
// `Build no-build-id`. The script hashes what exists and folds the missing
// paths in by name, so the id stays readable AND still moves with the deletion.

const SCRIPT = path.join(__dirname, "build-id.js");
let repo;

const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const buildId = () => execFileSync("node", [SCRIPT], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "build-id-"));
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "a.js"), "export const a = 1;\n");
  fs.writeFileSync(path.join(repo, "src", "b.js"), "export const b = 2;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});

afterAll(() => {
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("build-id.js — a tracked file deleted in the working tree (#423)", () => {
  test("prints a 7-char id and exits 0 while a tracked file is deleted but unstaged; the id differs from the intact tree and returns once the file is back", () => {
    const intact = buildId();
    expect(intact).toMatch(/^[0-9a-f]{7}$/);
    expect(buildId()).toBe(intact);                                    // deterministic

    fs.unlinkSync(path.join(repo, "src", "b.js"));
    expect(git("ls-files", "--deleted").trim()).toBe("src/b.js");     // the failing precondition
    const deleted = buildId();                                         // no throw, no `no-build-id`
    expect(deleted).toMatch(/^[0-9a-f]{7}$/);
    expect(deleted).not.toBe(intact);                                  // the deletion is part of the build state

    git("checkout", "--", "src/b.js");
    expect(buildId()).toBe(intact);
  });

  test("a genuinely broken git call still exits 1 with the error prefix", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "build-id-nogit-"));
    try {
      execFileSync("node", [SCRIPT], { cwd: outside, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(outside) } });
      throw new Error("expected a non-zero exit");
    } catch (e) {
      expect(e.status).toBe(1);
      expect(String(e.stderr)).toContain("build-id error");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
