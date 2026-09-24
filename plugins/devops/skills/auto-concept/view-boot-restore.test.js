import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";

// A question view (decision / comparison / mapping subpage) did not survive a
// reload: § State Persistence stores `_activeView`, the design layout's own
// DOMContentLoaded listener restores it via showView(), and then the shared
// boot listener (§ Tab Switch JS) calls showIteration(active) — whose
// `iteration:changed` handler treats EVERY event as a tab switch and hides
// every view. The showScreen() that follows ends in saveState(), which then
// deletes `_activeView` from storage, so even the memory of the view was gone.
// Every iteration append reloads the page, so this hit the user on every round.
//
// Same method as nav-boot.test.js: boot the ACTUAL assembled fixture (all
// inline scripts run for real), because the defect lives in the interplay of
// two DOMContentLoaded listeners that a hand-built harness never constructs.
// A reload is simulated by booting a second document seeded with the first
// one's localStorage blob (jsdom storage is per instance, seeded in
// beforeParse so it exists before the first inline script runs).

async function bootFixture(html, seed = null) {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
    beforeParse(window) {
      // jsdom has no CSS.escape; the page uses it in every restore/switch path.
      window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c) };
      window.fetch = () => Promise.reject(new Error("no network in jsdom"));
      window.onerror = () => true;
      // A "reload": the previous life's storage, present before any inline
      // script runs. (Injecting a <script> after <body> is not an option — the
      // page's own <style> block contains a literal "<body" in a comment, so a
      // naive tag match lands inside CSS and never executes.)
      if (seed) window.localStorage.setItem(seed.key, seed.blob);
    },
  });
  const { window } = dom;
  await new Promise((resolve) => {
    if (window.document.readyState === "complete") return resolve();
    window.addEventListener("load", resolve);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return dom;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function liveView(document) {
  return document.querySelector("section[data-iteration][data-active] section[data-view]");
}

/** The page's localStorage blob, keyed the way the page keys it. */
function stateOf(window) {
  const ls = window.localStorage;
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (key.startsWith("concept-state-")) return { key, blob: ls.getItem(key) };
  }
  return null;
}

describe("question views survive a reload (real boot sequence)", () => {
  const html = build({ rounds: 3, entries: 6, mode: "design", mapping: true, locale: "en" });
  // Each test boots one or two full 540 KB pages with every inline script
  // running; measured 5-25 s idle and past the 60 s default under a loaded
  // full-suite run (git-sync suites hold whole workers for 30-40 s).
  const BOOT_TIMEOUT = 180_000;

  test("the restored view is still the active top-level item after boot, and stays remembered", async () => {
    // First life: open the mapping subpage through its switcher segment.
    const a = await bootFixture(html);
    const viewId = liveView(a.window.document).dataset.view;
    const segment = a.window.document.querySelector(`.view-switch-item[data-view-id="${viewId}"]`);
    expect(segment, "the switcher must offer the view").not.toBeNull();
    segment.click();
    await tick();
    expect(a.window.document.body.dataset.viewActive).toBe("true");
    const saved = stateOf(a.window);
    expect(saved, "showView() persists the page state").not.toBeNull();
    expect(JSON.parse(saved.blob)._activeView).toBe(viewId);

    // Second life: same page, same storage — a reload.
    const b = await bootFixture(html, saved);
    const { document, localStorage } = b.window;
    const view = liveView(document);
    expect(view.dataset.view).toBe(viewId);
    expect(view.hidden, "the restored view must be on screen after boot").toBe(false);
    expect(view.dataset.viewActive).toBe("true");
    expect(document.body.dataset.viewActive).toBe("true");
    const design = document.querySelector('section[data-iteration][data-active] section[data-design][data-design-active="true"]');
    expect(design.hidden, "the design stays hidden behind the view").toBe(true);
    expect(document.querySelector(`.view-switch-item[data-view-id="${viewId}"]`).dataset.active).toBe("true");
    expect(document.querySelector(`.screen-nav-view-item[data-view-id="${viewId}"]`).dataset.active).toBe("true");
    // The boot's own saveState() calls must not have forgotten the view.
    expect(JSON.parse(localStorage.getItem(saved.key))._activeView).toBe(viewId);
  }, BOOT_TIMEOUT);

  test("a real tab switch still drops back to the design — and the way back lands on the design too", async () => {
    const a = await bootFixture(html);
    const { window } = a;
    const { document } = window;
    const viewId = liveView(document).dataset.view;
    window.showView(viewId);
    await tick();
    expect(document.body.dataset.viewActive).toBe("true");
    // To a frozen round …
    document.querySelector('.iteration-tab[data-iteration="2"]').click();
    await tick();
    expect(document.body.dataset.viewActive).toBe("false");
    expect(liveView(document).hidden).toBe(true);
    // … and back to the live one: the documented invariant — a question view
    // never survives a tab switch — holds in both directions.
    document.querySelector('.iteration-tab[data-iteration="3"]').click();
    await tick();
    expect(document.body.dataset.viewActive).toBe("false");
    expect(liveView(document).hidden).toBe(true);
    const design = document.querySelector('section[data-iteration][data-active] section[data-design][data-design-active="true"]');
    expect(design.hidden).toBe(false);
  }, BOOT_TIMEOUT);

  test("a boot with no remembered view lands on the design exactly as before", async () => {
    const a = await bootFixture(html);
    const { document } = a.window;
    expect(document.body.dataset.viewActive).toBe("false");
    expect(liveView(document).hidden).toBe(true);
    const design = document.querySelector('section[data-iteration][data-active] section[data-design][data-design-active="true"]');
    expect(design.hidden).toBe(false);
    expect(document.querySelector('section[data-iteration][data-active] section[data-screen][data-screen-active="true"]').hidden).toBe(false);
  }, BOOT_TIMEOUT);
});
