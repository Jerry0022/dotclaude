import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";

// Own Ctrl + click notes while everything is hidden (body.anno-hidden): the
// note set WHILE hidden stays visible (data-upin-fresh), older ones stay hidden,
// showing all clears the marker. Plus Ctrl + click on question views of a
// design round (templates-free-pins.md § Document pins).

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
      window.Element.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40, x: 0, y: 0 };
      };
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
const ctrlClick = (window, n) =>
  n.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ctrlKey: true, clientX: 10, clientY: 10 }));
const enter = (window, ta) =>
  ta.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));
const openEditor = (d, sel) => [...d.querySelectorAll(sel + " .upin-editor")].find((e) => !e.hidden);
const shown = (window, n) => window.getComputedStyle(n).display !== "none";

describe("pins set while everything is hidden", () => {
  test("design pin: fresh one visible, older hidden, both after show, next hide hides both", async () => {
    const html = build({ rounds: 2, entries: 4, mode: "design", mapping: false, locale: "de", designs: 2, out: "" });
    const { window, document, errors } = await boot(html);
    expect(errors).toEqual([]);
    window.showDesign("d2");
    const place = (sel, text) => {
      ctrlClick(window, document.querySelector(sel));
      const ta = openEditor(document, "#d2-s1").querySelector("textarea");
      ta.value = text;
      enter(window, ta);
    };
    place("#d2-s1 h1", "old");
    const eye = document.getElementById("anno-toggle");
    eye.click();
    expect(document.body.classList.contains("anno-hidden")).toBe(true);
    place("#d2-s1 p", "fresh");
    const pins = [...document.querySelectorAll("#d2-s1 .upin")];
    expect(pins).toHaveLength(2);
    const [oldPin, freshPin] = pins;
    expect(oldPin.dataset.upinFresh).toBeUndefined();
    expect(freshPin.dataset.upinFresh).toBe("true");
    expect(shown(window, freshPin)).toBe(true);
    expect(shown(window, oldPin)).toBe(false);
    eye.click();
    await tick();
    expect(document.querySelectorAll("[data-upin-fresh]")).toHaveLength(0);
    document.querySelectorAll("#d2-s1 .upin").forEach((n) => expect(shown(window, n)).toBe(true));
    eye.click();
    document.querySelectorAll("#d2-s1 .upin").forEach((n) => expect(shown(window, n)).toBe(false));
    expect(window.collectDecisions("iterate").userPins.map((p) => p.text).sort()).toEqual(["fresh", "old"]);
  }, BOOT_TIMEOUT);

  test("document pin: same contract, Ctrl + click works hidden", async () => {
    const html = build({ rounds: 2, entries: 4, mode: "decision", mapping: false, locale: "de", designs: 1, out: "" });
    const { window, document, errors } = await boot(html);
    expect(errors).toEqual([]);
    const ps = live(document).querySelectorAll("section[id]:not([data-iteration]) p");
    const save = (p, text) => {
      ctrlClick(window, p);
      const ta = openEditor(document, ".dpin-layer").querySelector("textarea");
      ta.value = text;
      enter(window, ta);
    };
    save(ps[0], "old");
    const eye = document.getElementById("dpin-eye");
    eye.click();
    expect(document.body.classList.contains("anno-hidden")).toBe(true);
    save(ps[1], "fresh");
    const pins = [...document.querySelectorAll(".dpin-layer .upin")];
    expect(pins).toHaveLength(2);
    expect(document.body.classList.contains("anno-hidden"), "creating does not un-hide").toBe(true);
    expect(pins.map((n) => shown(window, n))).toEqual([false, true]);
    eye.click();
    await tick();
    expect(document.querySelectorAll("[data-upin-fresh]")).toHaveLength(0);
    expect([...document.querySelectorAll(".dpin-layer .upin")].map((n) => shown(window, n))).toEqual([true, true]);
    eye.click();
    expect([...document.querySelectorAll(".dpin-layer .upin")].map((n) => shown(window, n))).toEqual([false, false]);
  }, BOOT_TIMEOUT);
});

describe("pins on question views of a design round", () => {
  test("Ctrl + click on a view creates a pin that reaches userPins with an anchor; the overview does not", async () => {
    const views = '<section data-view="qa" data-view-kind="decision" data-nav-label="Frage A" hidden><p>Welche Phase?</p><p>Zweiter Absatz</p></section>';
    const html = build({ rounds: 2, entries: 4, mode: "design", mapping: false, locale: "de", designs: 2, out: "" })
      .replace(/<section data-design="d2" /, (m) => views + m);
    const { window, document, errors } = await boot(html);
    expect(errors).toEqual([]);
    expect(window.documentPinsActive(), "overview: no document pin").toBe(false);
    window.showView("qa");
    expect(window.documentPinsActive()).toBe(true);
    ctrlClick(window, document.querySelector('section[data-view="qa"] p'));
    const ed = openEditor(document, ".dpin-layer");
    expect(ed, "editor opens on the view").toBeTruthy();
    const ta = ed.querySelector("textarea");
    ta.value = "Phase unklar";
    enter(window, ta);
    const pins = window.collectDecisions("iterate").userPins;
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ text: "Phase unklar", anchor: { section: "view:qa", kind: "p", index: 0 } });
    // A design screen is not a target.
    window.showDesign("d2");
    ctrlClick(window, document.querySelector("#d2-s1 p"));
    expect(document.querySelectorAll(".dpin-layer .upin")).toHaveLength(1);
    expect(document.querySelectorAll("#d2-s1 .upin")).toHaveLength(1);
  }, BOOT_TIMEOUT);
});
