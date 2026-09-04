import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Two defects, both found in a live generated page, both of which end in the
// same symptom: an EMPTY canvas after using the ☰ panel.
//
//   1. Stale closure. `buildDesignUI()` captures `const active =
//      activeDesign()` once, at BUILD time, and it only ever runs on
//      `iteration:changed` / `DOMContentLoaded` — never on a design switch.
//      So after switching designs through the ghost bar, `active` still
//      points at the OLD design, the per-screen nav handler's `d !== active`
//      reads false for that old design's rows, and clicking one calls
//      `showScreen()` with an id belonging to a design that is not on the
//      canvas.
//   2. No membership guard. `showScreen()` hid on `s.id !== id` with nothing
//      asserting that `id` names a screen of the active design at all — so
//      the foreign id from (1) hid EVERY screen and left a blank page.
//
// Either fix alone still leaves a blank page reachable (a stale deep link or
// a restored state pointing at a deleted screen hits the second one without
// the first), so both are pinned here. templates.md is a reference Claude
// copies verbatim, so a regression ships into every concept generated after.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");

// Line-based fence scanner — same reason as panel-chrome.test.js: a lazy
// ```js …``` regex desynchronises on the first block whose body contains a
// fence and stops seeing everything after it.
function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null, body = [];
  for (const line of lines) {
    const m = /^```(.*)$/.exec(line);
    if (m) {
      if (open === null) { open = m[1].trim(); body = []; }
      else { out.push({ info: open, code: body.join("\n") }); open = null; }
      continue;
    }
    if (open !== null) body.push(line);
  }
  return out;
}

const jsSource = scanBlocks(md)
  .filter((b) => /^(javascript|js)$/.test(b.info))
  .map((b) => b.code)
  .join("\n");

/** Slices a brace-balanced function body starting at `marker`. */
function slice(src, marker) {
  const start = src.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced braces after " + marker);
}

/** The per-screen nav row's click handler inside buildDesignUI(). Sliced off
 *  `btn.dataset.screenId` — the only marker unique to that row (the design
 *  heading and the ghost-bar segment both build a `btn` too). */
function screenNavHandler() {
  const build = slice(jsSource, "function buildDesignUI(");
  const anchor = build.indexOf("btn.dataset.screenId");
  expect(anchor, "buildDesignUI builds a per-screen nav row").toBeGreaterThan(-1);
  return slice(build.slice(anchor), "addEventListener('click'");
}

describe("the ☰ nav resolves the active design at click time", () => {
  test("the per-screen handler reads activeDesign() itself", () => {
    const handler = screenNavHandler();
    expect(handler, "the screen-nav click handler must call activeDesign()")
      .toMatch(/activeDesign\(\)/);
    expect(handler, "and compare the design ids, not object identity against a capture")
      .toMatch(/dataset\.design\s*!==\s*d\.dataset\.design|d\.dataset\.design\s*!==\s*\w+\.dataset\.design/);
  });

  test("it no longer compares against the build-time capture", () => {
    // `const active = activeDesign()` may stay — the ghost bar and the group
    // headings paint `data-active` from it, and those are rebuilt whenever it
    // changes. What must not come back is a CLICK-time read of it.
    // Comments go first: the handler's own comment explains the stale
    // `active` it replaced, and a raw scan would read that as the defect.
    const code = screenNavHandler().replace(/\/\/[^\n]*/g, "");
    expect(code, "the stale build-time `active` is back in the click path")
      .not.toMatch(/\bactive\b(?!Design)/);
  });

  test("a cross-design click routes through showDesign with the target screen", () => {
    // Switching design and screen in one call is the whole point of the
    // second argument: showDesign(id) alone lands on the design's FIRST
    // screen, silently ignoring the row the user actually clicked.
    expect(screenNavHandler(), "showDesign must carry the clicked screen id")
      .toMatch(/showDesign\(d\.dataset\.design,\s*sec\.id\)/);
  });
});

describe("showScreen() never hides every screen", () => {
  const body = () => slice(jsSource, "window.showScreen = function(");

  test("an unknown id falls back to the design's first screen", () => {
    expect(body(), "showScreen needs a screens[0].id fallback for foreign ids")
      .toMatch(/screens\[0\]\.id/);
  });

  test("the fallback is guarded by a membership check", () => {
    // Assigning screens[0].id unconditionally would break every legitimate
    // call; it may only fire when `id` matches nothing.
    expect(body(), "the fallback must be gated on `id` matching no screen")
      .toMatch(/some\(\s*s\s*=>\s*s\.id\s*===\s*id\s*\)/);
  });

  test("an empty design returns before touching anything", () => {
    // screens[0] on an empty list is undefined — the fallback itself would
    // throw and take the rest of the switch (labels, dock, viewport) with it.
    const b = body();
    expect(b, "showScreen must early-return on zero screens")
      .toMatch(/!screens\.length\s*\)\s*return/);
    expect(b.indexOf("screens.length"), "the length guard must precede the fallback")
      .toBeLessThan(b.indexOf("screens[0].id"));
  });
});

describe("the validation gate pins the invariant", () => {
  test("a P-numbered entry demands exactly one visible screen", () => {
    const row = gate.split("\n").find((l) => /^\|\s*P\d+\w*\s*\|/.test(l) &&
      /section\[data-screen\]/.test(l) && /design switch|nav click/.test(l));
    expect(row, "no P entry covers the one-visible-screen invariant").toBeDefined();
    expect(row, "the entry must state the count is exactly one").toMatch(/ONE|exactly 1/);
  });

  test("it prescribes getClientRects over getComputedStyle", () => {
    // A screen hidden by its ancestor design still computes display:block on
    // itself, so a getComputedStyle check passes on a blank page — the exact
    // false green this invariant exists to prevent.
    const row = gate.split("\n").find((l) => /^\|\s*P\d+\w*\s*\|/.test(l) &&
      /getClientRects/.test(l));
    expect(row, "the invariant must name getClientRects().length").toBeDefined();
    expect(row, "and warn off getComputedStyle").toMatch(/getComputedStyle/);
  });
});
