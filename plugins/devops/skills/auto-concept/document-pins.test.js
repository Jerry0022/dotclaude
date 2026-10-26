import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// Document pins: own Ctrl + click notes in decision / free rounds
// (templates-free-pins.md § Document pins). Booted from the real assembled
// fixture, like chrome-islands-notes.test.js. jsdom has no layout, so
// positions are not asserted — the store, the anchor, the payload, the
// frozen render, the eye and the ? overlay are.

const require = createRequire(import.meta.url);
const md = readTemplates();
const BOOT_TIMEOUT = 180_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

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
      window.Element.prototype.getClientRects = function () { return [{}]; };
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

const fixture = (mode, extra = {}) => build({ rounds: 2, entries: 4, mode, mapping: false, locale: "de", designs: 1, out: "", ...extra });
const live = (d) => d.querySelector("section[data-iteration][data-active]");
const ctrlClick = (window, n) =>
  n.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ctrlKey: true, clientX: 10, clientY: 10 }));
const key = (window, target, init, type = "keydown") =>
  target.dispatchEvent(new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
const editorOf = (d) => [...d.querySelectorAll(".dpin-layer .upin-editor")].find((e) => !e.hidden);

function typeAndSave(window, d, text) {
  const ta = editorOf(d).querySelector("textarea");
  ta.value = text;
  key(window, ta, { key: "Enter", code: "Enter" });
}

describe("document pins · set, save, payload", () => {
  test("Ctrl + click on a paragraph opens a note editor with attachments; Enter saves it into the payload", async () => {
    const { window, document, errors } = await boot(fixture("decision"));
    expect(errors).toEqual([]);
    expect(window.documentPinsActive()).toBe(true);
    const store = live(document).querySelector(':scope > textarea[data-engine-store="doc-pins"]');
    expect(store).not.toBeNull();
    const p = live(document).querySelector("section[id]:not([data-iteration]) p");
    const sectionId = p.closest("section[id]").id;
    ctrlClick(window, p);
    const ed = editorOf(document);
    expect(ed, "the editor of the new pin is open").toBeTruthy();
    expect(ed.querySelector("textarea[data-attachable]")).not.toBeNull();
    expect(ed.querySelector(".attach-slot")).not.toBeNull();
    typeAndSave(window, document, "Das genauer belegen");
    expect(editorOf(document)).toBeUndefined();
    const pins = window.collectDecisions("iterate").userPins;
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({
      design: "", screen: sectionId, text: "Das genauer belegen", attachments: [],
      anchor: { section: sectionId, kind: "p", index: 0 },
    });
    expect(pins[0].anchor.text.length).toBeGreaterThan(5);
    expect(JSON.parse(store.value).pins).toHaveLength(1);
    // the raw store is not a form field of the payload
    expect(Object.keys(window.collectDecisions("iterate").allFields).join()).not.toMatch(/doc-pins-store/);
  }, BOOT_TIMEOUT);

  test("an empty note is discarded; Esc discards the draft", async () => {
    const { window, document } = await boot(fixture("decision"));
    const p = live(document).querySelector("section[id]:not([data-iteration]) p");
    ctrlClick(window, p);
    const ta = editorOf(document).querySelector("textarea");
    key(window, ta, { key: "Escape", code: "Escape" });
    expect(document.querySelectorAll(".dpin-layer .upin")).toHaveLength(0);
    expect(window.collectDecisions("iterate").userPins).toEqual([]);
  }, BOOT_TIMEOUT);

  test("a list item and a table row anchor by kind; a link or button keeps its native Ctrl + click", async () => {
    const { window, document } = await boot(fixture("decision"));
    const sec = live(document).querySelector("section[id]");
    sec.insertAdjacentHTML("beforeend",
      '<ul><li id="li-a">Punkt A</li></ul><table><tbody><tr><td><p>Zelle X</p></td><td>Y</td></tr></tbody></table><p><a href="#x" id="lnk">Link</a></p>');
    ctrlClick(window, document.getElementById("li-a"));
    typeAndSave(window, document, "Listennotiz");
    const cellP = sec.querySelector("td p");
    ctrlClick(window, cellP);
    typeAndSave(window, document, "Zeilennotiz");
    const lnk = document.getElementById("lnk");
    const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    lnk.dispatchEvent(ev);
    expect(ev.defaultPrevented, "a link is never hijacked").toBe(false);
    const pins = window.collectDecisions("iterate").userPins;
    expect(pins.map((q) => q.anchor.kind)).toEqual(["li", "tr"]);
    expect(pins[0].anchor.ref).toBe("li-a");
    expect(pins[1].anchor.text).toBe("Zelle X | Y");
  }, BOOT_TIMEOUT);

  test("pins survive a refresh from the store (reload path) and re-resolve after the document changed", async () => {
    const { window, document } = await boot(fixture("decision"));
    const sec = live(document).querySelector("section[id]");
    const ps = sec.querySelectorAll("p");
    ctrlClick(window, ps[1]);
    typeAndSave(window, document, "zweiter Absatz");
    const text = ps[1].textContent;
    // a new paragraph before it shifts the index; the text still finds it
    const extra = document.createElement("p");
    extra.textContent = "neu davor";
    ps[0].before(extra);
    window.refreshDocumentPins();
    expect(document.querySelectorAll(".dpin-layer .upin")).toHaveLength(1);
    const pin = window.collectDecisions("iterate").userPins[0];
    expect(pin.anchor.index).toBe(1);
    expect(pin.anchor.text).toBe(text.replace(/\s+/g, " ").trim().slice(0, 80));
  }, BOOT_TIMEOUT);
});

describe("document pins · editor placement (#902)", () => {
  test("the editor opens inside the clipping content column, not the viewport", async () => {
    const { window, document } = await boot(fixture("decision"));
    const sec = live(document);
    sec.style.overflow = "auto";
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
    const COL = rect(0, 0, 600, 500), PX = 560, PY = 440, W = 200, H = 100;
    const orig = window.Element.prototype.getBoundingClientRect;
    window.Element.prototype.getBoundingClientRect = function () {
      if (this === sec) return rect(0, 0, 600, 500);
      if (this.classList.contains("upin")) return rect(PX, PY, 26, 26);
      if (this.classList.contains("upin-editor")) {
        const wrap = this.parentElement;
        const left = this.style.left ? PX + parseFloat(this.style.left) : wrap.dataset.flipX ? PX - 32 - W : PX + 32;
        const top = wrap.dataset.flipY ? PY - 30 - H : PY;
        return rect(left, top, W, H);
      }
      return orig.call(this);
    };
    window.innerWidth = 1400;
    window.innerHeight = 900;
    ctrlClick(window, sec.querySelector("section[id]:not([data-iteration]) p"));
    const r = editorOf(document).getBoundingClientRect();
    window.Element.prototype.getBoundingClientRect = orig;
    expect(r.right).toBeLessThanOrEqual(COL.right - 8);
    expect(r.left).toBeGreaterThanOrEqual(8);
    expect(r.bottom).toBeLessThanOrEqual(COL.bottom - 8);
  }, BOOT_TIMEOUT);
});

describe("document pins · eye, ? badges, frozen, design regression", () => {
  test("the eye shows once a pin exists and toggles body.anno-hidden", async () => {
    const { window, document } = await boot(fixture("decision"));
    const eye = document.getElementById("dpin-eye");
    expect(eye.hidden).toBe(true);
    ctrlClick(window, live(document).querySelector("section[id]:not([data-iteration]) p"));
    typeAndSave(window, document, "x");
    expect(eye.hidden).toBe(false);
    eye.click();
    expect(document.body.classList.contains("anno-hidden")).toBe(true);
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    eye.click();
    expect(document.body.classList.contains("anno-hidden")).toBe(false);
    expect(md).toMatch(/body\.anno-hidden \.dpin-layer \.upin:not\(\[data-upin-fresh\]\), body\.anno-hidden \.dpin-hint \{ display: none !important; \}/);
  }, BOOT_TIMEOUT);

  test("? shows the badge overlay plus the Ctrl + click example pin on a document page; ? again removes it", async () => {
    const { window, document } = await boot(fixture("decision"));
    key(window, document.body, { key: "?", code: "Minus", shiftKey: true });
    expect(document.getElementById("hk-overlay")).not.toBeNull();
    expect(document.querySelector("#hk-overlay .hk-pin-example").textContent).toMatch(/Strg/);
    key(window, document.body, { key: "?", code: "Minus", shiftKey: true });
    expect(document.getElementById("hk-overlay")).toBeNull();
  }, BOOT_TIMEOUT);

  test("H presses the document eye, which names H in its tooltip", async () => {
    const { window, document } = await boot(fixture("decision"));
    const eye = document.getElementById("dpin-eye");
    expect(eye.dataset.tipKey).toBe("H");
    ctrlClick(window, live(document).querySelector("section[id]:not([data-iteration]) p"));
    typeAndSave(window, document, "x");
    key(window, document.body, { key: "h", code: "KeyH" });
    expect(document.body.classList.contains("anno-hidden")).toBe(true);
    key(window, document.body, { key: "h", code: "KeyH" });
    expect(document.body.classList.contains("anno-hidden")).toBe(false);
  }, BOOT_TIMEOUT);

  test("Ctrl held shows the hint pill, releasing it hides it", async () => {
    const { window, document } = await boot(fixture("decision"));
    key(window, document.body, { key: "Control", code: "ControlLeft", ctrlKey: true });
    expect(document.body.classList.contains("dpin-armed")).toBe(true);
    expect(document.querySelector(".dpin-hint").hidden).toBe(false);
    key(window, document.body, { key: "Control", code: "ControlLeft" }, "keyup");
    expect(document.querySelector(".dpin-hint").hidden).toBe(true);
  }, BOOT_TIMEOUT);

  test("a frozen round shows its baked pins read-only; entries without an anchor are ignored", async () => {
    const html = fixture("decision").replace(
      /(<section id="iter-1"[^>]*>)/,
      (m) => m + '<script type="application/json" data-frozen-feedback>' + JSON.stringify({
        general: { text: "", attachments: [] },
        userPins: [
          { id: "up-1", design: "", screen: "", x: 10, y: 10, target: "p", text: "alte Notiz", anchor: { section: "", kind: "p", index: 0, ref: "", text: "" } },
          { id: "up-2", design: "d1", screen: "d1-s1", x: 10, y: 10, target: "h1", text: "design pin" },
        ],
      }) + "</script>",
    );
    const { window, document } = await boot(html);
    const pins = document.querySelectorAll("#iter-1 .dpin-layer .upin");
    expect(pins).toHaveLength(1);
    const ta = pins[0].querySelector("textarea");
    expect(ta.readOnly).toBe(true);
    expect(ta.value).toBe("alte Notiz");
    expect(pins[0].querySelector(".upin-delete")).toBeNull();
    // the live payload carries none of it
    expect(window.collectDecisions("iterate").userPins).toEqual([]);
  }, BOOT_TIMEOUT);

  test("design rounds behave as before: no document pin, no document eye, own userPins payload untouched", async () => {
    const { window, document, errors } = await boot(fixture("design", { designs: 2 }));
    expect(errors).toEqual([]);
    expect(window.documentPinsActive()).toBe(false);
    expect(live(document).querySelector('textarea[data-engine-store="doc-pins"]')).toBeNull();
    const screen = live(document).querySelector("section[data-screen]");
    const p = screen && screen.querySelector("p, h1, h2, li");
    if (p) ctrlClick(window, p);
    expect(document.querySelectorAll(".dpin-layer")).toHaveLength(0);
    const payload = window.collectDecisions("iterate");
    expect(payload.template).toBe("design");
    expect(Array.isArray(payload.userPins)).toBe(true);
    expect(document.getElementById("dpin-eye").hidden).toBe(true);
  }, BOOT_TIMEOUT);
});

describe("document pins · bake and reference", () => {
  test("bake carries the document pins (with their anchor) into the frozen round", () => {
    const cb = require("../../scripts/concept-build.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dpin-"));
    try {
      cb.init(dir, { title: "t", locale: "en", mode: "free" });
      const round = '<section data-iteration="1" data-iteration-template="free" data-active><section id="s1" data-nav-label="A"><p>Hallo</p></section></section>\n';
      fs.writeFileSync(path.join(dir, "rounds", "01.html"), round);
      const userPins = [{ id: "up-1", design: "", screen: "s1", x: 5, y: 5, target: 'p "Hallo"', text: "n", anchor: { section: "s1", kind: "p", index: 0, ref: "", text: "Hallo" }, attachments: [] }];
      cb.bakeRound(dir, 1, { submitted: true, template: "free", decisions: [], comments: { general: { text: "", attachments: [] }, items: [] }, userPins });
      const baked = fs.readFileSync(path.join(dir, "rounds", "01.html"), "utf8");
      const blob = JSON.parse(/<script[^>]*data-frozen-feedback[^>]*>([\s\S]*?)<\/script>/.exec(baked)[1]);
      expect(blob.userPins).toEqual(userPins);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the reference documents the store, the anchor and the payload key", () => {
    expect(md).toMatch(/data-engine-store="doc-pins"/);
    expect(md).toMatch(/window\.documentPinsPayload/);
    expect(md).toMatch(/anchor = \{ section,\s+kind, index, ref\?, text \}/);
    expect(md).toMatch(/payload\.userPins = \(typeof window\.documentPinsPayload/);
  });
});
