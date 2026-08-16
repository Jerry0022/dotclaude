#!/usr/bin/env node
/**
 * @hook post.claude.budget
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Write|Edit
 * @description Deterministic context-budget gate for Claude configuration
 *   files — CLAUDE.md, SKILL.md, agent definitions, skill reference.md, and
 *   deep-knowledge docs.
 *
 *   Replaces the `/claude-lint` skill. The budgets in
 *   `deep-knowledge/content-conventions.md` were only ever enforced by a skill
 *   someone had to remember to invoke, so in practice they were not enforced
 *   at all. Measuring at write time removes the remembering.
 *
 *   Never blocks (always exit 0): the file is already written, and an
 *   over-budget doc is a debt to schedule, not a broken artifact. It reports
 *   once per file per severity per session, and only when the edit made the
 *   file bigger — see claude-file-budget.js for why growth, not size, is the
 *   trigger.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { evaluate, editDelta, buildSummary, buildInstruction } = require('../lib/claude-file-budget');
const { runOnce } = require('../lib/run-once');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  if (!['Write', 'Edit'].includes(toolName)) process.exit(0);

  const input = hook.tool_input || {};
  const file = input.file_path;
  if (!file || !/\.md$/i.test(file)) process.exit(0); // fast path: markdown only

  // The tool already wrote the file, so disk is the truth. The Write payload
  // is a fallback for the case where the path is not readable back.
  let content = null;
  try { content = fs.readFileSync(file, 'utf8'); }
  catch { content = typeof input.content === 'string' ? input.content : null; }
  if (content == null) process.exit(0);

  const result = evaluate({ file, content, delta: editDelta(toolName, input) });
  if (result.silent) process.exit(0);

  // One report per file per severity per session. A refactor pass touching the
  // same file five times should say this once; an escalation from warn to
  // critical is genuinely new information and gets its own report.
  const fileKey = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 12);
  if (!runOnce(`claude-budget-${fileKey}-${result.severity}`, hook.session_id)) process.exit(0);

  process.stderr.write(buildSummary(file, result) + '\n');
  process.stdout.write(buildInstruction(file, result) + '\n');
  process.exit(0);
});
