import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// Auto annotation bubble redesign (one-line pill, accent stripe, own-note pin
// shape in blue, pulse once on open, no chevron) and "one note open → the
// others stay, dimmed" for auto and own notes alike.

const src = readTemplates();
const css = src.match(/```css\n([\s\S]*?)```/g).join("\n");
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp("(?:^|\\n)" + esc + " \\{([^}]*)\\}").exec(css);
  return m ? m[1] : null;
};

describe("auto annotation bubble look", () => {
  test("collapsed bubble: one line pill, 10px corners, left accent stripe, soft glow; stronger when open", () => {
    const b = rule(".anno-bubble");
    expect(b).toMatch(/border-radius: var\(--anno-bubble-radius, 10px\)/);
    expect(b).toMatch(/display: flex/);
    expect(b).toMatch(/box-shadow: inset 3px 0 0 var\(--anno-accent/);
    const open = rule('.anno-bubble[data-open="true"]');
    expect(open).toMatch(/0 0 26px/);
    expect(open).toMatch(/animation: annoBubbleOpen 0\.22s/);
    expect(css).toMatch(/@keyframes annoBubbleOpen \{ from \{ opacity: 0; scale: 0\.86; \}/);
    expect(css).toMatch(/\.anno\[data-anno-side="left"\] \.anno-bubble \{ transform-origin: right center; \}/);
  });

  test("no chevron in the markup reference; old pages' chevron is hidden", () => {
    expect(src).not.toContain('<span class="anno-chevron"');
    expect(rule(".anno-chevron")).toMatch(/display: none/);
  });

  test("origin pin = own-note pin shape in the accent, pulses once when open", () => {
    const p = rule(".anno-pin");
    expect(p).toMatch(/border-radius: 50% 50% 50% 4px/);
    expect(p).toMatch(/linear-gradient\(160deg/);
    expect(p).toMatch(/font-size: 0/);
    expect(rule('.anno-pin[aria-expanded="true"]')).toMatch(/animation: annoPulseOnce 0\.6s ease-out 1/);
    const rm = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^\n]*\n?/g).join("\n");
    expect(rm).toMatch(/\.anno-pin\[aria-expanded="true"\], \.anno-bubble\[data-open="true"\] \{ animation: none; \}/);
  });
});

describe("own notes on the final report", () => {
  test("finalize carries userPins and the final report hosts document pins", () => {
    const at = src.indexOf("action: 'finalize'");
    const fin = src.slice(at, src.indexOf("};", at));
    expect(fin).toMatch(/userPins: \(typeof window\.documentPinsPayload === 'function'\) \? window\.documentPinsPayload\(active\) : \[\]/);
    const isDocIt = /const isDocIt = it => ([^;]*);/.exec(src)[1];
    expect(isDocIt).not.toContain("data-final-report");
    expect(src).not.toContain("**Final report: not yet.**");
  });
});

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

const ctrlClick = (window, n) =>
  n.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ctrlKey: true, clientX: 10, clientY: 10 }));
const enter = (window, ta) =>
  ta.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));
const openEditor = (d, sel) => [...d.querySelectorAll(sel + " .upin-editor")].find((e) => !e.hidden);

function expectDimmedNotRemoved(window, document, wraps) {
  const [a, b] = wraps;
  expect(a.dataset.editing).toBe("true");
  expect(b.dataset.editing).toBeUndefined();
  expect(document.body.dataset.noteEditing).toBe("true");
  expect(b.isConnected).toBe(true);
  expect(window.getComputedStyle(b).display).not.toBe("none");
  const pin = b.querySelector(".upin-pin");
  expect(window.getComputedStyle(pin).display).not.toBe("none");
  expect(window.getComputedStyle(pin).opacity).toBe("0.35");
  expect(window.getComputedStyle(a.querySelector(".upin-pin")).opacity).not.toBe("0.35");
}

describe("one note open: the other own notes stay, dimmed", () => {
  test("design round", async () => {
    const html = build({ rounds: 2, entries: 4, mode: "design", mapping: false, locale: "de", designs: 2, out: "" });
    const { window, document, errors } = await boot(html);
    expect(errors).toEqual([]);
    window.showDesign("d2");
    for (const [sel, text] of [["#d2-s1 h1", "eins"], ["#d2-s1 p", "zwei"]]) {
      ctrlClick(window, document.querySelector(sel));
      const ta = openEditor(document, "#d2-s1").querySelector("textarea");
      ta.value = text;
      enter(window, ta);
    }
    const wraps = [...document.querySelectorAll("#d2-s1 .upin")];
    expect(wraps).toHaveLength(2);
    wraps[0].querySelector(".upin-pin").click();
    window.syncNoteEditing();
    expectDimmedNotRemoved(window, document, wraps);
  }, BOOT_TIMEOUT);

  test("document round", async () => {
    const html = build({ rounds: 2, entries: 4, mode: "decision", mapping: false, locale: "de", designs: 1, out: "" });
    const { window, document, errors } = await boot(html);
    expect(errors).toEqual([]);
    const live = document.querySelector("section[data-iteration][data-active]");
    const ps = live.querySelectorAll("section[id]:not([data-iteration]) p");
    for (const [p, text] of [[ps[0], "eins"], [ps[1], "zwei"]]) {
      ctrlClick(window, p);
      const ta = openEditor(document, ".dpin-layer").querySelector("textarea");
      ta.value = text;
      enter(window, ta);
    }
    let wraps = [...document.querySelectorAll(".dpin-layer .upin")];
    expect(wraps).toHaveLength(2);
    wraps[0].querySelector(".upin-pin").click();
    await tick();
    wraps = [...document.querySelectorAll(".dpin-layer .upin")];
    expectDimmedNotRemoved(window, document, wraps);
  }, BOOT_TIMEOUT);
});

describe("a saved own note shows the annotation bubble in the note colour", () => {
  function expectBubble(window, document, wraps, texts) {
    wraps.forEach((w, i) => {
      const bub = w.querySelector(".anno-bubble.upin-bubble");
      expect(bub).not.toBeNull();
      expect(bub.dataset.open).toBe("false");
      expect(bub.querySelector(".anno-bubble-summary .anno-bubble-question").textContent).toBe(texts[i]);
      expect(["right", "left", "top", "bottom"]).toContain(w.dataset.annoSide);
      expect(window.getComputedStyle(bub).display).not.toBe("none");
    });
  }

  test("css: same bubble rules, accent swapped to the note colour, shared side logic", () => {
    expect(rule(".upin")).toMatch(/--anno-accent: var\(--upin-color\)/);
    expect(css).toMatch(/\.upin\[data-anno-side="left"\] \.anno-bubble,\n\.anno\[data-anno-side="left"\] \.anno-bubble \{ transform-origin: right center; \}/);
    expect(css).toMatch(/\.upin-editor:not\(\[hidden\]\) ~ \.upin-bubble \{ display: none; \}/);
    expect(css).toMatch(/\.upin:not\(\[data-editing="true"\]\) \.upin-bubble,/);
    expect(rule(".upin-editor")).toMatch(/inset 3px 0 0 var\(--upin-color\)/);
  });

  test("design round: saved note = collapsed bubble with its text; editing hides it", async () => {
    const html = build({ rounds: 2, entries: 4, mode: "design", mapping: false, locale: "de", designs: 2, out: "" });
    const { window, document, errors } = await boot(html);
    expect(errors).toEqual([]);
    window.showDesign("d2");
    ctrlClick(window, document.querySelector("#d2-s1 h1"));
    const ta = openEditor(document, "#d2-s1").querySelector("textarea");
    ta.value = "meine Notiz";
    enter(window, ta);
    const wraps = [...document.querySelectorAll("#d2-s1 .upin")];
    expect(wraps).toHaveLength(1);
    expectBubble(window, document, wraps, ["meine Notiz"]);
    // Clicking the bubble opens the editor like the pin does.
    wraps[0].querySelector(".anno-bubble-summary").click();
    expect(openEditor(document, "#d2-s1")).toBeTruthy();
  }, BOOT_TIMEOUT);

  test("document round: saved note = collapsed bubble with its text", async () => {
    const html = build({ rounds: 2, entries: 4, mode: "decision", mapping: false, locale: "de", designs: 1, out: "" });
    const { window, document, errors } = await boot(html);
    expect(errors).toEqual([]);
    const live = document.querySelector("section[data-iteration][data-active]");
    ctrlClick(window, live.querySelector("section[id]:not([data-iteration]) p"));
    const ta = openEditor(document, ".dpin-layer").querySelector("textarea");
    ta.value = "Dokument-Notiz";
    enter(window, ta);
    await tick();
    expectBubble(window, document, [...document.querySelectorAll(".dpin-layer .upin")], ["Dokument-Notiz"]);
  }, BOOT_TIMEOUT);
});
