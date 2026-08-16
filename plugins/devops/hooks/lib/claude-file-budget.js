#!/usr/bin/env node
/**
 * @module claude-file-budget
 * @version 0.1.0
 * @description Context-budget classifier for Claude configuration files.
 *
 *   Every file Claude loads as context costs tokens in every session that
 *   touches it. `deep-knowledge/content-conventions.md` states the budgets;
 *   nothing measured them. The one check that existed lived in a skill
 *   (`/claude-lint`) that had to be *remembered* — so the budget held only
 *   when someone thought to invoke it, which in practice was never.
 *
 *   This module is the measurement half: pure functions, no I/O, so the
 *   thresholds are testable and the hook wrapper stays trivial.
 *
 *   Two design rules keep it from becoming noise:
 *
 *     1. **Growth, not size.** A file that is already over budget and is not
 *        getting worse says nothing. Only an edit that pushes it further over
 *        reports. "You are making it worse" is actionable in the moment;
 *        "this file is big" is not, and would fire on every unrelated edit.
 *     2. **Generated files are exempt.** A file carrying a generator marker in
 *        its head is not hand-maintained, so a size complaint has no addressee.
 */

const path = require('path');

/**
 * Line budgets per file kind. `warn` is the re-route trigger from
 * content-conventions.md; `critical` is where the file stops being readable
 * as one unit. `critical: null` = no hard ceiling, only the soft trigger.
 */
const BUDGETS = {
  'claude-md': {
    label: 'CLAUDE.md',
    warn: 25,
    critical: 50,
    remedy:
      'Extract the bulk to `<project>/.claude/deep-knowledge/<topic>.md` and leave a\n' +
      '  one-line pointer. CLAUDE.md is an index, not documentation.',
  },
  skill: {
    label: 'SKILL.md',
    warn: 250,
    critical: 500,
    remedy:
      'Move procedure to the skill\'s sibling `deep-knowledge/<topic>.md` and reference\n' +
      '  it from the relevant Step. Keep the decision (which branch, which target) in\n' +
      '  SKILL.md — execution detail is what should leave.',
  },
  agent: {
    label: 'agent definition',
    warn: 150,
    critical: 300,
    remedy:
      'An agent prompt is loaded whole on every dispatch. Move reference material to\n' +
      '  `{PLUGIN_ROOT}/deep-knowledge/<topic>.md` and point at it by name.',
  },
  reference: {
    label: 'reference.md',
    warn: 200,
    critical: 400,
    remedy:
      'Split by topic into a sibling `deep-knowledge/` directory and leave pointers.',
  },
  'deep-knowledge': {
    label: 'deep-knowledge',
    warn: 600,
    critical: null,
    remedy:
      'Depth is the point here, so there is no hard ceiling — but a doc read in full\n' +
      '  costs its whole length every time. Split by topic and regenerate the index:\n' +
      '  `node {PLUGIN_ROOT}/scripts/gen-dk-index.js <dir>`.',
  },
};

/** Generator markers. Only honoured near the head — the convention for
 *  generated files — so prose *about* generated files is not exempted. */
const GENERATED_MARKERS = /AUTO-GENERATED|DO NOT EDIT|@generated/i;
const GENERATED_HEAD_LINES = 5;

function segmentsOf(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

/**
 * Which budget applies to this path, or null when the file is not Claude
 * context. Deliberately a whitelist: a catch-all over `.claude/` would drag in
 * settings, generated maps, and caches, and the false positives would train
 * everyone to ignore the hook.
 */
function classify(filePath) {
  const seg = segmentsOf(filePath);
  if (!seg.length) return null;

  const base = seg[seg.length - 1];
  const parent = seg[seg.length - 2] || '';
  const grandparent = seg[seg.length - 3] || '';

  // CLAUDE.md counts wherever it sits — repo root, `.claude/`, or `~/.claude/`.
  if (base === 'CLAUDE.md') return 'claude-md';
  if (!base.toLowerCase().endsWith('.md')) return null;

  if (parent === 'deep-knowledge') return 'deep-knowledge';
  // A SKILL.md is a skill regardless of where the tree is rooted.
  if (base === 'SKILL.md') return 'skill';
  if (parent === 'agents') return 'agent';
  if (base === 'reference.md' && grandparent === 'skills') return 'reference';

  return null;
}

/** Visible lines, matching `wc -l` for files that end in a newline. */
function countLines(content) {
  if (content == null) return 0;
  const s = String(content);
  if (s === '') return 0;
  const n = s.split('\n').length;
  return s.endsWith('\n') ? n - 1 : n;
}

function isGenerated(content) {
  if (content == null) return false;
  const head = String(content).split('\n').slice(0, GENERATED_HEAD_LINES).join('\n');
  return GENERATED_MARKERS.test(head);
}

/**
 * Line delta an Edit produced, or null when the magnitude is unknowable from
 * the payload. Null means "assume growth" — a Write replaces the whole file,
 * and silence there would miss exactly the case where a file arrives bloated.
 */
function editDelta(toolName, toolInput) {
  if (toolName !== 'Edit') return null;
  const input = toolInput || {};
  const before = input.old_string;
  const after = input.new_string;
  if (typeof before !== 'string' || typeof after !== 'string') return null;

  const delta = countLines(after) - countLines(before);
  // `replace_all` applies the delta an unknown number of times. Non-positive
  // stays non-positive however often it repeats; positive is growth of
  // unknown size, which is the `null` case.
  if (input.replace_all) return delta > 0 ? null : 0;
  return delta;
}

/**
 * @returns {{kind, label, lines, budget, critical, delta, grew, severity, silent, reason}}
 *   `silent: true` means the caller must produce no output at all.
 */
function evaluate({ file, content, delta = null }) {
  const kind = classify(file);
  if (!kind) {
    return { kind: null, severity: 'ok', silent: true, reason: 'not-claude-context' };
  }
  if (isGenerated(content)) {
    return { kind, severity: 'ok', silent: true, reason: 'generated' };
  }

  const budget = BUDGETS[kind];
  const lines = countLines(content);

  let severity = 'ok';
  if (budget.critical != null && lines > budget.critical) severity = 'critical';
  else if (lines > budget.warn) severity = 'warn';

  const grew = delta == null || delta > 0;
  const silent = severity === 'ok' || !grew;

  return {
    kind,
    label: budget.label,
    lines,
    budget: budget.warn,
    critical: budget.critical,
    delta,
    grew,
    severity,
    silent,
    reason: severity === 'ok' ? 'within-budget' : grew ? 'over-budget' : 'not-growing',
  };
}

/** One-line summary for the user-facing (stderr) channel. */
function buildSummary(file, result) {
  const growth = result.delta == null ? 'full rewrite' : `+${result.delta} this edit`;
  const tag = result.severity === 'critical' ? 'CRITICAL' : 'WARNING';
  return (
    `[claude-file-budget] ${tag} — ${path.basename(file)} is ${result.lines} lines ` +
    `(budget ${result.budget}, ${growth})`
  );
}

/** Instruction for Claude's context (stdout). Names the file, the overage,
 *  where the bulk belongs, and the norm — enough to act without a lookup. */
function buildInstruction(file, result) {
  const budget = BUDGETS[result.kind];
  const growth =
    result.delta == null ? 'got rewritten in full' : `grew by ${result.delta} lines`;
  const ceiling =
    result.severity === 'critical'
      ? ` — past the ${result.critical}-line ceiling where it stops working as one document`
      : '';

  return [
    `[claude-file-budget] ${file}`,
    `${result.label} is now ${result.lines} lines against a ${result.budget}-line budget, ` +
      `and just ${growth}${ceiling}.`,
    '',
    `  ${budget.remedy}`,
    '',
    'Budgets, extraction categories, and the fix procedure:',
    '  {PLUGIN_ROOT}/deep-knowledge/content-conventions.md',
    '',
    'Do this now if the edit you just made is what pushed it over, and the extraction ' +
      'is mechanical. Otherwise say so in your response and leave it — do not silently ' +
      'drop the finding, and do not restructure unrelated content to make room.',
  ].join('\n');
}

module.exports = {
  BUDGETS,
  classify,
  countLines,
  isGenerated,
  editDelta,
  evaluate,
  buildSummary,
  buildInstruction,
};
