import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const text = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "SKILL.md"), "utf8");

describe("auto-issue SKILL.md command templates", () => {
  test("titles are single-quoted, bodies use the quoted heredoc", () => {
    expect(text).not.toMatch(/--title "\[TYPE\]/);
    expect(text).not.toMatch(/--body "Description"/);
  });
  test("no undefined {tmp} placeholder", () => {
    expect(text).not.toContain("{tmp}");
  });
  test("--repo is not hidden inside the marker comment", () => {
    expect(text).not.toMatch(/# via auto-issue —/);
  });
  test("label check is not capped at the 30-label default", () => {
    expect(text).toMatch(/gh label list --repo \{target_repo\} --limit 1000/);
  });
  test("label check is not filtered to type:* (role:/module: labels are checked too)", () => {
    expect(text).not.toMatch(/gh label list[^`]*--search/);
  });
  test("R2 re-posts the fetched body via --body-file, never a heredoc", () => {
    const r2 = text.slice(text.indexOf("### R2"), text.indexOf("### R3"));
    expect(r2).toMatch(/gh issue edit \{issue\} --body-file "\{body_file\}"  # via auto-issue/);
    expect(r2).not.toMatch(/<<'EOF'/);
  });
});
