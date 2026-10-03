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
    expect(text).not.toMatch(/Before executing this step, Read `deep-knowledge\//);
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
      expect(step, step.split("\n")[0]).toMatch(/\*\*Before executing this step, Read `deep-knowledge\//);
    }
  });

  test("SKILL.md stays under the 500-line ceiling", () => {
    const lines = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8").split("\n").length;
    expect(lines).toBeLessThan(500);
  });
});
