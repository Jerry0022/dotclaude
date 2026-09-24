import { describe, test, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  git,
  runSync,
  runSyncExplain,
  write,
  makeWorld,
  advanceOrigin,
  cleanupWorlds,
} from "./__fixtures__/git-sync-world.js";

/**
 * --explain is the do-batch merge's view of the sync. That caller waits for
 * the result and plans against it, so a guard that steps aside must never read
 * as "main is already in" — the background mode's silence would say exactly
 * that.
 */

afterAll(cleanupWorlds);

describe("--explain names every no-merge exit", () => {
  test("up to date → '=' line, nothing merged", async () => {
    const { wt } = await makeWorld();
    const out = await runSyncExplain(wt);
    expect(out).toContain("[git-sync] = origin/main already in feature");
    expect(out).not.toContain("skipped");
  });

  test("detached HEAD → skipped with the reason", async () => {
    const { wt, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    await git(wt, ["checkout", "--quiet", "--detach", "HEAD"]);
    const out = await runSyncExplain(wt);
    expect(out).toContain("– skipped: detached HEAD");
    expect(fs.existsSync(path.join(wt, "from-main.txt"))).toBe(false);
  });

  test("dirty overlap → skipped naming the file; background stays silent", async () => {
    const { root, wt, other } = await makeWorld();
    await advanceOrigin(other, "base.txt", "main edit\n", "main edits base.txt");
    write(wt, "base.txt", "work in progress\n");

    const out = await runSyncExplain(wt);
    expect(out).toContain("– origin/main → feature: skipped: uncommitted changes overlap");
    expect(out).toContain("base.txt");

    const resultFile = path.join(root, "result");
    expect(await runSync(wt, resultFile)).toBe("");
  });

  test("a real merge still reports ✓", async () => {
    const { wt, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    const out = await runSyncExplain(wt);
    expect(out).toContain("✓ origin/main → feature: 1 commit(s)");
    expect(fs.existsSync(path.join(wt, "from-main.txt"))).toBe(true);
  });
});
