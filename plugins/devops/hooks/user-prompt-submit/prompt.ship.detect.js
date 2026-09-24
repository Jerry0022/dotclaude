#!/usr/bin/env node
/**
 * @hook prompt.ship.detect
 * @version 0.6.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detect ship intent in user prompts and inject Skill('do-ship') instruction.
 *   Triggers on keywords like "ship", "shippen", "ab damit", "mach nen PR",
 *   "merge it", "das kann rein", "fertig", and affirmations after a completion
 *   card ("ja", "yes", "mach", "go", "do it"). The keyword list lives in
 *   lib/ship-intent.js, shared with prompt.flow.title-work so a ship prompt
 *   is marked `🚀 Shipping – ` in the sidebar, never the bare `⏳ `.
 *   Above a context threshold the hook emits the careful-compact advice from
 *   lib/ship-compact.js INSTEAD of the ship instruction: the ship would
 *   re-read that context ~16 times, and only the user can compact. The
 *   ship prompt right after an advice runs — never the advice twice in a row.
 *   Target channel (promote folded into do-ship, skill restructure PR 2):
 *   "ship stable", "promote to beta", "release beta", "auf stable heben",
 *   `/promote stable` — lib/ship-intent.js parses the channel and the hook
 *   passes it as the skill argument (`Skill("do-ship") with args "stable"`):
 *   do-ship ships any unshipped work to alpha, then promotes. A bare
 *   "promote" passes `promote` (do-ship asks which promotion). This hook
 *   owns every do-ship prompt; the trigger router stays silent on them.
 *   A promotion-only prompt (nothing unshipped, lib/ship-unshipped.js) never
 *   gets the compact advice — the run is ~4 calls, not ~16.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { execFileSync } = require('child_process');
const { sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id');
const { parseShipRequest } = require('../lib/ship-intent');
const { hasUnshippedWork } = require('../lib/ship-unshipped');
const { currentContextTokens } = require('../lib/context-size');
const { shipCompactAdvice } = require('../lib/ship-compact');

/** Set when a ship prompt got the compact advice; the next ship prompt of
 *  the same session consumes it and runs — never the advice twice in a row. */
const ADVISED_PREFIX = 'dotclaude-devops-ship-compact-advised';

/**
 * Returns true if cwd is inside a git work tree.
 * @param {string} cwd
 * @returns {boolean}
 */
function isGitRepo(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const userMessage = (hook.prompt || hook.user_message || hook.message || '').toLowerCase().trim();
  if (!userMessage) process.exit(0);

  // --- Cache-timeout detection (5-minute prompt cache TTL) ---
  let cacheWarning = '';
  try {
    const activityResult = readSessionFile('dotclaude-devops-last-activity', hook.session_id);
    if (activityResult) {
      const lastActivity = parseInt(activityResult.content, 10);
      const gapSeconds = (Date.now() - lastActivity) / 1000;
      if (gapSeconds > 300) {
        const gapMin = Math.round(gapSeconds / 60);
        cacheWarning = `[cache-timeout] ${gapMin} Min. Pause — Prompt-Cache abgelaufen. Erw\u00e4ge /compact vor dem Weiterarbeiten.`;
      }
    }
    // No activityResult = first message in session → no warning
  } catch {}

  // --- Direct ship intent keywords (shared with prompt.flow.title-work) ---
  const request = parseShipRequest(hook.prompt || hook.user_message || hook.message || '');
  const isDirectShipIntent = request.ship;

  // --- Affirmation after completion card (short messages) ---
  const affirmations = [
    /^ja[.,!]?$/,
    /^yes[.,!]?$/,
    /^yep[.,!]?$/,
    /^mach[.,!]?$/,
    /^go[.,!]?$/,
    /^do\s+it[.,!]?$/,
    /^klar[.,!]?$/,
    /^bitte[.,!]?$/,
    /^jap[.,!]?$/,
    /^sicher[.,!]?$/,
    /^auf\s+jeden[.,!]?$/,
    /^ship\s+it[.,!]?$/,
  ];

  let isAffirmationAfterCompletion = false;
  if (affirmations.some(re => re.test(userMessage))) {
    const counterResult = readSessionFile('dotclaude-devops-edits', hook.session_id);
    if (counterResult) {
      const editCount = parseInt(counterResult.content, 10) || 0;
      if (editCount >= 1) {
        isAffirmationAfterCompletion = true;
      }
    }
  }

  if (!isDirectShipIntent && !isAffirmationAfterCompletion) {
    // No ship intent — but still emit cache-timeout warning if applicable
    if (cacheWarning) {
      process.stdout.write(cacheWarning + '\n');
    }
    process.exit(0);
  }

  // --- Guard: skip injection in non-git directories ---
  if (!isGitRepo(process.cwd())) {
    process.exit(0);
  }

  // --- Careful compact before ship: measure the context, stop before the
  // pipeline pays for it (lib/ship-compact.js has the numbers and the why).
  // Only user prompts reach this hook, so a ship an orchestrator invokes via
  // the Skill tool is never held up here. `--no-compact` skips it once, and
  // the ship prompt right after an advice runs: the marker is this session's
  // alone (exact read), set by an advice and consumed by the next ship prompt.
  const advisedFile = sessionFile(ADVISED_PREFIX, hook.session_id);
  const advisedBefore = !!readSessionFile(ADVISED_PREFIX, hook.session_id, { exact: true });
  if (advisedBefore) { try { fs.unlinkSync(advisedFile); } catch {} }
  let advice = shipCompactAdvice({
    tokens: currentContextTokens(hook.transcript_path),
    prompt: hook.prompt || hook.user_message || hook.message || '',
    advisedBefore,
  });
  // A promotion with nothing to ship first is cheap — no stop. The git probe
  // runs only here, when the advice would otherwise fire.
  if (advice && isDirectShipIntent && request.promote && !hasUnshippedWork(process.cwd())) {
    advice = null;
  }
  if (advice) {
    try { writeSessionFile(advisedFile, String(Date.now())); } catch {}
    process.stdout.write([...(cacheWarning ? [cacheWarning, ''] : []), advice].join('\n') + '\n');
    process.exit(0);
  }

  // --- Inject ship instruction (soft guidance, no flag files) ---
  const reason = isDirectShipIntent
    ? `Ship intent detected: "${userMessage}"`
    : `Affirmation after code changes: "${userMessage}"`;

  // The skill argument: the target channel above alpha (+ a named version),
  // or "promote" for a bare promotion. Alpha is the default — no argument.
  const promoteArgs = isDirectShipIntent && request.promote
    ? [request.channel && request.channel !== 'alpha' ? request.channel : 'promote', request.version].filter(Boolean).join(' ')
    : '';
  const mandate = promoteArgs
    ? [
      `MANDATORY: Use Skill("do-ship") with args "${promoteArgs}".`,
      request.channel === 'beta' || request.channel === 'stable'
        ? `Target channel: ${request.channel}. do-ship ships any unshipped work of this branch to alpha first, then promotes to ${request.channel} (skills/do-ship/modes/promote.md) and ends with ONE card.`
        : 'A promotion without a channel: do-ship asks which promotion (skills/do-ship/modes/promote.md).',
    ]
    : ['MANDATORY: Use Skill("do-ship") to execute the full shipping pipeline.'];

  const instruction = [
    ...(cacheWarning ? [cacheWarning, ''] : []),
    `[prompt.ship.detect] ${reason}`,
    '',
    ...mandate,
    'Do NOT manually run git commit, git push, or create/merge PRs outside the skill.',
    'The /do-ship skill handles: pre-flight checks, build, version bump, commit,',
    'push, PR, merge, sync, cleanup, and the completion card.',
    '',
    'If the user seems to want only a commit (not shipping), commit inline per deep-knowledge/commit-conventions.md — there is no commit skill.',
  ].join('\n');

  process.stdout.write(instruction + '\n');
});
