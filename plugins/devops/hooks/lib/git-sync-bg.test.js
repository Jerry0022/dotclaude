import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  keyFor,
  throttleFile,
  resultFile,
  claimSyncSlot,
  classify,
  renderContext,
  takeResult,
  startBackgroundSync,
} from "./git-sync-bg.js";

let tmpdir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-bg-test-"));
});

afterEach(() => {
  try { fs.rmSync(tmpdir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("keyFor — worktree-scoped, not session-scoped", () => {
  test("same path → same key", () => {
    expect(keyFor("C:/repo/wt")).toBe(keyFor("C:/repo/wt"));
  });

  test("different worktrees → different keys", () => {
    expect(keyFor("C:/repo/a")).not.toBe(keyFor("C:/repo/b"));
  });

  test("case-insensitive — Windows hands the same path in both casings", () => {
    expect(keyFor("C:/Repo/WT")).toBe(keyFor("c:/repo/wt"));
  });

  test("throttle and result files are distinct for the same worktree", () => {
    expect(throttleFile("C:/repo", tmpdir)).not.toBe(resultFile("C:/repo", tmpdir));
  });
});

describe("claimSyncSlot — one sync per worktree per window", () => {
  test("first call claims", () => {
    expect(claimSyncSlot("C:/repo", { tmpdir })).toBe(true);
  });

  test("second call inside the window is refused", () => {
    claimSyncSlot("C:/repo", { tmpdir });
    expect(claimSyncSlot("C:/repo", { tmpdir })).toBe(false);
  });

  test("a second session on the SAME worktree does not double-sync", () => {
    // SessionStart of session A, then SessionStart of session B moments later.
    expect(claimSyncSlot("C:/repo", { tmpdir })).toBe(true);
    expect(claimSyncSlot("C:/repo", { tmpdir })).toBe(false);
  });

  test("a different worktree has its own slot", () => {
    claimSyncSlot("C:/repo/a", { tmpdir });
    expect(claimSyncSlot("C:/repo/b", { tmpdir })).toBe(true);
  });

  // The marker's mtime is real wall-clock (writeFileSync), so these drive the
  // comparison by moving `now` forward from the actual write time.
  test("claims again once the window has passed", () => {
    claimSyncSlot("C:/repo", { tmpdir });
    const later = Date.now() + 31 * 60 * 1000;
    expect(claimSyncSlot("C:/repo", { tmpdir, now: later })).toBe(true);
  });

  test("still refused one minute before the window closes", () => {
    claimSyncSlot("C:/repo", { tmpdir });
    const almost = Date.now() + 29 * 60 * 1000;
    expect(claimSyncSlot("C:/repo", { tmpdir, now: almost })).toBe(false);
  });

  test("a shorter throttle can be requested explicitly", () => {
    claimSyncSlot("C:/repo", { tmpdir });
    const soon = Date.now() + 2 * 60 * 1000;
    expect(claimSyncSlot("C:/repo", { tmpdir, now: soon, throttleMs: 60 * 1000 })).toBe(true);
  });

  test("peek reports the window without consuming the slot", () => {
    expect(claimSyncSlot("C:/repo", { tmpdir, peek: true })).toBe(true);
    // Peeking must not have written a marker — a real claim still succeeds.
    expect(claimSyncSlot("C:/repo", { tmpdir })).toBe(true);
  });

  test("peek reports a closed window as closed", () => {
    claimSyncSlot("C:/repo", { tmpdir });
    expect(claimSyncSlot("C:/repo", { tmpdir, peek: true })).toBe(false);
  });
});

describe("classify — silence is the default", () => {
  test("empty output → nothing to surface", () => {
    expect(classify("")).toBeNull();
    expect(classify("   \n ")).toBeNull();
    expect(classify(null)).toBeNull();
    expect(classify(undefined)).toBeNull();
  });

  test("✓ line → synced", () => {
    const r = classify("[git-sync] ✓ main → feat/x: 3 commit(s)\n");
    expect(r.kind).toBe("synced");
    expect(r.text).toContain("3 commit(s)");
  });

  test("⚠ line → conflict", () => {
    const r = classify("[git-sync] ⚠ main → feat/x: 2 file(s) with ambiguous conflicts");
    expect(r.kind).toBe("conflict");
  });

  test("✗ line → error", () => {
    expect(classify("[git-sync] ✗ main → feat/x: merge failed").kind).toBe("error");
  });

  test("conflict wins over a clean merge in the same run", () => {
    // git-sync joins per-parent messages with ' | ' — a ⚠ anywhere must dominate.
    const r = classify("[git-sync] ✓ main → feat: 1 commit(s) | ⚠ feat → feat/x: 1 file(s)");
    expect(r.kind).toBe("conflict");
  });

  test("unrecognised output is not surfaced", () => {
    expect(classify("some unrelated stdout noise")).toBeNull();
  });
});

describe("renderContext — asymmetric by severity", () => {
  test("a clean sync is informational and explicitly non-actionable", () => {
    const out = renderContext(classify("[git-sync] ✓ main → feat/x: 3 commit(s)")).join("\n");
    expect(out).toContain("3 commit(s)");
    expect(out).toContain("informational only");
    expect(out).not.toContain("Resolve them now");
  });

  test("a conflict carries the full resolution procedure", () => {
    const out = renderContext(classify("[git-sync] ⚠ main → feat/x: 2 file(s)")).join("\n");
    expect(out).toContain("Resolve them now");
    expect(out).toContain("merge-safety.md");
    expect(out).toContain("git commit --no-edit");
    expect(out).toContain("AskUserQuestion");
  });

  test("an error is reported, not silently retried", () => {
    const out = renderContext(classify("[git-sync] ✗ merge failed")).join("\n");
    expect(out).toContain("do not retry silently");
  });

  test("null result renders nothing", () => {
    expect(renderContext(null)).toEqual([]);
  });
});

describe("takeResult — one-shot delivery", () => {
  test("no result file → null", () => {
    expect(takeResult("C:/repo", { tmpdir })).toBeNull();
  });

  test("reads and consumes the file", () => {
    fs.writeFileSync(resultFile("C:/repo", tmpdir), "[git-sync] ✓ main → feat: 2 commit(s)\n");
    expect(takeResult("C:/repo", { tmpdir }).kind).toBe("synced");
    // Consumed — the same result must never be delivered twice.
    expect(takeResult("C:/repo", { tmpdir })).toBeNull();
  });

  test("a result for another worktree is not picked up", () => {
    fs.writeFileSync(resultFile("C:/repo/a", tmpdir), "[git-sync] ✓ main → feat: 1 commit(s)\n");
    expect(takeResult("C:/repo/b", { tmpdir })).toBeNull();
  });
});

describe("startBackgroundSync — detached, never blocking", () => {
  test("spawns detached with the result file in the env and unrefs the child", () => {
    let seen = null;
    let unreffed = false;
    const fakeSpawn = (cmd, args, opts) => {
      seen = { cmd, args, opts };
      return { unref: () => { unreffed = true; } };
    };

    expect(startBackgroundSync("C:/repo", { tmpdir, spawn: fakeSpawn, scriptPath: "/x/git-sync.js" })).toBe(true);
    expect(seen.opts.detached).toBe(true);
    expect(seen.opts.stdio).toBe("ignore");
    expect(seen.opts.cwd).toBe("C:/repo");
    expect(seen.args).toEqual(["/x/git-sync.js"]);
    expect(seen.opts.env.DEVOPS_GIT_SYNC_RESULT_FILE).toBe(resultFile("C:/repo", tmpdir));
    expect(unreffed).toBe(true);
  });

  test("clears a stale result before spawning — the fresh sync is authoritative", () => {
    const stale = resultFile("C:/repo", tmpdir);
    fs.writeFileSync(stale, "[git-sync] ✓ old run\n");
    startBackgroundSync("C:/repo", { tmpdir, spawn: () => ({ unref() {} }), scriptPath: "/x.js" });
    expect(fs.existsSync(stale)).toBe(false);
  });

  test("a spawn failure is swallowed — a hook must never break on it", () => {
    const boom = () => { throw new Error("ENOENT"); };
    expect(startBackgroundSync("C:/repo", { tmpdir, spawn: boom, scriptPath: "/x.js" })).toBe(false);
  });
});
