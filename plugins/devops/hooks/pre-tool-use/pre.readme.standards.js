#!/usr/bin/env node
/**
 * @hook pre.readme.standards
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Write|Edit
 * @description Once per session, before the first substantial write to a README file, points Claude at deep-knowledge/readme-standards.md (the former setup-readme skill).
 *
 *   PR 3 of the skill restructure retired `setup-readme` into
 *   deep-knowledge/readme-standards.md. Its description said the standards
 *   apply "when Claude is about to create, rewrite, or substantially update a
 *   README.md" — a moment no prompt phrase catches, so this hook watches the
 *   write itself:
 *     - Write/Edit of a file named README / README.md / .markdown / .mdx /
 *       .rst / .txt (any case), outside node_modules and `.claude/`;
 *     - a one-line Edit (old and new text single-line, short — a version
 *       bump) is exempt, as the old skill's "Do NOT trigger" said;
 *     - once per session, shared with prompt.knowledge.dispatch's pointer
 *       marker, so a prompt that already got the pointer is not repeated;
 *     - a consumer extension of the old skill
 *       (`.claude/skills/setup-readme/reference.md` or `SKILL.md`, project
 *       and home) is named in the pointer — it keeps applying on top.
 *   Non-blocking: additionalContext only, every failure path exits 0.
 */

require('../lib/plugin-guard');

const path = require('path');
const os = require('os');

const DOC = 'readme-standards.md';
const LEGACY = 'setup-readme';
/** README, README.md, readme.markdown, README.mdx, README.rst, README.txt. */
const README_RE = /^readme(?:\.(?:md|markdown|mdx|rst|txt))?$/i;
const EXCLUDE_RE = /(^|\/)(?:node_modules|\.claude)\//;
/** A single-line Edit up to this many characters on each side is "minor". */
const MINOR_EDIT_CHARS = 200;

/** Is this tool call a README write that deserves the standards? */
function isReadmeWrite(toolName, input) {
  if (toolName !== 'Write' && toolName !== 'Edit') return false;
  const filePath = input && typeof input.file_path === 'string' ? input.file_path : '';
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, '/');
  if (EXCLUDE_RE.test(norm)) return false;
  if (!README_RE.test(path.posix.basename(norm))) return false;
  if (toolName === 'Edit') {
    const a = typeof input.old_string === 'string' ? input.old_string : '';
    const b = typeof input.new_string === 'string' ? input.new_string : '';
    const minor = !a.includes('\n') && !b.includes('\n') && a.length <= MINOR_EDIT_CHARS && b.length <= MINOR_EDIT_CHARS;
    if (minor && !input.replace_all) return false;
  }
  return true;
}

/** The pointer text. */
function buildPointer(fileName, dkDir, overrides) {
  const doc = path.join(dkDir, DOC).replace(/\\/g, '/');
  const lines = [
    `[readme-standards] You are about to write ${fileName}. README content follows ${doc} ` +
      '(sections by project category, badges, media, diagrams, style rules; update mode preserves user-written sections) — ' +
      'read it first if it is not in context this session. Not a skill: do not invoke one named setup-readme.',
  ];
  if (overrides.length) {
    lines.push(`Project override from the old setup-readme extension, applies on top: ${overrides.map(o => o.replace(/\\/g, '/')).join(', ')}.`);
  }
  return lines.join('\n');
}

function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const { parseHookInput } = require('../lib/hook-input');
      const hook = parseHookInput(inputData);
      if (!hook) return;
      const input = hook.tool_input || {};
      if (!isReadmeWrite(hook.tool_name, input)) return;

      const { sessionFile, writeSessionFile } = require('../lib/session-id');
      const fs = require('fs');
      const marker = sessionFile('dotclaude-dk-injected', hook.session_id || 'unknown');
      let injected = [];
      try { injected = fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean); } catch {}
      if (injected.includes(DOC)) return;

      const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
      const { legacyOverrides } = require('../lib/knowledge-pointers');
      const overrides = legacyOverrides(LEGACY, { cwd: hook.cwd || process.cwd(), home: os.homedir() });
      const text = buildPointer(path.basename(String(input.file_path)), path.join(pluginRoot, 'deep-knowledge'), overrides);

      try { writeSessionFile(marker, [...injected, DOC].join('\n')); } catch {}
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
      }));
    } catch {
      // Advisory hook — never cost the user a write.
    }
    process.exitCode = 0;
  });
}

if (require.main === module) main();

module.exports = { isReadmeWrite, buildPointer, README_RE };
