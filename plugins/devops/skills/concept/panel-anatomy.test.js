import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

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
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
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
      expect(ready, where).toMatch(/id="submit-iterate-btn"[^>]*title="\{\{panel\.submit_iterate_hint\}\}"/);
      expect(ready, where).toMatch(/id="submit-implement-btn"[^>]*title="\{\{panel\.submit_implement_hint\}\}"/);
      // The cache hint stays, twice: badge on the primary, line in the menu.
      expect((ready.match(/data-cache-hint="/g) || []).length, where).toBe(2);
    }
  });

  test("the final-report wizard keeps its gap; the sidebar skeleton keeps the frozen block in the foot", () => {
    const sidebar = SKELETONS.find((b) => b.code.includes('id="panel-final-report"'));
    expect(sidebar).toBeDefined();
    const cta = sidebar.code.indexOf('class="panel-cta"');
    for (const id of ["panel-frozen", "back-to-live-btn", "panel-final-report", "closeout-execute"]) {
      expect(sidebar.code.indexOf(`id="${id}"`), id).toBeGreaterThan(cta);
    }
    const wizard = sidebar.code.slice(sidebar.code.indexOf('id="closeout-sheet"'));
    expect(wizard).toContain('class="submit-gap"');
  });

  test("locale table carries the status-line and menu strings in en and de", () => {
    for (const key of [
      "panel.status_saved", "panel.status_saving", "panel.status_connecting",
      "panel.status_local_only", "panel.status_working", "panel.status_frozen",
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

  test("the ☰ FAB that opens it is page chrome, never design-only", () => {
    // The FAB used to be hidden outside design mode, which is what made the
    // docked sidebar necessary in the first place.
    const hidden = /html:not\(\[data-template="design"\]\) ([^,{]+)[,{]/g;
    const hiddenSelectors = [];
    let m;
    const css = stripComments(cssSource);
    while ((m = hidden.exec(css))) hiddenSelectors.push(m[1].trim());
    expect(hiddenSelectors, "design-only chrome list").toContain(".feedback-fab");
    expect(hiddenSelectors, "☰ must stay reachable in every template").not.toContain(".panel-fab");
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

  test("design mode reserves the 💬 FAB's row under the foot — derived from the FAB's own geometry", () => {
    const gutter = rulesFor(/^\[data-template="design"\] \.concept-layout\.design \.panel-cta$/)[0];
    expect(gutter, "design-scoped .panel-cta rule").toBeTruthy();
    const m = /padding-bottom:\s*calc\((\d+)px \+ ([\d.]+)rem\)/.exec(gutter.body);
    expect(m, "padding-bottom: calc(<fab>px + <offset>rem)").toBeTruthy();
    const fab = RULES.find((r) => r.selectors.some((s) => norm(s) === ".feedback-fab") && /height:\s*\d+px/.test(r.body));
    const fabH = /height:\s*(\d+)px/.exec(fab.body)[1];
    const anchor = RULES.find((r) => r.selectors.some((s) => norm(s) === ".feedback-fab") && /bottom:\s*[\d.]+rem/.test(r.body));
    const fabBottom = /bottom:\s*([\d.]+)rem/.exec(anchor.body)[1];
    expect(m[1], "gutter must equal the FAB's height").toBe(fabH);
    expect(m[2], "…plus the FAB's bottom offset").toBe(fabBottom);
  });

  test("mobile folds the head away and needs no panel variant of its own", () => {
    const media = /@media \(max-width: 768px\) \{([\s\S]*?)\n\}/.exec(stripComments(cssSource));
    expect(media, "@media (max-width: 768px)").toBeTruthy();
    // The head's content is already in the status line, so it folds on narrow
    // viewports — that part is unchanged.
    expect(media[1]).toMatch(/\.panel-here \{ display: none; \}/);
    // What is gone is the bottom-sheet variant: the overlay is fixed,
    // full-height and capped at 90vw, so a phone gets the same panel a
    // desktop does. A re-docked mobile panel would bring the split-brain
    // layout back through the back door.
    expect(media[1], "mobile .concept-decision-panel variant").not.toMatch(/\.concept-decision-panel/);
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

  test("the mobile head-fold comes AFTER the layout rule, so it wins the cascade (#341)", () => {
    const src = stripComments(cssSource);
    const layout = src.search(/\.panel-here \{[^}]*display:\s*flex/);
    expect(layout, ".panel-here layout rule").toBeGreaterThan(-1);
    const fold = src.lastIndexOf(".panel-here { display: none; }");
    expect(fold, "mobile fold").toBeGreaterThan(-1);
    expect(fold, "a fold before the layout rule is overridden by it").toBeGreaterThan(layout);
    // …and it is inside a max-width media block, not unconditional.
    const tail = src.slice(0, fold);
    const lastMedia = tail.lastIndexOf("@media (max-width: 768px)");
    expect(lastMedia).toBeGreaterThan(layout);
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

  test("the submit menu opens upward over the status line, anchored on the foot", () => {
    const cta = rulesFor(/^\.panel-cta$/).find((r) => /max-height/.test(r.body));
    expect(cta.body).toMatch(/position:\s*relative/);
    const menu = rulesFor(/^\.submit-menu$/)[0];
    expect(menu, ".submit-menu").toBeTruthy();
    expect(menu.body).toMatch(/position:\s*absolute/);
    expect(menu.body).toMatch(/bottom:\s*calc\(100% \+ \d+px\)/);
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
    p.window._everPolled = true;
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("connected");
    expect(p.status()).toBe("submitted");
    expect(btn.disabled, "button handling is skipped while submitted").toBe(true);
    expect(p.window.retried, "the retry stays behind the early return").toBe(0);
    // …and a stale heartbeat is reflected there too, not frozen at submit time.
    p.window._lastHeartbeatTs = Date.now() - 10 * 60 * 1000;
    p.window._lastServerTs = 0;
    p.window.checkClaudeConnection();
    expect(p.document.getElementById("connection-status").dataset.state).toBe("disconnected");
    expect(p.document.getElementById("connection-status").title).toBe("panel.disconnected_title");
  });

  test("ready panel: disconnected shows the cache badge and keeps the buttons enabled", () => {
    const p = page();
    p.window._everPolled = true;
    p.window._lastHeartbeatTs = Date.now() - 10 * 60 * 1000;
    p.window.checkClaudeConnection();
    expect(p.status()).toBe("local-only");
    for (const el of p.document.querySelectorAll("[data-cache-hint]")) expect(el.hidden).toBe(false);
    expect(p.document.getElementById("submit-iterate-btn").disabled).toBe(false);
    expect(p.document.getElementById("submit-implement-btn").disabled).toBe(false);
  });
});
