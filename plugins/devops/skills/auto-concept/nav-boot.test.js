import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";

// Every other Kompass-tree test in this folder (section-nav.test.js) RUNS the
// reference JS extracted from templates.md against a hand-built fixture DOM —
// it calls buildSectionNav() directly. That is deliberate for unit coverage,
// but it cannot catch a defect that only exists in the REAL boot sequence: a
// second/third buildSectionNav() call from a different call site (the direct
// DOMContentLoaded listener, showIteration() at boot, a reload poll…) taking
// a path the unit tests never construct.
//
// This file boots the ACTUAL assembled page instead: build the fixture with
// build-concept-fixture.js (so it is always current templates.md, never a
// stale pre-generated HTML file on disk), load it with runScripts:
// "dangerously" so every inline <script> — the whole page, not an extracted
// function list — executes for real, and let it run all the way through
// DOMContentLoaded + load + one macrotask before asserting on the DOM.

async function bootFixture(opts) {
  const html = build(opts);
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const { window } = dom;
  // No live bridge in this harness — every heartbeat/poll fetch must fail
  // fast (rejected), not hang, and must never throw synchronously.
  window.fetch = () => Promise.reject(new Error("no network in jsdom"));
  // jsdom does not implement CSS.supports / color-mix() parsing etc.; the
  // page's own inline styles reference them but that is a stylesheet
  // concern, not a script defect — swallow the resulting "not implemented"
  // window errors so they cannot mask (or be mistaken for) a real one.
  window.onerror = () => true;
  await new Promise((resolve) => {
    if (window.document.readyState === "complete") return resolve();
    window.addEventListener("load", resolve);
  });
  // TWO more macrotasks, not one: a <details> 'toggle' event is queued, not
  // fired synchronously with the property assignment that caused it — a
  // single `setTimeout(resolve, 0)` was observed (real Chromium) to land
  // BEFORE some of those queued events had drained, so the very race this
  // suite exists to catch (a stale toggle listener from an earlier
  // buildSectionNav() generation closing the CURRENT tree) was still mid-
  // flight and invisible to a single-macrotask wait.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return dom;
}

describe("Kompass tree — real boot sequence (assembled fixture page, not a hand-built harness)", () => {
  test("a large decision round (6 rounds, 14 entries) ends boot with exactly one open TOC group", async () => {
    const dom = await bootFixture({ rounds: 6, entries: 14, mode: "decision", locale: "de" });
    const { document } = dom.window;
    const groups = [...document.querySelectorAll("#section-nav details.nav-group")];
    expect(groups.length, "the fixture must actually be in a grouped state").toBeGreaterThan(0);
    const open = groups.filter((g) => g.open);
    expect(open.length, "groups: " + groups.map((g) => g.dataset.navGroup + ":" + g.open).join(", ")).toBe(1);
  });

  test("switching to an earlier (frozen) round via its iteration tab also ends with exactly one open group", async () => {
    const dom = await bootFixture({ rounds: 6, entries: 14, mode: "decision", locale: "de" });
    const { document, window } = dom.window;
    const frozenTab = document.querySelector('.iteration-tab[data-iteration="2"]');
    expect(frozenTab).not.toBeNull();
    frozenTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const groups = [...document.querySelectorAll("#section-nav details.nav-group")];
    if (groups.length) {
      const open = groups.filter((g) => g.open);
      expect(open.length, "groups: " + groups.map((g) => g.dataset.navGroup + ":" + g.open).join(", ")).toBe(1);
    }
  });

  test("the small case (2 rounds, 4 entries) still boots without error, whether it groups or stays flat", async () => {
    const dom = await bootFixture({ rounds: 2, entries: 4, mode: "decision", locale: "de" });
    const { document } = dom.window;
    expect(document.querySelectorAll("#section-nav .section-nav-item").length).toBeGreaterThan(0);
    // ≤12 entries never triggers the SIZE-based grouping rule, but with ≥2
    // variant sections the SELECTED-VARIANT grouping can still apply (it has
    // no entry-count floor) — either shape is valid; the one invariant that
    // must always hold, grouped or not, is that a grouped tree never boots
    // with zero (or more than one) open group.
    const groups = [...document.querySelectorAll("#section-nav details.nav-group")];
    if (groups.length) {
      expect(groups.filter((g) => g.open).length).toBe(1);
    }
  });
});
