#!/usr/bin/env node
/**
 * @hook pre.issue.guard
 * @version 0.4.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash|PowerShell|mcp__.*github.*__(issue_write|create_issue|update_issue)
 * @description Block raw GitHub issue writes (gh issue, gh api, MCP) unless setup-issue ran this turn.
 *   Guarded: `gh issue create` / `gh issue edit`, a writing `gh api …/issues`
 *   call, and the GitHub MCP issue-write tool.
 *   setup-issue (target name `auto-issue`) is the single owner of every issue
 *   write in this plugin — a direct write bypasses its title format, labels,
 *   user-value gate and board integration (deep-knowledge/plugin-behavior.md
 *   "Issue Creation & Editing — Always Delegate").
 *
 *   Matching is delegated to lib/issue-guard-match (same two-stage approach
 *   as pre.ship.guard's ship-guard-match, #198): quoted spans are masked so
 *   the guard does not false-positive on `gh issue create` merely appearing
 *   inside an issue body / commit message / grep pattern, the pattern is
 *   anchored to a command position, and line continuations (`\` / PowerShell
 *   backtick + newline) are joined first. Env prefixes, a path to the binary
 *   and gh's global flags do not hide the call.
 *
 *   Pass condition (both): every shell write carries its own same-segment
 *   `# via setup-issue` marker comment, AND the setup-issue / auto-issue
 *   skill was invoked in the current turn (Skill tool or slash command —
 *   lib/skill-invocations.skillInvokedThisTurn; the transcript is read only
 *   once a marked write is detected). A GitHub MCP issue-write tool has no
 *   marker and passes on the "invoked this turn" condition alone. The deny
 *   text never names the marker, so the model cannot retry the raw command
 *   with the marker appended; a self-appended marker without the skill in
 *   the turn stays blocked. The marker is a convention, not a security
 *   boundary.
 *
 *   Subagent calls (payload carries `agent_id`): the subagent's own Skill
 *   call is not in the main `transcript_path` — Claude Code writes it to
 *   `<dir of transcript_path>/<session-id>/subagents/agent-<agent_id>.jsonl`
 *   (verified layout). The hook prefers a payload `agent_transcript_path`
 *   when present, otherwise derives that path, and runs the "invoked this
 *   turn" check against the subagent transcript. A blocked subagent gets a
 *   subagent-specific deny text: return the proposed issue to the
 *   orchestrator instead of writing it.
 *
 *   Does not overlap pre.plugin.scope.js: that hook matches Edit|Write|
 *   NotebookEdit only (blocking hand-edits of an installed plugin artifact)
 *   and never inspects Bash commands or issue writes at all — the two hooks
 *   guard disjoint tool/matcher spaces and never double-block the same call.
 */

require('../lib/plugin-guard');

const { parseHookInput } = require('../lib/hook-input');
const { findIssueWrites, isMcpIssueWriteTool } = require('../lib/issue-guard-match');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Enough tail to reach the turn's setup-issue invocation in a long turn. */
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;

const DENY_TEXT =
  'BLOCKED: Raw GitHub issue write detected (`gh issue create`/`gh issue edit`,\n' +
  '      a writing `gh api …/issues` call, or a GitHub MCP issue-write tool).\n' +
  'Rule: setup-issue (target name auto-issue) is the single owner of every issue\n' +
  '      write in this plugin — it enforces title format, labels, the user-value\n' +
  '      gate, and optional milestone/board integration. A direct write bypasses\n' +
  '      all of that.\n' +
  'Fix: invoke the setup-issue skill via the Skill tool and let it perform the\n' +
  '     write — pass the title/type/body (create) or the issue number +\n' +
  '     refinement (edit). Do not retry the raw command.\n' +
  'If you cannot invoke skills (you are a subagent without the Skill tool): do NOT\n' +
  '     create or edit the issue — return the proposed issue (title, type, body, or\n' +
  '     the issue number + change) to the orchestrator, which files it with the\n' +
  '     setup-issue skill.\n' +
  'See deep-knowledge/plugin-behavior.md ("Issue Creation & Editing — Always Delegate").\n';

const SUBAGENT_DENY_TEXT =
  'BLOCKED: Raw GitHub issue write detected from a subagent (`gh issue create`/\n' +
  '      `gh issue edit`, a writing `gh api …/issues` call, or a GitHub MCP\n' +
  '      issue-write tool), and setup-issue did not run in this subagent.\n' +
  'Rule: setup-issue (target name auto-issue) is the single owner of every issue\n' +
  '      write in this plugin.\n' +
  'Fix: you are a subagent: return the proposed issue (title, type, body with User value line) to the orchestrator instead of writing it.\n' +
  '     For an edit, return the issue number + change. The orchestrator files\n' +
  '     it with the setup-issue skill. Do not retry the raw command.\n' +
  'See deep-knowledge/plugin-behavior.md ("Issue Creation & Editing — Always Delegate").\n';

const SAFE_ID_RE = /^[\w-]+$/;

/**
 * Transcript of the calling agent: the main transcript for the orchestrator,
 * the subagent's own transcript for a subagent tool call. '' when a subagent
 * transcript cannot be located (never falls back to the main transcript — a
 * setup-issue run by the orchestrator does not license the subagent's write).
 * @param {object} hook parsed payload
 * @returns {string}
 */
function callerTranscriptPath(hook) {
  if (!hook.agent_id) return hook.transcript_path || '';
  if (typeof hook.agent_transcript_path === 'string' && hook.agent_transcript_path) return hook.agent_transcript_path;
  const agentId = String(hook.agent_id);
  if (!SAFE_ID_RE.test(agentId) || typeof hook.transcript_path !== 'string' || !hook.transcript_path) return '';
  const path = require('path');
  const base = path.basename(hook.transcript_path, '.jsonl');
  const sessionId = typeof hook.session_id === 'string' && SAFE_ID_RE.test(hook.session_id) ? hook.session_id : base;
  if (!SAFE_ID_RE.test(sessionId)) return '';
  return path.join(path.dirname(hook.transcript_path), sessionId, 'subagents', `agent-${agentId}.jsonl`);
}

/** Did setup-issue (or its PR-2 name auto-issue) run in the current turn? */
function setupIssueInvokedThisTurn(transcriptPath) {
  try {
    const { safeReadTranscript } = require('../lib/card-guard');
    const { skillInvokedThisTurn } = require('../lib/skill-invocations');
    const transcript = safeReadTranscript(transcriptPath, TRANSCRIPT_TAIL_BYTES);
    return skillInvokedThisTurn(transcript, (_input, name) => name === 'setup-issue' || name === 'auto-issue');
  } catch {
    return false;
  }
}

/**
 * @param {string} inputData raw stdin
 * @returns {boolean} true = block
 */
function decide(inputData) {
  const hook = parseHookInput(inputData);
  if (!hook) return false;
  if (isMcpIssueWriteTool(hook.tool_name)) return !setupIssueInvokedThisTurn(callerTranscriptPath(hook));
  if (!SHELL_TOOLS.has(hook.tool_name)) return false;
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const cmd = typeof input.command === 'string' ? input.command : '';
  const writes = findIssueWrites(cmd);
  if (!writes.length) return false;
  if (writes.some(w => !w.marked)) return true;
  return !setupIssueInvokedThisTurn(callerTranscriptPath(hook));
}

/** Deny text for a blocked call — subagents get the hand-back variant. */
function denyTextFor(inputData) {
  const hook = parseHookInput(inputData);
  return hook && hook.agent_id ? SUBAGENT_DENY_TEXT : DENY_TEXT;
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let block = false;
    try { block = decide(inputData); } catch { block = false; }
    if (!block) process.exit(0);
    let text = DENY_TEXT;
    try { text = denyTextFor(inputData); } catch { text = DENY_TEXT; }
    process.stderr.write(text);
    process.exit(2);
  });
}

module.exports = { decide, denyTextFor, callerTranscriptPath, DENY_TEXT, SUBAGENT_DENY_TEXT };
