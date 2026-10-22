import { describe, test, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import {
  git,
  runSync,
  runSyncExplain,
  write,
  read,
  commitAll,
  makeRoot,
  makeWorld,
  advanceOrigin,
  cleanupWorlds,
} from "./__fixtures__/git-sync-world.js";

const require = createRequire(import.meta.url);
const sentinel = require("../hooks/lib/ship-sentinel");

/**
 * #802: on the default branch itself git-sync fast-forwards to its remote —
 * never a merge commit on main, and never past unpushed local commits.
 */

afterAll(cleanupWorlds);

// Sequential on purpose (#424): real clones per test, see git-sync.test.js.
describe("sync on the default branch (#802)", () => {
  test("a main behind its remote is fast-forwarded and reported", async () => {
    const { root, primary, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");

    const report = await runSync(primary, path.join(root, "result"));

    expect(report).toContain("✓ origin/main → main: 1 commit(s)");
    expect(fs.existsSync(path.join(primary, "from-main.txt"))).toBe(true);
    expect(await git(primary, ["rev-parse", "HEAD"])).toBe(await git(primary, ["rev-parse", "origin/main"]));
    // A fast-forward: no merge commit on main.
    expect(await git(primary, ["rev-list", "--merges", "--count", "HEAD"])).toBe("0");
  });

  test("an up-to-date main stays silent", async () => {
    const { root, primary } = await makeWorld();
    const resultFile = path.join(root, "result");
    expect(await runSync(primary, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
  });

  test("a diverged main is never merged; --explain names the unpushed commits", async () => {
    const { primary, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    write(primary, "local.txt", "local\n");
    await commitAll(primary, "local, unpushed");
    const head = await git(primary, ["rev-parse", "HEAD"]);

    const out = await runSyncExplain(primary);

    expect(out).toContain("– origin/main → main: skipped: main has 1 unpushed local commit(s) — not merging");
    expect(await git(primary, ["rev-parse", "HEAD"])).toBe(head);
    expect(fs.existsSync(path.join(primary, "from-main.txt"))).toBe(false);
  });

  test("a diverged main stays silent without --explain", async () => {
    const { root, primary, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    write(primary, "local.txt", "local\n");
    await commitAll(primary, "local, unpushed");

    const resultFile = path.join(root, "result");
    expect(await runSync(primary, resultFile)).toBe("");
    expect(fs.existsSync(resultFile)).toBe(false);
  });

  test("a dirty file that overlaps the incoming change blocks the fast-forward", async () => {
    const { root, primary, other } = await makeWorld();
    await advanceOrigin(other, "base.txt", "base, edited upstream\n", "main edits base.txt");
    write(primary, "base.txt", "base, edited locally\n");

    expect(await runSync(primary, path.join(root, "result"))).toBe("");
    expect(read(primary, "base.txt")).toBe("base, edited locally\n");
    expect(await git(primary, ["rev-list", "--count", "HEAD..origin/main"])).toBe("1");
  });

  test("a /do-ship run in flight blocks the sync", async () => {
    const { root, primary, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    sentinel.write(primary);
    const head = await git(primary, ["rev-parse", "HEAD"]);

    const out = await runSyncExplain(primary);

    expect(out).toContain("– skipped: a /do-ship run owns this worktree");
    expect(await git(primary, ["rev-parse", "HEAD"])).toBe(head);
    sentinel.clear(primary);
    expect(await runSync(primary, path.join(root, "result"))).toContain("✓ origin/main → main: 1 commit(s)");
  });

  test("a master default branch is fast-forwarded too", async () => {
    const root = makeRoot();
    const originPath = path.join(root, "origin.git");
    await git(root, ["init", "--bare", "--initial-branch=master", originPath]);
    const primary = path.join(root, "primary");
    await git(root, ["clone", "--quiet", originPath, primary]);
    write(primary, "base.txt", "base\n");
    await commitAll(primary, "base");
    await git(primary, ["push", "--quiet", "origin", "master"]);
    const other = path.join(root, "other");
    await git(root, ["clone", "--quiet", originPath, other]);
    write(other, "from-master.txt", "master\n");
    await commitAll(other, "master moves");
    await git(other, ["push", "--quiet", "origin", "master"]);

    const report = await runSync(primary, path.join(root, "result"));

    expect(report).toContain("✓ origin/master → master: 1 commit(s)");
    expect(fs.existsSync(path.join(primary, "from-master.txt"))).toBe(true);
  });
});
