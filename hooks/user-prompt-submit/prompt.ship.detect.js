#!/usr/bin/env node
/**
 * @hook prompt.ship.detect
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin dotclaude-dev-ops
 * @description Detect ship intent in user prompts and enforce Skill('ship').
 *   Triggers on keywords like "ship", "shippen", "ab damit", "mach nen PR",
 *   "merge it", "das kann rein", "fertig", and affirmations after a completion
 *   card ("ja", "yes", "mach", "go", "do it").
 *
 *   When detected, injects a mandatory instruction to use Skill('ship')
 *   instead of manual git/gh commands.
 */

const fs = require('fs');
const { sessionFile } = require('../lib/session-id');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const userMessage = (hook.user_message || hook.message || '').toLowerCase().trim();
  if (!userMessage) process.exit(0);

  // --- Direct ship intent keywords ---
  const shipKeywords = [
    /\bship\b/,
    /\bship(?:pen|pe)\b/,
    /\bab\s+damit\b/,
    /\bmach\s+(?:nen?|einen?)\s+pr\b/,
    /\bmerge\s+it\b/,
    /\bpush\s+and\s+merge\b/,
    /\bdas\s+kann\s+rein\b/,
    /\bfertig\b/,
    /\bausliefern\b/,
    /\braushauen\b/,
    /\brelease\b/,
    /\bpr\s+erstellen\b/,
  ];

  const isDirectShipIntent = shipKeywords.some(re => re.test(userMessage));

  // --- Affirmation after completion card (short messages) ---
  // When user says "ja", "yes", "mach", "go" etc. after a completion card was shown,
  // they almost certainly mean "ship it". We detect this via the edit counter
  // (completion card is shown after edits) + short affirmation.
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
    // Check if there were code edits in this session (completion card was likely shown)
    const counterFile = sessionFile('dotclaude-devops-edits', hook.session_id);
    try {
      const editCount = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0;
      if (editCount >= 1) {
        isAffirmationAfterCompletion = true;
      }
    } catch {}
  }

  if (!isDirectShipIntent && !isAffirmationAfterCompletion) {
    process.exit(0);
  }

  // --- Set session-scoped ship-flow flag (used by pre.ship.guard to allow PR commands) ---
  const flagFile = sessionFile('dotclaude-devops-ship-flow', hook.session_id);
  try { fs.writeFileSync(flagFile, Date.now().toString()); } catch {}

  // --- Inject mandatory ship instruction ---
  const reason = isDirectShipIntent
    ? `Ship intent detected: "${userMessage}"`
    : `Affirmation after code changes: "${userMessage}"`;

  const instruction = [
    `[prompt.ship.detect] ${reason}`,
    '',
    'MANDATORY: Use Skill("ship") to execute the full shipping pipeline.',
    'Do NOT manually run git commit, git push, gh pr create, or gh pr merge.',
    'The /ship skill handles: pre-flight checks, build, version bump, commit,',
    'push, PR, merge, sync, cleanup, and the completion card.',
    '',
    'If the user seems to want only a commit (not shipping), use Skill("commit") instead.',
  ].join('\n');

  process.stdout.write(instruction + '\n');
});
