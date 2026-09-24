import { describe, test, expect } from "vitest";
import { isRawIssueWriteCommand, hasSetupIssueMarker, isMcpIssueWriteTool } from "./issue-guard-match.js";

describe("isRawIssueWriteCommand — real invocations", () => {
  test("gh issue create at start", () => {
    expect(isRawIssueWriteCommand('gh issue create --title x --body y')).toBe(true);
  });

  test("gh issue edit", () => {
    expect(isRawIssueWriteCommand('gh issue edit 42 --add-label bug')).toBe(true);
  });

  test("chained after &&", () => {
    expect(isRawIssueWriteCommand('echo hi && gh issue create --title x')).toBe(true);
  });

  test("chained after ;", () => {
    expect(isRawIssueWriteCommand('echo hi; gh issue edit 3 --title y')).toBe(true);
  });

  test("extra whitespace", () => {
    expect(isRawIssueWriteCommand('gh   issue   create')).toBe(true);
  });
});

describe("isRawIssueWriteCommand — no false positives", () => {
  test("a second, quoted mention inside the body does not change the verdict", () => {
    // The command itself IS a real invocation — the quoted body text merely
    // must not be double-counted or otherwise confuse the matcher.
    expect(isRawIssueWriteCommand(
      'gh issue create --title "[DOC]" --body "explain gh issue create usage"'
    )).toBe(true);
  });

  test("gh issue create appearing ONLY inside a quoted string → not a real invocation", () => {
    expect(isRawIssueWriteCommand(
      'echo "reminder: never run gh issue create manually"'
    )).toBe(false);
  });

  test("gh issue create inside a commit message", () => {
    expect(isRawIssueWriteCommand('git commit -m "docs: explain gh issue create"')).toBe(false);
  });

  test("gh issue create inside a bash heredoc", () => {
    const cmd = "cat <<'EOF'\nrun gh issue create manually\nEOF";
    expect(isRawIssueWriteCommand(cmd)).toBe(false);
  });

  test("unrelated gh issue subcommands", () => {
    expect(isRawIssueWriteCommand('gh issue list')).toBe(false);
    expect(isRawIssueWriteCommand('gh issue view 5')).toBe(false);
  });

  test("grep for the phrase does not match", () => {
    expect(isRawIssueWriteCommand('grep -r "gh issue create" .')).toBe(false);
  });

  test("empty / non-string input", () => {
    expect(isRawIssueWriteCommand('')).toBe(false);
    expect(isRawIssueWriteCommand(undefined)).toBe(false);
    expect(isRawIssueWriteCommand(null)).toBe(false);
  });
});

describe("hasSetupIssueMarker", () => {
  test("marker present outside quotes → true", () => {
    expect(hasSetupIssueMarker('gh issue create --title x --body y # via setup-issue')).toBe(true);
  });

  test("marker with extra spacing → true", () => {
    expect(hasSetupIssueMarker('gh issue create --title x  #   via   setup-issue')).toBe(true);
  });

  test("no marker → false", () => {
    expect(hasSetupIssueMarker('gh issue create --title x --body y')).toBe(false);
  });

  test("marker only inside a quoted body does not count", () => {
    expect(hasSetupIssueMarker(
      'gh issue create --title x --body "mentions # via setup-issue in prose"'
    )).toBe(false);
  });
});

describe("isRawIssueWriteCommand — bypass shapes (R7)", () => {
  test.each([
    ["gh global -R flag before issue", "gh -R owner/repo issue create --title x"],
    ["gh --repo= flag", "gh --repo=owner/repo issue edit 3 --title y"],
    ["quoted -R value", 'gh -R "owner/repo" issue create --title x'],
    ["-R flag between issue and create", "gh issue -R owner/repo create --title x"],
    ["env assignment prefix", "GH_REPO=owner/repo gh issue create --title x"],
    ["env command prefix", "env GH_TOKEN=abc gh issue create --title x"],
    ["command prefix", "command gh issue edit 4 --body y"],
    ["absolute path to the binary", "/usr/local/bin/gh issue create --title x"],
    ["Windows gh.exe", "gh.exe issue create --title x"],
    ["PowerShell call operator", "& gh issue create --title x"],
    ["PowerShell env line before", "$env:GH_REPO = 'a/b'; gh issue create --title x"],
    ["command substitution", "url=$(gh issue create --title x)"],
    ["backtick substitution", "url=`gh issue create --title x`"],
    ["after a newline", "echo start\ngh issue create --title x"],
  ])("%s → real write", (_name, cmd) => {
    expect(isRawIssueWriteCommand(cmd)).toBe(true);
  });

  test("gh pr create with an unquoted word 'issue' later is not an issue write", () => {
    expect(isRawIssueWriteCommand("gh pr create --fill")).toBe(false);
    expect(isRawIssueWriteCommand("gh search issues create")).toBe(false);
  });
});

describe("hasSetupIssueMarker — same-segment rule (R7)", () => {
  test("marker on another line does not cover the gh call", () => {
    expect(hasSetupIssueMarker("gh issue create --title x\necho done # via setup-issue")).toBe(false);
  });

  test("marker after a later separator does not cover the gh call", () => {
    expect(hasSetupIssueMarker("gh issue create --title x; echo ok # via setup-issue")).toBe(false);
    expect(hasSetupIssueMarker("gh issue create --title x && echo ok # via setup-issue")).toBe(false);
  });

  test("every write needs its own marker", () => {
    const one = "gh issue create --title a # via setup-issue\ngh issue edit 2 --title b";
    expect(hasSetupIssueMarker(one)).toBe(false);
    const both = "gh issue create --title a # via setup-issue\ngh issue edit 2 --title b  # via setup-issue";
    expect(hasSetupIssueMarker(both)).toBe(true);
  });

  test("setup-issue's own documented forms pass", () => {
    expect(hasSetupIssueMarker('gh issue create --repo "a/b" --title "[BUG] x" --body "y" --label "type:bug"  # via setup-issue')).toBe(true);
    expect(hasSetupIssueMarker('gh issue edit 12 --body-file "/tmp/body.md"  # via setup-issue — add --repo when set')).toBe(true);
  });

  test("no write at all → false", () => {
    expect(hasSetupIssueMarker("echo hi # via setup-issue")).toBe(false);
  });
});

describe("multi-line bodies — heredoc forms (setup-issue rule)", () => {
  test('--body "$(cat <<\'EOF\' … EOF\\n)"  # via setup-issue counts as marked', () => {
    const cmd =
      'gh issue create --title "[BUG] x" --body "$(cat <<\'EOF\'\n' +
      "## Problem\n\nSomething breaks.\n\n**User value:** fewer crashes\n" +
      'EOF\n)"  # via setup-issue';
    expect(isRawIssueWriteCommand(cmd)).toBe(true);
    expect(hasSetupIssueMarker(cmd)).toBe(true);
  });

  test("SKILL.md's documented form (flags after the substitution) counts as marked", () => {
    const cmd =
      'gh issue create --title "[TYPE] Title" --body "$(cat <<\'EOF\'\nDescription\n\n**User value:** x\nEOF\n)" --label "type:X"  # via setup-issue';
    expect(hasSetupIssueMarker(cmd)).toBe(true);
  });

  test("--body-file - <<'EOF'  # via setup-issue is UNMARKED (documents the self-block)", () => {
    // The marker trails the heredoc opener, but the body lines follow on new
    // lines and end the gh segment; the write reads as unmarked. setup-issue
    // therefore never pipes the body on stdin via a heredoc.
    const cmd =
      "gh issue create --title \"[BUG] x\" --body-file - <<'EOF'  # via setup-issue\n" +
      "## Problem\n\n**User value:** fewer crashes\nEOF";
    expect(isRawIssueWriteCommand(cmd)).toBe(true);
    expect(hasSetupIssueMarker(cmd)).toBe(false);
  });

  test("temp --body-file <path> form counts as marked", () => {
    expect(hasSetupIssueMarker('gh issue create --title "[BUG] x" --body-file "/tmp/body.md"  # via setup-issue')).toBe(true);
  });
});

describe("line continuations (R4)", () => {
  test("bash backslash-newline continuation keeps the marker on the write's segment", () => {
    const cmd = 'gh issue create --repo "a/b" \\\n  --title "[BUG] x" \\\n  --body "y"  # via setup-issue';
    expect(isRawIssueWriteCommand(cmd)).toBe(true);
    expect(hasSetupIssueMarker(cmd)).toBe(true);
  });

  test("PowerShell backtick-newline continuation keeps the marker on the write's segment", () => {
    const cmd = 'gh issue edit 12 `\n  --title "[BUG] x" `\n  --add-label "type:bug"  # via setup-issue';
    expect(isRawIssueWriteCommand(cmd)).toBe(true);
    expect(hasSetupIssueMarker(cmd)).toBe(true);
  });

  test("CRLF continuations are joined too", () => {
    expect(hasSetupIssueMarker('gh issue create \\\r\n --title x  # via setup-issue')).toBe(true);
    expect(hasSetupIssueMarker('gh issue create `\r\n --title x  # via setup-issue')).toBe(true);
  });

  test("a plain newline still ends the segment", () => {
    expect(hasSetupIssueMarker("gh issue create --title x\n# via setup-issue")).toBe(false);
  });
});

describe("gh api issue writes (R10)", () => {
  test.each([
    ["POST via -X", "gh api -X POST repos/a/b/issues -f title=x"],
    ["PATCH via --method", "gh api --method PATCH repos/a/b/issues/12 -f state=closed"],
    ["glued -XPATCH", "gh api -XPATCH /repos/a/b/issues/12 -f title=y"],
    ["implicit POST via -f", "gh api repos/a/b/issues -f title=x -f body=y"],
    ["implicit POST via -F", "gh api repos/{owner}/{repo}/issues -F title=x"],
    ["--input file", "gh api repos/a/b/issues --input body.json"],
    ["quoted path", 'gh api "repos/a/b/issues/3" -X PATCH -f "title=z"'],
    ["labels endpoint", "gh api -X POST repos/a/b/issues/3/labels -f labels[]=bug"],
    ["global -R flag before api", "gh -R a/b api repos/a/b/issues -f title=x"],
    ["chained after &&", "echo x && gh api repos/a/b/issues -f title=x"],
  ])("%s → write", (_name, cmd) => {
    expect(isRawIssueWriteCommand(cmd)).toBe(true);
  });

  test.each([
    ["plain GET", "gh api repos/a/b/issues"],
    ["-X GET with fields is a read", "gh api -X GET repos/a/b/issues -f state=open"],
    ["issue comments are not an issue edit", "gh api repos/a/b/issues/3/comments -f body=x"],
    ["pull endpoint", "gh api -X PATCH repos/a/b/pulls/3 -f title=x"],
    ["gh api inside quotes", 'echo "gh api -X POST repos/a/b/issues -f title=x"'],
    ["graphql", "gh api graphql -f query=q"],
  ])("%s → not a write", (_name, cmd) => {
    expect(isRawIssueWriteCommand(cmd)).toBe(false);
  });

  test("a marked gh api write counts as marked", () => {
    expect(hasSetupIssueMarker("gh api -X POST repos/a/b/issues -f title=x  # via setup-issue")).toBe(true);
  });
});

describe("isMcpIssueWriteTool (R10)", () => {
  test.each([
    "mcp__plugin_github_github__issue_write",
    "mcp__github__issue_write",
    "mcp__github__create_issue",
    "mcp__github__update_issue",
  ])("%s → issue write tool", (name) => {
    expect(isMcpIssueWriteTool(name)).toBe(true);
  });

  test.each([
    "mcp__plugin_github_github__issue_read",
    "mcp__plugin_github_github__add_issue_comment",
    "mcp__plugin_github_github__sub_issue_write",
    "mcp__plugin_devops_dotclaude-issues__issue_write",
    "Bash",
    undefined,
  ])("%s → not guarded", (name) => {
    expect(isMcpIssueWriteTool(name)).toBe(false);
  });
});
