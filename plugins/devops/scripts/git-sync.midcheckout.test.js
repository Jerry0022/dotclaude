import { describe, test, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  git,
  runSync,
  write,
  read,
  commitAll,
  makeWorld,
  cleanupWorlds,
} from "./__fixtures__/git-sync-world.js";

/**
 * A merge that dies mid-checkout must never leave the worktree half-merged.
 *
 * 2026-09-26, a loaded Windows machine: git-sync's 15 s budget killed a
 * fast-forward while it was writing the working tree. HEAD and index stayed on
 * the old commit, half the incoming files were on disk, one was unlinked on
 * the way to its rewrite, and a stale index.lock blocked every later git write
 * — reported as "merge refused, no conflicted files".
 *
 * A smudge filter routes one incoming file (c.slow) through a script, so the
 * checkout stops at that file by construction: `fail` makes git error out
 * there (its own mid-checkout failure), `block` holds git there until the
 * write timeout kills it. Files sorting before it (.gitattributes, base.txt)
 * are already written at that point.
 */

afterAll(cleanupWorlds);

const FILTER_JS = `
const fs = require("fs");
const [, , mode, marker, file] = process.argv;
const chunks = [];
process.stdin.on("data", c => chunks.push(c));
process.stdin.on("end", () => {
  const hit = /(^|\\/)c\\.slow$/.test(file || "");
  if (hit && mode === "fail") { process.stderr.write("refusing " + file + "\\n"); process.exit(3); }
  if (hit && mode === "block") {
    fs.writeFileSync(marker, "reached");
    // Bounded: the orphan this leaves after git is killed exits on its own.
    setTimeout(() => process.stdout.write(Buffer.concat(chunks)), 15000);
    return;
  }
  process.stdout.write(Buffer.concat(chunks));
});
`;

const quote = p => `"${p.replace(/\\/g, "/")}"`;

async function useFilter(w, mode) {
  const cmd = `${quote(process.execPath)} ${quote(w.filterJs)} ${mode} ${quote(w.marker)} %f`;
  await git(w.wt, ["config", "filter.slow.smudge", cmd]);
}

/** origin/main moves by one commit whose checkout passes through c.slow's filter. */
async function stage(mode) {
  const w = await makeWorld();
  await git(w.other, ["pull", "--quiet", "--ff-only", "origin", "main"]);
  write(w.other, ".gitattributes", "*.slow filter=slow\n");
  write(w.other, "base.txt", "base, from main\n");
  write(w.other, "c.slow", "slow content\n");
  write(w.other, "d.txt", "d\n");
  await commitAll(w.other, "main: attributes, base edit, a filtered file");
  await git(w.other, ["push", "--quiet", "origin", "main"]);

  const staged = { ...w, filterJs: path.join(w.root, "filter.js"), marker: path.join(w.root, "filter-reached") };
  fs.writeFileSync(staged.filterJs, FILTER_JS);
  await useFilter(staged, mode);
  await git(w.wt, ["config", "filter.slow.clean", `${quote(process.execPath)} ${quote(staged.filterJs)} pass ${quote(staged.marker)} %f`]);
  await git(w.wt, ["config", "filter.slow.required", "true"]);
  // The user's work in progress, outside the incoming change.
  write(w.wt, "untouched.txt", "work in progress\n");
  staged.preHead = await git(w.wt, ["rev-parse", "HEAD"]);
  return staged;
}

/** Not half-merged: preHead, no lock, nothing of the incoming commit on disk, the user's edit intact. */
async function expectNothingHalfApplied(w) {
  expect(await git(w.wt, ["rev-parse", "HEAD"])).toBe(w.preHead);
  expect(fs.existsSync(await git(w.wt, ["rev-parse", "--path-format=absolute", "--git-path", "index.lock"]))).toBe(false);
  const status = (await git(w.wt, ["status", "--porcelain", "--untracked-files=all"])).split("\n").map(l => l.trim()).filter(Boolean);
  expect(status).toEqual(["M untouched.txt"]);
  expect(read(w.wt, "base.txt")).toBe("base\n");
  expect(fs.existsSync(path.join(w.wt, ".gitattributes"))).toBe(false);
  expect(read(w.wt, "untouched.txt")).toBe("work in progress\n");
}

/** The put-back tree is a mergeable one: the next sync lands the commit. */
async function expectNextSyncLands(w) {
  await useFilter(w, "pass");
  const report = await runSync(w.wt, path.join(w.root, "result-retry"));
  expect(report).toContain("✓ origin/main → feature: 1 commit(s)");
  expect(read(w.wt, "base.txt")).toBe("base, from main\n");
  expect(read(w.wt, "c.slow")).toBe("slow content\n");
  expect(read(w.wt, "untouched.txt")).toBe("work in progress\n");
}

// Sequential on purpose (#424) — see git-sync.test.js. Each test builds a
// world and syncs twice, so it gets more than the default 60 s.
describe("a merge that dies mid-checkout is never left half-applied", () => {
  test("git's own failure mid-checkout: put back, git's reason reported, next sync lands", async () => {
    const w = await stage("fail");

    const report = await runSync(w.wt, path.join(w.root, "result"));

    expect(report).toContain("✗ origin/main → feature: merge failed (");
    expect(report).toContain(`mid-checkout — worktree restored to ${w.preHead.slice(0, 7)} (2 file(s)`);
    expect(report).toContain("the next sync retries");
    expect(report).not.toContain("merge refused");
    await expectNothingHalfApplied(w);
    await expectNextSyncLands(w);
  }, 180_000);

  test("killed by the write timeout: no half-applied tree, no stale lock, the timeout named", async () => {
    const w = await stage("block");

    const report = await runSync(w.wt, path.join(w.root, "result"), { DEVOPS_GIT_SYNC_WRITE_TIMEOUT_MS: "4000" });

    // The 55 s read budget (world env) does not bound the merge; the write one does.
    expect(report).toContain("✗ origin/main → feature: merge timed out after 4 s");
    expect(report).not.toContain("merge refused");
    if (fs.existsSync(w.marker)) {
      // The filter held git on c.slow: .gitattributes and base.txt were on disk.
      expect(report).toContain(`mid-checkout — worktree restored to ${w.preHead.slice(0, 7)} (2 file(s)`);
    } else {
      // A machine too loaded to reach the checkout within 4 s.
      expect(report).toContain("before it wrote anything");
    }
    await expectNothingHalfApplied(w);
    await expectNextSyncLands(w);
  }, 180_000);
});
