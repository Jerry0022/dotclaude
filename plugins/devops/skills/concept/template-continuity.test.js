import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Two defects, both found on real generated pages (four labyrinth concepts,
// 2026-09-07/08), both with the same symptom: halfway through a design
// concept the feedback surface moved from behind the 💬 FAB into the page.
//
//   1. A reality-check round was appended as `data-iteration-template="decision"`
//      inside a three-round `design` concept. The CSS hides the FABs and the
//      dock outside design mode and docked the panel into a sidebar, so the
//      whole chrome swapped mid-session.
//   2. A final-report section was appended with NO template at all.
//      resolveIterationTemplate() then fell back to `<html data-template>` —
//      a projection applyIterationTemplate() rewrites on every tab switch —
//      so the report rendered as a canvas when reached from a design tab and
//      as a document when reached from a decision tab. Same file, same
//      section, two layouts, depending on the route taken to it.
//
// The fixes are structural: the panel is page chrome (one overlay, every
// template), the fallback is the concept's base template, and the rule that
// a round keeps its concept's template is written down where the appending
// Claude reads it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");
const realityDoc = fs.readFileSync(path.join(DK, "reality-check.md"), "utf8");

// Line-based scanner (same reason as viewport-switcher.test.js): a lazy
// fence regex desynchronises on the first block whose body contains a fence.
function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null,
    body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) {
      if (open === null) {
        open = { info: m[1].trim(), start: i + 1 };
        body = [];
      } else {
        out.push({ info: open.info, line: open.start, code: body.join("\n") });
        open = null;
      }
      continue;
    }
    if (open) body.push(lines[i]);
  }
  return out;
}
const BLOCKS = scanBlocks(md);
const jsSource = BLOCKS.filter((b) => /^(javascript|js)$/.test(b.info)).map((b) => b.code).join("\n");
const htmlSource = BLOCKS.filter((b) => b.info === "html").map((b) => b.code).join("\n");
const cssSource = BLOCKS.filter((b) => b.info === "css").map((b) => b.code).join("\n");

// The blocks belonging to one `## Section` — used to prove WHERE a function
// lives, not merely that it exists somewhere in the file.
function sectionBlocks(heading) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  expect(start, heading).toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return BLOCKS.filter((b) => b.line > start && b.line < end);
}

describe("template resolution is deterministic", () => {
  test("the fallback is the concept's base template, never the live projection", () => {
    const fn = jsSource.slice(jsSource.indexOf("function resolveIterationTemplate"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("baseIterationTemplate()");
    // The projection is what applyIterationTemplate() rewrites on every tab
    // switch — using it here is the bug, not a shortcut.
    expect(body).not.toContain("document.documentElement.dataset.template");
  });

  test("the base template is read once, from the markup, before anything projects onto it", () => {
    expect(jsSource).toContain(
      "const _pageTemplateAtLoad = document.documentElement.dataset.template || ''"
    );
    const fn = jsSource.slice(jsSource.indexOf("function baseIterationTemplate"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // First declared iteration section wins; the captured page attribute is
    // only the legacy fallback for pages that predate the attribute.
    expect(body).toContain("section[data-iteration][data-iteration-template]");
    expect(body).toContain("_pageTemplateAtLoad");
    expect(body).toContain("_baseTemplate");
  });

  test("the legacy `prototype` alias still normalises on both paths", () => {
    const resolve = jsSource.slice(jsSource.indexOf("function resolveIterationTemplate"));
    const base = jsSource.slice(jsSource.indexOf("function baseIterationTemplate"));
    expect(resolve.slice(0, 400)).toContain("raw === 'prototype' ? 'design' : raw");
    expect(base.slice(0, 500)).toContain("raw === 'prototype' ? 'design' : raw");
  });

  test("the gate makes the attribute mandatory where it decides the layout", () => {
    const row = /\| 12b \|[^\n]*/.exec(gate);
    expect(row, "gate 12b").toBeTruthy();
    expect(row[0]).toMatch(/data-active/);
    expect(row[0]).toMatch(/data-final-report/);
    expect(row[0]).toMatch(/[Hh]ard fail/);
    const row12c = /\| 12c \|[^\n]*/.exec(gate);
    expect(row12c, "gate 12c").toBeTruthy();
    expect(row12c[0]).toContain("baseIterationTemplate");
  });
});

describe("a concept keeps its template across rounds", () => {
  test("SKILL.md states the continuity rule and both exceptions", () => {
    const i = skill.indexOf("Template continuity");
    expect(i, "continuity rule").toBeGreaterThan(0);
    const rule = skill.slice(i, i + 2000);
    expect(rule).toMatch(/data-view-kind="decision"/);
    expect(rule).toMatch(/mixed mode/i);
    expect(rule).toMatch(/final report[\s\S]*always `free`/i);
    expect(rule).toMatch(/MANDATORY|mandatory/);
  });

  test("the final report is appended as a document round, explicitly", () => {
    const i = skill.indexOf("### Final-report append");
    expect(i).toBeGreaterThan(0);
    const block = skill.slice(i, i + 3000);
    expect(block).toContain('data-iteration-template="free"');
  });

  test("the reality-check round keeps the concept's template", () => {
    const i = realityDoc.indexOf("## The forced round");
    expect(i).toBeGreaterThan(0);
    const block = realityDoc.slice(i, i + 2500);
    expect(block).toMatch(/Template\s+continuity/);
    expect(block).toContain('data-view-kind="decision"');
  });
});

describe("the ☰ panel is page chrome", () => {
  test("both skeletons carry the FAB, the backdrop and the close button", () => {
    const skeletons = BLOCKS.filter(
      (b) => b.info === "html" && b.code.includes('class="concept-decision-panel')
    );
    expect(skeletons.length, "skeletons with a decision panel").toBeGreaterThanOrEqual(2);
    for (const s of skeletons) {
      expect(s.code, `#panel-toggle @${s.line}`).toContain('id="panel-toggle"');
      expect(s.code, `#panel-backdrop @${s.line}`).toContain('id="panel-backdrop"');
      expect(s.code, `overlay class @${s.line}`).toContain("concept-decision-panel overlay");
    }
    expect(htmlSource).toContain('id="panel-close"');
  });

  test("the panel wiring lives outside the design layout IIFE", () => {
    // A decision- or free-only page never runs the design Layout JS. While
    // openPanel lived in there, such a page had a FAB that did nothing —
    // which is why the panel used to be hidden and docked instead.
    const shared = sectionBlocks("## Panel Chrome (all templates)")
      .filter((b) => /^(javascript|js)$/.test(b.info))
      .map((b) => b.code)
      .join("\n");
    expect(shared).toContain("window.openPanel =");
    expect(shared).toContain("window.closePanel =");
    expect(shared).toContain("panelToggle?.addEventListener('click', openPanel)");
    // …and it must not close over the dock, which only exists in design mode.
    expect(shared).toContain("document.getElementById('feedback-dock')");

    const design = sectionBlocks("## Layout JS — single-screen navigation + context-sensitive feedback")
      .filter((b) => /^(javascript|js)$/.test(b.info))
      .map((b) => b.code)
      .join("\n");
    expect(design, "openPanel must not be re-declared in the design IIFE").not.toContain(
      "window.openPanel ="
    );
  });

  test("the panel is one overlay, and the sidebar variant is gone", () => {
    expect(cssSource).not.toContain(
      '[data-template="design"] .concept-layout.design .concept-decision-panel'
    );
    // The document layout keeps a content column, not a docked panel.
    const doc = md.slice(md.indexOf("## Layout — Document rounds"), md.indexOf("## Bi-State"));
    expect(doc).not.toContain("width: 20%");
    expect(doc).toContain(".concept-content > header { padding-right: 92px; }");
  });

  test("the gate pins the chrome so a regenerated page cannot drop it", () => {
    const row = /\| 62 \|[^\n]*/.exec(gate);
    expect(row, "gate 62").toBeTruthy();
    expect(row[0]).toContain("panel-toggle");
    expect(row[0]).toContain("panel-backdrop");
    expect(row[0]).toContain("window.openPanel");
  });

  test("only the dock side of the chrome stays design-only", () => {
    // Selectors only — the rule's own comment names .panel-fab to explain why
    // it is NOT in the list.
    const rule = /^(html:not\(\[data-template="design"\]\)[\s\S]*?display: none !important; \})/m.exec(cssSource);
    expect(rule, "design-only chrome rule").toBeTruthy();
    expect(rule[1]).toContain(".feedback-fab");
    expect(rule[1]).toContain(".feedback-dock");
    expect(rule[1]).not.toContain(".panel-fab");
  });
});
