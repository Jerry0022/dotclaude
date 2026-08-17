#!/usr/bin/env node
/**
 * @hook prompt.batch.collect
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Collect mode for `/claude-batch`: while active, blocks the user
 *   prompt (exit 2 — the harness erases it, so it never reaches the model) and
 *   appends it to `.claude/batch.md`. A prompt starting with the configured
 *   execute marker instead fires the merge: the whole note list is injected as
 *   context and Claude works the collected intent as ONE plan.
 *
 *   Why: eight observations sent one by one are eight turns, each paying the
 *   full accumulated context. Worse, observation five routinely supersedes
 *   observation one — anything built for one was built for nothing. Collecting
 *   first and merging once removes both costs.
 *
 *   Never collects (see batch-state.js for the reasoning):
 *     - machine prompts (crons, AUTONOMOUS_*, silent markers)
 *     - expanded slash commands (<command-name> tag)
 *     - prompts carrying attachments or @file mentions
 *
 *   The marker can never start with `!`, `/`, `#` or `@`: the harness claims
 *   those before a prompt exists (bash mode, slash command, memory capture, file
 *   mention), so this hook would never see the escape at all.
 *
 *   Failsafe: the mode file carries an expiry and a note cap, so a bug in the
 *   marker comparison can never lock the user out of their own session.
 *
 *   Spec: docs/superpowers/specs/2026-08-16-claude-batch-design.md
 */

require('../lib/plugin-guard');

const B = require('../lib/batch-state');

/** Inline the notes up to this size; beyond it, point Claude at the file so the
 *  token guard governs the read instead of the hook forcing it. */
const INLINE_LIMIT = 8000;

/**
 * Acknowledgement shown to the user on a blocked (collected) prompt.
 *
 * The harness renders every UserPromptSubmit block as a red "a hook blocked
 * your input" panel — that framing is not ours to change, and blocking IS the
 * mechanism the mode runs on. So the first line has to carry the all-clear:
 * the note landed, nothing failed.
 *
 * @param {number} count total notes after this one
 * @param {string} marker configured execute marker
 * @param {boolean} question whether the note reads like a question
 */
function buildAck(count, marker, question) {
  const lines = [
    `[claude-batch] ✓ Notiz #${count} gespeichert — alles korrekt, kein Fehler.`,
    'Der Sammelmodus stoppt den Prompt absichtlich, statt ihn zu bearbeiten.',
  ];
  if (question) {
    // Advisory only. The hook never decides what is a question; it just makes a
    // forgotten marker visible instead of silent.
    lines.push(
      `Das sah nach einer Frage aus. Als Notiz gespeichert — schick sie mit "${marker}" davor,`,
      'wenn du jetzt eine Antwort willst.',
    );
  }
  lines.push(`"${marker} <text>" startet die Umsetzung aller ${count} Notizen · /claude-batch off beendet den Modus.`);
  return lines.join('\n');
}

/**
 * Context injected into the merge turn.
 * @param {{at:string,text:string}[]} notes
 * @param {string} rest the user's text after the marker
 * @param {string} notesFile absolute path to the notes file
 */
function buildMergeContext(notes, rest, notesFile) {
  const head = [
    `[claude-batch] Der Nutzer hat ${notes.length} Notiz(en) gesammelt und löst jetzt die Umsetzung aus.`,
    '',
    'Arbeite NICHT die Notizen einzeln ab. Gehe so vor:',
    '1. Führe die Notizen zu EINEM Gesamtvorhaben zusammen.',
    '2. Prüfe die Machbarkeit gegen den echten Code, bevor du planst.',
    '3. Liste Widersprüche EINZELN auf ("#2 wollte rot, #6 blau") statt sie still',
    '   nach "später gewinnt" aufzulösen. Unmögliche Punkte werden benannt,',
    '   nicht umgangen.',
    '4. Lege den Plan zur Freigabe vor. Danach: /concept wenn die Konflikte eine',
    '   Entscheidungsseite rechtfertigen, sonst direkt in die Umsetzung.',
    '',
    'Umsetzung ist breit gemeint — Code, Concepting, UI-Concepting, oder auch nur',
    'ein erster Schritt.',
    '',
  ];

  const body = notes.map((n, i) => `--- Notiz #${i + 1} (${n.at}) ---\n${n.text}`).join('\n\n');
  const tail = rest ? ['', '--- Zusätzlich zu diesen Notizen sagt der Nutzer jetzt ---', rest] : [];

  const inline = [...head, body, ...tail].join('\n');
  if (inline.length <= INLINE_LIMIT) return inline;

  return [
    ...head,
    `Die Notizen sind zu umfangreich für die Injektion (${inline.length} Zeichen).`,
    `Lies sie zuerst vollständig aus: ${notesFile}`,
    ...tail,
  ].join('\n');
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  // Field name varies across hook types in this codebase — cover all three.
  // Reading only `user_message` would yield '' here and destroy every prompt.
  const text = hook.prompt || hook.user_message || hook.message || '';
  const cwd  = hook.cwd || process.cwd();

  let modeActive;
  try { modeActive = B.isModeActive(cwd); } catch { process.exit(0); }
  if (!modeActive) {
    // Not collecting — but a real user prompt still advances the clock the
    // watchdog reads, so a later activation starts from a truthful timestamp.
    try { if (!B.isMachinePrompt(text)) B.touchActivity(cwd); } catch { /* non-fatal */ }
    process.exit(0);
  }

  const marker = B.effectiveMarker(cwd);
  let verdict;
  try {
    verdict = B.classify({ text, hookInput: hook, marker, modeActive: true });
  } catch {
    process.exit(0); // never let a classification bug swallow a prompt
  }

  if (verdict === 'passthrough') {
    try { if (!B.isMachinePrompt(text)) B.touchActivity(cwd); } catch { /* non-fatal */ }
    process.exit(0);
  }

  if (verdict === 'execute') {
    try {
      B.touchActivity(cwd);
      const notes = B.readNotes(cwd);
      if (notes.length === 0) process.exit(0); // nothing collected — normal turn
      const rest = B.stripMarker(text, marker);
      process.stdout.write(buildMergeContext(notes, rest, B.notesPath(cwd)) + '\n');
    } catch { /* non-fatal — the turn still runs */ }
    process.exit(0);
  }

  // verdict === 'collect' — block the prompt and store it.
  try {
    const count = B.appendNote(cwd, text);
    B.touchActivity(cwd);
    process.stderr.write(buildAck(count, marker, B.looksLikeQuestion(text)) + '\n');
    process.exit(2);
  } catch (err) {
    // Storing failed — blocking now would erase the prompt with nothing kept.
    // Let it through instead; a lost prompt is worse than a missed collection.
    process.stderr.write(`[claude-batch] Notiz konnte nicht gespeichert werden (${err.message}) — Prompt läuft normal weiter.\n`);
    process.exit(0);
  }
});

module.exports = { buildAck, buildMergeContext, INLINE_LIMIT };
