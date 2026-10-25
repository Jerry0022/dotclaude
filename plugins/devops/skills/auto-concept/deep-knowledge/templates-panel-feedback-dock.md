# Concept templates, part 05 of 33: Feedback Dock

```javascript
// --- Feedback dock (all templates) ---
// The 💬 FAB and its dock are page chrome exactly like the ☰ panel above:
// the same markup in every template, wired here at page level and NOT
// inside the design layout IIFE (§ Layout JS), which returns early on a page
// that never renders a mockup. A decision/free page used to have no dock at
// all — the general note had nowhere to go but an inline field the author
// had to remember to add. Now every round has the dock; a document round
// shows only its general-notes section (§ Panel Chrome CSS compact rule),
// a design round adds the per-screen / per-design / per-view rows.
//
// Everything a design page's Layout JS needs from the dock is exported on
// `window` — closeDock (also reached from openPanel), applyDockSize (also
// from restoreState), harvestDockValues + liveIterationId (the dock row
// builders), stashLiveDockValues + applyDockFreezeState + primeDock (the
// iteration:changed path), markDockSubmitted / unmarkDockSubmitted (the
// submit handler + Panel State Reset). Load order: this block precedes
// § Layout JS in templates.md and in every page copied from it, so its boot
// (registered first) runs first on DOMContentLoaded.
(() => {
  const DOCK_DESIGN_TEMPLATES = new Set(['design', 'prototype']);
  const boot = () => {
  const dock = document.getElementById('feedback-dock');
  const dockToggle = document.getElementById('feedback-toggle');
  const dockClose = document.getElementById('feedback-close');
  // Same contract as the panel block's missingPanelParts: name what is
  // missing ONCE, then degrade. Everything below guards on `dock`, so a page
  // that shipped without the markup keeps its panel, its submit and its
  // keyboard shortcuts — only the dock is inert.
  const missingDockParts = [
    ['feedback-dock', dock], ['feedback-toggle', dockToggle],
    ['feedback-close', dockClose],
  ].filter(([, el]) => !el).map(([id]) => id);
  if (missingDockParts.length) {
    console.error('[concept] feedback-dock markup incomplete, dock disabled — missing: '
      + missingDockParts.join(', '));
  }
  // The dock is a Speech-Bubble anchored to the 💬 FAB — the FAB stays
  // visible and clickable while the dock is open, so clicking it toggles
  // (open ↔ minimised). The − button is a *minimise*, not a destroy:
  // closing the dock leaves all textarea content intact (localStorage
  // persistence is untouched).
  // Accessibility:
  //   * aria-expanded reflects open/closed state on the FAB
  //   * aria-label swaps between data-label-open / data-label-close so
  //     screen-reader users hear the correct next action
  //   * on close, focus is restored to the FAB if it was inside the dock
  //     (the dock disappears via display:none, so leaving focus there
  //     would orphan it)
  const LABEL_OPEN = dockToggle?.dataset.labelOpen || dockToggle?.getAttribute('aria-label') || '';
  const LABEL_CLOSE = dockToggle?.dataset.labelClose || LABEL_OPEN;
  function openDock() {
    if (!dock || !dockToggle) return;
    window.closePanel?.();   // mutually exclusive overlays, see openPanel above
    dock.dataset.open = 'true';
    dockToggle.setAttribute('aria-expanded', 'true');
    dockToggle.setAttribute('aria-label', LABEL_CLOSE);
    dockToggle.dataset.tip = LABEL_CLOSE;
    window.showDockTip?.();
  }
  // `handOff` = the dock is closing because the panel is taking over. Then
  // the FAB must NOT be focused: it sits at z-index 220, above the panel
  // backdrop, so a keyboard user would be left standing on a control that
  // dismisses the overlay that just opened. openPanel() moves focus into the
  // panel instead. Every other close still restores the FAB, or focus would
  // be orphaned inside a display:none dock.
  function closeDock(handOff) {
    // Reachable from openPanel() through `window.closeDock?.()`, so it must
    // survive a page whose dock never existed.
    if (!dock || !dockToggle) return;
    const focusWasInside = !handOff && dock.contains(document.activeElement);
    dock.dataset.open = 'false';
    dockToggle.setAttribute('aria-expanded', 'false');
    dockToggle.setAttribute('aria-label', LABEL_OPEN);
    dockToggle.dataset.tip = LABEL_OPEN;
    if (focusWasInside) dockToggle.focus();
  }
  window.openDock = openDock;
  window.closeDock = closeDock;
  // ── "Wusstest du schon?" — one static fact per dock open, never the same
  // one twice in a row. A fact is true for this plugin (SKILL.md and its
  // deep-knowledge); the pool is static, nothing is generated at runtime.
  const DOCK_TIPS = {
    de: [
      "Halte Alt: alle Hotkeys der Seite erscheinen als Tasten-Badges.",
      "Strg + Klick setzt eine eigene Notiz direkt an eine Stelle.",
      "Die Leertaste öffnet und schließt das Notiz-Dock, solange kein Feld den Fokus hat.",
      "Das Auge 👁 blendet alle Notizen aus, damit du den Inhalt in Ruhe ansehen kannst.",
      "Römische Ziffern (I, II, III) sind Detailseiten, Ziffern 1–3 wählen die Varianten.",
      "Mit F markierst du die aktuelle Variante als Favorit ★.",
      "V schaltet zwischen den Geräteansichten um, die das Design deklariert.",
      "Pfeil links/rechts wechselt auf derselben Ebene, hoch/runter eine Ebene.",
      "Esc führt aus einer Variante zurück zur Übersicht.",
      "Die Bridge speichert deine Entwürfe laufend, ein Neuladen verliert nichts.",
      "Abgeschickte Runden werden eingefroren und behalten genau deine Antworten.",
      "Frühere Runden bleiben durchblätterbar, sie sind nur gesperrt.",
      "Die Seite wird von einem Build-Skript aus Runden-Fragmenten zusammengesetzt, nie von Hand.",
      "Jede Runde baut die Engine neu aus der aktuellen Plugin-Referenz.",
      "Beim Umsetzen prüft das Plugin, ob ein Agent-Team daran arbeiten sollte und welches.",
      "Vor dem Umsetzen läuft ein Reality-Check gegen den echten Code.",
      "Folgeaufgaben können als Issues angelegt statt direkt umgesetzt werden.",
      "Nach dem Umsetzen kann das Ergebnis direkt ausgeliefert werden (Ship).",
      "Der Abschlussbericht ist immer ein Dokument mit Inhaltsverzeichnis.",
      "Offene Punkte meldet das Panel, bevor du abschickst.",
      "📎 hängt Dateien an eine Notiz, auch per Einfügen oder Drag and Drop.",
      "Angehängte Dateien liegen im Konzept-Ordner, das Plugin liest sie von dort.",
      "Zuordnungs-Fragen (was gehört wohin) bekommen einen eigenen Mapping-Block.",
      "Automatische Notizen stellen die drei bis sieben wichtigsten Fragen zur Seite.",
      "Jede Notiz-Blase lässt sich beiseiteziehen, wenn sie etwas verdeckt.",
      "Ein beantworteter Pin zeigt ein fettes Häkchen.",
      "Die Zahl am Auge zählt die offenen Notizen der Seite.",
      "Der ganze eigene Pin ist ziehbar, nicht nur ein Griff.",
      "Öffnest du einen Pin, schließt sich der zuvor geöffnete.",
      "Während du eine Notiz schreibst, treten die anderen Notizen in den Hintergrund.",
      "Das Dock zeigt über jedem Feld, worauf es sich bezieht: Concept, Variante, Seite.",
      "Das oberste Dock-Feld gilt nur für diese Seite, das unterste für das ganze Concept.",
      "Jede Variante ist ein eigenes Design, nebeneinander vergleichbar in der Übersicht.",
      "Ab zwei Designs gibt es die Varianten-Übersicht mit Karten und Vorschau.",
      "Jede Variante nennt genau drei echte Unterschiede zu den anderen.",
      "Einen Favoriten gibt es nur bei Alternativen, höchstens einen pro Runde.",
      "Der Favorit ist der Startpunkt der nächsten Runde.",
      "Notizen zu den anderen Varianten fließen trotz Favorit ein.",
      "Ohne Favorit entscheidet das Plugin anhand deiner Notizen, womit es weitermacht.",
      "Eine Frage-Seite fragt nur, was unabhängig vom Siegerdesign gilt.",
      "Die Wahl zwischen Designs triffst du im Dock, nicht auf einer Frage-Seite.",
      "Der Modus (Entscheidung, Design, gemischt) wird einmal am Anfang geklärt.",
      "Im gemischten Modus können Design- und Entscheidungsfragen im selben Concept liegen.",
      "Das Template wird pro Runde neu gewählt, bleibt aber nach einem Design meist Design.",
      "Der Abschlussbericht ist die einzige Ausnahme von der Template-Kontinuität.",
      "Die Entscheidungs-Ansicht vergleicht nicht-visuelle Alternativen mit Vor- und Nachteilen.",
      "Freie Runden sind für Analysen, Erklärungen und Rückblicke ohne Varianten.",
      "Der Concept-Server läuft lokal, die Seite öffnet im echten Browser.",
      "Ohne erreichbare Bridge ändert sich nur der Transport, nie die Seite.",
      "Das Plugin wartet auf deine Antwort, statt weiterzuraten.",
      "Dein Abschicken landet als eine Nachricht mit allen Entscheidungen und Notizen.",
      "Notizen zu Seiten, Varianten und dem ganzen Concept werden getrennt übermittelt.",
      "Eigene Pins werden mit Stelle und Zielelement mitgeschickt.",
      "Ein Pin ohne Text wird nicht gespeichert.",
      "Enter speichert einen Pin, Esc verwirft ihn.",
      "Mit Umschalt + Enter schreibst du im Pin eine neue Zeile.",
      "Das ☰ öffnet das Panel mit Entscheidungen, Runden und Inhaltsverzeichnis.",
      "Im Panel wechselst du zwischen Hell und Dunkel.",
      "Die Rundenleiste im Panel zeigt, wer gerade dran ist: du oder das Plugin.",
      "Das Schloss in der Rundenleiste schaltet von weiteren Runden auf Umsetzen um.",
      "Ein Klick auf den Rücklauf-Pfeil nimmt das Freischalten wieder zurück.",
      "Beim Umsetzen zählt die Leiste die Anforderungen des freigegebenen Umfangs.",
      "Die Zahl in der Leiste hat einen Tooltip mit dem aktuellen Schritt.",
      "Die Rundenleiste baut sich beim ersten Öffnen einer Runde von links nach rechts auf.",
      "Abgeschickt heißt gespeichert: auch ohne Verbindung geht nichts verloren.",
      "Fehlt die Verbindung, speichert die Seite lokal weiter und gleicht später ab.",
      "Der Toast unten zeigt den Fortschritt, auch wenn das Panel zu ist.",
      "Fertige Toasts verschwinden von selbst, sobald du sie gesehen hast.",
      "Eine neue Runde öffnet immer die Startseite des Concepts.",
      "Neugedachte Varianten tragen den Hinweis Neugedacht, geänderte den Hinweis Verbessert.",
      "Pro Variante erscheint höchstens ein Hinweis, nie zwei.",
      "Die Übersicht zeigt echte Live-Vorschauen der Varianten, keine Bilder.",
      "Design öffnen ↗ springt von der Übersicht in die gewählte Variante.",
      "Der Schnellzugriff oben in der Mitte springt zwischen Varianten, Seiten und Fragen.",
      "Der Fragen-Eintrag springt zur ersten offenen Frage, ein zweiter Klick zur nächsten.",
      "Eine Frage gilt als beantwortet, sobald du darin etwas tust oder scrollst.",
      "Der Tipp-Streifen über dem Toast erscheint nur, wenn ein Hotkey schneller wäre.",
      "Mit dem Kreuz am Tipp schweigt er 30 Tage lang.",
      "Alle Texte der Seite gibt es auf Deutsch und Englisch.",
      "Die Sprache der Seite folgt der Sprache, in der du das Concept startest.",
      "Geräteansichten gibt es nur, wenn das Design Telefon oder Tablet deklariert.",
      "Ein Desktop-Werkzeug deklariert keine Geräteansichten.",
      "Bei Geräteansichten sind eigene Pins ausgeschaltet, nur die Desktop-Ansicht trägt sie.",
      "Eingefrorene Runden akzeptieren keine neuen Pins.",
      "Der Hinweis über einer eingefrorenen Runde bringt dich zur aktuellen zurück.",
      "Die letzte Runde ist die lebende, alle anderen sind gebacken.",
      "Gebacken heißt: deine abgeschickten Werte stehen fest im Runden-Fragment.",
      "Das Plugin schreibt nur Runden-Fragmente, nie die fertige Seite.",
      "Eine Validierung prüft jede gebaute Seite, bevor sie überschrieben wird.",
      "Eine veraltete Engine wird beim Bauen erkannt und abgelehnt.",
      "Die Seite liegt unter docs/concepts, neben ihrem Quell-Ordner.",
      "Beim Start in einem Repo-Hauptverzeichnis legt das Plugin zuerst einen eigenen Worktree an.",
      "Zwei Alternativen mit Vor- und Nachteilen werden zur Entscheidungs-Runde.",
      "Visuelle Fragen werden immer als Design gezeigt, nie nur beschrieben.",
      "Die Klick-Prototypen der Designs sind echte Klickstrecken über mehrere Seiten.",
      "Jeder Hotkey steht auch im Tooltip seines Bedienelements.",
      "Tooltips für Hotkeys erscheinen erst nach längerem Verweilen.",
      "Das 💬 füllt sich nur, wenn du etwas Seitenspezifisches schreibst, das zählt als Interaktion.",
      "Das Dock lässt sich maximieren, wenn dir die Felder zu klein sind.",
      "Das Dock wächst aus dem 💬 heraus und merkt sich, ob du es groß gestellt hast.",
      "Das aktive Dock-Feld leuchtet sanft, damit du siehst, wohin du schreibst.",
      "Notizen im Dock gelten für Seite, Variante oder das ganze Concept, je nach Feld.",
      "Ohne Designs schrumpft die Zeile über dem Feld auf das, was es gibt.",
      "Ein Concept lässt sich pausieren und später an derselben Stelle fortsetzen.",
      "Am Ende steht eine Abschlusskarte mit dem, was entschieden und umgesetzt wurde."
    ],
    en: [
      "Hold Alt to show every hotkey of the page as key badges.",
      "Ctrl + click places your own note right on a spot.",
      "Space opens and closes the notes dock while no field has focus.",
      "The eye 👁 hides all notes so you can look at the content in peace.",
      "Roman numerals (I, II, III) are detail pages, digits 1-3 pick the variants.",
      "F marks the current variant as your favourite ★.",
      "V cycles through the device views the design declares.",
      "Left/right arrows move on the same level, up/down one level.",
      "Esc takes you from a variant back to the overview.",
      "The bridge saves your drafts continuously, a reload loses nothing.",
      "Submitted rounds are frozen and keep exactly your answers.",
      "Earlier rounds stay browsable, they are just locked.",
      "The page is assembled by a build script from round fragments, never by hand.",
      "Every round rebuilds the engine from the current plugin reference.",
      "On implement, the plugin checks whether an agent team should work on it and which.",
      "Before implementing, a reality check runs against the real code.",
      "Follow-ups can be filed as issues instead of being implemented right away.",
      "After implementing, the result can be shipped right away.",
      "The final report is always a document with a table of contents.",
      "The panel reports open points before you submit.",
      "📎 attaches files to a note, also by paste or drag and drop.",
      "Attached files live in the concept folder, the plugin reads them from there.",
      "Assignment questions (what goes where) get their own mapping block.",
      "Automatic notes ask the three to seven most important questions about the page.",
      "Every note bubble can be dragged aside when it covers something.",
      "An answered pin shows a bold check mark.",
      "The number on the eye counts the open notes of the page.",
      "The whole own pin is draggable, not just a handle.",
      "Opening a pin closes the one that was open.",
      "While you write a note, the other notes step into the background.",
      "The dock shows above every field what it refers to: concept, variant, page.",
      "The top dock field is for this page only, the bottom one for the whole concept.",
      "Each variant is its own design, comparable side by side in the overview.",
      "From two designs on there is the variant overview with cards and previews.",
      "Each variant names exactly three genuine differences from the others.",
      "A favourite exists only for alternatives, at most one per round.",
      "The favourite is the starting point of the next round.",
      "Notes on the other variants still count despite a favourite.",
      "Without a favourite the plugin decides from your notes what to continue with.",
      "A question page only asks what holds whichever design wins.",
      "You make the call between designs in the dock, not on a question page.",
      "The mode (decision, design, mixed) is settled once at the start.",
      "In mixed mode, design and decision questions can live in the same concept.",
      "The template is picked per round but usually stays design after a design round.",
      "The final report is the one exception to template continuity.",
      "The decision view compares non-visual alternatives with pros and cons.",
      "Free rounds are for analyses, explainers and retros without variants.",
      "The concept bridge runs locally and the page opens in a real browser.",
      "Without a reachable bridge only the transport changes, never the page.",
      "The plugin waits for your answer instead of guessing on.",
      "Your submit arrives as one message with all decisions and notes.",
      "Notes on pages, variants and the whole concept are sent separately.",
      "Your own pins are sent with their spot and target element.",
      "A pin without text is not saved.",
      "Enter saves a pin, Esc discards it.",
      "Shift + Enter starts a new line inside a pin.",
      "The ☰ opens the panel with decisions, rounds and table of contents.",
      "In the panel you switch between light and dark.",
      "The round row in the panel shows who is up: you or the plugin.",
      "The lock in the round row switches from more rounds to implementing.",
      "Clicking the back arrow takes the unlock back.",
      "While implementing, the bar counts the requirements of the approved scope.",
      "The number in the bar has a tooltip naming the current step.",
      "The round row builds left to right the first time a round opens.",
      "Submitted means saved: nothing is lost even without a connection.",
      "Without a connection the page keeps saving locally and syncs later.",
      "The toast at the bottom shows progress even when the panel is closed.",
      "Finished toasts disappear on their own once you have seen them.",
      "A new round always opens the start page of the concept.",
      "Newly thought-up variants carry the note Neugedacht, changed ones Verbessert.",
      "A variant shows at most one hint, never two.",
      "The overview shows real live previews of the variants, not images.",
      "Open design ↗ jumps from the overview into the chosen variant.",
      "The quick nav at the top centre jumps between variants, pages and questions.",
      "The questions entry jumps to the first open question, a second click to the next.",
      "A question counts as answered once you do something or scroll in it.",
      "The tip strip above the toast only appears when a hotkey would be faster.",
      "The cross on a tip silences it for 30 days.",
      "All texts of the page exist in German and English.",
      "The page language follows the language you start the concept in.",
      "Device views only exist when the design declares phone or tablet.",
      "A desktop tool declares no device views.",
      "In device views own pins are off, only the desktop view carries them.",
      "Frozen rounds accept no new pins.",
      "The bar over a frozen round takes you back to the current one.",
      "The latest round is the live one, all others are baked.",
      "Baked means your submitted values are written into the round fragment.",
      "The plugin only writes round fragments, never the finished page.",
      "A validation checks every built page before it is overwritten.",
      "A stale engine is detected and rejected when building.",
      "The page lives under docs/concepts, next to its source folder.",
      "When started in a repo's main checkout the plugin first creates its own worktree.",
      "Two or more alternatives with pros and cons become a decision round.",
      "Visual questions are always shown as a design, never just described.",
      "The design click-dummies are real click paths across several pages.",
      "Every hotkey is also named in the tooltip of its control.",
      "Tooltips for hotkeys appear only after hovering for a while.",
      "The 💬 only counts when you type something page-specific, that counts as interaction.",
      "The dock can be maximised if the fields feel too small.",
      "The dock grows out of the 💬 and remembers whether you made it large.",
      "The active dock field glows softly so you can see where you are writing.",
      "Notes in the dock apply to a page, a variant or the whole concept, depending on the field.",
      "Without designs the line above the field shrinks to what exists.",
      "A concept can be paused and resumed later at the same spot.",
      "At the end a completion card lists what was decided and implemented."
    ]
  };
  window.DOCK_TIPS = DOCK_TIPS;
  window.nextDockTipIndex = function(n, last, rand) {
    if (n < 2) return 0;
    const r = typeof rand === 'number' ? rand : Math.random();
    return ((last < 0 ? 0 : last) + 1 + Math.floor(r * (n - 1))) % n;
  };
  let lastDockTip = -1;
  function showDockTip() {
    if (!dock) return;
    let box = document.getElementById('dock-tip');
    if (!box) {
      box = document.createElement('div');
      box.id = 'dock-tip';
      box.className = 'dock-tip';
      const title = document.createElement('b');
      title.textContent = '💡 {{dock.tip_title}}';
      const text = document.createElement('span');
      text.className = 'dock-tip-text';
      box.append(title, text);
      dock.appendChild(box);
    }
    const lang = (document.documentElement.lang || 'en').slice(0, 2) === 'de' ? 'de' : 'en';
    const pool = DOCK_TIPS[lang];
    lastDockTip = window.nextDockTipIndex(pool.length, lastDockTip);
    box.querySelector('.dock-tip-text').textContent = pool[lastDockTip];
    box.hidden = false;
  }
  window.showDockTip = showDockTip;
  // The one-shot pulse (§ Panel Chrome CSS, fabPulse) ends the moment the
  // user proves they found the FAB. Two independent proofs, because either
  // can come first: opening the dock from the FAB, or typing into it (a
  // restored session can land with the dock already open, and closeDock()
  // is also reached by the panel hand-off, which proves nothing about the
  // dock).
  const stopFabPulse = () => dockToggle?.removeAttribute('data-untouched');
  dockToggle?.addEventListener('click', () => {
    stopFabPulse();
    if (dock?.dataset.open === 'true') closeDock();
    else openDock();
  });
  dock?.addEventListener('input', stopFabPulse);
  dockClose?.addEventListener('click', closeDock);

  // Maximise/restore (Work package B) — a RESIZE, never a close. Distinct
  // from minimise above: minimise flips data-open, this flips
  // data-userMaximized, a SEPARATE attribute from data-size (applyDockSize()
  // below still only ever computes compact/wide from the round's shape,
  // unchanged) — the CSS composes the two via
  // `.feedback-dock[data-size][data-user-maximized="true"]`, which applies on
  // top of whichever of compact/wide is current. The choice is persisted
  // (state['dockMaximized'], § State Persistence) and restored on reload via
  // window.applyDockSize() (see restoreState()) — primeDock() must never
  // silently clear data-userMaximized on an iteration switch, and it does
  // not: applyDockSize() only ever writes data-size.
  const dockMaximize = document.getElementById('feedback-maximize');
  function syncMaximizeButton() {
    if (!dockMaximize || !dock) return;
    const on = dock.dataset.userMaximized === 'true';
    dockMaximize.setAttribute('aria-pressed', String(on));
    const label = on ? '{{panel.restore_size}}' : '{{panel.maximize}}';
    dockMaximize.setAttribute('aria-label', label);
    dockMaximize.dataset.tip = label;
  }
  dockMaximize?.addEventListener('click', () => {
    if (!dock) return;
    dock.dataset.userMaximized = dock.dataset.userMaximized === 'true' ? 'false' : 'true';
    applyDockSize();
    if (typeof saveState === 'function') saveState();
  });

  // ── Closed by default, opened only by the user ──
  // The dock starts minimised (data-open="false" in markup). It used to open
  // itself on load and auto-close on the first mockup click, which meant the
  // first thing a concept showed was three empty textareas over the artefact
  // the user came to look at. Now the 💬 FAB is the only thing that opens it,
  // in every iteration state including frozen ones — no auto-open, no
  // auto-close, nothing to un-learn.
  //
  // Size is one of exactly two values. A document round (decision / free —
  // the projection on <html data-template>, which showIteration() rewrites
  // before any iteration:changed listener runs) shows only the general
  // section and is always compact; a design round derives it from the same
  // body flags the layout already sets. Never size the dock to its content
  // or to the viewport: content-sizing produces the mini-box nobody can type
  // in, and viewport-sizing produces the full-width panel whose textareas
  // never wrap.
  function applyDockSize() {
    // Sync the maximise button's a11y state on every call — cheap, and
    // covers both the click handler's own call and any call site that
    // re-applies sizing without having touched the button (restoreState(),
    // an iteration switch via primeDock()).
    syncMaximizeButton();
    // The automatic compact/wide computation always runs — still exactly two
    // sizes. The user's maximise override lives on a SEPARATE attribute
    // (data-userMaximized) and composes with whichever of these two is
    // current via CSS (`.feedback-dock[data-size][data-user-maximized="true"]`),
    // rather than replacing this value — so it also survives an iteration
    // switch untouched: primeDock() calls this on every switch but never
    // clears data-userMaximized itself.
    // Exposed as window.applyDockSize and called from restoreState(), which
    // runs on every page — including one whose dock markup is missing.
    if (!dock) return;
    const designRound = DOCK_DESIGN_TEMPLATES.has(document.documentElement.dataset.template || '');
    const singleScreen = document.body.dataset.singleScreen === 'true';
    const singleDesign = document.body.dataset.singleDesign === 'true';
    dock.dataset.size = (!designRound || (singleScreen && singleDesign)) ? 'compact' : 'wide';
  }
  window.applyDockSize = applyDockSize;

  // The dock is one shared overlay, but its content always belongs to
  // whichever round is live. The rebuild stamp (§ Layout JS buildDesignUI)
  // and § State Persistence's key namespacing derive from this one answer.
  function liveIterationId() {
    const live = document.querySelector('section[data-iteration][data-active]');
    return live ? String(live.dataset.iteration) : '';
  }
  window.liveIterationId = liveIterationId;
  function visibleIteration() {
    return document.querySelector('section[data-iteration]:not([hidden])');
  }

  // Snapshot the dock's current values, keyed by data-comment, so the one
  // rebuild the design row builders still perform (iteration change) does
  // not drop text. restoreState() only runs on DOMContentLoaded, so anything
  // lost here is lost for good — and the next saveState() would delete its
  // localStorage key too.
  function harvestDockValues() {
    // A rebuild caused by a NEW live round must not carry the previous round's
    // text forward: the ids repeat (`d1-s1`), so it would re-fill — and
    // re-send — notes belonging to the round before. The stamp is written at
    // the end of buildDesignUI(), so during a rebuild it still names the round
    // the values on screen came from.
    if (dock && dock.dataset.iteration && dock.dataset.iteration !== liveIterationId()) return {};
    const values = {};
    document.querySelectorAll('#feedback-dock [data-comment]').forEach(el => {
      if (el.value) values[el.dataset.comment] = el.value;
    });
    return values;
  }
  window.harvestDockValues = harvestDockValues;

  // Dock content is per-iteration, but the dock itself is ONE shared overlay
  // that lives outside section[data-iteration]. Entering a frozen tab
  // stashes the live iteration's unsent values, shows the frozen
  // iteration's SUBMITTED values read-only (never `disabled` — see
  // iteration-rules.md § Freezing Design Iterations), and returning to the
  // live tab restores the stash. Both directions write EVERY dock field,
  // empty string included: screen ids repeat across iterations, so leaving a
  // field untouched would leak the other iteration's text into it.
  // The frozen payload is the JSON blob the freeze step writes into the
  // section as a script[type="application/json"][data-frozen-feedback]
  // element — `general` plus, on a design round, designs / screens / views
  // (iteration-rules.md § Freezing Design Iterations has the exact markup).
  // `general` is accepted as the submitted `{ text, attachments }` object OR
  // as a bare string, so no template needs an adapter to read its note back.
  // Never write that closing script tag literally inside this JS, not even in
  // a comment: the HTML parser ends the surrounding script element at it.
  // Missing blob (older pages) degrades to empty read-only fields rather
  // than editable ones.
  let liveDockValues = null;
  // The outgoing round's unsent text, taken ONCE per frozen visit — the
  // design layout's iteration:changed handler calls this before it rebuilds
  // the dock rows, applyDockFreezeState() calls it for every other path.
  function stashLiveDockValues() {
    if (liveDockValues === null) liveDockValues = harvestDockValues();
  }
  window.stashLiveDockValues = stashLiveDockValues;
  function frozenFeedback() {
    const it = visibleIteration();
    const node = it && it.querySelector('script[type="application/json"][data-frozen-feedback]');
    if (!node) return null;
    try { return JSON.parse(node.textContent); } catch (e) { return null; }
  }
  function frozenGeneralText(data) {
    const g = data.general;
    if (g && typeof g === 'object') return g.text || '';
    return typeof g === 'string' ? g : '';
  }
  function applyDockFreezeState() {
    if (!dock) return;
    const frozen = document.body.classList.contains('viewing-frozen');
    const fields = [...document.querySelectorAll('#feedback-dock textarea')];
    if (frozen) {
      stashLiveDockValues();
      const data = frozenFeedback() || {};
      fields.forEach(ta => {
        if (ta.dataset.designComment) ta.value = (data.designs || {})[ta.dataset.designComment] || '';
        else if (ta.dataset.screenComment) ta.value = (data.screens || {})[ta.dataset.screenComment] || '';
        // Views (§ Views (optional)) — same treatment as designs/screens
        // above: the dock lives outside section[data-iteration], so its
        // view-level textareas need the same frozen blob restore.
        else if (ta.dataset.viewComment) ta.value = (data.views || {})[ta.dataset.viewComment] || '';
        else if (ta.dataset.comment === 'general') ta.value = frozenGeneralText(data);
        ta.readOnly = true;
      });
    } else {
      const stash = liveDockValues;
      liveDockValues = null;
      // A submitted round stays read-only on the way back from a frozen tab —
      // its text is the record of what is currently in flight, not a field to
      // keep editing. Without this check the return trip silently re-armed
      // editing on a round whose payload had already left.
      const submitted = dock.dataset.submitted === 'true';
      fields.forEach(ta => {
        ta.readOnly = submitted;
        if (stash) ta.value = stash[ta.dataset.comment] || '';
      });
    }
  }
  window.applyDockFreezeState = applyDockFreezeState;

  // Called by the submit handler once the payload is captured. The dock keeps
  // every character: the round the user just submitted is still the LIVE round
  // until Claude appends the next section, and those comments are the only
  // on-screen record of what was sent. Emptying the dock here — which is what
  // this function used to do — meant a detour into an older tab and back came
  // home to a blank dock on a round that had not even been answered yet.
  //
  // Nothing leaks into the next round any more: its storage keys carry the
  // round number (§ State Persistence `_iterationPrefix`), and the reload onto
  // iteration N+1 rebuilds the dock from that empty namespace. Only editing is
  // taken away, so what is on screen cannot drift from what is in flight.
  window.markDockSubmitted = function() {
    if (!dock) return;
    document.querySelectorAll('#feedback-dock textarea').forEach(ta => { ta.readOnly = true; });
    dock.dataset.submitted = 'true';
    if (typeof saveState === 'function') saveState();
    // Push the round's final text to the bridge's durable store immediately,
    // rather than one debounce later — a reload can land at any moment now.
    if (typeof flushDraft === 'function') flushDraft();
  };

  // The exact inverse, for every path that hands control back on a round that
  // did NOT go through: a 507 from the bridge, or the safety timeout when
  // Claude stopped answering. The panel returns to ready, so the dock has to
  // return to editable — a read-only dock under a re-armed submit button means
  // the user can see their comments and change nothing about them.
  window.unmarkDockSubmitted = function() {
    if (!dock) return;
    if (document.body.classList.contains('viewing-frozen')) return;
    document.querySelectorAll('#feedback-dock textarea').forEach(ta => { ta.readOnly = false; });
    delete dock.dataset.submitted;
  };

  // Runs on load and after every iteration / design / screen switch: keep the
  // frozen-vs-live field state and the dock size in sync with what is on
  // screen. It deliberately does NOT open or close the dock — that is the
  // user's call alone, and a switch must never yank the dock open over the
  // content they just navigated to.
  function primeDock() {
    applyDockFreezeState();
    applyDockSize();
  }
  window.primeDock = primeDock;

  // A page with a design round hands the switch path to § Layout JS, whose
  // iteration:changed handler orders the stash, the row rebuild, the
  // restore and primeDock() itself (P14b). A document-only page has no such
  // handler, so the dock primes itself: once now, and on every tab switch —
  // showIteration() sets body.viewing-frozen and the <html data-template>
  // projection BEFORE it dispatches the event, so both reads below are
  // already about the round being shown. Same guard as wireDesignLayout():
  // the PAGE, not the current projection.
  const pageHasDesign = DOCK_DESIGN_TEMPLATES.has(document.documentElement.dataset.template || '')
    || !!document.querySelector('section[data-iteration][data-iteration-template="design"],'
                              + 'section[data-iteration][data-iteration-template="prototype"]');
  if (!pageHasDesign) {
    primeDock();
    document.addEventListener('iteration:changed', primeDock);
  }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
```

