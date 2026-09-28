#!/usr/bin/env node
/**
 * @hook ss.ship.resume
 * @version 0.3.0
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
 *   Since 0.2.0 the ship checkpoint (lib/ship-checkpoint.js) wins over the
 *   sentinel: it has no 60-min expiry — a usage limit lasts hours — and it
 *   names the steps that already landed, so the resumed run starts at the
 *   first unfinished one instead of re-deriving everything.
 *   Since 0.3.0 a compaction tells a turn that is still shipping to reload the
 *   skill with --resume: only its first 5,000 tokens survive a compaction.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { isActive, sentinelPath } = require('../lib/ship-sentinel');
const { openCheckpoint, describeCheckpoint } = require('../lib/ship-checkpoint');

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
  if (!cwd) return null;
  const cp = openCheckpoint(cwd);
  if (cp) {
    const when = source === 'compact' ? 'the context was just compacted'
      : source === 'resume' ? 'this session was just resumed'
        : 'this session just started';
    // Claude Code re-attaches only the first 5,000 tokens of an invoked skill
    // after a compaction (code.claude.com/docs/en/skills), so a turn that is
    // still shipping must reload the skill before its next step, not wait for
    // a prompt that never comes mid-turn.
    const next = source === 'compact'
      ? ['Only the first 5,000 tokens of the do-ship skill survived the compaction. If this turn is still shipping,',
        're-invoke Skill("devops:do-ship", "--resume") before the next ship step — it continues at the step marked next',
        '(the title stays "🚀 Shipping – " and the turn ends with the ship card). Otherwise the next "weiter" / "continue" /',
        'ship prompt resumes it (prompt.ship.detect sends a [ship-resume] block — follow it).']
      : ['The next "weiter" / "continue" / ship prompt resumes it at the step marked next (prompt.ship.detect sends a',
        '[ship-resume] block — follow it; the title stays "🚀 Shipping – " and the turn ends with the ship card).'];
    return [
      `[ss.ship.resume] An interrupted /do-ship of branch ${cp.branch || '?'} is waiting in ${cwd} and ${when}.`,
      `Progress: ${describeCheckpoint(cp)}`,
      ...next,
      'Never start that ship over and never repeat a step marked ✓. If the user asks for something else first,',
      'do that — but mention in one line that a ship is waiting to be resumed.',
    ].join('\n');
  }
  if (!isActive(cwd)) return null;
  const age = sentinelAgeMin(cwd);
  const when = source === 'compact' ? 'the context was just compacted'
    : source === 'resume' ? 'this session was just resumed'
      : 'this session just started';
  return [
    `[ss.ship.resume] A /do-ship pipeline is in progress in ${cwd}`
      + ` (sentinel ${path.join('.claude', '.ship-in-progress')}${age == null ? '' : `, written ${age} min ago`}) and ${when}.`,
    'Before anything ship-related: re-establish the REAL state, never trust the summary or memory.',
    '  git -C "<cwd>" status --short && git -C "<cwd>" log -1 --oneline && gh pr list --head "$(git -C "<cwd>" branch --show-current)" --state all --json number,state,mergedAt',
    'Then re-enter Skill("devops:do-ship"): preflight → build → bump → release → cleanup, each step is idempotent —',
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
