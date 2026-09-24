#!/usr/bin/env node
/**
 * @hook post.flow.debug
 * @version 0.7.0
 * @event PostToolUse, PostToolUseFailure
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description After 2+ consecutive shell failures: MANDATE the devops `fix` skill (target name `auto-fix`) before the next retry.
 *   Usage data: `fix` was invoked 0 times for ~10 real bug reports in the
 *   last 200 sessions — the model debugged without it instead (37-137 tool
 *   calls each).
 *
 *   Payload (verified against the Claude Code 2.1.x binary, 2026-09-24): a
 *   Bash call whose exit code the harness interprets as an error THROWS, so
 *   it never reaches PostToolUse — it fires PostToolUseFailure with
 *   `{ tool_name, tool_input, tool_use_id, error, is_interrupt, … }`, where
 *   `error` starts with `Exit code N`. Only such an error (N ≥ 1) counts —
 *   a timeout, a permission or hook denial, or any other failure without an
 *   exit code is neutral. A successful call fires PostToolUse
 *   with `tool_response` (`{ stdout, stderr, interrupted, … }`, no exit code).
 *   The harness already treats exit 1 of grep/rg/find/diff/test as a
 *   non-error; this hook excuses the same probes again for shapes that still
 *   carry the code. Both events are registered in hooks.json; `tool_response`
 *   is normalized like browsertest-guard (numeric exit code in any of the
 *   known keys, plus a legacy top-level `exit_code`).
 *
 *   Counter: a session file keyed per session AND agent_id, so a subagent's
 *   failures never add to the main thread's (or another agent's) streak.
 *   Resets on a success; an excused probe or an interrupt leaves it alone.
 *   Silent when the fix skill already ran this turn. Output goes out as
 *   `hookSpecificOutput.additionalContext` — plain stdout of a PostToolUse*
 *   hook only shows in transcript mode and never reaches the model.
 *   Subagents without the Skill tool are told to return the diagnosis to the
 *   orchestrator instead.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { sessionFile, writeSessionFile } = require('../lib/session-id');
const { parseHookInput } = require('../lib/hook-input');
const { normalizeToolResponse } = require('../lib/browsertest-guard');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const THRESHOLD = 2;
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
/** A failure counts only with a real non-zero exit code. */
const EXIT_CODE_RE = /exit code\s+([1-9]\d*)/i;

/** Commands whose exit 1 means "no match / differs / false", not failure. */
const PROBE_COMMANDS = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'findstr', 'find', 'test', '[', '[[',
  'diff', 'cmp', 'select-string', 'test-path', 'compare-object',
]);

/**
 * First word of the LAST segment of a shell command — the one whose exit
 * code the shell reports.
 * @param {string} command
 * @returns {{cmd:string, segment:string}}
 */
function lastCommandWord(command) {
  if (typeof command !== 'string' || !command.trim()) return { cmd: '', segment: '' };
  const segments = command.split(/&&|\|\||[;|\n]/).map(s => s.trim()).filter(Boolean);
  const segment = segments.length ? segments[segments.length - 1] : '';
  const words = segment.split(/\s+/).filter(w => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  while (words.length && /^(?:env|command|exec|sudo|time|nohup|!)$/.test(words[0])) words.shift();
  const first = (words[0] || '').replace(/^["'&]+|["']+$/g, '');
  const base = path.basename(first.replace(/\\/g, '/')).replace(/\.exe$/i, '').toLowerCase();
  return { cmd: base, segment };
}

/** Exit 1 of a probe (grep no-match, diff differs, test false, git diff --exit-code). */
function isProbeExit(command, exitCode) {
  if (exitCode !== 1) return false;
  const { cmd, segment } = lastCommandWord(command);
  if (PROBE_COMMANDS.has(cmd)) return true;
  return cmd === 'git' && /\bdiff\b/.test(segment) && /--(?:exit-code|quiet)\b/.test(segment);
}

/**
 * Classify one hook payload.
 * @param {object} hook
 * @returns {'fail'|'success'|'neutral'}
 */
function classify(hook) {
  const command = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input.command : '';
  if (hook.hook_event_name === 'PostToolUseFailure') {
    if (hook.is_interrupt === true) return 'neutral';
    // Only a real non-zero exit counts. Timeouts, permission / hook denials
    // and other tool errors carry no `Exit code N` and are neutral.
    const m = EXIT_CODE_RE.exec(typeof hook.error === 'string' ? hook.error : '');
    if (!m) return 'neutral';
    return isProbeExit(command, parseInt(m[1], 10)) ? 'neutral' : 'fail';
  }
  let exitCode = null;
  let interrupted = false;
  if (hook.tool_response !== undefined) {
    const n = normalizeToolResponse(hook.tool_response);
    exitCode = n.exitCode;
    interrupted = n.interrupted;
  }
  if (exitCode === null && typeof hook.exit_code === 'number') exitCode = hook.exit_code;
  if (interrupted) return 'neutral';
  if (exitCode === null || exitCode === 0) return 'success';
  if (isProbeExit(command, exitCode)) return 'neutral';
  return 'fail';
}

/** Did the fix skill (or its PR-2 name auto-fix) already run this turn? */
function fixActiveThisTurn(transcriptPath) {
  try {
    const { safeReadTranscript } = require('../lib/card-guard');
    const { skillInvokedThisTurn } = require('../lib/skill-invocations');
    const transcript = safeReadTranscript(transcriptPath, TRANSCRIPT_TAIL_BYTES);
    return skillInvokedThisTurn(transcript, (_input, name) => name === 'fix' || name === 'auto-fix');
  } catch {
    return false;
  }
}

function buildMessage(failures) {
  return (
    `Repeated shell failure detected (${failures} consecutive). ` +
    'Invoke the devops `fix` skill (target name `auto-fix`) via the Skill tool ' +
    'NOW, before retrying anything else: check recent git changes, read error ' +
    'logs, and perform root-cause analysis per skills/fix/SKILL.md. This is ' +
    'mandatory, not a suggestion — free-form retry loops without it have run ' +
    '37-137 tool calls on real bugs that fix would have diagnosed directly. ' +
    'If you cannot invoke skills (you are a subagent without the Skill tool): stop ' +
    'retrying and return the failing command, the error and your diagnosis so far ' +
    'to the orchestrator. ' +
    'Alternative: /codex:rescue to delegate investigation to Codex ' +
    '(requires codex-plugin-cc).'
  );
}

/**
 * @param {string} inputData raw stdin
 * @returns {string} JSON to print, or ''
 */
function run(inputData) {
  const hook = parseHookInput(inputData);
  if (!hook) return '';
  if (!SHELL_TOOLS.has(hook.tool_name)) return '';

  const key = hook.agent_id ? `${hook.session_id || 'unknown'}-agent-${hook.agent_id}` : hook.session_id;
  const counterFile = sessionFile('dotclaude-devops-bash-failures', key);

  const verdict = classify(hook);
  if (verdict === 'neutral') return '';
  if (verdict === 'success') {
    try { fs.unlinkSync(counterFile); } catch {}
    return '';
  }

  let failures = 0;
  try { failures = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0; } catch {}
  failures++;

  if (failures < THRESHOLD) {
    try { writeSessionFile(counterFile, String(failures)); } catch {}
    return '';
  }

  try { fs.unlinkSync(counterFile); } catch {}
  if (fixActiveThisTurn(hook.transcript_path)) return '';

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: hook.hook_event_name === 'PostToolUseFailure' ? 'PostToolUseFailure' : 'PostToolUse',
      additionalContext: buildMessage(failures),
    },
  });
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const out = run(inputData);
      if (out) process.stdout.write(out);
    } catch { /* never surface an internal error */ }
    process.exitCode = 0;
  });
}

module.exports = { classify, isProbeExit, lastCommandWord, run, buildMessage };
