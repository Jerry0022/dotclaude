import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The device-view switcher lets a design concept render its mockup inside
// tablet/phone frames — portrait and landscape side by side — instead of only
// full-bleed. Like everything else in templates.md it is a REFERENCE Claude
// copies verbatim into generated pages, so a defect here ships silently into
// other people's projects.
//
// Two failure classes drove the assertions below, both found by red-teaming
// the plan rather than by writing the code:
//   1. The frames are DOM clones living inside section[data-iteration][data-active].
//      That is exactly the scope the gate-mandated catch-all in
//      collectAllFormFields() sweeps, and saveState() sweeps the whole
//      document — so without an explicit exclusion every mock field ships two
//      extra times in the payload and the localStorage blob fills with dead
//      keys the next screen switch deletes again. Both go green either way.
//   2. transform: scale() leaves the layout box unscaled. Without the
//      size-compensating wrapper the section scrolls around empty space and
//      the top of the stage lands above the scroll origin, unreachable.
//
// The behavioural side (cycling, clone integrity, fit geometry at 11 window
// sizes, persistence across iteration tabs) is verified in a real browser
// against these very blocks; what a Node-only suite can pin is that the
// blocks still say what that verification assumed.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");

// Line-based scanner, not a lazy regex: a `(?:javascript|js)\n([\s\S]*?)```
// pattern desynchronises as soon as one block's content contains a fence, and
// silently stops seeing the blocks after it.
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
const MD_LINES = md.split("\n");

function blockAfter(headingRe, langRe) {
  const idx = MD_LINES.findIndex((l) => headingRe.test(l));
  expect(idx, "heading " + headingRe).toBeGreaterThan(-1);
  const b = BLOCKS.find((b) => b.line > idx && langRe.test(b.info));
  expect(b, "block after " + headingRe).toBeTruthy();
  return b.code;
}

const designCss = blockAfter(/^## Layout CSS$/, /^css$/);
const designJs = blockAfter(/^## Layout JS — single-screen navigation/, /^(javascript|js)$/);
const htmlSource = BLOCKS.filter((b) => b.info === "html").map((b) => b.code).join("\n");
const jsSource = BLOCKS.filter((b) => /^(javascript|js)$/.test(b.info)).map((b) => b.code).join("\n");

/** Slices one top-level `function NAME(...) {...}` out of a source string. */
function fn(src, name) {
  const start = src.indexOf("function " + name + "(");
  expect(start, "function " + name).toBeGreaterThan(-1);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced braces in " + name);
}

// The pure helpers are evaluated as-is, so these are tests of the shipped
// code rather than of a paraphrase of it.
const CONSTS = ["VIEWPORT_MODES", "VIEWPORT_ORIENTATIONS", "DEVICE_SIZES", "MIN_DEVICE_SCALE"]
  .map((n) => new RegExp("^\\s*const " + n + " = .*$", "m").exec(designJs)?.[0])
  .filter(Boolean)
  .join("\n");
const helpers = new Function(
  CONSTS + "\n" +
  ["parseDeviceSize", "parseTokenList", "nextViewportMode", "bestFit"].map((n) => fn(designJs, n)).join("\n") +
  "\nreturn { parseDeviceSize, parseTokenList, nextViewportMode, bestFit, MIN_DEVICE_SCALE, DEVICE_SIZES };"
)();

describe("device-view switcher — pure resolution logic", () => {
  test("device sizes parse, and junk falls back instead of producing NaN", () => {
    const { parseDeviceSize } = helpers;
    expect(parseDeviceSize("360x800", [1, 2])).toEqual([360, 800]);
    expect(parseDeviceSize(" 1024 × 1366 ", [1, 2])).toEqual([1024, 1366]);
    // A NaN width collapses the frame to 0px and the mockup vanishes with
    // nothing logged, so every malformed shape must reach the fallback.
    for (const junk of ["abc", "", null, undefined, "12x", "x800", "0x0", "1e5x2", "-3x9", "800"]) {
      expect(parseDeviceSize(junk, [390, 844]), String(junk)).toEqual([390, 844]);
    }
    // and the fallback is copied, never aliased
    const fallback = [390, 844];
    const got = parseDeviceSize("junk", fallback);
    got[0] = 1;
    expect(fallback[0]).toBe(390);
  });

  test("token lists filter, de-duplicate and preserve declared order", () => {
    const { parseTokenList } = helpers;
    const ALLOWED = ["desktop", "tablet", "phone"];
    expect(parseTokenList("desktop tablet phone", ALLOWED)).toEqual(["desktop", "tablet", "phone"]);
    expect(parseTokenList("phone desktop", ALLOWED)).toEqual(["phone", "desktop"]);
    expect(parseTokenList("  phone,  DESKTOP , phone ", ALLOWED)).toEqual(["phone", "desktop"]);
    expect(parseTokenList("junk phone", ALLOWED)).toEqual(["phone"]);
    // null, not [], so the caller can apply its own default rather than
    // inheriting a list that renders nothing.
    for (const empty of ["", "   ", "junk", null, undefined]) {
      expect(parseTokenList(empty, ALLOWED), String(empty)).toBeNull();
    }
  });

  test("the cycle follows the DECLARED order and wraps", () => {
    const { nextViewportMode } = helpers;
    const three = ["desktop", "tablet", "phone"];
    expect(nextViewportMode(three, "desktop")).toBe("tablet");
    expect(nextViewportMode(three, "tablet")).toBe("phone");
    expect(nextViewportMode(three, "phone")).toBe("desktop");
    // A phone-first concept must never land on a desktop view its app does
    // not have, so the order is the declaration's, not the constant's.
    expect(nextViewportMode(["phone", "tablet"], "phone")).toBe("tablet");
    expect(nextViewportMode(["phone", "tablet"], "tablet")).toBe("phone");
    // unknown / degenerate inputs
    expect(nextViewportMode(three, "nonsense")).toBe("desktop");
    expect(nextViewportMode(["phone"], "phone")).toBe("phone");
    expect(nextViewportMode([], "phone")).toBe("desktop");
  });

  test("bestFit picks the axis that leaves the bigger scale, not a breakpoint", () => {
    const { bestFit } = helpers;
    const phone = [[390, 900], [844, 460]]; // portrait + landscape, incl. caption
    // Short and wide: side by side wins. A fixed "stack below 900px" rule
    // would have stacked here and rendered smaller.
    const wide = bestFit(phone, 900, 800, 32);
    expect(wide.axis).toBe("row");
    // Tall and narrow: stacking wins — again without any width breakpoint.
    const tall = bestFit(phone, 500, 1200, 32);
    expect(tall.axis).toBe("column");
    expect(tall.scale).toBeGreaterThan(bestFit(phone, 500, 1200, 32).scale - 1e-9);
    // Never upscales: a 390px phone blown up to fill a 4K window is not what
    // the mock looks like.
    expect(bestFit(phone, 5000, 5000, 32).scale).toBe(1);
    // Never shrinks past the floor; below it the caller scrolls instead.
    const tiny = bestFit(phone, 120, 120, 32);
    expect(tiny.scale).toBe(helpers.MIN_DEVICE_SCALE);
    expect(tiny.clamped).toBe(true);
    expect(wide.clamped).toBe(false);
    // Reported geometry belongs to the axis that was chosen, or the
    // size-compensating wrapper is set to the wrong box.
    expect(wide.width).toBe(390 + 844 + 32);
    expect(wide.height).toBe(900);
    expect(tall.width).toBe(844);
    expect(tall.height).toBe(900 + 460 + 32);
    // Ties go to `row`: side by side is the point of the view.
    expect(bestFit([[100, 100], [100, 100]], 232, 232, 32).axis).toBe("row");
    // Degenerate input must not produce NaN geometry.
    expect(bestFit([[0, 0]], 0, 0, 0).scale).toBe(1);
  });

  test("a single declared orientation renders one frame, not a padded pair", () => {
    const { bestFit } = helpers;
    const one = bestFit([[390, 900]], 1280, 800, 32);
    expect(one.width).toBe(390); // no phantom gap for an absent second frame
    expect(one.height).toBe(900);
  });
});

describe("device-view switcher — reference integrity", () => {
  test("clones are excluded from BOTH the payload and localStorage", () => {
    // The single marker the two filters key on.
    expect(designJs).toContain("stage.setAttribute('data-device-clone', '')");
    const collect = fn(jsSource, "collectAllFormFields");
    expect(collect).toContain("el.closest('[data-device-clone]')");
    // The catch-all selector itself is pinned by validation-gate.md pattern
    // 21 and must stay literal — the filter is additive, never a rewrite.
    expect(collect).toContain("scope.querySelectorAll('input, select, textarea')");
    const save = fn(jsSource, "saveState");
    expect(save).toContain("!el.closest('[data-device-clone]')");
    // All four branches, not just the checkbox one: the escape hatch that
    // already existed (data-no-persist) is honoured in one branch only, which
    // is why this uses its own guard in every branch instead.
    expect(save.match(/persistable\(el\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  test("the scaled pair gets a size-compensating wrapper", () => {
    // transform: scale() does not change layout size. Without .device-fit the
    // section reserves the UNSCALED box: scrollbars around empty space, and a
    // stage whose top edge sits above the scroll origin.
    expect(designJs).toContain("fitBox.style.width");
    expect(designJs).toContain("fitBox.style.height");
    expect(designCss).toContain(".device-fit");
    expect(designCss).toMatch(/\.device-pair\s*\{[^}]*transform-origin:\s*top left/);
    // fitDeviceStage() reads the gap ONCE and scores both the row and the
    // column candidate with it, because the axis is not known until bestFit()
    // has answered. An axis-specific gap would be scored with the previous
    // render's value, so the pick would lag one switch behind.
    expect(designCss).not.toMatch(/\.device-pair\[data-axis="[a-z]+"\]\s*\{[^}]*\bgap\s*:/);
    // and the section must stop scrolling itself, or the scrollbar's own
    // appearance feeds back into the fit and the mockup oscillates.
    expect(designCss).toMatch(/section\[data-screen\]\[data-device-mode\][^{]*\{[^}]*overflow:\s*hidden/);
  });

  test("every class the switcher JS assigns is actually styled", () => {
    // A class the JS invents and the CSS never declares ships an unstyled
    // stage that looks like a layout bug, and nothing at runtime says so.
    const assigned = new Set();
    for (const m of designJs.matchAll(/\.className = '([a-z-]+)'/g)) assigned.add(m[1]);
    expect(assigned.size).toBeGreaterThan(0);
    const undeclared = [...assigned].filter((c) => !designCss.includes("." + c));
    expect(undeclared).toEqual([]);
  });

  test("the toggle is chrome: hidden outside design, hidden without a choice", () => {
    // The hide list is explicit, and a new chrome element missing from it
    // floats over decision/free iterations on the same page doing nothing.
    expect(designCss).toContain('html:not([data-template="design"]) .viewport-toggle');
    expect(designCss).toContain('body[data-single-viewport="true"] .viewport-toggle { display: none; }');
    expect(designCss).toContain("body.panel-open .viewport-toggle");
    // Deliberately not the FAB size — see the comment in the CSS. If this
    // ever reads 60px, the "one component, two positions" FAB rule has been
    // copied onto a third element that is not part of it.
    expect(designCss).toMatch(/\.viewport-toggle\s*\{[^}]*height:\s*34px/);
  });

  test("every label the JS reads is declared on the button", () => {
    const btn = /<button id="viewport-toggle"[\s\S]*?>/.exec(htmlSource)?.[0] || "";
    for (const attr of ["data-label-prefix", "data-label-desktop", "data-label-tablet",
                        "data-label-phone", "data-label-portrait", "data-label-landscape"]) {
      expect(btn, attr).toContain(attr);
    }
    // …and every glyph the CSS switches on exists in the markup.
    for (const g of ["desktop", "tablet", "phone"]) {
      expect(htmlSource, g).toContain('data-glyph="' + g + '"');
      expect(designCss, g).toContain('.viewport-toggle[data-mode="' + g + '"]');
    }
    // Locale keys must exist for every placeholder the button uses.
    for (const key of ["design.viewport_switch", "design.viewport_desktop", "design.viewport_tablet",
                       "design.viewport_phone", "design.orientation_portrait", "design.orientation_landscape"]) {
      expect(md, key).toContain("`" + key + "`");
    }
  });

  test("declaration attributes agree between markup, JS and prose", () => {
    // dataset.viewportDefault ↔ data-viewport-default is the classic
    // camel-case trap: both spellings look right in isolation.
    const pairs = [["viewports", "data-viewports"], ["viewportDefault", "data-viewport-default"],
                   ["orientations", "data-orientations"], ["deviceTablet", "data-device-tablet"],
                   ["devicePhone", "data-device-phone"]];
    for (const [key, attr] of pairs) {
      expect(designJs, key).toContain("read('" + key + "')");
      expect(md, attr).toContain("`" + attr + "`");
    }
    expect(htmlSource).toContain('data-viewports="desktop tablet phone"');
    expect(htmlSource).toContain('data-viewport-default="phone"');
  });

  test("the switcher is wired from every entry point, not just defined", () => {
    // A defined-but-uncalled applyViewport leaves a toggle that switches a
    // mode nothing ever renders — no error, no console output.
    expect(designJs).toContain("document.getElementById('viewport-toggle')?.addEventListener('click', cycleViewport)");
    const showScreen = designJs.slice(designJs.indexOf("window.showScreen = function"));
    expect(showScreen.slice(0, 3000)).toContain("applyViewport();");
    // Before the early return, or switching to a decision iteration leaves
    // the previous design's frames in the DOM.
    const iter = designJs.slice(designJs.indexOf("'iteration:changed'"));
    const early = iter.indexOf("if (!design) return;");
    expect(iter.indexOf("applyViewport();")).toBeGreaterThan(-1);
    expect(iter.indexOf("applyViewport();")).toBeLessThan(early);
    // showScreen() is the usual route, but a design with zero screens gives
    // showDesign() no target to call it with — and the frames cloned for the
    // PREVIOUS design's screen would stay on screen under the new design's
    // name, since teardown lives inside renderDeviceStage().
    const showDesign = designJs.slice(designJs.indexOf("window.showDesign = function"));
    expect(showDesign.slice(0, 3000)).toContain("else applyViewport();");
    // Exactly one resize listener, at IIFE level — installing it per stage
    // build accumulates one per screen switch, each measuring a detached node.
    expect(designJs.match(/addEventListener\('resize'/g)?.length).toBe(1);
    // The first stage is built before restoreState() runs, so it snapshots
    // the pristine DOM; a rAF pass after every DOMContentLoaded listener
    // rebuilds it from the restored one.
    expect(designJs).toContain("requestAnimationFrame(applyViewport)");
  });

  test("the user's choice is never overwritten by clamping", () => {
    // One variable for both would downgrade the choice to `desktop` the
    // moment the user opens a decision-template tab, and coming back would
    // show a desktop view they never asked for.
    expect(designJs).toContain("let viewportPref = null;");
    const apply = fn(designJs, "applyViewport");
    expect(apply).toContain("viewportMode =");
    // Mirroring the preference onto the body is fine; REASSIGNING the
    // variable is the regression — hence the statement-anchored match rather
    // than a bare substring, which `dataset.viewportPref =` would satisfy.
    expect(apply).not.toMatch(/^\s*viewportPref\s*=/m);
    expect(designJs).toContain("dataset.viewportPref");
    // …and persistence stores the choice, not the clamped projection.
    expect(fn(jsSource, "saveState")).toContain("document.body.dataset.viewportPref");
  });

  test("clone sanitising covers every id reference, not just the obvious ones", () => {
    const clone = fn(designJs, "prefixClone");
    // Radio `name` is the only hard requirement — a shared name makes the
    // landscape copy CLEAR the portrait one — but each of the rest is silent
    // when missed: the control renders and points at the other frame's copy.
    expect(clone).toContain("el.getAttribute('name')");
    expect(clone).toContain("el.removeAttribute('autofocus')");
    expect(designJs).toContain("'aria-labelledby'");
    expect(designJs).toContain("'aria-controls'");
    // SVG paints reference defs by url(#id); un-rewritten they resolve to the
    // hidden original's def, so gradients and icons come out blank.
    expect(designJs).toMatch(/URL_REF_ATTRS\s*=\s*\[[^\]]*'fill'/);
    expect(clone).toContain("url(#");
    expect(clone).toContain("xlink:href");
  });

  test("the mock-authoring constraints device mode depends on are documented", () => {
    // Each of these renders correctly at desktop and dead or oversized inside
    // a frame, with nothing logged — so the rule is the only warning there is.
    for (const rule of ["No `vh` / `vw`", "No `position: fixed`", "No `<script>`, `<canvas>`, `<style>` or `<iframe>`",
                        "Style mocks by class, never by `#id`"]) {
      expect(md, rule).toContain(rule);
    }
    expect(skill).toContain("data-viewports");
    // The reference's own screen markup has to obey them.
    const screens = htmlSource.match(/<section[^>]*data-screen[\s\S]*?<\/section>/g) || [];
    expect(screens.length).toBeGreaterThan(0);
    for (const s of screens) {
      expect(s, "no script in a screen").not.toMatch(/<script|<canvas|<iframe/);
      expect(s, "no viewport units in a screen").not.toMatch(/\d(vh|vw|dvh|svh)\b/);
    }
  });

  test("annotations and views stay out of the frames", () => {
    // Both landed in parallel with this feature and both live in the same
    // region it clones. The annotation layer is authored INSIDE the screen and
    // its IIFE collects [data-anno-pin] / textarea[data-annotation]
    // document-wide — a cloned pin is harmless, but a cloned ANSWER is a third
    // textarea that saveState() and the submit payload both skip (clones are
    // excluded via [data-device-clone]), so it would be typed and silently
    // lost. Excluded at both levels: the screen's direct children, and any
    // layer nested deeper.
    expect(designJs).toContain("!el.hasAttribute('data-anno-layer')");
    expect(fn(designJs, "prefixClone")).toContain("querySelectorAll('[data-anno-layer]')");
    // A view is the active top-level item instead of a design: its screens are
    // hidden, so there is nothing to frame and no device to switch.
    const render = fn(designJs, "renderDeviceStage");
    expect(render).toContain("document.body.dataset.viewActive === 'true'");
    // …and the bail sits AFTER teardown, or the frames of the design the user
    // just left stay on screen underneath the view.
    expect(render.indexOf(".device-stage')")).toBeLessThan(
      render.indexOf("dataset.viewActive"));
    expect(designCss).toContain('body[data-view-active="true"] .viewport-toggle { display: none; }');
  });

  test("the gate checks what silently breaks", () => {
    for (const p of ["data-device-clone", "applyViewport()", "viewport-toggle", "bestFit", "device-fit"]) {
      expect(gate, p).toContain(p);
    }
    expect(gate).toMatch(/NO `<script>`, `<canvas>`, `<style>` or `<iframe>` inside any `section\[data-screen\]`/);
  });
});
