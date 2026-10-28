import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// Own notes are never lost (#929 / batch note #12) and the note chrome is one
// language (#7, #8, #10). Booted from the real assembled fixture like
// document-pins.test.js. Loss paths covered here:
//   * a NEW note typed but not yet committed (no Enter / blur) used to live only
//     in its editor — a reload, tab switch or rebuild in that window dropped it;
//   * Esc on a committed draft must still discard it (no ghost pin).

const md = readTemplates();
const BOOT_TIMEOUT = 180_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

async function boot(html) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/docs/concepts/2026-10-28-note-test.html",
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
  return { window, document: window.document };
}

const fixture = (mode) => build({ rounds: 2, entries: 4, mode, mapping: false, locale: "de", designs: 1, out: "" });
const live = (d) => d.querySelector("section[data-iteration][data-active]");
const ctrlClick = (window, n) =>
  n.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ctrlKey: true, clientX: 10, clientY: 10 }));
const keyEv = (window, target, init, type = "keydown") =>
  target.dispatchEvent(new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
const editorOf = (d) => [...d.querySelectorAll(".dpin-layer .upin-editor")].find((e) => !e.hidden);
const storeOf = (d) => JSON.parse(live(d).querySelector(':scope > textarea[data-engine-store="doc-pins"]').value || '{"pins":[]}');

describe("own notes are committed while typing", () => {
  test("text typed into a new note reaches the store and localStorage before Enter / blur", async () => {
    const { window, document } = await boot(fixture("decision"));
    ctrlClick(window, live(document).querySelector("section[id]:not([data-iteration]) p"));
    const ta = editorOf(document).querySelector("textarea");
    ta.value = "noch nicht mit Enter bestaetigt";
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(storeOf(document).pins).toHaveLength(1);
    expect(storeOf(document).pins[0].text).toBe("noch nicht mit Enter bestaetigt");
    const blob = JSON.parse(window.localStorage.getItem([...Object.keys(window.localStorage)].find((k) => /^concept-state-/.test(k) && !/archive/.test(k))));
    expect(blob["text:i2:doc-pins-store"] || blob["text:i1:doc-pins-store"]).toContain("noch nicht mit Enter bestaetigt");
    // a re-render (iteration switch, restore) keeps ONE pin, not a draft twin
    window.refreshDocumentPins();
    expect(document.querySelectorAll(".dpin-layer .upin")).toHaveLength(1);
  }, BOOT_TIMEOUT);

  test("Esc on a draft that was already committed leaves no pin behind", async () => {
    const { window, document } = await boot(fixture("decision"));
    ctrlClick(window, live(document).querySelector("section[id]:not([data-iteration]) p"));
    const ta = editorOf(document).querySelector("textarea");
    ta.value = "verworfen";
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    keyEv(window, ta, { key: "Escape", code: "Escape" });
    expect(storeOf(document).pins).toEqual([]);
    expect(document.querySelectorAll(".dpin-layer .upin")).toHaveLength(0);
  }, BOOT_TIMEOUT);

  test("editing a saved note and pressing Esc restores the stored text", async () => {
    const { window, document } = await boot(fixture("decision"));
    ctrlClick(window, live(document).querySelector("section[id]:not([data-iteration]) p"));
    let ta = editorOf(document).querySelector("textarea");
    ta.value = "Original";
    keyEv(window, ta, { key: "Enter", code: "Enter" });
    document.querySelector(".dpin-layer .upin-pin").click();
    ta = editorOf(document).querySelector("textarea");
    ta.value = "Halb getippt";
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(storeOf(document).pins[0].text).toBe("Halb getippt");
    keyEv(window, ta, { key: "Escape", code: "Escape" });
    expect(storeOf(document).pins[0].text).toBe("Original");
  }, BOOT_TIMEOUT);
});

describe("Ctrl own-pin tip (#929)", () => {
  const ctrlDown = (window) => keyEv(window, window.document, { key: "Control", code: "ControlLeft", ctrlKey: true });
  const tips = (d) => d.querySelectorAll('.hk-nudge[data-nudge="pin-tip"]');

  test("shows per press for 3 s, at most 3 presses, never the old hint pill", async () => {
    const { window, document } = await boot(fixture("decision"));
    expect(typeof window.conceptPinTip).toBe("function");
    for (let i = 0; i < 3; i++) {
      ctrlDown(window);
      expect(tips(document), `press ${i + 1}`).toHaveLength(1);
      expect(tips(document)[0].querySelector(".hk-nudge-timer").style.animationDuration).toBe("3000ms");
      document.getElementById("hk-nudge").remove();
      window.conceptPinTip._reset && window.conceptPinTip._reset();
    }
    // the node removal above bypasses hideNudge's state, so a fourth press
    // is refused by the counter alone
    ctrlDown(window);
    expect(window.localStorage.getItem([...Object.keys(window.localStorage)].find((k) => k.startsWith("hint-pin-tip:")))).toBe("3");
    expect(document.querySelectorAll('.hk-nudge[data-nudge="pin-tip"]')).toHaveLength(0);
  }, BOOT_TIMEOUT);

  test("never once an own note with text is saved", async () => {
    const { window, document } = await boot(fixture("decision"));
    ctrlClick(window, live(document).querySelector("section[id]:not([data-iteration]) p"));
    const ta = editorOf(document).querySelector("textarea");
    ta.value = "gespeichert";
    keyEv(window, ta, { key: "Enter", code: "Enter" });
    ctrlDown(window);
    expect(tips(document)).toHaveLength(0);
  }, BOOT_TIMEOUT);
});

describe("note chrome (static contract)", () => {
  test("auto pins carry data-tip like own pins; chrome list covers the quick nav", () => {
    expect(md).toMatch(/function syncPinTips\(\)[\s\S]*setAttribute\('data-tip', label\)/);
    expect(md).toMatch(/ANNO_CHROME = \[[\s\S]*'\.design-quick'[\s\S]*\]\.join/);
  });
  test("neither note kind paints a dot; both show a check when filled", () => {
    expect(md).toMatch(/\.anno \.anno-pin:not\(\[data-answered="true"\]\)::after \{ content: none; \}/);
    expect(md).toMatch(/\.upin:not\(\[data-editing="true"\]\) > \.upin-pin::after \{ content: '✓'; \}/);
    expect(md).not.toMatch(/\.upin-pin::after \{[^}]*background: #fff/);
  });
});
