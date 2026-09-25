#!/usr/bin/env node
/**
 * @hook post.claude.budget
 * @version 0.2.1
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
 *   only when the edit made the file bigger — see claude-file-budget.js for
 *   why growth, not size, is the trigger — and once per file per severity per
 *   context: the main thread and each subagent (`agent_id`) count separately.
 *
 *   The instruction goes out as `hookSpecificOutput.additionalContext`: plain
 *   stdout of a PostToolUse hook only shows in transcript mode and never
 *   reaches the model (CONVENTIONS.md), so before 0.2.0 no report was ever
 *   read. The one-line summary stays on stderr for the user.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { evaluate, editDelta, buildSummary, buildInstruction } = require('../lib/claude-file-budget');
const { runOnce } = require('../lib/run-once');
const { findRepoRoot } = require('../lib/project-root');
const { isPluginSourceRepo } = require('../lib/plugin-scope');

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

  // One report per file per severity per context. A refactor pass touching the
  // same file five times should say this once; an escalation from warn to
  // critical is genuinely new information and gets its own report. A delivered
  // report stays in the context for the rest of the session, so "once" is
  // strict — a time window would only land the same text there a second time.
  //
  // A subagent is its own context: its report never reaches the main thread,
  // so it must not spend the main thread's (keyed like post.flow.debug).
  //
  // Without a session_id, runOnce falls back to the literal "unknown": one
  // marker shared by every session that ever lacks an id, and since the marker
  // outlives the process, strict-once would silence the hook for that file for
  // good. There the 2-hour window stays — "reports again later" beats "never
  // reports again".
  const fileKey = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 12);
  const dedupeKey = `claude-budget-${fileKey}-${result.severity}`;
  const contextKey = hook.agent_id ? `${hook.session_id || 'unknown'}-agent-${hook.agent_id}` : hook.session_id;
  const cooldownMs = hook.session_id ? 0 : 2 * 60 * 60 * 1000;
  if (!runOnce(dedupeKey, contextKey, { cooldownMs })) process.exit(0);

  // In the plugin source the report names the checkout's own scripts, not the
  // installed plugin's (claude-file-budget.js, buildInstruction).
  const repoRoot = findRepoRoot(path.dirname(path.resolve(file)));
  const sourceRoot = isPluginSourceRepo(repoRoot) ? repoRoot : null;

  process.stderr.write(buildSummary(file, result) + '\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: buildInstruction(file, result, { sourceRoot }),
    },
  }));
  process.exit(0);
});
