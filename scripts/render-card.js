#!/usr/bin/env node
/**
 * @script render-card
 * @version 0.1.0
 * @plugin dotclaude-dev-ops
 * @description Deterministic completion card renderer.
 *   Accepts structured JSON on stdin, outputs final markdown card on stdout.
 *   Replaces LLM-based rendering — no interpretation, no drift.
 *
 * Usage:
 *   echo '{"variant":"ready","summary":"Filter refactored",...}' | node scripts/render-card.js
 *
 * Input JSON schema:
 *   variant:   "shipped"|"ready"|"blocked"|"test"|"minimal-start"|"research"|"aborted"|"fallback"
 *   summary:   string (max ~10 words, user's language)
 *   lang:      "en"|"de" (default "de")
 *   changes:   [{ area, description }]  (max 3)
 *   tests:     [{ method, result }]     (max 3)
 *   state:     { branch, worktree, commit, pushed, pr: {number,title}|null, merged, appStatus }
 *   cta:       { vOld, vNew, bump, version, info, reason, description }
 *   userTest:  ["step 1", "step 2", ...]
 */

const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Variant config table
// ---------------------------------------------------------------------------
const VARIANTS = {
  shipped:         { usage: true,  changes: true,  tests: true,  state: true,  userTest: false },
  ready:           { usage: true,  changes: true,  tests: true,  state: true,  userTest: false },
  blocked:         { usage: true,  changes: true,  tests: true,  state: true,  userTest: false },
  test:            { usage: true,  changes: true,  tests: true,  state: true,  userTest: true  },
  'minimal-start': { usage: false, changes: false, tests: false, state: false, userTest: false },
  research:        { usage: true,  changes: true,  tests: false, state: true,  userTest: false },
  aborted:         { usage: true,  changes: true,  tests: false, state: true,  userTest: false },
  fallback:        { usage: true,  changes: true,  tests: false, state: true,  userTest: false },
};

// ---------------------------------------------------------------------------
// CTA templates  —  {STATUS} stays EN, sentence after — translated
// ---------------------------------------------------------------------------
const CTA = {
  en: {
    'shipped-bump':  '## 🚀 SHIPPED. {vOld} → {vNew} ({bump}) — RELAX, all done',
    'shipped-plain': '## 🚀 SHIPPED. {version} — RELAX, all done',
    ready:           '## 📦 READY. {info} — SHIP or CHANGE?',
    blocked:         '## ⛔ BLOCKED. {reason} — FIX or SKIP?',
    test:            '## 🧪 DONE. {info} — SHIP after your TEST?',
    'minimal-start': '## 🧪 STARTED. {description} — HAVE FUN',
    research:        '## 📋 DONE. {info} — READ through',
    aborted:         '## 🚫 ABORTED. {reason} — What should I TRY?',
    fallback:        '## 📋 DONE — Anything ELSE?',
  },
  de: {
    'shipped-bump':  '## 🚀 SHIPPED. {vOld} → {vNew} ({bump}) — LEHN dich zurueck, alles erledigt',
    'shipped-plain': '## 🚀 SHIPPED. {version} — LEHN dich zurueck, alles erledigt',
    ready:           '## 📦 READY. {info} — SHIP oder AENDERN?',
    blocked:         '## ⛔ BLOCKED. {reason} — FIX oder SKIP?',
    test:            '## 🧪 DONE. {info} — SHIP nach deinem TEST?',
    'minimal-start': '## 🧪 STARTED. {description} — VIEL SPASS',
    research:        '## 📋 DONE. {info} — LIES dir durch',
    aborted:         '## 🚫 ABORTED. {reason} — Was soll ich VERSUCHEN?',
    fallback:        '## 📋 DONE — Noch was ANDERES?',
  },
};

// ---------------------------------------------------------------------------
// Usage meter rendering
// ---------------------------------------------------------------------------
function readUsageData() {
  const candidates = [
    path.join(os.homedir(), '.claude', 'usage-live.json'),
    path.join(os.homedir(), '.claude', 'scripts', 'usage-live.json'),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
  }
  return null;
}

function renderBar(pct) {
  const filled = Math.round((pct / 100) * 12);
  const empty = 12 - filled;
  return '\u2593'.repeat(filled) + '\u2591'.repeat(empty);
}

function formatDelta(delta) {
  if (delta == null || isNaN(delta)) delta = 0;
  const sign = '+' + delta;
  let marker;
  if (delta >= 6)      marker = '!!';
  else if (delta >= 2) marker = '! ';
  else                 marker = '  ';
  const inner = (sign + '% ' + marker).padEnd(6, ' ');
  return '(' + inner + ')';
}

function formatResetShort(minutes) {
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    return d + 'd ' + h + 'h';
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + 'h ' + m + 'm';
}

function renderUsageMeter(usageData, delta5h, deltaWk) {
  if (!usageData || !usageData.session) {
    return '```\n\u26a0 Usage data unavailable \u2014 monitoring issue\n```';
  }

  const s = usageData.session;
  const w = usageData.weekly;

  const lines = [];

  // --- 5h window ---
  const bar5h = renderBar(s.pct);
  const pct5h = String(s.pct).padStart(3, ' ') + '%';
  const delta5hStr = formatDelta(delta5h || 0);
  const reset5h = formatResetShort(s.resetInMinutes);
  const elapsed5hPct = ((300 - s.resetInMinutes) / 300) * 100;
  const arrowPos5h = Math.round(Math.max(0, Math.min(100, elapsed5hPct)) / 100 * 12);
  const pace5h = s.pct - elapsed5hPct;
  const warn5h = pace5h > 10 ? '  \u26a0 Sonnet or new session' : '';

  lines.push('5h  ' + bar5h + '   ' + pct5h + ' ' + delta5hStr + '  \u00b7 Reset ' + reset5h + warn5h);
  lines.push(' '.repeat(4 + arrowPos5h) + '\u2191');
  lines.push('');

  // --- Wk window ---
  if (w) {
    const barWk = renderBar(w.pct);
    const pctWk = String(w.pct).padStart(3, ' ') + '%';
    const deltaWkStr = formatDelta(deltaWk || 0);
    const resetWk = formatResetShort(w.resetInMinutes);
    const elapsedWkPct = ((10080 - w.resetInMinutes) / 10080) * 100;
    const arrowPosWk = Math.round(Math.max(0, Math.min(100, elapsedWkPct)) / 100 * 12);
    const paceWk = w.pct - elapsedWkPct;
    const warnWk = paceWk > 10 ? '  \u26a0 Sonnet or new session' : '';

    lines.push('Wk  ' + barWk + '   ' + pctWk + ' ' + deltaWkStr + '  \u00b7 Reset ' + resetWk + warnWk);
    lines.push(' '.repeat(4 + arrowPosWk) + '\u2191');
  }

  return '```\n' + lines.join('\n') + '\n```';
}

// ---------------------------------------------------------------------------
// Build-ID
// ---------------------------------------------------------------------------
function getBuildId() {
  try {
    return execSync('"' + process.execPath + '" "' + path.join(__dirname, 'build-id.js') + '"', {
      encoding: 'utf8',
      timeout: 10000,
    }).trim();
  } catch {
    return '0000000';
  }
}

// ---------------------------------------------------------------------------
// Block renderers
// ---------------------------------------------------------------------------
function renderTitle(summary, buildId) {
  return '## \u2728\u2728\u2728 ' + summary + ' \u00b7 ' + buildId + ' \u2728\u2728\u2728';
}

function renderChanges(changes) {
  if (!changes || changes.length === 0) return '';
  const items = changes.slice(0, 3).map(c => '* ' + c.area + ' \u2192 ' + c.description);
  return '**Changes**\n' + items.join('\n');
}

function renderTests(tests) {
  if (!tests || tests.length === 0) return '';
  const items = tests.slice(0, 3).map(t => '* ' + t.method + ' \u2192 ' + t.result);
  return '**Tests**\n' + items.join('\n');
}

function renderState(state, variant) {
  if (!state) {
    if (variant === 'research') return '\u2796 No changes to repo';
    return '';
  }

  // Icon
  let icon;
  if (state.merged)                          icon = '\u2705';
  else if (state.appStatus === 'running')    icon = '\ud83d\udfe2';
  else if (state.appStatus === 'not-started') icon = '\ud83d\udfe1';
  else if (state.branch && state.branch !== 'main') icon = '\ud83d\udd00';
  else if (state.pushed)                     icon = '\u2705';
  else                                       icon = '\u2796';

  // Fields
  const branch = state.branch || 'main';
  const branchStr = branch + (state.worktree ? ' (worktree)' : '');
  const commitStr = state.commit || 'uncommitted';
  const pushStr = state.pushed ? 'pushed' : 'not pushed';

  let prStr = 'no PR';
  if (state.pr) prStr = 'PR #' + state.pr.number + ' "' + state.pr.title + '"';

  let mergeStr = 'not merged';
  if (state.merged) mergeStr = 'merged \u2192 ' + state.merged;

  let line = icon + ' `' + branchStr + '` \u00b7 ' + commitStr + ' \u00b7 ' + pushStr + ' \u00b7 ' + prStr + ' \u00b7 ' + mergeStr;

  if (state.appStatus === 'running')     line += ' \u00b7 app running';
  if (state.appStatus === 'not-started') line += ' \u00b7 app not started';

  return line;
}

function renderUserTest(steps) {
  if (!steps || steps.length === 0) return '';
  const items = steps.map((s, i) => (i + 1) + '. ' + s);
  return '**Please test**\n' + items.join('\n');
}

function renderCTA(variant, cta, lang) {
  const templates = CTA[lang] || CTA.de;
  cta = cta || {};

  let key;
  if (variant === 'shipped') {
    key = (cta.vOld && cta.vNew) ? 'shipped-bump' : 'shipped-plain';
  } else {
    key = variant;
  }

  let tpl = templates[key] || templates.fallback;

  // Replace all {placeholders}
  tpl = tpl.replace(/\{(\w+)\}/g, (_, k) => cta[k] || '');

  return tpl;
}

// ---------------------------------------------------------------------------
// Main — assemble card
// ---------------------------------------------------------------------------
function renderCard(input) {
  const variant = input.variant || 'fallback';
  const config = VARIANTS[variant] || VARIANTS.fallback;
  const lang = input.lang || 'de';

  const buildId = getBuildId();
  const usageData = readUsageData();

  const parts = [];

  // Block A — What was done
  if (config.usage) {
    parts.push(renderUsageMeter(usageData, input.delta5h, input.deltaWk));
    parts.push('');
    parts.push('---');
  } else {
    parts.push('---');
  }
  parts.push('');

  parts.push(renderTitle(input.summary || 'Task completed', buildId));
  parts.push('');

  if (config.changes) {
    const changesBlock = renderChanges(input.changes);
    if (changesBlock) {
      parts.push(changesBlock);
      parts.push('');
    }
  }

  if (config.tests) {
    const testsBlock = renderTests(input.tests);
    if (testsBlock) {
      parts.push(testsBlock);
      parts.push('');
    }
  }

  // Block B — End state
  if (config.state) {
    const stateLine = renderState(input.state, variant);
    if (stateLine) {
      parts.push(stateLine);
      parts.push('');
    }
  }

  // Block C — What happens now
  if (config.userTest) {
    const testBlock = renderUserTest(input.userTest);
    if (testBlock) {
      parts.push(testBlock);
      parts.push('');
    }
  }

  parts.push(renderCTA(variant, input.cta, lang));
  parts.push('');

  // Closing fence
  parts.push('---');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(inputData);
  } catch (e) {
    process.stderr.write('render-card: invalid JSON input: ' + e.message + '\n');
    process.exit(1);
  }

  if (!input.variant || !VARIANTS[input.variant]) {
    process.stderr.write('render-card: unknown variant "' + input.variant + '"\n');
    process.stderr.write('Valid variants: ' + Object.keys(VARIANTS).join(', ') + '\n');
    process.exit(1);
  }

  process.stdout.write(renderCard(input));
});
