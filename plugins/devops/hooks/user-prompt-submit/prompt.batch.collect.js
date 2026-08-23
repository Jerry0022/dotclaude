#!/usr/bin/env node
/**
 * @hook prompt.batch.collect
 * @version 0.3.0
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
 *   An attachment-carrying prompt is passed through, but NOT silently: the turn
 *   gets a guard telling it to file the prompt as a note together with a written
 *   description of the attachment. Without that the screenshot the note refers
 *   to is gone by merge time, and the note reads as "make it like the image"
 *   with no image anywhere.
 *
 *   The marker can never start with `!`, `/`, `#` or `@`: the harness claims
 *   those before a prompt exists (bash mode, slash command, memory capture, file
 *   mention), so this hook would never see the escape at all.
 *
 *   Failsafe: the mode file carries an expiry and a note cap, so a bug in the
 *   marker comparison can never lock the user out of their own session. The
 *   marker still fires the merge after such an auto-deactivation — the notes
 *   outlive the mode, and reaching them must not depend on it.
 *
 *   Spec: docs/superpowers/specs/2026-08-16-claude-batch-design.md
 */

require('../lib/plugin-guard');

const fs   = require('fs');
const path = require('path');
const B = require('../lib/batch-state');

/** Absolute path to the state module, so injected guidance can quote a command
 *  that actually runs — a relative require resolves against the wrong cwd. */
const STATE_MODULE = path.resolve(__dirname, '..', 'lib', 'batch-state.js');

/**
 * Inline the full note text up to this size.
 *
 * Beyond it the notes are NOT dropped in favour of a bare file pointer — that
 * was how a long queue lost items: the turn was told to read a file, read part
 * of it, and nothing in the context said what was missing. Over the limit the
 * context carries a numbered index of every note plus a mandatory full read, so
 * the count stays checkable even when the text does not fit.
 */
const INLINE_LIMIT = 24000;

/** Per-note excerpt length in the over-limit index. */
const EXCERPT_CHARS = 200;

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

/** One line per note: number, timestamp, first EXCERPT_CHARS characters. */
function noteIndexLine(note, i) {
  const flat = note.text.replace(/\s+/g, ' ').trim();
  const cut = flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)} …` : flat;
  return `#${i + 1} (${note.at}) ${cut}`;
}

/**
 * Context injected into the merge turn.
 *
 * @param {{at:string,text:string}[]} notes
 * @param {string} rest the user's text after the marker
 * @param {string} notesFile absolute path to the notes file
 * @param {{stale?:boolean}} [opts] stale = the mode had already ended (expired,
 *   note cap, or manually off) and the merge fires off the surviving notes
 */
function buildMergeContext(notes, rest, notesFile, opts = {}) {
  const n = notes.length;
  const head = [
    `[claude-batch] Der Nutzer hat ${n} Notiz(en) gesammelt und löst jetzt die Umsetzung aus.`,
    `Notizdatei: ${notesFile}`,
  ];
  if (opts.stale) {
    head.push(
      'Der Sammelmodus war zu diesem Zeitpunkt bereits beendet (abgelaufen, Notizlimit',
      'erreicht oder manuell aus). Die Notizen leben weiter und werden jetzt umgesetzt —',
      'sag das dem Nutzer in einer Zeile, statt es zu verschweigen.',
    );
  }
  head.push(
    '',
    `PFLICHT — Vollständigkeit. Es sind ${n} Notizen. Bevor du planst, schreibe eine`,
    `Abdeckungsliste mit GENAU ${n} Zeilen, #1 bis #${n}, jede mit einer Disposition:`,
    'übernommen · zusammengeführt mit #x · Konflikt mit #x · nicht machbar (Grund) ·',
    'Frage (wird zuerst beantwortet). Eine Notiz ohne eigene Zeile ist ein Fehler,',
    'kein Kürzen. Prüfe die Zeilenzahl gegen die Zahl oben, bevor du weitermachst.',
    '',
    'Anhänge gehören zu ihrer Notiz. Zeilen "[Anhang]" und "[Anhang-Datei]" innerhalb',
    'einer Notiz beschreiben genau diese Notiz — nie ein eigenes Thema, nie einer',
    'anderen Notiz zugeordnet. Wo eine "[Anhang-Datei]" existiert, sieh sie dir an,',
    'bevor du die Notiz bewertest.',
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
  );
  if (rest) {
    head.push(
      '',
      '--- Der Nutzer schreibt zusätzlich zum Auslöser ---',
      rest,
      '--- Ende ---',
      'Das ist Teil des Auftrags, kein Beiwerk. Ist es eine Frage, beantworte sie',
      `ZUERST und mach dann weiter. Enthält es Anforderungen, behandle sie wie Notiz #${n + 1}`,
      'und nimm sie in die Abdeckungsliste auf.',
    );
  }
  head.push('');

  const body = notes.map((x, i) => `--- Notiz #${i + 1} (${x.at}) ---\n${x.text}`).join('\n\n');
  const inline = [...head, body].join('\n');
  if (inline.length <= INLINE_LIMIT) return inline;

  // Over the limit: never emit a context without note content. An index of ALL
  // notes plus a forced full read keeps the count checkable; a bare pointer did
  // not, and that is how items went missing.
  const fixed = [
    ...head,
    `Die Notizen sind zu umfangreich für die vollständige Injektion (${inline.length} Zeichen).`,
    `Lies ${notesFile} VOLLSTÄNDIG, bevor du irgendetwas planst. Unten steht nur ein`,
    'gekürzter Index — er ersetzt den Notiztext nicht, er macht nur prüfbar, ob du',
    'alles hast.',
    '',
    `--- Index aller ${n} Notizen (gekürzt) ---`,
  ];
  const budget = INLINE_LIMIT - fixed.join('\n').length - 200;
  const shown = [];
  let used = 0;
  for (const [i, note] of notes.entries()) {
    const line = noteIndexLine(note, i);
    if (used + line.length + 1 > budget) break;
    shown.push(line);
    used += line.length + 1;
  }
  const out = [...fixed, ...shown];
  if (shown.length < n) {
    // No silent cap: a truncated index that looks complete is the same failure
    // as a dropped note.
    out.push(`… #${shown.length + 1} bis #${n} sind hier NICHT gelistet — hol sie aus der Datei.`);
  }
  return out.join('\n');
}

/**
 * Injected when the marker fires but the queue parses to nothing.
 *
 * Exiting silently here was data loss disguised as a normal turn: the model saw
 * a bare `>> mach jetzt` with no context and truthfully answered that it had no
 * notes, while `.claude/batch.md` sat there with ten. Anything that can make the
 * parse fail — a manual edit, a destroyed separator, an editor's CRLF — has to
 * end in a report naming the file, not in a confident denial.
 */
function buildEmptyQueueNotice(notesFile, exists, bytes, marker) {
  const lines = [
    `[claude-batch] Der Ausführungs-Marker "${marker}" wurde erkannt, aber aus der`,
    `Notizdatei ließ sich KEINE Notiz lesen: ${notesFile}`,
    `Datei vorhanden: ${exists ? `ja (${bytes} Bytes)` : 'nein'}`,
    '',
  ];
  if (exists && bytes > 0) {
    lines.push(
      'Sag dem Nutzer NICHT, es gebe keine Notizen. Die Datei hat Inhalt, nur der',
      'Parser findet darin keine Trenner (manuell editiert, Trennzeile zerstört).',
      'Vorgehen:',
      '1. Lies die Datei roh und vollständig.',
      '2. Steht dort Inhalt, benutze ihn als Notizen und führe den Merge normal durch',
      '   (zusammenführen, Machbarkeit prüfen, Widersprüche einzeln nennen, Plan zur',
      '   Freigabe). Sag in einer Zeile, dass die Datei repariert werden sollte.',
      '3. Ist sie wirklich leer, sag genau das — mit dem Pfad.',
    );
  } else {
    lines.push(
      'Die Warteschlange ist tatsächlich leer. Sag das mit dem Pfad dazu und dass der',
      'Sammelmodus weiter aktiv ist — er wurde nicht beendet. Bearbeite den Prompt',
      'ansonsten normal.',
    );
  }
  return lines.join('\n');
}

/**
 * Injected when a prompt carrying an attachment arrives while collecting.
 *
 * Such a prompt cannot be blocked — the harness erases blocked prompts, and an
 * erased screenshot is unrecoverable. So it passes through, and used to leave no
 * trace at all: the model acted on it immediately (the one thing the mode exists
 * to prevent) and the merge never learned it happened. The image, the whole
 * reason the note was written, was gone by merge time.
 *
 * The turn is the only place that can fix this, because the turn is the only
 * place the attachment is actually visible. So it is told to describe it into
 * the note while it can still see it.
 */
function buildAttachmentGuard(marker, refs) {
  const lines = [
    '[claude-batch] Sammelmodus ist AKTIV, aber dieser Prompt trägt einen Anhang',
    '(Bild, eingefügten Text oder @Datei) und konnte deshalb nicht automatisch',
    'abgelegt werden: ein blockierter Prompt wird aus der UI gelöscht, ein',
    'Screenshot wäre unwiederbringlich weg.',
    '',
    'Setze NICHTS davon um — nicht planen, nicht recherchieren, keinen Code dafür',
    'lesen. Lege den Prompt stattdessen JETZT als Notiz ab:',
    '',
    '1. Notiztext = der Prompt-Text WÖRTLICH, unverändert.',
    '2. Danach eine Zeile "[Anhang] <sachliche Beschreibung>". Du siehst den Anhang',
    '   in diesem Turn — beim Merge ist er nicht mehr im Kontext. Die Beschreibung',
    '   muss die Notiz ohne den Anhang verständlich machen: was ist zu sehen, was',
    '   ist daran das Problem.',
  ];
  if (refs.length) {
    lines.push(`3. Zusätzlich je eine Zeile "[Anhang-Datei] <pfad>". Bekannt: ${refs.join(', ')}`);
  } else {
    lines.push(
      '3. Ist ein Pfad bekannt (@Datei, gespeicherter Screenshot), zusätzlich eine',
      '   Zeile "[Anhang-Datei] <pfad>".',
    );
  }
  lines.push(
    '4. Speichern — eine Notiz, ein Aufruf:',
    `   node -e "require(process.argv[1]).appendNote(process.cwd(), process.argv[2])" "${STATE_MODULE}" "<notiztext>"`,
    '5. Antworte mit EINER Zeile: Notiz #<n> gespeichert, Anhang beschrieben.',
    '',
    `Alles Weitere bleibt gesammelt. "${marker} <text>" startet später die Umsetzung.`,
  );
  return lines.join('\n');
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
    '   Notizzahl im Bestätigungsblock. Trägt der Prompt einen Anhang, beschreibe',
    '   ihn in derselben Notiz als "[Anhang] <Beschreibung>" — beim Merge ist er',
    '   nicht mehr sichtbar.',
    '',
    'Falls dieser Prompt den Modus gar nicht aktiviert — eine Frage ÜBER den',
    'Modus, ein Status, /claude-batch off, oder einfach ein Satz, in dem der',
    'Sammelmodus nur vorkommt —, ignoriere diesen Hinweis vollständig und',
    'bearbeite den Prompt normal. Die Erkennung ist eine Heuristik.',
  ].join('\n');
}

/**
 * Fire the merge: inject every note, then end collection.
 * @param {{cwd:string,text:string,marker:string,modeActive:boolean}} ctx
 */
function fireMerge({ cwd, text, marker, modeActive }) {
  const notes = B.readNotes(cwd);
  if (notes.length === 0) {
    // Nothing parsed. Never a silent exit — see buildEmptyQueueNotice.
    let exists = false;
    let bytes = 0;
    try { bytes = fs.statSync(B.notesPath(cwd)).size; exists = true; } catch { /* absent */ }
    if (modeActive || (exists && bytes > 0)) {
      process.stdout.write(`${buildEmptyQueueNotice(B.notesPath(cwd), exists, bytes, marker)}\n`);
    }
    return; // mode stays armed — the user just fired early
  }
  const rest = B.stripMarker(text, marker);
  process.stdout.write(
    `${buildMergeContext(notes, rest, B.notesPath(cwd), { stale: !modeActive })}\n`,
  );
  // Firing the merge ENDS collection. What follows is the conversation about
  // the implementation — approvals, answers to Claude's questions, course
  // corrections — and collecting those is actively wrong: they are blocked,
  // erased and answered by nobody. Re-arming is an explicit `/claude-batch on`.
  B.deactivate(cwd);
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
  let marker;
  let verdict;
  try {
    modeActive = B.isModeActive(cwd);
    marker = B.effectiveMarker(cwd);
    verdict = B.classify({ text, hookInput: hook, marker, modeActive });
  } catch {
    process.exit(0); // never let a classification bug swallow a prompt
  }

  // A real user prompt advances the clock the watchdog reads whatever happens to
  // it next, so a later activation starts from a truthful timestamp.
  try { if (!B.isMachinePrompt(text)) B.touchActivity(cwd); } catch { /* non-fatal */ }

  if (verdict === 'execute') {
    // Reached with the mode off as well: an expired or note-capped mode must not
    // strand the notes it collected.
    try { fireMerge({ cwd, text, marker, modeActive }); } catch { /* non-fatal — the turn still runs */ }
    process.exit(0);
  }

  if (verdict === 'passthrough') {
    if (modeActive) {
      // The only user prompts that reach here while collecting carry an
      // attachment; machine prompts and expanded commands never need a guard.
      try {
        if (B.hasAttachment(text, hook)) {
          process.stdout.write(`${buildAttachmentGuard(marker, B.attachmentRefs(text, hook))}\n`);
        }
      } catch { /* advisory only */ }
      process.exit(0);
    }
    // Mode off. The one prompt collection can never catch is the one that turns
    // it on — when it also carries work, say so before the model starts doing it.
    try {
      const act = B.detectActivation(text);
      if (act.activating && act.carriesContent) process.stdout.write(`${buildActivationGuard()}\n`);
    } catch { /* advisory only — never let this cost a turn */ }
    process.exit(0);
  }

  // verdict === 'collect' — block the prompt and store it.
  try {
    const count = B.appendNote(cwd, text);
    process.stderr.write(`${buildAck(count, marker, B.looksLikeQuestion(text))}\n`);
    process.exit(2);
  } catch (err) {
    // Storing failed — blocking now would erase the prompt with nothing kept.
    // Let it through instead; a lost prompt is worse than a missed collection.
    process.stderr.write(`[claude-batch] Notiz konnte nicht gespeichert werden (${err.message}) — Prompt läuft normal weiter.\n`);
    process.exit(0);
  }
});

module.exports = {
  buildAck,
  buildMergeContext,
  buildActivationGuard,
  buildAttachmentGuard,
  buildEmptyQueueNotice,
  INLINE_LIMIT,
};
