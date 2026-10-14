#!/usr/bin/env node
/**
 * @hook ss.run.task
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Keep a running do-run's task verbatim across a compaction or a
 *   resume. do-run writes the user's task word for word to
 *   `.claude/run-task.md` when it starts (do-run `SKILL.md` Step 1); a
 *   compaction summary may shorten it — "Y nicht anfassen" or "inkl. ship"
 *   gone — and an overnight run has nobody to ask. So after a compaction or
 *   a resume this hook re-injects the file as the binding task, but only
 *   while this session owns an active run contract and the file was written
 *   after the previous run closed (`run-contract.prev.json`). No contract, a
 *   foreign or expired one, or a file older than the last closed run →
 *   silent: a task file from a finished run never leaks into later work.
 *   Paths resolve at the work-tree root, like the run contract itself.
 *   Reads two small files; no git, no network — boot-window safe.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');

const { projectClaudeDir } = require('../lib/project-root');

const MAX_CHARS = 8000;

/** @param {string} cwd */
function taskPath(cwd) {
  return path.join(projectClaudeDir(cwd), 'run-task.md');
}

/**
 * When the previous run contract closed or was archived (ms), or null.
 * @param {string} cwd
 */
function prevClosedAt(cwd) {
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(projectClaudeDir(cwd), 'run-contract.prev.json'), 'utf8'));
    const t = Date.parse(prev.closedAt || prev.archivedAt || '');
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/**
 * The instruction block, or null when there is nothing to restore.
 * @param {{ cwd: string, source: string, contract?: object|null, prevClosed?: number|null }} o
 * @returns {string|null}
 */
function buildTaskInstruction({ cwd, source, contract, prevClosed = prevClosedAt(cwd) }) {
  if (!cwd || (source !== 'compact' && source !== 'resume')) return null;
  if (!contract || !contract.armedAt) return null;
  let stat, text;
  try {
    stat = fs.statSync(taskPath(cwd));
    text = fs.readFileSync(taskPath(cwd), 'utf8').trim();
  } catch {
    return null;
  }
  if (!text) return null;
  // Written before the last run closed → that run's leftover, not this one's.
  if (prevClosed != null && stat.mtimeMs < prevClosed) return null;
  const body = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[… truncated — read .claude/run-task.md]` : text;
  const when = source === 'compact' ? 'the context was just compacted' : 'this session was just resumed';
  return [
    `[ss.run.task] A do-run is active here and ${when}. Its task, VERBATIM as the user gave it`,
    '(.claude/run-task.md) — binding for the rest of the run, above any shorter version in the summary:',
    '---',
    body,
    '---',
    'Every constraint in it still holds (what to build, what NOT to touch, ship or not). Never re-ask it.',
  ].join('\n');
}

function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const hook = JSON.parse(inputData);
      const cwd = hook.cwd || process.cwd();
      const source = hook.source || hook.trigger || '';
      if (source !== 'compact' && source !== 'resume') process.exit(0);
      if (!fs.existsSync(taskPath(cwd))) process.exit(0);
      const contract = require('../lib/run-contract').readContract(cwd, { sessionId: hook.session_id || null });
      const text = buildTaskInstruction({ cwd, source, contract });
      if (text) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
        }) + '\n');
      }
    } catch { /* fail open */ }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { buildTaskInstruction, taskPath, prevClosedAt };
