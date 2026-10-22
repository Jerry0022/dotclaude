#!/usr/bin/env node
/**
 * @hook prompt.ship.detect
 * @version 0.9.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detect ship intent in user prompts and inject Skill('devops:do-ship') instruction.
 *   Triggers on keywords like "ship", "shippen", "ab damit", "mach nen PR",
 *   "merge it", "das kann rein", "fertig", and bare affirmations ("ja",
 *   "yes", "ok", "passt", "mach", "go", "do it") — those ONLY when the turn
 *   right before ended on a completion card whose decision asks to ship
 *   (ready / test with the ship question; never analysis, concept, question,
 *   blocked, or an already-shipped ship-successful / released card — read
 *   from the transcript via lib/card-guard) AND the branch still has
 *   unshipped work (lib/ship-unshipped.js). The keyword list lives in
 *   lib/ship-intent.js, shared with prompt.flow.title-work so a ship prompt
 *   is marked `⏳ ┃ 🚀 Shipping ` in the sidebar, never the bare `⏳ `.
 *   Above a context threshold the mandate becomes the delegate instruction
 *   from lib/ship-delegate.js: the ship would re-read that context ~25
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
 *   is delegated — the run is ~4 calls, not ~25.
 *   A promotion that names a version ("promote stable 0.193.0", the card's
 *   promote buttons) is promotion-only by definition: the mandate forbids
 *   shipping new work, so a stale button click never ships later edits.
 *   The git-repo probe goes through lib/git-timeout.js's gitOut
 *   (GIT_TIMEOUT_MS; it had no timeout before).
 */

// A lib that fails to load (half-written during a plugin update, version skew)
// makes this hook a silent no-op instead of a hook error on every prompt
// (AUD-028).
let gitOut, parseShipRequest, cardDelivered, deliveredCardText, lastAssistantText, isCardWidgetCall,
  safeReadTranscript, CARD_MARKER, isPromptEntry, lastUserPromptText,
  hasUnshippedWork, currentContextTokens, shouldDelegate, shipDelegateInstruction, shipResumeInstruction, shipResumeFor, cleanupLeftoverFor, cleanupLeftoverInstruction, isContinuation;
try {
  require('../lib/plugin-guard');
  ({ gitOut } = require('../lib/git-timeout'));
  ({ cardDelivered, deliveredCardText, lastAssistantText, isCardWidgetCall, safeReadTranscript, CARD_MARKER } = require('../lib/card-guard'));
  ({ isPromptEntry, lastUserPromptText } = require('../lib/skill-invocations'));
  ({ parseShipRequest } = require('../lib/ship-intent'));
  ({ hasUnshippedWork } = require('../lib/ship-unshipped'));
  ({ currentContextTokens } = require('../lib/context-size'));
  ({ shouldDelegate, shipDelegateInstruction, shipResumeInstruction } = require('../lib/ship-delegate'));
  ({ isContinuation, shipResumeFor, cleanupLeftoverFor, cleanupLeftoverInstruction } = require('../lib/ship-resume'));
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

/**
 * The transcript as it stood before this prompt: when the harness already
 * appended the prompt being submitted, that last entry is cut off, so the
 * card scan reads the previous turn and not the new, card-less one.
 * @param {string} content
 * @param {string} prompt
 */
function priorTurnTranscript(content, prompt) {
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { return content; }
    if (entry && entry.type === 'user' && isPromptEntry(entry)
      && lastUserPromptText(raw).trim() === String(prompt || '').trim()) {
      return lines.slice(0, i).join('\n');
    }
    return content;
  }
  return content;
}

/** A decision that asks to ship: "Shippen?", "Trotzdem shippen", "push and merge". */
const SHIP_QUESTION_RE = /\bship(?:pen|t)?\b|\bpush\s+(?:and|und)\s+merge/i;
/** Cards whose question is not "ship this work": already shipped, promoted, or a gate bypass. */
const NOT_A_SHIP_QUESTION_RE = /released|promoted|blocked|⛔|\u{1F680}|\u{1F38A}/iu;

/** The decision (heading + button prompts) of the last card widget of the turn, '' when none. */
function widgetDecision(transcript) {
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (entry.type === 'user' && isPromptEntry(entry)) return '';
    const content = entry.type === 'assistant' && entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (let b = content.length - 1; b >= 0; b--) {
      const block = content[b];
      if (!block || block.type !== 'tool_use' || !isCardWidgetCall(block.name, block.input)) continue;
      const code = String(block.input.widget_code || '');
      const m = code.match(/id=["']dc-card-data["'][^>]*>([\s\S]*?)<\/script>/);
      if (!m) return '';
      try {
        const d = JSON.parse(m[1]);
        const prompts = Array.isArray(d.bt) ? d.bt.map(x => (x && x.p) || '') : [];
        return { heading: String(d.h || ''), prompts };
      } catch {
        return '';
      }
    }
  }
  return '';
}

/**
 * Did the turn right before this prompt end on a completion card whose
 * decision asks to ship (ready / test with the ship question)? Not an
 * analysis, a concept waiting, a question card, or an already-shipped
 * ship-successful / released card — and not when the turn went on to ask a
 * question of its own after the card. Unreadable → false (no ship).
 * @param {string} transcript the transcript up to (not including) this prompt
 */
function cardAsksToShip(transcript) {
  if (!transcript || !cardDelivered(transcript)) return false;
  const tail = (lastAssistantText(transcript) || '').trim();
  if (tail && !tail.includes(CARD_MARKER) && /\?\s*$/.test(tail)) return false;
  const text = deliveredCardText(transcript);
  const heading = (text.match(/^##\s+(.+)$/m) || [])[1];
  if (heading) return SHIP_QUESTION_RE.test(heading) && !NOT_A_SHIP_QUESTION_RE.test(heading);
  const w = widgetDecision(transcript);
  if (!w || NOT_A_SHIP_QUESTION_RE.test(w.heading)) return false;
  return SHIP_QUESTION_RE.test(w.heading) || w.prompts.some(p => /^\s*ship\b/i.test(p));
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
    /^ok(?:ay)?[.,!]?$/,
    /^passt[.,!]?$/,
    /^(?:ja|yes|ok(?:ay)?)[,.!]?\s+passt[.,!]?$/,
  ];

  // An affirmation starts a ship, which pushes and merges — so it counts only
  // as the answer to a card that ASKED to ship, in the turn right before this
  // prompt, while the branch still carries unshipped work (audit row 2: an
  // edit counter that only ever grew turned every later "ja" into a ship).
  let isAffirmationAfterCompletion = false;
  if (affirmations.some(re => re.test(userMessage))) {
    let transcript = '';
    try { transcript = safeReadTranscript(hook.transcript_path); } catch { transcript = ''; }
    const prior = priorTurnTranscript(transcript || '', hook.prompt || hook.user_message || hook.message || '');
    if (cardAsksToShip(prior) && hasUnshippedWork(hook.cwd || process.cwd())) {
      isAffirmationAfterCompletion = true;
    }
  }

  // --- An interrupted ship waits here (lib/ship-checkpoint.js): "weiter",
  // "continue", an affirmation or a ship prompt picks it up at the step that
  // did not finish — delegated when the context is large, as a new ship is.
  const rawPrompt = hook.prompt || hook.user_message || hook.message || '';
  const resume = shipResumeFor(rawPrompt, hook.cwd || process.cwd());
  if (resume) {
    const delegate = shouldDelegate({ tokens: currentContextTokens(hook.transcript_path), prompt: rawPrompt });
    process.stdout.write([
      shipResumeInstruction({ resume, delegate, pluginRoot: PLUGIN_ROOT, sessionId: hook.session_id || '' })].join('\n') + '\n');
    process.exit(0);
  }

  // A merged ship with only its cleanup left is done, not interrupted (#806).
  if (isContinuation(rawPrompt)) {
    const leftover = cleanupLeftoverFor(hook.cwd || process.cwd());
    if (leftover) {
      process.stdout.write(cleanupLeftoverInstruction(leftover) + '\n');
      process.exit(0);
    }
  }

  if (!isDirectShipIntent && !isAffirmationAfterCompletion) {
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
  // reach this hook; a Skill-tool ship is redirected by pre.ship.delegate. A promotion with nothing to ship first is cheap, and one
  // that names its version never ships — both stay inline; the git probe
  // runs only when delegation would otherwise apply.
  const tokens = currentContextTokens(hook.transcript_path);
  const prompt = hook.prompt || hook.user_message || hook.message || '';
  if (shouldDelegate({ tokens, prompt })
    && !(isDirectShipIntent && request.promote && (request.version || !hasUnshippedWork(process.cwd())))) {
    mandate = [
      shipDelegateInstruction({ tokens, skillArgs: promoteArgs, pluginRoot: PLUGIN_ROOT, sessionId: hook.session_id || '' }),
      ...(promoteArgs ? ['', promoteNote] : []),
    ];
  }

  const instruction = [
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
