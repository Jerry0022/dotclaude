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
    'Der Sammelmodus ist mit diesem Prompt automatisch BEENDET. Folgeprompts sind',
    'die Unterhaltung über die Umsetzung und laufen wieder normal — frage NICHT,',
    'ob der Modus aktiv bleiben soll. Nur ein neues /claude-batch on sammelt wieder.',
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

/**
 * Guard injected when the prompt that ACTIVATES collect mode already carries the
 * user's first observations.
 *
 * That prompt is the one prompt the mode can never catch: collection is armed by
 * the turn it starts, so the hook sees it while the mode is still off and has to
 * let it through. What used to happen then is the whole failure mode of the
 * feature — the model reads actionable text, starts working it, skips the
 * marker dialog, and the notes are never filed. The mode ends up ON and EMPTY
 * while the work it was supposed to defer is already half-done.
 *
 * Guidance, not enforcement: the hook cannot store the text itself (nothing has
 * activated yet, and a "note" written for a question ABOUT the mode would be
 * corruption), so it states the rule in the turn where the decision is made.
 */
function buildActivationGuard() {
  return [
    '[claude-batch] Dieser Prompt startet den Sammelmodus UND trägt zusätzlichen Inhalt.',
    '',
    'Der Inhalt neben der Aktivierung ist NOTIZ, nicht Auftrag:',
    '1. Setze nichts davon um. Nicht planen, nicht recherchieren, nicht den Code',
    '   dafür lesen — der Modus existiert genau dafür, dass das später und',
    '   gebündelt passiert.',
    '2. Überspringe KEINEN Schritt des claude-batch-Skills. Die Marker-Rückfrage',
    '   (AskUserQuestion, Step 2.1) kommt zuerst, auch wenn der Prompt schon',
    '   Arbeit beschreibt. Ein Prompt voller Aufgaben ist kein Grund, den Dialog',
    '   zu überspringen — er ist der Grund, warum es ihn gibt.',
    '3. Nach dem Aktivieren: lege den Inhalt WÖRTLICH als erste Notiz ab',
    '   (`appendNote` aus hooks/lib/batch-state.js, Step 2.4) und nenne die',
    '   Notizzahl im Bestätigungsblock.',
    '',
    'Falls dieser Prompt den Modus gar nicht aktiviert — eine Frage ÜBER den',
    'Modus, Status, oder /claude-batch off —, ignoriere diesen Hinweis.',
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
    // The one prompt collection can never catch is the one that turns it on.
    // When it also carries work, say so before the model starts doing it.
    try {
      const act = B.detectActivation(text);
      if (act.activating && act.carriesContent) process.stdout.write(buildActivationGuard() + '\n');
    } catch { /* advisory only — never let this cost a turn */ }
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
      if (notes.length === 0) process.exit(0); // nothing collected — mode stays armed
      const rest = B.stripMarker(text, marker);
      process.stdout.write(buildMergeContext(notes, rest, B.notesPath(cwd)) + '\n');
      // Firing the merge ENDS collection. What follows is the conversation about
      // the implementation — approvals, answers to Claude's questions, course
      // corrections — and collecting those is actively wrong: they are blocked,
      // erased and answered by nobody. Re-arming is an explicit `/claude-batch on`.
      B.deactivate(cwd);
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

module.exports = { buildAck, buildMergeContext, buildActivationGuard, INLINE_LIMIT };
