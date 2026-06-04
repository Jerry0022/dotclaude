import { describe, test, expect } from "vitest";
import { isManualShipCommand, stripQuoted } from "./ship-guard-match.js";

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
