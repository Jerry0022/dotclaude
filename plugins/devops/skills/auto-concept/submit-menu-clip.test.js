import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// #367 (two rounds) — a live generated page: the caret (▾ #submit-menu-btn)
// toggled its menu open (aria-expanded flipped, #submit-menu lost [hidden])
// but nothing appeared on screen and nothing was clickable.
//
// Round one root cause: `.panel-cta` carries `overflow-y: auto` as its
// ≤120px foot safety net (see #341 / panel-anatomy.test.js), and
// `.submit-menu` was `position: absolute; bottom: calc(100% + 6px)` anchored
// to that box — a popover that opens UPWARD out of an `overflow-y: auto`
// ancestor is clipped/scrolled away by that very ancestor.
//
// Round one's fix (`position: fixed`, sampling the split button's VIEWPORT
// rect once at open time) broke on the design layout in a real browser: the
// ☰ panel slides in (`transition: right 0.3s`), and a click on the caret
// while that transition is still running samples a rect that is stale by
// the time the panel settles — measured 400px off-screen at 1440x900.
//
// The real fix: the menu's CONTAINING BLOCK is `.concept-decision-panel`
// (already `position: fixed`), not `.panel-cta` — `.panel-cta` deliberately
// drops `position: relative` so it can no longer BE that containing block,
// which is what keeps its own overflow from clipping the popover. The menu
// moves WITH the panel through any transition because it is positioned
// relative to the same box, with no re-sampling needed mid-transition.
//
// This file locks down all three requirements so the regression cannot come
// back piecemeal: `.panel-cta` has no `position: relative`, `.submit-menu`
// is `position: absolute` (not `fixed`), and the JS computes coordinates
// relative to the panel (not the viewport) from both rects in one frame.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");

function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null, body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) {
      if (open === null) { open = { info: m[1].trim(), start: i + 2 }; body = []; }
      else { out.push({ info: open.info, line: open.start, code: body.join("\n") }); open = null; }
      continue;
    }
    if (open) body.push(lines[i]);
  }
  return out;
}
const BLOCKS = scanBlocks(md);
const cssSource = BLOCKS.filter((b) => b.info === "css").map((b) => b.code).join("\n");
const jsSource = BLOCKS.filter((b) => /^(javascript|js)$/.test(b.info)).map((b) => b.code).join("\n");

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
function splitSelectors(list) {
  const out = [];
  let depth = 0, buf = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
function cssRules(src) {
  const out = [];
  let i = 0, sel = "";
  while (i < src.length) {
    if (src[i] === "}") { sel = ""; i++; continue; }
    if (src[i] !== "{") { sel += src[i]; i++; continue; }
    let depth = 1, j = i + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") { depth--; if (!depth) break; }
      j++;
    }
    const body = src.slice(i + 1, j);
    const head = sel.trim();
    if (head.startsWith("@")) out.push(...cssRules(body));
    else if (head) out.push({ selectors: splitSelectors(head), body });
    sel = "";
    i = j + 1;
  }
  return out;
}
const RULES = cssRules(stripComments(cssSource));
const norm = (s) => s.replace(/\s+/g, " ").trim();
function rulesFor(re) {
  return RULES.filter((r) => r.selectors.some((s) => re.test(norm(s))));
}

describe("submit menu — CSS: the panel, not the clipped foot, is the containing block (#367)", () => {
  test(".panel-cta keeps its overflow-y: auto safety net (#341) but carries no position: relative", () => {
    const cta = rulesFor(/^\.panel-cta$/).find((r) => /max-height/.test(r.body));
    expect(cta, ".panel-cta { max-height }").toBeTruthy();
    expect(cta.body).toMatch(/overflow-y:\s*auto/);
    expect(cta.body).toMatch(/max-height:\s*120px/);
    expect(cta.body, ".panel-cta must not be a containing block").not.toMatch(/position:\s*relative/);
  });

  test(".concept-decision-panel establishes the containing block", () => {
    const panel = rulesFor(/^\.concept-decision-panel$/).find((r) => /height:\s*100vh/.test(r.body));
    expect(panel, ".concept-decision-panel").toBeTruthy();
    expect(panel.body).toMatch(/position:\s*fixed/);
  });

  test(".submit-menu is position: absolute (not fixed) and does not anchor via bottom: calc(100%...)", () => {
    const menu = rulesFor(/^\.submit-menu$/)[0];
    expect(menu, ".submit-menu").toBeTruthy();
    expect(menu.body).toMatch(/position:\s*absolute/);
    expect(menu.body).not.toMatch(/position:\s*fixed/);
    expect(menu.body).not.toMatch(/bottom:\s*calc\(100%/);
  });
});

describe("submit menu — JS computes panel-relative coordinates, not viewport ones (#367)", () => {
  // The reference wraps the whole thing in `(function wireSubmitMenu() { … })();`
  // — start the slice at the opening paren so the IIFE stays balanced when
  // it is eval'd standalone below.
  const wireStart = jsSource.indexOf("(function wireSubmitMenu()");
  expect(wireStart, "wireSubmitMenu IIFE").toBeGreaterThan(-1);
  const wireEnd = jsSource.indexOf(")();", wireStart) + ")();".length;
  const wire = jsSource.slice(wireStart, wireEnd);
  const closeParen = (() => {
    // Same brace-balanced slice technique other tests here use.
    let depth = 0, i = wire.indexOf("{");
    for (; i < wire.length; i++) {
      if (wire[i] === "{") depth++;
      else if (wire[i] === "}" && --depth === 0) break;
    }
    return wire.slice(0, i + 1);
  })();

  test("position() reads BOTH the panel's and the split button's rect, never window.innerHeight", () => {
    expect(closeParen).toContain("panel.getBoundingClientRect()");
    expect(closeParen).toContain("getBoundingClientRect()");
    expect(closeParen).toContain("menu.style.left");
    expect(closeParen).toContain("menu.style.bottom");
    // The viewport-anchored round-one shape must not come back.
    expect(closeParen, "no viewport-relative math").not.toContain("window.innerHeight");
    // position() must run before the menu is revealed, not after — an
    // already-visible-but-unpositioned popover is exactly the original bug.
    const posCall = closeParen.indexOf("if (open) position();");
    const unhide = closeParen.indexOf("menu.hidden = !open;");
    expect(posCall, "position() call").toBeGreaterThan(-1);
    expect(unhide, "menu.hidden assignment").toBeGreaterThan(-1);
    expect(posCall).toBeLessThan(unhide);
  });

  test("the panel's own transitionend re-positions the menu while it is open", () => {
    expect(closeParen).toMatch(/panel\.addEventListener\('transitionend'/);
  });

  function stubRect(el, rect) {
    el.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect });
  }

  /** A page whose panel is mid slide-in: only 60% across, not yet docked. */
  function page() {
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <aside class="concept-decision-panel open">
          <div class="panel-cta">
            <div class="submit-split">
              <button id="submit-iterate-btn" class="submit-btn"></button>
              <button type="button" id="submit-menu-btn" class="submit-menu-btn"
                      aria-haspopup="menu" aria-expanded="false" aria-controls="submit-menu">▾</button>
            </div>
            <div id="submit-menu" class="submit-menu" role="menu" hidden>
              <button type="button" id="submit-implement-btn" role="menuitem"></button>
            </div>
          </div>
        </aside>
      </body></html>`,
      { runScripts: "outside-only", pretendToBeVisual: true }
    );
    const { window } = dom;
    const { document } = window;
    // Mid-transition: the panel (and everything in it) sits at an
    // intermediate x — same shape as the coordinator's live-browser repro
    // (panel not yet docked when the caret is clicked).
    stubRect(document.querySelector(".concept-decision-panel"), { top: 0, left: 1200, right: 1560, bottom: 900, width: 360, height: 900 });
    stubRect(document.querySelector(".submit-split"), { top: 746, left: 1305, right: 1616, bottom: 796, width: 311, height: 50 });
    window.eval(wire);
    return { window, document };
  }

  test("clicking the caret positions the menu RELATIVE TO THE PANEL, even while the panel is mid-transition", () => {
    const { window, document } = page();
    const btn = document.getElementById("submit-menu-btn");
    const menu = document.getElementById("submit-menu");
    expect(menu.hidden).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("false");

    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    expect(menu.hidden, "the menu must actually unhide").toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    // Panel: left 1200, bottom 900. Split: left 1305, top 746, width 311.
    // Panel-relative: left = 1305 - 1200 = 105; bottom = 900 - 746 + 6 = 160.
    expect(menu.style.left).toBe("105px");
    expect(menu.style.width).toBe("311px");
    expect(menu.style.bottom).toBe("160px");
    // Never the viewport-anchored shape from round one.
    expect(menu.style.left).not.toBe("1305px");

    // Escape closes it again — the existing contract must survive untouched.
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  test("outside click still closes the menu", () => {
    const { window, document } = page();
    document.getElementById("submit-menu-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("submit-menu").hidden).toBe(false);

    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("submit-menu").hidden).toBe(true);
  });

  test("a transitionend on the panel re-positions an already-open menu", () => {
    const { window, document } = page();
    document.getElementById("submit-menu-btn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const menu = document.getElementById("submit-menu");
    expect(menu.style.left).toBe("105px");

    // The panel finishes docking (right: -400px -> 0); its rect — and the
    // split button's, now at rest — change accordingly.
    stubRect(document.querySelector(".concept-decision-panel"), { top: 0, left: 1080, right: 1440, bottom: 900, width: 360, height: 900 });
    stubRect(document.querySelector(".submit-split"), { top: 746, left: 1105, right: 1416, bottom: 796, width: 311, height: 50 });
    document.querySelector(".concept-decision-panel").dispatchEvent(new window.Event("transitionend", { bubbles: true }));

    // Panel-relative: left = 1105 - 1080 = 25; bottom = 900 - 746 + 6 = 160.
    expect(menu.style.left).toBe("25px");
    expect(menu.style.bottom).toBe("160px");
  });
});
