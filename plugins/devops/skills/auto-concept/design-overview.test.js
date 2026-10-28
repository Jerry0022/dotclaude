import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// The variant overview (templates-design-views.md § Variant overview (≥2 designs)):
// a design round with two or more designs gets an engine-built overview
// carousel as its first top-level item, a header (top left) and a quick nav (top centre)
// in place of the screen indicator and the design switcher, a favourite that
// travels in the payload, hotkeys, and Ctrl + click user pins persisted like
// annotation answers. A single-design round must render exactly as before.
//
// Same method as view-boot-restore.test.js: boot the ACTUAL assembled
// fixture with every inline script running, because the overview lives in
// the interplay of buildDesignUI(), the boot restore and the iteration
// switch — a hand-built harness never constructs that sequence.

const require = createRequire(import.meta.url);
const gate = require("../../hooks/lib/concept-gate.js");
const conceptBuild = require("../../scripts/concept-build.js");
const md = readTemplates();

const BOOT_TIMEOUT = 180_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

const ATTRS = {
  "": 'data-design-motto="Weniger ist Ruhe." data-design-traits="Ein Ziel pro Tag | Pflanze | Keine Pushes" data-design-icon="leaf" data-design-color="#5f8b6a"',
  b: 'data-design-motto="Jeder Tag ein Level." data-design-traits="XP | Rangliste | Quests" data-design-icon="game"',
  c: 'data-design-motto="Alles im Blick." data-design-traits="KPIs | Heatmap | Export" data-design-icon="&lt;svg viewBox=&quot;0 0 24 24&quot; onload=&quot;window.__pwned=1&quot;&gt;&lt;script&gt;window.__pwned=1&lt;/script&gt;&lt;path d=&quot;M4 4h16&quot;/&gt;&lt;/svg&gt;"',
};

/** The fixture with the overview authoring attributes on the live round's designs. */
function page(designs, { attrs = true } = {}) {
  let html = build({ rounds: 2, entries: 4, mode: "design", mapping: false, locale: "de", designs, out: "" });
  if (attrs) {
    html = html.replace(/<section data-design="d2(b|c)?"/g, (m, sfx) => `${m} ${ATTRS[sfx || ""]}`);
  }
  return html;
}

async function boot(html, seed = null) {
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
      if (seed) window.localStorage.setItem(seed.key, seed.blob);
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

function stateOf(window) {
  const ls = window.localStorage;
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (key.startsWith("concept-state-")) return { key, blob: ls.getItem(key) };
  }
  return null;
}

const live = (document) => document.querySelector("section[data-iteration][data-active]");
const activeDesign = (document) => live(document).querySelector(":scope > section[data-design][data-design-active='true']");
function key(window, target, init) {
  const ev = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe("variant overview — quick nav pages and open questions", () => {
  const VIEWS =
    '<section data-view="q1" data-view-kind="decision" data-nav-label="Zeitleiste im Tutorial?" hidden><textarea data-comment="q1-note"></textarea></section>' +
    '<section data-view="q2" data-view-kind="decision" data-nav-label="Wie lang ist eine Phase?" hidden><textarea data-comment="q2-note"></textarea></section>';
  const withViews = (designs) => page(designs).replace('<section data-design="d2"', VIEWS + '<section data-design="d2"');

  test("the questions segment counts open views, the carousel ends on a questions slide, the panel a submit hint", async () => {
    const { window, document, errors } = await boot(withViews(2));
    expect(errors).toEqual([]);
    const badge = () => document.querySelector("#design-quick .design-quick-badge");
    expect(badge().textContent).toBe("2");
    const slides = [...document.querySelectorAll("[data-design-overview] .design-ov-slide")];
    expect(slides.length, "two designs + the questions slide").toBe(3);
    const qslide = slides[slides.length - 1];
    expect(qslide.classList.contains("design-ov-qslide")).toBe(true);
    expect(qslide.querySelector(".design-ov-qcard").querySelectorAll(".design-quick-qitem").length).toBe(2);
    expect(document.querySelector("[data-design-overview] .design-ov-grid, [data-design-overview] .design-ov-card")).toBeNull();
    // Three slides wrap: the questions peek in left of design 1.
    expect(qslide.dataset.pos).toBe("prev");
    // A neighbour click only turns; on the centre, an item opens its view.
    qslide.querySelector(".design-quick-qitem").click();
    expect(document.body.dataset.overviewActive).toBe("true");
    expect(qslide.dataset.pos).toBe("cur");
    qslide.querySelector(".design-quick-qitem").click();
    expect(document.body.dataset.viewActive).toBe("true");
    window.showOverview();
    const hint = () => document.querySelector(".submit-open-questions");
    expect(hint().hidden).toBe(false);
    const answer = (id, text) => {
      const ta = live(document).querySelector(`section[data-view="${id}"] textarea`);
      ta.value = text;
      ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    answer("q1", "ja");
    expect(badge().textContent).toBe("1");
    expect(hint().textContent).toContain("1");
    answer("q2", "kurz");
    expect(badge()).toBeNull();
    expect(document.querySelector("#design-quick .design-quick-q").dataset.state).toBe("done");
    expect(hint().hidden).toBe(true);
  }, BOOT_TIMEOUT);

  test("on a design page the active design fans out its pages, the others shrink to icons", async () => {
    const { window, document, errors } = await boot(withViews(2));
    expect(errors).toEqual([]);
    const id = live(document).querySelector(":scope > section[data-design]").dataset.design;
    window.showDesign(id);
    const group = document.querySelector("#design-quick .design-quick-group");
    expect(group).not.toBeNull();
    const pages = live(document).querySelectorAll(`:scope > section[data-design="${id}"] section[data-screen][id]`).length;
    expect(group.querySelectorAll(".design-quick-page, .design-quick-more").length).toBe(pages > 1 ? pages : 0);
    const others = [...document.querySelectorAll("#design-quick .design-quick-designs > .design-quick-seg")];
    expect(others.length).toBe(1);
    expect(others.every((s) => s.dataset.iconOnly === "true")).toBe(true);
  }, BOOT_TIMEOUT);
});

describe("variant overview — generated only for ≥2 designs", () => {
  test("a single-design round keeps header and quick nav, but has no overview grid and no favourite", async () => {
    const { document, errors } = await boot(page(1, { attrs: false }));
    expect(errors).toEqual([]);
    expect(document.body.dataset.overview).toBe("true");
    expect(document.querySelector("[data-design-overview]")).toBeNull();
    expect(document.getElementById("design-header").children.length).toBeGreaterThan(0);
    expect(document.querySelector(".design-header-back, .design-header-star")).toBeNull();
    expect(document.querySelectorAll("#design-quick .design-quick-group").length).toBe(1);
    expect(document.getElementById("anno-toggle").parentElement.classList.contains("design-header-eye")).toBe(true);
    expect(document.body.dataset.overviewActive).not.toBe("true");
    const payload = document.defaultView.collectDecisions("iterate");
    expect(payload.favorite).toBeNull();
    expect(payload.userPins).toEqual([]);
  }, BOOT_TIMEOUT);

  test("three designs: one slide each, the overview is the first top-level item and the boot lands on it", async () => {
    const { window, document, errors } = await boot(page(3));
    expect(errors).toEqual([]);
    const it = live(document);
    const ov = it.querySelector(":scope > [data-design-overview]");
    expect(ov).not.toBeNull();
    expect(it.querySelector(":scope > [data-design-overview], :scope > section[data-design]")).toBe(ov);
    expect(document.body.dataset.overview).toBe("true");
    expect(document.body.dataset.overviewActive).toBe("true");
    expect(ov.hidden).toBe(false);
    expect([...it.querySelectorAll(":scope > section[data-design]")].every((d) => d.hidden)).toBe(true);
    const cards = [...ov.querySelectorAll(".design-ov-slide[data-design-id]")];
    expect(cards.map((c) => c.dataset.designId)).toEqual(["d2", "d2b", "d2c"]);
    expect(cards.map((c) => c.dataset.pos)).toEqual(["cur", "next", "prev"]);
    const overlay = cards[0].querySelector(".design-ov-overlay");
    expect(overlay.querySelector(".design-ov-motto").textContent).toBe("Weniger ist Ruhe.");
    expect([...overlay.querySelectorAll(".design-ov-traits li")].map((li) => li.textContent)).toEqual(["Ein Ziel pro Tag", "Pflanze", "Keine Pushes"]);
    expect(overlay.querySelector(".design-ov-kicker .design-ov-num").textContent, "icon · N · name").toBe("1 ·");
    expect(overlay.querySelector(".design-ov-kicker .design-ov-name").textContent).toBe("Design 2");
    expect(cards[0].style.getPropertyValue("--dz-color")).toBe("#5f8b6a");
    // No page chips, no notes row, no second navigation.
    expect(ov.querySelector(".design-ov-chip, .design-ov-chips, .design-ov-notes, .design-ov-foot, .design-ov-dots")).toBeNull();
    expect(cards[0].querySelector(".design-ov-open"), "no open button: the tile is the control").toBeNull();
    expect(cards[0].querySelector(".design-ov-badge"), "no badge on the centre tile").toBeNull();
    expect(cards[0].querySelector(".design-ov-side .dz-icon")).not.toBeNull();
    // The preview is an inert clone outside every collector.
    const clone = cards[0].querySelector(".design-ov-scale");
    expect(clone.hasAttribute("inert")).toBe(true);
    expect(clone.dataset.deviceClone).toBeDefined();
    expect(clone.querySelector("[data-screen-link]")).toBeNull();
    expect(clone.querySelector("[id]:not([id^='ov1-'])")).toBeNull();
    // An author SVG is rebuilt from the allowlist — no script, no handler.
    const svg = cards[2].querySelector(".dz-icon svg");
    expect(svg).not.toBeNull();
    expect(svg.querySelector("script")).toBeNull();
    expect(svg.hasAttribute("onload")).toBe(false);
    expect(window.__pwned).toBeUndefined();
    // Header + quick nav replace indicator + switcher; the eye moved in.
    expect(document.querySelector("#design-header .design-header-name"), "no breadcrumb: the eye only").toBeNull();
    expect(document.querySelectorAll("#design-quick .design-quick-seg").length).toBe(3);
    expect(document.getElementById("anno-toggle").parentElement.classList.contains("design-header-eye")).toBe(true);
    // One tooltip per element. The name is on screen, so the tooltip holds
    // the keycap only (third feedback round: never repeat visible text).
    const seg = document.querySelector("#design-quick .design-quick-seg");
    expect(seg.dataset.tip).not.toContain("Design 2");
    expect(seg.dataset.tipKeyOnly).toBe("true");
    expect(seg.dataset.tipKey).toBe("1");
    expect(seg.querySelector("kbd")).toBeNull();
    // A neighbour click turns the carousel; the centre preview opens its design; Esc goes back.
    cards[1].querySelector(".design-ov-preview").click();
    expect(document.body.dataset.overviewActive, "a neighbour never opens").toBe("true");
    expect(cards[1].dataset.pos).toBe("cur");
    cards[1].querySelector(".design-ov-preview").click();
    expect(document.body.dataset.overviewActive).toBe("false");
    expect(activeDesign(document).dataset.design).toBe("d2b");
    expect(activeDesign(document).hidden).toBe(false);
    expect(document.querySelector("#screen-nav .screen-nav-overview-group").hidden, "the way back is the ☰ entry").toBe(false);
    key(window, document.body, { key: "Escape", code: "Escape" });
    expect(document.body.dataset.overviewActive).toBe("true");
  }, BOOT_TIMEOUT);

  test("a reload returns to the design the user was on, not to the overview", async () => {
    // One build for both lives: the fixture stamps a fresh pageVersion per
    // build, and a version change is a regenerated page (navigation keys
    // archived, drafts dropped) — not a reload.
    const html = page(2);
    const a = await boot(html);
    a.window.showDesign("d2b", "d2b-s2");
    const saved = stateOf(a.window);
    expect(JSON.parse(saved.blob)._overview).toBe("off");
    const b = await boot(html, saved);
    expect(b.document.body.dataset.overviewActive).toBe("false");
    expect(activeDesign(b.document).dataset.design).toBe("d2b");
    expect(b.document.getElementById("d2b-s2").hidden).toBe(false);
  }, BOOT_TIMEOUT);
});

/** The overlay star of a design, with the carousel turned to it first (a neighbour only turns). */
function starOf(window, document, id) {
  const slides = [...document.querySelectorAll("[data-design-overview] .design-ov-slide")];
  window.designOverviewGo(slides.findIndex((s) => s.dataset.designId === id));
  return document.querySelector(`.design-ov-slide[data-design-id="${id}"] .design-ov-star`);
}

describe("favourite — at most one, toggled until submit, in the payload", () => {
  test("overlay star sets, a second design swaps, a second click clears; payload.favorite follows", async () => {
    const { window, document } = await boot(page(3));
    const btn = (id) => starOf(window, document, id);
    expect(btn("d2b").hidden).toBe(false);
    expect(btn("d2b").textContent).toBe("☆");
    btn("d2b").click();
    expect(window.collectDecisions("iterate").favorite).toBe("d2b");
    expect(document.querySelector('.design-ov-slide[data-design-id="d2b"]').dataset.favorite).toBe("true");
    expect(btn("d2b").textContent).toBe("★");
    expect(document.querySelector("[data-design-overview]").dataset.hasFavorite).toBe("true");
    expect(document.querySelector('#design-quick .design-quick-seg[data-design-id="d2b"] .design-quick-star')).not.toBeNull();
    btn("d2c").click();
    expect(window.collectDecisions("iterate").favorite).toBe("d2c");
    expect(document.querySelectorAll('.design-ov-slide[data-favorite="true"]').length).toBe(1);
    // F on the overview toggles the CENTRE slide's design.
    key(window, document.body, { key: "f", code: "KeyF" });
    expect(window.collectDecisions("iterate").favorite).toBeNull();
    expect(document.querySelector("#design-quick .design-quick-star[data-state=\"on\"]")).toBeNull();
    // The chip keeps its EMPTY star (☆), never nothing: it says "not the favourite".
    expect(document.querySelector("#design-quick .design-quick-star[data-state=\"off\"]").textContent).toBe("☆");
    // F on a design page toggles that design; the raw store never reaches allFields.
    window.showDesign("d2");
    key(window, document.body, { key: "f", code: "KeyF" });
    const payload = window.collectDecisions("iterate");
    expect(payload.favorite).toBe("d2");
    expect(Object.keys(payload.allFields || {})).not.toContain("design-ov-store");
    expect(document.querySelector('#design-quick .design-quick-seg[data-design-id="d2"] .design-quick-star').hidden).toBe(false);
  }, BOOT_TIMEOUT);

  test("the favourite survives a reload (localStorage, like a note)", async () => {
    // One build for both lives — a new pageVersion is a different page,
    // which never inherits drafts (templates-persistence restoreState).
    const html = page(2);
    const a = await boot(html);
    starOf(a.window, a.document, "d2b").click();
    const b = await boot(html, stateOf(a.window));
    expect(b.window.collectDecisions("iterate").favorite).toBe("d2b");
    expect(b.document.querySelector('.design-ov-slide[data-design-id="d2b"]').dataset.favorite).toBe("true");
  }, BOOT_TIMEOUT);

  for (const set of [null, "topics"]) {
    test(`no favourite without data-design-set="alternatives" (${set || "unmarked"}): no star, no F, no header ★, payload null`, async () => {
      const strip = (html) => html.replace(/ data-design-set="alternatives"/g, set ? ` data-design-set="${set}"` : "");
      const { window, document, errors } = await boot(strip(page(3)));
      expect(errors).toEqual([]);
      expect([...document.querySelectorAll(".design-ov-star")].every((b) => b.hidden)).toBe(true);
      expect(document.querySelector("[data-design-overview]").dataset.favorites).toBe("false");
      key(window, document.body, { key: "f", code: "KeyF" });
      expect(window.collectDecisions("iterate").favorite).toBeNull();
      window.showDesign("d2b");
      expect(document.querySelector("#design-header .design-header-star")).toBeNull();
      key(window, document.body, { key: "f", code: "KeyF" });
      expect(window.collectDecisions("iterate").favorite).toBeNull();
      expect(document.querySelector('#design-quick .design-quick-star')).toBeNull();
    }, BOOT_TIMEOUT);
  }
});

describe("carousel — turns, overlay, no scrolling", () => {
  test("arrows and ←/→ turn the carousel (wrapping), never while typing; Enter opens the centre", async () => {
    const { window, document, errors } = await boot(page(3));
    expect(errors).toEqual([]);
    const ov = document.querySelector("[data-design-overview]");
    const cur = () => ov.querySelector('.design-ov-slide[data-pos="cur"]').dataset.designId;
    expect(cur()).toBe("d2");
    ov.querySelector('.design-ov-slide[data-pos="next"]').click();
    expect(cur()).toBe("d2b");
    key(window, document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(cur()).toBe("d2c");
    key(window, document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(cur(), "wraps around").toBe("d2");
    ov.querySelector('.design-ov-slide[data-pos="prev"]').click();
    expect(cur()).toBe("d2c");
    const ta = document.querySelector('#feedback-dock textarea[data-comment="general"]');
    ta.focus();
    key(window, ta, { key: "ArrowLeft", code: "ArrowLeft" });
    expect(cur(), "R4b: no hotkey in a text field").toBe("d2c");
    ta.blur();
    // Only the centre is in the tab order.
    expect(ov.querySelector('.design-ov-slide[data-pos="cur"] .design-ov-preview').tabIndex).toBe(0);
    expect(ov.querySelector('.design-ov-slide[data-pos="next"] .design-ov-preview').tabIndex).toBe(-1);
    const preview = ov.querySelector('.design-ov-slide[data-pos="cur"] .design-ov-preview');
    key(window, preview, { key: "Enter", code: "Enter" });
    expect(document.body.dataset.overviewActive).toBe("false");
    expect(activeDesign(document).dataset.design).toBe("d2c");
    // Back on the overview, the design the user came from is in the centre.
    window.showOverview();
    expect(cur()).toBe("d2c");
  }, BOOT_TIMEOUT);

  test("overlay is always bottom-left (data-design-overlay ignored); tone is authored per design", async () => {
    const html = page(3)
      .replace('<section data-design="d2b"', '<section data-design="d2b" data-design-overlay="tr" data-design-overlay-tone="warm"')
      .replace('<section data-design="d2c"', '<section data-design="d2c" data-design-overlay="middle"');
    const { document, errors } = await boot(html);
    expect(errors).toEqual([]);
    const o = (id) => document.querySelector(`.design-ov-slide[data-design-id="${id}"] .design-ov-overlay`);
    expect(o("d2").dataset.anchor).toBe("bl");
    expect(o("d2").dataset.tone).toBeUndefined();
    expect(o("d2b").dataset.anchor, "deprecated attribute ignored").toBe("bl");
    expect(o("d2b").dataset.tone).toBe("warm");
    expect(o("d2c").dataset.anchor, "an unknown anchor falls back").toBe("bl");
    const css = md.match(/```css\n([\s\S]*?)```/g).join("\n");
    expect(css).toContain('.design-ov-overlay[data-anchor="bl"]');
    expect(css).not.toContain('.design-ov-overlay[data-anchor="tr"]');
    expect(css).toContain('.design-ov-overlay[data-tone="warm"]');
  }, BOOT_TIMEOUT);

  test("no layers button next to the eye: the eye hides the info box; an old stored 'off' is ignored", async () => {
    const a = await boot(page(2));
    expect(a.document.querySelector("#design-header .design-header-overlay")).toBeNull();
    expect(a.document.querySelector("[data-design-overview]").dataset.overlay).toBe("on");
    const b = await boot(page(2), { key: "concept-ov-overlay:/", blob: "off" });
    expect(b.document.querySelector("[data-design-overview]").dataset.overlay, "no way back existed").toBe("on");
  }, BOOT_TIMEOUT);

  test("the overview never scrolls: no overflow-y, sized from the viewport", () => {
    const css = md.match(/```css\n([\s\S]*?)```/g).join("\n");
    const rule = /\[data-template="design"\] \.design-ov \{([^}]*)\}/.exec(css);
    expect(rule, ".design-ov rule").not.toBeNull();
    expect(rule[1]).toMatch(/overflow: hidden/);
    expect(rule[1]).not.toMatch(/overflow-y: auto|padding/);
    expect(css).toMatch(/\.design-ov-stage \{[^}]*container-type: size/);
    expect(css).toMatch(/--dz-ov-w: min\(78cqw, calc\(\(100cqh - 2 \* var\(--dz-ov-glow\)\) \* 1\.6\)\)/);
  });

  test("the quick nav's band ends before the header's real right edge", async () => {
    const { window, document } = await boot(page(3));
    const header = document.getElementById("design-header");
    Object.defineProperty(header, "offsetWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(header, "offsetLeft", { configurable: true, get: () => 16 });
    window.dispatchEvent(new window.Event("resize"));
    const vw = document.documentElement.clientWidth || window.innerWidth;
    expect(document.getElementById("design-quick").style.maxWidth).toBe(Math.floor(2 * (vw / 2 - 416 - 12)) + "px");
  }, BOOT_TIMEOUT);
});

describe("header — one row, never expands", () => {
  test("the header is fixed chrome outside <main> with a single row; hover only changes its opacity", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2");
    const header = document.getElementById("design-header");
    expect(header.closest("main")).toBeNull();
    expect([...header.children].map((c) => c.className)).toEqual(["design-header-main"]);
    expect(header.querySelector(".design-header-tabs, .design-fav-btn, .design-header-note")).toBeNull();
    // The row holds the eye slot and nothing else — besides the device
    // switch (third feedback round), which rides next to the eye.
    expect([...header.querySelector(".design-header-main").children].filter((n) => !/^viewport-/.test(n.id)).map((c) => c.className)).toEqual(["design-header-eye"]);
    const css = md.match(/```css\n([\s\S]*?)```/g).join("\n");
    expect(css).toMatch(/\.design-header \{\s*position: fixed;/);
    expect(css).not.toMatch(/\.design-header-more|\.design-header\[data-open/);
    expect(css, "no box, so no box hover").not.toMatch(/\.design-header:hover/);
  }, BOOT_TIMEOUT);

  test("no header ★: the favourite toggles with F and shows as the quick nav's ★", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2b");
    expect(document.querySelector("#design-header .design-header-back, #design-header .design-header-star")).toBeNull();
    key(window, document.body, { key: "f", code: "KeyF" });
    expect(window.collectDecisions("iterate").favorite).toBe("d2b");
    expect(document.querySelector('#design-quick .design-quick-seg[data-design-id="d2b"] .design-quick-star')).not.toBeNull();
    key(window, document.body, { key: "f", code: "KeyF" });
    expect(window.collectDecisions("iterate").favorite).toBeNull();
  }, BOOT_TIMEOUT);
});

describe("hotkeys never fire while focus is in a text field", () => {
  test("digits, Esc, F and N are ignored inside a textarea or an input, and work on the page", async () => {
    const { window, document } = await boot(page(3));
    window.showDesign("d2");
    const ta = document.querySelector('#feedback-dock textarea[data-comment="general"]');
    ta.focus();
    key(window, ta, { key: "2", code: "Digit2" });
    expect(activeDesign(document).dataset.design).toBe("d2");
    key(window, ta, { key: "Escape", code: "Escape" });
    expect(document.body.dataset.overviewActive).toBe("false");
    key(window, ta, { key: "f", code: "KeyF" });
    expect(window.collectDecisions("iterate").favorite).toBeNull();
    const input = document.createElement("input");
    document.getElementById("d2-s1").appendChild(input);
    input.focus();
    key(window, input, { key: "3", code: "Digit3" });
    expect(activeDesign(document).dataset.design).toBe("d2");
    key(window, input, { key: "Tab", code: "Tab" });
    expect(document.getElementById("d2-s1").hidden, "Tab inside a field moves focus, not the page").toBe(false);
    input.blur();
    ta.blur();
    key(window, document.body, { key: "2", code: "Digit2" });
    expect(activeDesign(document).dataset.design).toBe("d2b");
    key(window, document.body, { key: "Tab", code: "Tab" });
    expect(document.getElementById("d2b-s2").hidden, "Tab with nothing focused → next page").toBe(false);
    key(window, document.body, { key: "!", code: "Digit1", shiftKey: true });
    expect(activeDesign(document).dataset.design, "Shift+digit is the view binding, not a design").toBe("d2b");
    key(window, document.body, { key: "?", code: "Slash", shiftKey: true });
    expect(document.getElementById("design-keys").hidden).toBe(false);
  }, BOOT_TIMEOUT);
});

describe("Ctrl + click user pins", () => {
  async function placePin(p, text) {
    const { window, document } = p;
    window.showDesign("d2");
    const target = document.querySelector("#d2-s1 h1");
    target.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, clientX: 10, clientY: 10 }));
    const ta = document.querySelector("#d2-s1 .upin-editor textarea");
    expect(ta, "the editor opens on the spot").not.toBeNull();
    expect(document.querySelector("#d2-s1 .upin-editor").hidden).toBe(false);
    ta.value = text;
    key(window, ta, { key: "Enter", code: "Enter" });
    return target;
  }

  test("create → payload carries design, screen, position, target and text; Esc discards a new one", async () => {
    const p = await boot(page(2));
    await placePin(p, "Too loud here");
    const pins = p.window.collectDecisions("iterate").userPins;
    expect(pins.length).toBe(1);
    expect(pins[0]).toMatchObject({ design: "d2", screen: "d2-s1", text: "Too loud here" });
    expect(typeof pins[0].x).toBe("number");
    expect(typeof pins[0].y).toBe("number");
    expect(pins[0].target).toMatch(/^h1 "Welcome"/);
    expect(pins[0].id).toMatch(/^up-/);
    expect(p.document.querySelectorAll("#d2-s1 .upin").length).toBe(1);
    // A second pin discarded with Esc leaves nothing behind.
    p.document.querySelector("#d2-s1 p").dispatchEvent(new p.window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    const ta = [...p.document.querySelectorAll("#d2-s1 .upin-editor")].find((e) => !e.hidden).querySelector("textarea");
    ta.value = "never mind";
    key(p.window, ta, { key: "Escape", code: "Escape" });
    expect(p.document.querySelectorAll("#d2-s1 .upin").length).toBe(1);
    expect(p.window.collectDecisions("iterate").userPins.length).toBe(1);
    // A plain click never places a pin.
    p.document.querySelector("#d2-s1 p").dispatchEvent(new p.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(p.document.querySelectorAll("#d2-s1 .upin").length).toBe(1);
  }, BOOT_TIMEOUT);

  test("the editor stays inside a narrow screen (phone frame) instead of being clipped", async () => {
    const p = await boot(page(2));
    const { window } = p;
    // jsdom has no layout: a 300 × 600 host, the pin at (150, 100), and an
    // editor box derived from what placeEditor() set (flip + inline offsets).
    const W = 280, H = 120, PX = 150, PY = 100;
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
    const orig = window.Element.prototype.getBoundingClientRect;
    window.Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("upin-host")) return rect(0, 0, 300, 600);
      if (this.classList.contains("upin")) return rect(PX, PY, 26, 26);
      if (this.classList.contains("upin-editor")) {
        const wrap = this.parentElement;
        const w = parseFloat(this.style.width) || W;
        const left = this.style.left ? PX + parseFloat(this.style.left) : wrap.dataset.flipX ? PX - 32 - w : PX + 32;
        const top = this.style.top ? PY + parseFloat(this.style.top) : wrap.dataset.flipY ? PY - 30 - H : PY;
        return rect(left, top, w, H);
      }
      return orig.call(this);
    };
    window.showDesign("d2");
    p.document.querySelector("#d2-s1 h1").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    const r = p.document.querySelector("#d2-s1 .upin-editor").getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(8);
    expect(r.right).toBeLessThanOrEqual(292);
    window.Element.prototype.getBoundingClientRect = orig;
  }, BOOT_TIMEOUT);

  test("Ctrl + click on the overview's centre preview places the pin and opens that design (#887)", async () => {
    const p = await boot(page(2));
    const { window, document } = p;
    const slide = document.querySelector('.design-ov-slide[data-pos="cur"][data-design-id]');
    expect(slide, "the overview is on screen at boot").not.toBeNull();
    const preview = slide.querySelector(".design-ov-preview");
    const box = preview.querySelector(".design-ov-scale").firstElementChild;
    const h1 = box.querySelector("h1");
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
    const orig = window.Element.prototype.getBoundingClientRect;
    window.Element.prototype.getBoundingClientRect = function () {
      if (this === box) return rect(0, 0, 200, 100);
      if (this === h1) return rect(10, 10, 80, 20);
      return orig.call(this);
    };
    preview.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, clientX: 20, clientY: 20 }));
    window.Element.prototype.getBoundingClientRect = orig;
    expect(activeDesign(document).dataset.design).toBe(slide.dataset.designId);
    const ta = [...document.querySelectorAll(".upin-editor")].find((e) => !e.hidden).querySelector("textarea");
    ta.value = "From the overview";
    key(window, ta, { key: "Enter", code: "Enter" });
    const pin = window.collectDecisions("iterate").userPins[0];
    expect(pin).toMatchObject({ design: slide.dataset.designId, x: 10, y: 20, text: "From the overview" });
    expect(pin.screen).toMatch(/-s\d+$/);
    expect(pin.target).toMatch(/^h1/);
    expect(pin.target).not.toContain("ov");
  }, BOOT_TIMEOUT);

  test("a single-design round keeps a pin: store exists, payload and reload carry it (#907)", async () => {
    const html = page(1, { attrs: false });
    const p = await boot(html);
    const { window, document } = p;
    const id = document.querySelector("section[data-iteration][data-active] > section[data-design]").dataset.design;
    window.showDesign(id);
    expect(document.querySelector('textarea[data-engine-store="design-overview"]')).not.toBeNull();
    document.querySelector(`section[data-design="${id}"] h1`).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, clientX: 10, clientY: 10 }));
    const ta = [...document.querySelectorAll(".upin-editor")].find((e) => !e.hidden).querySelector("textarea");
    ta.value = "Solo note";
    key(window, ta, { key: "Enter", code: "Enter" });
    expect(window.designOverviewState().pins.map((x) => x.text)).toEqual(["Solo note"]);
    expect(window.collectDecisions("iterate").userPins.map((x) => x.text)).toEqual(["Solo note"]);
    const saved = stateOf(window);
    const b = await boot(html, saved);
    expect(b.window.collectDecisions("iterate").userPins.map((x) => x.text)).toEqual(["Solo note"]);
  }, BOOT_TIMEOUT);

  test("persisted like an annotation answer: restored on reload, under a text: key the bridge mirrors", async () => {
    const html = page(2);
    const a = await boot(html);
    await placePin(a, "Keep this");
    const saved = stateOf(a.window);
    const blob = JSON.parse(saved.blob);
    const k = Object.keys(blob).find((x) => /^text:i\d+:design-ov-store$/.test(x));
    expect(k, "a text: key, so the bridge draft mirror carries it").toBeTruthy();
    expect(JSON.parse(blob[k]).pins[0].text).toBe("Keep this");
    const b = await boot(html, saved);
    expect(b.document.body.dataset.overviewActive, "returns to the design").toBe("false");
    expect(b.document.querySelectorAll("#d2-s1 .upin").length).toBe(1);
    expect(b.window.collectDecisions("iterate").userPins[0].text).toBe("Keep this");
  }, BOOT_TIMEOUT);

  test("a frozen round shows its baked pins and favourite read-only", async () => {
    // Round 1 frozen with 2 designs and a frozen-feedback blob carrying both keys.
    let html = build({ rounds: 2, entries: 4, mode: "design", mapping: true, locale: "de", designs: 2, out: "" });
    const blob = { general: { text: "", attachments: [] }, favorite: "d1b",
      userPins: [{ id: "up-x", design: "d1", screen: "d1-s1", x: 40, y: 20, target: "h1", text: "frozen pin" }] };
    html = html.replace(/(<section id="iter-1"[^>]*>)/, `$1<script type="application/json" data-frozen-feedback>${JSON.stringify(blob)}</script>`);
    const { window, document } = await boot(html);
    expect(document.querySelector('section[data-iteration="1"] > section[data-design="d1b"]'), "--mapping freezes a 2-design round 1").not.toBeNull();
    document.querySelector('.iteration-tab[data-iteration="1"]').click();
    await tick(); await tick();
    window.showDesign("d1");
    expect(document.querySelectorAll("#d1-s1 .upin").length).toBe(1);
    expect(document.querySelector("#d1-s1 .upin-editor textarea").readOnly).toBe(true);
    const stars = [...document.querySelectorAll('section[data-iteration="1"] .design-ov-star')];
    expect(stars.length).toBeGreaterThan(0);
    expect(stars.every((b) => b.disabled), "frozen favourite is read-only").toBe(true);
  }, BOOT_TIMEOUT);
});

describe("bake + gate", () => {
  test("bake writes favorite (alternatives round only) and userPins into the frozen-feedback blob", () => {
    const frag = (set) => `<section data-iteration="1" data-iteration-template="design"${set}><section data-design="a"></section></section>`;
    const payload = { iteration: 1, allFields: {}, comments: { general: { text: "", attachments: [] } }, favorite: "a",
      userPins: [{ id: "up-1", design: "a", screen: "a-s1", x: 1, y: 2, target: "h1", text: "t" }] };
    const blobOf = (html) => JSON.parse(/data-frozen-feedback>([\s\S]*?)<\/script>/.exec(html)[1]);
    const json = blobOf(conceptBuild.bake(frag(' data-design-set="alternatives"'), payload).html);
    expect(json.favorite).toBe("a");
    expect(json.userPins[0].text).toBe("t");
    const topics = blobOf(conceptBuild.bake(frag(' data-design-set="topics"'), payload).html);
    expect(topics.favorite).toBeUndefined();
    expect(topics.userPins[0].text).toBe("t");
  });

  test("≥2 designs without motto / traits / icon / data-design-set → warnings, never a failure; one design or a complete set → none", () => {
    const it = (designs, set = ' data-design-set="alternatives"') => `<section data-iteration="1" data-iteration-template="design"${set}>${designs}</section>`;
    const bare = it('<section data-design="a" data-nav-label="A"></section><section data-design="b"></section>', "");
    const w = gate.findDesignAuthoringWarnings(bare);
    expect(w.map((x) => x.kind)).toEqual(["overview-set", "overview-authoring", "overview-authoring"]);
    expect(w[1].why).toMatch(/data-design-motto, data-design-traits, data-design-icon/);
    const odd = gate.findDesignAuthoringWarnings(it('<section data-design="a" data-design-overlay="mid" data-design-motto="M" data-design-traits="x | y | z" data-design-icon="leaf"></section><section data-design="b" data-design-motto="M" data-design-traits="x | y | z" data-design-icon="leaf"></section>', ' data-design-set="mixed"'));
    expect(odd.map((x) => x.kind)).toEqual(["overview-set", "overview-overlay"]);
    expect(gate.findDesignAuthoringWarnings(it('<section data-design="a"></section>'))).toEqual([]);
    const full = (id, traits = "x | y | z") => `<section data-design="${id}" data-design-motto="M" data-design-traits="${traits}" data-design-icon="leaf"></section>`;
    expect(gate.findDesignAuthoringWarnings(it(full("a") + full("b")))).toEqual([]);
    const two = gate.findDesignAuthoringWarnings(it(full("a") + full("b", "x | y")));
    expect(two.map((x) => x.kind)).toEqual(["overview-traits"]);
  });

  test("a `>` inside a quoted motto neither drops the design nor truncates its tag", () => {
    const it = (designs) => `<section data-iteration="1" data-iteration-template="design" data-design-set="topics">${designs}</section>`;
    const before = `<section data-design-motto="Fast -> simple" data-design="a" data-design-traits="x | y | z" data-design-icon="leaf"></section>`;
    const after = `<section data-design="b" data-design-motto="Slow -> calm" data-design-traits="x | y | z" data-design-icon="leaf"></section>`;
    expect(gate.findDesignAuthoringWarnings(it(before + after))).toEqual([]);
    const bare = gate.findDesignAuthoringWarnings(it(`<section data-design-motto="a > b" data-design="a"></section><section data-design="b"></section>`)).filter((x) => x.kind === "overview-authoring");
    expect(bare.map((x) => x.why.match(/design "(\w)"/)[1])).toEqual(["a", "b"]);
  });

  test("the engine anchors of the overview are in the reference (gate ENGINE_DESIGN)", () => {
    for (const e of gate.ENGINE_DESIGN) {
      expect(e.re ? e.re.test(md) : md.includes(e.token), e.token).toBe(true);
    }
  });
});

describe("☰ overview row, the eye on the overview, draggable pins", () => {
  const ANNO = '<div class="anno-layer" data-anno-layer><div class="anno" data-anno="a1" data-anno-side="right" style="--anno-x:40%;--anno-y:40%">'
    + '<button class="anno-pin" type="button" data-anno-pin="a1" aria-expanded="false">1</button>'
    + '<div class="anno-bubble" data-anno-bubble="a1" data-open="false"><button type="button" class="anno-bubble-summary" data-anno-summary="a1">'
    + '<span class="anno-bubble-question">Q?</span></button><div class="anno-bubble-body">'
    + '<textarea class="anno-answer" data-comment="anno-a1" data-annotation="a1"></textarea></div></div></div></div>';
  const withAnno = () => page(3).replace(/<section id="d2-s1"[^>]*>/, (m) => m + ANNO);

  test("the overview is the first ☰ row, marks itself active and opens the overview", async () => {
    const { window, document, errors } = await boot(page(3));
    expect(errors).toEqual([]);
    const row = document.querySelector("#screen-nav").firstElementChild.querySelector(".screen-nav-overview-item");
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("Übersicht");
    expect(row.dataset.active).toBe("true");
    window.showDesign("d2b");
    expect(row.dataset.active).toBe("false");
    row.click();
    expect(document.body.dataset.overviewActive).toBe("true");
    expect(row.dataset.active).toBe("true");
  }, BOOT_TIMEOUT);

  test("a single-design round shows no overview row", async () => {
    const { document } = await boot(page(1, { attrs: false }));
    const g = document.querySelector("#screen-nav .screen-nav-overview-group");
    expect(!g || g.hidden).toBe(true);
  }, BOOT_TIMEOUT);

  test("the eye in the overview header switches the layer off AND on again", async () => {
    const { document, errors } = await boot(withAnno());
    expect(errors).toEqual([]);
    expect(document.body.dataset.overviewActive).toBe("true");
    const eye = document.getElementById("anno-toggle");
    expect(eye.hidden).toBe(false);
    eye.click();
    expect(document.body.classList.contains("anno-hidden")).toBe(true);
    expect(eye.hidden, "the eye must stay reachable to bring the layer back").toBe(false);
    eye.click();
    expect(document.body.classList.contains("anno-hidden")).toBe(false);
  }, BOOT_TIMEOUT);

  test("a digit / quick-nav switch keeps the page; a missing page falls back to the first", async () => {
    const html = page(3).replace(/<section id="d2b-s3"[\s\S]*?<\/section>/, "");
    const { window, document, errors } = await boot(html);
    expect(errors).toEqual([]);
    window.showDesign("d2", "d2-s2");
    key(window, document.body, { key: "2", code: "Digit2" });
    expect(activeDesign(document).dataset.design).toBe("d2b");
    expect(document.getElementById("d2b-s2").hidden).toBe(false);
    document.querySelector('#design-quick .design-quick-seg[data-design-id="d2c"]').click();
    expect(document.getElementById("d2c-s2").hidden).toBe(false);
    window.showDesign("d2", "d2-s3");
    key(window, document.body, { key: "2", code: "Digit2" });
    expect(activeDesign(document).dataset.design).toBe("d2b");
    expect(document.getElementById("d2b-s1").hidden, "d2b has no page 3 → its first page").toBe(false);
  }, BOOT_TIMEOUT);

  test("a question view tied to a design maps to the target design's view at the same position", async () => {
    const views = '<section data-view="qa" data-view-for="d2" data-nav-label="Frage A" hidden><p>A</p></section>'
      + '<section data-view="qb" data-view-for="d2b" data-nav-label="Frage B" hidden><p>B</p></section>';
    const html = page(3).replace(/<section data-design="d2" /, (m) => views + m);
    const { window, document, errors } = await boot(html);
    expect(errors).toEqual([]);
    window.showView("qa");
    expect(document.body.dataset.viewActive).toBe("true");
    key(window, document.body, { key: "2", code: "Digit2" });
    expect(document.querySelector('section[data-view="qb"]').hidden, "d2b's own view at the same position").toBe(false);
    key(window, document.body, { key: "3", code: "Digit3" });
    expect(document.body.dataset.viewActive, "d2c has no view → its first page").toBe("false");
    expect(activeDesign(document).dataset.design).toBe("d2c");
    expect(document.getElementById("d2c-s1").hidden).toBe(false);
  }, BOOT_TIMEOUT);

  test("a dragged pin keeps its spot across a reload", async () => {
    const html = withAnno();
    const a = await boot(html);
    const anno = a.document.querySelector('[data-anno="a1"]');
    anno.dataset.annoMoved = "70.00,80.00";
    a.window.saveState();
    const saved = stateOf(a.window);
    expect(JSON.parse(saved.blob).annoPos).toEqual({ "2:a1": "70.00,80.00" });
    const b = await boot(html, saved);
    const restored = b.document.querySelector('[data-anno="a1"]');
    expect(restored.dataset.annoMoved).toBe("70.00,80.00");
    expect(restored.style.getPropertyValue("--anno-x")).toBe("70.00%");
    // Engine anchors: the threshold that keeps a wobbly click a click, and
    // anchorToTarget() yielding to the user's spot.
    expect(md).toContain("const PIN_DRAG_THRESHOLD = 10;");
    expect(md).toContain("if (anno.dataset.annoMoved) return;");
  }, BOOT_TIMEOUT);
});

describe("B4 visuals — bleed preview, variant numbers, active chip, demo and the chip's own favourite star", () => {
  test("a preview is one bleed clone (no mirror); the stage carries the design background and bleed flag", async () => {
    const { document } = await boot(page(3));
    const prev = document.querySelector(".design-ov-slide .design-ov-preview");
    expect(prev.querySelector(".design-ov-mirror")).toBeNull();
    expect(prev.querySelectorAll(".design-ov-scale").length).toBe(1);
    expect(document.querySelector("[data-design-overview]").dataset.bleed).toBe("true");
    const ids = [...prev.querySelectorAll("[id]")].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, BOOT_TIMEOUT);
  test("every variant shows its hotkey digit in the quick nav and the ☰ rows", async () => {
    const { document } = await boot(page(3));
    const nums = [...document.querySelectorAll("#design-quick .design-quick-seg .design-quick-n")].map((n) => n.textContent);
    expect(nums.length).toBeGreaterThan(0);
    expect(nums[0]).toBe("1 ·");
    const rows = [...document.querySelectorAll("#screen-nav .screen-nav-design-heading .screen-nav-n")].map((n) => n.textContent);
    expect(rows.slice(0, 2)).toEqual(["1 ·", "2 ·"]);
  }, BOOT_TIMEOUT);
  test("data-ov-demo marks the preview and its screen; absent → none", async () => {
    const html = page(3).replace('<section data-design="d2"', '<section data-design="d2" data-ov-demo="h1"');
    const { document } = await boot(html);
    const first = document.querySelector('.design-ov-slide[data-design-id="d2"] .design-ov-preview');
    const second = document.querySelector('.design-ov-slide[data-design-id="d2b"] .design-ov-preview');
    expect(first.dataset.demo).toBe("h1");
    expect(second.dataset.demo).toBeUndefined();
  }, BOOT_TIMEOUT);
  test("the chip shows an empty star while no favourite is set", async () => {
    const { document } = await boot(page(3));
    const stars = [...document.querySelectorAll("#design-quick .design-quick-seg .design-quick-star")];
    expect(stars.length).toBe(3);
    expect(stars.every((s) => s.dataset.state === "off" && s.textContent === "☆")).toBe(true);
  }, BOOT_TIMEOUT);
});

describe("note editor is never clipped by an overflow ancestor", () => {
  test("a pin at the top edge of an overflow:hidden screen opens its editor fully inside the visible area", async () => {
    const p = await boot(page(2));
    const { window, document } = p;
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
    const H = 120, W = 280, PX = 40, PY = 5;
    const screen = document.getElementById("d2-s1");
    const clip = screen.parentElement;
    clip.style.overflow = "hidden";
    const orig = window.Element.prototype.getBoundingClientRect;
    window.Element.prototype.getBoundingClientRect = function () {
      // The host box reaches above the clipping frame; only 0..400 is visible.
      if (this === clip) return rect(0, 0, 300, 400);
      if (this.classList.contains("upin-host")) return rect(0, -50, 300, 600);
      if (this.classList.contains("upin")) return rect(PX, PY, 26, 26);
      if (this.classList.contains("upin-editor")) {
        const wrap = this.parentElement;
        const w = parseFloat(this.style.width) || W;
        const h = Math.min(H, parseFloat(this.style.maxHeight) || H);
        const left = this.style.left ? PX + parseFloat(this.style.left) : wrap.dataset.flipX ? PX - 32 - w : PX + 32;
        const top = this.style.top ? PY + parseFloat(this.style.top) : wrap.dataset.flipY ? PY - 30 - h : PY;
        return rect(left, top, w, h);
      }
      return orig.call(this);
    };
    window.showDesign("d2");
    screen.querySelector("h1").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    const r = document.querySelector("#d2-s1 .upin-editor").getBoundingClientRect();
    window.Element.prototype.getBoundingClientRect = orig;
    expect(r.top, "top edge inside the clipping frame").toBeGreaterThanOrEqual(8);
    expect(r.bottom).toBeLessThanOrEqual(392);
    expect(r.left).toBeGreaterThanOrEqual(8);
    expect(r.right).toBeLessThanOrEqual(292);
  }, BOOT_TIMEOUT);
});

describe("quick-nav star on a variant chip", () => {
  const chip = (document, id) => document.querySelector(`#design-quick .design-quick-seg[data-design-id="${id}"]`);
  const star = (document, id) => chip(document, id).querySelector(".design-quick-star");

  test("a non-focused chip's star opens that variant and keeps the favourite; the focused one toggles it", async () => {
    const { window, document } = await boot(page(3));
    starOf(window, document, "d2b").click(); // favourite = d2b (overview)
    window.showDesign("d2");
    expect(activeDesign(document).dataset.design).toBe("d2");
    expect(star(document, "d2b").dataset.state).toBe("on");
    star(document, "d2b").click();
    expect(activeDesign(document).dataset.design, "the star opens the variant").toBe("d2b");
    expect(window.collectDecisions("iterate").favorite, "…and keeps the favourite").toBe("d2b");
    star(document, "d2b").click();
    expect(window.collectDecisions("iterate").favorite, "focused chip: toggles off").toBeNull();
    star(document, "d2b").click();
    expect(window.collectDecisions("iterate").favorite, "focused chip: toggles on").toBe("d2b");
  }, BOOT_TIMEOUT);

  test("pressing the star never turns the page of the active design", async () => {
    const { window, document } = await boot(page(3));
    window.showDesign("d2");
    const before = [...document.querySelectorAll("#d2 section[data-screen]")].find((s) => !s.hidden)?.id;
    const s = star(document, "d2");
    expect(s, "the active chip carries a star").not.toBeNull();
    s.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    const after = [...document.querySelectorAll("#d2 section[data-screen]")].find((x) => !x.hidden)?.id;
    expect(activeDesign(document).dataset.design).toBe("d2");
    expect(after).toBe(before);
  }, BOOT_TIMEOUT);
});
