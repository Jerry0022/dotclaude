#!/usr/bin/env node
/**
 * @hook prompt.knowledge.dispatch
 * @version 0.1.0
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
const os = require('os');

/**
 * Topic-to-file keyword map.
 * Each entry: { file, patterns (RegExp[]) }
 * Patterns are tested against the lowercased user prompt.
 */
const TOPIC_MAP = [
  {
    file: 'agent-collaboration.md',
    patterns: [/\bagent.*collaborat/i, /\bmulti.?role/i, /\bagent.*zusammen/i],
  },
  {
    file: 'agent-conventions.md',
    patterns: [/\bagent.*naming/i, /\bagent.*convention/i, /\bagent.*format/i],
  },
  {
    file: 'agent-proactivity.md',
    patterns: [/\bproactiv/i, /\bproaktiv/i, /\bauto.*orchestrat/i],
  },
  {
    file: 'browser-tool-strategy.md',
    patterns: [/\bbrowser.*tool/i, /\bchrome.*mcp/i, /\bedge.*credo/i, /\bplaywright/i],
  },
  {
    file: 'claude-directory-structure.md',
    patterns: [/\b\.claude.*structure/i, /\bdirectory.*convention/i, /\bclaude.*dir/i],
  },
  {
    file: 'code-defaults.md',
    patterns: [/\bcode.*default/i, /\bcoding.*convention/i, /\bstyle.*guide/i],
  },
  {
    file: 'codex-integration.md',
    patterns: [/\bcodex/i, /\bgpt.?5/i, /\bcodex.*delegat/i],
  },
  {
    file: 'decision-format.md',
    patterns: [/\bdecision.*format/i, /\boption.*present/i, /\bentscheidung.*format/i],
  },
  {
    file: 'desktop-testing.md',
    patterns: [/\bdesktop.*test/i, /\bcomputer.?use.*test/i, /\bvisual.*ui.*test/i],
  },
  {
    file: 'fact-verification.md',
    patterns: [/\bfact.*verif/i, /\bfakten.*pr[uü]f/i, /\bclaim.*check/i],
  },
  {
    file: 'git-hygiene.md',
    patterns: [/\bgit.*hygien/i, /\bbranch.*clean/i, /\bcommit.*convention/i],
  },
  {
    file: 'plugin-behavior.md',
    patterns: [/\bplugin.*behav/i, /\bplugin.*regel/i, /\bplugin.*rule/i],
  },
  {
    file: 'skill-extension-guide.md',
    patterns: [/\bskill.*extend/i, /\bskill.*customiz/i, /\bextension.*guide/i],
  },
  {
    file: 'test-strategy.md',
    patterns: [/\btest.*strateg/i, /\bwann.*test/i, /\btest.*ausf[uü]hr/i],
  },
  {
    file: 'tool-selection.md',
    patterns: [/\btool.*select/i, /\btool.*wahl/i, /\bwindows.*tool/i],
  },
  {
    file: 'visual-verification.md',
    patterns: [/\bvisual.*verif/i, /\bscreenshot.*check/i, /\bvisuell.*pr[uü]f/i],
  },
];

// Max files to inject per prompt (prevent overloading the 10K cap)
const MAX_INJECT_PER_PROMPT = 2;

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

  // Find matching topics
  const matched = TOPIC_MAP.filter(t =>
    t.patterns.some(re => re.test(userMessage))
  );

  if (matched.length === 0) process.exit(0);

  // Session-scoped dedup: track which files were already injected
  const sessionId = hook.session_id || 'unknown';
  const markerPrefix = 'dotclaude-dk-injected';
  const markerFile = path.join(os.tmpdir(), `${markerPrefix}-${sessionId}`);

  let injected = new Set();
  try {
    const raw = fs.readFileSync(markerFile, 'utf8');
    injected = new Set(raw.split('\n').filter(Boolean));
  } catch {}

  // Filter out already-injected files
  const toInject = matched
    .filter(t => !injected.has(t.file))
    .slice(0, MAX_INJECT_PER_PROMPT);

  if (toInject.length === 0) process.exit(0);

  // Read file contents and build injection
  const sections = [];
  for (const topic of toInject) {
    const filePath = path.join(dkDir, topic.file);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      sections.push(`--- deep-knowledge/${topic.file} ---\n${content}`);
      injected.add(topic.file);
    } catch {}
  }

  if (sections.length === 0) process.exit(0);

  // Persist injection state
  try {
    fs.writeFileSync(markerFile, [...injected].join('\n'));
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
