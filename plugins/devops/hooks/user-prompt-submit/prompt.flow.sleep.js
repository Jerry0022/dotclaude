#!/usr/bin/env node
/**
 * @hook prompt.flow.sleep
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detect a bedtime announcement ("ich gehe jetzt ins Bett",
 *   "geh schlafen", "going to bed", "gute Nacht") and route the turn into
 *   do-run with the `sleep` preset, so the "PC danach" question (shutdown /
 *   auto-resume) is asked BEFORE the user leaves. Before this hook the
 *   phrases matched no trigger: the model either kept working interactively
 *   or improvised an autonomous run without ever asking about the PC, and the
 *   resume gate hid the question for short runs.
 *
 *   First person only: "die Lobbys gehen schlafen nach 10 min" or a prompt
 *   that talks ABOUT bedtime ("wenn ich ins Bett gehe, soll …") is no
 *   announcement — a conditional word right before the phrase drops it, and
 *   the injected text leaves the final call to the model.
 */

/**
 * Conditional lead-ins in the same clause: the phrase describes a case, not
 * the present ("…, dass ich ins Bett gehe oder schlafen gehe").
 */
const CONDITIONAL_RE = /\b(?:dass|wenn|falls|sobald|bevor|nachdem|when|if|before|once|whenever)\b[^.!?,;:\n]{0,40}$/;

const PATTERNS = [
  // de — "ich geh(e) jetzt ins Bett", "gehe gleich schlafen", "geheh ejetzt schlafen"
  /\bgeh(?:e|eh)?\s+(?:\S+\s+){0,4}?(?:ins\s+bett|schlafen|pennen)\b/,
  // de — "ins Bett gehe", "schlafen gehe" (first person, verb last)
  /\b(?:ins\s+bett|schlafen|pennen)\s+gehe\b/,
  // de — "kann ich ja jetzt schlafen gehen", "ich werde heute nacht schlafen"
  /\bich\b(?:\s+\S+){0,4}?\s+(?:ins\s+bett|schlafen|pennen)\s+gehen\b/,
  /\bich\s+werde\s+(?:\S+\s+){0,3}?(?:schlafen|ins\s+bett\s+gehen)\b/,
  /\bleg(?:e)?\s+mich\s+(?:\S+\s+){0,2}?(?:hin|schlafen|aufs\s+ohr)\b/,
  /\bgute\s+nacht\b/,
  // en
  /\b(?:i'?m\s+|i\s+am\s+)?(?:going|heading|off)\s+to\s+(?:bed|sleep)\b/,
  /\bgo(?:ing)?\s+to\s+(?:bed|sleep)\s+now\b/,
  /\bgood\s*night\b/,
  /\bcalling\s+it\s+a\s+night\b/,
  /\bhit(?:ting)?\s+the\s+(?:sack|hay)\b/,
];

/** Fenced code, inline code and quoted strings never count. */
function stripQuoted(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/"[^"\n]*"|„[^“\n]*“|“[^”\n]*”|»[^«\n]*«|«[^»\n]*»/g, ' ');
}

/**
 * True when the prompt announces that the user goes to sleep now.
 * @param {string} prompt
 */
function isBedtime(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) return false;
  const text = stripQuoted(prompt.toLowerCase());
  for (const re of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (CONDITIONAL_RE.test(before)) continue;
    return true;
  }
  return false;
}

function instruction() {
  return [
    '[prompt.flow.sleep] The user announces they are going to sleep — away for hours, about to leave.',
    'Unless the prompt only talks ABOUT bedtime (a plan, a quote, a feature request), load',
    'Skill("devops:do-run") with args "sleep <the prompt\'s task, if any>" BEFORE any other work.',
    'The `sleep` preset (do-run Step 1): Q2 shows only its Autonom options, Q3 is dropped (Flexibel),',
    'and F6 "PC danach" is ALWAYS asked — the resume gate is bypassed — inside the SAME',
    'AskUserQuestion call as the base questions: the user answers once and goes.',
    'Nothing left to do ("Rest machen wir morgen") → ask F6 alone and act on it.',
    'MID-RUN COMMENT — work is already running in this session (agents spawned, a do-run or',
    'implementation under way, a background task open): do NOT restart it and do NOT re-ask the',
    'base call. Keep every running agent and task, ask F6 alone (plus "Autonom · Ship manuell /',
    'automatisch" when the ship decision is still open), apply the answer to the running work',
    '(do-run § Bedtime) and continue where it stands.',
  ].join('\n');
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      require('../lib/plugin-guard');
      const hook = JSON.parse(inputData);
      if (require('../lib/batch-state').willBeCollected(hook)) process.exit(0);
      const raw = hook.prompt || hook.user_message || hook.message || '';
      if (require('../lib/non-user-prompt').isNonUserPrompt(raw)) process.exit(0);
      if (!isBedtime(raw)) process.exit(0);
      process.stdout.write(instruction() + '\n');
    } catch { /* fail open */ }
    process.exit(0);
  });
}

module.exports = { isBedtime, instruction };
