import { describe, test, expect } from "vitest";
import { readTemplates } from "./templates-source.js";

// An expanded annotation bubble showed its answer field sticking out past the
// bubble's right edge. The page has no global `box-sizing` reset, so every
// `width: 100%` textarea with padding and a border renders wider than its
// container (content-box). Every full-width textarea rule in the template
// must therefore opt into `box-sizing: border-box` itself.

const md = readTemplates();

function ruleBody(selector) {
  const start = md.indexOf(`\n${selector} {`);
  expect(start, `rule ${selector} not found`).toBeGreaterThan(-1);
  const open = md.indexOf("{", start);
  return md.slice(open + 1, md.indexOf("}", open));
}

describe("full-width textareas stay inside their container", () => {
  for (const selector of [
    ".anno-answer",
    ".feedback-section textarea",
    ".decision-comment-row textarea",
  ]) {
    test(`${selector} uses border-box sizing`, () => {
      const body = ruleBody(selector);
      expect(body).toMatch(/width:\s*100%/);
      expect(body).toMatch(/box-sizing:\s*border-box/);
    });
  }

  // A bare `<textarea data-comment>` emitted without its row wrapper fell back
  // to the browser default: monospace, 20 columns, two rows.
  test("a bare comment textarea still gets the full-width app look", () => {
    const m = md.match(/\n:where\(textarea\[data-comment\]:not\(([^{]*)\)\) \{([^}]*)\}/);
    expect(m, "fallback rule for bare comment textareas").toBeTruthy();
    expect(m[1]).toMatch(/#feedback-dock textarea/);
    expect(m[1]).toMatch(/\.decision-comment-row textarea/);
    expect(m[2]).toMatch(/width:\s*100%/);
    expect(m[2]).toMatch(/box-sizing:\s*border-box/);
    expect(m[2]).toMatch(/font:\s*inherit/);
    expect(m[2]).toMatch(/max-width:\s*100%/);
    expect(m[2]).toMatch(/resize:\s*vertical/);
  });

  // Every note field looks like the 💬 dock's textarea: same height, radius
  // and fill — and none can be dragged wider than the page.
  test("inline comment fields match the dock textarea", () => {
    const dock = ruleBody(".feedback-section textarea");
    const pick = (body, prop) => (body.match(new RegExp(`${prop}:\\s*([^;]+);`)) || [])[1];
    const fallback = md.match(/\n:where\(textarea\[data-comment\]:not\([^{]*\)\) \{([^}]*)\}/)[1];
    for (const body of [ruleBody(".decision-comment-row textarea"), fallback]) {
      for (const prop of ["min-height", "border-radius", "line-height"]) {
        expect(pick(body, prop), prop).toBe(pick(dock, prop));
      }
      expect(body).toMatch(/max-width:\s*100%/);
      expect(body).toMatch(/resize:\s*vertical/);
    }
  });

  test("the annotation answer is capped at the bubble body's width", () => {
    expect(ruleBody(".anno-answer")).toMatch(/max-width:\s*100%/);
  });
});
