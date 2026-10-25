import { describe, test, expect } from "vitest";
import { readTemplates } from "./templates-source.js";

// Notes dock feedback round: focus on open, auto-grow allocation, one-line
// tips without "Pin", tip/nudge repeat rules, the ☰ as navigation chrome,
// the shared field look and the 📎 gutter. Static + pure-function checks;
// the jsdom boot suites (chrome-islands-notes, chrome-hotkeys-nav) cover the
// wiring.

const md = readTemplates();

function jsBlockContaining(marker) {
  const blocks = [...md.matchAll(/```javascript\n([\s\S]*?)```/g)].map((m) => m[1]);
  const b = blocks.find((x) => x.includes(marker));
  expect(b, marker).toBeTruthy();
  return b;
}

function evalTips() {
  const block = jsBlockContaining("const DOCK_TIPS = {");
  const start = block.indexOf("const DOCK_TIPS = {");
  const end = block.indexOf("window.DOCK_TIP_HOTKEY");
  // eslint-disable-next-line no-new-func
  return new Function(block.slice(start, end) + "\nreturn { DOCK_TIPS, DOCK_TIP_HOTKEY };")();
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

describe("dock tips", () => {
  test("every tip fits one dock line and never says Pin", () => {
    const { DOCK_TIPS } = evalTips();
    expect(DOCK_TIPS.de.length).toBe(DOCK_TIPS.en.length);
    for (const t of [...DOCK_TIPS.de, ...DOCK_TIPS.en]) {
      expect(t.length, t).toBeLessThanOrEqual(44);
      expect(t, t).not.toMatch(/\bpins?\b/i);
    }
  });

  test("hotkey tips name the same key in both locales", () => {
    const { DOCK_TIPS, DOCK_TIP_HOTKEY } = evalTips();
    const keyOf = { alt: /Alt/, upin: /(Strg|Ctrl) \+/, dock: /Leertaste|Space/, variants: /1–3/, fav: /^F /,
      view: /^V /, pages: /←\/→/, esc: /^Esc/, "dock-esc": /^Esc/, submit: /Enter/ };
    expect(Object.keys(DOCK_TIP_HOTKEY).length).toBeGreaterThanOrEqual(8);
    for (const [i, id] of Object.entries(DOCK_TIP_HOTKEY)) {
      expect(DOCK_TIPS.de[i], id).toMatch(keyOf[id]);
      expect(DOCK_TIPS.en[i], id).toMatch(keyOf[id]);
    }
  });

  test("tip rules: session, persisted seen set and used hotkeys are documented and wired", () => {
    expect(md).toMatch(/hint-dock-tips-seen/);
    expect(md).toMatch(/window\.conceptHotkeyUsed = hotkeyUsed/);
    expect(md).toMatch(/hint-nudge-shown:/);
    expect(md).toMatch(/sessionShown\.has\(id\) \|\| hotkeyUsed\(id\)/);
  });
});

describe("auto-grow allocation", () => {
  const alloc = allocFn();
  test("everything fits: natural heights", () => {
    expect(alloc([100, 80, 60], [70, 70, 60], 400, 0)).toEqual([100, 80, 60]);
  });
  test("others shrink down to their floor before the active field gives way", () => {
    const h = alloc([300, 200, 150], [70, 70, 60], 450, 0);
    expect(h[0]).toBe(300);
    expect(h[1] + h[2]).toBe(150);
    expect(h[1]).toBeGreaterThanOrEqual(70);
    expect(h[2]).toBeGreaterThanOrEqual(60);
  });
  test("only when the others are at their floor does the active one shrink (and scroll)", () => {
    expect(alloc([500, 200, 150], [70, 70, 60], 400, 0)).toEqual([270, 70, 60]);
  });
});

describe("dock chrome", () => {
  test("opening focuses the topmost field, a page switch follows, Esc closes", () => {
    const b = jsBlockContaining("window.focusDockField = focusPrimary");
    expect(b).toMatch(/attributeFilter: \['data-open'\]/);
    expect(b).toMatch(/'screen:changed', 'view:changed', 'overview:changed', 'iteration:changed'/);
    expect(b).toMatch(/ta\.value \+= '\\n'/);
    expect(b).toMatch(/e\.key !== 'Escape'/);
  });
  test("the dock's max-height includes its padding (border-box) so it stays below the ☰", () => {
    const m = md.match(/\n\.feedback-dock \{([^}]*)\}/);
    expect(m[1]).toMatch(/box-sizing:\s*border-box/);
    expect(m[1]).toMatch(/--dock-ceiling/);
  });
  test("☰ wears the navigation surface, not the accent tile; tips have their own token", () => {
    const fab = [...md.matchAll(/\n\.panel-fab(?::not\(\.hidden\))? \{([^}]*)\}/g)].map((x) => x[1]).join("\n");
    expect(fab).toMatch(/background:\s*color-mix\(in srgb, var\(--panel-bg/);
    expect(fab).toMatch(/border:\s*1px solid var\(--border-color/);
    expect(md).toMatch(/--tip-color:\s*#/);
    expect(md).toMatch(/\.dock-tip \{[^}]*--tip-color/);
    expect(md).not.toMatch(/\.dock-tip b \{[^}]*warning-color/);
  });
  test("one field look for the whole UI and a 📎 gutter in dock fields", () => {
    expect(md).toMatch(/html :is\(textarea, input\[type="text"\][^{]*\):not\(\.map-state\) \{[^}]*--field-bg/);
    expect(md).toMatch(/:focus \{[^}]*--field-focus-ring/);
    expect(md).toMatch(/\.feedback-dock \.feedback-section textarea\[data-attachable\] \{ padding-right:/);
  });
});
