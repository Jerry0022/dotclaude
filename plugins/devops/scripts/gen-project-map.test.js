/**
 * gen-project-map — stable project name in the map header (issue #303).
 *
 * The header used to be `basename(projectRoot)`, so regenerating the map from a
 * harness worktree (`.claude/worktrees/<random-slug>/`) stamped the slug into the
 * committed `.claude/project-map.md`. These tests build throw-away git repos under
 * os.tmpdir() and run the real script against them — no network, no repo mutation.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Spawns real `git` + `node` processes; see gen-readme-sections.test.js for why
// the default 5 s is too tight under a full parallel suite run.
vi.setConfig({ testTimeout: 30_000 });

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "gen-project-map.js");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Minimal repo with one tracked file (the script exits 1 on an empty tree). */
function makeRepo(root) {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "init");
}

function headerOf(root) {
  execFileSync(process.execPath, [SCRIPT, root], { stdio: ["ignore", "pipe", "pipe"] });
  const map = readFileSync(join(root, ".claude", "project-map.md"), "utf8");
  const line = map.split("\n").find((l) => l.startsWith("# Project Map — "));
  expect(line, "map header line missing").toBeTruthy();
  return line.slice("# Project Map — ".length);
}

describe("gen-project-map header name (issue #303)", () => {
  let base;
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "gen-project-map-"));
  });
  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("prefers package.json name over the directory name", () => {
    const root = join(base, "dir-name-is-not-the-project");
    makeRepo(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "acme-app" }));
    expect(headerOf(root)).toBe("acme-app");
  });

  it("uses the main checkout's directory name, not the worktree slug, when there is no package.json", () => {
    const main = join(base, "my-project");
    makeRepo(main);
    const wt = join(main, ".claude", "worktrees", "devops-extensions-review-7524ba");
    mkdirSync(dirname(wt), { recursive: true });
    git(main, "worktree", "add", "-q", "-b", "claude/session-x", wt);

    expect(headerOf(wt)).toBe("my-project");
    // And it is identical to what the main checkout produces — no per-worktree churn.
    expect(headerOf(main)).toBe("my-project");
  });

  it("finds package.json in the main checkout even when the worktree lacks it", () => {
    const main = join(base, "scoped-main");
    makeRepo(main);
    writeFileSync(join(main, "package.json"), JSON.stringify({ name: "@acme/web" }));
    git(main, "add", "package.json");
    git(main, "commit", "-q", "-m", "pkg");
    const wt = join(main, ".claude", "worktrees", "slug-1234ab");
    mkdirSync(dirname(wt), { recursive: true });
    git(main, "worktree", "add", "-q", "--detach", wt);
    // The worktree checkout carries package.json too (tracked), but remove it
    // to prove the main-checkout lookup is what answers.
    rmSync(join(wt, "package.json"));
    expect(headerOf(wt)).toBe("@acme/web");
  });

  it("falls back to the plain directory name for a repo without package.json", () => {
    const root = join(base, "plain-repo");
    makeRepo(root);
    expect(headerOf(root)).toBe(basename(root));
  });
});
