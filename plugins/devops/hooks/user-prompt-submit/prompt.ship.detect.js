#!/usr/bin/env node
/**
 * @hook prompt.ship.detect
 * @version 0.4.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detect ship intent in user prompts and inject Skill('ship') instruction.
 *   Triggers on keywords like "ship", "shippen", "ab damit", "mach nen PR",
 *   "merge it", "das kann rein", "fertig", and affirmations after a completion
 *   card ("ja", "yes", "mach", "go", "do it"). The keyword list lives in
 *   lib/ship-intent.js, shared with prompt.flow.title-work so a ship prompt
 *   is marked `🚀 Shipping – ` in the sidebar, never the bare `⏳ `.
 *   Above a context threshold the hook emits the careful-compact advice from
 *   lib/ship-compact.js INSTEAD of the ship instruction: the ship would
 *   re-read that context ~16 times, and only the user can compact.
 */

require('../lib/plugin-guard');

const { execFileSync } = require('child_process');
const { readSessionFile } = require('../lib/session-id');
const { isShipIntent } = require('../lib/ship-intent');
const { currentContextTokens } = require('../lib/context-size');
const { shipCompactAdvice } = require('../lib/ship-compact');

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
  const isDirectShipIntent = isShipIntent(hook.prompt || hook.user_message || hook.message || '');

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
  // the Skill tool is never held up here. `--no-compact` skips it once.
  const advice = shipCompactAdvice({
    tokens: currentContextTokens(hook.transcript_path),
    prompt: hook.prompt || hook.user_message || hook.message || '',
  });
  if (advice) {
    process.stdout.write([...(cacheWarning ? [cacheWarning, ''] : []), advice].join('\n') + '\n');
    process.exit(0);
  }

  // --- Inject ship instruction (soft guidance, no flag files) ---
  const reason = isDirectShipIntent
    ? `Ship intent detected: "${userMessage}"`
    : `Affirmation after code changes: "${userMessage}"`;

  const instruction = [
    ...(cacheWarning ? [cacheWarning, ''] : []),
    `[prompt.ship.detect] ${reason}`,
    '',
    'MANDATORY: Use Skill("ship") to execute the full shipping pipeline.',
    'Do NOT manually run git commit, git push, or create/merge PRs outside the skill.',
    'The /ship skill handles: pre-flight checks, build, version bump, commit,',
    'push, PR, merge, sync, cleanup, and the completion card.',
    '',
    'If the user seems to want only a commit (not shipping), commit inline per deep-knowledge/commit-conventions.md — there is no commit skill.',
  ].join('\n');

  process.stdout.write(instruction + '\n');
});
