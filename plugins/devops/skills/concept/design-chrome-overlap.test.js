import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Three defects measured on ONE real generated page (4 iterations, 18
// textarea[data-attachable], 1280x720). All three share a root cause shape:
// the page is a COPY of templates.md taken on generation day, so a reference
// that is only correct in one place ships broken pages forever after.
//
//   1. Stacked 📎 bars — 12 visible for 3 visible textareas, dock content
//      1062px inside a 430px box. The page had the `.attach-slot` half of the
//      hide rule and not the `.attach-bar` half, mounted via
//      `parentElement.appendChild(bar)`, and still rendered `.attach-hint`.
//      Gate entry 44 grepped ONE literal, so it passed. Fix: the engine
//      injects its own visibility CSS (`attach-visibility-styles`), so a page
//      that copies the JS without the Layout CSS is still correct.
//   2. The raw platform scrollbar in the feedback dock: three boxes carry a
//      legitimate `overflow-y: auto` and nothing skinned the bar.
//   3. Header/intro bleed-through on a ☰ switch to a frozen design round.
//      Design iterations are `position: absolute; inset: 0` and paint over the
//      document `<header>` and the `.iteration-intro`, which stay in normal
//      flow — and `:not([data-active]) { opacity: 0.85 }` made the section
//      see-through, so both showed straight through the mockup (h1 at y=32,
//      intro at y=0, under the fixed screen indicator).
//
// templates.md is a REFERENCE Claude copies verbatim into generated pages, so
// a defect here ships silently into every concept produced afterwards.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const iterRules = fs.readFileSync(path.join(DK, "iteration-rules.md"), "utf8");

// Line-based scanner (same reason as panel-chrome.test.js): a lazy
// ```css\n([\s\S]*?)``` regex desynchronises on the first block whose body
// contains a fence and silently stops seeing everything after it.
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
const CSS_BLOCKS = BLOCKS.filter((b) => b.info === "css");
const JS_BLOCKS = BLOCKS.filter((b) => /^(javascript|js)$/.test(b.info));
const cssSource = CSS_BLOCKS.map((b) => b.code).join("\n");
const jsSource = JS_BLOCKS.map((b) => b.code).join("\n");

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripJsComments = (s) => s.replace(/^\s*\/\/.*$/gm, "");

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

/** Brace-balanced rule walker; recurses into at-rules. */
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
    out.push({ selectors: splitSelectors(sel.trim()), body: src.slice(i + 1, j) });
    if (sel.trim().startsWith("@")) out.push(...cssRules(src.slice(i + 1, j)));
    sel = "";
    i = j + 1;
  }
  return out.filter((r) => r.selectors.length && !r.selectors[0].startsWith("@"));
}
const RULES = cssRules(stripComments(cssSource));
const norm = (s) => s.replace(/\s+/g, " ").trim();

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

/** Every rule whose selector list contains one matching `re`. */
function rulesFor(re) {
  return RULES.filter((r) => r.selectors.some((s) => re.test(norm(s))));
}

describe("design mode hides the document chrome it would paint over", () => {
  test("the document header is hidden while design mode is active", () => {
    // The decision and free templates put <h1> + subtitle + #theme-toggle in
    // `.concept-content > header`; the design template's .concept-content
    // holds only <main>. A mixed page (§ Per-Iteration Templates allows any
    // order) therefore carries a header the design canvas paints over.
    const hits = rulesFor(/^html\[data-template="design"\] \.concept-content > header$/);
    expect(hits.length, 'html[data-template="design"] .concept-content > header').toBeGreaterThan(0);
    for (const r of hits) expect(r.body).toMatch(/display\s*:\s*none/);
  });

  test("the per-iteration intro is hidden too", () => {
    // Both decision/free and design iterations may open with
    // <header class="iteration-intro">. It sits INSIDE the absolutely
    // positioned section, so it bleeds through the mockup from y=0.
    const hits = rulesFor(/^html\[data-template="design"\] section\[data-iteration\] > \.iteration-intro$/);
    expect(hits.length, "design mode must hide .iteration-intro").toBeGreaterThan(0);
    for (const r of hits) expect(r.body).toMatch(/display\s*:\s*none/);
  });

  test("the markup shape the rules key on is the one the templates emit", () => {
    // Anchoring on a selector nobody emits is the failure mode these two
    // assertions exist to prevent: both halves are read back out of the
    // template markup rather than assumed.
    const html = BLOCKS.filter((b) => b.info === "html").map((b) => b.code).join("\n");
    expect(html, ".concept-content > header in the decision/free skeleton")
      .toMatch(/<div class="concept-content">\s*(<!--[\s\S]*?-->\s*)*<header>/);
    expect(html, '<header class="iteration-intro"> inside an iteration section')
      .toMatch(/<header class="iteration-intro">/);
  });

  test("the theme toggle's only home is that header — hiding it is a decision, not an oversight", () => {
    // If a future change gives design mode its own toggle, this test is the
    // one to revisit: the rule above would then be hiding a live control.
    const html = BLOCKS.filter((b) => b.info === "html").map((b) => b.code).join("\n");
    const toggles = html.match(/id="theme-toggle"/g) || [];
    expect(toggles.length, "#theme-toggle occurrences in template markup").toBeGreaterThan(0);
    expect(md, "the trade-off must be written down where the rule lives")
      .toMatch(/theme toggle lives only in that header/);
  });

  test("a frozen DESIGN iteration stays fully opaque", () => {
    // § Tab Bar CSS dims every frozen iteration to 0.85 — legible for a
    // sidebar section in normal flow, a see-through hole for an
    // absolute/inset:0 canvas. Frozen-ness is carried by the panel state and
    // the read-only dock (applyDockFreezeState) instead.
    const dim = rulesFor(/^section\[data-iteration\]:not\(\[data-active\]\)$/)
      .filter((r) => /opacity\s*:\s*0?\.\d/.test(r.body));
    expect(dim.length, "the generic frozen dimmer this exempts").toBeGreaterThan(0);

    const exempt = rulesFor(/^html\[data-template="design"\] section\[data-iteration\]:not\(\[data-active\]\)$/)
      .filter((r) => /opacity\s*:\s*1(?![.\d])/.test(r.body));
    expect(exempt.length, 'html[data-template="design"] …:not([data-active]) { opacity: 1 }')
      .toBeGreaterThan(0);

    // Source order cannot be relied on — the two rules live in different
    // sections of this reference and a generated page inlines them in
    // whatever order it assembles the <style>. The exemption must therefore
    // win on SPECIFICITY: it is the dimmer's own selector with an extra
    // `html[data-template="design"]` in front, which outranks it wherever it
    // lands. A same-specificity variant (e.g. dropping the html prefix for a
    // `[data-template="design"]` one on the section itself) would be a
    // coin-flip on order, so pin the shape.
    for (const r of exempt) {
      for (const sel of r.selectors) {
        expect(norm(sel), "exemption must outrank the dimmer by specificity")
          .toBe('html[data-template="design"] '
            + dim[0].selectors.map(norm).find((s) => /^section\[data-iteration\]/.test(s)));
      }
    }
  });

  test("§ Per-Iteration Templates says a decision/free page keeps its header", () => {
    // The CSS only works if the markup is still there to hide; a later design
    // round deleting the header would strand every earlier iteration.
    const section = md.slice(md.indexOf("## Per-Iteration Templates"),
      md.indexOf("# Template: decision"));
    expect(section, "the keep-the-header rule").toMatch(/keeps its document header/i);
    // The prose is hard-wrapped, so the pointer may straddle a newline.
    expect(norm(section), "and the pointer to the CSS that hides it")
      .toMatch(/Document chrome vs\. the fullscreen canvas/);
  });
});

describe("scroll boxes are skinned, not raw", () => {
  const BOXES = [".feedback-dock", ".concept-decision-panel", "section[data-screen]"];

  test.each(BOXES)("%s declares the thin scrollbar", (box) => {
    const hit = RULES.find((r) => r.selectors.some((s) => norm(s) === box)
      && /scrollbar-width\s*:\s*thin/.test(r.body));
    expect(hit, box + " { scrollbar-width: thin }").toBeTruthy();
    expect(hit.body, box + " thumb colour on a transparent track")
      .toMatch(/scrollbar-color\s*:\s*var\(--border-color[^)]*\)\s+transparent/);
  });

  test.each(BOXES)("%s ships the ::-webkit fallback too", (box) => {
    // scrollbar-* is Firefox + modern Chromium only; older WebKit ignores it
    // entirely and keeps the 16px slab. Both syntaxes or neither.
    const want = {
      "::-webkit-scrollbar": /width\s*:\s*8px/,
      "::-webkit-scrollbar-thumb": /background\s*:\s*var\(--border-color/,
      "::-webkit-scrollbar-track": /background\s*:\s*transparent/,
    };
    for (const [pseudo, body] of Object.entries(want)) {
      const hit = RULES.find((r) => r.selectors.some((s) => norm(s) === box + pseudo)
        && body.test(r.body));
      expect(hit, box + pseudo).toBeTruthy();
    }
    const thumb = RULES.find((r) => r.selectors.some((s) => norm(s) === box + "::-webkit-scrollbar-thumb"));
    expect(thumb.body, "thumb is rounded").toMatch(/border-radius\s*:\s*4px/);
  });

  test("the skin stays unscoped — every template has these boxes", () => {
    // Scoping it to html[data-template="design"] would leave the decision and
    // free iterations of the SAME page with the raw bar.
    for (const box of BOXES) {
      const hit = RULES.find((r) => r.selectors.some((s) => norm(s) === box)
        && /scrollbar-width/.test(r.body));
      for (const sel of hit.selectors) {
        expect(norm(sel), "scrollbar skin must not be template-scoped")
          .not.toMatch(/data-template/);
      }
    }
  });

  test("the boxes it skins are the ones that actually scroll", () => {
    // Derived, not copied: a box that stops scrolling should drop out of the
    // list rather than keep a dead rule, and one that STARTS scrolling should
    // fail here until it is added.
    const scrolling = new Set();
    for (const r of RULES) {
      if (!/overflow(-y)?\s*:\s*(auto|scroll)/.test(r.body)) continue;
      for (const s of r.selectors) {
        for (const box of BOXES) if (norm(s).includes(box)) scrolling.add(box);
      }
    }
    expect([...scrolling].sort(), "skinned boxes must all be scroll containers")
      .toEqual([...BOXES].sort());
  });
});

describe("the attachment engine carries its own visibility CSS", () => {
  test("_ensureAttachStyles injects the id the gate greps for", () => {
    const fn = slice(jsSource, "function _ensureAttachStyles(");
    expect(fn, "idempotent by id").toMatch(/getElementById\('attach-visibility-styles'\)/);
    expect(fn, "and stamps that id on the node it creates")
      .toMatch(/\.id\s*=\s*'attach-visibility-styles'/);
    // Both halves of the hide rule, plus the :empty mount rule.
    expect(fn).toMatch(/textarea\[hidden\] \+ \.attach-slot/);
    expect(fn).toMatch(/textarea\[hidden\] \+ \.attach-bar/);
    expect(fn).toMatch(/\.attach-slot:empty/);
  });

  test("it is called from initCommentAttachments, in the same block", () => {
    // A helper defined in one copied block and called from another is exactly
    // the partial-copy failure it exists to prevent, so pin both to ONE fence.
    const block = JS_BLOCKS.find((b) => /function initCommentAttachments\(/.test(b.code));
    expect(block, "the block defining initCommentAttachments").toBeTruthy();
    expect(block.code, "_ensureAttachStyles must live in the same block")
      .toMatch(/function _ensureAttachStyles\(/);
    const init = slice(block.code, "function initCommentAttachments(");
    expect(init, "engine styles are ensured before any bar is mounted")
      .toMatch(/^\s*function initCommentAttachments\([^)]*\)\s*\{\s*_ensureAttachStyles\(\);/);
  });

  test("the Layout CSS copy stays — belt and braces, both directions", () => {
    // The injected style covers "took the JS, not the CSS"; the static rule
    // covers first paint before any script runs.
    for (const sub of [".attach-slot", ".attach-bar"]) {
      const hit = RULES.find((r) => r.selectors.some((s) =>
        norm(s) === "textarea[hidden] + " + sub) && /display\s*:\s*none/.test(r.body));
      expect(hit, "textarea[hidden] + " + sub + " in the CSS blocks").toBeTruthy();
    }
  });

  test("the mountless path inserts afterend, never onto the container", () => {
    const mount = slice(jsSource, "function _mountAttachmentBar(");
    expect(mount, "adjacent-sibling mount").toMatch(/insertAdjacentElement\('afterend', bar\)/);
    // Scanned across EVERY js block, not just this function: the forbidden
    // shape reappearing anywhere means some copy path can still emit it.
    expect(stripJsComments(jsSource), "parentElement.appendChild(bar) is the legacy stacking shape")
      .not.toMatch(/parentElement\.appendChild\(bar\)/);
    expect(md, "…and it must be named as forbidden in the prose")
      .toMatch(/forbidden legacy shape/i);
  });
});

describe("the gate can no longer pass a stacking page", () => {
  const entry = (n) => {
    const line = gate.split("\n").find((l) => l.startsWith("| " + n + " |"));
    expect(line, "gate entry " + n).toBeTruthy();
    return line;
  };

  test("entry 44 requires all four engine literals and both negatives", () => {
    const e = entry(44);
    for (const lit of [
      "textarea[hidden] + .attach-slot",
      "textarea[hidden] + .attach-bar",
      "insertAdjacentElement('afterend', bar)",
      "attach-visibility-styles",
      "parentElement.appendChild(bar)",
      "attach-hint",
    ]) expect(e, "entry 44 must name " + lit).toContain(lit);
    expect(gate, "…and explain why one literal was not enough")
      .toMatch(/PASSED it while rendering/);
  });

  test("entries 46 / 47 pin the design-mode chrome rules", () => {
    expect(entry(46)).toContain('html[data-template="design"] .concept-content > header');
    expect(entry(46)).toContain(".iteration-intro");
    expect(entry(47)).toContain('html[data-template="design"] section[data-iteration]:not([data-active])');
    expect(entry(47)).toMatch(/opacity:\s*1/);
  });

  test("entry 48 is the scrollbar warning", () => {
    const e = entry(48);
    expect(e).toContain("scrollbar-width: thin");
    expect(e).toContain("::-webkit-scrollbar");
    for (const box of [".feedback-dock", ".concept-decision-panel", "section[data-screen]"]) {
      expect(e, "entry 48 must name " + box).toContain(box);
    }
    expect(e, "explicitly a warning, unlike 46/47").toMatch(/[Ww]arning, not a hard fail/);
  });

  test("the gate says it applies to existing pages on every append", () => {
    expect(gate, "§ Engine drift on iteration append")
      .toMatch(/## Engine drift on iteration append/);
    expect(gate, "the whole-file claim").toMatch(/WHOLE existing file on every append/);
  });
});

describe("iteration append re-syncs a drifted engine before appending", () => {
  test("SKILL.md Step 5c gains the drift check between 2.5 and 3", () => {
    const proc = skill.slice(skill.indexOf("2.5. **Verify form collection coverage"));
    const drift = proc.indexOf("2.6. **Engine drift check");
    const append = proc.indexOf("3. Append a new `<section data-iteration=");
    expect(drift, "step 2.6").toBeGreaterThan(-1);
    expect(append, "the append step").toBeGreaterThan(-1);
    expect(drift, "the drift check must run BEFORE the append").toBeLessThan(append);
    expect(proc.slice(drift, append), "…and point at the gate section")
      .toMatch(/Engine drift on iteration append/);
  });

  test("iteration-rules.md carries the same step", () => {
    expect(iterRules).toMatch(/\*\*2\.6\. Engine drift check\.\*\*/);
    expect(iterRules, "re-sync verbatim, then append")
      .toMatch(/re-sync that whole block verbatim\s+from templates\.md FIRST, then append/);
  });
});
