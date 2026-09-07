#!/usr/bin/env node
/**
 * @module concept-gate
 * @description Deterministic validator for concept HTML pages.
 *
 *   Backstop for two recurring regressions where Claude only "half-uses" the
 *   concept skill:
 *     A) the page bakes in a "copy the JSON, paste it into chat" submit
 *        instead of the live bridge — a clipboard fallback that defeats the
 *        whole monitoring loop.
 *     B) the page ships with no live decision panel at all.
 *
 *   This is a focused gate, NOT a re-implementation of the full 35-pattern
 *   validation-gate.md. It checks only the markers whose absence equals
 *   failure mode A or B, plus the forbidden clipboard/paste-to-chat anti-
 *   pattern. The full pattern sweep stays Claude's Step-2 responsibility.
 */

const path = require('path');

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
];

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

/**
 * Full evaluation for a written file.
 * @returns {{applicable:boolean, ok:boolean, missing:Array, forbidden:Array, structural:Array}}
 */
function evaluate(filePath, html) {
  if (!isConceptHtml(filePath, html)) {
    return { applicable: false, ok: true, missing: [], forbidden: [], structural: [] };
  }
  const missing = findMissing(html);
  const forbidden = findForbidden(html);
  const structural = findStructural(html);
  return {
    applicable: true,
    ok: missing.length === 0 && forbidden.length === 0 && structural.length === 0,
    missing,
    forbidden,
    structural,
  };
}

/** Build the blocking feedback shown to Claude (stderr, exit 2). */
function buildBlockReason(filePath, missing, forbidden, structural) {
  missing = missing || [];
  forbidden = forbidden || [];
  structural = structural || [];
  const lines = [];
  lines.push(`BLOCKED: "${path.basename(filePath || 'concept.html')}" is not a valid live-bridge concept page.`);
  lines.push('');
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
  FORBIDDEN,
  isConceptHtml,
  findMissing,
  findForbidden,
  findStructural,
  evaluate,
  buildBlockReason,
};
