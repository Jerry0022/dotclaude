import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// Sections C + D of the chrome-polish brief: header islands, FAB look, the
// eye (counter vs visibility), the notes dock (breadcrumb per field, tip
// pool), own pins (close-on-new, attachments, editing state) and anchoring
// that ignores transforms. Booted from the real assembled fixture, like
// chrome-hotkeys-nav.test.js.

const md = readTemplates();
const BOOT_TIMEOUT = 180_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

function page(designs, mode = "design") {
  return build({ rounds: 2, entries: 4, mode, mapping: false, locale: "de", designs, out: "" });
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
      // The staged-entrance class is removed again after ~3 s: record that it appeared.
      window.__introFirst = false;
      new window.MutationObserver(() => {
        if (window.document.body && window.document.body.classList.contains("dz-intro-first")) window.__introFirst = true;
      }).observe(window.document, { attributes: true, subtree: true, childList: true, attributeFilter: ["class"] });
      if (seed) window.localStorage.setItem(seed.key, seed.value);
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

const live = (d) => d.querySelector("section[data-iteration][data-active]");
const click = (window, n, init = {}) =>
  n.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ...init }));
const ctrlClick = (window, n) => click(window, n, { ctrlKey: true, clientX: 10, clientY: 10 });
const openEditors = (d) => [...d.querySelectorAll(".upin-editor")].filter((e) => !e.hidden);
const css = () => md.match(/```css\n([\s\S]*?)```/g).join("\n");

// Two notes on the active screen: one open, one answered.
function addAnnos(window, document, screen) {
  const layer = document.createElement("div");
  layer.className = "anno-layer";
  layer.setAttribute("data-anno-layer", "");
  const mk = (id, answered) =>
    `<div class="anno" data-anno="${id}" data-anno-target="#tgt-${id}">` +
    `<button type="button" class="anno-pin" data-anno-pin="${id}" aria-label="Frage">1</button>` +
    `<div class="anno-bubble" data-anno-bubble="${id}" data-open="false">` +
    `<button type="button" class="anno-bubble-summary" data-anno-summary="${id}">Q?</button>` +
    `<div class="anno-bubble-body"><textarea class="anno-answer" data-annotation data-comment="${id}-a">${answered ? "ja" : ""}</textarea></div>` +
    `</div></div>`;
  layer.innerHTML = mk("n1", false) + mk("n2", true);
  screen.appendChild(layer);
  for (const id of ["n1", "n2"]) {
    const t = document.createElement("div");
    t.id = "tgt-" + id;
    screen.appendChild(t);
  }
  window.updateAnnoUI();
  return layer;
}
const screenOf = (d) =>
  live(d).querySelector(":scope > section[data-design][data-design-active='true'] section[data-screen][data-screen-active='true']");

describe("C · header islands and FABs", () => {
  test("FABs and header are islands: filled, glow, no frame; no 📍 in the header", async () => {
    const { window, document, errors } = await boot(page(2));
    expect(errors).toEqual([]);
    const fab = /\.panel-fab,\s*\.feedback-fab \{([^}]*)\}/.exec(css())[1];
    expect(fab).toMatch(/border-radius: 18px/);
    expect(fab).not.toMatch(/border-radius: 50%/);
    expect(fab).toMatch(/linear-gradient/);
    expect(fab).toMatch(/box-shadow: 0 0 22px/);
    const header = /\.design-header \{([^}]*)\}/.exec(css())[1];
    expect(header).toMatch(/border: 0/);
    expect(header).not.toMatch(/border-left|border: 1px/);
    // No island any more: the corner is the bare eye.
    expect(header).toMatch(/background: transparent; box-shadow: none/);
    window.showDesign("d2");
    expect(document.querySelector("#design-header .design-header-pin")).toBeNull();
    expect(document.querySelector("#design-header .design-header-eye")).not.toBeNull();
  }, BOOT_TIMEOUT);

  test("glow pulses on first open and new round, reduced motion switches every new animation off", () => {
    // The ☰ is navigation chrome now (no accent tile, no pulse); only 💬 glows.
    expect(md).toMatch(/body\.chrome-glow \.feedback-fab \{ animation: chromeGlow/);
    expect(md).not.toMatch(/body\.chrome-glow \.panel-fab/);
    expect(md).not.toMatch(/body\.chrome-glow \.design-header/);
    expect(md).toMatch(/if \(last && last !== now\) pulseChromeGlow\(\);/);
    const rm = md.match(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\}/g).join("\n");
    expect(rm).toMatch(/body\.chrome-glow \.feedback-fab/);
    expect(rm).toMatch(/\.anno-pin \{ animation: none; \}/);
  });

  test("header islands and FABs enter last and only on the very first open", async () => {
    const first = await boot(page(2));
    await tick();
    expect(first.window.__introFirst).toBe(true);
    expect(first.window.localStorage.getItem("concept-chrome-seen:/")).toBe("1");
    const again = await boot(page(2), { key: "concept-chrome-seen:/", value: "1" });
    await tick();
    expect(again.window.__introFirst).toBe(false);
    expect(css()).toMatch(/body\.dz-intro:not\(\.dz-intro-first\) #design-header[^{]*\{ animation: none; \}/);
    expect(css()).toMatch(/body\.dz-intro-first \.panel-fab, body\.dz-intro-first \.feedback-fab \{ animation: dz-intro-fade 0\.5s ease 2\.2s both/);
  }, BOOT_TIMEOUT);

  test("eye counter counts OPEN notes and hides at 0; the eye hides only when there is nothing to hide", async () => {
    const { window, document } = await boot(page(2));
    const eye = document.getElementById("anno-toggle");
    const badge = document.getElementById("anno-eye-count");
    window.showDesign("d2");
    // nothing to hide on a bare design page
    window.updateAnnoUI();
    expect(eye.hidden).toBe(true);
    // two notes, one answered
    addAnnos(window, document, screenOf(document));
    expect(eye.hidden).toBe(false);
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("1");
    // answering the last one: counter goes, eye stays
    const ta = document.querySelector('[data-anno="n1"] textarea');
    ta.value = "antwort";
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(badge.hidden).toBe(true);
    expect(eye.hidden).toBe(false);
    // layer switched off: the eye must stay reachable even if nothing is left
    document.body.classList.add("anno-hidden");
    document.querySelectorAll("[data-anno]").forEach((n) => n.remove());
    window.updateAnnoUI();
    expect(eye.hidden).toBe(false);
    // everything the eye hides, it hides (and nothing but header + FABs survive)
    expect(css()).toMatch(/body\.anno-hidden \.upin-layer, body\.anno-hidden \.design-ov-overlay, body\.anno-hidden \.design-ov-change \{ display: none !important; \}/);
    document.body.classList.remove("anno-hidden");
    // the overview always has its info box to hide
    window.showOverview();
    window.updateAnnoUI();
    expect(eye.hidden).toBe(false);
  }, BOOT_TIMEOUT);

  test("eye counter: the current page's notes only, neither answered nor opened; the overview counts none", async () => {
    const { window, document } = await boot(page(2));
    const badge = document.getElementById("anno-eye-count");
    window.showDesign("d2");
    addAnnos(window, document, screenOf(document));
    expect(badge.textContent).toBe("1");
    // the overview owns no notes: no sum of every design's notes
    window.showOverview();
    window.updateAnnoUI();
    expect(badge.hidden).toBe(true);
    // a question view owns none either
    window.showDesign("d2");
    window.updateAnnoUI();
    expect(badge.textContent).toBe("1");
    expect(badge.hidden).toBe(false);
    // opened once = seen
    document.querySelector('[data-anno-pin="n1"]').click();
    window.updateAnnoUI();
    expect(badge.hidden).toBe(true);
  }, BOOT_TIMEOUT);
});

describe("D · notes dock", () => {
  test("breadcrumb per field: three, two, one levels; single design drops the variant level", async () => {
    const { document } = await boot(page(2));
    const crumbs = [...document.querySelectorAll("#feedback-dock .dock-crumb")];
    expect(crumbs.length).toBe(4);
    const levels = (c) => c.querySelectorAll(".dock-crumb-lv, strong").length;
    const [screen, design, , general] = crumbs;
    expect(levels(screen)).toBe(3);                       // Concept › Variante › Seite
    expect(screen.querySelector("#dock-screen-idx")).not.toBeNull();
    expect(levels(design)).toBe(2);                       // Concept › Variante
    expect(levels(general)).toBe(1);                      // Concept
    expect(general.querySelector(".dock-crumb-last")).not.toBeNull();
    for (const c of crumbs) expect(c.querySelector(".dock-tag").textContent.trim()).not.toBe("");
    expect(screen.querySelector(".dock-tag").textContent).toBe("diese Seite");
    expect(design.querySelector(".dock-tag").textContent).toBe("ganze Variante");
    expect(general.querySelector(".dock-tag").textContent).toBe("allgemein");
    expect(css()).toMatch(/body\[data-single-design="true"\] \.feedback-dock \.dock-scope \{ display: none; \}/);
  }, BOOT_TIMEOUT);

  test("plain mode (no designs): the dock holds the single general level", async () => {
    const { document, errors } = await boot(page(0, "decision"));
    expect(errors).toEqual([]);
    const crumbs = [...document.querySelectorAll("#feedback-dock .dock-crumb")];
    expect(crumbs.length).toBe(1);
    expect(crumbs[0].querySelectorAll(".dock-crumb-lv, strong").length).toBe(1);
    expect(document.querySelector("#feedback-dock .dock-scope")).toBeNull();
  }, BOOT_TIMEOUT);

  test("the 'Wusstest du schon?' tip is a different static fact on every open, in plain mode too", async () => {
    for (const html of [page(2), page(0, "decision")]) {
      const { window, document } = await boot(html);
      const toggle = document.getElementById("feedback-toggle");
      const seen = [];
      for (let i = 0; i < 6; i++) {
        click(window, toggle);
        const text = document.querySelector("#dock-tip .dock-tip-text").textContent;
        expect(text.length).toBeGreaterThan(10);
        seen.push(text);
        click(window, toggle);
      }
      for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
      expect(document.querySelector("#dock-tip b").textContent).toContain("Wusstest du schon?");
    }
  }, BOOT_TIMEOUT);

  test("tip index never repeats the last one and the pool is large, equal in both locales", async () => {
    const { window } = await boot(page(2));
    for (const rand of [0, 0.2, 0.5, 0.999999]) {
      for (let last = -1; last < 5; last++) {
        const n = window.nextDockTipIndex(5, last, rand);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(5);
        if (last >= 0) expect(n).not.toBe(last);
      }
    }
    const pool = window.DOCK_TIPS;
    expect(pool.de.length).toBe(pool.en.length);
    expect(pool.de.length).toBeGreaterThanOrEqual(95);
    for (const t of [...pool.de, ...pool.en]) expect(t).not.toMatch(/Claude|\bAI\b|\bKI\b/);
    expect(new Set(pool.de).size).toBe(pool.de.length);
  }, BOOT_TIMEOUT);

  test("no Kommentar / Anmerkung in the dock, anno and upin strings (de)", () => {
    const rows = md.split("\n").filter((l) => /^\| `(dock|anno|design\.(upin|keys_pin|feedback_)|proto\.feedback_general)/.test(l));
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) expect(r).not.toMatch(/Kommentar|Anmerkung|comment/i);
  });
});

describe("D · pins", () => {
  async function withPin(html = page(2)) {
    const p = await boot(html);
    p.window.showDesign("d2");
    return p;
  }

  test("pins are glow bubbles without number or border; answered shows a bold check", () => {
    const c = css();
    const pin = /(?:^|\n)\.anno-pin \{([^}]*)\}/.exec(c)[1];
    expect(pin).toMatch(/font-size: 0/);
    expect(pin).toMatch(/border: 0/);
    expect(c).toMatch(/\.anno-pin\[data-answered="true"\]::after \{ content: '✓'/);
    const upin = /(?:^|\n)\.upin-pin \{([^}]*)\}/.exec(c)[1];
    expect(upin).toMatch(/border: 0/);
    expect(upin).toMatch(/cursor: grab/);
    expect(c).not.toMatch(/\.upin-pin \{[^}]*font:/);
  });

  test("opening an own pin closes the open one — and an open note bubble — and keeps the typed text", async () => {
    const { window, document } = await withPin();
    const screen = screenOf(document);
    addAnnos(window, document, screen);
    click(window, document.querySelector('[data-anno-pin="n1"]'));
    expect(document.querySelector('[data-anno-bubble="n1"]').dataset.open).toBe("true");
    ctrlClick(window, screen.querySelector("p, h1, div"));
    expect(document.querySelector('[data-anno-bubble="n1"]').dataset.open).toBe("false");
    expect(openEditors(document).length).toBe(1);
    openEditors(document)[0].querySelector("textarea").value = "erste";
    // a second Ctrl + click closes the first editor (saving its text) and opens a new one
    ctrlClick(window, screen.querySelector("p, h1, div"));
    expect(openEditors(document).length).toBe(1);
    expect(window.collectDecisions("iterate").userPins.map((p) => p.text)).toEqual(["erste"]);
  }, BOOT_TIMEOUT);

  test("an own pin takes attachments: data-attachable + slot, mounted bar, collected in the payload", async () => {
    const { window, document } = await withPin();
    const screen = screenOf(document);
    ctrlClick(window, screen.querySelector("p, h1, div"));
    const ed = openEditors(document)[0];
    const ta = ed.querySelector("textarea");
    expect(ta.hasAttribute("data-attachable")).toBe(true);
    const slotKey = ta.id;
    expect(slotKey).toMatch(/^upin-ta-up-/);
    expect(ed.querySelector(`.attach-slot[data-attach-slot="${slotKey}"] .attach-bar`)).not.toBeNull();
    ta.value = "mit Bild";
    ta.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const id = slotKey.replace("upin-ta-", "");
    window.eval(`_attachments.set(${JSON.stringify(slotKey)}, [{ key: 'k1', slot: ${JSON.stringify(slotKey)}, id: 'abc123', name: 'a.png', mime: 'image/png', size: 3, synced: true }])`);
    const pins = window.collectDecisions("iterate").userPins;
    expect(pins.length).toBe(1);
    expect(pins[0].id).toBe(id);
    expect(pins[0].attachments.map((a) => a.id)).toEqual(["abc123"]);
  }, BOOT_TIMEOUT);

  test("while a pin's input is open every other note loses its connector and its pin fades", async () => {
    const { window, document } = await withPin();
    const screen = screenOf(document);
    const layer = addAnnos(window, document, screen);
    expect(document.body.dataset.noteEditing).toBeUndefined();
    ctrlClick(window, screen.querySelector("p, h1, div"));
    window.syncNoteEditing();
    expect(document.body.dataset.noteEditing).toBe("true");
    expect(document.querySelector(".upin").dataset.editing).toBe("true");
    expect(layer.querySelectorAll('.anno[data-editing="true"]').length).toBe(0);
    // an annotation bubble being open is "editing" as well
    openEditors(document).forEach((e) => { e.hidden = true; });
    click(window, document.querySelector('[data-anno-pin="n1"]'));
    window.syncNoteEditing();
    expect(document.querySelector('[data-anno="n1"]').dataset.editing).toBe("true");
    expect(document.querySelector('[data-anno="n2"]').dataset.editing).toBeUndefined();
    click(window, document.body);
    window.syncNoteEditing();
    expect(document.body.dataset.noteEditing).toBeUndefined();
    expect(css()).toMatch(/body\[data-note-editing="true"\] \.anno:not\(\[data-editing="true"\]\) \.anno-bubble \{ display: none; \}/);
    expect(css()).toMatch(/\.upin:not\(\[data-editing="true"\]\) \.upin-pin \{ opacity: 0\.35/);
  }, BOOT_TIMEOUT);

  test("the whole own pin is draggable (no handle) and the spot is persisted", async () => {
    const { window, document } = await withPin();
    const screen = screenOf(document);
    ctrlClick(window, screen.querySelector("p, h1, div"));
    const ta = openEditors(document)[0].querySelector("textarea");
    ta.value = "verschieb mich";
    ta.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const wrap = document.querySelector(".upin");
    expect(wrap.querySelector(".upin-grip, .upin-handle")).toBeNull();
    const host = document.querySelector(".upin-host");
    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 });
    const btn = wrap.querySelector(".upin-pin");
    const ev = (type, x, y) => {
      const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(e, "pointerId", { value: 1 });
      return e;
    };
    btn.dispatchEvent(ev("pointerdown", 5, 5));
    document.dispatchEvent(ev("pointermove", 100, 50));
    document.dispatchEvent(ev("pointerup", 100, 50));
    const pin = window.collectDecisions("iterate").userPins[0];
    expect(pin.x).toBe(50);
    expect(pin.y).toBe(50);
  }, BOOT_TIMEOUT);
});

describe("D · robust anchoring", () => {
  test("a note hangs on the element's LAYOUT box: transforms do not move it, typing freezes it", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2");
    const screen = screenOf(document);
    const layer = addAnnos(window, document, screen);
    const tgt = document.getElementById("tgt-n1");
    const def = (n, o) => Object.entries(o).forEach(([k, v]) => Object.defineProperty(n, k, { configurable: true, get: () => v }));
    def(layer, { offsetWidth: 400, offsetHeight: 200, offsetLeft: 0, offsetTop: 0, offsetParent: null, clientLeft: 0, clientTop: 0 });
    def(tgt, { offsetWidth: 50, offsetHeight: 20, offsetLeft: 100, offsetTop: 40, offsetParent: null, clientLeft: 0, clientTop: 0 });
    // the painted rect says something completely different (a transform mid-animation)
    tgt.getBoundingClientRect = () => ({ left: 900, top: 700, right: 950, bottom: 720, width: 50, height: 20 });
    layer.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 });
    window.updateAnnoUI();
    const anno = document.querySelector('[data-anno="n1"]');
    expect(anno.style.getPropertyValue("--anno-x")).toBe("37.50%");   // (100 + 50) / 400
    expect(anno.style.getPropertyValue("--anno-y")).toBe("25.00%");   // (40 + 10) / 200
    // typing in the note: the position is frozen even if the layout moved on
    const ta = anno.querySelector("textarea");
    ta.focus();
    expect(anno.contains(document.activeElement)).toBe(true);
    def(tgt, { offsetWidth: 50, offsetHeight: 20, offsetLeft: 300, offsetTop: 100, offsetParent: null, clientLeft: 0, clientTop: 0 });
    window.updateAnnoUI();
    expect(anno.style.getPropertyValue("--anno-x")).toBe("37.50%");
    ta.blur();
    window.updateAnnoUI();
    expect(anno.style.getPropertyValue("--anno-x")).toBe("87.50%");
  }, BOOT_TIMEOUT);
});
