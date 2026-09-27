import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #568: a session whose owner cannot reach the localhost bridge still builds
// the real concept page — only the transport changes. The bridge stays
// mandatory wherever it can run; the hand-off is a fallback, never a choice.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");

describe("auto-concept — no reachable bridge ≠ no concept (#568)", () => {
  test("the rule sits before Step 0 and keeps the bridge mandatory", () => {
    const rule = skill.indexOf("## No reachable bridge ≠ no concept");
    expect(rule).toBeGreaterThan(-1);
    expect(rule).toBeLessThan(skill.indexOf("## Step 0 — Load Extensions"));
    const text = skill.slice(rule, skill.indexOf("## Step 0 — Load Extensions"));
    expect(text).toMatch(/The bridge is mandatory wherever it can\s+run/);
    expect(text).toMatch(/look-alike page/);
  });

  test("Step 3 has the hand-off fallback before the Edge rules, and only as a fallback", () => {
    const step3 = skill.indexOf("## Step 3 — Open in Browser");
    const fb = skill.indexOf("### No reachable bridge — hand-off fallback");
    const edge = skill.indexOf("### MANDATORY — Real Edge browser only");
    expect(step3).toBeGreaterThan(-1);
    expect(fb).toBeGreaterThan(step3);
    expect(fb).toBeLessThan(edge);
    const text = skill.slice(fb, edge);
    expect(text).toMatch(/A fallback, never a choice/);
    expect(text).toMatch(/Steps 0–2 ran in full/);
    expect(text).toMatch(/post\.concept\.gate/);
    expect(text).toMatch(/Commit and push/);
    expect(text).toMatch(/Hand off in one line/);
    expect(text).toMatch(/#589/);
  });
});
