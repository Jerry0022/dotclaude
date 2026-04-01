#!/usr/bin/env node
/**
 * @script render-card
 * @version 0.2.0
 * @plugin dotclaude-dev-ops
 * @description Deterministic completion card renderer.
 *   Accepts structured JSON on stdin, outputs final markdown card on stdout.
 *   Replaces LLM-based rendering — no interpretation, no drift.
 *
 * Usage:
 *   echo '{"variant":"ready","summary":"Filter refactored",...}' | node scripts/render-card.js
 *
 * Input JSON schema:
 *   variant:   "shipped"|"ready"|"blocked"|"test"|"minimal-start"|"analysis"|"aborted"|"fallback"  (legacy: "research")
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
const { readUsageData, renderUsageMeter } = require('./lib/usage-meter');

// ---------------------------------------------------------------------------
// Variant config table
// ---------------------------------------------------------------------------
const VARIANTS = {
  shipped:         { usage: true,  changes: true,  tests: true,  state: true,  userTest: false },
  ready:           { usage: true,  changes: true,  tests: true,  state: true,  userTest: false },
  blocked:         { usage: true,  changes: true,  tests: true,  state: true,  userTest: false },
  test:            { usage: true,  changes: true,  tests: true,  state: true,  userTest: true  },
  'minimal-start': { usage: false, changes: false, tests: false, state: false, userTest: false },
  analysis:        { usage: true,  changes: true,  tests: false, state: true,  userTest: false },
  research:        { usage: true,  changes: true,  tests: false, state: true,  userTest: false }, // legacy alias → analysis
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
    analysis:        '## 📋 DONE. {info} — READ through',
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
    analysis:        '## 📋 DONE. {info} — LIES dir durch',
    aborted:         '## 🚫 ABORTED. {reason} — Was soll ich VERSUCHEN?',
    fallback:        '## 📋 DONE — Noch was ANDERES?',
  },
};

// ---------------------------------------------------------------------------
// Build-ID
// ---------------------------------------------------------------------------
function getBuildId() {
  try {
    const toplevel = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    return execSync('"' + process.execPath + '" "' + path.join(__dirname, 'build-id.js') + '"', {
      encoding: 'utf8',
      timeout: 10000,
      cwd: toplevel,
    }).trim();
  } catch (err) {
    console.error('[render-card] build-id computation failed:', err.message);
    return 'no-build-id';
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
    if (variant === 'analysis' || variant === 'research') return '\u2796 No changes to repo';
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
  const commitStr = state.commit ? 'git ' + state.commit : 'uncommitted';
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
  } else if (variant === 'research') {
    key = 'analysis'; // legacy alias
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

  // Write card-rendered flag for stop.flow.guard
  try {
    const key = input.session_id || 'latest';
    const flagPath = path.join(os.tmpdir(), 'dotclaude-devops-card-rendered-' + key);
    fs.writeFileSync(flagPath, new Date().toISOString());
  } catch (e) {
    process.stderr.write('render-card: failed to write flag file: ' + e.message + '\n');
  }
});
