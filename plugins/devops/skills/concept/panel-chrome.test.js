import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The ☰ decision panel is the only navigation a design concept has that is
// not a floating overlay: it lists every design and every screen, and it is
// where the user switches between them. Two defects made it unusable, both
// found in a real generated page rather than by reading the template:
//
//   1. `#screen-nav` — the panel's whole table of contents — was hidden by
//      `body[data-single-screen="true"]`. That flag is written by
//      updateScreenScope() from the ACTIVE design's screen count, but the
//      container it hid is CROSS-design: one group per design, each with the
//      heading that switches to it. So in a multi-design iteration, switching
//      to any design that happens to have a single screen blanked the entire
//      TOC — every other design's entry with it — and left no way back except
//      the dimmed floating switcher. A per-design count must never gate a
//      cross-design container.
//   2. The ☰ panel and the 💬 feedback dock opened independently. Both are
//      right-edge overlays, so opening one over the other left them stacked
//      (measured: 326x445px of overlap at a 921px viewport).
//
// templates.md is a REFERENCE Claude copies verbatim into generated pages, so
// a defect here ships silently into every concept produced afterwards.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");

// Line-based scanner (same reason as viewport-switcher.test.js): a lazy
// `\`\`\`css\n([\s\S]*?)\`\`\`` regex desynchronises on the first block whose
// body contains a fence and silently stops seeing everything after it.
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

/** Splits a selector list on top-level commas only — `:has(a, b)` and
 *  `[attr="x,y"]` must stay one selector. */
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

// Comments have to go before the walker runs: it accumulates everything
// between two braces as the selector, so a rule preceded by a `/* … */`
// block would carry that whole comment in its selector text and never match
// an anchored pattern.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** Brace-balanced rule walker. Recurses into at-rules so a declaration
 *  nested in `@media` is not invisible to the assertions below. */
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

// "Hidden" has to mean every way a rule can take an element off the page, not
// just the one the bug happened to use. Keying on `display: none` alone would
// let the identical regression back in through `visibility: hidden` or a
// zero-height clip, and the offender scan below would still report clean.
const HIDES = [
  /display\s*:\s*none/,
  /visibility\s*:\s*hidden/,
  /opacity\s*:\s*0(?![.\d])/,
  /max-height\s*:\s*0(?![.\d])/,
  /(?<!max-|min-)height\s*:\s*0(?![.\d])/,
];
const hidden = RULES.filter((r) => HIDES.some((re) => re.test(r.body)));

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

describe("panel TOC — a design switch must not blank #screen-nav", () => {
  test("nothing hides #screen-nav on the active design's screen count alone", () => {
    // `body[data-single-screen="true"] #screen-nav` is the exact rule that
    // shipped the bug: true whenever the design currently on the canvas has
    // one screen, regardless of how many designs the iteration holds.
    // The prohibition is specifically about THAT flag — hiding the container
    // for an unrelated reason (e.g. a non-design iteration is showing) is
    // legitimate and must not be reported here.
    const offenders = [];
    for (const rule of hidden) {
      for (const sel of rule.selectors) {
        if (!/#screen-nav\b[^,]*$/.test(sel)) continue;   // subject must BE the container
        if (!/\[data-single-screen/.test(sel)) continue;  // unrelated condition — fine
        if (!/\[data-single-design\s*=\s*"true"\]/.test(sel)) offenders.push(sel);
      }
    }
    expect(offenders, "selectors hiding the whole TOC on a per-design condition").toEqual([]);
  });

  test("a non-design iteration never shows the previous design's TOC", () => {
    // buildDesignUI() returns early when the visible iteration has no design,
    // BEFORE it clears nav.innerHTML — so the entries survive the switch and
    // only CSS can keep them off a decision / free / final-report tab.
    const build = slice(jsSource, "function buildDesignUI(");
    const clear = build.indexOf("nav.innerHTML");
    const early = build.indexOf("if (!active) return");
    expect(early, "the early return this rule compensates for").toBeGreaterThan(-1);
    expect(early, "early return still precedes the nav clear").toBeLessThan(clear);
    const swapped = hidden.some((r) => r.selectors.some((s) =>
      /^html:not\(\[data-template="design"\]\)\s+#screen-nav$/.test(s.trim())));
    expect(swapped, 'html:not([data-template="design"]) #screen-nav').toBe(true);
  });

  test("views keep a route when everything else collapses", () => {
    // The views group lives INSIDE #screen-nav, and the only other route to a
    // view is .view-switch-item inside .design-switcher — which
    // body[data-single-design="true"] hides. Collapsing the container on a
    // single-design, single-screen iteration that HAS views therefore strands
    // them with no reachable surface at all.
    const container = hidden.filter((r) => r.selectors.some((s) =>
      /#screen-nav/.test(s) && /\[data-single-screen/.test(s)));
    expect(container.length, "the container-collapse rule").toBeGreaterThan(0);
    for (const rule of container) {
      for (const sel of rule.selectors.filter((s) => /#screen-nav/.test(s))) {
        expect(sel.replace(/\s+/g, " "), "must exempt iterations that hold views")
          .toMatch(/#screen-nav:not\(:has\(\.screen-nav-view-item\)\)/);
      }
    }
    // and the switcher half of the claim — the reason the guard is needed
    const switcherHidden = hidden.some((r) => r.selectors.some((s) =>
      /^body\[data-single-design="true"\]\s+\.design-switcher$/.test(s.trim())));
    expect(switcherHidden, "body[data-single-design] .design-switcher").toBe(true);
    expect(jsSource, "view segments live in the design switcher")
      .toMatch(/btn\.className = 'view-switch-item'/);
  });

  test("the whole TOC may still collapse when one design holds one screen", () => {
    // The legitimate case the original rule was written for must survive the
    // fix — otherwise an empty flex container leaves a stray divider line.
    const collapses = hidden.some((r) => r.selectors.some((sel) =>
      /#screen-nav\b/.test(sel)
      && /\[data-single-design\s*=\s*"true"\]/.test(sel)
      && /\[data-single-screen\s*=\s*"true"\]/.test(sel)));
    expect(collapses, "body[data-single-design][data-single-screen] #screen-nav").toBe(true);
  });

  test("a single-screen design collapses its OWN group's screen row", () => {
    // Per-design granularity: the flag lives on .screen-nav-group, so the
    // other designs' rows are untouched and the state does not change when
    // the active design does.
    const perGroup = hidden.some((r) => r.selectors.some((sel) =>
      /\.screen-nav-group\[data-single-screen\s*=\s*"true"\]/.test(sel)
      && /\.screen-nav-item\s*$/.test(sel)));
    expect(perGroup, ".screen-nav-group[data-single-screen=true] .screen-nav-item").toBe(true);
  });

  test("buildDesignUI stamps each group from that design's own screen count", () => {
    const build = slice(jsSource, "function buildDesignUI(");
    // The count must come from the design being rendered (`d`), not from the
    // active one — that is the whole point of moving the flag off <body>.
    expect(build).toMatch(/group\.dataset\.singleScreen\s*=/);
    const stamp = /group\.dataset\.singleScreen\s*=\s*String\(\s*screens\.length\s*<=\s*1\s*\)/;
    expect(build, "group flag derived from this group's screens").toMatch(stamp);
    // and it must be stamped from the same array the items are built from
    expect(build).toMatch(/const screens = \[\.\.\.d\.querySelectorAll\('section\[data-screen\]\[id\]'\)\]/);
  });

  test("the CSS reads the very attribute the JS writes", () => {
    // The bug this file guards was a MISMATCH between what the JS sets and
    // what the CSS reads, so checking each side's existence separately is not
    // enough: a rename on either side leaves both isolated assertions green.
    // Both halves are derived from the source here, then required to meet.
    const build = slice(jsSource, "function buildDesignUI(");
    const kebab = (s) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

    const groupClass = /group\.className\s*=\s*'([^']+)'/.exec(build);
    expect(groupClass, "group.className in buildDesignUI").toBeTruthy();
    const flagKey = /group\.dataset\.(\w+)\s*=/.exec(build);
    expect(flagKey, "group.dataset.<flag> in buildDesignUI").toBeTruthy();
    // The item class must come from the screens loop, not from the design
    // switcher or the view list, which also assign a className in here.
    const loop = slice(build, "screens.forEach(");
    const itemClass = /btn\.className\s*=\s*'([^']+)'/.exec(loop);
    expect(itemClass, "btn.className inside screens.forEach").toBeTruthy();

    const want = `.${groupClass[1]}[data-${kebab(flagKey[1])}="true"] .${itemClass[1]}`;
    const wired = hidden.some((r) => r.selectors.some((s) => s.trim() === want));
    expect(wired, `CSS must hide exactly: ${want}`).toBe(true);
  });

  test("the container rule reads the very body flag updateScreenScope writes", () => {
    const scope = slice(jsSource, "function updateScreenScope(");
    const kebab = (s) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    const bodyKey = /document\.body\.dataset\.(\w+)\s*=/.exec(scope);
    expect(bodyKey, "document.body.dataset.<flag> in updateScreenScope").toBeTruthy();
    const attr = `[data-${kebab(bodyKey[1])}="true"]`;
    // That flag may reach #screen-nav ONLY together with the single-design
    // one — on its own it describes just the design on the canvas.
    const container = hidden.filter((r) => r.selectors.some((s) => /#screen-nav\s*$/.test(s)));
    expect(container.length, "a rule hiding #screen-nav").toBeGreaterThan(0);
    for (const rule of container) {
      for (const sel of rule.selectors.filter((s) => /#screen-nav\s*$/.test(s))) {
        if (!sel.includes(attr)) continue;
        expect(sel, "active-design flag must be paired with single-design")
          .toMatch(/\[data-single-design\s*=\s*"true"\]/);
      }
    }
  });

  test("the dock's per-screen row keeps the active-design body flag", () => {
    // Guard against over-correcting: the dock IS about the screen currently
    // on the canvas, so body[data-single-screen] is the right scope there.
    const dockRow = hidden.some((r) => r.selectors.some((sel) =>
      /^body\[data-single-screen\s*=\s*"true"\]/.test(sel)
      && /#screen-textareas/.test(sel)));
    expect(dockRow, "body[data-single-screen] .feedback-section:has(#screen-textareas)").toBe(true);
  });
});

describe("chrome safe area — the canvas must not paint under fixed chrome", () => {
  // Design mode floats the indicator, the design switcher and two 60px FABs
  // over a canvas that runs edge to edge (inset: 0). A flat `padding: 2rem`
  // put the content's first row 32px down while the chrome reached 92px, so
  // every screen tall enough to fill the viewport had its opening lines
  // painted underneath it (measured at 921x873: 18px of overlap).
  const CONTAINERS = [
    ['screens', /^\[data-template="design"\] section\[data-screen\]$/],
    ['views', /^\[data-template="design"\] section\[data-view\]$/],
    ['device frames', /section\[data-screen\]\[data-device-mode\]$/],
  ];

  function ruleFor(re) {
    const hit = RULES.find((r) => r.selectors.some((s) => re.test(s.trim())));
    expect(hit, "rule for " + re).toBeTruthy();
    return hit.body;
  }

  test("the reserve is declared as tokens, not a number per call site", () => {
    const root = RULES.find((r) => r.selectors.some((s) => /^html\[data-template="design"\]$/.test(s.trim()))
      && /--chrome-safe-top\s*:/.test(r.body));
    expect(root, "html[data-template=design] { --chrome-safe-* }").toBeTruthy();
    expect(root.body).toMatch(/--chrome-safe-top\s*:\s*[\d.]+rem/);
    expect(root.body).toMatch(/--chrome-safe-bottom\s*:\s*[\d.]+rem/);
  });

  test.each(CONTAINERS)("%s reserve the top band", (_name, re) => {
    const body = ruleFor(re);
    const padding = /padding\s*:\s*([^;]+);/.exec(body);
    expect(padding, "padding declaration").toBeTruthy();
    // The TOP component must be the token; a bare length here is the bug.
    expect(padding[1].trim(), "top padding").toMatch(/^var\(--chrome-safe-top,\s*[\d.]+rem\)\s/);
    // and the bottom must be declared too, so the shorthand cannot silently
    // mirror the top back onto an edge that does not need it.
    expect(padding[1].trim(), "bottom padding").toMatch(/ var\(--chrome-safe-bottom,\s*[\d.]+rem\)$/);
  });

  test("the top token clears the deepest chrome the file itself positions", () => {
    // Derived from the CSS, not from a copy of the number in the comment —
    // moving a FAB without moving the reserve must fail here.
    const rem = (v) => (/rem$/.test(v) ? parseFloat(v) * 16 : parseFloat(v));
    const rootBody = RULES.find((r) => /--chrome-safe-top\s*:/.test(r.body)).body;
    const top = rem(/--chrome-safe-top\s*:\s*([\d.]+rem)/.exec(rootBody)[1]);
    const css = stripComments(cssSource);
    const fabTop = rem(/\.panel-fab\s*\{[^}]*top:\s*([\d.]+rem)/.exec(css)[1]);
    const fabBox = RULES.find((r) => r.selectors.some((s) => /\.panel-fab$/.test(s.trim()))
      && /height:\s*\d+px/.test(r.body));
    const fabH = parseFloat(/height:\s*(\d+)px/.exec(fabBox.body)[1]);
    expect(top, `--chrome-safe-top must cover .panel-fab (${fabTop}px + ${fabH}px)`)
      .toBeGreaterThanOrEqual(fabTop + fabH);
    // The annotation eye pill shares the top-left column and sits BELOW the
    // indicator, so it is the other candidate for deepest.
    const anno = rem(/\.anno-toggle-fab\s*\{[^}]*top:\s*([\d.]+rem)/.exec(css)[1]);
    expect(top, "--chrome-safe-top must clear #anno-toggle's row").toBeGreaterThan(anno);
  });

  test("the reserve does not push device frames past the readability floor", () => {
    // The safe area costs the .device-stage box real height, and fitDeviceStage
    // scales the frame pair to that box. Below MIN_DEVICE_SCALE the stage flips
    // to a scrolling, top-aligned layout — a whole layout-mode change caused
    // only by padding. bestFit is pure, so the interaction can be computed here
    // instead of asserted by eye.
    const js = jsSource;
    const rem = (v) => (/rem$/.test(v) ? parseFloat(v) * 16 : parseFloat(v));
    const consts = ["DEVICE_SIZES", "MIN_DEVICE_SCALE"]
      .map((n) => new RegExp("^\\s*const " + n + " = .*$", "m").exec(js)?.[0])
      .filter(Boolean).join("\n");
    expect(consts, "device constants").toContain("MIN_DEVICE_SCALE");
    const bestFit = new Function(consts + "\n" + slice(js, "function bestFit(")
      + "\nreturn { bestFit, DEVICE_SIZES, MIN_DEVICE_SCALE };")();

    const rootBody = RULES.find((r) => /--chrome-safe-top\s*:/.test(r.body)).body;
    const top = rem(/--chrome-safe-top\s*:\s*([\d.]+rem)/.exec(rootBody)[1]);
    const bottom = rem(/--chrome-safe-bottom\s*:\s*([\d.]+rem)/.exec(rootBody)[1]);
    const side = rem(/padding:[^;]*?\s([\d.]+rem)\s+var\(--chrome-safe-bottom/
      .exec(stripComments(cssSource).replace(/\s+/g, " "))?.[1] || "1.5rem");

    // A 13" laptop window is the smallest canvas these pages target.
    const VW = 1280, VH = 700, GAP = 32;
    const availW = VW - 2 * side, availH = VH - top - bottom;
    const { bestFit: fit, DEVICE_SIZES, MIN_DEVICE_SCALE } = bestFit;
    for (const [name, size] of Object.entries(DEVICE_SIZES)) {
      // worst realistic case: portrait + landscape of the same device
      const pair = [size, [size[1], size[0]]];
      const res = fit(pair, availW, availH, GAP);
      expect(res.clamped, `${name} pair clamps at ${VW}x${VH} — the safe area `
        + `left only ${availH}px of height`).toBe(false);
      expect(res.scale, `${name} pair scale`).toBeGreaterThan(MIN_DEVICE_SCALE);
    }
  });

  test("the bottom reserve stays a plain gutter — the edge is corner-only", () => {
    // Asymmetry is the point: mirroring the top would spend another 60px of
    // artefact height on an edge whose centre holds nothing. If a future
    // change puts chrome in the bottom CENTRE, this is the test to revisit.
    const css = stripComments(cssSource);
    const rem = (v) => (/rem$/.test(v) ? parseFloat(v) * 16 : parseFloat(v));
    const rootBody = RULES.find((r) => /--chrome-safe-bottom\s*:/.test(r.body)).body;
    const bottom = rem(/--chrome-safe-bottom\s*:\s*([\d.]+rem)/.exec(rootBody)[1]);
    expect(bottom, "bottom gutter").toBeLessThan(
      rem(/--chrome-safe-top\s*:\s*([\d.]+rem)/.exec(rootBody)[1]));
    // Both bottom-edge controls must be corner-anchored for that to hold.
    for (const sel of ['.feedback-fab', '.viewport-toggle']) {
      const rule = RULES.find((r) => r.selectors.some((x) => x.trim() === sel)
        && /(left|right):/.test(r.body));
      expect(rule, sel + " must be corner-anchored").toBeTruthy();
      expect(rule.body, sel + " anchor").toMatch(/(left|right):\s*[\d.]+rem/);
    }
    expect(css).not.toMatch(/\.[\w-]+\s*\{[^}]*bottom:\s*[\d.]+rem;[^}]*left:\s*50%/);
  });
});

describe("panel and dock are mutually exclusive overlays", () => {
  // Executed, not pattern-matched: the four functions are lifted out of
  // templates.md and run against stub elements, so this pins the state
  // machine rather than the wording of it.
  function harness() {
    const focusLog = [];
    const el = (name) => {
      const cls = new Set();
      const node = {
        name,
        classList: {
          add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
        },
        dataset: {},
        setAttribute() {}, getAttribute() { return null; },
        // `holds` lets a test say "the caret is inside me right now"
        holds: false,
        contains() { return node.holds; },
        focus() { focusLog.push(name); },
      };
      return node;
    };
    // The reciprocal calls go through `window.`, so the harness has to make
    // the same export templates.md makes — asserted below, not assumed.
    expect(jsSource, "window.closeDock export").toMatch(/window\.closeDock\s*=\s*closeDock\s*;/);
    const src = [
      slice(jsSource, "window.openPanel ="),
      slice(jsSource, "window.closePanel ="),
      slice(jsSource, "function openDock("),
      slice(jsSource, "function closeDock("),
      "window.closeDock = closeDock",
    ].join(";\n");
    const make = new Function("panel", "panelToggle", "panelCloseBtn", "backdrop",
      "dock", "dockToggle", "document", "window", "LABEL_OPEN", "LABEL_CLOSE",
      // openPanel/closePanel are assigned onto `window`, never declared
      src + "; return { openPanel: window.openPanel, closePanel: window.closePanel,"
          + " openDock, closeDock };");
    const panel = el("panel"), dock = el("dock"), panelToggle = el("panelToggle"),
      panelCloseBtn = el("panelCloseBtn"), backdrop = el("backdrop"),
      dockToggle = el("dockToggle");
    const doc = { body: el("body"), activeElement: null };
    const api = make(panel, panelToggle, panelCloseBtn, backdrop, dock, dockToggle,
      doc, {}, "open", "close");
    return {
      ...api,
      panelOpen: () => panel.classList.contains("open"),
      dockOpen: () => dock.dataset.open === "true",
      // simulate the caret sitting in a dock textarea
      caretInDock: (on) => { dock.holds = on; doc.activeElement = on ? el("textarea") : null; },
      focusLog,
    };
  }

  test("opening the panel minimises the dock", () => {
    const h = harness();
    h.openDock();
    expect(h.dockOpen()).toBe(true);
    h.openPanel();
    expect(h.panelOpen(), "panel opened").toBe(true);
    expect(h.dockOpen(), "dock still open behind the panel").toBe(false);
  });

  test("opening the dock closes the panel", () => {
    const h = harness();
    h.openPanel();
    expect(h.panelOpen()).toBe(true);
    h.openDock();
    expect(h.dockOpen(), "dock opened").toBe(true);
    expect(h.panelOpen(), "panel still open under the dock").toBe(false);
  });

  test("the FABs are actually bound to the functions under test", () => {
    // The harness above proves the state machine; it cannot prove the buttons
    // reach it. Without this, renaming the handler at the addEventListener
    // call site leaves every behavioural test green and the page dead.
    expect(jsSource, "☰ bound to openPanel")
      .toMatch(/panelToggle\?\.addEventListener\('click',\s*openPanel\)/);
    expect(jsSource, "💬 toggles the dock")
      .toMatch(/dockToggle\.addEventListener\('click',[\s\S]{0,160}?closeDock\(\)[\s\S]{0,80}?openDock\(\)/);
  });

  test("a hand-off close does not park focus on the dock FAB", () => {
    // The 💬 FAB outranks the panel backdrop, so focusing it while the panel
    // opens leaves a keyboard user on a control that dismisses the panel.
    const close = slice(jsSource, "function closeDock(");
    expect(close, "closeDock takes a hand-off flag").toMatch(/function closeDock\(\s*\w+\s*\)/);
    expect(close, "the flag suppresses the focus restore")
      .toMatch(/const focusWasInside\s*=\s*!\w+\s*&&\s*dock\.contains/);
    const open = slice(jsSource, "window.openPanel =");
    expect(open, "openPanel closes the dock as a hand-off").toMatch(/closeDock\?\.\(\s*true\s*\)/);
    expect(open, "and re-homes the focus it took").toMatch(/panelCloseBtn\?\.focus\(\)/);
  });

  test("☰ from inside the dock moves focus into the panel, not onto the FAB", () => {
    // The 💬 FAB paints above the panel backdrop, so parking focus there would
    // leave a keyboard user on a control that dismisses the panel they just
    // opened. Executed, not pattern-matched — the source-shape assertions
    // above cannot see where focus actually lands.
    const h = harness();
    h.openDock();
    h.caretInDock(true);
    h.openPanel();
    expect(h.panelOpen()).toBe(true);
    expect(h.dockOpen()).toBe(false);
    expect(h.focusLog, "focus must not land on the dock FAB").not.toContain("dockToggle");
    expect(h.focusLog, "focus is re-homed into the panel").toContain("panelCloseBtn");
  });

  test("a normal dock dismissal still restores the FAB", () => {
    // The hand-off must not cost the ordinary close its focus restore, or
    // focus is orphaned inside a display:none dock.
    const h = harness();
    h.openDock();
    h.caretInDock(true);
    h.closeDock();
    expect(h.focusLog, "plain close returns focus to the FAB").toContain("dockToggle");
  });

  test("a pointer user is not robbed of focus", () => {
    const h = harness();
    h.openDock();          // caret NOT in the dock
    h.openPanel();
    expect(h.focusLog, "nothing was focused").toEqual([]);
  });

  test("closing one never re-opens the other", () => {
    // The reciprocal calls live in the OPEN paths only; a close that also
    // opened would ping-pong the two overlays on every dismissal.
    const h = harness();
    h.openPanel();
    h.closePanel();
    expect(h.panelOpen()).toBe(false);
    expect(h.dockOpen(), "closing the panel opened the dock").toBe(false);
    h.openDock();
    h.closeDock();
    expect(h.dockOpen()).toBe(false);
    expect(h.panelOpen(), "closing the dock opened the panel").toBe(false);
  });
});

describe("attachment bars — one 📎 on screen, not one per hidden field", () => {
  // The dock builds a textarea per screen, per design and per view up front
  // and then only flips `hidden` on switch, but each textarea's `.attach-slot`
  // mount is a SIBLING of it. `.attach-slot:empty` covers a mount only until a
  // bar lands in it, so the moment initCommentAttachments() ran, every hidden
  // field's bar rendered under the one visible textarea — the dock showed
  // eight identical "📎 Strg+V oder beliebige Datei ablegen" rows.

  test("a hidden field's bar is hidden with it, on both mount paths", () => {
    // Two paths exist: a dedicated `.attach-slot` (every dock-built field,
    // annotation answers) and the mountless fallback that inserts the bar
    // itself after the textarea. Covering only the first leaves the second
    // free to stack.
    for (const sub of [".attach-slot", ".attach-bar"]) {
      const rule = hidden.find((r) => r.selectors.some((s) =>
        new RegExp("^textarea\\[hidden\\]\\s*\\+\\s*\\" + sub + "$").test(s.trim())));
      expect(rule, "textarea[hidden] + " + sub).toBeDefined();
    }
  });

  test("the mountless fallback puts the bar next to its field", () => {
    // …which is what makes the `.attach-bar` half of that rule reachable.
    // `parentElement.appendChild` drops the bar after everything else in the
    // row instead — no longer an adjacent sibling, no longer hideable.
    const mount = slice(jsSource, "function _mountAttachmentBar(");
    expect(mount, "fallback insert point").toMatch(/insertAdjacentElement\('afterend', bar\)/);
    expect(mount, "fallback must not append to the container")
      .not.toMatch(/parentElement\.appendChild\(bar\)/);
  });

  test("every dock builder emits the mount adjacent to its textarea", () => {
    // The rule above is an ADJACENT sibling combinator, so it only reaches a
    // mount that directly follows its field. Anything appended in between
    // silently restores the stack while the CSS still reads correct.
    const builders = [
      "function buildDesignTextareas(",
      "function buildScreenTextareas(",
      "function buildViewTextareas(",
    ];
    for (const fn of builders) {
      const body = slice(jsSource, fn);
      const ta = body.indexOf("appendChild(ta)");
      const slot = body.indexOf("appendChild(slot)");
      expect(ta, fn + " appends its textarea").toBeGreaterThan(-1);
      expect(slot, fn + " appends its attach mount after the textarea").toBeGreaterThan(ta);
      const between = body.slice(ta + "appendChild(ta)".length, slot);
      expect(between, fn + " appends something between field and mount")
        .not.toMatch(/appendChild\(/);
    }
  });

  test("the visibility hand-off stays CSS-only", () => {
    // The bar must keep EXISTING (and stay wired) while its field is hidden —
    // attachments already on an inactive field have to survive the switch —
    // so the switchers may only toggle `ta.hidden`, never unmount a bar.
    const switchers = [
      "window.showScreen = function(",
      "window.showDesign = function(",
      "window.showView = function(",
    ];
    for (const fn of switchers) {
      const body = slice(jsSource, fn);
      expect(body, fn + " must not tear down attachment mounts")
        .not.toMatch(/attach-slot|attachSlot|attach-bar|attachFor/);
    }
  });

  test("the bar is the icon alone — no hint label", () => {
    // One 📎 per field is already the affordance; a spelled-out shortcut line
    // repeated under every field out-weighs the field it decorates. The
    // shortcuts live in the button's title/aria-label instead.
    const bar = slice(jsSource, "function buildAttachmentBar(");
    expect(bar, "the 📎 keeps an accessible name once its label is gone")
      .toMatch(/aria-label="\{\{attach\.button_title\}\}"/);
    expect(md, "attach-hint markup, CSS or locale key came back")
      .not.toMatch(/attach-hint|`attach\.hint`/);
  });
});

describe("exactly one design / screen / view paints", () => {
  // Measured on a real generated page: an iteration holding three designs
  // emitted `hidden` on none of them, so five screens across all three
  // rendered at once — every one position:absolute/inset:0, all stacked on
  // the same square. Headings, labels and mockups interleaved; the page was
  // unreadable and every click ambiguous. `hidden` alone could not prevent
  // it: it is set by JS the markup is merely ASKED to pre-empt, and nothing
  // enforced that. These rules make the active flags carry visibility too.

  const norm = (s) => s.replace(/\s+/g, " ").trim();

  test("an inactive design and an inactive screen are off the canvas", () => {
    for (const [sel, flag] of [
      ["section[data-design]", "data-design-active"],
      ["section[data-screen]", "data-screen-active"],
    ]) {
      const subject = sel + ':not([' + flag + '="true"])';
      const matching = hidden.flatMap((r) => r.selectors.map(norm))
        .filter((s) => s.endsWith(subject));
      expect(matching.length, subject).toBeGreaterThan(0);
      // ...but only once something IS marked active. Unguarded, a page whose
      // markup omits the flag entirely would render an empty canvas - a worse
      // failure than the stack this replaces.
      for (const s of matching) {
        expect(s, "must be :has()-guarded").toContain(":has(");
      }
    }
  });

  test("no view paints outside view mode", () => {
    // The other direction: at boot nothing has run, so body[data-view-active]
    // is absent — which must read as "not in view mode", or a view that ships
    // without `hidden` covers the design the page opens on.
    const rule = hidden.find((r) => r.selectors.some((s) =>
      /^body:not\(\[data-view-active="true"\]\)\s+section\[data-view\]$/.test(s.trim())));
    expect(rule, 'body:not([data-view-active="true"]) section[data-view]').toBeDefined();
  });

  test("the switchers still maintain the flags the rules key on", () => {
    // The CSS above is only as good as the attributes it reads. A switcher
    // that stopped writing one would leave the canvas permanently blank
    // instead of merely mis-highlighted, so pin the writes.
    expect(slice(jsSource, "window.showDesign = function("), "showDesign writes designActive")
      .toMatch(/dataset\.designActive\s*=/);
    expect(slice(jsSource, "window.showScreen = function("), "showScreen writes screenActive")
      .toMatch(/dataset\.screenActive\s*=/);
    const view = slice(jsSource, "window.showView = function(");
    expect(view, "showView writes body[data-view-active]").toMatch(/body\.dataset\.viewActive\s*=\s*'true'/);
    expect(slice(jsSource, "window.showDesign = function("), "showDesign clears it again")
      .toMatch(/body\.dataset\.viewActive\s*=\s*'false'/);
  });
});
