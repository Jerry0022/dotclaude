#!/usr/bin/env node
/**
 * @hook prompt.batch.collect
 * @version 0.7.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Collect mode for `/do-batch`: while active, blocks the user
 *   prompt (exit 2 — the harness erases it, so it never reaches the model) and
 *   appends it to `.claude/batch.md`. A prompt starting with the configured
 *   execute marker instead fires the merge: the whole note list is injected as
 *   context and Claude merges the collected intent into ONE plan, which it
 *   hands to auto-concept (open decisions) or do-run (--from=do-batch, ready).
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
 *   A Desktop-app image is the exception (#490): the app sends it as its own
 *   content block, so the prompt carries no attachment marker and IS
 *   collected. The harness has saved the image to its per-session images
 *   folder by then; the hook copies it to `.claude/batch-assets/` and writes
 *   an `[Anhang-Datei] <copy>` line into the note. At merge time a note still
 *   without one is matched to this session's images by timestamp.
 *
 *   An attachment-carrying prompt is passed through, but NOT silently: the turn
 *   gets a guard telling it to file the prompt as a note together with a written
 *   description of the attachment. Without that the screenshot the note refers
 *   to is gone by merge time, and the note reads as "make it like the image"
 *   with no image anywhere.
 *
 *   A re-activation while already collecting (`/do-batch`, `/do-batch
 *   on`, or `/do-batch <text>`) is absorbed here: any residue is stored as a
 *   note and the user gets the mode summary — the same block the activation
 *   ends with — instead of paying a turn for "already active". The exits
 *   (`off`, `go`, `status`, `marker`) always pass through.
 *
 *   Firing the merge first merges the default branch into the current branch
 *   (`scripts/git-sync.js`, synchronous): the notes were written against the
 *   state the branch had when collection started, and planning against a
 *   stale base is how a merged plan silently rebuilds what main already has.
 *   The result is injected with the notes; a sync that could not run is named
 *   so the turn runs it itself before the feasibility check.
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
const { execFileSync } = require('child_process');
const B = require('../lib/batch-state');

/** Absolute path to the state module, so injected guidance can quote a command
 *  that actually runs — a relative require resolves against the wrong cwd. */
const STATE_MODULE = path.resolve(__dirname, '..', 'lib', 'batch-state.js');

/** The parent-chain sync the merge runs before anything is planned. */
const GIT_SYNC_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'git-sync.js');

/** Upper bound for the synchronous main-sync inside the hook. The harness gives
 *  a UserPromptSubmit hook 60 s by default; a fetch that takes longer than this
 *  is reported and handed to the turn, never allowed to kill the hook. */
const SYNC_TIMEOUT_MS = 45_000;

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
 * The body is the shared mode summary (`renderModeSummary`): the same block
 * the activation ends with, so the panel always says what is happening, how to
 * keep collecting, how to fire, and how to only stop.
 *
 * @param {number} count total notes after this one
 * @param {string} marker configured execute marker
 * @param {boolean} question whether the note reads like a question
 * @param {{expiryHours?:number,maxNotes?:number}} [bounds] pinned mode bounds
 * @param {number} [images] pasted images kept with this note
 */
function buildAck(count, marker, question, bounds = {}, images = 0) {
  const lines = [
    `[do-batch] ✓ Notiz #${count} gespeichert — alles korrekt, kein Fehler.`,
    'Der Sammelmodus stoppt den Prompt absichtlich, statt ihn zu bearbeiten.',
  ];
  if (images > 0) {
    lines.push(`📎 ${images === 1 ? 'Das Bild ist' : `${images} Bilder sind`} mit der Notiz gespeichert — der Merge sieht ${images === 1 ? 'es' : 'sie'}.`);
  }
  if (question) {
    // Advisory only. The hook never decides what is a question; it just makes a
    // forgotten marker visible instead of silent.
    lines.push(
      `Das sah nach einer Frage aus. Als Notiz gespeichert — schick sie mit "${marker}" davor,`,
      'wenn du jetzt eine Antwort willst.',
    );
  }
  lines.push('', B.renderModeSummary({ marker, count, ...bounds }));
  return lines.join('\n');
}

/**
 * Shown when a `/do-batch` invocation arrives that would only switch on a
 * mode that is already on. Blocking it is the point: the user forgot the mode
 * is running, and the answer they need is the summary — not a turn.
 *
 * @param {number} count notes after this prompt
 * @param {string} marker configured execute marker
 * @param {boolean} stored whether the invocation carried text that is now a note
 * @param {{expiryHours?:number,maxNotes?:number}} [bounds]
 */
function buildRearmAck(count, marker, stored, bounds = {}) {
  const lines = [
    stored
      ? `[do-batch] Sammelmodus läuft bereits — der Text wurde als Notiz #${count} gespeichert, kein Fehler.`
      : '[do-batch] Sammelmodus läuft bereits — Aufruf ignoriert, kein Fehler.',
    'Ein erneutes Einschalten ist nicht nötig; alles Weitere wird weiter gesammelt.',
    '',
    B.renderModeSummary({ marker, count, ...bounds }),
  ];
  return lines.join('\n');
}

/**
 * "Step 0" of the merge context: where the branch stands relative to main.
 *
 * The notes were written blind against whatever the branch was when collection
 * started — often hours ago. Planning against that base is how a merged plan
 * rebuilds what main already has, or conflicts with it at ship time. So the
 * sync result is the FIRST thing the turn reads, before any note.
 *
 * @param {{ran:boolean,output?:string,reason?:string,script?:string}|undefined} sync
 */
function renderSyncLines(sync) {
  const lines = ['SCHRITT 0 — Stand von main im aktuellen Branch:'];
  const script = sync?.script || GIT_SYNC_SCRIPT;
  if (!sync) {
    lines.push(
      `Kein Sync gelaufen. Führe ZUERST aus: node "${script}" --explain — und behandle das`,
      'Ergebnis wie unten beschrieben, bevor du eine Notiz bewertest.',
    );
  } else if (!sync.ran) {
    lines.push(
      `Der Sync konnte im Hook nicht laufen (${sync.reason || 'unbekannt'}).`,
      `Führe ZUERST aus: node "${script}" --explain — erst danach die Notizen prüfen.`,
    );
  } else if (/skipped:/.test(sync.output || '')) {
    // --explain: the sync stepped aside (dirty overlap, detached HEAD, a merge
    // or ship in progress). The branch may be behind main — never report that
    // as "already contained".
    lines.push(
      `main (bzw. ein Eltern-Branch) wurde NICHT vollständig gemerged: ${sync.output}`,
      'Behebe den genannten Grund ZUERST (z. B. WIP committen, Branch auschecken,',
      `laufende Operation abschließen) und führe dann node "${script}" --explain aus —`,
      'erst wenn main drin ist, die Notizen prüfen.',
    );
  } else if (sync.output && /[✓⚠✗]/.test(sync.output)) {
    lines.push(`Der Hook hat main gerade gemerged: ${sync.output}`);
    if (/[⚠✗]/.test(sync.output)) {
      lines.push(
        'Das ist ein Konflikt oder ein Fehlschlag. Löse ihn ZUERST (merge-safety.md:',
        'nie --ours/--theirs), bevor du eine Notiz bewertest — sonst planst du gegen',
        'einen Stand, den es nach dem Merge nicht mehr gibt.',
      );
    }
  } else {
    lines.push(
      sync.output
        ? `main ist bereits enthalten — nichts zu mergen: ${sync.output}`
        : 'main ist bereits enthalten — nichts zu mergen (oder Branch = main, kein Remote).',
    );
  }
  lines.push(
    'Grund: die Notizen wurden gegen den alten Stand geschrieben; geprüft und',
    'umgesetzt werden sie gegen den aktuellen.',
  );
  return lines;
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
 * @param {{stale?:boolean,sync?:{ran:boolean,output?:string,reason?:string,script?:string}}} [opts]
 *   stale = the mode had already ended (expired, note cap, or manually off) and
 *   the merge fires off the surviving notes; sync = result of the main-sync
 *   the hook ran before injecting (see `syncMain`)
 */
function buildMergeContext(notes, rest, notesFile, opts = {}) {
  const n = notes.length;
  const head = [
    `[do-batch] Der Nutzer hat ${n} Notiz(en) gesammelt und löst jetzt die Umsetzung aus.`,
    `Notizdatei: ${notesFile}`,
  ];
  if (opts.stale) {
    head.push(
      'Der Sammelmodus war zu diesem Zeitpunkt bereits beendet (abgelaufen, Notizlimit',
      'erreicht oder manuell aus). Die Notizen leben weiter und werden jetzt umgesetzt —',
      'sag das dem Nutzer in einer Zeile, statt es zu verschweigen.',
    );
  }
  head.push('', ...renderSyncLines(opts.sync));
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
    '2b. Baue daraus still (keine Freigabefrage) einen Bündel-Plan (do-batch 4.4):',
    '   JEDES konkrete Detail jeder Notiz bleibt drin (Schwellen, Beispiele, Timings,',
    '   Wortlaut). Die Arbeit wird in Bündel geteilt, die parallel laufen und keine Datei',
    '   teilen. Jedes Bündel nennt Notizen, eigene Dateien, Schnittstellen, Reihenfolge und',
    '   Prüfung. Das gilt für BEIDE Wege, Concept wie Umsetzung.',
    '3. Liste Widersprüche EINZELN auf ("#2 wollte rot, #6 blau") statt sie still',
    '   nach "später gewinnt" aufzulösen. Unmögliche Punkte werden benannt,',
    '   nicht umgangen.',
    '4. Lege Abdeckungsliste und Plan vor und übergib ihn OHNE eigene Freigabefrage an',
    '   GENAU EINEN Skill (do-batch Step 4.6) — du setzt selbst nichts um:',
    '   - Skill devops:auto-concept mit --from=do-batch, wenn noch eine Entscheidung offen ist:',
    '     2+ Konflikte oder einer ohne vertretbaren Default, eine Notiz will Analyse/',
    '     Vergleich/Concept statt Änderung, eine offene Design-Wahl, ein unmachbarer',
    '     Punkt mit abhängigen Punkten, 2+ Ansatz-Gabelungen. Im Zweifel auto-concept.',
    '   - sonst Skill devops:do-run mit --from=do-batch (do-run überspringt dann "Was?").',
    '   Vorher: archiveNotes(cwd) aus hooks/lib/batch-state.js (archivieren, nie',
    '   löschen) und den archivierten Pfad in die Übergabe schreiben. Die Übergabe',
    '   trägt den Abschnitt "Bündel:" (do-batch 4.9).',
    '',
    'Umsetzung ist breit gemeint — Code, Concepting, UI-Concepting, oder auch nur',
    'ein erster Schritt.',
    '',
    'Der Sammelmodus ist mit diesem Prompt automatisch BEENDET. Folgeprompts sind',
    'die Unterhaltung über die Umsetzung und laufen wieder normal — frage NICHT,',
    'ob der Modus aktiv bleiben soll. Nur ein neues /do-batch on sammelt wieder.',
    '',
    // The skill's own Step 4.8 says the same, but this path never loads the
    // skill — the marker prompt is the whole trigger. Without this line the
    // sidebar keeps promising a collection that ended with this prompt.
    'Session-Titel: Beginnt er mit "📥 Batch – " (mcp__ccd_session_mgmt__get_session',
    'self), entferne genau dieses Präfix via mcp__ccd_session_mgmt__set_session_title',
    'self. Fehlen die Tools (Terminal, unbeaufsichtigt): still überspringen.',
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
    `[do-batch] Der Ausführungs-Marker "${marker}" wurde erkannt, aber aus der`,
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
    '[do-batch] Sammelmodus ist AKTIV, aber dieser Prompt trägt einen Anhang',
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
    '[do-batch] Dieser Prompt startet den Sammelmodus UND trägt zusätzlichen Inhalt.',
    '',
    'Der Inhalt neben der Aktivierung ist NOTIZ, nicht Auftrag:',
    '1. Setze nichts davon um. Nicht planen, nicht recherchieren, nicht den Code',
    '   dafür lesen — der Modus existiert genau dafür, dass das später und',
    '   gebündelt passiert.',
    '2. Überspringe KEINEN Schritt des do-batch-Skills. Die Marker-Rückfrage',
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
    'Modus, ein Status, /do-batch off, oder einfach ein Satz, in dem der',
    'Sammelmodus nur vorkommt —, ignoriere diesen Hinweis vollständig und',
    'bearbeite den Prompt normal. Die Erkennung ist eine Heuristik.',
  ].join('\n');
}

/** How long a collected prompt waits for the harness to write its pasted
 *  image. The file lands within milliseconds of the submit (#490), usually
 *  before this hook has even started. Only sessions that have an images folder
 *  at all pay the wait; a found image costs one extra read to confirm the set. */
const IMAGE_WAIT_MS = 300;
const IMAGE_POLL_MS = 150;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Copy the images pasted into THIS prompt next to the notes (#490). The
 * Desktop app sends them as separate content blocks — no `[Image #N]` in the
 * text, no attachment key in the hook input — so the harness's per-session
 * images folder is the only place they exist. Never throws: an image problem
 * must not cost the note.
 *
 * @returns {string[]} absolute paths of the copies
 */
function captureNoteImages(cwd, sessionId, at) {
  try {
    const dirs = B.sessionImageDirs(sessionId);
    if (!dirs.length) return [];
    let prev = null;
    for (let waited = 0; ; waited += IMAGE_POLL_MS) {
      const hits = B.imagesNear(cwd, sessionId, at, { dirs });
      const sig = hits.map(h => `${h.file}:${h.size}`).sort().join('|');
      // Take the set once two reads agree: a second image pasted into the same
      // prompt joins it, and a file still being written changes its size.
      if (hits.length && sig === prev) return B.claimImages(cwd, hits, at);
      if (waited >= IMAGE_WAIT_MS) return B.claimImages(cwd, hits, at);
      prev = hits.length ? sig : null;
      sleepSync(IMAGE_POLL_MS);
    }
  } catch {
    return [];
  }
}

/**
 * Merge-time fallback (#490): images of this session no note has taken yet —
 * written after their note's hook looked, or collected by an older plugin —
 * go to the NEAREST note (`assignImagesToNotes`). A match beyond the certain
 * window says so on its line, so the merge checks it instead of trusting it.
 * One scan for all notes. Only the injected copy changes; `.claude/batch.md`
 * stays as the user left it.
 */
function attachLateImages(cwd, sessionId, notes, markerAt) {
  try {
    const dirs = B.sessionImageDirs(sessionId);
    if (!dirs.length || !notes.length) return notes;
    const byNote = B.assignImagesToNotes(notes, B.unclaimedImages(cwd, dirs), markerAt);
    return notes.map((note, i) => {
      const matched = (byNote.get(i) || []).sort((a, b) => a.img.mtimeMs - b.img.mtimeMs);
      if (!matched.length) return note;
      const copies = B.claimImages(cwd, matched.map(m => m.img), Date.parse(note.at));
      const lines = copies.map((copy, k) => {
        const gap = matched[k].gapMs;
        return gap <= B.IMAGE_MATCH_WINDOW_MS
          ? `[Anhang-Datei] ${copy}`
          : `[Anhang-Datei] ${copy} (per Zeitstempel zugeordnet, ${Math.round(gap / 1000)} s Abstand — prüfen, ob das Bild zu dieser Notiz passt)`;
      });
      return { ...note, text: `${note.text}\n${lines.join('\n')}` };
    });
  } catch {
    return notes;
  }
}

/**
 * Merge the parent chain (main) into the current branch, synchronously.
 *
 * Runs `scripts/git-sync.js` exactly as the session-start cron does, minus the
 * detachment: the merge turn needs the result NOW, as context, not on the next
 * prompt. Silent output means nothing to merge (or no repo / no remote / on
 * main) — git-sync only speaks when it did or could not do something.
 *
 * Never throws. A sync that cannot run is reported so the turn runs it itself;
 * it must not cost the notes their turn.
 *
 * @param {string} cwd
 * @returns {{ran:boolean,output?:string,reason?:string,script:string}}
 */
function syncMain(cwd) {
  const script = GIT_SYNC_SCRIPT;
  if (process.env.DEVOPS_BATCH_NO_SYNC) return { ran: false, reason: 'DEVOPS_BATCH_NO_SYNC gesetzt', script };
  const env = { ...process.env };
  // The background spawner routes output into a result file; here stdout IS
  // the result.
  delete env.DEVOPS_GIT_SYNC_RESULT_FILE;
  try {
    // --explain: a skipped sync must say so, or it reads as "up to date".
    const out = execFileSync(process.execPath, [script, '--explain'], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: SYNC_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return { ran: true, output: String(out || '').trim(), script };
  } catch (err) {
    const reason = err && err.killed
      ? `Timeout nach ${SYNC_TIMEOUT_MS / 1000} s`
      : String(err && err.message || err).split('\n')[0];
    return { ran: false, reason, script };
  }
}

/**
 * Fire the merge: sync main, inject every note, then end collection.
 * @param {{cwd:string,text:string,marker:string,modeActive:boolean,sessionId?:string}} ctx
 */
function fireMerge({ cwd, text, marker, modeActive, sessionId }) {
  const notes = attachLateImages(cwd, sessionId, B.readNotes(cwd), Date.now());
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
  // Before the notes are even shown: bring main in. The plan is checked against
  // the code as it is now, not as it was when the first note was written.
  const sync = syncMain(cwd);
  process.stdout.write(
    `${buildMergeContext(notes, rest, B.notesPath(cwd), { stale: !modeActive, sync })}\n`,
  );
  // Firing the merge ENDS collection. What follows is the conversation about
  // the implementation — approvals, answers to Claude's questions, course
  // corrections — and collecting those is actively wrong: they are blocked,
  // erased and answered by nobody. Re-arming is an explicit `/do-batch on`.
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
    try { fireMerge({ cwd, text, marker, modeActive, sessionId: hook.session_id }); } catch { /* non-fatal — the turn still runs */ }
    process.exit(0);
  }

  // Mode bounds as pinned at activation — the summary must quote what is in
  // force, not the config default a later edit may have changed.
  let bounds = {};
  try {
    const mode = B.readMode(cwd);
    if (mode?.startedAt && mode?.expiresAt) {
      const h = (Date.parse(mode.expiresAt) - Date.parse(mode.startedAt)) / 3600_000;
      if (Number.isFinite(h) && h > 0) bounds.expiryHours = Math.round(h * 10) / 10;
    }
    if (mode?.maxNotes) bounds.maxNotes = mode.maxNotes;
  } catch { /* defaults */ }

  if (verdict === 'rearm') {
    // `/do-batch`, `/do-batch on` or `/do-batch <text>` while the
    // mode is already on. Store the residue (if any) and answer with the mode
    // summary — blocked, so it costs nothing. The exits never land here.
    try {
      const inv = B.parseBatchCommand(text);
      if (inv?.route === 'help') {
        // Static text — the long form of the summary. Nothing to store.
        process.stderr.write(`${B.renderHelp({ marker, ...bounds })}\n`);
        process.exit(2);
      }
      const residue = inv?.residue || '';
      // An image pasted with `/do-batch <text>` belongs to that note too (#490);
      // an image alone still makes a note, so it is not lost with the prompt.
      const now = Date.now();
      const copies = captureNoteImages(cwd, hook.session_id, now);
      const noteText = [residue, copies.length ? B.attachmentFileLines(copies) : ''].filter(Boolean).join('\n');
      const count = noteText ? B.appendNote(cwd, noteText, now) : B.countNotes(cwd);
      process.stderr.write(`${buildRearmAck(count, marker, Boolean(noteText), bounds)}\n`);
      process.exit(2);
    } catch (err) {
      // Could not store — let the skill handle it, as before this branch existed.
      process.stderr.write(`[do-batch] Aufruf konnte nicht abgefangen werden (${err.message}) — Skill übernimmt.\n`);
      process.exit(0);
    }
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

  // verdict === 'collect' — block the prompt and store it, together with any
  // image pasted into it in the Desktop app (#490).
  try {
    const now = Date.now();
    const copies = captureNoteImages(cwd, hook.session_id, now);
    const noteText = copies.length ? `${text}\n${B.attachmentFileLines(copies)}` : text;
    const count = B.appendNote(cwd, noteText, now);
    process.stderr.write(`${buildAck(count, marker, B.looksLikeQuestion(text), bounds, copies.length)}\n`);
    process.exit(2);
  } catch (err) {
    // Storing failed — blocking now would erase the prompt with nothing kept.
    // Let it through instead; a lost prompt is worse than a missed collection.
    process.stderr.write(`[do-batch] Notiz konnte nicht gespeichert werden (${err.message}) — Prompt läuft normal weiter.\n`);
    process.exit(0);
  }
});

module.exports = {
  buildAck,
  buildRearmAck,
  buildMergeContext,
  renderSyncLines,
  buildActivationGuard,
  buildAttachmentGuard,
  buildEmptyQueueNotice,
  syncMain,
  INLINE_LIMIT,
  GIT_SYNC_SCRIPT,
};
