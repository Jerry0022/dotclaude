#!/usr/bin/env node
/**
 * @hook prompt.knowledge.dispatch
 * @version 0.8.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description On-demand deep-knowledge injection based on prompt keywords.
 *   Matches user prompt against a topic keyword map and injects the relevant
 *   deep-knowledge file content as additionalContext. Each file is injected
 *   at most once per session (tracked via session-scoped temp files).
 *   Always-on docs (ss.knowledge.index ALWAYS_ON, e.g. agent-proactivity.md)
 *   are already in context from SessionStart — never list them in TOPIC_MAP.
 *   The docs of the four retired skills (readme-standards, graphify, usage,
 *   strict — lib/knowledge-pointers.js) get a one-line pointer instead of
 *   their body, also once per session.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { sessionFile, writeSessionFile } = require('../lib/session-id');
const { ensureLocale } = require('../lib/locale');
const { readBudget, maybeRefreshUsage, nudgeSuffix, budgetLine } = require('../lib/budget');
const { readDelegation } = require('../lib/delegation');
const { matchPointers, legacyOverrides, pointerLine } = require('../lib/knowledge-pointers');

/**
 * Topic-to-file keyword map.
 * Each entry: { file, patterns (RegExp[]), specificity }
 * specificity: higher = more specific pattern, prioritized when cap applies.
 * Patterns are tested against the lowercased user prompt.
 */
const TOPIC_MAP = [
  {
    file: 'agent-collaboration.md',
    specificity: 2,
    patterns: [/\bagent.*collaborat/i, /\bmulti.?role/i, /\bagent.*zusammen/i],
  },
  {
    file: 'agent-conventions.md',
    specificity: 2,
    patterns: [/\bagent.*naming/i, /\bagent.*convention/i, /\bagent.*format/i],
  },
  {
    file: 'browser-tool-strategy.md',
    specificity: 2,
    patterns: [/\bbrowser.*tool/i, /\bchrome.*mcp/i, /\bedge.*(?:credo|browser)/i, /\bplaywright/i],
  },
  {
    file: 'claude-directory-structure.md',
    specificity: 2,
    patterns: [/\b\.claude.*structure/i, /\bdirectory.*convention/i, /\bclaude.*dir/i],
  },
  {
    file: 'code-defaults.md',
    specificity: 2,
    patterns: [/\bcode.*default/i, /\bcoding.*convention/i, /\bstyle.*guide/i],
  },
  {
    file: 'ui-defaults.md',
    specificity: 2,
    patterns: [/\bui.*(?:default|rule|convention|regel)/i, /\btooltip/i, /\bdropdown/i, /\bhotkey/i, /\bshortcut/i, /\btastenk/i, /\bkeyboard.*(?:nav|access|shortcut)/i, /\bdesign.*(?:rule|regel|check)/i],
  },
  {
    file: 'codex-integration.md',
    specificity: 1,
    patterns: [/\bcodex/i, /\bgpt.?5/i],
  },
  {
    file: 'decision-format.md',
    specificity: 2,
    patterns: [/\bdecision.*format/i, /\boption.*present/i, /\bentscheidung.*format/i],
  },
  {
    file: 'desktop-testing.md',
    specificity: 2,
    patterns: [/\bdesktop.*test/i, /\bcomputer.?use.*test/i, /\bvisual.*ui.*test/i],
  },
  {
    file: 'fact-verification.md',
    specificity: 2,
    patterns: [/\bfact.*verif/i, /\bfakten.*pr[uü]f/i, /\bclaim.*check/i],
  },
  {
    file: 'git-hygiene.md',
    specificity: 2,
    patterns: [/\bgit.*hygien/i, /\bbranch.*clean/i, /\bcommit.*convention/i],
  },
  {
    file: 'plugin-behavior.md',
    specificity: 1,
    patterns: [/\bplugin.*behav/i, /\bplugin.*regel/i, /\bplugin.*rule/i],
  },
  {
    file: 'skill-extension-guide.md',
    specificity: 2,
    patterns: [/\bskill.*extend/i, /\bskill.*customiz/i, /\bextension.*guide/i],
  },
  {
    file: 'test-strategy.md',
    specificity: 2,
    patterns: [/\btest.*strateg/i, /\bwann.*test/i, /\btest.*ausf[uü]hr/i],
  },
  {
    file: 'tool-selection.md',
    specificity: 2,
    patterns: [/\btool.*select/i, /\btool.*wahl/i, /\bwindows.*tool/i],
  },
  {
    file: 'visual-verification.md',
    specificity: 2,
    patterns: [/\bvisual.*verif/i, /\bscreenshot.*check/i, /\bvisuell.*pr[uü]f/i],
  },
];

// Per-prompt delegation nudge (see compose step 4). Mirrors the tier table in
// deep-knowledge/agent-proactivity.md — keep the two in sync.
// No slash-command spelling here: the same text is appended to eval prompts,
// where prompt.skill.enforce would read "/auto-agents" as a user invocation.
const DELEGATION_NUDGE =
  '[delegation-policy] Classify before the first tool call: Inline (≤~5 files, Q&A, quick fix) · ' +
  '1 background agent (web pages → devops:research; >~10-file sweep → Explore; full tests → devops:qa; ' +
  'high-stakes diff → devops:redteam; "should we X?" trade-off → devops:po, plus devops:research when facts need checking) · ' +
  '2–3 parallel only for two analysis lenses (parallel implementers → offer) · ' +
  'Complex → offer the auto-agents skill, never auto-start. Hard stop (request narrowed: "just/quick/nur/schnell/keine Agents") → Inline; hard go ("agents/full") → as designed.';

// Kill-switch variants (lib/delegation.js). `off` emits no nudge at all —
// the SessionStart line already says so and every copy would only tempt.
const ASK_NUDGE =
  '[delegation-policy: ask] No proactive spawn: when a tier above Inline applies, offer it in one sentence ' +
  '(which agent, why) and run it only on a yes. Hard go ("agents/full") spawns directly; explicit run-* skills are unaffected.';

const NUDGE_MIN_CHARS = 40;

/** True when an AFK run has armed the lockout sentinel for this project. */
function lockoutArmed(cwd) {
  try {
    const { readLockout } = require('../../scripts/autonomous-lockout');
    return !!readLockout(cwd || process.cwd());
  } catch { return false; }
}

// Hard limits: max 2 files and 8KB total payload per prompt
const MAX_INJECT_PER_PROMPT = 2;
const MAX_INJECT_BYTES = 8192;

// Trigger glossary cap: hard limit on the per-prompt injected aliases payload
// so we never blow context as more skills add `triggers.<lang>.txt` files.
const MAX_TRIGGER_GLOSSARY_BYTES = 1024;

/**
 * Scan all skills for a `triggers.<lang>.txt` file and build a one-line
 * alias glossary. Returns the formatted string or '' when nothing is found.
 * Format: `[skill-aliases/<lang>] skill-a: phrase1, phrase2 | skill-b: …`
 */
function loadTriggerGlossary(pluginRoot, lang) {
  const skillsDir = path.join(pluginRoot, 'skills');
  let entries;
  try { entries = fs.readdirSync(skillsDir, { withFileTypes: true }); }
  catch { return ''; }

  const aliases = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const triggerFile = path.join(skillsDir, entry.name, `triggers.${lang}.txt`);
    let raw;
    try { raw = fs.readFileSync(triggerFile, 'utf8'); }
    catch { continue; }
    const phrases = raw
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    if (phrases.length === 0) continue;
    aliases.push(`${entry.name}: ${phrases.join(', ')}`);
  }
  if (aliases.length === 0) return '';

  let payload = `[skill-aliases/${lang}] ${aliases.join(' | ')}`;
  if (Buffer.byteLength(payload, 'utf8') > MAX_TRIGGER_GLOSSARY_BYTES) {
    payload = payload.slice(0, MAX_TRIGGER_GLOSSARY_BYTES - 3) + '...';
  }
  return payload;
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  // A collected prompt produces no turn — marking a doc "already injected" here
  // would burn the one-shot for a prompt nobody ever sees. See willBeCollected().
  try { if (require('../lib/batch-state').willBeCollected(hook)) process.exit(0); }
  catch { /* fail open */ }

  // Claude Code delivers the prompt as `prompt`; `user_message`/`message` are
  // the legacy names the tests and older runtimes used. Reading only the legacy
  // pair yielded '' on every real prompt — no nudge, no budget suffix, no
  // locale, no DK dispatch, for months (audit 2026-09-19).
  const rawMessage = hook.prompt || hook.user_message || hook.message || '';
  const userMessage = rawMessage.toLowerCase().trim();
  if (!userMessage || userMessage.length < 5) process.exit(0);

  const sessionId = hook.session_id || 'unknown';

  // Detect + cache UI locale. First prompt sets it; a later prompt with a
  // clear language signal switches it, so all hooks/skills follow the
  // language the user writes in now (short "ok"/"ja" prompts keep the cache).
  const { lang, isFresh } = ensureLocale(sessionId, rawMessage);

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
    || path.resolve(__dirname, '..', '..');
  const dkDir = path.join(pluginRoot, 'deep-knowledge');

  // Find matching topics, sort by specificity (higher = more relevant)
  const matched = TOPIC_MAP
    .filter(t => t.patterns.some(re => re.test(userMessage)))
    .sort((a, b) => b.specificity - a.specificity);

  // Session-scoped dedup via session-id lib (atomic writes, fallback on mismatch)
  const markerFile = sessionFile('dotclaude-dk-injected', sessionId);

  let injected = new Set();
  try {
    const raw = fs.readFileSync(markerFile, 'utf8');
    injected = new Set(raw.split('\n').filter(Boolean));
  } catch {}

  // Filter out already-injected, apply count cap
  const candidates = matched.filter(t => !injected.has(t.file));

  // Read file contents with byte budget
  const sections = [];
  let totalBytes = 0;
  for (const topic of candidates) {
    if (sections.length >= MAX_INJECT_PER_PROMPT) break;
    const filePath = path.join(dkDir, topic.file);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      const entryBytes = Buffer.byteLength(content, 'utf8');
      if (totalBytes + entryBytes > MAX_INJECT_BYTES && sections.length > 0) break;
      sections.push(`--- deep-knowledge/${topic.file} ---\n${content}`);
      totalBytes += entryBytes;
      injected.add(topic.file);
    } catch {}
  }

  // Pointers for the retired skills' docs (one line each, not the body).
  const pointers = [];
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    for (const hit of matchPointers(rawMessage)) {
      if (injected.has(hit.file)) continue;
      const overrides = hit.extension ? legacyOverrides(hit.legacy, { cwd: hook.cwd, home }) : [];
      pointers.push(pointerLine(hit, dkDir, overrides));
      injected.add(hit.file);
    }
  } catch { /* a pointer is never worth a failed prompt */ }

  // Persist DK injection state (atomic write via session-id lib)
  if (sections.length > 0 || pointers.length > 0) {
    try {
      writeSessionFile(markerFile, [...injected].join('\n'));
    } catch {}
  }

  // Compose additionalContext.
  //   1. Always re-inject the compact locale tag — Claude's auto-compaction
  //      can drop old context, and the tag costs only ~14 bytes per prompt.
  //   2. On the first prompt of a session, also inject the trigger-glossary
  //      so non-English skill aliases work without bloating preload.
  //   3. DK sections when matched (lazy, one-shot per file).
  //   4. Always re-inject the one-line delegation nudge — the full policy is
  //      in context from SessionStart, but the tier decision happens at the
  //      first tool call of THIS prompt, and a rule seen thousands of tokens
  //      ago loses against the harness default of "no Agent tool unless
  //      asked". ~40 tokens per prompt; measured: without it the model did
  //      web research inline despite the injected policy.
  //   5. Budget suffix on the nudge when the class is not comfortable — the
  //      snapshot is re-read per prompt (cheap local JSON), so a window that
  //      fills up mid-session tightens the nudge without a restart.
  //      Inside an unattended run (AUTONOMOUS_* prompts, or the lockout
  //      sentinel armed) the suffix is dropped: a budget question can never
  //      be answered there, and /do-run burn deliberately upgrades models — the
  //      explicit run-* skill IS the "full" answer (redteam 2026-09-14 #2).
  //   6. Short prompts (< NUDGE_MIN_CHARS: "ja", "weiter", "ok mach") get no
  //      nudge at all — they can never be non-Inline, and every copy sits in
  //      the transcript for the rest of the session (redteam #11).
  //   7. Kill-switch: `off` → no nudge, no suffix; `ask` → the ask variant
  //      (the budget suffix still rides along — after a yes the class still
  //      decides the model).
  const unattended = /^\s*AUTONOMOUS_(?:AUTOSTART|RESUME)\s*:/i.test(rawMessage) || lockoutArmed(hook.cwd);
  const mode = readDelegation({ cwd: hook.cwd || process.cwd() }).mode;
  let budgetSuffix = '';
  const announce = [];
  //   8. A snapshot past its reset (a session resumed the next morning skips
  //      SessionStart) or old enough that the class may have tightened
  //      (plan-scaled, lib/budget.js refreshDueMinutes) starts one detached
  //      refresh — rate-limited in the lib, never awaited; the next prompt
  //      re-reads the fresh file.
  //   9. Positive signal: while a window is past its reset or reset recently
  //      the FULL budget line goes out, on every prompt and regardless of
  //      prompt length — "Erneut versuchen" (16 chars) after a limit hit is
  //      exactly the prompt that starts a ceremony, and silence there reads
  //      as "still at the limit" (incident 2026-09-20; see lib/budget.js).
  if (!unattended && mode !== 'off') {
    try {
      const budget = readBudget({ sessionId });
      budget.refreshing = maybeRefreshUsage(budget, { pluginRoot });
      budgetSuffix = nudgeSuffix(budget);
      if (budget.announce) announce.push(budgetLine(budget));
    } catch { /* never block the prompt */ }
  }
  const nudgeText = mode === 'off' ? null : mode === 'ask' ? ASK_NUDGE : DELEGATION_NUDGE;
  const nudge = nudgeText && rawMessage.trim().length >= NUDGE_MIN_CHARS ? [nudgeText + budgetSuffix] : [];
  const blocks = [`[ui-locale: ${lang}]`, ...announce, ...nudge];

  if (isFresh) {
    const glossary = loadTriggerGlossary(pluginRoot, lang);
    if (glossary) {
      blocks.push(
        glossary,
        `(These are localized aliases for the same skills — treat each phrase as ` +
        `equivalent to invoking the named skill, in addition to its English description.)`,
      );
    }
  }

  if (pointers.length > 0) blocks.push(...pointers);

  if (sections.length > 0) {
    blocks.push(
      `[deep-knowledge dispatch] Injecting ${sections.length} reference doc(s) relevant to this prompt:`,
      '',
      ...sections,
    );
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: blocks.join('\n'),
    },
  };

  process.stdout.write(JSON.stringify(output));
});
