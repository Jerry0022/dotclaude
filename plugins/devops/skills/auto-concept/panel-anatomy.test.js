import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";

// The decision panel used to be one scrolling column: iteration chips, a flat
// TOC, the connection pill, then the two CTAs. On any long concept the call
// to action sat below the fold — the user scrolled the MENU to find the
// button — and the status area was noise at rest ("Claude verbunden") while
// silent about the one thing that matters: is my work saved / delivered?
//
// The "Kompass" anatomy pins three of four parts and lets only the tree
// scroll. Everything here is derived from templates.md, which Claude copies
// verbatim into generated pages: a defect in the reference ships silently.
//
//   .concept-decision-panel   flex column, 100vh, never scrolls itself
//   ├─ .panel-here            pinned   "you are here"
//   ├─ .panel-nav-scroll      flex:1; min-height:0; overflow-y:auto
//   ├─ .panel-status          pinned   ONE status line (+ dots after submit)
//   └─ .panel-cta             pinned   ≤120px, split button

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = readTemplates();
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");

// Line-based scanner (same reason as panel-chrome.test.js): a lazy regex
// desynchronises on the first block whose body contains a fence.
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
const HTML_BLOCKS = BLOCKS.filter((b) => b.info === "html");
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

function fnSource(name) {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found in templates.md");
  return m[0];
}

// The two panel skeletons: § Common Structure (sidebar) and the design overlay.
const SKELETONS = HTML_BLOCKS.filter((b) => b.code.includes('class="panel-cta"'));

describe("panel anatomy — markup (both skeletons)", () => {
  test("exactly two skeletons carry the four-part anatomy, in order", () => {
    expect(SKELETONS.length).toBe(2);
    for (const b of SKELETONS) {
      const where = `html block at line ${b.line}`;
      const at = (s) => { const i = b.code.indexOf(s); expect(i, `${s} in ${where}`).toBeGreaterThan(-1); return i; };
      const here = at('class="panel-here"');
      const scroll = at('class="panel-nav-scroll"');
      const status = at('class="panel-status"');
      const cta = at('class="panel-cta"');
      expect(here, where).toBeLessThan(scroll);
      expect(scroll, where).toBeLessThan(status);
      expect(status, where).toBeLessThan(cta);
      // The tree lives in the scroll box, the ready block in the foot.
      expect(at('class="iteration-tabs"'), where).toBeGreaterThan(scroll);
      expect(at('class="iteration-tabs"'), where).toBeLessThan(status);
      expect(at('id="panel-ready"'), where).toBeGreaterThan(cta);
    }
  });

  test("the status line moved OUT of #panel-ready and keeps its id + data-state contract", () => {
    for (const b of SKELETONS) {
      const where = `html block at line ${b.line}`;
      const pill = b.code.indexOf('id="connection-status"');
      expect(pill, where).toBeGreaterThan(b.code.indexOf('class="panel-status"'));
      expect(pill, where).toBeLessThan(b.code.indexOf('id="panel-ready"'));
      expect(b.code, where).toMatch(/id="connection-status" class="status-line" data-state="connecting" role="status"/);
      expect(b.code, where).toMatch(/class="panel-status" id="panel-status" data-status="connecting"/);
    }
  });

  test("#status-steps stays a real <ol>, under the line, hidden until submit", () => {
    for (const b of SKELETONS) {
      const where = `html block at line ${b.line}`;
      const detail = b.code.indexOf('id="status-detail" hidden');
      const list = b.code.indexOf('<ol class="status-steps" id="status-steps"');
      expect(detail, where).toBeGreaterThan(-1);
      expect(list, where).toBeGreaterThan(detail);
      expect(list, where).toBeLessThan(b.code.indexOf('class="panel-cta"'));
      expect(b.code, where).toContain('id="status-dots"');
      // The old three-dot waiting animation is gone — the dots ARE the steps.
      expect(b.code, where).not.toContain("waiting-animation");
    }
  });

  test("split button: implement lives inside #submit-menu behind the caret, no gap, no hint paragraphs", () => {
    for (const b of SKELETONS) {
      const where = `html block at line ${b.line}`;
      const ready = b.code.slice(b.code.indexOf('id="panel-ready"'), b.code.indexOf('id="panel-submitted"'));
      expect(ready, where).toContain('id="submit-iterate-btn"');
      expect(ready, where).toMatch(/id="submit-menu-btn"[^>]*aria-haspopup="menu"/);
      expect(ready, where).toMatch(/id="submit-menu-btn"[\s\S]*?aria-expanded="false"/);
      const menu = ready.indexOf('id="submit-menu" class="submit-menu" role="menu" hidden');
      expect(menu, where).toBeGreaterThan(ready.indexOf('id="submit-iterate-btn"'));
      expect(ready.indexOf('id="submit-implement-btn"'), where).toBeGreaterThan(menu);
      expect(ready, where).not.toContain("submit-gap");
      expect(ready, where).not.toMatch(/<p class="hint">\{\{panel\.submit_iterate_hint\}\}/);
      expect(ready, where).not.toMatch(/<p class="hint hint-warn">\{\{panel\.submit_implement_hint\}\}/);
      // …the hints are tooltips now.
      expect(ready, where).toMatch(/id="submit-iterate-btn"[^>]*data-tip="\{\{panel\.submit_iterate_hint\}\}"/);
      expect(ready, where).toMatch(/id="submit-implement-btn"[^>]*data-tip="\{\{panel\.submit_implement_hint\}\}"/);
      // The cache hint stays, twice: badge on the primary, line in the menu.
      expect((ready.match(/data-cache-hint="/g) || []).length, where).toBe(2);
    }
  });

  test("the close-out sheet is an accordion with the plan below its button; the sidebar skeleton keeps the frozen block in the foot", () => {
    const sidebar = SKELETONS.find((b) => b.code.includes('id="panel-final-report"'));
    expect(sidebar).toBeDefined();
    const cta = sidebar.code.indexOf('class="panel-cta"');
    for (const id of ["panel-frozen", "back-to-live-btn", "panel-final-report", "closeout-execute"]) {
      expect(sidebar.code.indexOf(`id="${id}"`), id).toBeGreaterThan(cta);
    }
    const sheet = sidebar.code.slice(sidebar.code.indexOf('id="closeout-sheet"'));
    // No misclick-gap left on the sheet — the accordion + two-state button
    // are the barrier now.
    expect(sheet).not.toContain('class="submit-gap"');
    // Every row block carries an accordion head, and all four sit inside the
    // scrollable rows region — not the button below it.
    const rowsRegion = sheet.slice(sheet.indexOf('class="closeout-rows"'), sheet.indexOf('<!-- /.closeout-rows -->'));
    expect(rowsRegion.length, "closeout-rows region").toBeGreaterThan(0);
    for (const kind of ["followups", "ship", "files", "handoffs"]) {
      const block = rowsRegion.slice(rowsRegion.indexOf(`data-closeout-block="${kind}"`));
      expect(block.slice(0, 400), kind).toContain("data-closeout-row");
    }
    const btn = sheet.indexOf('id="closeout-execute"');
    expect(btn, "execute button").toBeGreaterThan(-1);
    expect(sheet.indexOf('<!-- /.closeout-rows -->'), "rows region closes before the button").toBeLessThan(btn);
    // No plan line, no running/done hints under the button: the rows' inline
    // summaries are the readout, the button is the status. Only the stalled
    // hint (it carries an instruction) survives.
    expect(sheet).not.toContain('data-closeout-block="plan"');
    expect(sheet).not.toContain("closeout-plan");
    expect(sheet).not.toMatch(/data-finalize-state="(running|done)"/);
    expect(sheet).toMatch(/<p class="hint hint-warn" data-finalize-state="stalled" hidden>/);
    // The button carries every one of its labels + the execute title.
    for (const attr of ["data-label-next", "data-label-execute", "data-label-execute-offline",
                        "data-label-running", "data-label-done", "data-label-stalled", "data-title-execute"]) {
      expect(sheet.slice(btn, btn + 700), attr).toContain(attr + '="{{final.');
    }
    // The button's icon is hidden in the "Weiter ›" state — the label string
    // already carries its own "›", so an always-visible icon rendered
    // "› Weiter ›".
    expect(sheet).toMatch(/data-closeout-btn-icon hidden>/);
    // No status channel above the sheet, and the panel's status line is
    // hidden on the final-report tab — the button says both things itself.
    expect(sidebar.code).not.toContain('id="status-channel"');
    const statusHidden = rulesFor(/^body\.viewing-final \.panel-status$/)[0];
    expect(statusHidden, "body.viewing-final .panel-status").toBeTruthy();
    expect(statusHidden.body).toMatch(/display:\s*none/);
  });

  test("the close-out sheet is its own pinned foot: the rows scroll, the button never does", () => {
    // The original close-out sheet (one flat column) let the whole foot
    // scroll on the final-report tab (`body.viewing-final .panel-cta`), so a
    // long open row (e.g. the hand-offs list) pushed #closeout-execute below
    // the fold at ordinary viewport heights — "viel Scrollen, Button nicht an
    // der gleichen Stelle". The sheet must instead be a flex column whose
    // ONLY scrolling child is .closeout-rows.
    const sheetRule = rulesFor(/^\.closeout-sheet$/)[0];
    expect(sheetRule, ".closeout-sheet rule").toBeTruthy();
    expect(sheetRule.body).toMatch(/display:\s*flex/);
    expect(sheetRule.body).toMatch(/flex-direction:\s*column/);
    expect(sheetRule.body).toMatch(/flex:\s*1 1 auto/);
    expect(sheetRule.body).toMatch(/min-height:\s*0/);
    // .closeout-rows has NO pixel/percentage floor any more: a fixed floor
    // (260px, then 220px before it) either squeezed the pinned foot below
    // the viewport (`.panel-cta`'s own `overflow: hidden` then clipped the
    // plan + "Iterationen ansehen" link) or still only fit 1 of 4 heads with
    // a body open. Sticky-both-edges heads (below) are what actually keep
    // all four visible now, so the region itself is free to flex to
    // whatever height is left, however little.
    const rowsRule = rulesFor(/^\.closeout-sheet \.closeout-rows$/)[0];
    expect(rowsRule, ".closeout-sheet .closeout-rows rule").toBeTruthy();
    expect(rowsRule.body).toMatch(/flex:\s*1 1 auto/);
    expect(rowsRule.body).toMatch(/min-height:\s*0/);
    expect(rowsRule.body).toMatch(/overflow-y:\s*auto/);
    // No lingering pixel floor from the earlier attempts.
    expect(rowsRule.body).not.toMatch(/min-height:\s*\d+px/);
    // `.closeout-block` inside the rows region generates NO BOX at all
    // (`display: contents`) — a sticky element's containing block is its
    // nearest block-container ANCESTOR, and with the block as a real box
    // that ancestor was the (short) block itself, never the scroll region:
    // `bottom: N × H` could not pull a later head above its own block's top
    // edge, so with a tall body open in an earlier row every later head sat
    // entirely below the visible region (a live check measured heads 2–4
    // below the region's own bottom edge). `display: contents` makes the
    // heads direct flow children of `.closeout-rows` instead, so their
    // containing block finally IS the scroll region both edges need.
    const contentsRule = rulesFor(/^\.closeout-sheet \.closeout-rows > \.closeout-block$/)[0];
    expect(contentsRule, ".closeout-rows > .closeout-block contents rule").toBeTruthy();
    expect(contentsRule.body).toMatch(/display:\s*contents/);
    // [hidden] must keep winning over `display: contents` — a hidden block's
    // children must not render at all. Asserted via SPECIFICITY (one more
    // class+attribute than the rule above), not source order, so this can
    // never be silently flipped by a later, differently-scoped edit.
    const hiddenRule = rulesFor(/^\.closeout-sheet \.closeout-rows > \.closeout-block\[hidden\]$/)[0];
    expect(hiddenRule, ".closeout-rows > .closeout-block[hidden] override").toBeTruthy();
    expect(hiddenRule.body).toMatch(/display:\s*none/);
    // Every head is sticky on BOTH edges (top AND bottom) — top alone piles
    // heads at the top but still lets later ones scroll off the bottom once
    // the region is shorter than 4 head-heights, which is the routine case
    // here. JS (layoutCloseoutRowHeads()) sets the actual per-index offsets;
    // this only pins the CSS half of the contract. Targets the head
    // directly (not `> .closeout-block > [data-closeout-row]`): `display:
    // contents` removes `.closeout-block` from the box tree, so a child
    // combinator through it would no longer match a rendered box.
    const stickyRule = rulesFor(/^\.closeout-sheet \.closeout-rows \[data-closeout-row\]$/)[0];
    expect(stickyRule, "sticky row-head rule").toBeTruthy();
    expect(stickyRule.body).toMatch(/position:\s*sticky/);
    expect(stickyRule.body).toMatch(/z-index/);
    expect(stickyRule.body).toMatch(/background:/);
    // The sticky math needs a FIXED, known head height — CSS and JS must
    // agree on the same number or consecutive stuck heads gap or overlap.
    const headHeightRule = rulesFor(/^\.closeout-sheet \.closeout-row$/)[0];
    expect(headHeightRule, ".closeout-row fixed height").toBeTruthy();
    const cssHeadH = headHeightRule.body.match(/min-height:\s*([\d.]+)rem/);
    expect(cssHeadH, "CSS head height in rem").toBeTruthy();
    expect(jsSource).toMatch(new RegExp("CLOSEOUT_HEAD_H_REM = " + cssHeadH[1].replace(".", "\\.")));
    // #closeout-execute and the stalled hint are pinned `flex: none` — a
    // live check found `flex: 0 1 auto; min-height: 0` on a foot element let
    // it collapse to 7px (invisible) exactly when space was tight.
    const pinnedRule = cssSource.match(/\.closeout-sheet #closeout-execute,\s*\n\.closeout-sheet \.hint\[data-finalize-state\]\s*\{([^}]*)\}/);
    expect(pinnedRule, "pinned button/hint rule").toBeTruthy();
    expect(pinnedRule[1]).toMatch(/flex:\s*none/);
  });

  test("layoutCloseoutRowHeads() sets sticky top/bottom offsets per VISIBLE block index", () => {
    const fn = fnSource("layoutCloseoutRowHeads");
    // Indices are computed fresh over closeoutRows() (the visible set) every
    // call — a hidden block (no open points, no hand-offs) must not leave a
    // gap in the stack, and the set can change between renders.
    expect(fn).toContain("const rows = closeoutRows();");
    expect(fn).toContain("const n = rows.length;");
    expect(fn).toContain("head.style.top = (i * CLOSEOUT_HEAD_H_REM) + 'rem'");
    expect(fn).toContain("head.style.bottom = ((n - 1 - i) * CLOSEOUT_HEAD_H_REM) + 'rem'");
    // Called on every full render, not just the first — the visible set can
    // change (a followups/hand-offs block appearing or disappearing) and
    // stale offsets from a larger/smaller set would gap or overlap.
    const initFn = fnSource("initCloseoutRows");
    expect(initFn).toContain("layoutCloseoutRowHeads();");
  });


  test("the one button carries the submission state; the sheet keeps no plan line and no status hints", () => {
    // "Gewählt: …" under the button repeated the rows' own inline summaries,
    // and "Claude arbeitet es ab …" beneath that was a second element for a
    // state the button can show itself. Both cost the rows region height it
    // needs at 360px panel width.
    const sidebar = SKELETONS.find((b) => b.code.includes('id="panel-final-report"'));
    expect(sidebar).toBeDefined();
    expect(sidebar.code).not.toContain("closeout-plan");
    expect(rulesFor(/closeout-plan/).length).toBe(0);
    expect(rulesFor(/status-channel/).length).toBe(0);
    expect(jsSource).not.toContain("function buildCloseoutPlan");
    expect(jsSource).not.toContain("function updateStatusChannelSummary");
    // The execute title is the consequence warning, set only once the click
    // can fire; the disconnected case is the button's own label.
    const btnFn = fnSource("updateCloseoutButton");
    expect(btnFn).toContain("if (ready) btn.dataset.tip = btn.dataset.titleExecute || '';");
    expect(btnFn).toContain("conn.dataset.state === 'disconnected'");
    expect(btnFn).toContain("btn.dataset.labelExecuteOffline");
    // … and never repaints a button that already shows a finalize state.
    expect(btnFn).toMatch(/if \(!btn \|\| btn\.dataset\.finalizeState\) return;/);
    expect(fnSource("checkClaudeConnection")).toContain("updateCloseoutButton()");
    // One setter for the three post-click states, on [data-finalize-state]
    // — the CSS colours each of them.
    const stateFn = fnSource("setCloseoutButtonState");
    expect(stateFn).toContain("btn.dataset.finalizeState = state;");
    for (const st of ["running", "done", "stalled"]) {
      const rule = rulesFor(new RegExp(`^\\.closeout-sheet #closeout-execute\\[data-finalize-state="${st}"\\]$`))[0];
      expect(rule, `button ${st} rule`).toBeTruthy();
    }
    // Locked rows: dimmed, summary hidden — the CSS half of the sequential
    // accordion (the JS half is `disabled` on the head).
    const locked = rulesFor(/^\.closeout-sheet \.closeout-block\[data-locked="true"\] \.closeout-row$/)[0];
    expect(locked, "locked row rule").toBeTruthy();
    expect(locked.body).toMatch(/cursor:\s*not-allowed/);
    expect(rulesFor(/^\.closeout-sheet \.closeout-block\[data-locked="true"\] \.closeout-row-summary$/)[0].body).toMatch(/display:\s*none/);
  });

  test("the final-report flex chain is bounded end to end, so #closeout-execute cannot leave the viewport", () => {
    // A live check at 1440×768/900 found the button below the fold with
    // EVERY row open: `.panel-cta` had a bounded height in viewing-final but
    // stayed `display: block`, so its child `#panel-final-report` never
    // became the flex column `.closeout-sheet` needed a bounded height to
    // shrink against. Every link below is required — a percentage/flex
    // height against ANY non-flex, auto-height ancestor in this chain
    // resolves as if unset, i.e. no cap at all.

    // 1. The tree gives way: on the final report the TOC caps out instead of
    //    sharing flex-grow:1 evenly against the foot. 18vh, not 28vh: a live
    //    check at 1440×768 found only 1–3 of the 4 row heads fitting inside
    //    .closeout-rows' floor with the TOC still taking 28vh — tightening
    //    the TOC is what gives the rows region the room its own 260px floor
    //    (§ next test) needs. min-height keeps a sliver of the tree
    //    reachable rather than letting it collapse to nothing.
    const navRule = rulesFor(/^body\.viewing-final \.panel-nav-scroll$/)[0];
    expect(navRule, "body.viewing-final .panel-nav-scroll").toBeTruthy();
    expect(navRule.body).toMatch(/flex:\s*0 1 auto/);
    expect(navRule.body).toMatch(/max-height:\s*18vh/);
    expect(navRule.body).toMatch(/min-height:\s*56px/);

    // 2. .panel-cta becomes a flex column itself in this state (not just
    //    flex-grow within its OWN parent) — overflow: hidden, never auto:
    //    the foot must never scroll as a whole, only .closeout-rows may.
    const ctaRule = rulesFor(/^body\.viewing-final \.panel-cta$/)[0];
    expect(ctaRule, "body.viewing-final .panel-cta").toBeTruthy();
    expect(ctaRule.body).toMatch(/flex:\s*1 1 auto/);
    expect(ctaRule.body).toMatch(/min-height:\s*0/);
    expect(ctaRule.body).toMatch(/display:\s*flex/);
    expect(ctaRule.body).toMatch(/flex-direction:\s*column/);
    expect(ctaRule.body).toMatch(/overflow:\s*hidden/);
    expect(ctaRule.body).not.toMatch(/overflow-y:\s*auto/);

    // 3. #panel-final-report is the flex column that hands #closeout-sheet a
    //    bounded height — and JS must show it as `flex`, not `block`, or
    //    none of this applies.
    const panelRule = rulesFor(/^#panel-final-report$/)[0];
    expect(panelRule, "#panel-final-report").toBeTruthy();
    expect(panelRule.body).toMatch(/flex-direction:\s*column/);
    expect(panelRule.body).toMatch(/min-height:\s*0/);
    expect(panelRule.body).toMatch(/flex:\s*1 1 auto/);
    expect(jsSource).toContain("panelFinal.style.display = isFinal ? 'flex' : 'none'");
    // Nothing sits below the sheet: the "Iterationen ansehen" link is gone —
    // the head's 🕘 rounds chip already opens earlier rounds, and the link
    // only cost the rows region a line of height.
    expect(md).not.toContain("view-iterations-btn");
    expect(md).not.toContain("final.view_iterations");

    // 4. .closeout-sheet is a flex ITEM of #panel-final-report now (no more
    //    height: 100%, which only worked against a definite-height ancestor
    //    and #panel-final-report was `display: block` at the time).
    const sheetRule = rulesFor(/^\.closeout-sheet$/)[0];
    expect(sheetRule.body).not.toMatch(/height:\s*100%/);
  });

  test("the done state strips the hand-offs row of every answerable affordance, not just its visibility", () => {
    // [hidden] alone loses to `.closeout-row`'s own `display: flex` in the
    // cascade (same-specificity attribute vs. class selector, author order
    // wins) — hiding the head that way left a live-looking "○ Danach von
    // Hand" row on a closed report. The done branch must disable it and
    // strip the mark/summary/aria-expanded instead.
    const renderCloseoutSrc = fnSource("renderCloseout");
    const closedBranch = renderCloseoutSrc.slice(renderCloseoutSrc.indexOf("hasAttribute('data-closed')"));
    const branch = closedBranch.slice(0, closedBranch.indexOf("const boxes = openQuestionBoxes()"));
    expect(branch).toContain("head.disabled = true");
    expect(branch).toContain("removeAttribute('aria-expanded')");
    expect(branch).toMatch(/mark\.hidden = true/);
    expect(branch).not.toMatch(/head\.hidden = true/);
  });

  test("locale table carries the status-line and menu strings in en and de", () => {
    for (const key of [
      "panel.status_saved", "panel.status_saving", "panel.status_connecting",
      "panel.status_local_only", "panel.status_local_only_connected",
      "panel.status_working", "panel.status_frozen",
      "panel.status_detail", "panel.submit_menu", "panel.submit_menu_hint", "panel.here_back",
    ]) {
      const row = md.split("\n").find((l) => l.startsWith("| `" + key + "`"));
      expect(row, key).toBeDefined();
      const cells = row.split("|").map((s) => s.trim()).filter(Boolean);
      expect(cells.length, key).toBe(3);
    }
  });
});

describe("panel anatomy — CSS", () => {
  test("the aside is ONE flex column that never scrolls itself, in every template", () => {
    // There used to be two of these: a docked sidebar for decision/free and a
    // design-scoped overlay. A concept that mixed templates therefore moved
    // its panel — and with it the surface the user writes feedback on —
    // between rounds. The panel is page chrome now (templates.md § Panel
    // Chrome (all templates)), so exactly one unscoped rule may define it.
    const rule = rulesFor(/^\.concept-decision-panel$/).find((r) => /height:\s*100vh/.test(r.body));
    expect(rule, "unscoped .concept-decision-panel").toBeTruthy();
    expect(rule.body).toMatch(/position:\s*fixed/);
    expect(rule.body).toMatch(/display:\s*flex/);
    expect(rule.body).toMatch(/flex-direction:\s*column/);
    expect(rule.body).toMatch(/overflow:\s*hidden/);
    expect(rule.body).not.toMatch(/overflow-y:\s*auto/);
    // 100vh + 1.5rem padding is only 100vh with border-box; otherwise the
    // pinned foot sits 3rem below the viewport edge.
    expect(rule.body).toMatch(/box-sizing:\s*border-box/);
    // The template-scoped variants must be gone, not merely outranked.
    expect(rulesFor(/^\[data-template="design"\] \.concept-layout\.design \.concept-decision-panel$/).length,
      "design-scoped panel rule").toBe(0);
    expect(stripComments(cssSource), "sticky sidebar panel").not.toMatch(
      /\.concept-decision-panel \{[^}]*position:\s*sticky/);
  });

  test("neither FAB is design-only chrome — ☰ and 💬 are reachable in every template", () => {
    // The ☰ FAB used to be hidden outside design mode, which is what made the
    // docked sidebar necessary in the first place; the 💬 FAB and its dock
    // followed in #399. Only the dock's design-only ROWS may sit behind the
    // projection (the compact rule), never the dock or the FAB themselves.
    const hidden = /html:not\(\[data-template="design"\]\) ([^,{]+)[,{]/g;
    const hiddenSelectors = [];
    let m;
    const css = stripComments(cssSource);
    while ((m = hidden.exec(css))) hiddenSelectors.push(m[1].trim());
    expect(hiddenSelectors, "design-only chrome list still hides the mockup chrome").toContain(".screen-indicator");
    expect(hiddenSelectors, "☰ must stay reachable in every template").not.toContain(".panel-fab");
    expect(hiddenSelectors, "💬 must stay reachable in every template").not.toContain(".feedback-fab");
    expect(hiddenSelectors, "the dock itself is never hidden by template").not.toContain(".feedback-dock");
    expect(hiddenSelectors, "document rounds fold the design-only rows").toContain(
      ".feedback-dock .feedback-section:not(:has(#design-general-feedback))");
    expect(hiddenSelectors).toContain(".feedback-dock .feedback-divider");
  });

  test("only .panel-nav-scroll scrolls, and min-height: 0 is on it", () => {
    const rule = rulesFor(/^\.panel-nav-scroll$/).find((r) => /overflow-y:\s*auto/.test(r.body));
    expect(rule, ".panel-nav-scroll { overflow-y: auto }").toBeTruthy();
    expect(rule.body).toMatch(/flex:\s*1 1 auto/);
    expect(rule.body).toMatch(/min-height:\s*0(?![.\d])/);
  });

  test("the foot is hard-capped at 120px and pinned (flex: none)", () => {
    const rule = rulesFor(/^\.panel-cta$/).find((r) => /max-height/.test(r.body));
    expect(rule, ".panel-cta { max-height }").toBeTruthy();
    expect(rule.body).toMatch(/max-height:\s*120px/);
    expect(rule.body).toMatch(/flex:\s*none/);
    // The status line and the head are pinned too.
    for (const sel of [/^\.panel-status$/, /^\.panel-here$/]) {
      // (the mobile `.panel-here { display: none }` rule sits earlier in the
      // source — pick the layout rule, not the first match)
      const r = rulesFor(sel).find((x) => /flex:/.test(x.body));
      expect(r, String(sel)).toBeTruthy();
      expect(r.body, String(sel)).toMatch(/flex:\s*none/);
    }
  });

  test("the foot reserves no 💬 FAB gutter — the FAB hides while the panel is open", () => {
    // `.panel-cta { padding-bottom: calc(60px + 2rem) }` kept ~92px free for
    // the 💬 FAB's row, but `body.panel-open .feedback-fab` hides the FAB
    // whenever the panel is visible. On the final report that dead strip sat
    // under the close-out sheet while its rows region scrolled on a Full HD
    // screen for want of exactly that height.
    const hideFab = rulesFor(/^body\.panel-open \.feedback-fab$/)[0];
    expect(hideFab, "body.panel-open .feedback-fab").toBeTruthy();
    expect(hideFab.body).toMatch(/opacity:\s*0/);
    const gutter = rulesFor(/^\.panel-cta$/).find((r) => /padding-bottom/.test(r.body));
    expect(gutter, "no .panel-cta padding-bottom gutter").toBeUndefined();
  });

  test("mobile needs no panel variant and no head fold of its own", () => {
    const css = stripComments(cssSource);
    // The bottom-sheet variant is gone: the overlay is fixed, full-height and
    // capped at 90vw, so a phone gets the same panel a desktop does. A
    // re-docked mobile panel would bring the split-brain layout back through
    // the back door.
    for (const m of css.matchAll(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/g)) {
      expect(m[1], "mobile .concept-decision-panel variant").not.toMatch(/\.concept-decision-panel/);
      // …and the head no longer folds: #panel-here-back is one of the three
      // ways back to the live round, and it used to disappear on exactly the
      // viewport where the other two are hardest to hit (#341's 487px bottom
      // sheet is what justified the fold, and that sheet no longer exists).
      expect(m[1], "mobile .panel-here fold").not.toMatch(/\.panel-here \{ display: none/);
    }
  });

  // #341 — the first live check in a real browser (scripts/build-concept-fixture.js,
  // 8 rounds, 14 entries) found three things the jsdom suites cannot see:
  // the frozen block overran the 120px cap with its back button clipped, the
  // submitted block overran it by 3px, and the mobile head-fold never applied
  // because a later `.panel-here { display: flex }` won the cascade.
  test("the foot scrolls instead of clipping when a state outgrows the cap (#341)", () => {
    const cta = rulesFor(/^\.panel-cta$/).find((r) => /max-height/.test(r.body));
    expect(cta.body).toMatch(/overflow-y:\s*auto/);
  });

  test("the frozen block fits the cap: its hint paragraph does not render in the foot (#341)", () => {
    const hint = rulesFor(/^#panel-frozen \.hint$/)[0];
    expect(hint, "#panel-frozen .hint").toBeTruthy();
    expect(hint.body).toMatch(/display:\s*none/);
    // The sentence stays on screen elsewhere — status line + frozen bar.
    expect(rulesFor(/^\.panel-status\[data-status="frozen"\] \.status-line$/).length).toBeGreaterThan(0);
    expect(cssSource).toContain(".frozen-bar");
  });

  test("the submitted block fits the cap: compact indicator padding (#341)", () => {
    const ind = rulesFor(/^\.submitted-indicator$/)[0];
    expect(ind, ".submitted-indicator").toBeTruthy();
    const pad = /padding:\s*([\d.]+)rem/.exec(ind.body);
    expect(pad, "vertical padding in rem").toBeTruthy();
    expect(Number(pad[1])).toBeLessThanOrEqual(0.4);
  });

  test("the head is never folded away, on any viewport (#341 reversed)", () => {
    // #341 folded it on ≤768px because the panel was a 487px bottom sheet
    // there and the head cost 51px of it. The panel is a full-height overlay
    // in every template now, so the space argument is gone — and the fold
    // took #panel-here-back with it, one of the three routes back to the live
    // round, on the viewport where the other two are hardest to hit.
    const src = stripComments(cssSource);
    expect(src.search(/\.panel-here \{[^}]*display:\s*flex/), ".panel-here layout rule")
      .toBeGreaterThan(-1);
    expect(src, "no head fold").not.toContain(".panel-here { display: none; }");
    // The back link's own [hidden] rule is a different thing and stays.
    expect(src).toContain(".panel-here-back[hidden]");
  });

  test("the six states are styled and 'local-only' is the one with a background", () => {
    for (const s of ["saved", "saving", "connecting", "local-only", "submitted", "frozen"]) {
      expect(rulesFor(new RegExp(`^\\.panel-status\\[data-status="${s}"\\] \\.status-line$`)).length, s).toBeGreaterThan(0);
    }
    const local = rulesFor(/^\.panel-status\[data-status="local-only"\] \.status-line$/)[0];
    expect(local.body).toMatch(/background:/);
    for (const s of ["saved", "connecting", "submitted", "frozen"]) {
      const r = rulesFor(new RegExp(`^\\.panel-status\\[data-status="${s}"\\] \\.status-line$`))[0];
      expect(r.body, s + " must not compete with the warning background").not.toMatch(/background:/);
    }
    // The old pill is gone for good.
    expect(cssSource).not.toContain(".connection-pill");
  });

  // #367 (two rounds): the menu used to be `position: absolute` inside
  // `.panel-cta`, anchored by that box's `position: relative` and opening
  // upward via `bottom: calc(100% + Npx)`. But .panel-cta ALSO carries
  // `overflow-y: auto` as its ≤120px safety net (see the previous test) —
  // so the popover opened straight into its own ancestor's clip and got
  // scrolled/clipped away. Round one fixed that with `position: fixed` off
  // the split button's VIEWPORT rect sampled once at open time — which then
  // broke on the design layout, where the ☰ panel can still be sliding in
  // (`transition: right 0.3s`, § Panel Chrome) when the caret is clicked, so
  // the sampled rect went stale mid-transition (measured 400px off-screen).
  // The menu is `position: absolute` again, but its containing block is now
  // `.concept-decision-panel` (already `position: fixed`) rather than
  // `.panel-cta` — `.panel-cta` deliberately drops `position: relative` so
  // it can no longer BE that containing block, which is what keeps its own
  // overflow from clipping the popover. Anchoring to the panel means the
  // menu moves WITH it through the slide-in with no re-sampling needed.
  test("the submit menu's containing block is the panel, not the clipped foot (#367)", () => {
    const cta = rulesFor(/^\.panel-cta$/).find((r) => /max-height/.test(r.body));
    expect(cta, ".panel-cta { max-height }").toBeTruthy();
    expect(cta.body, ".panel-cta must not be a containing block").not.toMatch(/position:\s*relative/);
    const panel = rulesFor(/^\.concept-decision-panel$/).find((r) => /height:\s*100vh/.test(r.body));
    expect(panel, ".concept-decision-panel").toBeTruthy();
    expect(panel.body, "the panel must establish the containing block").toMatch(/position:\s*fixed/);
    const menu = rulesFor(/^\.submit-menu$/)[0];
    expect(menu, ".submit-menu").toBeTruthy();
    expect(menu.body).toMatch(/position:\s*absolute/);
    expect(menu.body).not.toMatch(/position:\s*fixed/);
    // It must not rely on .panel-cta's box for placement any more.
    expect(menu.body).not.toMatch(/bottom:\s*calc\(100%/);
    expect(rulesFor(/^\.submit-menu\[hidden\]$/)[0].body).toMatch(/display:\s*none/);
  });
});

describe("panel anatomy — JS contracts", () => {
  test("checkClaudeConnection writes the line BEFORE it skips the submitted panel's buttons (R4)", () => {
    const fn = fnSource("checkClaudeConnection");
    const write = fn.indexOf("pill.dataset.state = state");
    const render = fn.indexOf("renderPanelStatus()");
    const bail = fn.indexOf("panelSubmitted.style.display !== 'none') return");
    expect(write).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(-1);
    expect(write, "data-state must be written before the early return").toBeLessThan(bail);
    expect(render, "the line must be rendered before the early return").toBeLessThan(bail);
    // Button handling still sits behind it.
    expect(fn.indexOf("_setCacheHints("), "cache hints are button handling").toBeGreaterThan(bail);
  });

  test("the draft mirror drives the saving / saved / local-only phases", () => {
    expect(fnSource("queueDraftSync")).toContain("_setDraftPhase('saving')");
    expect(fnSource("_setDraftHealth")).toContain("_setDraftPhase(show ? 'local' : 'saved')");
    const render = fnSource("renderPanelStatus");
    for (const s of ["'frozen'", "'submitted'", "'local-only'", "'saving'", "'connecting'", "'saved'"]) {
      expect(render, s).toContain("status = " + s);
    }
  });

  test("every writer of a status input re-renders the line", () => {
    for (const fn of ["submitWithAction", "restorePanelToReady", "showIteration", "_setDraftPhase"]) {
      expect(fnSource(fn), fn).toContain("renderPanelStatus()");
    }
  });

  test("the dots are rendered from the <ol>, never held separately", () => {
    expect(fnSource("_setStep")).toContain("renderStatusDots()");
    expect(fnSource("resetStatusSteps")).toContain("renderStatusDots()");
    const dots = fnSource("renderStatusDots");
    expect(dots).toContain("getElementById('status-steps')");
    expect(dots).toContain("if (li.hidden) return;");
  });

  test("the menu is keyboard-closable and mirrors aria-expanded", () => {
    const wire = jsSource.slice(jsSource.indexOf("function wireSubmitMenu()"));
    expect(wire).toContain("btn.setAttribute('aria-expanded', open ? 'true' : 'false')");
    expect(wire).toContain("e.key !== 'Escape'");
    expect(wire).toMatch(/document\.addEventListener\('click'/);
    // Both submit ids keep their handlers.
    expect(jsSource).toContain("wireSubmit('submit-iterate-btn', 'iterate')");
    expect(jsSource).toContain("wireSubmit('submit-implement-btn', 'implement')");
  });

  test("gate and SKILL carry the anatomy", () => {
    expect(gate).toMatch(/\| 56 \| `panel-nav-scroll`/);
    expect(gate).toMatch(/\| 57 \| `submit-menu-btn`/);
    expect(gate).toMatch(/\| 58 \| `panel-status`/);
    expect(gate).toMatch(/\| 3 \| `connection-status` \| The status line inside `\.panel-status`/);
    expect(skill).toContain(".panel-nav-scroll");
    expect(skill).toContain("#submit-menu");
    expect(skill).not.toMatch(/extra top margin \(~2rem\)/);
  });
});

// ── Behavioural: the reference JS on a real DOM (jsdom) ──
// The Common Structure skeleton is loaded as-is (locale keys kept as their
// key names so assertions can read them back), then the status-line
// functions are evaluated in that window.

const localeKeys = (src) => src.replace(/\{\{([a-z_.]+)\}\}/g, "$1");

function page({ tabs = [] } = {}) {
  const sidebar = SKELETONS.find((b) => b.code.includes('id="panel-final-report"'));
  const dom = new JSDOM(localeKeys(sidebar.code), { runScripts: "outside-only" });
  const { window } = dom;
  const { document } = window;
  const bar = document.querySelector(".iteration-tabs");
  for (const t of tabs) {
    const b = document.createElement("button");
    b.className = "iteration-tab";
    b.dataset.iteration = String(t.n);
    b.setAttribute("aria-selected", t.selected ? "true" : "false");
    b.textContent = t.label;
    bar.appendChild(b);
  }
  const prelude = `
    var _draftPhase = 'saved';
    var _submittedAt = 0;
    var _lastHeartbeatTs = 0, _lastServerTs = 0, _everPolled = false;
    var HEARTBEAT_STALE_MS = 90000, SERVER_STALE_MS = 90000;
    // Freeze-aware verdict state (§ Claude Connection Heartbeat).
    var _lastSampleAt = 0, SAMPLE_STALE_MS = 15000, WAKE_GRACE_MS = 45000, _wakeGraceUntil = 0;
    var _disconnectStreak = 0, _lastState = 'connecting';
    var recovered = 0;
    function recoverFromFreeze(now) { recovered++; _wakeGraceUntil = now + WAKE_GRACE_MS; }
    var retried = 0;
    function retryPendingSubmission() { retried++; }
  `;
  window.eval(localeKeys([
    prelude,
    fnSource("_setDraftPhase"),
    fnSource("_setCacheHints"),
    fnSource("renderPanelStatus"),
    fnSource("_stepEl"),
    fnSource("_setStep"),
    fnSource("renderStatusDots"),
    fnSource("resetStatusSteps"),
    fnSource("checkClaudeConnection"),
  ].join("\n")));
  const status = () => document.getElementById("panel-status").dataset.status;
  const label = () => document.querySelector("#connection-status .conn-label").textContent;
  return { window, document, status, label };
}

describe("panel anatomy — status line behaviour (reference JS on jsdom)", () => {
  test("fresh page: connecting, never disconnected, details hidden", () => {
    const p = page();
    p.window.renderPanelStatus();
    expect(p.status()).toBe("connecting");
    expect(p.label()).toBe("panel.status_connecting");
    expect(p.document.getElementById("status-detail").hidden).toBe(true);
  });

  test("connected + saved draft reads saved; a queued flush reads saving", () => {
    const p = page();
    p.document.getElementById("connection-status").dataset.state = "connected";
    p.window.renderPanelStatus();
    expect(p.status()).toBe("saved");
    p.window._setDraftPhase("saving");
    expect(p.status()).toBe("saving");
    p.window._setDraftPhase("saved");
    expect(p.status()).toBe("saved");
  });

  test("disconnected OR three failed flushes → local-only, the categorically different state", () => {
    const p = page();
    p.document.getElementById("connection-status").dataset.state = "disconnected";
    p.window.renderPanelStatus();
    expect(p.status()).toBe("local-only");
    expect(p.label()).toBe("panel.status_local_only");
    p.document.getElementById("connection-status").dataset.state = "connected";
    p.window._setDraftPhase("local");
    expect(p.status()).toBe("local-only");
    // Same state, but no "· getrennt": the heartbeat vouches for the bridge,
    // so a failing draft mirror is not a disconnect (gate 65).
    expect(p.label()).toBe("panel.status_local_only_connected");
    p.document.getElementById("connection-status").dataset.state = "connecting";
    p.window.renderPanelStatus();
    expect(p.label()).toBe("panel.status_local_only_connected");
    // A real disconnect still says so, whatever the draft mirror reports.
    p.document.getElementById("connection-status").dataset.state = "disconnected";
    p.window.renderPanelStatus();
    expect(p.label()).toBe("panel.status_local_only");
  });

  test("after submit: working + one dot per VISIBLE step, list expandable under the line", () => {
    const p = page();
    p.document.getElementById("connection-status").dataset.state = "connected";
    p.window._submittedAt = Date.now();
    p.window.resetStatusSteps("iterate");
    p.window.renderPanelStatus();
    expect(p.status()).toBe("submitted");
    expect(p.document.getElementById("status-detail").hidden).toBe(false);
    const dots = () => [...p.document.querySelectorAll("#status-dots i")].map((i) => i.dataset.state);
    expect(dots()).toEqual(["done", "active"]);
    p.window.resetStatusSteps("implement");
    expect(dots()).toEqual(["done", "active", "pending"]);
    p.window._setStep("received", "done", "✓");
    expect(dots()).toEqual(["done", "done", "pending"]);
    // The <ol> is still the real list.
    expect(p.document.querySelectorAll("#status-steps li[data-step]").length).toBe(4);
  });

  test("a frozen tab wins over everything and names the round", () => {
    const p = page({ tabs: [{ n: 1, label: "Iteration 1", selected: true }, { n: 2, label: "Iteration 2 · aktiv" }] });
    p.document.getElementById("connection-status").dataset.state = "disconnected";
    p.window._submittedAt = Date.now();
    p.document.body.classList.add("viewing-frozen");
    p.window.renderPanelStatus();
    expect(p.status()).toBe("frozen");
    expect(p.label()).toBe("Iteration 1 · panel.status_frozen");
  });

  test("R4: checkClaudeConnection keeps the line truthful while #panel-submitted is up — and only skips the buttons", () => {
    const p = page();
    p.document.getElementById("panel-submitted").style.display = "block";
    p.window._submittedAt = Date.now();
    const btn = p.document.getElementById("submit-iterate-btn");
    btn.disabled = true;
    p.window._lastHeartbeatTs = Date.now();
    p.window._lastSampleAt = Date.now();
    p.window._everPolled = true;
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("connected");
    expect(p.status()).toBe("submitted");
    expect(btn.disabled, "button handling is skipped while submitted").toBe(true);
    expect(p.window.retried, "the retry stays behind the early return").toBe(0);
    // …and a stale heartbeat is reflected there too, not frozen at submit time
    // (a FRESH sample carrying a stale claude_ts, confirmed on a second check).
    p.window._lastHeartbeatTs = Date.now() - 10 * 60 * 1000;
    p.window._lastServerTs = 0;
    p.window._lastSampleAt = Date.now();
    p.window.checkClaudeConnection();
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("disconnected");
    expect(p.document.getElementById("connection-status").dataset.tip).toBe("panel.disconnected_title");
  });

  test("ready panel: disconnected shows the cache badge and keeps the buttons enabled", () => {
    const p = page();
    p.window._everPolled = true;
    p.window._lastHeartbeatTs = Date.now() - 10 * 60 * 1000;
    p.window._lastSampleAt = Date.now();
    p.window.checkClaudeConnection();
    p.window.checkClaudeConnection();
    expect(p.status()).toBe("local-only");
    for (const el of p.document.querySelectorAll("[data-cache-hint]")) expect(el.hidden).toBe(false);
    expect(p.document.getElementById("submit-iterate-btn").disabled).toBe(false);
    expect(p.document.getElementById("submit-implement-btn").disabled).toBe(false);
  });
});

describe("panel anatomy — freeze-aware connection verdict (the \"connection keeps dropping\" report)", () => {
  const stale = () => Date.now() - 10 * 60 * 1000;

  test("a sample older than SAMPLE_STALE_MS is a frozen PAGE, not a dead bridge: connecting + recovery, never disconnected", () => {
    // Edge Sleeping Tabs / PC suspend: on wake the DOM interval fires first,
    // holding a sample from before the nap. The old checker read its stale
    // claude_ts as "disconnected" for the 5 s until the worker's next fetch.
    const p = page();
    p.window._everPolled = true;
    p.window._lastHeartbeatTs = stale();
    p.window._lastSampleAt = Date.now() - 60 * 60 * 1000;    // last sample an hour ago
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("connecting");
    expect(p.window.recovered, "recoverFromFreeze re-polls and opens the grace window").toBe(1);
    // Still inside WAKE_GRACE_MS with a stale claude_ts → still connecting (the pulser needs a cycle too).
    p.window._lastSampleAt = Date.now();
    p.window.checkClaudeConnection();
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("connecting");
    expect(p.status()).not.toBe("local-only");
  });

  test("a fresh sample with a stale claude_ts needs TWO consecutive checks before it reads disconnected", () => {
    const p = page();
    p.window._everPolled = true;
    p.window._lastHeartbeatTs = stale();
    p.window._lastSampleAt = Date.now();
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state, "one late pulse is a blip").toBe("connecting");
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("disconnected");
    expect(p.window.recovered, "a fresh sample never triggers freeze recovery").toBe(0);
  });

  test("a fresh claude_ts clears the streak at once — connected on the very next check", () => {
    const p = page();
    p.window._everPolled = true;
    p.window._lastHeartbeatTs = stale();
    p.window._lastSampleAt = Date.now();
    p.window.checkClaudeConnection();
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("disconnected");
    p.window._lastHeartbeatTs = Date.now();
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("connected");
    p.window._lastHeartbeatTs = stale();
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state, "the streak restarted from zero").toBe("connecting");
  });

  test("a bridge that stays silent past SERVER_STALE_MS after the grace window IS disconnected", () => {
    // Freeze recovery must not become a permanent excuse: no sample for
    // longer than the server-stale threshold, grace expired → the warning.
    const p = page();
    p.window._everPolled = true;
    p.window._lastHeartbeatTs = stale();
    p.window._lastSampleAt = Date.now() - 2 * 90000;
    p.window._wakeGraceUntil = Date.now() - 1;
    p.window.recoverFromFreeze = () => {};                     // a recovery that gets no answer
    p.window.checkClaudeConnection();
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("disconnected");
  });

  test("the reference block declares the freeze machinery the gate (3d) looks for", () => {
    const block = md.slice(md.indexOf("## Claude Connection Heartbeat"), md.indexOf("## ", md.indexOf("## Claude Connection Heartbeat") + 10));
    for (const token of ["_lastSampleAt", "SAMPLE_STALE_MS", "WAKE_GRACE_MS", "recoverFromFreeze", "_disconnectStreak", "visibilitychange"]) {
      expect(block, token).toContain(token);
    }
    // The worker can be replaced: startHeartbeatWorker terminates a previous one.
    expect(fnSource("startHeartbeatWorker")).toContain("terminate()");
    // Single-flight poll: wake-up paths share one fetch.
    expect(block).toMatch(/_pollInFlight/);
  });
});
