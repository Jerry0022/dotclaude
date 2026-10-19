import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync, existsSync, readFileSync, utimesSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { main, mainCheckoutOf, candidates, rememberWorktreeHandling } = require("./post.worktree.enter.js");
const CFG = require("../lib/devops-config.js");
const RC = require("../lib/run-contract-store.js");

const SID = "sess-move";
let root, mainDir, wtDir;

function git(args, cwd) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "wtenter-")));
  mainDir = join(root, "main");
  mkdirSync(mainDir);
  git(["init", "-q", "-b", "main", "."], mainDir);
  git(["config", "user.email", "t@example.com"], mainDir);
  git(["config", "user.name", "Test"], mainDir);
  writeFileSync(join(mainDir, "a.txt"), "one\n");
  git(["add", "."], mainDir);
  git(["commit", "-qm", "c1"], mainDir);
  wtDir = join(mainDir, ".claude", "worktrees", "topic-ab12");
  git(["worktree", "add", "-q", "-b", "worktree-topic-ab12", wtDir], mainDir);
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

const hookFor = (extra = {}) => ({
  tool_name: "EnterWorktree",
  session_id: SID,
  cwd: wtDir,
  tool_input: { name: "topic-ab12" },
  tool_response: { worktreePath: wtDir },
  ...extra,
});

describe("mainCheckoutOf / candidates", () => {
  test("resolves the main checkout from a linked worktree's .git file", () => {
    expect(realpathSync.native(mainCheckoutOf(wtDir))).toBe(mainDir);
    expect(mainCheckoutOf(mainDir)).toBeNull();
  });

  test("finds a worktree path inside a string response", () => {
    const c = candidates({ tool_response: `Created worktree at ${wtDir} on branch worktree-topic-ab12.` });
    expect(c.some((p) => p.replace(/\\/g, "/") === wtDir.replace(/\\/g, "/"))).toBe(true);
  });
});

describe("post.worktree.enter carries the run contract", () => {
  test("this session's live contract moves into the worktree, with its events and root", () => {
    RC.arm(mainDir, { mode: "backlog", sessionId: SID });
    RC.record(mainDir, { k: "park", item: "2", reason: "a.txt-marker" });
    expect(RC.readRawContract(mainDir)).toBeTruthy();

    const reply = main(hookFor());
    expect(reply && reply.context).toContain("do-run contract moved");
    expect(RC.readRawContract(mainDir)).toBeNull();
    const h = RC.readRawContract(wtDir);
    expect(h.sessionId).toBe(SID);
    expect(h.mode).toBe("backlog");
    expect(realpathSync.native(h.root)).toBe(realpathSync.native(wtDir));
    expect(existsSync(RC.eventsPath(wtDir))).toBe(true);
    expect(readFileSync(RC.eventsPath(wtDir), "utf8")).toContain("a.txt-marker");
    expect(existsSync(RC.eventsPath(mainDir))).toBe(false);
    // The readers find it in the new root for this session.
    expect(RC.readContract(wtDir, { sessionId: SID })).toBeTruthy();
  });

  test("another session's contract in the shared checkout stays where it is", () => {
    RC.arm(mainDir, { mode: "prompt", sessionId: "someone-else" });
    expect(main(hookFor())).toBeNull();
    expect(RC.readRawContract(mainDir).sessionId).toBe("someone-else");
    expect(RC.readRawContract(wtDir)).toBeNull();
  });

  test("an id-less contract is never taken (it may be another session's), but the session is told to re-arm", () => {
    RC.arm(mainDir, { mode: "prompt" });
    const reply = main(hookFor());
    expect(reply && reply.context).toContain("without a session id stayed in the main checkout");
    expect(reply.context).toContain(" arm --mode");
    expect(RC.readRawContract(mainDir)).toBeTruthy();
    expect(RC.readRawContract(wtDir)).toBeNull();
  });

  test("a held contract lock means no move (no events lost to a racing record)", () => {
    RC.arm(mainDir, { mode: "backlog", sessionId: SID });
    const lock = `${RC.contractPath(mainDir)}.lock`;
    writeFileSync(lock, "someone-else");
    // Fresh for the whole wait, so the stale-lock takeover cannot kick in.
    const future = new Date(Date.now() + 60_000);
    utimesSync(lock, future, future);
    try {
      const t0 = Date.now();
      expect(RC.carryOver(mainDir, wtDir, SID)).toBeNull();
      expect(Date.now() - t0).toBeLessThan(15_000);
      expect(RC.readRawContract(mainDir).sessionId).toBe(SID);
      expect(RC.readRawContract(wtDir)).toBeNull();
    } finally {
      rmSync(lock, { force: true });
    }
  }, 30_000);

  test("a closed contract stays", () => {
    RC.arm(mainDir, { mode: "prompt", sessionId: SID });
    RC.close(mainDir, "done");
    expect(main(hookFor())).toBeNull();
    expect(RC.readRawContract(wtDir)).toBeNull();
  });

  test("a live contract already in the worktree is not overwritten", () => {
    RC.arm(wtDir, { mode: "audit", sessionId: SID });
    RC.arm(mainDir, { mode: "backlog", sessionId: SID });
    expect(main(hookFor())).toBeNull();
    expect(RC.readRawContract(wtDir).mode).toBe("audit");
    expect(RC.readRawContract(mainDir).mode).toBe("backlog");
  });

  test("this session's pending arm marker moves too", () => {
    RC.markPendingArm(mainDir, { sessionId: SID });
    main(hookFor());
    expect(RC.pendingArm(wtDir, { sessionId: SID })).toBeTruthy();
    expect(existsSync(RC.pendingPath(mainDir))).toBe(false);
  });

  test("no session id, another tool, or no linked worktree → nothing happens", () => {
    RC.arm(mainDir, { mode: "backlog", sessionId: SID });
    expect(main(hookFor({ session_id: undefined }))).toBeNull();
    expect(main(hookFor({ tool_name: "Bash" }))).toBeNull();
    expect(main(hookFor({ cwd: mainDir, tool_response: {}, tool_input: {} }))).toBeNull();
    expect(RC.readRawContract(mainDir).mode).toBe("backlog");
  });

  test("runs as a process and fails open on garbage stdin", () => {
    const hook = join(HERE, "post.worktree.enter.js");
    for (const input of ["", "null", "{bad", "[]"]) {
      const r = spawnSync(process.execPath, [hook], { input, encoding: "utf8", timeout: 20_000 });
      expect(r.status, input).toBe(0);
      expect(r.stdout, input).toBe("");
    }
    RC.arm(mainDir, { mode: "backlog", sessionId: SID });
    const r = spawnSync(process.execPath, [hook], { input: JSON.stringify(hookFor()), encoding: "utf8", timeout: 20_000 });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain("do-run contract moved");
  });
});

describe("post.worktree.enter settles the project's workspace handling", () => {
  let home;
  beforeEach(() => { home = realpathSync.native(mkdtempSync(join(tmpdir(), "wtenter-home-"))); });
  afterEach(() => { try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ } });

  test("the first worktree entry stores workspace.ownWorktree for the project", () => {
    expect(CFG.load(wtDir, { home }).values.workspace.ownWorktree).toBe(false);
    expect(rememberWorktreeHandling(wtDir, { home })).toBe(true);
    const cfg = CFG.load(mainDir, { home });
    expect(cfg.values.workspace.ownWorktree).toBe(true);
    expect(cfg.sources["workspace.ownWorktree"]).toBe("project");
    expect(existsSync(join(mainDir, ".claude", "devops-config.json"))).toBe(true);
  });

  test("an already decided value (project or global) is not rewritten", () => {
    rememberWorktreeHandling(wtDir, { home });
    expect(rememberWorktreeHandling(wtDir, { home })).toBe(false);
    CFG.setValue("workspace.ownWorktree", true, "global", wtDir, { home });
    const other = join(root, "other");
    mkdirSync(other);
    expect(rememberWorktreeHandling(other, { home })).toBe(false);
  });
});
