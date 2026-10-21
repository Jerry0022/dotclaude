import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// The variant overview (templates-design.md § Variant overview (≥2 designs)):
// a design round with two or more designs gets an engine-built overview as
// its first top-level item, a header (top left) and a quick nav (top centre)
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

describe("variant overview — generated only for ≥2 designs", () => {
  test("a single-design round renders as before: no overview, no header, the eye stays where the markup put it", async () => {
    const { document, errors } = await boot(page(1, { attrs: false }));
    expect(errors).toEqual([]);
    expect(document.body.dataset.overview).toBe("false");
    expect(document.querySelector("[data-design-overview]")).toBeNull();
    expect(document.getElementById("design-header").children.length).toBe(0);
    expect(document.getElementById("design-quick").children.length).toBe(0);
    expect(document.getElementById("anno-toggle").parentElement.classList.contains("design-header-eye")).toBe(false);
    expect(document.body.dataset.overviewActive).not.toBe("true");
    const payload = document.defaultView.collectDecisions("iterate");
    expect(payload.favorite).toBeNull();
    expect(payload.userPins).toEqual([]);
  }, BOOT_TIMEOUT);

  test("three designs: one card each, the overview is the first top-level item and the boot lands on it", async () => {
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
    const cards = [...ov.querySelectorAll(".design-ov-card")];
    expect(cards.map((c) => c.dataset.designId)).toEqual(["d2", "d2b", "d2c"]);
    expect(cards[0].querySelector(".design-ov-motto").textContent).toBe("Weniger ist Ruhe.");
    expect([...cards[0].querySelectorAll(".design-ov-traits li")].map((li) => li.textContent)).toEqual(["Ein Ziel pro Tag", "Pflanze", "Keine Pushes"]);
    expect(cards[0].style.getPropertyValue("--dz-color")).toBe("#5f8b6a");
    expect(cards[0].querySelectorAll(".design-ov-chip").length, "one chip per page").toBe(3);
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
    expect(document.querySelector("#design-header .design-header-name").textContent).toBe("Übersicht");
    expect(document.querySelectorAll("#design-quick .design-quick-seg").length).toBe(3);
    expect(document.getElementById("anno-toggle").parentElement.classList.contains("design-header-eye")).toBe(true);
    // One tooltip per element: label + key in data-tip / data-tip-key.
    const seg = document.querySelector("#design-quick .design-quick-seg");
    expect(seg.dataset.tip).toBe("Design 2");
    expect(seg.dataset.tipKey).toBe("1");
    expect(seg.querySelector("kbd")).toBeNull();
    // The card opens its design; Esc goes back.
    cards[1].querySelector(".design-ov-preview").click();
    expect(document.body.dataset.overviewActive).toBe("false");
    expect(activeDesign(document).dataset.design).toBe("d2b");
    expect(activeDesign(document).hidden).toBe(false);
    expect(document.querySelector("#design-header .design-header-back").hidden).toBe(false);
    key(window, document.body, { key: "Escape", code: "Escape" });
    expect(document.body.dataset.overviewActive).toBe("true");
  }, BOOT_TIMEOUT);

  test("a reload returns to the design the user was on, not to the overview", async () => {
    // One build for both lives: the fixture stamps a fresh pageVersion per
    // build, and a version change is a regenerated page (navigation keys
    // dropped, notes carried over) — not a reload.
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

describe("favourite — at most one, toggled until submit, in the payload", () => {
  test("card button sets, a second design swaps, a second click clears; payload.favorite follows", async () => {
    const { window, document } = await boot(page(3));
    const btn = (id) => document.querySelector(`.design-ov-card[data-design-id="${id}"] .design-fav-btn`);
    btn("d2b").click();
    expect(window.collectDecisions("iterate").favorite).toBe("d2b");
    expect(document.querySelector('.design-ov-card[data-design-id="d2b"]').dataset.favorite).toBe("true");
    expect(document.querySelector('.design-ov-card[data-design-id="d2b"] .design-ov-badge').hidden).toBe(false);
    expect(document.querySelector(".design-ov-grid").dataset.hasFavorite).toBe("true");
    expect(document.querySelector("#design-header .design-header-star").textContent).toBe("★ Design 2 B");
    btn("d2c").click();
    expect(window.collectDecisions("iterate").favorite).toBe("d2c");
    expect(document.querySelectorAll('.design-ov-card[data-favorite="true"]').length).toBe(1);
    btn("d2c").click();
    expect(window.collectDecisions("iterate").favorite).toBeNull();
    expect(document.querySelector("#design-header .design-header-star").hidden).toBe(true);
    // F on a design page toggles that design; the raw store never reaches allFields.
    window.showDesign("d2");
    key(window, document.body, { key: "f", code: "KeyF" });
    const payload = window.collectDecisions("iterate");
    expect(payload.favorite).toBe("d2");
    expect(Object.keys(payload.allFields || {})).not.toContain("design-ov-store");
    expect(document.querySelector("#design-header .design-header-star").textContent).toBe("★");
    expect(document.querySelector('#design-quick .design-quick-seg[data-design-id="d2"] .design-quick-star').hidden).toBe(false);
  }, BOOT_TIMEOUT);

  test("the favourite survives a reload (localStorage, like a note)", async () => {
    const a = await boot(page(2));
    a.document.querySelector('.design-ov-card[data-design-id="d2b"] .design-fav-btn').click();
    const b = await boot(page(2), stateOf(a.window));
    expect(b.window.collectDecisions("iterate").favorite).toBe("d2b");
    expect(b.document.querySelector('.design-ov-card[data-design-id="d2b"]').dataset.favorite).toBe("true");
  }, BOOT_TIMEOUT);
});

describe("header — expands over the content, never shifts it", () => {
  test("the header is fixed chrome outside <main>; opening it changes nothing in the content box", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2");
    const header = document.getElementById("design-header");
    expect(header.closest("main")).toBeNull();
    const box = document.getElementById("d2-s1").firstElementChild;
    const snapshot = () => [box.getBoundingClientRect().top, box.getAttribute("style"), document.getElementById("d2-s1").getAttribute("style"),
      document.querySelector("main").getAttribute("style")];
    const before = snapshot();
    header.dataset.open = "true";
    expect(snapshot()).toEqual(before);
    // The rules behind it: fixed position, expanded state touches no geometry
    // of anything but the header itself (real-browser measurement: content top
    // 232px before and after, header 230×41 → 512×119).
    const css = md.match(/```css\n([\s\S]*?)```/g).join("\n");
    expect(css).toMatch(/\.design-header \{\s*position: fixed;/);
    const expanded = /\.design-header:hover, \.design-header:focus-within, \.design-header\[data-open="true"\] \{([^}]*)\}/.exec(css);
    expect(expanded, "expanded-state rule").not.toBeNull();
    expect(expanded[1]).not.toMatch(/position|top:|left:|margin/);
  }, BOOT_TIMEOUT);

  test("collapsed: icon + name, ★ only for the favourite; the back item has no arrow", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2b");
    const back = document.querySelector("#design-header .design-header-back");
    expect(back.textContent.trim()).toBe("Übersicht");
    expect(back.textContent).not.toMatch(/[‹<←]/);
    expect(document.querySelector("#design-header .design-header-star").hidden).toBe(true);
    expect(document.querySelector("#design-header .design-header-name").textContent).toBe("Design 2 B");
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
    expect(document.querySelector("#design-header .design-fav-btn").disabled).toBe(true);
  }, BOOT_TIMEOUT);
});

describe("bake + gate", () => {
  test("bake writes favorite and userPins into the frozen-feedback blob", () => {
    const frag = '<section data-iteration="1" data-iteration-template="design"><section data-design="a"></section></section>';
    const payload = { iteration: 1, allFields: {}, comments: { general: { text: "", attachments: [] } }, favorite: "a",
      userPins: [{ id: "up-1", design: "a", screen: "a-s1", x: 1, y: 2, target: "h1", text: "t" }] };
    const { html } = conceptBuild.bake(frag, payload);
    const json = JSON.parse(/data-frozen-feedback>([\s\S]*?)<\/script>/.exec(html)[1]);
    expect(json.favorite).toBe("a");
    expect(json.userPins[0].text).toBe("t");
  });

  test("≥2 designs without motto / traits / icon → warnings, never a failure; one design or a complete set → none", () => {
    const it = (designs) => `<section data-iteration="1" data-iteration-template="design">${designs}</section>`;
    const bare = it('<section data-design="a" data-nav-label="A"></section><section data-design="b"></section>');
    const w = gate.findDesignAuthoringWarnings(bare);
    expect(w.length).toBe(2);
    expect(w[0].why).toMatch(/data-design-motto, data-design-traits, data-design-icon/);
    expect(gate.findDesignAuthoringWarnings(it('<section data-design="a"></section>'))).toEqual([]);
    const full = (id, traits = "x | y | z") => `<section data-design="${id}" data-design-motto="M" data-design-traits="${traits}" data-design-icon="leaf"></section>`;
    expect(gate.findDesignAuthoringWarnings(it(full("a") + full("b")))).toEqual([]);
    const two = gate.findDesignAuthoringWarnings(it(full("a") + full("b", "x | y")));
    expect(two.map((x) => x.kind)).toEqual(["overview-traits"]);
  });

  test("a `>` inside a quoted motto neither drops the design nor truncates its tag", () => {
    const it = (designs) => `<section data-iteration="1" data-iteration-template="design">${designs}</section>`;
    const before = `<section data-design-motto="Fast -> simple" data-design="a" data-design-traits="x | y | z" data-design-icon="leaf"></section>`;
    const after = `<section data-design="b" data-design-motto="Slow -> calm" data-design-traits="x | y | z" data-design-icon="leaf"></section>`;
    expect(gate.findDesignAuthoringWarnings(it(before + after))).toEqual([]);
    const bare = gate.findDesignAuthoringWarnings(it(`<section data-design-motto="a > b" data-design="a"></section><section data-design="b"></section>`));
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
