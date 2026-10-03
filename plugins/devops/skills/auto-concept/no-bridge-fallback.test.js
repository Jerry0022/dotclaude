import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSkill } from "./skill-source.js";

// #568: a session whose owner cannot reach the localhost bridge still builds
// the real concept page — only the transport changes. The bridge stays
// mandatory wherever it can run; the hand-off is a fallback, never a choice.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skill = readSkill();

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

  // #589: the artifact copy is the second tier — after the hand-off, before
  // the Edge rules, and never a replacement for the bridge.
  test("the artifact fallback is a second tier behind the hand-off", () => {
    const fb = skill.indexOf("### No reachable bridge — hand-off fallback");
    const art = skill.indexOf("### No reachable bridge, owner decides remotely — artifact fallback (#589)");
    const edge = skill.indexOf("### MANDATORY — Real Edge browser only");
    expect(art).toBeGreaterThan(fb);
    expect(art).toBeLessThan(edge);
    const text = skill.slice(art, edge);
    expect(text).toMatch(/Second tier, behind the hand-off/);
    expect(text).toMatch(/concept-artifact\.js/);
    expect(text).toMatch(/capabilities: \{db: \{\}\}/);
    expect(text).toMatch(/no bridge,\s+no crons, no Edge start/);
    expect(text).toMatch(/deep-knowledge\/artifact-fallback\.md/);
    expect(skill).not.toMatch(/separate, later fallback \(#589\)/);
  });

  test("the artifact procedure names the read-back and the never-ack rule", () => {
    const dk = fs.readFileSync(path.join(__dirname, "deep-knowledge", "artifact-fallback.md"), "utf8");
    expect(dk).toMatch(/ArtifactData \{ action: "get", collection: "concept", doc_id: "decisions" \}/);
    expect(dk).toMatch(/never acks what is not stored/);
    expect(dk).toMatch(/not connected/);
  });
});
