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

  test("the annotation answer is capped at the bubble body's width", () => {
    expect(ruleBody(".anno-answer")).toMatch(/max-width:\s*100%/);
  });
});
