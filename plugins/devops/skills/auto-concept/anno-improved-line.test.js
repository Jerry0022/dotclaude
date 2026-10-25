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

  test("styled like the overview line and wrapped when open", () => {
    expect(src).toMatch(/\.anno-bubble-improved strong \{[^}]*--warning-color/);
    expect(src).toMatch(/\.anno-bubble\[data-open="true"\] \.anno-bubble-improved/);
  });

  test("submit scan adds an optional improved field", () => {
    expect(src).toContain("anno.querySelector('.anno-bubble-improved')");
    expect(src).toMatch(/improvedText \? \{ improved: improvedText \}/);
  });

  test("round 2+ pin cap is documented", () => {
    expect(src).toMatch(/at\s+most 3 per changed screen/);
  });
});
