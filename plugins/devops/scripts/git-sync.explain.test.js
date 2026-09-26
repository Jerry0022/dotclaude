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

  test("a caller deadline too close for a merge plus its recovery → skipped, nothing written", async () => {
    const { wt, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    const out = await runSyncExplain(wt, { DEVOPS_GIT_SYNC_DEADLINE_MS: String(Date.now() + 1000) });
    expect(out).toContain("skipped: the caller's time budget is nearly spent");
    expect(fs.existsSync(path.join(wt, "from-main.txt"))).toBe(false);
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

/**
 * AUD-C003 / AUD-017: a sync that never happened must not read as "=". Each of
 * these used to print "= origin/main already in feature" (or "= on main
 * itself") while the branch was behind.
 */
describe("--explain never reports '=' for a sync that did not run", () => {
  test("fetch fails with a stale tracking ref → skipped, stale ref named", async () => {
    const { root, wt, other } = await makeWorld();
    await git(wt, ["fetch", "--quiet", "origin"]);
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    await git(wt, ["remote", "set-url", "origin", path.join(root, "gone.git")]);
    const out = await runSyncExplain(wt);
    expect(out).toMatch(/skipped: fetch of main failed \(.+\) — stale ref/);
    expect(out).not.toContain("= origin/main");
  });

  test("fetch fails with no tracking ref → skipped, not 'no parent branch'", async () => {
    const { root, wt } = await makeWorld();
    await git(wt, ["update-ref", "-d", "refs/remotes/origin/main"]);
    await git(wt, ["remote", "set-url", "origin", path.join(root, "gone.git")]);
    const out = await runSyncExplain(wt);
    expect(out).toContain("– skipped: fetch of main failed");
    expect(out).not.toMatch(/\] = /);
  });

  test("on main behind its remote → skipped with the count", async () => {
    const { primary, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    const out = await runSyncExplain(primary);
    expect(out).toContain("– skipped: on main itself, 1 commit(s) behind origin/main");
  });

  test("on main and current → '=' stays", async () => {
    const { primary } = await makeWorld();
    const out = await runSyncExplain(primary);
    expect(out).toContain("[git-sync] = on main itself");
  });

  test("a failed behind-count probe → skipped, never '0 behind'", async () => {
    const { root, wt, other } = await makeWorld();
    await advanceOrigin(other, "from-main.txt", "main\n", "main moves");
    const shim = path.join(root, "shim-revlist.cjs");
    fs.writeFileSync(shim, `const cp = require('child_process'); const orig = cp.execFileSync;
cp.execFileSync = function (file, args) { if (file === 'git' && Array.isArray(args) && args[0] === 'rev-list') { const e = new Error('spawnSync git ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; } return orig.apply(this, arguments); };`);
    const { spawnSync } = await import("child_process");
    const { SCRIPT } = await import("./__fixtures__/git-sync-world.js");
    const r = spawnSync(process.execPath, ["-r", shim, SCRIPT, "--explain"], { cwd: wt, encoding: "utf8", windowsHide: true });
    expect(r.stdout).toContain("skipped: behind-count probe failed (timed out");
    expect(fs.existsSync(path.join(wt, "from-main.txt"))).toBe(false);
  });
});
