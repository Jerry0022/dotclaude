#!/usr/bin/env node
/**
 * @hook ss.ship.resume
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Keep a running /do-ship stable across a compaction or a resume.
 *   The ship sentinel (`.claude/.ship-in-progress`, written by ship_preflight,
 *   cleared by ship_cleanup on every exit path) says a pipeline was mid-flight
 *   when the context was compacted or the session paused. The compacted
 *   summary may or may not carry which steps already landed, and re-running
 *   them is the one thing a ship must never do (a second PR, a second tag).
 *   So this hook tells the model, once per session start: a ship is in
 *   progress here — re-establish the real state from git/gh BEFORE touching
 *   the pipeline, then re-enter /do-ship, which is idempotent step by step.
 *   Silent when no sentinel is active (the normal case) and on a stale one
 *   (ship-sentinel.js ages it out after 60 min — a crashed ship, not a
 *   paused one; ss.git.check covers that checkout as usual).
 *   Reads one small file; no git, no network — boot-window safe.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { isActive, sentinelPath } = require('../lib/ship-sentinel');

/**
 * Minutes since the sentinel was written, or null when unreadable.
 * @param {string} cwd
 * @returns {number|null}
 */
function sentinelAgeMin(cwd) {
  try {
    const data = JSON.parse(fs.readFileSync(sentinelPath(cwd), 'utf8'));
    if (!data || typeof data.ts !== 'number') return null;
    return Math.max(0, Math.round((Date.now() - data.ts) / 60000));
  } catch {
    return null;
  }
}

/**
 * The instruction block, or null when there is nothing to resume.
 * @param {{ cwd: string, source: string }} o
 * @returns {string|null}
 */
function buildResumeInstruction({ cwd, source }) {
  if (!cwd || !isActive(cwd)) return null;
  const age = sentinelAgeMin(cwd);
  const when = source === 'compact' ? 'the context was just compacted'
    : source === 'resume' ? 'this session was just resumed'
      : 'this session just started';
  return [
    `[ss.ship.resume] A /do-ship pipeline is in progress in ${cwd}`
      + ` (sentinel ${path.join('.claude', '.ship-in-progress')}${age == null ? '' : `, written ${age} min ago`}) and ${when}.`,
    'Before anything ship-related: re-establish the REAL state, never trust the summary or memory.',
    '  git -C "<cwd>" status --short && git -C "<cwd>" log -1 --oneline && gh pr list --head "$(git -C "<cwd>" branch --show-current)" --state all --json number,state,mergedAt',
    'Then re-enter Skill("do-ship"): preflight → build → bump → release → cleanup, each step is idempotent —',
    'an existing open PR is reused, a merged PR ends the release, a bump that already landed is not repeated.',
    'Never create a second PR or a second tag for the same branch. If the ship had already finished',
    '(PR merged, branch gone), call ship_cleanup({ keep: true, cwd }) to clear the sentinel and render the card.',
    'If the user asks for something else first, do that — but mention in one line that a ship is pending here.',
  ].join('\n');
}

function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let hook;
    try { hook = JSON.parse(inputData); }
    catch { process.exit(0); }
    const text = buildResumeInstruction({
      cwd: hook.cwd || process.cwd(),
      source: hook.source || hook.trigger || '',
    });
    if (!text) process.exit(0);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
    }) + '\n');
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { buildResumeInstruction, sentinelAgeMin };
