import { describe, test, expect } from "vitest";
import { readTemplates } from "./templates-source.js";

const src = readTemplates();

describe("annotation bubble improved line (rounds 2+)", () => {
  test("markup sits before the summary and reuses design.change_improved", () => {
    const i = src.indexOf('<p class="anno-bubble-improved">');
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 120)).toContain("{{design.change_improved}}");
    expect(i).toBeLessThan(src.indexOf('<button type="button" class="anno-bubble-summary"'));
  });

  test("no visible label: a green wash behind the hint, label for screen readers only, wrapped when open", () => {
    const rule = /(?:^|\n)\.anno-bubble-improved \{([^}]*)\}/.exec(src)[1];
    expect(rule).toMatch(/background: linear-gradient\([^;]*rgba\(63, 185, 80/);
    expect(rule, "never the orange question colour").not.toMatch(/--warning-color/);
    expect(rule).toMatch(/white-space: nowrap/);
    const label = /\.anno-bubble-improved strong \{([^}]*)\}/.exec(src)[1];
    expect(label).toMatch(/clip-path: inset\(50%\)/);
    expect(label).not.toMatch(/display: none/);
    expect(src).toMatch(/\.anno-bubble\[data-open="true"\] \.anno-bubble-improved \{[^}]*white-space: normal/);
  });

  test("a click on a collapsed bubble's hint opens it", () => {
    expect(src).toContain(`e.target.closest('.anno-bubble[data-open="false"] .anno-bubble-improved')`);
  });

  test("submit scan adds an optional improved field", () => {
    expect(src).toContain("anno.querySelector('.anno-bubble-improved')");
    expect(src).toMatch(/improvedText \? \{ improved: improvedText \}/);
  });

  test("round 2+ pin cap is documented", () => {
    expect(src).toMatch(/at\s+most 3 per changed screen/);
  });
});
