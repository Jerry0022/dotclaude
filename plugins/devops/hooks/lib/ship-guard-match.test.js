import { describe, test, expect } from "vitest";
import { isManualShipCommand, stripQuoted, maskQuotedToken, gitCommandRe, matchesGitCommand, WORD_END, remoteDeleteRefs } from "./ship-guard-match.js";

// Audit row 1: the git matcher behind pre.main.guard / pre.worktree.split-guard.
describe("matchesGitCommand — real git invocations at any command position", () => {
  const COMMIT = [gitCommandRe("commit" + WORD_END)];
  test.each([
    "git commit -m x",
    "git add -A && git commit -m x",
    "true | git commit -F -",
    "(git commit -m x)",
    "git -C /tmp/x commit",
    'git -C "a b" commit',
    "git -c a=b -c c=d commit",
    "git --git-dir=.git --work-tree . commit",
    "FOO=1 git commit",
    "git.exe commit",
  ])("%j matches", (cmd) => {
    expect(matchesGitCommand(cmd, COMMIT)).toBe(true);
  });
  test.each([
    'echo "git commit -m x"',
    "echo 'a && git commit'",
    "git log --grep 'git commit'",
    "git commit-tree abc",
    "mygit commit",
    "git status",
    "",
  ])("%j does not match", (cmd) => {
    expect(matchesGitCommand(cmd, COMMIT)).toBe(false);
  });
  test("non-string input", () => {
    expect(matchesGitCommand(undefined, COMMIT)).toBe(false);
  });
  test("maskQuotedToken keeps offsets and a quoted span as one token", () => {
    const s = 'git -C "a b" commit';
    expect(maskQuotedToken(s)).toHaveLength(s.length);
    expect(maskQuotedToken(s)).toBe("git -C _____ commit");
  });
});

// ---------------------------------------------------------------------------
// isManualShipCommand — real invocations match, quoted/prose text does not
// ---------------------------------------------------------------------------

describe("isManualShipCommand — real invocations", () => {
  test("gh pr create at start", () => {
    expect(isManualShipCommand('gh pr create --title x --body y')).toBe(true);
  });

  test("gh pr merge", () => {
    expect(isManualShipCommand('gh pr merge 5 --squash')).toBe(true);
  });

  test("gh api pulls merge", () => {
    expect(isManualShipCommand('gh api repos/o/r/pulls/5/merge -X PUT')).toBe(true);
  });

  test("chained after &&", () => {
    expect(isManualShipCommand('git push origin main && gh pr create --fill')).toBe(true);
  });

  test("chained after ;", () => {
    expect(isManualShipCommand('git push; gh pr merge 5')).toBe(true);
  });

  test("extra whitespace", () => {
    expect(isManualShipCommand('gh   pr   create')).toBe(true);
  });
});

describe("isManualShipCommand — no false positives (the #198 bonus defect)", () => {
  test("gh pr create inside a double-quoted issue body", () => {
    expect(isManualShipCommand(
      'gh issue create --title "[BUG]" --body "use gh pr create to ship"'
    )).toBe(false);
  });

  test("gh pr create inside a commit message", () => {
    expect(isManualShipCommand('git commit -m "docs: explain gh pr create"')).toBe(false);
  });

  test("gh pr create inside a PowerShell here-string", () => {
    const cmd = "git commit -m @'\nbody mentions gh pr create here\n'@";
    expect(isManualShipCommand(cmd)).toBe(false);
  });

  test("gh pr create inside a bash heredoc", () => {
    const cmd = "gh issue create --body-file - <<'EOF'\nrun gh pr create manually\nEOF";
    expect(isManualShipCommand(cmd)).toBe(false);
  });

  test("unrelated gh subcommands", () => {
    expect(isManualShipCommand('gh pr list')).toBe(false);
    expect(isManualShipCommand('gh pr view 5')).toBe(false);
  });

  test("plain git push is allowed", () => {
    expect(isManualShipCommand('git push origin feature')).toBe(false);
  });

  test("empty / non-string input", () => {
    expect(isManualShipCommand('')).toBe(false);
    expect(isManualShipCommand(undefined)).toBe(false);
    expect(isManualShipCommand(null)).toBe(false);
  });
});

describe("stripQuoted", () => {
  test("removes double-quoted spans", () => {
    expect(stripQuoted('a "b c" d')).not.toContain('b c');
  });
  test("removes single-quoted spans", () => {
    expect(stripQuoted("a 'b c' d")).not.toContain('b c');
  });
  test("keeps unquoted tokens", () => {
    expect(stripQuoted('gh pr create')).toContain('gh pr create');
  });
});

// #828: pure remote-branch deletes are allowed on main; anything else is not.
describe("remoteDeleteRefs", () => {
  test.each([
    ["git push origin --delete feat/x", ["feat/x"]],
    ["git push origin -d a b", ["a", "b"]],
    ["git push origin :feat/x", ["feat/x"]],
    ["git push origin :a :b", ["a", "b"]],
    ["git -C dir push origin --delete x", ["x"]],
    ['git push origin --delete "feat/x"', ["feat/x"]],
    ["git push origin --delete refs/heads/x", ["x"]],
    ["git push origin --delete main", ["main"]],
    ["git push origin --delete refs/heads/main", ["main"]],
    ["git push origin :main", ["main"]],
    ["git push origin --delete a && git push origin --delete b", ["a", "b"]],
  ])("%j -> %j", (cmd, refs) => {
    expect(remoteDeleteRefs(cmd)).toEqual(refs);
  });

  test.each([
    "git push",
    "git push origin",
    "git push origin main",
    "git push origin feat/x",
    "git push --mirror origin",
    "git push --all origin",
    "git push --prune origin --delete x",
    "git push --force origin --delete x",
    "git push -f origin :x",
    "git push origin --delete x main:main",
    "git push origin --delete foo && git push origin main",
    "git push origin --delete 'ma'in",
    "(git push origin --delete main)",
    "git push origin --delete $(echo main)",
    "git status",
    "",
  ])("%j -> null", (cmd) => {
    expect(remoteDeleteRefs(cmd)).toBeNull();
  });
});
