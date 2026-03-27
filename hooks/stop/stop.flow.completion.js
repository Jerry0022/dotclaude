#!/usr/bin/env node
/**
 * @hook stop.flow.completion
 * @version 0.4.0
 * @event Stop
 * @plugin dotclaude-dev-ops
 * @description Enforce the full completion flow when Claude finishes a response.
 *   This is the MANDATORY gate — every completed response must end with the
 *   completion card. The hook injects the full template structure and variant
 *   selection rules so Claude cannot ignore or forget them.
 *
 *   Flow:
 *   1. Visual verification (if changes affect visible output)
 *   2. Issue status update (if tracked issue exists)
 *   3. Recommend /ship (if 5+ code edits)
 *   4. Render completion card (ALWAYS — correct variant, filled with real data)
 */

const fs = require('fs');
const { readSessionFile } = require('../lib/session-id');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { hook = {}; }

  // Uses readSessionFile with glob fallback for session_id mismatches (issue #10)
  let editCount = 0;
  const counterResult = readSessionFile('dotclaude-devops-edits', hook.session_id);
  if (counterResult) {
    editCount = parseInt(counterResult.content, 10) || 0;
  }

  const lines = [];

  // --- Step 1: Pre-completion checks ---
  lines.push(
    'MANDATORY COMPLETION FLOW — Execute these steps before finishing:',
    '',
    '1. VISUAL VERIFICATION: If changes affect visible output (UI, CLI, logs),',
    '   verify per deep-knowledge/visual-verification.md before proceeding.',
    '',
    '2. ISSUE STATUS: If a tracked issue exists for this work, prepare to update it.',
    '',
  );

  // --- Step 2: Ship recommendation ---
  if (editCount >= 5) {
    lines.push(
      `3. SHIP RECOMMENDATION: Session has ${editCount} code edits.`,
      '   Recommend /ship unless the user is clearly still iterating.',
      '',
    );
  }

  // --- Step 3: Completion card enforcement ---
  lines.push(
    '4. COMPLETION CARD — MANDATORY. The response MUST end with a completion card.',
    '   This is non-negotiable. Every completed task gets a card. No exceptions.',
    '',
    '   STRUCTURE (render exactly this, filled with real data):',
    '   ```',
    '   ---',
    '',
    '   ## <status-icon> <build-id-or-label> · <summary, max ~10 words>',
    '',
    '   **Changes**',
    '   * <area -> what changed>',
    '',
    '   **Tests**                              (omit for pure docs changes)',
    '   * <what was tested and result>',
    '',
    '   **Bitte testen**                       (only for Test variants 6a/6b)',
    '   1. <step-by-step test instructions>',
    '',
    '   **Branch**                             (include when branch exists)',
    '   * `<branch-name>` -> <status>',
    '',
    '   ## <status-icon> <status-text>',
    '',
    '   ---',
    '   ```',
    '',
    '   VARIANT SELECTION (pick the correct one):',
    '   | # | When | Status line |',
    '   |---|------|-------------|',
    '   | 1 | After PR merge | ## \ud83d\ude80 Shipped · PR #N · vOLD -> vNEW (bump) |',
    '   | 2 | After direct push | ## \ud83d\ude80 Shipped · Direct Push · vOLD -> vNEW (bump) |',
    '   | 3 | Code complete, ready | ## \ud83d\udce6 Ready \u2014 Soll ich SHIPPEN? |',
    '   | 4 | Blocked by error | ## \u26d4 Blocked · <reason> \u2014 Soll ich FIXEN? |',
    '   | 5 | Non-code complete | ## \ud83d\udce6 Ready \u2014 Soll ich SHIPPEN? |',
    '   | 6a | App started, needs test | ## \ud83e\uddea App gestartet \u2014 Bitte TESTEN \u2014 Soll ich nach Test SHIPPEN? |',
    '   | 6b | App not started | ## \ud83e\uddea Bitte App STARTEN und TESTEN \u2014 Soll ich nach Test SHIPPEN? |',
    '   | 7 | App started, no changes | ## \ud83e\uddea <build-id> · App gestartet |',
    '',
    '   RULES:',
    '   - Build-ID via `node scripts/build-id.js` (for code changes)',
    '   - Without build-ID (docs/config): use "Erledigt" instead',
    '   - Summary in user language (German), max ~10 words, factual',
    '   - No preamble before opening ---. No text after closing ---.',
    '   - Section headers use **bold**, not markdown headings',
    '   - Bullet items use *, plain text',
    '   - Omit sections that do not apply',
    '',
    '   DO NOT skip the completion card. DO NOT say "Hier die Card:" before it.',
    '   The opening --- starts immediately at the end of your response content.',
  );

  process.stdout.write(lines.join('\n') + '\n');
});
