import { describe, test, expect } from "vitest";
import { readTemplates } from "./templates-source.js";

// Reported from a live design page: annotation pins sat half off the right
// edge, a COLLAPSED bubble's summary ran out of the window, and an EXPANDED
// bubble opened under the ☰ FAB with its question clipped by the scrolling
// canvas. placeBubble() used to return early for collapsed bubbles and
// measured only against the window, never against clipping ancestors or the
// fixed chrome. jsdom has no layout, so this locks the contract in the
// template source; the geometry itself was verified in a real browser.

const src = readTemplates();
const wiring = src.slice(src.indexOf("function wireAnnotationLayer()"));

describe("annotation layer keeps pins and bubbles visible", () => {
  test("placeBubble handles collapsed bubbles too (no open-only gate)", () => {
    const body = wiring.slice(wiring.indexOf("function placeBubble("), wiring.indexOf("function layoutAnno("));
    expect(body).not.toMatch(/dataset\.open\s*!==\s*'true'\)\s*return/);
  });

  test("placement measures against clipping ancestors and fixed chrome", () => {
    expect(wiring).toMatch(/function visibleBounds\(/);
    expect(wiring).toMatch(/function chromeRects\(/);
    for (const sel of [".panel-fab", ".feedback-fab", ".anno-toggle-fab", ".concept-decision-panel", ".feedback-dock"]) {
      expect(wiring).toContain(`'${sel}'`);
    }
  });

  test("pins are nudged into view, not only bubbles", () => {
    expect(wiring).toMatch(/function placePin\(/);
    expect(wiring).toMatch(/placePin\(anno, bounds, chrome\)/);
  });

  // Reported from a live page: two pins anchored to the same control sat on
  // one spot and their bubbles stacked into one unreadable block. Clusters
  // and side-by-side pins are fine; overlap is not.
  test("pins and bubbles of one screen avoid each other, the open bubble first", () => {
    const body = wiring.slice(wiring.indexOf("function layoutAnnos("), wiring.indexOf("function openBubbleAt("));
    expect(body).toMatch(/placePin\(anno, bounds, chrome\.concat\(pins\.map/);
    expect(body).toMatch(/placeBubble\(anno, bounds, chrome\.concat\(others, bubbles\)\)/);
    expect(body).toMatch(/list\.filter\(isOpenAnno\)/);
    const open = wiring.slice(wiring.indexOf("function openBubbleAt("), wiring.indexOf("function updateAnnoUI()"));
    expect(open).toMatch(/layoutAnnos\(all\)/);
  });

  test("every pin of the active screen is laid out on update, close, scroll and chrome changes", () => {
    const update = wiring.slice(wiring.indexOf("function updateAnnoUI()"));
    expect(update.slice(0, update.indexOf("window.updateAnnoUI"))).toMatch(/layoutAnnos\(all\)/);
    const close = wiring.slice(wiring.indexOf("function closeAllBubbles()"), wiring.indexOf("function recomputeAnswered("));
    expect(close).toMatch(/layoutAnnos\(/);
    expect(wiring).toMatch(/addEventListener\('scroll', scheduleAnnoLayout, true\)/);
    expect(wiring).toMatch(/new MutationObserver\(scheduleAnnoLayout\)/);
  });
});
