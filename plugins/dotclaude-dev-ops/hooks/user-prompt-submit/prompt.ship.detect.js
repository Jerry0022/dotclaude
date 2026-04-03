#!/usr/bin/env node
/**
 * @hook prompt.ship.detect
 * @version 0.2.0
 * @event UserPromptSubmit
 * @plugin dotclaude-dev-ops
 * @description Detect ship intent in user prompts and inject Skill('ship') instruction.
 *   Triggers on keywords like "ship", "shippen", "ab damit", "mach nen PR",
 *   "merge it", "das kann rein", "fertig", and affirmations after a completion
 *   card ("ja", "yes", "mach", "go", "do it").
 */

require('../lib/plugin-guard');

const { readSessionFile } = require('../lib/session-id');

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
    process.exit(0);
  }

  // --- Inject ship instruction (soft guidance, no flag files) ---
  const reason = isDirectShipIntent
    ? `Ship intent detected: "${userMessage}"`
    : `Affirmation after code changes: "${userMessage}"`;

  const instruction = [
    `[prompt.ship.detect] ${reason}`,
    '',
    'MANDATORY: Use Skill("ship") to execute the full shipping pipeline.',
    'Do NOT manually run git commit, git push, or create/merge PRs outside the skill.',
    'The /ship skill handles: pre-flight checks, build, version bump, commit,',
    'push, PR, merge, sync, cleanup, and the completion card.',
    '',
    'If the user seems to want only a commit (not shipping), use Skill("commit") instead.',
  ].join('\n');

  process.stdout.write(instruction + '\n');
});
