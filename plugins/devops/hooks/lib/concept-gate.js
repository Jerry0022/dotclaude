#!/usr/bin/env node
/**
 * @module concept-gate
 * @description Deterministic validator for concept HTML pages.
 *
 *   Backstop for two recurring regressions where Claude only "half-uses" the
 *   auto-concept skill:
 *     A) the page bakes in a "copy the JSON, paste it into chat" submit
 *        instead of the live bridge — a clipboard fallback that defeats the
 *        whole monitoring loop.
 *     B) the page ships with no live decision panel at all.
 *
 *   This is a focused gate, NOT a re-implementation of the full 35-pattern
 *   validation-gate.md. It checks only the markers whose absence equals
 *   failure mode A or B, the forbidden clipboard/paste-to-chat anti-pattern,
 *   <style>/<script> structure, mapping specs, a view that lists the
 *   round's own designs as alternatives (P31), and — since #430 — that the
 *   engine's own CSS/JS blocks are still intact (validation-gate.md 64 / P33).
 *   The full pattern sweep stays Claude's Step-2 responsibility.
 */

const path = require('path');
const { findAnalysisIssues } = require('./concept-gate-analysis');

// Live decision-panel + bridge-submit markers that MUST be present.
// Each label doubles as the grep token and the human-readable reason line.
const REQUIRED = [
  { token: 'concept-decisions', why: 'decision data container' },
  { token: 'panel-ready', why: 'live decision panel (ready state)' },
  { token: 'iteration-tabs', why: 'decision-panel iteration tab bar' },
  { token: 'submit-iterate-btn', why: 'live "Zur nächsten Iteration" submit button' },
  { token: 'submit-implement-btn', why: 'live "Mit Feedback implementieren" submit button' },
  { token: 'pollHeartbeat', why: 'bridge-server heartbeat poll' },
  { token: 'connection-status', why: 'inline connection status pill (connecting / connected / disconnected)' },
];

// Engine-currency markers (#engine-drift). Every one of these lives in the
// SHARED engine of templates.md — the Kompass panel skeleton, § Section
// Navigation JS and § Claude Connection Heartbeat — so a page generated from
// the current reference carries all of them whatever its template. A page
// missing them was not generated from templates.md at all: its engine was
// copied from an OLDER concept page of the same project (seen 2026-09-20 —
// a fresh page on plugin 0.180 with the September-14 panel, no rounds chip,
// no viewport toggle, no freeze-aware heartbeat; the session had read the
// old page for reference and lifted its <style>/<script> wholesale).
// SKILL.md Step 2 forbids exactly that; this is the deterministic backstop.
// `concept-gate.test.js` asserts every token here is present in templates.md,
// so the list cannot drift ahead of (or behind) the reference.
const ENGINE = [
  { token: 'panel-here', why: 'Kompass panel head (rounds chip + section list) — § Common Structure' },
  { token: 'panel-status', why: 'pinned status line — § Panel anatomy' },
  { token: 'renderPanelStatus', why: 'status-line renderer — § Claude Connection Heartbeat' },
  { token: 'buildRoundsChip', why: 'rounds chip builder — § Section Navigation JS' },
  { token: 'buildIterationTree', why: 'section list builder — § Section Navigation JS' },
  { token: 'recoverFromFreeze', why: 'freeze-aware connection verdict — § Claude Connection Heartbeat (gate 3d)' },
  // A page whose draft flush still posts with keepalive and never reads the
  // answer stops mirroring after ~27 autosaves (Chromium's 64 KiB keepalive
  // quota) and then claims an unreachable bridge over a bridge answering 200.
  { token: '_drainDraftResponse', why: 'drained, non-keepalive draft autosave — § State Persistence (gate 65)' },
  // A page without it drops the grey veil and re-arms the submit buttons when
  // the user reloads while Claude is still working on the round they sent.
  { token: 'async function restoreInFlightRound', why: 'sent round survives a reload — § Two-Button Submit (gate 30c)' },
  // A page without it strands a round whose submit never reached the bridge
  // on "Übermittelt · Claude arbeitet": the queued payload is never retried
  // while the submitted panel is up (AUD-020).
  { token: 'let _pendingRetryInFlight', why: 'an undelivered round is retried, not stranded — § Offline Submit Queue (gate 30d)' },
  // A page without it collapses a TOC whose open group is taller than the
  // panel to a lone "+N weitere" button — every entry hidden (#541).
  { token: 'function navOverflowFloor', why: 'TOC overflow keeps the active entry visible — § Section Navigation JS (gate 60b)' },
  // Engine-integrity anchors (#430). The entries above prove the page was
  // generated from the CURRENT templates.md; these prove the engine blocks
  // are still INTACT afterwards. Round 11 of a design concept lost the whole
  // `.concept-decision-panel { … }` rule (and every engine rule between the
  // spliced mock-CSS block and it) to a scratch script whose search ran past
  // the block — the page passed, the panel rendered as a static 1280-px
  // aside behind the screens. Structure was fine; the engine was gutted.
  { token: '.concept-decision-panel {', why: 'decision-panel stylesheet rule — § Panel Chrome (engine CSS gutted?)' },
  { token: 'async function submitWithAction', why: 'two-button submit handler — § Two-Button Submit (engine JS gutted?)' },
  { token: 'async function retryPendingSubmission', why: 'pending-submission retry — § Two-Button Submit (engine JS gutted?)' },
];

// Template-scoped engine-integrity anchors (#430). Asserted only for the
// template the page's <html data-template> names — a decision page has no
// screen nav, a design page does not carry the document-round layout rules.
// A page without the attribute (pre-rename) gets the shared ENGINE list only.
// `re` (when present) wins over `token` for matching; `token` stays the
// human-readable name and the templates.md drift anchor.
const ENGINE_DESIGN = [
  { token: 'id="screen-nav"', why: 'screen navigation element — § Layout — Fullscreen single-screen (design engine markup gutted?)' },
  { token: '.screen-nav {', why: 'screen-nav stylesheet rule — § Layout CSS (design engine CSS gutted?)' },
  { token: 'function activeDesign', why: 'active-design resolver — § Layout JS (design engine JS gutted?)' },
  { token: 'showScreen', re: /window\.showScreen\s*=|function\s+showScreen\b/, why: 'screen switcher — § Layout JS (design engine JS gutted?)' },
  // Currency, not integrity: a design page from before AUD-018 builds its nav
  // labels with innerHTML from the entity-decoded dataset — a markup sink.
  { token: 'function navRowLabel', why: 'nav labels built as text, never as markup — § Layout JS (design engine predates the AUD-018 fix)' },
  // Variant overview (≥2 designs): without these a multi-design round has no
  // overview, no favourite and no user pins — and its payload silently lacks
  // `favorite` / `userPins` (templates-design-overview.md § Variant overview JS).
  { token: 'id="design-header"', why: 'variant-overview header mount — § Layout — Fullscreen single-screen (design engine predates the variant overview)' },
  { token: 'function wireDesignOverview', why: 'variant overview engine — § Variant overview JS (design engine predates the variant overview)' },
  { token: 'window.showOverview', re: /window\.showOverview\s*=/, why: 'overview switcher — § Layout JS (design engine predates the variant overview)' },
  { token: 'window.designOverviewState', re: /window\.designOverviewState\s*=/, why: 'favourite + user-pin store reader for the payload — § Variant overview JS' },
];
const ENGINE_DOCUMENT = [
  { token: '.concept-layout {', why: 'document-round layout rule — § Layout — Document rounds (engine CSS gutted?)' },
  { token: '.concept-content {', why: 'document-round content rule — § Layout — Document rounds (engine CSS gutted?)' },
];

// Final-report engine (templates-final-report.md § Final Report Panel). A page
// with a `data-final-report` round — after a concept, or as the page's ONLY
// round (report-only entry, `concept-build.js init --report`) — must carry the
// to-do-inbox close-out: two buttons that are the ship answer and the 🧪/👉
// collector. A final report on the older accordion sheet ("Weiter ›", one
// execute button) was not generated from the current templates.md.
const ENGINE_FINAL = [
  { token: 'id="closeout-ship"', why: 'close-out "Abschließen & shippen" button — § Final Report Panel (final-report engine predates the to-do inbox)' },
  { token: 'id="closeout-noship"', why: 'close-out "Nur abschließen, nicht shippen" button — § Final Report Panel' },
  { token: 'function collectTodos', why: '🧪/👉 mode collector for the finalize payload — § Final Report Panel' },
  { token: 'async function submitFinalize', why: 'finalize submit with durable ack — § Final Report Panel (engine JS gutted?)' },
];

/** The raw HTML of the `data-final-report` round, or null when there is none. */
function finalReportRegion(html) {
  const src = html || '';
  const open = /<section\b(?:[^>"']|"[^"]*"|'[^']*')*\sdata-final-report\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(src);
  if (!open) return null;
  // Up to the section's own closing tag: the report is the last round, so
  // "until the next round" ran into the engine scripts after it.
  const rest = src.slice(open.index + open[0].length);
  const tags = /<(\/?)section\b[^>]*>/gi;
  let depth = 1;
  let m;
  while ((m = tags.exec(rest))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return { at: open.index, html: open[0] + rest.slice(0, m.index) };
  }
  return { at: open.index, html: open[0] + rest };
}

/**
 * Final-report body rules (validation-gate.md 33b / 37b): the Funde are plain
 * elements, never checkboxes; every Fund names an admissible origin; nothing
 * on the report says "nicht führbar". Only applies to a page that carries the
 * current final-report engine — an older page is the stale-engine finding's
 * job, not this one.
 */
const FR_LABEL_MAX = 48;
function findFinalReportIssues(html) {
  const region = finalReportRegion(html);
  if (!region) return [];
  const issues = [];
  // The report-only skeleton (`concept-build.js init --report`) marks every
  // part still to be written with a `<!-- TODO: … -->` comment. They are
  // invisible on the page, so an unfilled skeleton would build and open as an
  // empty report — block it until each one is replaced.
  if (/<!--\s*TODO:/.test(region.html)) {
    issues.push({ kind: 'final-report-skeleton', why: 'the final report still carries the skeleton\'s <!-- TODO: … --> markers — write the report (templates-final-report.md) before the build', at: region.at });
  }
  if (!(html || '').includes('function collectTodos')) return issues;
  const body = region.html.replace(/<!--[\s\S]*?-->/g, '');
  const oqStart = body.search(/\sdata-open-questions\b/);
  if (oqStart >= 0) {
    const oq = body.slice(oqStart);
    if (/<input\b[^>]*type=["']checkbox["']/i.test(oq)) {
      issues.push({ kind: 'final-report-checkbox', why: 'a checkbox inside [data-open-questions] of the final report — the Funde are plain elements now; the panel is the only place to answer (validation-gate.md 33b)', at: region.at });
    }
    for (const m of oq.matchAll(/<[a-z]+\b(?:[^>"']|"[^"]*"|'[^']*')*\sdata-issue-title=(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
      const tag = m[0];
      if (/\sdata-routed\b/.test(tag)) continue;
      const origin = /\sdata-oq-origin=["']([^"']*)["']/.exec(tag);
      if (!origin || (origin[1] !== 'deferred' && origin[1] !== 'found')) {
        const title = /\sdata-issue-title=["']([^"']*)["']/.exec(tag);
        issues.push({ kind: 'final-report-origin', why: `Fund "${title ? title[1] : '?'}" has no data-oq-origin="deferred" | "found" — it skipped the open-points admission gate (validation-gate.md 33b)`, at: region.at });
      }
    }
  }
  // Visible label length (validation-gate.md 33c): the close-out sheet shows a
  // row title in two lines at most, and a longer one is cut by the clamp.
  const tooLong = (kind, text) => {
    const t = text.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, 'x').replace(/\s+/g, ' ').trim();
    if ([...t].length > FR_LABEL_MAX) {
      issues.push({ kind: 'final-report-label-length', why: `${kind} "${t.slice(0, 40)}…" is ${[...t].length} characters — the visible label is a noun phrase of at most ${FR_LABEL_MAX} (the sheet shows two lines); details go into data-issue-body / the report body (validation-gate.md 33c)`, at: region.at });
    }
  };
  if (oqStart >= 0) {
    for (const m of body.slice(oqStart).matchAll(/<[a-z]+\b[^>]*\sclass=["'][^"']*\boq-label\b[^"']*["'][^>]*>([\s\S]*?)<\/[a-z]+>/gi)) tooLong('Fund label', m[1]);
  }
  for (const attr of ['data-tests', 'data-handoffs']) {
    const at = body.search(new RegExp('\\s' + attr + '(?=[\\s=>/])'));
    if (at < 0) continue;
    const end = body.indexOf('</section>', at);
    const seg = body.slice(at, end < 0 ? undefined : end);
    for (const m of seg.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const todo = /<[a-z]+\b[^>]*class=["'][^"']*\btodo-text\b[^"']*["'][^>]*>([\s\S]*?)<\/[a-z]+>/i.exec(m[1]);
      tooLong(attr === 'data-tests' ? '🧪 item' : '👉 item', todo ? todo[1] : m[1]);
    }
  }
  if (/nicht führbar|not guidable/i.test(body)) {
    issues.push({ kind: 'final-report-not-guidable', why: 'the final report says "nicht führbar" — never shown: "Mit Anleitung" on such an item means written steps (validation-gate.md 37b)', at: region.at });
  }
  return issues;
}

// Clipboard / paste-into-chat submit anti-patterns. A valid live-bridge
// concept page never copies anything to the clipboard, so any match here is
// the exact regression the user reported.
//
// The clipboard pattern matches the copy-out API and the copy-out UI wording
// only — NOT the bare word. The templates' own attachment engine legitimately
// reads `ev.clipboardData` for Ctrl/Cmd+V file paste (templates.md
// § Attachments), and a bare /clipboard/ blocked every page generated verbatim
// from the reference (#330).
const FORBIDDEN = [
  { re: /navigator\.clipboard|clipboard\.(write|read)(Text)?\(|copy (to|into) (the )?clipboard/i, why: 'clipboard copy (navigator.clipboard / clipboard.writeText / "copy to clipboard")' },
  { re: /zwischenablage/i, why: '"Zwischenablage kopieren" copy UI' },
  { re: /in den chat (ein|einf)/i, why: '"in den Chat einfügen" paste instruction' },
  { re: /paste[^.\n]{0,24}chat/i, why: '"paste … into chat" instruction' },
  // An unresolved locale key reaches the user as raw text
  // ("panel.submit_not_durable") exactly when a submit fails.
  { re: /showSubmitWarning\(\s*['"][a-z_]+\.[a-z_.]+['"]\s*\)/, why: 'unresolved locale key passed to showSubmitWarning — resolve it from the UI locale table' },
];

// Engine chrome classes a round's mock <style> must never restyle (#400).
// The engine's own head stylesheet owns them; a mock rule on the same bare
// name — `.overlay` for a fog SVG — once restyled the decision panel, which
// then sat docked LEFT with a dead ☰ FAB. Kept explicit and short so a
// legitimately named mock class cannot false-block.
const ENGINE_CLASSES = [
  'concept-decision-panel', 'panel-fab', 'panel-backdrop', 'feedback-fab',
  'feedback-dock', 'feedback-dock-header', 'feedback-section', 'iteration-tabs',
  'iteration-tab', 'screen-indicator', 'design-switcher', 'frozen-bar',
  'frozen-bar-text', 'closeout-sheet', 'device-frame', 'panel-here',
  'concept-layout', 'concept-content', 'iteration-intro',
  'design-header', 'design-quick', 'design-ov', 'design-ov-stage', 'design-ov-slide',
  'design-ov-preview', 'design-ov-overlay', 'design-ov-star',
  'upin', 'upin-layer', 'upin-hint', 'design-keys', 'app-kbd',
];
// A mock class is namespaced when it carries a per-design prefix.
const MOCK_PREFIX_RE = /^(d\d+-|s\d+-|mock-|mk-)/;

function stripCssComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Split a selector list on top-level commas (`:is(a, b)` stays whole). */
function splitSelectors(list) {
  const out = [];
  let depth = 0, buf = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Brace-balanced rule walker; recurses into at-rules (`@media`, `@supports`). */
function cssRules(src) {
  const out = [];
  let i = 0, sel = '';
  while (i < src.length) {
    if (src[i] === '}') { sel = ''; i++; continue; }
    if (src[i] !== '{') { sel += src[i]; i++; continue; }
    let depth = 1, j = i + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (!depth) break; }
      j++;
    }
    const head = sel.trim();
    if (head.startsWith('@')) {
      if (/^@(media|supports|container|layer)\b/.test(head)) out.push(...cssRules(src.slice(i + 1, j)));
    } else if (head) {
      out.push({ selectors: splitSelectors(head), body: src.slice(i + 1, j) });
    }
    sel = '';
    i = j + 1;
  }
  return out;
}

/**
 * P32 (#400): mock CSS inside an iteration must not collide with the engine.
 * For every `<style>` inside a `section[data-iteration]` (iterations are
 * siblings, so a block runs from one `<section … data-iteration` to the
 * next), every rule's selectors are checked: a class from ENGINE_CLASSES is
 * a collision; a bare single-class selector without a per-design prefix is
 * a generic name waiting to collide. `@media` is recursed, comments are
 * stripped, `:is()` / `:where()` lists are not split. The engine's own head
 * stylesheet sits outside every iteration and is exempt by construction.
 * @returns {{ kind: 'engine-class'|'bare-class', why: string }[]}
 */
function findChromeCollisions(html) {
  const issues = [];
  const src = String(html || '');
  const starts = [...src.matchAll(/<section\b[^>]*\bdata-iteration\b[^>]*>/g)];
  for (let n = 0; n < starts.length; n++) {
    const from = starts[n].index;
    const to = n + 1 < starts.length ? starts[n + 1].index : src.length;
    const tag = starts[n][0];
    const idm = /\sid="([^"]+)"/.exec(tag);
    const itm = /\sdata-iteration="([^"]*)"/.exec(tag);
    const where = idm ? `#${idm[1]}` : `section[data-iteration="${itm ? itm[1] : '?'}"]`;
    const chunk = src.slice(from, to);
    for (const m of chunk.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      for (const rule of cssRules(stripCssComments(m[1]))) {
        for (const sel of rule.selectors) {
          const classes = [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(x => x[1]);
          const hit = classes.find(c => ENGINE_CLASSES.includes(c));
          if (hit) {
            issues.push({ kind: 'engine-class', why: `<style> in ${where}: selector "${sel}" restyles the engine chrome class .${hit}` });
            continue;
          }
          const bare = /^\.(-?[_a-zA-Z][\w-]*)$/.exec(sel);
          if (bare && !MOCK_PREFIX_RE.test(bare[1])) {
            issues.push({ kind: 'bare-class', why: `<style> in ${where}: bare selector "${sel}" — prefix mock classes per design (.d1-${bare[1]}) or scope them ([data-design="d1"] ${sel})` });
          }
        }
      }
    }
  }
  return issues;
}

/**
 * A file inside a concept SOURCE folder — docs/concepts/{name}/rounds/NN.html
 * or docs/concepts/{name}/head.html (scripts/concept-build.js). Those are
 * fragments, not pages: the build gates the page it assembles from them.
 */
function isConceptSourceFile(filePath) {
  if (!filePath) return false;
  const norm = String(filePath).replace(/\\/g, '/').toLowerCase();
  return /(^|\/)docs\/concepts\/[^/]+\/(rounds\/[^/]+|head)\.html?$/.test(norm);
}

/**
 * The source folder of a page assembled by concept-build.js — a page.json in
 * the folder of the same name next to it, with or without the generator meta
 * (a full Write can drop the meta) — or null. Returned in filePath's form,
 * without the trailing `.html`.
 */
function builtPageSource(filePath) {
  if (!filePath) return null;
  const dir = String(filePath).replace(/\.html?$/i, '');
  try {
    if (require('fs').existsSync(path.join(dir, 'page.json'))) return dir;
  } catch { /* unreadable → treat as a plain page */ }
  return null;
}

/**
 * Is this written file a concept page we should gate?
 * Triggers on the canonical output location (the `docs/concepts/*.html` path
 * where SKILL.md Step 2 writes every concept) OR on a concept content
 * signature, so a misplaced page is still caught. The narrow `docs/concepts/`
 * match avoids false-positives on an unrelated `concepts/` folder a consumer
 * project might happen to have.
 */
function isConceptHtml(filePath, html) {
  if (!filePath || !/\.html?$/i.test(filePath)) return false;
  const norm = String(filePath).replace(/\\/g, '/').toLowerCase();
  if (norm.includes('docs/concepts/')) return true;
  const body = html || '';
  return (
    body.includes('concept-decisions') ||
    /data-template=["'](decision|prototype|free)["']/.test(body) ||
    body.includes('submit-iterate-btn')
  );
}

/** The page-level template from `<html data-template="…">` (null when absent). */
function pageTemplate(html) {
  const m = /<html\b[^>]*\sdata-template=["']([a-z]+)["']/i.exec(html || '');
  return m ? m[1].toLowerCase() : null;
}

function engineAnchorMissing(body, e) {
  return e.re ? !e.re.test(body) : !body.includes(e.token);
}

/**
 * Engine-currency / engine-integrity markers absent from the html (see
 * ENGINE, ENGINE_DESIGN, ENGINE_DOCUMENT). The shared list always applies;
 * the template-scoped lists follow `<html data-template>` (design →
 * ENGINE_DESIGN; decision / free / prototype → ENGINE_DOCUMENT; absent → none);
 * a page with a `data-final-report` round adds ENGINE_FINAL.
 */
function findStaleEngine(html) {
  const body = html || '';
  const template = pageTemplate(body);
  const scoped = template === 'design' ? ENGINE_DESIGN
    : (template === 'decision' || template === 'free' || template === 'prototype') ? ENGINE_DOCUMENT
    : [];
  const final = finalReportRegion(body) ? ENGINE_FINAL : [];
  return [...ENGINE, ...scoped, ...final].filter(e => engineAnchorMissing(body, e));
}

/** Required markers absent from the html. */
function findMissing(html) {
  const body = html || '';
  return REQUIRED.filter(r => !body.includes(r.token));
}

/** Forbidden anti-patterns present in the html. */
function findForbidden(html) {
  const body = html || '';
  return FORBIDDEN.filter(f => f.re.test(body));
}

/**
 * Structural integrity of the `<style>` / `<script>` blocks (#346).
 *
 * Every marker grep passes on a page whose opening `<style>` line was copied
 * INSIDE the new style block (engine CSS carried over from an older page):
 * the CSS parser swallows the whole `:root` token block and the page renders
 * white and unthemed — "das ganze Konzept kaputt dargestellt" — while all the
 * required tokens are still present. So the gate walks the tag stream and
 * reports: a `<style` or `<script` that opens while a block of that kind is
 * already open, a closing tag with no open block, an open block that never
 * closes, and an open/close count mismatch per kind. A `<style` token seen
 * while a `<script>` block is open is ignored — that is a string inside JS,
 * not markup — and only the tag-open form (`<style>` / `<style ...>`) counts,
 * never a bare mention in prose or a comment.
 *
 * @returns {Array<{kind:string, why:string, at:number}>} — empty when sound.
 */
function findStructural(html) {
  const body = html || '';
  const issues = [];
  const re = /<(\/?)(style|script)(?=[\s>])/gi;
  const open = { style: null, script: null };
  const counts = { style: { open: 0, close: 0 }, script: { open: 0, close: 0 } };
  let m;
  while ((m = re.exec(body)) !== null) {
    const closing = m[1] === '/';
    const kind = m[2].toLowerCase();
    const at = m.index;
    // Inside an open <script>, a "<style" / "<script" token is JS string
    // content (template literals building markup), not a tag.
    if (open.script !== null && !(closing && kind === 'script')) continue;
    if (closing) {
      counts[kind].close += 1;
      if (open[kind] === null) {
        issues.push({ kind: `stray-close-${kind}`, why: `</${kind}> at offset ${at} closes nothing — no open <${kind}> block`, at });
      } else {
        open[kind] = null;
      }
      continue;
    }
    counts[kind].open += 1;
    if (open[kind] !== null) {
      issues.push({ kind: `nested-${kind}`, why: `<${kind}> at offset ${at} opens inside the <${kind}> block that opened at offset ${open[kind]} — the parser swallows everything up to the next </${kind}>`, at });
      continue; // keep the outer block as the open one
    }
    if (kind === 'script' && open.style !== null) {
      issues.push({ kind: 'script-in-style', why: `<script> at offset ${at} opens inside the <style> block that opened at offset ${open.style}`, at });
      continue;
    }
    open[kind] = at;
  }
  for (const kind of ['style', 'script']) {
    if (open[kind] !== null) {
      issues.push({ kind: `unclosed-${kind}`, why: `<${kind}> at offset ${open[kind]} is never closed`, at: open[kind] });
    }
    const c = counts[kind];
    if (c.open !== c.close) {
      issues.push({ kind: `unbalanced-${kind}`, why: `${c.open} <${kind}> vs ${c.close} </${kind}> tags`, at: -1 });
    }
  }
  return issues;
}

// --- Information mapping specs (templates-mapping.md § Information Mapping (engine)) -

const MAP_ID_RE = /^[a-z0-9_]+$/;
const MAP_RESERVED_RE = /^u\d+$/; // `u{n}` belongs to ad-hoc items

/**
 * Split a matrix / order key (`{base}` or `{base}@{ctx}`) into its parts.
 * Only the LAST `@` separates the context: ids never contain `@`, so a
 * key with more than one is simply reported as unknown by the caller.
 */
function splitCtxKey(key) {
  const i = String(key).lastIndexOf('@');
  return i < 0 ? { base: String(key), ctx: null } : { base: key.slice(0, i), ctx: key.slice(i + 1) };
}

/**
 * Validate one parsed mapping spec against the engine's `normalizeSpec()`
 * rules (M2–M4 of the design spec) plus the reference / context checks of
 * `proposal`, `proposalOrder`, `submitted.cells` and `submitted.order`.
 * Pushes `{kind, why, at}` issues; returns the derived model the caller
 * needs for the frozen-round check (M9).
 */
function validateMappingSpec(raw, mid, at, issues) {
  const push = (kind, why) => issues.push({ kind, why: `mapping "${mid}": ${why}`, at });
  const show = v => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
  // Shape: a present but non-array list is a spec error, never silently [].
  const arr = (v, field, where) => {
    if (v == null) return [];
    if (Array.isArray(v)) return v;
    push('spec-parse', `"${field}" must be an array${where ? ` (${where})` : ''}`);
    return [];
  };
  const idOf = o => (o && typeof o === 'object' ? o.id : undefined);

  const items = arr(raw.items, 'items');
  const elements = arr(raw.elements, 'elements');
  const axes = arr(raw.axes, 'axes');
  const rawHasContext = raw.context != null;
  const ctxIsObject = rawHasContext && typeof raw.context === 'object' && !Array.isArray(raw.context);
  if (rawHasContext && !ctxIsObject) push('spec-parse', '"context" must be an object');
  const ctxValues = ctxIsObject ? arr(raw.context.values, 'context.values') : [];
  // Like the engine: a context without values is no context at all.
  const hasContext = ctxValues.length > 0;
  const elParts = elements.map(el => arr(el && el.parts, 'parts', `element ${show(idOf(el))}`));
  const axColumns = axes.map(ax => arr(ax && ax.columns, 'columns', `axis ${show(idOf(ax))}`));

  // M4 — an empty mapping renders nothing.
  if (!items.length) push('empty-mapping', 'no items — at least one is required');
  if (!elements.length && !axes.length) push('empty-mapping', 'no elements and no axes — at least one is required');
  elements.forEach((el, i) => { if (!elParts[i].length) push('empty-mapping', `element ${show(idOf(el))} has no parts`); });
  axes.forEach((ax, i) => { if (!axColumns[i].length) push('empty-mapping', `axis ${show(idOf(ax))} has no columns`); });
  if (rawHasContext && !hasContext) push('empty-mapping', 'context is present but has no values');

  // M2 — id grammar over every id the engine checks.
  const checkId = (what, entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { push('bad-id', `${what} entry ${show(entry)} must be an object with an "id"`); return; }
    const id = entry.id;
    if (typeof id !== 'string' || !MAP_ID_RE.test(id)) push('bad-id', `${what} id ${show(id)} must match ^[a-z0-9_]+$`);
  };
  items.forEach(it => checkId('item', it));
  elements.forEach((el, i) => { checkId('element', el); elParts[i].forEach(p => checkId(`part (element ${show(idOf(el))})`, p)); });
  axes.forEach((ax, i) => { checkId('axis', ax); axColumns[i].forEach(c => checkId(`column (axis ${show(idOf(ax))})`, c)); });
  ctxValues.forEach(v => checkId('context value', v));
  items.forEach(it => {
    const id = idOf(it);
    if (typeof id === 'string' && MAP_RESERVED_RE.test(id)) push('bad-id', `item id "${id}" is reserved for ad-hoc items (u{n})`);
  });

  // M2 — uniqueness.
  const dupes = (what, ids, where) => {
    const seen = new Set();
    ids.forEach(id => {
      if (id === undefined) return;
      const k = typeof id === 'string' ? id : JSON.stringify(id);
      if (seen.has(k)) push('duplicate-id', `duplicate ${what} id ${show(id)}${where || ''}`);
      seen.add(k);
    });
  };
  dupes('item', items.map(idOf));
  dupes('source', [...elements.map(idOf), ...axes.map(idOf)], ' (element and axis ids share one namespace)');
  elements.forEach((el, i) => dupes('part', elParts[i].map(idOf), ` in element ${show(idOf(el))}`));
  axes.forEach((ax, i) => dupes('column', axColumns[i].map(idOf), ` in axis ${show(idOf(ax))}`));
  dupes('context value', ctxValues.map(idOf));

  // Derived sets for the reference checks (M3).
  const itemIds = new Set(items.map(idOf).filter(id => typeof id === 'string'));
  const ctxIds = new Set(ctxValues.map(idOf).filter(id => typeof id === 'string'));
  const sources = [
    ...elements.map((el, i) => ({ id: idOf(el), targets: elParts[i].map(p => ({ key: `${idOf(el)}.${idOf(p)}`, ordered: !!(p && p.ordered) })) })),
    ...axes.map((ax, i) => ({ id: idOf(ax), targets: axColumns[i].map(c => ({ key: `${idOf(ax)}.${idOf(c)}`, ordered: false })) })),
  ];
  const targetKeys = new Set(sources.flatMap(s => s.targets.map(t => t.key)));
  const orderedKeys = new Set(sources.flatMap(s => s.targets.filter(t => t.ordered).map(t => t.key)));
  const targetsOf = new Map(sources.map(s => [s.id, new Set(s.targets.map(t => t.key))]));
  const withCtx = key => (ctxIds.size ? [...ctxIds].map(c => `${key}@${c}`) : [key]);
  const matrixKeys = sources.flatMap(s => withCtx(s.id));
  const orderKeys = [...orderedKeys].flatMap(withCtx);

  // A context reference in a proposal triple / key must agree with the spec.
  const checkCtx = (where, ctx) => {
    if (ctx == null) {
      if (hasContext) { push('ctx-mismatch', `${where} lacks the context value the spec's "context" requires`); return false; }
      return true;
    }
    if (!hasContext) { push('ctx-mismatch', `${where} carries context ${show(ctx)} but the spec has no "context"`); return false; }
    if (!ctxIds.has(ctx)) { push('ctx-mismatch', `${where} names unknown context value ${show(ctx)}`); return false; }
    return true;
  };

  arr(raw.proposal, 'proposal').forEach((p, i) => {
    const where = `proposal[${i}] ${JSON.stringify(p)}`;
    if (!Array.isArray(p) || p.length < 2) { push('unknown-ref', `${where} is not an [item, target] pair`); return; }
    if (!itemIds.has(p[0])) push('unknown-ref', `${where} references unknown item ${show(p[0])}`);
    if (!targetKeys.has(p[1])) push('unknown-ref', `${where} references unknown target ${show(p[1])} (expected {element|axis}.{part|column})`);
    checkCtx(where, p.length > 2 && p[2] != null ? p[2] : null);
  });

  // `{target}` / `{target}@{ctx}` → [itemIds]; the target must be ordered.
  const checkOrder = (label, order, extraItem) => {
    if (order == null) return;
    if (typeof order !== 'object' || Array.isArray(order)) { push('unknown-ref', `${label} must be an object keyed by "{target}" or "{target}@{ctx}"`); return; }
    Object.keys(order).forEach(key => {
      const where = `${label}["${key}"]`;
      const { base, ctx } = splitCtxKey(key);
      if (!targetKeys.has(base)) push('unknown-ref', `${where} names unknown target ${show(base)}`);
      else if (!orderedKeys.has(base)) push('unknown-ref', `${where} names target ${show(base)} which is not "ordered": true`);
      checkCtx(where, ctx);
      if (!Array.isArray(order[key])) { push('unknown-ref', `${where} must be an array of item ids`); return; }
      order[key].forEach(id => { if (!itemIds.has(id) && !extraItem(id)) push('unknown-ref', `${where} lists unknown item ${show(id)}`); });
    });
  };
  checkOrder('proposalOrder', raw.proposalOrder, () => false);

  // `submitted` — written by Claude when the round is frozen (§ Freezing).
  const submitted = raw.submitted != null && typeof raw.submitted === 'object' && !Array.isArray(raw.submitted) ? raw.submitted : null;
  const cells = submitted && submitted.cells != null && typeof submitted.cells === 'object' && !Array.isArray(submitted.cells) ? submitted.cells : null;
  const order = submitted && submitted.order != null && typeof submitted.order === 'object' && !Array.isArray(submitted.order) ? submitted.order : null;
  // Ad-hoc items `u{n}` resolve against `submitted.adhoc` (labels, 1-based).
  const adhocCount = submitted && Array.isArray(submitted.adhoc) ? submitted.adhoc.length : 0;
  const isAdhoc = id => {
    const m = typeof id === 'string' && MAP_RESERVED_RE.exec(id);
    if (!m) return false;
    const n = Number(id.slice(1));
    return !!raw.adhocItems && n >= 1 && n <= adhocCount;
  };
  if (cells) {
    Object.keys(cells).forEach(key => {
      const where = `submitted.cells["${key}"]`;
      const { base, ctx } = splitCtxKey(key);
      const known = targetsOf.has(base);
      if (!known) push('unknown-ref', `${where} names unknown element/axis ${show(base)} (matrix keys are "{src}" or "{src}@{ctx}")`);
      checkCtx(where, ctx);
      const pairs = cells[key];
      if (!Array.isArray(pairs)) { push('unknown-ref', `${where} must be an array of [item, target] pairs`); return; }
      pairs.forEach((p, i) => {
        const pw = `${where}[${i}] ${JSON.stringify(p)}`;
        if (!Array.isArray(p) || p.length < 2) { push('unknown-ref', `${pw} is not an [item, target] pair`); return; }
        if (p.length > 2 && p[2] != null) push('ctx-mismatch', `${pw} carries a third element — the context belongs in the matrix key ("${base}@{ctx}"), not in the pair`);
        if (!itemIds.has(p[0]) && !isAdhoc(p[0])) push('unknown-ref', `${pw} references unknown item ${show(p[0])}`);
        if (!targetKeys.has(p[1])) push('unknown-ref', `${pw} references unknown target ${show(p[1])}`);
        else if (known && !targetsOf.get(base).has(p[1])) push('unknown-ref', `${pw} target ${show(p[1])} does not belong to "${base}"`);
      });
    });
  }
  if (submitted) checkOrder('submitted.order', submitted.order, isAdhoc);

  // Mirror of the engine's complete(): every matrix key present as an array.
  // Ordered targets additionally need `submitted.order[key]` — otherwise the
  // engine falls back to `proposalOrder` and shows the proposal's order as
  // the user's decision.
  const missingKeys = cells ? matrixKeys.filter(k => !Array.isArray(cells[k])) : matrixKeys;
  const missingOrderKeys = order ? orderKeys.filter(k => !Array.isArray(order[k])) : orderKeys;
  const complete = !!cells && !missingKeys.length && !missingOrderKeys.length;
  return { complete, matrixKeys, missingKeys, orderKeys, missingOrderKeys };
}

/**
 * Information-mapping specs (templates-mapping.md § Information Mapping (engine) →
 * Spec; design spec § 11 rules M1–M4 and M9).
 *
 * Every `section[data-mapping]` must carry a `<script data-mapping-spec>`
 * whose JSON normalises exactly as the page's engine normalises it: id
 * grammar, uniqueness, resolvable `proposal` / `submitted` references, the
 * context dimension present iff the spec has one, a non-empty target set.
 * A mapping inside an iteration WITHOUT `data-active` is frozen and must
 * carry a complete `submitted` (a cells entry for every matrix key) —
 * otherwise the page silently presents Claude's proposal as the user's
 * decision, the one outcome this construct must never produce.
 *
 * Regex walk over the raw HTML, like findStructural: iteration open tags
 * give the frozen/live state (nearest preceding one wins), mapping open tags
 * delimit where a spec script may sit (before the wrapper's `</section>` and
 * before the next mapping). Attribute values may be double- or
 * single-quoted; the `data-mapping` value must follow the id grammar and
 * equal the section's `id`. Ordered targets of a frozen round need
 * `submitted.order` as well as `submitted.cells`.
 *
 * @returns {Array<{kind:string, why:string, at:number}>} — empty when sound.
 */
function findMappingIssues(html) {
  const body = html || '';
  const issues = [];
  if (!body.includes('data-mapping')) return issues;

  const iterations = [];
  const iterRe = /<section\b[^>]*\bdata-iteration=("|')(\d+)\1[^>]*>/gi;
  let m;
  while ((m = iterRe.exec(body)) !== null) {
    iterations.push({ at: m.index, n: m[2], active: /\bdata-active\b/.test(m[0]) });
  }

  const mappings = [];
  const mapRe = /<section\b[^>]*\bdata-mapping=("|')([^"']*)\1[^>]*>/gi;
  while ((m = mapRe.exec(body)) !== null) {
    // Anchored on whitespace, not \b: `\bid=` also matches the tail of a
    // co-attribute such as `data-foo-id="x"` and reads it as the section id.
    // A real attribute always follows whitespace (the tag opens with `<section`).
    const idAttr = /(?:^|\s)id=("|')([^"']*)\1/i.exec(m[0]);
    mappings.push({ at: m.index, id: m[2], domId: idAttr ? idAttr[2] : null });
  }

  const specRe = /<script\b[^>]*\bdata-mapping-spec\b[^>]*>([\s\S]*?)<\/script>/gi;
  const seenIds = new Map();

  mappings.forEach((map, i) => {
    const mid = map.id;
    const at = map.at;
    // The spec must sit inside the wrapper: before its first `</section>`
    // and before the next mapping's open tag, whichever comes first.
    const close = body.indexOf('</section>', at);
    const nextAt = i + 1 < mappings.length ? mappings[i + 1].at : body.length;
    const end = Math.min(close < 0 ? body.length : close, nextAt);

    // M2 — the mapping id follows the grammar and IS the section's DOM id.
    if (!MAP_ID_RE.test(mid)) {
      issues.push({ kind: 'bad-id', why: `mapping id "${mid}" (data-mapping) must match ^[a-z0-9_]+$`, at });
    }
    if (map.domId !== mid) {
      const have = map.domId == null ? 'no id attribute' : `id="${map.domId}"`;
      issues.push({ kind: 'bad-id', why: `mapping "${mid}": section id must equal data-mapping (section has ${have})`, at });
    }

    if (seenIds.has(mid)) {
      issues.push({ kind: 'duplicate-mapping-id', why: `data-mapping="${mid}" at offset ${at} repeats the mapping at offset ${seenIds.get(mid)} — mapping ids are DOM ids and must be unique page-wide`, at });
    } else {
      seenIds.set(mid, at);
    }

    specRe.lastIndex = at;
    const s = specRe.exec(body);
    if (!s || s.index >= end) {
      issues.push({ kind: 'spec-missing', why: `mapping "${mid}" at offset ${at} has no <script type="application/json" data-mapping-spec> block inside its section`, at });
      return;
    }
    let raw;
    try { raw = JSON.parse(s[1]); }
    catch (e) {
      issues.push({ kind: 'spec-parse', why: `mapping "${mid}": spec JSON does not parse — ${e.message}`, at });
      return;
    }
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ kind: 'spec-parse', why: `mapping "${mid}": spec must be a JSON object`, at });
      return;
    }

    const model = validateMappingSpec(raw, mid, at, issues);

    // M9 — nearest preceding iteration open tag decides frozen vs live.
    let iter = null;
    for (const it of iterations) { if (it.at < at) iter = it; else break; }
    if (iter && !iter.active && !model.complete) {
      const q = ks => ks.map(k => `"${k}"`).join(', ');
      let detail;
      if (raw.submitted == null) detail = 'has no "submitted" object';
      else if (model.missingKeys.length) detail = `"submitted.cells" lacks matrix key(s) ${q(model.missingKeys)}`;
      else detail = `"submitted.order" lacks ordered target key(s) ${q(model.missingOrderKeys)} (the engine would fall back to proposalOrder)`;
      issues.push({ kind: 'frozen-without-submitted', why: `mapping "${mid}" sits in frozen iteration ${iter.n} (no data-active) but ${detail} — the page would show Claude's proposal as the user's decision`, at });
    }
  });

  return issues;
}

// --- Views re-asking the design choice (validation-gate.md P31) --------------

/** One attribute value off a raw open tag; `null` when absent. */
function attrOf(tag, name) {
  const m = new RegExp(`(?:^|\\s)${name}=("|')([^"']*)\\1`, 'i').exec(tag);
  return m ? m[2] : null;
}

/** Case-insensitive, whitespace-collapsed key for label comparison. */
function labelKey(s) {
  return String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A `decision` / `comparison` view whose alternatives ARE the designs of the
 * same round (SKILL.md § Step 1a → Orthogonality; validation-gate.md P31).
 *
 * The verdict between the designs is read from the dock's per-design notes.
 * A view that lists the designs again as `[data-decision]` groups asks the
 * same question a second time — and the two answers can disagree. This
 * catches the crude form only: an alternative whose `data-label` (fallback:
 * the first `<h2>`/`<h3>` after its open tag) equals a design's
 * `data-nav-label` or `data-design` id of the same iteration. Paraphrases
 * ("Sidebar as in A") stay the manual sweep's job.
 *
 * Regex walk like findMappingIssues: iteration open tags partition the page,
 * designs are attributed to the nearest preceding iteration, and a view's
 * region runs to the next top-level sibling (view / design / iteration).
 *
 * @returns {Array<{kind:string, why:string, at:number}>} — empty when sound.
 */
function findViewOverlap(html) {
  const body = html || '';
  const issues = [];
  if (!/\sdata-view-kind=("|')(decision|comparison)\1/i.test(body)) return issues;

  const tops = []; // every top-level sibling open tag, in document order
  const topRe = /<section\b[^>]*\s(data-iteration|data-design|data-view)=("|')([^"']*)\2[^>]*>/gi;
  let m;
  while ((m = topRe.exec(body)) !== null) {
    tops.push({ at: m.index, kind: m[1].toLowerCase(), id: m[3], tag: m[0] });
  }

  // Design labels per iteration — keyed by the iteration open tag's offset.
  const designs = new Map();
  let iterAt = -1;
  for (const t of tops) {
    if (t.kind === 'data-iteration') { iterAt = t.at; continue; }
    if (t.kind !== 'data-design') continue;
    if (!designs.has(iterAt)) designs.set(iterAt, new Map());
    const set = designs.get(iterAt);
    const nav = attrOf(t.tag, 'data-nav-label');
    set.set(labelKey(t.id), t.id);
    if (nav && labelKey(nav)) set.set(labelKey(nav), t.id);
  }

  const decRe = /<\w+\b[^>]*\sdata-decision=("|')([^"']*)\1[^>]*>/gi;
  const headRe = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i;
  iterAt = -1;
  tops.forEach((t, i) => {
    if (t.kind === 'data-iteration') { iterAt = t.at; return; }
    if (t.kind !== 'data-view') return;
    const kind = (attrOf(t.tag, 'data-view-kind') || '').toLowerCase();
    if (kind !== 'decision' && kind !== 'comparison') return;
    const set = designs.get(iterAt);
    if (!set || set.size === 0) return;
    const end = i + 1 < tops.length ? tops[i + 1].at : body.length;
    const region = body.slice(t.at, end);
    decRe.lastIndex = 0;
    let d;
    while ((d = decRe.exec(region)) !== null) {
      const at = t.at + d.index;
      let label = attrOf(d[0], 'data-label');
      if (label == null) {
        // Fallback: the first heading after the open tag, before the next group.
        const rest = region.slice(d.index + d[0].length);
        const nextAt = rest.search(/<\w+\b[^>]*\sdata-decision=/i);
        const h = headRe.exec(nextAt < 0 ? rest : rest.slice(0, nextAt));
        label = h ? h[1] : '';
      }
      const key = labelKey(label);
      if (!key || !set.has(key)) continue;
      issues.push({
        kind: 'view-reasks-design',
        why: `view "${t.id}" (${kind}) at offset ${t.at} lists "${label.trim()}" as an alternative (data-decision="${d[2]}" at offset ${at}) — that is design "${set.get(key)}" of the same iteration; which design wins is read from the dock's per-design notes, a view asks something orthogonal (SKILL.md § Step 1a → Orthogonality, P31)`,
        at,
      });
    }
  });

  return issues;
}

// --- Variant overview authoring (validation-gate.md § Variant overview) -----

/**
 * Advisory only — never blocks. A design round with ≥2 `section[data-design]`
 * renders an overview slide per design from `data-design-motto`,
 * `data-design-traits` (exactly three, `|`-separated) and `data-design-icon`
 * (templates-design-views.md § Variant overview (≥2 designs)). A missing one still
 * renders (no motto line, no traits, a generic icon), so a page written
 * before the overview existed must keep building; the warning names what the
 * overlay is missing. The round itself should say what its designs are
 * (`data-design-set="alternatives|topics"` — only `alternatives` offers a
 * favourite), and `data-design-overlay` must name a known anchor.
 *
 * @returns {Array<{kind:string, why:string, at:number}>}
 */
/**
 * Advisory: placeholders left in the final report. The locale table carries
 * `{n}` for the author to fill ("{n} Funde unterwegs", "Stufe {n} von 7"), and
 * a `{{key}}` the build could not substitute stays as written — either one
 * shows up as raw text on the page. Code spans and comments are skipped.
 */
function findFinalReportPlaceholders(html) {
  const region = finalReportRegion(html);
  if (!region) return [];
  const body = region.html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(code|pre|script|style|textarea)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, ' ');
  const found = [...new Set([...body.matchAll(/\{\{[^{}\s]+\}\}|\{n\}/g)].map(m => m[0]))];
  return found.map(token => ({
    kind: 'final-report-placeholder',
    why: `the final report shows the placeholder ${token} as raw text — fill in the value or fix the locale key`,
  }));
}

// --- Design-round differentiation (validation-gate.md V8 / P34) -------------

/** Multiset-Jaccard at or above this counts two screens as near-identical. */
const SCREEN_SIM_THRESHOLD = 0.9;
/** Normalised screens shorter than this are too thin to compare (empty stubs). */
const SCREEN_MIN_CHARS = 40;
/** P34: a design pair is "sub-page only" when at most this many screens differ… */
const SUBPAGE_MAX_DIFF = 2;
/** …or when at least this share of the screens is near-identical. */
const SUBPAGE_MIN_SAME_SHARE = 2 / 3;

/** Strip ids / design prefixes / whitespace so two mocks compare by content. */
function normaliseScreen(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\s(?:id|for|aria-labelledby|aria-controls|data-screen|data-design|data-nav-label|data-anno[\w-]*)=("|')[^"']*\1/gi, '')
    .toLowerCase()
    .replace(/\bd\d+[a-z]?-/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function screenTokens(norm) {
  const m = new Map();
  for (const t of norm.split(/[^a-z0-9äöüß]+/i).filter(Boolean)) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/** Multiset Jaccard of two normalised screens (1 = same tokens in same counts). */
function screenSimilarity(a, b) {
  if (a === b) return 1;
  const ta = screenTokens(a), tb = screenTokens(b);
  let inter = 0, union = 0;
  for (const k of new Set([...ta.keys(), ...tb.keys()])) {
    const x = ta.get(k) || 0, y = tb.get(k) || 0;
    inter += Math.min(x, y);
    union += Math.max(x, y);
  }
  return union === 0 ? 1 : inter / union;
}

function screensAlike(a, b) {
  return !!a && !!b && a.norm.length >= SCREEN_MIN_CHARS && b.norm.length >= SCREEN_MIN_CHARS
    && screenSimilarity(a.norm, b.norm) >= SCREEN_SIM_THRESHOLD;
}

/** Iterations → designs → screens (normalised), by one token walk. */
function parseDesignRounds(html) {
  const body = String(html || '').replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
  const re = /<section\b(?:[^>"']|"[^"]*"|'[^']*')*?\s(data-iteration|data-design|data-view|data-screen)=("|')([^"']*)\2(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const toks = [];
  let m;
  while ((m = re.exec(body)) !== null) toks.push({ kind: m[1].toLowerCase(), id: m[3], tag: m[0], at: m.index, end: m.index + m[0].length });
  const groups = [];
  let g = null, d = null;
  toks.forEach((t, i) => {
    const next = i + 1 < toks.length ? toks[i + 1].at : body.length;
    if (t.kind === 'data-iteration') { g = { n: t.id, tag: t.tag, at: t.at, designs: [] }; groups.push(g); d = null; }
    else if (t.kind === 'data-view') { d = null; }
    else if (t.kind === 'data-design' && g) { d = { id: t.id, tag: t.tag, at: t.at, screens: [] }; g.designs.push(d); }
    else if (t.kind === 'data-screen' && d) {
      d.screens.push({ id: t.id, label: (attrOf(t.tag, 'data-nav-label') || '').trim().toLowerCase(), norm: normaliseScreen(body.slice(t.end, next)) });
    }
  });
  return groups;
}

/**
 * Advisory (V8): the first screens of ≥2 designs in one round are identical
 * or near-identical and neither design carries `data-ov-demo` — the overview
 * then shows two indistinguishable previews.
 * @returns {Array<{kind:string, why:string, at:number}>}
 */
function findIdenticalFirstScreens(html) {
  const out = [];
  for (const g of parseDesignRounds(html)) {
    const ds = g.designs.filter(d => d.screens.length);
    const flagged = new Set();
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        if (/\sdata-ov-demo=/i.test(ds[i].tag) || /\sdata-ov-demo=/i.test(ds[j].tag)) continue;
        if (screensAlike(ds[i].screens[0], ds[j].screens[0])) { flagged.add(ds[i]); flagged.add(ds[j]); }
      }
    }
    if (flagged.size < 2) continue;
    const list = [...flagged];
    out.push({ kind: 'overview-identical-first-screen', at: list[0].at,
      why: `iteration ${g.n}: the first screens of designs ${list.map(d => `"${d.id}"`).join(', ')} are identical or near-identical, so their overview previews look the same — set data-ov-demo="<selector>" on them: the overview then shows the differing element as a looping, zoomed demo (step1-templates.md § 1a · Design iteration authoring)` });
  }
  return out;
}

/**
 * Blocking (P34): a `data-design-set="alternatives"` round whose designs share
 * their screen labels and first screen, and differ on at most
 * SUBPAGE_MAX_DIFF screens (or ≥ SUBPAGE_MIN_SAME_SHARE are alike) — the
 * round is really one sub-page's variants.
 * @returns {Array<{kind:string, why:string, at:number}>}
 */
function findSubpageOnlyRounds(html) {
  const out = [];
  for (const g of parseDesignRounds(html)) {
    if ((attrOf(g.tag, 'data-design-set') || '').trim() !== 'alternatives') continue;
    const ds = g.designs;
    if (ds.length < 2 || ds.some(d => d.screens.length < 2 || d.screens.some(s => !s.label))) continue;
    const key = d => d.screens.map(s => s.label).join('\u0001');
    if (ds.some(d => key(d) !== key(ds[0]))) continue;
    let all = true;
    const differing = new Set();
    for (let i = 0; i < ds.length && all; i++) {
      for (let j = i + 1; j < ds.length && all; j++) {
        const n = ds[i].screens.length;
        let same = 0;
        ds[i].screens.forEach((s, k) => {
          if (screensAlike(s, ds[j].screens[k])) same += 1; else differing.add(s.label);
        });
        if (!screensAlike(ds[i].screens[0], ds[j].screens[0])) all = false;
        else if (!(n - same <= SUBPAGE_MAX_DIFF || same / n >= SUBPAGE_MIN_SAME_SHARE)) all = false;
      }
    }
    if (!all) continue;
    const where = differing.size ? `only ${[...differing].map(l => `"${l}"`).join(', ')} differ${differing.size === 1 ? 's' : ''}` : 'nothing differs';
    out.push({ kind: 'design-round-subpage-only', at: g.at,
      why: `iteration ${g.n}: ${ds.length} "alternatives" designs share every screen label and their first screen; ${where} — these are variants of a sub-page, not of the main design. Make that sub-page's takes the variants of this round (one design per take) and refine it on its own; a later round zooms back out to the main variants (step1-templates.md § 1a · Design iteration authoring → Sub-variants)` });
  }
  return out;
}

function findDesignAuthoringWarnings(html) {
  const body = String(html || '').replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
  const warnings = [];
  // Quoted values are matched whole, so a `>` inside a motto ("Fast -> simple")
  // neither drops the section nor cuts its tag short.
  const topRe = /<section\b(?:[^>"']|"[^"]*"|'[^']*')*?\s(data-iteration|data-design)=("|')([^"']*)\2(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const groups = [];
  let cur = null, m;
  while ((m = topRe.exec(body)) !== null) {
    if (m[1].toLowerCase() === 'data-iteration') {
      cur = { n: m[3], designs: [], tag: m[0], at: m.index };
      groups.push(cur);
    } else if (cur) {
      cur.designs.push({ id: m[3], tag: m[0], at: m.index });
    }
  }
  for (const g of groups) {
    if (g.designs.length < 2) continue;
    const set = attrOf(g.tag, 'data-design-set');
    if (!set || !/^(alternatives|topics)$/.test(set.trim())) {
      warnings.push({ kind: 'overview-set', at: g.at,
        why: `iteration ${g.n}: ${g.designs.length} designs but ${set ? `data-design-set="${set}" is neither "alternatives" nor "topics"` : 'no data-design-set'} — set "alternatives" when the designs answer the same thing (favourite ☆ on), "topics" when they show different topics (templates-design-views.md § Variant overview)` });
    }
    for (const d of g.designs) {
      const missing = [];
      const motto = attrOf(d.tag, 'data-design-motto');
      const traits = attrOf(d.tag, 'data-design-traits');
      const icon = attrOf(d.tag, 'data-design-icon') || (/\sdata-design-icon=/i.test(d.tag) ? 'set' : null);
      if (!motto || !motto.trim()) missing.push('data-design-motto');
      if (!traits || !traits.trim()) missing.push('data-design-traits');
      if (!icon) missing.push('data-design-icon');
      if (missing.length) {
        warnings.push({ kind: 'overview-authoring', at: d.at,
          why: `iteration ${g.n}, design "${d.id}": ${missing.join(', ')} missing — the variant overview slide renders without it (templates-design-views.md § Variant overview)` });
      }
      if (/\sdata-design-overlay=/i.test(d.tag)) {
        warnings.push({ kind: 'overview-overlay', at: d.at,
          why: `iteration ${g.n}, design "${d.id}": data-design-overlay is ignored — the overview card is always bottom-left; remove the attribute (V7)` });
      }
      if (traits && traits.trim()) {
        const count = traits.split('|').map(t => t.trim()).filter(Boolean).length;
        if (count !== 3) warnings.push({ kind: 'overview-traits', at: d.at,
          why: `iteration ${g.n}, design "${d.id}": data-design-traits has ${count} trait(s), the overlay shows exactly three genuine differences ("A | B | C")` });
      }
    }
  }
  return warnings;
}

/**
 * Etappen (stages) rules, read from the built page's `#concept-stages` JSON
 * script (concept-build.js injects it only when page.json declares stages).
 * Blocking kinds `stages-*`; the panel-head title limit is advisory.
 * @returns {{errors:Array<{kind:string,why:string,at:number}>, warnings:Array<{kind:string,why:string,at:number}>}}
 */
function findStageIssues(html) {
  const body = String(html || '').replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
  const errors = [], warnings = [];
  const sm = /<script\b[^>]*\bid=("|')concept-stages\1[^>]*>([\s\S]*?)<\/script\s*>/i.exec(body);
  const topRe = /<section\b(?:[^>"']|"[^"]*"|'[^']*')*?\sdata-iteration=("|')([^"']*)\1(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const rounds = [];
  let m;
  while ((m = topRe.exec(body)) !== null) rounds.push({ n: m[2], tag: m[0], at: m.index, stage: attrOf(m[0], 'data-stage') });
  if (!sm) {
    const stray = rounds.find(r => r.stage);
    if (stray) errors.push({ kind: 'stages-undeclared', at: stray.at, why: `iteration ${stray.n} carries data-stage="${stray.stage}" but the page has no #concept-stages script — declare "stages" in page.json (step1-templates.md § Etappen)` });
    return { errors, warnings };
  }
  let data;
  try { data = JSON.parse(sm[2]); } catch { data = null; }
  const stages = data && Array.isArray(data.stages) ? data.stages : null;
  if (!stages || !stages.length) {
    errors.push({ kind: 'stages-malformed', at: sm.index, why: '#concept-stages is not JSON with a non-empty "stages" array' });
    return { errors, warnings };
  }
  if (stages.length > 7) errors.push({ kind: 'stages-too-many', at: sm.index, why: `${stages.length} stages — at most 7 (A–G)` });
  const ids = stages.map(s => String((s && s.id) || ''));
  ids.forEach((id, i) => {
    const want = String.fromCharCode(65 + i);
    if (id !== want) errors.push({ kind: 'stages-ids', at: sm.index, why: `stage ${i + 1} has id "${id}", expected "${want}" — ids are consecutive capital letters from A` });
  });
  stages.forEach(s => {
    const name = s && typeof s.name === 'string' ? s.name.trim() : '';
    if (!name) errors.push({ kind: 'stages-name', at: sm.index, why: `stage "${s && s.id}" has no name` });
    else if ([...name].length > 24) errors.push({ kind: 'stages-name', at: sm.index, why: `stage "${s.id}" name is ${[...name].length} chars — at most 24 ("${name}")` });
  });
  let last = -1;
  for (const r of rounds) {
    if (!r.stage) { errors.push({ kind: 'stages-round-untagged', at: r.at, why: `iteration ${r.n} has no data-stage — every round of a staged concept carries one` }); continue; }
    const idx = ids.indexOf(r.stage);
    if (idx < 0) { errors.push({ kind: 'stages-round-unknown', at: r.at, why: `iteration ${r.n}: data-stage="${r.stage}" is not a declared stage (${ids.join(', ')})` }); continue; }
    if (idx < last) errors.push({ kind: 'stages-order', at: r.at, why: `iteration ${r.n}: stage ${r.stage} comes after a later stage — stages advance in order` });
    last = Math.max(last, idx);
  }
  const liveRound = rounds[rounds.length - 1];
  if (liveRound && liveRound.stage && data.current && data.current !== liveRound.stage) {
    errors.push({ kind: 'stages-current', at: sm.index, why: `#concept-stages current="${data.current}" but the live round ${liveRound.n} is stage ${liveRound.stage}` });
  }
  if (typeof data.title === 'string' && [...data.title].length > 32) {
    warnings.push({ kind: 'stages-title', at: sm.index, why: `concept title is ${[...data.title].length} chars — the panel head fits 32; shorten page.json "title"` });
  }
  return { errors, warnings };
}

/**
 * Full evaluation for a written file.
 * @returns {{applicable:boolean, ok:boolean, missing:Array, forbidden:Array, structural:Array, mapping:Array, overlap:Array}}
 */
function evaluate(filePath, html) {
  if (!isConceptHtml(filePath, html)) {
    return { applicable: false, ok: true, missing: [], forbidden: [], structural: [], mapping: [], overlap: [], stale: [], finalReport: [], analysis: [], warnings: [] };
  }
  const missing = findMissing(html);
  const forbidden = findForbidden(html);
  const st = findStageIssues(html);
  const structural = [...findStructural(html), ...findSubpageOnlyRounds(html), ...st.errors];
  const mapping = findMappingIssues(html);
  const overlap = findViewOverlap(html);
  const stale = findStaleEngine(html);
  const collisions = findChromeCollisions(html);
  const finalReport = findFinalReportIssues(html);
  const a = findAnalysisIssues(html);
  return {
    applicable: true,
    ok: missing.length === 0 && forbidden.length === 0 && structural.length === 0 && mapping.length === 0 && overlap.length === 0 && stale.length === 0 && collisions.length === 0 && finalReport.length === 0 && a.errors.length === 0,
    missing,
    forbidden,
    structural,
    mapping,
    overlap,
    stale,
    collisions,
    finalReport,
    analysis: a.errors,
    // Advisory, never part of `ok`.
    warnings: [...findDesignAuthoringWarnings(html), ...findIdenticalFirstScreens(html), ...findFinalReportPlaceholders(html), ...a.warnings, ...st.warnings],
  };
}

/** Build the blocking feedback shown to Claude (stderr, exit 2). */
function buildBlockReason(filePath, missing, forbidden, structural, mapping, overlap, stale = [], collisions = [], finalReport = [], analysis = []) {
  analysis = analysis || [];
  missing = missing || [];
  forbidden = forbidden || [];
  structural = structural || [];
  mapping = mapping || [];
  overlap = overlap || [];
  stale = stale || [];
  collisions = collisions || [];
  finalReport = finalReport || [];
  const name = path.basename(filePath || 'concept.html');
  const subpage = structural.filter(i => i.kind === 'design-round-subpage-only');
  const subpageHint = [
    '',
    'A design round\'s variants must differ in the MAIN design. When only one sub-page differs, that sub-page',
    'becomes the variants of THIS round (one design per take of that element) and is refined on its own; a',
    'later round zooms back out to the main variants (P34).',
  ];
  if (subpage.length && subpage.length === structural.length && !missing.length && !forbidden.length && !mapping.length && !overlap.length && !stale.length && !collisions.length && !finalReport.length && !analysis.length) {
    const lines = [`BLOCKED: a design round in "${name}" varies only a sub-page.`, ''];
    subpage.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push(...subpageHint);
    lines.push('The rest of the page passed — re-write the file and open it once this gate passes.');
    return lines.join('\n');
  }
  structural = structural.filter(i => i.kind !== 'design-round-subpage-only');
  const out = buildBlockReasonInner(name, missing, forbidden, structural, mapping, overlap, stale, collisions, finalReport, analysis);
  return subpage.length ? [out, '', 'A design round varies only a sub-page (P34):', ...subpage.map(i => `  - ${i.kind}: ${i.why}`), ...subpageHint].join('\n') : out;
}

function buildBlockReasonInner(name, missing, forbidden, structural, mapping, overlap, stale, collisions, finalReport, analysis) {
  const onlyFinal = finalReport.length > 0 && !analysis.length && !missing.length && !forbidden.length && !structural.length && !mapping.length && !overlap.length && !stale.length && !collisions.length;
  if (onlyFinal) {
    const lines = [`BLOCKED: the final report in "${name}" breaks the close-out authoring rules.`, ''];
    finalReport.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('');
    if (finalReport.every(i => i.kind === 'final-report-skeleton')) {
      lines.push('Replace every <!-- TODO: … --> of the report-only skeleton with the authored report — see');
      lines.push('templates-final-report.md § Final-report section HTML.');
      lines.push('The rest of the page passed — re-write the file and open it once this gate passes.');
      return lines.join('\n');
    }
    lines.push('The Funde are plain <li> elements in the 🔍 fold with data-issue-title, data-issue-type,');
    lines.push('data-oq-origin ("deferred" | "found"), data-route-default and data-route-reason — no');
    lines.push('checkboxes; the panel is the only place to answer. See step5-update-page.md § Final-report');
    lines.push('append and templates-final-report.md § Final-report section HTML.');
    lines.push('The rest of the page passed — re-write the file and open it once this gate passes.');
    return lines.join('\n');
  }
  const onlyAnalysis = analysis.length > 0 && !missing.length && !forbidden.length && !structural.length && !mapping.length && !overlap.length && !stale.length && !collisions.length && !finalReport.length;
  if (onlyAnalysis) {
    const lines = [`BLOCKED: the analysis / decision markup in "${name}" breaks its contract.`, ''];
    analysis.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('');
    lines.push('A Full analysis opens with a briefing (what / why / potential); every decision names its');
    lines.push('recommended option (data-rec) and ships it preselected. See templates-analysis.md § Markup');
    lines.push('contract and validation-gate.md § Analysis & decision modes (A1-A3).');
    lines.push('The rest of the page passed - re-write the file and open it once this gate passes.');
    return lines.join('\n');
  }
  const onlyCollisions = collisions.length > 0 && !finalReport.length && !analysis.length && !missing.length && !forbidden.length && !structural.length && !mapping.length && !overlap.length && !stale.length;
  if (onlyCollisions) {
    const lines = [`BLOCKED: mock CSS in "${name}" collides with the engine chrome (P32).`, ''];
    collisions.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('');
    lines.push('A round\'s <style> shares the document with the decision panel, the FABs, the dock and the');
    lines.push('frames. A mock rule on a bare generic name (.overlay, .card) or on an engine class restyles');
    lines.push('them — the panel then sits docked left with a dead ☰ FAB (#400). Fix: prefix every mock');
    lines.push('class per design (.d1-…) or scope it under the design ([data-design="d1"] …); never name an');
    lines.push('engine class. See templates-design-wiring.md § Design layout rules → Mock CSS is namespaced.');
    lines.push('The rest of the page passed — re-write the file and open it once this gate passes.');
    return lines.join('\n');
  }
  const onlyOverlap = overlap.length > 0 && !finalReport.length && !missing.length && !forbidden.length && !structural.length && !mapping.length;
  if (onlyOverlap) {
    const lines = [`BLOCKED: a view in "${name}" re-asks the design choice.`, ''];
    overlap.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('');
    lines.push('Which design wins is what the 💬 dock\'s per-design notes are for. A decision / comparison view');
    lines.push('asks a question whose answer holds whichever design wins (data model, sync strategy, library, …).');
    lines.push('Fix: drop the alternatives that are the designs again — usually the whole view — rather than');
    lines.push('relabelling them; see skills/auto-concept/SKILL.md § Step 1a → Orthogonality and validation-gate.md P31.');
    lines.push('The rest of the page passed — re-write the file and open it once this gate passes.');
    return lines.join('\n');
  }
  const onlyMapping = mapping.length > 0 && !missing.length && !forbidden.length && !structural.length;
  const lines = [];
  if (onlyMapping) lines.push(`BLOCKED: mapping spec problems in "${name}".`);
  else lines.push(`BLOCKED: "${name}" is not a valid live-bridge concept page.`);
  lines.push('');
  if (finalReport.length) {
    lines.push('Final-report authoring rules (validation-gate.md 33b / 37b):');
    finalReport.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('');
  }
  if (analysis.length) {
    lines.push('Analysis / decision markup breaks its contract (templates-analysis.md):');
    analysis.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('');
  }
  if (collisions.length) {
    lines.push('Mock CSS collides with the engine chrome (P32):');
    collisions.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('  Fix: prefix mock classes per design (.d1-…) or scope them under the design; never name an engine class.');
    lines.push('');
  }
  if (overlap.length) {
    lines.push('A decision / comparison view lists the designs of its own round as alternatives (P31):');
    overlap.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('  Fix: drop those alternatives (usually the whole view) — the design verdict comes from the dock.');
    lines.push('');
  }
  if (mapping.length) {
    lines.push('Mapping spec problems — the information-mapping engine cannot render these sections as authored:');
    mapping.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('  Fix: regenerate the spec from skills/auto-concept/deep-knowledge/templates-mapping.md § Information Mapping (engine) → Spec');
    lines.push('  (ids ^[a-z0-9_]+$, unique, data-mapping = section id; ≥ 1 item; lists are arrays; proposal/submitted');
    lines.push('  refer only to declared items and {src}.{part} targets; a ctx value present iff the spec has "context"');
    lines.push("  with values). When freezing a round, write \"submitted\" into the frozen spec from the payload's");
    lines.push('  mappings[] entry: {cells: assigned, order, adhoc: adhocItems, slotNotes} — cells must carry every');
    lines.push('  matrix key ({src} or {src}@{ctx}) and order every ordered target key.');
    lines.push('');
  }
  if (onlyMapping) {
    lines.push('The rest of the page (decision panel, bridge submit, <style>/<script> structure) passed —');
    lines.push('fix only the mapping sections above, re-write the file, and open it once this gate passes.');
    return lines.join('\n');
  }
  if (structural.length) {
    lines.push('Broken <style> / <script> structure — the page renders unstyled (white, no theme) even though every marker is present:');
    structural.forEach(s => lines.push(`  - ${s.kind}: ${s.why}`));
    lines.push('  Typical cause: the opening <style> line of an older page was pasted INSIDE the new style block.');
    lines.push('  Fix: exactly one <style> per block, closed before the next tag; then verify in the browser that');
    lines.push("  getComputedStyle(document.documentElement).getPropertyValue('--accent-color') is non-empty.");
    lines.push('');
  }
  if (forbidden.length) {
    lines.push('Forbidden clipboard / paste-into-chat submit detected:');
    forbidden.forEach(f => lines.push(`  - ${f.why}`));
    lines.push('');
  }
  if (missing.length) {
    lines.push('Missing mandatory live decision-panel / bridge markers:');
    missing.forEach(m => lines.push(`  - ${m.token} — ${m.why}`));
    lines.push('');
  }
  if (stale.length) {
    lines.push('STALE ENGINE — this page was not generated from the current templates.md, or its engine blocks were damaged afterwards:');
    stale.forEach(e => lines.push(`  - ${e.token} — ${e.why}`));
    lines.push('');
    lines.push('Either its <style>/<script>/panel were lifted from an OLDER concept page (or an');
    lines.push('older plugin), or a later edit (a spliced mock-CSS block, a scratch script whose');
    lines.push('search ran past a block) cut engine rules out. Older pages in docs/concepts/ are');
    lines.push('content references only — the engine');
    lines.push('(panel skeleton, § Layout CSS, § Section Navigation JS, § Claude Connection');
    lines.push('Heartbeat, § Two-Button Submit, § State Persistence) is copied VERBATIM from');
    lines.push('deep-knowledge/templates.md of the plugin running THIS session, every time.');
    lines.push('Re-sync the whole engine from templates.md now (SKILL.md Step 2 § Engine source),');
    lines.push('keep the content sections, re-write the file.');
    lines.push('');
  }
  lines.push('The concept flow requires the LIVE bridge: a persistent decision panel whose');
  lines.push('"Zur nächsten Iteration" / "Mit Feedback implementieren" buttons POST to the');
  lines.push('bridge server (monitored via heartbeat + cron). A "copy the JSON and paste it');
  lines.push('into chat" block is NEVER an acceptable substitute — that is the exact');
  lines.push('regression this gate exists to prevent. The decision panel may never be omitted.');
  lines.push('');
  lines.push('Fix BEFORE opening the page (SKILL.md Step 3):');
  lines.push('  1. Regenerate the HTML with the full decision panel + bridge submit handlers');
  lines.push('     (deep-knowledge/templates.md) and run the 35-pattern check in');
  lines.push('     deep-knowledge/validation-gate.md.');
  lines.push('  2. Remove any clipboard / paste-into-chat fallback entirely.');
  lines.push('  3. Re-write the file; only open it once this gate passes.');
  return lines.join('\n');
}

module.exports = {
  REQUIRED,
  ENGINE,
  ENGINE_DESIGN,
  ENGINE_DOCUMENT,
  ENGINE_FINAL,
  FORBIDDEN,
  isConceptHtml,
  isConceptSourceFile,
  builtPageSource,
  findMissing,
  findStaleEngine,
  findForbidden,
  findStructural,
  findMappingIssues,
  findViewOverlap,
  findChromeCollisions,
  findFinalReportIssues,
  finalReportRegion,
  findDesignAuthoringWarnings,
  findIdenticalFirstScreens,
  findSubpageOnlyRounds,
  findStageIssues,
  SCREEN_SIM_THRESHOLD,
  SUBPAGE_MAX_DIFF,
  SUBPAGE_MIN_SAME_SHARE,
  findFinalReportPlaceholders,
  ENGINE_CLASSES,
  evaluate,
  buildBlockReason,
};
