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

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const userMessage = (hook.user_message || hook.message || '').toLowerCase().trim();
  if (!userMessage || userMessage.length < 5) process.exit(0);

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
    || path.resolve(__dirname, '..', '..');
  const dkDir = path.join(pluginRoot, 'deep-knowledge');

  // Find matching topics, sort by specificity (higher = more relevant)
  const matched = TOPIC_MAP
    .filter(t => t.patterns.some(re => re.test(userMessage)))
    .sort((a, b) => b.specificity - a.specificity);

  if (matched.length === 0) process.exit(0);

  // Session-scoped dedup via session-id lib (atomic writes, fallback on mismatch)
  const sessionId = hook.session_id || 'unknown';
  const markerFile = sessionFile('dotclaude-dk-injected', sessionId);

  let injected = new Set();
  try {
    const raw = fs.readFileSync(markerFile, 'utf8');
    injected = new Set(raw.split('\n').filter(Boolean));
  } catch {}

  // Filter out already-injected, apply count cap
  const candidates = matched.filter(t => !injected.has(t.file));
  if (candidates.length === 0) process.exit(0);

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

  if (sections.length === 0) process.exit(0);

  // Persist injection state (atomic write via session-id lib)
  try {
    writeSessionFile(markerFile, [...injected].join('\n'));
  } catch {}

  // Output as additionalContext
  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: [
        `[deep-knowledge dispatch] Injecting ${sections.length} reference doc(s) relevant to this prompt:`,
        '',
        ...sections,
      ].join('\n'),
    },
  };

  process.stdout.write(JSON.stringify(output));
});
