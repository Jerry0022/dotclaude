#!/usr/bin/env node
/**
 * @hook prompt.ship.detect
 * @version 0.8.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detect ship intent in user prompts and inject Skill('devops:do-ship') instruction.
 *   Triggers on keywords like "ship", "shippen", "ab damit", "mach nen PR",
 *   "merge it", "das kann rein", "fertig", and affirmations after a completion
 *   card ("ja", "yes", "mach", "go", "do it"). The keyword list lives in
 *   lib/ship-intent.js, shared with prompt.flow.title-work so a ship prompt
 *   is marked `🚀 Shipping – ` in the sidebar, never the bare `⏳ `.
 *   Above a context threshold the mandate becomes the delegate instruction
 *   from lib/ship-delegate.js: the ship would re-read that context ~16
 *   times, so the main session briefs a fresh-context subagent that runs
 *   do-ship --delegated and hands the card back. `--inline` opts out once.
 *   Target channel (promote folded into do-ship, skill restructure PR 2):
 *   "ship stable", "promote to beta", "release beta", "auf stable heben",
 *   `/promote stable` — lib/ship-intent.js parses the channel and the hook
 *   passes it as the skill argument (`Skill("devops:do-ship") with args "stable"`):
 *   do-ship ships any unshipped work to alpha, then promotes. A bare
 *   "promote" passes `promote` (do-ship asks which promotion). This hook
 *   owns every do-ship prompt; the trigger router stays silent on them.
 *   A promotion-only prompt (nothing unshipped, lib/ship-unshipped.js) never
 *   is delegated — the run is ~4 calls, not ~16.
 *   A promotion that names a version ("promote stable 0.193.0", the card's
 *   promote buttons) is promotion-only by definition: the mandate forbids
 *   shipping new work, so a stale button click never ships later edits.
 *   The git-repo probe goes through lib/git-timeout.js's gitOut
 *   (GIT_TIMEOUT_MS; it had no timeout before).
 */

// A lib that fails to load (half-written during a plugin update, version skew)
// makes this hook a silent no-op instead of a hook error on every prompt
// (AUD-028).
let gitOut, readSessionFile, parseShipRequest,
  hasUnshippedWork, currentContextTokens, shouldDelegate, shipDelegateInstruction;
try {
  require('../lib/plugin-guard');
  ({ gitOut } = require('../lib/git-timeout'));
  ({ readSessionFile } = require('../lib/session-id'));
  ({ parseShipRequest } = require('../lib/ship-intent'));
  ({ hasUnshippedWork } = require('../lib/ship-unshipped'));
  ({ currentContextTokens } = require('../lib/context-size'));
  ({ shouldDelegate, shipDelegateInstruction } = require('../lib/ship-delegate'));
} catch (err) {
  // Silent to the user and the model (exit 0), but not traceless: the line
  // lands in the hook log, so a persistent load error can be found (AUD-068).
  process.stderr.write(`[prompt.ship.detect] off — a lib failed to load: ${(err && err.message) || err}\n`);
  process.exit(0);
}

const path = require('path');

/** The installed plugin root, for the delegated mode's doc path. */
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Returns true if cwd is inside a git work tree.
 * @param {string} cwd
 * @returns {boolean}
 */
function isGitRepo(cwd) {
  return gitOut(cwd, ['rev-parse', '--is-inside-work-tree']) !== null;
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
    // Exact read: an affirmation starts a ship, which pushes and merges — only
    // THIS session's edits may arm it, never the newest counter of another
    // session (what the glob fallback returns when this session has none).
    const counterResult = readSessionFile('dotclaude-devops-edits', hook.session_id, { exact: true });
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

  // --- Inject ship instruction (soft guidance, no flag files) ---
  const reason = isDirectShipIntent
    ? `Ship intent detected: "${userMessage}"`
    : `Affirmation after code changes: "${userMessage}"`;

  // The skill argument: the target channel above alpha (+ a named version),
  // or "promote" for a bare promotion. Alpha is the default — no argument.
  const promoteArgs = isDirectShipIntent && request.promote
    ? [request.channel && request.channel !== 'alpha' ? request.channel : 'promote', request.version].filter(Boolean).join(' ')
    : '';
  const aboveAlpha = request.channel === 'beta' || request.channel === 'stable';
  let promoteNote;
  if (request.version) {
    promoteNote = `Promotion ONLY of v${request.version}${aboveAlpha ? ` to ${request.channel}` : ' (do-ship asks which channel)'} — do NOT ship any unshipped work of this branch, not even when there is some: a named version is promotion-only (skills/do-ship/modes/promote.md).`;
  } else if (aboveAlpha) {
    promoteNote = `Target channel: ${request.channel}. do-ship ships any unshipped work of this branch to alpha first, then promotes to ${request.channel} (skills/do-ship/modes/promote.md) and ends with ONE card.`;
  } else {
    promoteNote = 'A promotion without a channel: do-ship asks which promotion (skills/do-ship/modes/promote.md).';
  }
  let mandate = promoteArgs
    ? [`MANDATORY: Use Skill("devops:do-ship") with args "${promoteArgs}".`, promoteNote]
    : ['MANDATORY: Use Skill("devops:do-ship") to execute the full shipping pipeline.'];

  // --- Large context: the ship runs in a fresh-context subagent
  // (lib/ship-delegate.js has the numbers and the why). Only user prompts
  // reach this hook, so an orchestrator's Skill-tool ship is never
  // redirected. A promotion with nothing to ship first is cheap, and one
  // that names its version never ships — both stay inline; the git probe
  // runs only when delegation would otherwise apply.
  const tokens = currentContextTokens(hook.transcript_path);
  const prompt = hook.prompt || hook.user_message || hook.message || '';
  if (shouldDelegate({ tokens, prompt })
    && !(isDirectShipIntent && request.promote && (request.version || !hasUnshippedWork(process.cwd())))) {
    mandate = [
      shipDelegateInstruction({ tokens, skillArgs: promoteArgs, pluginRoot: PLUGIN_ROOT }),
      ...(promoteArgs ? ['', promoteNote] : []),
    ];
  }

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
