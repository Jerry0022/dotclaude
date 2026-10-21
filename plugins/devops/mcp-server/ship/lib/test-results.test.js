import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeCmd, treeKey, storePath, recordResult, findGreen, usualDurationMs, REUSE_TTL_MS, STORE_NAME,
} from "./test-results.js";

let dir;
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

beforeEach(() => {
  delete process.env.DEVOPS_TEST_RESULTS_FILE;
  dir = realpathSync(mkdtempSync(join(tmpdir(), "test-results-")));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("normalizeCmd", () => {
  test("npm test aliases and whitespace", () => {
    expect(normalizeCmd("npm test")).toBe("npm run test");
    expect(normalizeCmd("  npm   t ")).toBe("npm run test");
    expect(normalizeCmd("npm test -- --reporter=dot")).toBe("npm run test -- --reporter=dot");
    expect(normalizeCmd("npm run test")).toBe("npm run test");
    expect(normalizeCmd("npm run testing")).toBe("npm run testing");
  });
});

describe("treeKey", () => {
  test("clean tree → HEAD^{tree}", () => {
    expect(treeKey(dir)).toEqual({ treeHash: git("rev-parse", "HEAD^{tree}"), method: "head" });
  });

  test("dirty tree → index copy + add -A; real index untouched; equals the tree once committed", () => {
    writeFileSync(join(dir, "a.txt"), "two\n");
    writeFileSync(join(dir, "new.txt"), "untracked\n");
    const k = treeKey(dir);
    expect(k.method).toBe("worktree");
    expect(k.treeHash).not.toBe(git("rev-parse", "HEAD^{tree}"));
    expect(git("diff", "--cached", "--name-only")).toBe(""); // nothing staged in the real index
    git("add", "-A");
    git("commit", "-q", "-m", "c2");
    expect(treeKey(dir)).toEqual({ treeHash: k.treeHash, method: "head" });
  });

  test("an untracked file changes the key; an ignored one does not", () => {
    writeFileSync(join(dir, "a.txt"), "two\n");
    const base = treeKey(dir).treeHash;
    mkdirSync(join(dir, "ignored"));
    writeFileSync(join(dir, "ignored", "big.bin"), "zzz");
    expect(treeKey(dir).treeHash).toBe(base);
    writeFileSync(join(dir, "untracked.txt"), "x");
    expect(treeKey(dir).treeHash).not.toBe(base);
  });

  test("outside a git repo → null", () => {
    const plain = mkdtempSync(join(tmpdir(), "no-git-"));
    try { expect(treeKey(plain)).toBeNull(); } finally { rmSync(plain, { recursive: true, force: true }); }
  });
});

describe("store", () => {
  const T = "f".repeat(40);

  test("anchored at the git common dir, shared by linked worktrees", () => {
    const wt = join(dir, "..", `${dir.split(/[\\/]/).pop()}-wt`);
    git("worktree", "add", "-q", wt, "-b", "side");
    try {
      const main = storePath(dir);
      expect(main).toBe(join(dir, ".git", STORE_NAME));
      expect(storePath(wt)).toBe(main);
      recordResult(wt, { treeHash: T, testCmd: "npm test", passed: true, source: "agent" });
      expect(findGreen(dir, { treeHash: T, testCmd: "npm run test" })).toMatchObject({ treeHash: T, source: "agent" });
    } finally {
      git("worktree", "remove", "--force", wt);
    }
  });

  test("hit only on same tree + same command + green + fresh", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    recordResult(dir, { treeHash: T, testCmd: "npm run test", passed: true, now, durationMs: 1000 });
    expect(findGreen(dir, { treeHash: T, testCmd: "npm test", now })).toMatchObject({ passed: true });
    expect(findGreen(dir, { treeHash: "e".repeat(40), testCmd: "npm test", now })).toBeNull();
    expect(findGreen(dir, { treeHash: T, testCmd: "npx vitest run a.test.js", now })).toBeNull();
    expect(findGreen(dir, { treeHash: T, testCmd: "npm test", now: now + REUSE_TTL_MS + 1 })).toBeNull();
  });

  test("a scoped command never satisfies the reuse for the full suite", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    recordResult(dir, { treeHash: T, testCmd: "npx vitest related a.js --run", passed: true, now });
    expect(findGreen(dir, { treeHash: T, testCmd: "npm test", now })).toBeNull();
  });

  test("a red record replaces the green one for the same key", () => {
    recordResult(dir, { treeHash: T, testCmd: "npm test", passed: true });
    recordResult(dir, { treeHash: T, testCmd: "npm test", passed: false });
    expect(findGreen(dir, { treeHash: T, testCmd: "npm test" })).toBeNull();
  });

  test("usual duration = median of the last green durations", () => {
    expect(usualDurationMs(dir, "npm test")).toBeNull();
    for (const [i, ms] of [100, 900, 300].entries()) {
      recordResult(dir, { treeHash: String(i).repeat(40), testCmd: "npm test", passed: true, durationMs: ms });
    }
    expect(usualDurationMs(dir, "npm run test")).toBe(300);
  });

  test("a garbled store is treated as empty and rewritten", () => {
    writeFileSync(storePath(dir), "{not json");
    expect(findGreen(dir, { treeHash: T, testCmd: "npm test" })).toBeNull();
    expect(recordResult(dir, { treeHash: T, testCmd: "npm test", passed: true })).not.toBeNull();
    expect(JSON.parse(readFileSync(storePath(dir), "utf8")).records).toHaveLength(1);
  });

  test("env override wins", () => {
    const f = join(dir, "custom.json");
    process.env.DEVOPS_TEST_RESULTS_FILE = f;
    try {
      recordResult(dir, { treeHash: T, testCmd: "npm test", passed: true });
      expect(existsSync(f)).toBe(true);
    } finally {
      delete process.env.DEVOPS_TEST_RESULTS_FILE;
    }
  });
});
