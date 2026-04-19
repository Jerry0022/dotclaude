#!/usr/bin/env node
/**
 * @hook prompt.knowledge.dispatch
 * @version 0.2.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description On-demand deep-knowledge injection based on prompt keywords.
 *   Matches user prompt against a topic keyword map and injects the relevant
 *   deep-knowledge file content as additionalContext. Each file is injected
 *   at most once per session (tracked via session-scoped temp files).
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { sessionFile, writeSessionFile } = require('../lib/session-id');
const { ensureLocale } = require('../lib/locale');

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
    file: 'agent-proactivity.md',
    specificity: 2,
    patterns: [/\bproactiv/i, /\bproaktiv/i, /\bauto.*orchestrat/i],
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

  const userMessage = (hook.user_message || hook.message || '').toLowerCase().trim();
  if (!userMessage || userMessage.length < 5) process.exit(0);

  const sessionId = hook.session_id || 'unknown';

  // Detect + cache UI locale once per session. First prompt sets it; later
  // prompts read the cache so all hooks/skills agree on a single language.
  const { lang, isFresh } = ensureLocale(sessionId, hook.user_message || hook.message || '');

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

  // Persist DK injection state (atomic write via session-id lib)
  if (sections.length > 0) {
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
  const blocks = [`[ui-locale: ${lang}]`];

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
