/**
 * @module git-sync-world
 * @description Test-only harness for the git-sync integration suites.
 *
 *   git-sync's defining bug was invisible to unit tests — it merged the LOCAL
 *   `main` ref and refreshed it with `git fetch origin main:main`, a command
 *   git refuses whenever main is checked out in some worktree. Nothing short of
 *   a real repository in that exact layout catches it, so every suite built on
 *   this harness runs against real git: a bare origin, a primary worktree
 *   parked on main, and feature work in a linked worktree.
 *
 *   The suites are split across several files on purpose. Each world costs two
 *   real clones, and one file holding all of them ran long enough that vitest's
 *   reporter RPC timed out mid-run ("Timeout calling onTaskUpdate") — reported
 *   as an error next to a fully green suite. Separate files land in separate
 *   workers and stay short enough for that not to happen.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

export const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "git-sync.js"
);

/** Every world this process created, for the suite's afterAll sweep. */
const worlds = [];

/**
 * Identity comes from the environment rather than three `git config` calls per
 * repository: a process spawn costs ~200ms on Windows and each test builds a
 * fresh world. gpg signing is off deliberately — the sync commits from a
 * detached, console-less child that cannot drive pinentry, so the machine's
 * global signing config would otherwise hang the test on nothing to do with
 * the script under test.
 */
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
};

export function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: GIT_ENV,
  }).trim();
}

/** Run git-sync.js the way the background spawner does. Returns its report or "". */
export function runSync(cwd, resultFile, envOverride = {}) {
  execFileSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...GIT_ENV, ...envOverride, DEVOPS_GIT_SYNC_RESULT_FILE: resultFile },
  });
  try {
    return fs.readFileSync(resultFile, "utf8");
  } catch {
    return "";
  }
}

export function write(repo, file, content) {
  fs.writeFileSync(path.join(repo, file), content, "utf8");
}

/** Read back a working-tree file, normalising the CRLF git checks out on Windows. */
export function read(repo, file) {
  return fs.readFileSync(path.join(repo, file), "utf8").replace(/\r\n/g, "\n");
}

export function commitAll(repo, message) {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", message, "--no-verify"]);
}

/** A scratch directory tracked for cleanup, for suites that build their own world. */
export function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-int-"));
  worlds.push(root);
  return root;
}

/**
 * origin (bare) ← primary (on main) + linked worktree on `feature`.
 * `other` is a second clone used to move origin/main behind everyone's back,
 * the way a merged PR does — it must not be primary, because advancing
 * primary's local main would destroy the very precondition under test.
 */
export function makeWorld() {
  const root = makeRoot();
  const originPath = path.join(root, "origin.git");
  git(root, ["init", "--bare", "--initial-branch=main", originPath]);

  const primary = path.join(root, "primary");
  git(root, ["clone", "--quiet", originPath, primary]);
  write(primary, "base.txt", "base\n");
  write(primary, "untouched.txt", "untouched\n");
  commitAll(primary, "base");
  git(primary, ["push", "--quiet", "origin", "main"]);

  // Linked worktree on a feature branch — primary STAYS on main.
  const wt = path.join(root, "wt");
  git(primary, ["worktree", "add", "--quiet", "-b", "feature", wt, "main"]);

  const other = path.join(root, "other");
  git(root, ["clone", "--quiet", originPath, other]);

  return { root, originPath, primary, wt, other };
}

/** Land a commit on origin/main, as a merged PR would. Expects `other` on main. */
export function advanceOrigin(other, file, content, message) {
  git(other, ["pull", "--quiet", "--ff-only", "origin", "main"]);
  write(other, file, content);
  commitAll(other, message);
  git(other, ["push", "--quiet", "origin", "main"]);
}

/** Register as the suite's afterAll. */
export function cleanupWorlds() {
  for (const dir of worlds) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch { /* Windows may still hold a handle — the temp dir is disposable */ }
  }
}
