import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSkill, skillPointers, sectionsOf } from "./skill-source.js";

// SKILL.md keeps the step skeleton and the decisions; the execution detail
// sits in deep-knowledge/step*.md behind one mandatory pointer per moved
// block. These checks keep that split lossless: no dead pointer, no section
// that no step reads, no section read twice, and SKILL.md under its ceiling.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const stepFiles = fs.readdirSync(DK).filter((f) => /^step.*\.md$/.test(f));

describe("auto-concept SKILL.md pointers", () => {
  test("every pointer resolves and the joined text has no pointer left", () => {
    const text = readSkill();
    expect(text).not.toMatch(/Before executing this step, (?:Re-)?Read `deep-knowledge\//);
    expect(text).toMatch(/## Step 6 — Completion Card/);
  });

  test("every step*.md section is named by exactly one pointer", () => {
    const named = new Map();
    for (const p of skillPointers()) {
      const key = `${p.file} § ${p.section}`;
      named.set(key, (named.get(key) || 0) + 1);
    }
    expect(stepFiles.length).toBeGreaterThan(0);
    for (const file of stepFiles) {
      for (const name of sectionsOf(file).keys()) {
        expect(named.get(`${file} § ${name}`), `${file} § ${name}`).toBe(1);
      }
    }
    for (const key of named.keys()) {
      expect(stepFiles).toContain(key.split(" § ")[0]);
    }
  });

  test("every step keeps at least one pointer to its detail", () => {
    const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
    const steps = skill.split(/^## (?=Step )/m).slice(1);
    for (const step of steps.filter((s) => !/^Step 0 /.test(s))) {
      expect(step, step.split("\n")[0]).toMatch(/\*\*Before executing this step, (?:Re-)?Read `deep-knowledge\//);
    }
  });

  test("Step 5 pointers demand a re-read on every round (compaction drops earlier reads)", () => {
    const step5 = skillPointers().filter((p) => p.file.startsWith("step5"));
    expect(step5.length).toBeGreaterThan(0);
    const lines = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8").split("\n");
    for (const p of step5) {
      expect(lines[p.line - 1]).toMatch(/^\*\*Before executing this step, Re-Read `.+ completely on every round — even if read earlier in this session\*\*/);
    }
  });

  // Guards stay readable in SKILL.md itself — no pointer may be the only way to
  // see them. Read RAW, not through readSkill().
  test("the guard sentences stay inline in the raw SKILL.md", () => {
    const raw = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
    const inline = [
      "**Order matters — `/reset` is the LAST step, NOT the first.**",
      "**If ANY pattern is missing → DO NOT open the page.**",
      "**Fixed execution order — A (issues) → B (implement) → C (ship) → D\n(cleanup).** Never reorder",
      "**UNPROCESSED guard — never discard unseen work.**",
      "**Do NOT modify code, files, or external systems**",
      "**The ship card comes last.**",
      "1. Run the full ship pipeline via the `do-ship` skill",
      "never fake a completion or force past a failing gate.",
      "(A force-push to\n   main/master still requires explicit user confirmation",
      "**Forbidden alternatives** that will produce a broken session:",
      "- ❌ **Never** use `preview_start` / `preview_*`",
      "- ❌ **Never** use `mcp__plugin_playwright_playwright__browser_navigate`",
      "- ❌ **Never** print \"Concept opened at file:///… open it in your browser\"",
      "- ❌ **Never** bake a \"copy the decisions JSON and paste it into the chat\"",
      "   - Otherwise `POST /status {\"phase\":\"reality-check\",\"version\":$NOTED_VERSION}`",
      "append ONE\n     reality-check round instead of implementing (Step 5c) and stop.",
    ];
    for (const s of inline) expect(raw, s).toContain(s);
  });

  test("SKILL.md stays under the 500-line ceiling", () => {
    const lines = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8").split("\n").length;
    expect(lines).toBeLessThan(500);
  });
});
