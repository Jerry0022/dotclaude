import { describe, test, expect } from "vitest";
import { readTemplates } from "./templates-source.js";

// Descender guard: a single-line text pill / label that clips (overflow:
// hidden or text-overflow) must leave room below the baseline — at
// line-height 1 the "g" of "Umsetzung" was cut. Scans every CSS rule of the
// joined templates; glyph-only boxes (icons, emoji discs) are exempt because
// they hold no running text.

const md = readTemplates();
const cssText = [...md.matchAll(/```css\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const GLYPH_ONLY = /(ico|icon|glyph|bot|node|dot|chk|lock|mini|badge|avatar|emoji|fab|close|toggle-btn|-x\b|thumb)/i;
const TEXTY = /(pill|chip|label|tag|toast|run\b|jr-run|jr-fill|submit|btn|badge|cap|crumb|title|txt)/i;

function rules() {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(cssText))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}

function lineHeightOf(body) {
  const m = /line-height:\s*([^;]+)/.exec(body);
  if (!m) return null;
  const v = m[1].trim();
  const tok = /var\(--pill-line-height,\s*([\d.]+)\)/.exec(v);
  if (tok) return Number(tok[1]);
  if (/^[\d.]+$/.test(v)) return Number(v);
  return null;   // px / calc / other: not judged here
}

describe("single-line pill / label text keeps its descenders", () => {
  test("the shared token is ≥ 1.2", () => {
    const m = /--pill-line-height:\s*([\d.]+)/.exec(cssText);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(1.2);
  });

  test("no text-bearing rule combines overflow clipping with line-height < 1.2", () => {
    const bad = [];
    for (const { sel, body } of rules()) {
      if (!/overflow:\s*hidden|text-overflow:\s*ellipsis/.test(body)) continue;
      const lh = lineHeightOf(body);
      if (lh == null || lh >= 1.2) continue;
      const parts = sel.split(",").map((s) => s.trim()).filter((s) => TEXTY.test(s) && !GLYPH_ONLY.test(s.split(/\s+/).pop()));
      if (parts.length) bad.push(`${sel} → line-height ${lh}`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("the run bar and journey buttons read the token", () => {
    expect(cssText).toMatch(/\.jr-run \{[^}]*line-height: var\(--pill-line-height, 1\.3\)/);
    expect(cssText).toMatch(/\.journey \.jr-fill[^{]*\{[^}]*line-height: var\(--pill-line-height, 1\.3\)/);
  });
});
