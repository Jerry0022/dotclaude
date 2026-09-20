#!/usr/bin/env node
/**
 * @hook post.concept.gate
 * @version 0.2.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Write|Edit|NotebookEdit
 * @description Deterministic backstop for concept pages. After a
 *   concept HTML is written, verify it carries the live decision panel +
 *   bridge-submit markers, contains NO clipboard / paste-into-chat
 *   fallback, and has sound <style>/<script> structure (no nested or
 *   unclosed block — the "white, unthemed page" regression, #346), and that
 *   every information-mapping spec normalises the way the page's engine
 *   normalises it (frozen rounds carry their `submitted` state). Blocks
 *   (exit 2) with actionable feedback when the page is invalid, so the
 *   regression survives only until the next regenerate — never until the
 *   user has to copy a JSON by hand.
 *
 *   Scope: only fires on concept HTML (the `docs/concepts/` path or a concept
 *   content signature). Non-concept files pass through untouched. This is a
 *   focused gate for five deterministic failure classes — (A) missing live
 *   decision-panel / bridge markers, (B) a forbidden clipboard fallback,
 *   broken <style>/<script> structure, unsound mapping specs (ids, shapes,
 *   references, frozen `submitted`), and a decision / comparison view that
 *   lists the round's own designs as alternatives (P31 — the dock already
 *   asks which design wins), and (F) a STALE ENGINE — a page whose panel /
 *   JS were lifted from an older concept page instead of the current
 *   templates.md (the engine-currency markers) — not the full 35-pattern
 *   validation-gate.md sweep (that stays a Step-2 task).
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { evaluate, buildBlockReason, isConceptHtml } = require('../lib/concept-gate');

function targetPath(toolName, input) {
  if (!input) return null;
  if (toolName === 'Edit' || toolName === 'Write') return input.file_path || null;
  if (toolName === 'NotebookEdit') return input.notebook_path || null;
  return null;
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  if (!['Edit', 'Write', 'NotebookEdit'].includes(toolName)) process.exit(0);

  const file = targetPath(toolName, hook.tool_input || {});
  if (!file || !/\.html?$/i.test(file)) process.exit(0); // fast path: only HTML

  // Read the on-disk result (already written by the tool). Fall back to the
  // Write payload; if neither is readable we cannot validate — pass through.
  let html = null;
  try { html = fs.readFileSync(file, 'utf8'); }
  catch { html = (hook.tool_input && hook.tool_input.content) || null; }
  if (html == null) process.exit(0);

  if (!isConceptHtml(file, html)) process.exit(0);

  const { ok, missing, forbidden, structural, mapping, overlap, stale } = evaluate(file, html);
  if (ok) process.exit(0);

  process.stderr.write(buildBlockReason(file, missing, forbidden, structural, mapping, overlap, stale) + '\n');
  process.exit(2);
});
