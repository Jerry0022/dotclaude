import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseWorktreeList, foreignTokens, dropForeignOpenItems, foreignTokensFor, containsWord } from "./foreign-branches.js";

const PORCELAIN = [
  "worktree C:/repo",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree C:/repo/.claude/worktrees/card-fix-ab12cd",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/claude/card-fix-ab12cd",
  "",
  "worktree C:/repo/.claude/worktrees/readme-generator-278401",
  "HEAD 3333333333333333333333333333333333333333",
  "branch refs/heads/claude/readme-generator-278401",
  "",
].join("\n");

describe("foreignTokens", () => {
  const list = parseWorktreeList(PORCELAIN);

  test("names the other worktrees' branches, their tails and folders — not our own, not main", () => {
    const tokens = foreignTokens(list, "C:\\repo\\.claude\\worktrees\\card-fix-ab12cd");
    expect(tokens).toEqual(["claude/readme-generator-278401", "readme-generator-278401"]);
  });

  test("from the main checkout every session worktree is foreign", () => {
    const tokens = foreignTokens(list, "C:/repo");
    expect(tokens).toContain("claude/card-fix-ab12cd");
    expect(tokens).toContain("readme-generator-278401");
    expect(tokens).not.toContain("main");
  });
});

describe("dropForeignOpenItems", () => {
  const tokens = ["claude/readme-generator-278401", "readme-generator-278401"];

  test("drops the parallel branch's point, keeps this work's points", () => {
    const open = [
      { text: "Branch `claude/readme-generator-278401` ist noch nicht geshippt — shippen?", reply: "Ja, bitte shippen." },
      "Alte Config-Datei löschen?",
      { text: "Worktree readme-generator-278401 hat ungeshippte Commits", reply: "" },
    ];
    const r = dropForeignOpenItems(open, tokens);
    expect(r.dropped).toBe(2);
    expect(r.open).toEqual(["Alte Config-Datei löschen?"]);
  });

  test("a point naming it only in the prepared reply goes too", () => {
    const r = dropForeignOpenItems([{ text: "Parallelen Branch shippen?", reply: "Ja, claude/readme-generator-278401 shippen." }], tokens);
    expect(r.open).toEqual([]);
  });

  test("no tokens → the list is untouched", () => {
    const open = ["x"];
    expect(dropForeignOpenItems(open, [])).toEqual({ open, dropped: 0 });
  });
});

describe("foreignTokensFor (real git)", () => {
  let root;
  let repo;
  let wt;
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "foreign-branches-"));
    repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    wt = path.join(repo, ".claude", "worktrees", "parallel-work-93ae10");
    git(repo, "worktree", "add", "-q", "-b", "claude/parallel-work-93ae10", wt);
  });

  afterAll(() => {
    try { git(repo, "worktree", "remove", "--force", wt); } catch { /* best effort */ }
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("from the main checkout the sibling session's branch is foreign", () => {
    expect(foreignTokensFor(repo)).toContain("claude/parallel-work-93ae10");
  });

  test("inside that worktree its own branch is never foreign", () => {
    expect(foreignTokensFor(wt)).toEqual([]);
  });

  test("no repo → nothing to drop", () => {
    expect(foreignTokensFor(root)).toEqual([]);
    expect(foreignTokensFor("")).toEqual([]);
  });
});

// AUD-C016 / AUD-031: the tail of another branch ("generator-refactor") and
// short slash-less names ("beta", "docs") dropped unrelated points of THIS work.
describe("foreign matching — full names on word boundaries only", () => {
  const porcelain = [
    "worktree C:/repo", "branch refs/heads/main", "",
    "worktree C:/repo/.claude/worktrees/own-session-1", "branch refs/heads/claude/own-session-1", "",
    "worktree C:/repo/.claude/worktrees/x9", "branch refs/heads/feat/card-generator", "",
    "worktree C:/other/beta", "branch refs/heads/beta", "",
    "worktree C:/other/docs", "branch refs/heads/docs", "",
    "worktree C:/other/release-train", "branch refs/heads/release-train", "",
  ].join("\n");
  const tokens = foreignTokens(parseWorktreeList(porcelain), "C:/repo/.claude/worktrees/own-session-1");

  test("no tail tokens, no short slash-less names; long slash-less names stay", () => {
    expect(tokens).toContain("feat/card-generator");
    expect(tokens).not.toContain("card-generator");
    expect(tokens).not.toContain("beta");
    expect(tokens).not.toContain("docs");
    expect(tokens).toContain("release-train");
  });

  test("unrelated points that merely contain a tail or short name are kept", () => {
    const open = [
      "Der card-generator schreibt noch alte Zähler — anpassen?",
      "Beta-Tester informieren?",
      "Docs für die neue Option ergänzen?",
      "feat/card-generator-v2 ist ein anderer Branch",
    ];
    expect(dropForeignOpenItems(open, tokens)).toEqual({ open, dropped: 0 });
  });

  test("the full name still drops — with backticks, origin/ prefix or a closing period", () => {
    const open = [
      "Branch `feat/card-generator` noch nicht geshippt?",
      "origin/feat/card-generator ist hinterher",
      "Ship release-train.",
    ];
    expect(dropForeignOpenItems(open, tokens).dropped).toBe(3);
  });

  test("containsWord respects name boundaries", () => {
    expect(containsWord("see claude/foo now", "claude/foo")).toBe(true);
    expect(containsWord("see claude/foo-v2 now", "claude/foo")).toBe(false);
    expect(containsWord("see claude/foo.bar", "claude/foo")).toBe(false);
    expect(containsWord("xclaude/foo", "claude/foo")).toBe(false);
  });
});
