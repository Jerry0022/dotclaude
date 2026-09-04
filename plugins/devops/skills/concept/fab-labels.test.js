import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Issue #298: the 💬 feedback FAB shipped as an unlabelled emoji circle in a
// corner. Users could not find the dock — the single place every note on a
// concept is written — so iterations came back with empty feedback.
//
// The fix is deliberately NON-geometric, because the two FABs are pinned as
// ONE component (gate P13, and the shape tests in final-report-wizard.test.js
// / panel-chrome.test.js): a visible label pill would have changed the box
// and reintroduced the 56-vs-64px drift. So:
//   * discoverability for pointer users  → `title` tooltip on BOTH FABs
//   * discoverability for AT users       → `aria-label`, swapped with
//                                          aria-expanded via data-label-*
//   * discoverability for the first-time → a one-shot pulse driven by
//     visitor                              `data-untouched`, box-shadow and
//                                          transform only
// templates.md is a reference Claude copies verbatim, so a regression here
// ships into every concept page generated afterwards.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");

// Line-based fence scanner — same reason as panel-chrome.test.js and
// design-nav-guard.test.js: a lazy ```js …``` regex desynchronises on the
// first block whose body contains a fence and stops seeing everything after.
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

const blocks = scanBlocks(md);
const pick = (re) => blocks.filter((b) => re.test(b.info)).map((b) => b.code).join("\n");
const jsSource = pick(/^(javascript|js)$/);
const cssSource = pick(/^css$/);
const htmlSource = pick(/^html$/);

/** Slices a brace-balanced body starting at `marker`. */
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

/** The opening tag of a FAB, attributes included (the markup is multi-line). */
function fabTag(id) {
  const re = new RegExp(`<button[^>]*id="${id}"[^>]*>`);
  const m = re.exec(htmlSource);
  expect(m, `#${id} markup`).toBeTruthy();
  return m[0];
}

const FABS = ["panel-toggle", "feedback-toggle"];

describe("both FABs are labelled", () => {
  test.each(FABS)("#%s carries title and aria-label", (id) => {
    const tag = fabTag(id);
    expect(tag, "hover tooltip for pointer users").toMatch(/\stitle="/);
    expect(tag, "accessible name for AT users").toMatch(/\saria-label="/);
  });

  test.each(FABS)("#%s labels come from the locale table, not baked text", (id) => {
    const tag = fabTag(id);
    // Every label-bearing attribute must be a {{locale.key}} placeholder.
    // A literal (the old "Feedback") would ship English into a `de` page and
    // is exactly what the locale table exists to prevent.
    const labelAttrs = [...tag.matchAll(/(title|aria-label|data-label-open|data-label-close)="([^"]*)"/g)];
    expect(labelAttrs.length, "label attributes on #" + id).toBeGreaterThanOrEqual(4);
    for (const [, name, value] of labelAttrs) {
      // Placeholder-only is what rules out the hard-coded "Feedback": any
      // literal at all fails this, in either direction (English on a `de`
      // page, or a stray German string on an `en` one).
      expect(value, `${name} on #${id} must be a locale placeholder`)
        .toMatch(/^\{\{[\w.]+\}\}$/);
    }
  });

  test.each(FABS)("#%s declares both swap states and starts collapsed", (id) => {
    const tag = fabTag(id);
    expect(tag).toMatch(/data-label-open="/);
    expect(tag).toMatch(/data-label-close="/);
    expect(tag, "aria-expanded is what the label swap tracks")
      .toMatch(/aria-expanded="false"/);
  });

  test("every locale key used by the FABs exists in the locale table", () => {
    for (const id of FABS) {
      for (const [, key] of fabTag(id).matchAll(/\{\{([\w.]+)\}\}/g)) {
        expect(md, `locale row for ${key}`).toMatch(
          new RegExp("^\\|\\s*`" + key.replace(".", "\\.") + "`\\s*\\|.*\\|.*\\|", "m")
        );
      }
    }
  });
});

describe("the label swap moves title and aria-label together", () => {
  // Both halves matter: aria-label alone leaves the pointer user with the
  // same unlabelled circle #298 was about, title alone leaves AT users on a
  // stale "Open" after the thing is already open.
  for (const fn of ["function openDock(", "function closeDock("]) {
    test(`${fn} sets both on the 💬 FAB`, () => {
      const body = slice(jsSource, fn);
      expect(body).toMatch(/setAttribute\('aria-expanded'/);
      expect(body).toMatch(/setAttribute\('aria-label',\s*LABEL_(OPEN|CLOSE)\)/);
      expect(body, "tooltip must move with the label").toMatch(/\.title\s*=\s*LABEL_(OPEN|CLOSE)/);
    });
  }

  for (const [fn, ds] of [["window.openPanel =", "labelClose"], ["window.closePanel =", "labelOpen"]]) {
    test(`${fn} swaps the ☰ FAB label`, () => {
      const body = slice(jsSource, fn);
      expect(body).toMatch(/setAttribute\('aria-expanded'/);
      expect(body, "reads the swap state off the button's dataset")
        .toContain("dataset." + ds);
      expect(body).toMatch(/setAttribute\('aria-label',/);
      expect(body, "tooltip must move with the label").toMatch(/\.title\s*=/);
    });
  }
});

describe("the one-shot attention pulse", () => {
  test("the FAB ships untouched and the keyframes exist", () => {
    expect(fabTag("feedback-toggle"), "pulse trigger").toContain('data-untouched="true"');
    expect(cssSource, "@keyframes fabPulse").toMatch(/@keyframes\s+fabPulse\s*\{/);
  });

  test("neither the keyframes nor the rule touch geometry", () => {
    // Gate P13: the two FABs are one component. An animated width/radius is
    // the 56-vs-64px drift with extra steps.
    const frames = slice(cssSource, "@keyframes fabPulse");
    const rule = slice(cssSource, '.feedback-fab[data-untouched="true"]');
    for (const src of [frames, rule]) {
      for (const prop of ["width", "height", "border-radius", "padding"]) {
        expect(src, `pulse must not animate ${prop}`).not.toMatch(
          new RegExp("(^|[;{\\s])" + prop + "\\s*:")
        );
      }
    }
    expect(frames, "box-shadow / transform only").toMatch(/transform:|box-shadow:/);
    expect(rule, "finite iteration count — this is one-shot, not a beacon")
      .toMatch(/animation:[^;]*\s\d+\s*;/);
    expect(rule, "must not loop forever").not.toMatch(/infinite/);
  });

  test("prefers-reduced-motion disables it", () => {
    const guards = cssSource.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) || [];
    const hit = guards.some((g) => /\.feedback-fab\[data-untouched="true"\][^{]*\{[^}]*animation:\s*none/.test(g));
    expect(hit, "a reduced-motion guard must switch the pulse off").toBe(true);
  });

  test("the JS clears data-untouched on FAB click and on dock input", () => {
    const clear = /removeAttribute\('data-untouched'\)/;
    expect(jsSource, "the clear itself").toMatch(clear);
    const click = slice(jsSource, "dockToggle.addEventListener('click'");
    expect(click, "first dock open ends the pulse").toMatch(/stopFabPulse\(\)|removeAttribute\('data-untouched'\)/);
    expect(jsSource, "and so does the first keystroke inside the dock")
      .toMatch(/dock\.addEventListener\('input',\s*stopFabPulse\)/);
  });
});

describe("the gate pins the fix", () => {
  test("validation-gate.md documents the tooltip-only rule", () => {
    const row = gate.split("\n").find((l) => /^\|\s*P13d\s*\|/.test(l));
    expect(row, "a P13d row next to P13").toBeTruthy();
    expect(row).toContain("title=");
    expect(row).toContain("aria-label=");
    expect(row).toContain("data-untouched");
    expect(row, "tooltip-only, no visible pill").toMatch(/tooltip-only/i);
    expect(row, "the pulse may not touch geometry").toMatch(/prefers-reduced-motion/);
  });
});
