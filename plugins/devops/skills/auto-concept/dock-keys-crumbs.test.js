import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// Second notes-dock feedback round: the tinted tip lamp, arrow keys that
// work whenever no text field is focused (dock / panel open or not), one
// emphasis rule for every dock field header, stable auto-grow, no Ctrl-pin
// hint under the ☰ panel and a single divider above the panel foot.

const md = readTemplates();
const css = () => md.match(/```css\n([\s\S]*?)```/g).join("\n");
const BOOT_TIMEOUT = 180_000;
const tick = () => new Promise((r) => setTimeout(r, 0));
const frame = () => new Promise((r) => setTimeout(r, 40));

function jsBlockContaining(marker) {
  const blocks = [...md.matchAll(/```javascript\n([\s\S]*?)```/g)].map((m) => m[1]);
  const b = blocks.find((x) => x.includes(marker));
  expect(b, marker).toBeTruthy();
  return b;
}

function allocFn() {
  const block = jsBlockContaining("window.allocDockHeights = function");
  const start = block.indexOf("window.allocDockHeights = function");
  const end = block.indexOf("  let fitting = false;");
  const window = {};
  // eslint-disable-next-line no-new-func
  new Function("window", block.slice(start, end))(window);
  return window.allocDockHeights;
}

async function boot(designs = 2) {
  const html = build({ rounds: 2, entries: 4, mode: "design", mapping: false, locale: "de", designs, out: "" });
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

const live = (d) => d.querySelector("section[data-iteration][data-active]");
const activeDesign = (d) => live(d).querySelector(":scope > section[data-design][data-design-active='true']");
const activeScreen = (d) => activeDesign(d).querySelector("section[data-screen][data-screen-active='true']").id;
function key(window, target, init, type = "keydown") {
  const ev = new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe("1 · tip lamp in --tip-color", () => {
  test("the title carries an SVG lamp in currentColor, never the 💡 emoji", () => {
    const b = jsBlockContaining("function showDockTip()");
    const fn = b.slice(b.indexOf("function showDockTip()"), b.indexOf("window.showDockTip = showDockTip"));
    expect(fn).not.toMatch(/💡/);
    expect(fn).toMatch(/class="dock-tip-icon"[^']*fill="currentColor"/);
    expect(css()).toMatch(/\.dock-tip b \{[^}]*color: var\(--tip-color/);
  });
});

describe("2 · keys work whenever no text field is focused", () => {
  test("dock open, focus outside its fields: ← / → step the pages and the caret is not pulled in", async () => {
    const { window, document, errors } = await boot();
    expect(errors).toEqual([]);
    window.showDesign("d2");
    const dock = document.getElementById("feedback-dock");
    key(window, document.body, { key: " ", code: "Space" });
    expect(dock.dataset.open).toBe("true");
    await frame();
    document.activeElement?.blur();
    const first = activeScreen(document);
    const ev = key(window, document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(ev.defaultPrevented).toBe(true);
    const second = activeScreen(document);
    expect(second).not.toBe(first);
    await frame();
    expect(dock.contains(document.activeElement), "keyboard page switch keeps the focus out of the dock").toBe(false);
    key(window, document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(activeScreen(document), "the next arrow still navigates").not.toBe(second);
  }, BOOT_TIMEOUT);

  test("a focused dock button does not swallow the arrows; a focused field does", async () => {
    const { window, document } = await boot();
    window.showDesign("d2");
    const dock = document.getElementById("feedback-dock");
    key(window, document.body, { key: " ", code: "Space" });
    await frame();
    const btn = dock.querySelector("button");
    btn.focus();
    const before = activeScreen(document);
    key(window, btn, { key: "ArrowRight", code: "ArrowRight" });
    expect(activeScreen(document)).not.toBe(before);
    const ta = [...dock.querySelectorAll("textarea")].find((t) => !t.closest("[hidden]"));
    ta.focus();
    const now = activeScreen(document);
    const ev = key(window, ta, { key: "ArrowLeft", code: "ArrowLeft" });
    expect(ev.defaultPrevented).toBe(false);
    expect(activeScreen(document)).toBe(now);
  }, BOOT_TIMEOUT);

  test("the ☰ panel being open does not block the page arrows", async () => {
    const { window, document } = await boot();
    window.showDesign("d2");
    window.openPanel();
    expect(document.body.classList.contains("panel-open")).toBe(true);
    const before = activeScreen(document);
    key(window, document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(activeScreen(document)).not.toBe(before);
  }, BOOT_TIMEOUT);

  test("the gate is text entry only, no dock / panel bail-out left", () => {
    const b = jsBlockContaining("const isTextEntry = el =>");
    const h = b.slice(b.indexOf("const isTextEntry = el =>"));
    expect(h).not.toMatch(/dock\?\.dataset\.open === 'true' \|\| panel\?\.classList\.contains\('open'\)\) return;/);
    expect(h).toMatch(/if \(isTextEntry\(e\.target\) \|\| isTextEntry\(document\.activeElement\)\) return;/);
    expect(h).toMatch(/e\.defaultPrevented/);
  });
});

describe("3 · dock field headers: only the own level is emphasised", () => {
  test("ancestors muted, last crumb white + bold, no accent on the variant name", () => {
    const c = css();
    expect(c).toMatch(/\.feedback-dock \.dock-crumb \.dock-crumb-lv \{[^}]*color: var\(--text-secondary\)[^}]*font-weight: 500/);
    expect(c).toMatch(/\.feedback-dock \.dock-crumb strong, \.feedback-dock \.dock-crumb \.dock-crumb-last \{[^}]*color: var\(--text-color[^}]*font-weight: 650/);
    // The row-weight rules must not reach the breadcrumb labels.
    const rowRules = c.match(/html\[data-template="design"\][^{]*\.feedback-section:has\([^)]*\) label[^{]*\{/g) || [];
    expect(rowRules.length).toBeGreaterThan(0);
    for (const r of rowRules) expect(r, r).toMatch(/label:not\(\.dock-crumb\)/);
  });

  test("every header in the built page ends in exactly one emphasised level", async () => {
    const { document } = await boot();
    for (const crumb of document.querySelectorAll("#feedback-dock .dock-crumb")) {
      const strong = crumb.querySelectorAll("strong");
      expect(strong.length).toBe(1);
      const levels = [...crumb.querySelectorAll(".dock-crumb-lv, strong")];
      expect(levels[levels.length - 1].tagName).toBe("STRONG");
    }
  }, BOOT_TIMEOUT);
});

describe("4 · auto-grow is deterministic", () => {
  const alloc = allocFn();
  const floor = [70, 70, 60];
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  test("typing longer in the active field: others only shrink, never below their floor", () => {
    let cur = alloc([100, 150, 120], floor, 400, 0);
    for (let n = 100; n <= 600; n += 20) {
      const next = alloc([n, 150, 120], floor, 400, 0);
      expect(sum(next)).toBeLessThanOrEqual(400);
      expect(next[0]).toBeGreaterThanOrEqual(cur[0]);
      expect(next[1]).toBeLessThanOrEqual(cur[1]);
      expect(next[2]).toBeLessThanOrEqual(cur[2]);
      next.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(floor[i]));
      cur = next;
    }
  });

  test("deleting text gives the others their height back, exactly to their natural height", () => {
    expect(alloc([100, 150, 120], floor, 400, 0)).toEqual([100, 150, 120]);
  });

  test("no incremental state: the result depends only on the inputs", () => {
    const a = alloc([380, 150, 120], floor, 400, 0);
    expect(alloc([380, 150, 120], floor, 400, 0)).toEqual(a);
    expect(alloc.length).toBe(4);
  });

  test("refit on input AND focus, no height transition, a stable scrollbar gutter, no 220px maximise floor", () => {
    const b = jsBlockContaining("window.allocDockHeights = function");
    expect(b).toMatch(/addEventListener\('focusin'/);
    expect(b).toMatch(/attributeFilter: \['data-user-maximized', 'data-size'\]/);
    const c = css();
    const rule = c.match(/html \.feedback-dock \.feedback-section textarea \{([^}]*)\}/)[1];
    expect(rule).not.toMatch(/transition:[^;]*height/);
    expect(rule).toMatch(/scrollbar-gutter: stable/);
    expect(c).not.toMatch(/data-user-maximized="true"\] \.feedback-section textarea \{[^}]*min-height/);
    expect(c).toMatch(/\.feedback-divider \{ display: none; \}/);
  });
});

describe("5 · no Ctrl-pin hint while the ☰ panel is open", () => {
  test("CSS hides the hint bar and the Alt pin example under body.panel-open", () => {
    expect(css()).toMatch(/body\.panel-open \.upin-hint, body\.panel-open \.hk-pin-example \{ display: none !important; \}/);
  });

  test("the key badges with the panel open show no pin example", async () => {
    const { window, document } = await boot();
    window.showDesign("d2");
    window.openPanel();
    window.conceptKeyBadges(true);
    expect(document.getElementById("hk-overlay")).not.toBeNull();
    expect(document.querySelector(".hk-pin-example")).toBeNull();
    window.conceptKeyBadges(false);
    window.closePanel();
    window.conceptKeyBadges(true);
    expect(document.querySelector(".hk-pin-example")).not.toBeNull();
  }, BOOT_TIMEOUT);
});

describe("6 · one divider above the panel foot", () => {
  test("the screen nav's own bottom border is neutralised inside the scroll box", () => {
    const c = css();
    expect(c).toMatch(/\.panel-status \{[^}]*border-top: 1px solid/);
    expect(c).toMatch(/\.panel-nav-scroll > \.screen-nav \{[^}]*border-bottom: 0/);
  });
});
