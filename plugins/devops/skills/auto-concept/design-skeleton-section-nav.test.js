import { describe, test, expect } from "vitest";
import { readTemplates } from "./templates-source.js";

// A design concept's final report is always a `free` round (SKILL.md § Template
// continuity), and a free round renders its TOC into #section-nav. The design
// skeleton only carried #screen-nav, so every final report on a design concept
// had no TOC — and no "⚠ Danach von Hand" entry, the one TOC item the user must
// not miss. The CSS toggle between the two navs already existed; the element
// did not.

const md = readTemplates();

function blocks(lang) {
  const re = new RegExp("```(?:" + lang + ")\\n([\\s\\S]*?)```", "g");
  const out = [];
  let m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

describe("design skeleton carries #section-nav", () => {
  const design = blocks("html").find((b) => b.includes('class="concept-layout design fullscreen"'));

  test("the design skeleton has both navs inside .panel-nav-scroll", () => {
    expect(design, "design skeleton").toBeTruthy();
    const scroll = design.slice(design.indexOf('<div class="panel-nav-scroll">'));
    const sectionNav = scroll.indexOf('id="section-nav"');
    const screenNav = scroll.indexOf('id="screen-nav"');
    expect(sectionNav).toBeGreaterThan(-1);
    expect(screenNav).toBeGreaterThan(-1);
    // Both sit in the scroll box, next to each other.
    expect(Math.abs(sectionNav - screenNav)).toBeLessThan(1200);
  });

  test("CSS shows exactly one of them per active template", () => {
    const css = blocks("css").join("\n");
    expect(css).toContain('html:not([data-template="design"]) #screen-nav,');
    expect(css).toContain('html[data-template="design"] #section-nav { display: none !important; }');
  });
});
