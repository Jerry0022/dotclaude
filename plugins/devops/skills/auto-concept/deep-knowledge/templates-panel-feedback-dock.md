# Concept templates, part 05 of 41: Panel chrome — feedback dock

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
  // ── "Wusstest du schon?" — one static fact per dock open (rules below).
  const DOCK_TIPS = {
    de: [
      "Alt halten zeigt alle Hotkeys der Seite.",
      "Strg + Klick setzt eine Notiz ins Design.",
      "Leertaste öffnet und schließt die Notizen.",
      "Das Auge 👁 blendet alle Notizen aus.",
      "Tasten 1–3 wählen die Variante.",
      "I, II, III in der Leiste sind Unterseiten.",
      "F markiert die Variante als Favorit ★.",
      "V wechselt zwischen den Geräteansichten.",
      "←/→ blättern, ↑/↓ wechseln die Ebene.",
      "Esc führt zurück zur Übersicht.",
      "Deine Entwürfe speichern sich laufend.",
      "Neu laden verliert keine Notiz.",
      "Abgeschickte Runden bleiben genau erhalten.",
      "Frühere Runden bleiben lesbar, nur gesperrt.",
      "Vor dem Umsetzen prüft das Plugin den Code.",
      "Beim Umsetzen kann ein Agent-Team helfen.",
      "Folgeaufgaben können Issues werden.",
      "Das Ergebnis lässt sich direkt ausliefern.",
      "Am Ende steht ein Bericht mit Gliederung.",
      "Das Panel meldet offene Punkte vorab.",
      "📎 hängt Dateien an, auch per Einfügen.",
      "Dateien lassen sich ins Feld ziehen.",
      "Anhänge liegen im Concept-Ordner.",
      "Zuordnungen (was wohin) haben eine Matrix.",
      "Notizen am Entwurf stellen die Kernfragen.",
      "Notiz-Blasen lassen sich beiseiteziehen.",
      "Beantwortete Notizen am Entwurf zeigen ✓.",
      "Die Zahl am Auge zählt offene Notizen.",
      "Eigene Notizen am Entwurf sind ganz ziehbar.",
      "Es ist immer nur eine Notiz-Blase offen.",
      "Beim Schreiben treten andere Notizen zurück.",
      "Jedes Feld zeigt, worauf es sich bezieht.",
      "Oben: diese Seite. Unten: das ganze Concept.",
      "Jede Variante ist ein eigenes Design.",
      "Die Übersicht vergleicht alle Varianten.",
      "Jede Variante nennt drei echte Unterschiede.",
      "Höchstens ein Favorit pro Runde.",
      "Der Favorit startet die nächste Runde.",
      "Notizen zu allen Varianten zählen mit.",
      "Ohne Favorit entscheiden deine Notizen.",
      "Frage-Seiten klären, was überall gilt.",
      "Welches Design gewinnt, sagst du im Dock.",
      "Der Modus wird einmal am Anfang geklärt.",
      "Design und Entscheidung lassen sich mischen.",
      "Nach einem Design bleibt es meist Design.",
      "Entscheidungen zeigen Vor- und Nachteile.",
      "Freie Runden: Analysen ohne Varianten.",
      "Die Seite läuft lokal in deinem Browser.",
      "Ohne Verbindung arbeitet die Seite weiter.",
      "Das Plugin wartet auf dich, statt zu raten.",
      "Abschicken sendet alles als eine Nachricht.",
      "Notizen gehen getrennt nach Ebene raus.",
      "Eigene Notizen merken sich ihre Stelle.",
      "Eine leere Notiz wird nicht gespeichert.",
      "Notiz: Enter speichert, Esc verwirft.",
      "Umschalt + Enter macht eine neue Zeile.",
      "☰ öffnet Entscheidungen, Runden, Inhalt.",
      "Hell oder dunkel stellst du im Panel um.",
      "Die Rundenleiste zeigt, wer gerade dran ist.",
      "Das Schloss schaltet auf Umsetzen um.",
      "Der Rücklauf-Pfeil nimmt das wieder zurück.",
      "Beim Umsetzen zählt die Leiste den Umfang.",
      "Die Zahl in der Leiste nennt den Schritt.",
      "Abgeschickt heißt gespeichert.",
      "Offline speichert die Seite lokal weiter.",
      "Der Toast unten zeigt den Fortschritt.",
      "Fertige Toasts gehen von selbst.",
      "Eine neue Runde startet auf der Startseite.",
      "Neugedacht/Verbessert markiert Änderungen.",
      "Pro Variante höchstens ein Hinweis.",
      "Die Übersicht zeigt echte Live-Vorschauen.",
      "Design öffnen ↗ springt in die Variante.",
      "Die Leiste oben springt zu jeder Seite.",
      "„Fragen“ springt zur nächsten offenen Frage.",
      "Eine Frage zählt, sobald du sie bedienst.",
      "Hotkey-Tipps erscheinen nur bei Bedarf.",
      "✕ am Tipp blendet ihn 30 Tage aus.",
      "Alle Texte gibt es auf Deutsch und Englisch.",
      "Die Sprache folgt deinem ersten Prompt.",
      "Geräteansichten nur bei Handy oder Tablet.",
      "Eigene Notizen nur in der Desktop-Ansicht.",
      "Gesperrte Runden nehmen keine Notizen an.",
      "Der Balken oben führt zur aktuellen Runde.",
      "Nur die letzte Runde ist bearbeitbar.",
      "Das Plugin nutzt einen eigenen Worktree.",
      "Visuelle Fragen kommen immer als Design.",
      "Prototypen sind echte Klickstrecken.",
      "Jeder Hotkey steht im Tooltip seines Knopfs.",
      "Hotkey-Tooltips folgen nach kurzem Warten.",
      "⤢ vergrößert die Notiz-Felder.",
      "Das Dock merkt sich, ob du es groß willst.",
      "Das aktive Feld leuchtet sanft.",
      "Felder wachsen mit deinem Text mit.",
      "Beim Öffnen steht der Cursor schon im Feld.",
      "Seitenwechsel nimmt den Cursor mit.",
      "Esc im Notizfeld schließt die Notizen.",
      "Ein Concept lässt sich pausieren.",
      "Am Ende steht eine Abschlusskarte.",
      "Strg + Enter startet die nächste Runde."
    ],
    en: [
      "Hold Alt to see every hotkey on the page.",
      "Ctrl + click puts a note on the design.",
      "Space opens and closes your notes.",
      "The eye 👁 hides all notes.",
      "Keys 1–3 pick the variant.",
      "I, II, III in the bar are subpages.",
      "F marks the variant as favourite ★.",
      "V switches between device views.",
      "←/→ flip pages, ↑/↓ change the level.",
      "Esc takes you back to the overview.",
      "Your drafts save themselves as you go.",
      "Reloading never loses a note.",
      "Submitted rounds stay exactly as sent.",
      "Earlier rounds stay readable, just locked.",
      "Before implementing, the plugin checks code.",
      "An agent team can help with implementing.",
      "Follow-ups can become issues.",
      "The result can be shipped right away.",
      "At the end comes a report with an outline.",
      "The panel lists open points up front.",
      "📎 attaches files, also by paste.",
      "You can drag files into the field.",
      "Attachments live in the concept folder.",
      "Assignments (what goes where) get a matrix.",
      "Notes on the design ask the key questions.",
      "Note bubbles can be dragged aside.",
      "Answered notes on the design show a ✓.",
      "The number on the eye counts open notes.",
      "Your own notes on the design are draggable.",
      "Only one note bubble is open at a time.",
      "While you write, other notes step back.",
      "Each field shows what it refers to.",
      "Top: this page. Bottom: the whole concept.",
      "Each variant is a design of its own.",
      "The overview compares all variants.",
      "Each variant names three real differences.",
      "At most one favourite per round.",
      "The favourite starts the next round.",
      "Notes on every variant still count.",
      "No favourite? Your notes decide.",
      "Question pages ask what holds everywhere.",
      "Name the winning design in the dock.",
      "The mode is settled once at the start.",
      "Design and decisions can be mixed.",
      "After a design round, design usually stays.",
      "Decisions show pros and cons.",
      "Free rounds: analyses without variants.",
      "The page runs locally in your browser.",
      "Without a connection the page keeps working.",
      "The plugin waits for you, it never guesses.",
      "Submitting sends everything as one message.",
      "Notes are sent separately per level.",
      "Your own notes remember their spot.",
      "An empty note is not saved.",
      "Note: Enter saves, Esc discards.",
      "Shift + Enter starts a new line.",
      "☰ opens decisions, rounds and contents.",
      "Switch light or dark in the panel.",
      "The round bar shows whose turn it is.",
      "The lock switches to implementing.",
      "The back arrow undoes that again.",
      "While implementing, the bar counts scope.",
      "The number in the bar names the step.",
      "Submitted means saved.",
      "Offline, the page keeps saving locally.",
      "The toast at the bottom shows progress.",
      "Finished toasts go away on their own.",
      "A new round starts on the start page.",
      "Rethought/Improved marks what changed.",
      "At most one hint per variant.",
      "The overview shows real live previews.",
      "Open design ↗ jumps into the variant.",
      "The bar on top jumps to any page.",
      "“Questions” jumps to the next open one.",
      "A question counts once you use it.",
      "Hotkey tips only appear when useful.",
      "✕ on a tip hides it for 30 days.",
      "All texts exist in German and English.",
      "The language follows your first prompt.",
      "Device views only for phone or tablet.",
      "Own notes only in the desktop view.",
      "Locked rounds take no new notes.",
      "The bar on top leads to the current round.",
      "Only the latest round is editable.",
      "The plugin uses its own worktree.",
      "Visual questions always come as a design.",
      "Prototypes are real click paths.",
      "Every hotkey is in its control's tooltip.",
      "Hotkey tooltips follow after a short wait.",
      "⤢ enlarges the note fields.",
      "The dock remembers if you made it large.",
      "The active field glows softly.",
      "Fields grow with your text.",
      "On open, the cursor is already in the field.",
      "Switching pages takes the cursor along.",
      "Esc in a note field closes the notes.",
      "A concept can be paused and resumed.",
      "At the end comes a completion card.",
      "Ctrl + Enter starts the next round."
    ]
  };
  // Index → hotkey id (same ids as § Hotkey overlay's conceptHotkeyUsed):
  // a hotkey tip is dropped for good once the user has used that hotkey.
  // de[i] and en[i] are the same fact, so one map serves both locales.
  const DOCK_TIP_HOTKEY = { 0: 'alt', 1: 'upin', 2: 'dock', 4: 'variants', 6: 'fav', 7: 'view', 8: 'pages', 9: 'esc', 95: 'dock-esc', 98: 'submit' };
  window.DOCK_TIP_HOTKEY = DOCK_TIP_HOTKEY;
  window.DOCK_TIPS = DOCK_TIPS;
  window.nextDockTipIndex = function(n, last, rand) {
    if (n < 2) return 0;
    const r = typeof rand === 'number' ? rand : Math.random();
    return ((last < 0 ? 0 : last) + 1 + Math.floor(r * (n - 1))) % n;
  };
  // Tip rules (the nudges in § Hotkey overlay follow the same spirit):
  // 1. never a tip already shown in this page session; 2. never one seen on
  // an earlier visit until the pool is used up (localStorage
  // `hint-dock-tips-seen`, try / catch); 3. a hotkey tip never again once
  // that hotkey was used (window.conceptHotkeyUsed); 4. never the same tip
  // twice in a row. Each text is ONE dock line (≤ 44 chars, test-enforced)
  // and says "Notiz", never the dev-internal "Pin".
  const TIPS_SEEN_KEY = 'hint-dock-tips-seen';
  const sessionTips = new Set();
  function readSeenTips() {
    try { return new Set(JSON.parse(localStorage.getItem(TIPS_SEEN_KEY) || '[]')); } catch (e) { return new Set(); }
  }
  function writeSeenTips(set) {
    if (typeof _guardedSetItem === 'function') _guardedSetItem(TIPS_SEEN_KEY, JSON.stringify([...set]));
  }
  // Pure pick (exported for the tests): a random index of `n` that is not in
  // `excluded`; falls back to nextDockTipIndex when everything is excluded.
  window.pickDockTip = function(n, excluded, last, rand) {
    const open = [];
    for (let i = 0; i < n; i++) if (!excluded.has(i) && i !== last) open.push(i);
    if (!open.length) return window.nextDockTipIndex(n, last, rand);
    const r = typeof rand === 'number' ? rand : Math.random();
    return open[Math.min(open.length - 1, Math.floor(r * open.length))];
  };
  function chooseDockTip(n) {
    const usedHotkey = i => !!(DOCK_TIP_HOTKEY[i] && window.conceptHotkeyUsed?.(DOCK_TIP_HOTKEY[i]));
    let seen = readSeenTips();
    const blocked = s => {
    const x = new Set([...s, ...sessionTips]);
    for (let i = 0; i < n; i++) if (usedHotkey(i)) x.add(i);
    return x;
  };
    let excluded = blocked(seen);
    if (excluded.size >= n) { seen = new Set(); excluded = blocked(seen); }   // pool exhausted: start over
    const i = window.pickDockTip(n, excluded, lastDockTip);
    sessionTips.add(i);
    seen.add(i);
    writeSeenTips(seen);
    return i;
  }
  let lastDockTip = -1;
  function showDockTip() {
    if (!dock) return;
    let box = document.getElementById('dock-tip');
    if (!box) {
      box = document.createElement('div');
      box.id = 'dock-tip';
      box.className = 'dock-tip';
      const title = document.createElement('b');
      title.innerHTML = '<svg class="dock-tip-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 1a5 5 0 0 0-3.1 8.9c.6.5 1.1 1.2 1.1 2V12h4v-.1c0-.8.5-1.5 1.1-2A5 5 0 0 0 8 1zM6 13h4v.5A1.5 1.5 0 0 1 8.5 15h-1A1.5 1.5 0 0 1 6 13.5z"/></svg>';
      title.append('{{dock.tip_title}}');
      const text = document.createElement('span');
      text.className = 'dock-tip-text';
      box.append(title, text);
      dock.appendChild(box);
    }
    const lang = (document.documentElement.lang || 'en').slice(0, 2) === 'de' ? 'de' : 'en';
    const pool = DOCK_TIPS[lang];
    lastDockTip = chooseDockTip(pool.length);
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

  // Maximise/restore (Work package B) — a RESIZE, never a close: it flips
  // data-userMaximized, SEPARATE from data-size (applyDockSize() still only
  // computes compact/wide); the CSS composes both. Persisted as
  // state['dockMaximized'] (§ State Persistence), restored via
  // applyDockSize() — which never clears data-userMaximized on a switch.
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
  // in every iteration state including frozen ones — nothing to un-learn.
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

