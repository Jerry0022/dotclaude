# Concept templates, part 05 of 42: Panel chrome — feedback dock

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
  // Every tip is about USING this page (never about the reviewed content or
  // the plugin's internals), understandable on a first visit, one line.
  const DOCK_TIPS = {
    de: [
      "? zeigt alle Hotkeys der Seite.",
      "Strg + Klick ins Design setzt eine Notiz.",
      "Leertaste öffnet und schließt die Notizen.",
      "Tasten 1–9 springen direkt zur Variante.",
      "F markiert die offene Variante als Favorit.",
      "V schaltet die Geräteansicht um.",
      "←/→ blättern durch die Seiten.",
      "Esc führt eine Ebene zurück.",
      "Esc im Notizfeld schließt die Notizen.",
      "Strg + Enter schickt die Runde ab.",
      "Das Auge 👁 blendet Notizen und Leisten aus.",
      "☰ zeigt alle Seiten und offenen Fragen.",
      "Im ☰-Menü öffnet ein Klick jede Seite.",
      "Oberstes Feld: Notiz nur zu dieser Seite.",
      "Unterstes Feld: Notiz zum ganzen Concept.",
      "Deine Notizen speichern sich automatisch.",
      "Neu laden oder Schließen verliert nichts.",
      "📎 hängt Dateien an – auch per Strg + V.",
      "Dateien lassen sich direkt ins Feld ziehen.",
      "⤢ vergrößert die Notizen für längere Texte.",
      "Design-Notiz: Enter speichert, Esc verwirft.",
      "Notiz-Blasen lassen sich beiseiteziehen.",
      "Die Übersicht vergleicht alle Varianten.",
      "★ Favorit: höchstens einer pro Runde.",
      "Ein Favorit ist optional – Notizen reichen.",
      "Fragen-Seiten gelten für alle Varianten.",
      "Hell oder dunkel stellst du im ☰-Menü um.",
      "Frühere Runden bleiben lesbar, nur gesperrt.",
      "Jeder Hotkey steht im Tooltip seines Knopfs."
    ],
    en: [
      "Press ? to see every hotkey on the page.",
      "Ctrl + click on the design adds a note.",
      "Space opens and closes these notes.",
      "Keys 1–9 jump straight to a variant.",
      "F marks the open variant as favourite.",
      "V switches the device view.",
      "←/→ flip through the pages.",
      "Esc goes back one level.",
      "Esc in a note field closes the notes.",
      "Ctrl + Enter submits the round.",
      "The eye 👁 hides notes and toolbars.",
      "☰ lists every page and open question.",
      "In the ☰ menu, one click opens any page.",
      "Top field: a note on this page only.",
      "Bottom field: a note on the whole concept.",
      "Your notes save themselves as you type.",
      "Reloading or closing loses nothing.",
      "📎 attaches files – Ctrl + V works too.",
      "You can drop files straight into a field.",
      "⤢ enlarges the notes for longer texts.",
      "Design note: Enter saves, Esc discards.",
      "Note bubbles can be dragged aside.",
      "The overview compares every variant.",
      "★ Favourite: at most one per round.",
      "A favourite is optional – notes suffice.",
      "Question pages apply to every variant.",
      "Switch light or dark in the ☰ menu.",
      "Earlier rounds stay readable, just locked.",
      "Each button's tooltip names its hotkey."
    ]
  };
  // Index → hotkey id (same ids as § Hotkey overlay's conceptHotkeyUsed):
  // a hotkey tip is dropped for good once the user has used that hotkey.
  // de[i] and en[i] are the same fact, so one map serves both locales.
  const DOCK_TIP_HOTKEY = { 0: 'keys', 1: 'upin', 2: 'dock', 3: 'variants', 4: 'fav', 5: 'view', 6: 'pages', 7: 'esc', 8: 'dock-esc', 9: 'submit' };
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
  const TIPS_SEEN_KEY = 'hint-dock-tips-seen-v2';   // v2: pool rewritten, old indices void
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

