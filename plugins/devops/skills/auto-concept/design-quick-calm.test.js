import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// Third feedback round on the design template:
// 1. the eye is also the calm-view switch (quick nav + both FABs go with the
//    notes), 3. a click on the page / variant already on screen goes one level
//    up instead of re-rendering, 4. the quick nav is repainted in place and
//    every switch names its direction, 5. quick-nav tooltips never repeat the
//    visible name — keycap only, or none. Same boot method as
//    design-overview-feedback.test.js.

const md = readTemplates();
const css = md.match(/```css\n([\s\S]*?)```/g).join("\n");
const BOOT_TIMEOUT = 180_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

function page(designs) {
  return build({ rounds: 2, entries: 4, mode: "design", mapping: false, locale: "de", designs, out: "" });
}

async function boot(html) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (!/Could not parse CSS|Not implemented/.test(String(e.message))) errors.push(String(e.message));
  });
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
    virtualConsole: vc,
    beforeParse(window) {
      window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c) };
      window.fetch = () => Promise.reject(new Error("no network in jsdom"));
    },
  });
  const { window } = dom;
  await new Promise((resolve) => {
    if (window.document.readyState === "complete") return resolve();
    window.addEventListener("load", resolve);
  });
  await tick();
  await tick();
  return { window, document: window.document, errors };
}

const live = (document) => document.querySelector("section[data-iteration][data-active]");
const activeDesign = (document) => live(document).querySelector(":scope > section[data-design][data-design-active='true']");
const activeScreen = (document) => activeDesign(document).querySelector("section[data-screen][data-screen-active='true']");
const centre = (document) => document.querySelector('[data-design-overview] .design-ov-slide[data-pos="cur"]');

describe("calm view — the eye takes the quick nav and both FABs along", () => {
  test("CSS hides quick nav, switcher, ☰ and 💬 under body.anno-hidden; the eye stays and names the larger scope", async () => {
    for (const sel of ["#design-quick", ".design-switcher", ".panel-fab", ".feedback-fab"]) {
      expect(css).toContain("body.anno-hidden " + sel);
    }
    expect(css).toMatch(/body\.anno-hidden \.feedback-fab \{\s*opacity: 0 !important; visibility: hidden; pointer-events: none;/);
    const { document, errors } = await boot(page(2));
    expect(errors).toEqual([]);
    const eye = document.getElementById("anno-toggle");
    expect(eye.hidden).toBe(false);
    expect(eye.dataset.tip).toMatch(/Navigation/);
    eye.click();
    expect(document.body.classList.contains("anno-hidden")).toBe(true);
    expect(eye.hidden).toBe(false);
    expect(eye.dataset.tip).toMatch(/einblenden/);
    eye.click();
    expect(document.body.classList.contains("anno-hidden")).toBe(false);
  }, BOOT_TIMEOUT);
});

describe("quick nav — one level up, in-place repaint, direction", () => {
  test("the page already on screen and the variant already on screen lead back to the overview, centred on it", async () => {
    const { window, document } = await boot(page(3));
    window.showDesign("d2b");
    const pages = () => [...document.querySelectorAll("#design-quick .design-quick-page")];
    expect(pages().length).toBeGreaterThan(1);
    pages().find((b) => b.dataset.active === "true").click();
    expect(document.body.dataset.overviewActive).toBe("true");
    expect(centre(document).dataset.designId).toBe("d2b");
    window.showDesign("d2b");
    document.querySelector("#design-quick .design-quick-group > .design-quick-seg").click();
    expect(document.body.dataset.overviewActive).toBe("true");
    expect(centre(document).dataset.designId).toBe("d2b");
  }, BOOT_TIMEOUT);

  test("a page step repaints the same buttons; aria-current and the Tab keycap move along", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2");
    const before = [...document.querySelectorAll("#design-quick .design-quick-page")];
    expect(before.length).toBeGreaterThan(1);
    before[1].click();
    const after = [...document.querySelectorAll("#design-quick .design-quick-page")];
    expect(after).toEqual(before);
    expect(activeScreen(document).id).toBe(after[1].dataset.screenId);
    expect(after[1].getAttribute("aria-current")).toBe("page");
    expect(after[0].hasAttribute("aria-current")).toBe(false);
    expect(after.filter((b) => b.dataset.tipKey === "Tab")).toEqual([after[(1 + 1) % after.length]]);
  }, BOOT_TIMEOUT);

  test("every switch names its direction: in, out, next, prev; the fan plays only on the way in", async () => {
    const { window, document } = await boot(page(3));
    window.showDesign("d2");
    expect(window.designNavDirection).toBe("in");
    expect(document.querySelector("#design-quick .design-quick-group").dataset.fan).toBe("true");
    const pages = [...document.querySelectorAll("#design-quick .design-quick-page")];
    window.showScreen(pages[1].dataset.screenId);
    expect(window.designNavDirection).toBe("next");
    window.showScreen(pages[0].dataset.screenId);
    expect(window.designNavDirection).toBe("prev");
    window.showDesign("d2b");
    expect(window.designNavDirection).toBe("next");
    expect(document.querySelector("#design-quick .design-quick-group").dataset.fan).toBeUndefined();
    window.showOverview();
    expect(window.designNavDirection).toBe("out");
    for (const k of ["dz-nav-in", "dz-nav-out", "dz-nav-next", "dz-nav-prev"]) expect(css).toContain("@keyframes " + k);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*body\[data-dz-nav\] section\[data-screen\]/);
    // No blanket entrance animation on every screen / view any more.
    expect(css).not.toMatch(/section\[data-screen\] \{[^}]*animation: screen-in/);
  }, BOOT_TIMEOUT);
});

describe("quick nav tooltips — never the visible name again", () => {
  test("named segments carry the keycap only; pages only the Tab keycap; Fragen no tooltip", async () => {
    const { window, document } = await boot(page(3));
    const segs = [...document.querySelectorAll("#design-quick .design-quick-designs > .design-quick-seg")];
    expect(segs.length).toBe(3);
    for (const s of segs) {
      expect(s.dataset.tipKeyOnly).toBe("true");
      expect(s.dataset.tip.trim()).not.toContain(s.textContent.trim().replace("▾", "").trim());
      expect(s.dataset.tipKey).toMatch(/^\d$/);
    }
    window.showDesign("d2");
    const pages = [...document.querySelectorAll("#design-quick .design-quick-page")];
    const withTip = pages.filter((b) => b.dataset.tip);
    expect(withTip.length).toBe(1);
    expect(withTip[0].dataset.tipKey).toBe("Tab");
    expect(withTip[0].dataset.tipKeyOnly).toBe("true");
    const q = document.querySelector("#design-quick .design-quick-q");
    if (q) {
      expect(q.dataset.tip).toBeUndefined();
      expect(q.getAttribute("aria-label")).toBeTruthy();
    }
  }, BOOT_TIMEOUT);
});
