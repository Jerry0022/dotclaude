import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// Concept chrome polish, sections E + F of the implement brief: roman page
// numerals, the quick nav that acts on pointerdown (two-click bug), the
// questions segment without "?" (direct / next-open jump, answered = any
// interaction), the overview preview fit that ignores ancestor transforms,
// the Space / arrow keys, the Alt overlay and the 30-day nudge dismissal.
// Booted from the real assembled fixture like design-overview.test.js.

const md = readTemplates();
const BOOT_TIMEOUT = 180_000;
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWS =
  '<section data-view="q1" data-view-kind="decision" data-nav-label="Erste Frage" hidden><textarea data-comment="q1-note"></textarea></section>' +
  '<section data-view="q2" data-view-kind="decision" data-nav-label="Zweite Frage" hidden><textarea data-comment="q2-note"></textarea></section>';

function page(designs, views = 0, mode = "design") {
  let html = build({ rounds: 2, entries: 4, mode, mapping: false, locale: "de", designs, out: "" });
  if (views && mode === "design") {
    html = html.replace('<section data-design="d2"', (views === 1 ? VIEWS.split("</section>")[0] + "</section>" : VIEWS) + '<section data-design="d2"');
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

const live = (d) => d.querySelector("section[data-iteration][data-active]");
const activeDesign = (d) => live(d).querySelector(":scope > section[data-design][data-design-active='true']");
const activeScreen = (d) => activeDesign(d).querySelector("section[data-screen][data-screen-active='true']").id;
function key(window, target, init, type = "keydown") {
  const ev = new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}
const mouseClick = (window, n) => n.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));

describe("roman numerals for detail pages", () => {
  test("the quick nav pages, the ☰ rows and the helper count I, II, III …", async () => {
    const { window, document, errors } = await boot(page(2));
    expect(errors).toEqual([]);
    expect([1, 4, 9, 14, 40].map((n) => window.romanNumeral(n))).toEqual(["I", "IV", "IX", "XIV", "XL"]);
    window.showDesign("d2");
    const nums = [...document.querySelectorAll("#design-quick .design-quick-page .design-quick-num, #design-quick .design-quick-vitem .design-quick-num")].map((n) => n.textContent);
    expect(nums.length).toBeGreaterThan(1);
    expect(nums.slice(0, 2)).toEqual(["I", "II"]);
    const toc = [...document.querySelectorAll("#screen-nav .screen-nav-item .screen-idx")].map((n) => n.textContent);
    expect(toc[0]).toBe("I");
    expect(toc.every((t) => /^[IVXLCDM]+$/.test(t))).toBe(true);
  }, BOOT_TIMEOUT);
});

describe("quick nav acts on pointerdown (two-click bug)", () => {
  test("a rebuild between pointerdown and click no longer eats the switch", async () => {
    const { window, document, errors } = await boot(page(2));
    expect(errors).toEqual([]);
    window.showDesign("d2");
    const seg = document.querySelector('#design-quick .design-quick-seg[data-design-id="d2b"]');
    seg.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    // What a blur / change does between pointerdown and click: the quick nav
    // is rebuilt, the old node is gone and the browser never delivers a click.
    window.refreshDesignOverview();
    expect(seg.isConnected).toBe(false);
    expect(activeDesign(document).dataset.design, "one press is enough").toBe("d2b");
    // The click that follows a pointerdown must not act twice ...
    seg.click();
    expect(activeDesign(document).dataset.design).toBe("d2b");
  }, BOOT_TIMEOUT);

  test("keyboard activation (a click without pointerdown) still works", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2");
    document.querySelector('#design-quick .design-quick-seg[data-design-id="d2b"]').click();
    expect(activeDesign(document).dataset.design).toBe("d2b");
  }, BOOT_TIMEOUT);

  test("the engine rebuilds the quick nav with nodes that act on pointerdown", () => {
    expect(md).toContain("function press(node, fn)");
    expect(md).toContain("press(seg,");
    expect(md).toContain("press(btn, () => { const q = nextQuestion");
  });
});

describe("overview preview fit ignores ancestor transforms", () => {
  test("a side card fits like the centre card (root cause: rects were read through the slide's scale)", async () => {
    const { window, document, errors } = await boot(page(3));
    expect(errors).toEqual([]);
    const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });
    document.querySelectorAll(".design-ov-slide[data-design-id]").forEach((slide) => {
      const s = slide.dataset.pos === "cur" ? 1 : 0.74; // what the CSS does to a neighbour
      const p = slide.querySelector(".design-ov-preview");
      const wrap = p.querySelector(".design-ov-scale");
      Object.defineProperty(p, "clientWidth", { value: 800, configurable: true });
      Object.defineProperty(p, "clientHeight", { value: 500, configurable: true });
      Object.defineProperty(wrap, "offsetWidth", { value: 1000, configurable: true });
      wrap.getBoundingClientRect = () => rect(0, 0, 1000 * s, 700 * s);
      wrap.querySelectorAll("*").forEach((n) => { n.getBoundingClientRect = () => rect(24 * s, 24 * s, 976 * s, 600 * s); });
    });
    window.dispatchEvent(new window.Event("resize"));
    await wait(60);
    const scales = [...document.querySelectorAll(".design-ov-preview")].map((p) => p.style.getPropertyValue("--dz-ov-scale"));
    expect(scales.length).toBe(3);
    expect(scales[0]).not.toBe("");
    expect(new Set(scales).size, "every card fitted to the same content").toBe(1);
  }, BOOT_TIMEOUT);

  test("the do-learn capture sits in the overview section", () => {
    expect(readTemplates()).toMatch(/Why previews are measured through the slide's scale|ancestor scale/);
  });
});

describe("questions segment", () => {
  const qBtn = (d) => d.querySelector("#design-quick .design-quick-q");
  const viewId = (d) => live(d).querySelector(":scope > section[data-view][data-view-active='true']")?.dataset.view;

  test("no ? mark, no submenu; several questions: first open, then the next open", async () => {
    const { window, document, errors } = await boot(page(2, 2));
    expect(errors).toEqual([]);
    expect(document.querySelector(".design-quick-qmark, .design-quick-qpop")).toBeNull();
    qBtn(document).click();
    expect(viewId(document)).toBe("q1");
    qBtn(document).click();
    expect(viewId(document), "inside the questions the next open one").toBe("q2");
    qBtn(document).click();
    expect(viewId(document), "wraps").toBe("q1");
    const ta = live(document).querySelector('section[data-view="q1"] textarea');
    ta.value = "ja";
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));
    qBtn(document).click();
    expect(viewId(document), "q1 is answered, only q2 is open").toBe("q2");
  }, BOOT_TIMEOUT);

  test("one question: the segment goes there directly", async () => {
    const { document } = await boot(page(2, 1));
    qBtn(document).click();
    expect(viewId(document)).toBe("q1");
    expect(document.querySelectorAll("#design-quick .design-quick-qitem").length).toBe(0);
  }, BOOT_TIMEOUT);

  test("a mere visit is not an answer; any interaction or scroll in the question is", async () => {
    const { window, document } = await boot(page(2, 2));
    const badge = () => document.querySelector("#design-quick .design-quick-badge")?.textContent;
    expect(badge()).toBe("2");
    qBtn(document).click();
    expect(viewId(document)).toBe("q1");
    expect(badge(), "visiting counts for nothing").toBe("2");
    const view = live(document).querySelector('section[data-view="q1"]');
    view.dispatchEvent(new window.Event("scroll"));
    expect(badge()).toBe("1");
    view.querySelector("textarea").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(badge()).toBe("1");
  }, BOOT_TIMEOUT);
});

describe("hotkeys: Space = notes dock, arrows = levels", () => {
  test("Space toggles the dock (never scrolls, never while typing) and no longer steps screens", async () => {
    const { window, document, errors } = await boot(page(2));
    expect(errors).toEqual([]);
    window.showDesign("d2");
    const dock = document.getElementById("feedback-dock");
    const before = activeScreen(document);
    const ev = key(window, document.body, { key: " ", code: "Space" });
    expect(ev.defaultPrevented, "no Space-scroll").toBe(true);
    expect(dock.dataset.open).toBe("true");
    const ta = dock.querySelector("textarea");
    ta.focus();
    key(window, ta, { key: " ", code: "Space" });
    expect(dock.dataset.open, "typing a space is not a hotkey").toBe("true");
    ta.blur();
    key(window, document.body, { key: " ", code: "Space" });
    expect(dock.dataset.open).toBe("false");
    expect(activeScreen(document), "Space left the screen alone").toBe(before);
    key(window, document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(activeScreen(document)).not.toBe(before);
  }, BOOT_TIMEOUT);

  test("↑ goes to the overview, ↓ opens the centre variant", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2");
    key(window, document.body, { key: "ArrowUp", code: "ArrowUp" });
    expect(document.body.dataset.overviewActive).toBe("true");
    key(window, document.body, { key: "ArrowDown", code: "ArrowDown" });
    expect(document.body.dataset.overviewActive).toBe("false");
    expect(activeDesign(document)).not.toBeNull();
  }, BOOT_TIMEOUT);

  test("plain mode (decision template): Space toggles the dock too", async () => {
    const { window, document } = await boot(page(1, 0, "decision"));
    const dock = document.getElementById("feedback-dock");
    expect(dock).not.toBeNull();
    const ev = key(window, document.body, { key: " ", code: "Space" });
    expect(ev.defaultPrevented).toBe(true);
    expect(dock.dataset.open).toBe("true");
  }, BOOT_TIMEOUT);

  test("Alt held shows the badge overlay and the Ctrl + click example pin; Alt up removes it", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2");
    key(window, document.body, { key: "Alt", code: "AltLeft", altKey: true });
    expect(document.body.classList.contains("hk-alt")).toBe(true);
    expect(document.getElementById("hk-overlay")).not.toBeNull();
    expect(document.querySelector("#hk-overlay .hk-pin-example").textContent).toMatch(/Strg/);
    key(window, document.body, { key: "Alt", code: "AltLeft" }, "keyup");
    expect(document.getElementById("hk-overlay")).toBeNull();
    expect(document.body.classList.contains("hk-alt")).toBe(false);
  }, BOOT_TIMEOUT);
});

describe("overview chrome", () => {
  test("no ‹ › buttons; at most one chip, inside the info box", async () => {
    const { document } = await boot(page(3));
    expect(document.querySelector(".design-ov-arrow")).toBeNull();
    document.querySelectorAll(".design-ov-slide[data-design-id]").forEach((s) => {
      expect(s.querySelectorAll(".design-ov-change").length).toBeLessThanOrEqual(1);
      expect(s.querySelector(".design-ov-preview .design-ov-change")).toBeNull();
      const chip = s.querySelector(".design-ov-overlay .design-ov-change");
      if (chip) expect(["Neugedacht", "Verbessert"]).toContain(chip.textContent);
    });
  }, BOOT_TIMEOUT);

  test("no open button and no tooltip over the preview: the centre tile itself opens", async () => {
    const { document } = await boot(page(2));
    const preview = document.querySelector(".design-ov-slide[data-pos='cur'] .design-ov-preview");
    expect(preview.dataset.tip).toBeUndefined();
    expect(preview.querySelector(".design-ov-open")).toBeNull();
    expect(preview.getAttribute("aria-keyshortcuts")).toBe("1");
  }, BOOT_TIMEOUT);

  test("a new round opens the overview start page", async () => {
    const { window, document } = await boot(page(2), { key: "concept-last-round:/", blob: "1" });
    await wait(30);
    expect(document.body.dataset.overviewActive).toBe("true");
    expect(window.localStorage.getItem("concept-last-round:/")).toBe("2");
  }, BOOT_TIMEOUT);
});

describe("nudges", () => {
  test("two mouse switches show the tip; ✕ silences it for 30 days (localStorage, expiring)", async () => {
    const { window, document } = await boot(page(2));
    const seg = () => document.querySelectorAll("#design-quick .design-quick-seg")[1];
    mouseClick(window, seg());
    expect(document.getElementById("hk-nudge")).toBeNull();
    mouseClick(window, seg());
    const tip = document.getElementById("hk-nudge");
    expect(tip).not.toBeNull();
    expect(tip.dataset.nudge).toBe("variants");
    expect(tip.textContent).toMatch(/wechseln die Variante/);
    tip.querySelector(".hk-nudge-x").click();
    expect(document.getElementById("hk-nudge")).toBeNull();
    expect(window.conceptNudgeSilenced("variants")).toBe(true);
    expect(window.localStorage.getItem("concept-nudge:variants")).toMatch(/^\d+$/);
    expect(window.conceptNudge("variants", ["1"], "x"), "silenced tips stay away").toBe(false);
    window.localStorage.setItem("concept-nudge:variants", String(Date.now() - 31 * 86400000));
    expect(window.conceptNudgeSilenced("variants"), "30 days later it may return").toBe(false);
  }, BOOT_TIMEOUT);

  test("a keyboard click (detail 0) never counts as the slow way", async () => {
    const { window, document } = await boot(page(2));
    for (let i = 0; i < 3; i++) document.querySelectorAll("#design-quick .design-quick-seg")[1].click();
    expect(document.getElementById("hk-nudge")).toBeNull();
    expect(window).toBeDefined();
  }, BOOT_TIMEOUT);

  test("storage that throws never breaks the tip", async () => {
    const { window, document } = await boot(page(2));
    window.Storage.prototype.getItem = () => { throw new Error("denied"); };
    window.Storage.prototype.setItem = () => { throw new Error("denied"); };
    expect(window.conceptNudgeSilenced("pages")).toBe(false);
    expect(window.conceptNudge("pages", ["←", "→"], "Hotkeys")).toBe(true);
    document.querySelector(".hk-nudge-x").click();
    expect(document.getElementById("hk-nudge")).toBeNull();
  }, BOOT_TIMEOUT);

  test("plain mode: the same tips exist (decision template)", async () => {
    const { window, document } = await boot(page(1, 0, "decision"));
    expect(typeof window.conceptNudge).toBe("function");
    expect(window.conceptNudge("alt", ["Alt"], "Halte Alt für alle Hotkeys")).toBe(true);
    expect(document.getElementById("hk-nudge").textContent).toContain("Alt");
  }, BOOT_TIMEOUT);
});

describe("locale", () => {
  test("every new key exists in both locales, the wording is clean", () => {
    for (const k of ["design.change_rethought", "design.change_improved", "design.keys_dock", "design.keys_level",
      "nudge.alt", "nudge.variants", "nudge.pages", "nudge.dock", "nudge.submit", "nudge.dismiss"]) {
      const row = md.split("\n").find((l) => l.startsWith("| `" + k + "`"));
      expect(row, k).toBeTruthy();
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      expect(cells.length, k).toBe(3);
      expect(cells[1]).not.toMatch(/Claude|\bAI\b/);
      expect(cells[2]).not.toMatch(/Claude|\bKI\b|Kommentar|Anmerkung/);
    }
  });
});
