# Concept templates, part 02 of 16: Panel chrome, per-iteration templates

## Panel Chrome (all templates)

**The decision panel is page chrome, not a layout choice.** It is the same
`<aside class="concept-decision-panel" id="decision-panel">` on every
page, opened by the same ☰ FAB in the top-right corner, backed by the same
`.panel-backdrop`, in `decision`, `free` and `design` rounds alike.

This is a contract about the CONCEPT, not about one round. A page mixes
templates on purpose (a `design` concept that answers a non-visual question in
a `decision` round, the `free` final report that closes it), and the panel
used to move with the template: docked into a 20% sidebar for document rounds,
behind the FAB for design rounds. Reviewers hit that mid-session — the menu
they had been using for three rounds was suddenly a column in the page, and
the note fields with it. Where the panel lives must not depend on which round
is on screen.

**The 💬 feedback dock is page chrome too.** The same `<aside class="feedback-dock"
id="feedback-dock">` behind the same 💬 FAB in the bottom-right corner, in
every round of every template (#399). It used to exist only in `design`
rounds, so a reviewer's general note had a home over a mockup and none over a
document — and a concept that mixed templates lost the dock mid-session
together with whatever was typed into it. What differs per round is only what
the dock CONTAINS:

| Round | What the 💬 dock holds | Where else comments are written |
|---|---|---|
| `design` | per-screen / per-design / per-view rows (specific → general, top to bottom), then the general note | annotation bubbles, view notes |
| `decision`, `free` | the general note only (+ its attachment slot) — the dock is `compact` | inline `textarea[data-comment]` next to the item being judged |

A concept may mix the two freely from round to round — what may never move is
the ☰ panel or the 💬 dock. The payload is one shape everywhere
(`comments: { general: { text, attachments }, items: [ … ] }`, § collectDecisions
(dispatcher)), so no consumer branches on the template to find the general note.

**Required on every generated page, whatever the template:**

```html
<!-- inside .concept-layout, after the </aside> -->
<button id="panel-toggle" class="panel-fab"
        aria-label="{{panel.toggle_open}}"
        data-tip="{{panel.toggle_open}}"
        aria-expanded="false"
        data-label-open="{{panel.toggle_open}}"
        data-label-close="{{panel.toggle_close}}">☰</button>
<div class="panel-backdrop" id="panel-backdrop"></div>

<!-- …and the 💬 FAB + dock right after them: header row (#feedback-maximize,
     #feedback-close) + the general section (#design-general-feedback with
     data-comment="general" data-attachable + its .attach-slot). Copy them
     from § Common Structure; a design page copies the design skeleton's
     dock, which is the same markup plus the three row containers above the
     general section. -->
```

plus, inside the aside, the `.panel-head` row (`#theme-toggle` + `#panel-close`,
§ Theme Toggle) as its first child, and the CSS + JS below. All of it is
unscoped and required even on a page that never renders a mockup — that is
the point of this section: a `decision`- or `free`-only page carries its
panel AND its dock WITHOUT taking § Layout CSS (the design canvas) with it.
The `html:not([data-template="design"])` hide list in § Layout CSS covers the
design-only chrome (screen indicator, switchers, device toggle, annotation
layer) and nothing of the dock; the compact rule at the end of the CSS block
below is what turns the dock into a general-note-only bubble while a document
round is on screen. § Layout CSS keeps only the design-side row collapse
rules (`body[data-single-*]`, the view-mode swap).

```css
/* Overlay decision panel — PAGE CHROME, unscoped on purpose: the same aside,
   the same slide-in, the same ☰ FAB in every template.
   This rule used to be scoped to the design layout, and in a
   decision/free round the aside docked back into a sidebar grid — so a
   concept that mixed templates (a reality-check round, a final report)
   silently moved its panel, and with it the feedback surface, from behind the
   FAB into the page. */
.concept-decision-panel {
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  right: -400px;
  width: 360px;
  max-width: 90vw;
  height: 100vh;
  box-sizing: border-box;
  padding: 1.5rem;
  background: var(--panel-bg, #161b22);
  border-left: 1px solid var(--border-color, #30363d);
  z-index: 200;
  /* The aside never scrolls; .panel-nav-scroll does (§ Decision Panel State
     CSS "Panel anatomy") so the status line + CTA foot stay pinned. */
  overflow: hidden;
  transition: right 0.3s ease;
}
.concept-decision-panel.open {
  right: 0;
}

/* ── The two FABs are ONE component with two positions ──
   They are the only floating chrome on a design page, they sit on the same
   right-hand edge, and the user reads them as a pair — so every property
   that governs their shape lives in this single rule and NOTHING below may
   override size, radius, padding or typography. Divergent sizes (the old
   56px ☰ vs 64px 💬) read as an accident, and per-page tweaks made it worse:
   across concepts the two ended up visibly different every time.
   `box-sizing`, `padding: 0`, `line-height: 1` and the flex centring are
   what keep them perfectly circular with the glyph centred — a bare
   width/height on a <button> still inherits UA padding and baseline
   metrics, which is how "round" turns into "slightly egg-shaped". */
.panel-fab,
.feedback-fab {
  position: fixed;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  padding: 0;
  border-radius: 50%;
  border: none;
  background: var(--accent-color, #58a6ff);
  color: #fff;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 100;
  transition: transform 0.2s, opacity 0.2s;
}
/* ☰ lives top-right (Wave 3). The three top-edge overlays partition the
   width by construction rather than by hope:
     screen indicator  1rem … 33vw - 0.5rem   (max-width cap + ellipsis)
     design switcher   33vw … 67vw            (max-width: 34vw, centred)
     ☰ FAB             100vw - 92px … 100vw - 2rem   (60px + 2rem margin)
   Those bands cannot intersect for any viewport width where
   67vw < 100vw - 92px, i.e. above 279px — below that the layout is out of
   scope anyway. Measured in Edge at 1280/768/375px: no overlap at any of
   the three. Before the caps existed the indicator overlapped the switcher
   by 21px at 768px and completely at 375px, where it also reached the ☰
   FAB. 💬 lives bottom-right, clear of the top edge entirely.

   #anno-toggle (the optional annotation eye pill) does NOT compete for this
   horizontal partition at all — it sits on a SEPARATE row, left edge,
   directly below the screen indicator: `top: 3.75rem; left: 1rem`. That
   offset is fixed regardless of viewport width because the indicator's own
   height never changes: `.screen-indicator` is `white-space: nowrap` with a
   `max-width` + ellipsis (it never wraps to a second line), so its height
   stays the padding + single-line-box height (~1.9rem) at every viewport,
   including the narrowest ones this file scopes to (≥279px, see above).
   `3.75rem` = indicator `top: 1rem` + its ~1.9rem measured height + a
   0.5rem breathing gap, rounded up. The pill's own content-width (glyph +
   counter) is small and fixed, so unlike the indicator/switcher it needs no
   max-width cap — there is nothing else sharing its row. */
.panel-fab { top: 2rem; right: 2rem; }
.feedback-fab { bottom: 2rem; right: 2rem; }
.panel-fab:hover,
.feedback-fab:hover { transform: scale(1.08); }
/* Only the ☰ panel FAB hides when its panel opens (the decision panel is
   a full overlay). The 💬 feedback FAB stays visible while the dock is
   open so the user can toggle it back closed via the same FAB. */
.panel-fab.hidden { opacity: 0; pointer-events: none; }

.panel-close-btn,
.feedback-close-btn {
  align-self: flex-end;
  background: none;
  border: none;
  color: var(--text-color, #c9d1d9);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.25rem;
}

/* ── Panel head row: round label · back link · 🕘 chip · theme toggle · ✕ ──
   The aside's first child. Right-aligned so the ✕ keeps its top-right
   corner; the toggle sits to its left on the same line, the 🕘 rounds chip
   (+ the frozen-round back link) to the left of that, and the round label
   ("Iteration 8 (Variante)") takes the left end — `margin-right: auto` on
   it is what keeps the controls flush right. One row instead of chrome row
   + "you are here" line: the label used to sit on its own line below the ✕,
   a line of panel height spent on nothing (the user's call, 2026-09-20).
   The toggle is the quiet one of the pair — greyed and dimmed at rest, full
   colour only under the pointer or keyboard focus — so the row still reads
   as "one ✕", not as two controls competing for the corner. Emoji glyphs on
   purpose (the user's call): the grayscale filter is what keeps the
   full-colour platform art from clashing with the dark chrome until it is
   actually wanted. */
.panel-head {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
  min-height: 2rem;
}
.panel-head .panel-here-round {
  margin-right: auto;
  min-width: 0;
  overflow: hidden; text-overflow: ellipsis;
  font-size: 0.85rem;
}
.panel-head .panel-here-right { margin-right: 0.25rem; }
.theme-toggle-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.55;
  filter: grayscale(1);
  transition: opacity 0.2s, filter 0.2s;
}
.theme-toggle-btn:hover,
.theme-toggle-btn:focus-visible { opacity: 1; filter: none; }
/* One glyph at a time, and it is the theme you would switch TO — the same
   "name the next action" rule the ☰/💬 FAB labels follow. Keyed on the
   attribute the click handler and restoreState() both write. */
.theme-toggle-btn .theme-glyph { display: none; }
html[data-theme="dark"] .theme-toggle-btn [data-glyph="sun"] { display: inline; }
html:not([data-theme="dark"]) .theme-toggle-btn [data-glyph="moon"] { display: inline; }

.panel-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 150;
}
.panel-backdrop.visible { display: block; }
/* The open panel is modal: it has a backdrop, and behind that backdrop
   nothing may scroll. Design mode already locks the body
   (html[data-template="design"] body { overflow: hidden }); a document round
   did not, so a wheel over the backdrop scrolled the report underneath —
   which also drags the scroll spy and rewrites the "you are here" head the
   user is reading. */
html:not([data-template="design"]) body.panel-open { overflow: hidden; }
/* The 💬 FAB sits at z-index 220 — above the panel (200) and its backdrop
   (150). While the panel is open it is therefore a live control painted on
   top of a modal, and clicking it would pull the panel out from under the
   pointer (openDock() closes the panel by design). It hides with the panel
   open, exactly like the design switcher does. */
body.panel-open .feedback-fab { opacity: 0; pointer-events: none; }

/* No FAB gutter under the pinned foot. The foot used to reserve
   `padding-bottom: calc(60px + 2rem)` for the 💬 FAB's row, but the FAB
   hides whenever the panel is open (`body.panel-open .feedback-fab` above)
   and the panel is only ever visible open — so the reserve was ~92px of dead
   space under the close-out sheet, while its rows region scrolled on a Full
   HD screen for want of exactly that height. */

/* ── One-shot attention pulse on the 💬 FAB ──
   The dock is where every note is written, and an unlabelled emoji circle in
   a corner is genuinely missable — so the FAB announces itself exactly three
   times, then never again: the JS strips `data-untouched` on the first dock
   open OR the first keystroke inside the dock, so a returning user is not
   nagged. It is `animation`, not a class, so it costs nothing once the
   attribute is gone.
   Geometry is OFF LIMITS here (gate P13): box-shadow and transform ONLY, no
   width/height/border-radius/padding — those live in the shared
   .panel-fab/.feedback-fab rule and the two FABs must stay one component.
   transform: scale() also composes with the :hover scale rather than
   fighting it, since both write the same property and hover wins by
   source order while pointing. */
@keyframes fabPulse {
  0%, 100% { transform: scale(1);    box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  50%      { transform: scale(1.12); box-shadow: 0 4px 12px rgba(0,0,0,0.3), 0 0 0 12px rgba(88,166,255,0.18); }
}
.feedback-fab[data-untouched="true"] { animation: fabPulse 2.6s ease-in-out 3; }
@media (prefers-reduced-motion: reduce) {
  /* No substitute cue: the tooltip is the discoverability path that does not
     move, and it is present either way. */
  .feedback-fab[data-untouched="true"] { animation: none; }
}

/* ── Feedback Dock — Speech-Bubble anchored to the 💬 FAB (bottom-right) ──
   Geometry: ☰ lives top-right, 💬 bottom-right (60px). The dock is anchored
   to the FAB's corner and has EXACTLY TWO sizes — never a viewport-
   proportional one, never shrink-to-content:
     compact  420px wide  — one general note (every document round; a design
                             round with a single design and a single screen)
     wide     560px wide  — screen + design + general notes, specific → general
   Both sizes are deliberate. A dock that spans the page turns every textarea
   into one 1200px line nobody ever wraps in; a dock sized to its content
   becomes a box you cannot type three lines into without scrolling. Which
   size applies is decided in JS by applyDockSize() (§ Panel Chrome JS)
   from the <html data-template> projection and the same body[data-single-*]
   flags the design layout sets, so the same round shape always yields the
   same dock.
   * right = FAB.right (2rem)             → bubble's right edge aligns with FAB
   * bottom = FAB.bottom + 60 - 6px       → bubble sits directly above the 60px
                                            FAB with a hair of overlap so the
                                            visual connection reads as "the
                                            bubble grows out of the FAB".
   The dock no longer reserves padding for the FAB: it now ends above it
   rather than spanning across it. The FAB keeps its higher z-index so it
   stays visible and clickable while the dock is open — clicking it toggles
   the dock.
   --dock-ceiling: the dock's TOP edge stops just below the ☰ FAB. Both are
   right-edge overlays in the same column (right: 2rem), and the dock
   (z-index 180) used to grow straight over the ☰ FAB on a tall viewport:
   80vh at 1080px is 864px, the ☰ band ends 92px from the top, so the dock
   covered it and the ☰ was unreachable while the dock was open. The
   ceiling is viewport − ☰ band (top 2rem + 60px + 0.75rem gap) − the
   dock's own bottom offset (2rem + 54px). Every max-height below is
   min(--dock-ceiling, its px cap): the cap still rules on tall viewports,
   the ceiling only bites when the content would reach the ☰. */
.feedback-dock {
  --dock-ceiling: calc(100vh - (2rem + 60px + 0.75rem) - (2rem + 60px - 6px));
  position: fixed;
  left: auto;
  right: 2rem;
  bottom: calc(2rem + 60px - 6px);
  width: min(420px, calc(100vw - 4rem));
  /* 900px, not 460px: at a ~1080px-tall viewport the compact dock must show
     screen + design + general at once (§ Feedback behaviour) without
     scrolling or the user reaching for maximise. The old 460px cap was
     sized for the single-general-note case only, before the reorder made
     three sections the compact default's normal load. */
  max-height: min(var(--dock-ceiling), 900px);
  padding: 1rem 1.25rem 1.25rem;
  background: var(--panel-bg, #161b22);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 18px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.25);
  z-index: 180;
  overflow-y: auto;
  display: none;
  flex-direction: column;
  gap: 0.85rem;
  transform-origin: 100% 100%; /* anchor: the 💬 FAB it grows out of */
}
.feedback-dock[data-size="wide"] {
  width: min(560px, calc(100vw - 4rem));
  max-height: min(var(--dock-ceiling), 940px);
}
/* Work package B — user-controlled maximise. Deliberately keyed off a
   SEPARATE attribute (data-user-maximized), not a third data-size value:
   applyDockSize() (§ Panel Chrome JS) still only ever assigns compact/wide from
   the round's shape — exactly the same two sizes as before — and this
   rule composes on top of whichever one is active by appearing later in
   the stylesheet (same specificity, source-order wins). */
.feedback-dock[data-size][data-user-maximized="true"] {
  width: min(1100px, calc(100vw - 4rem));
  max-height: min(var(--dock-ceiling), 860px);
}
.feedback-dock[data-size][data-user-maximized="true"] .feedback-section textarea {
  min-height: 220px;
}
.feedback-dock[data-open="true"] {
  display: flex;
  animation: feedback-dock-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
@keyframes feedback-dock-in {
  from { opacity: 0; transform: translateY(8px) scale(0.94); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* Both FABs sit above the dock so they stay visible AND clickable while
   the dock is open. 💬: the dock's bottom edge overlaps the FAB's top edge
   by ~6px, so the bubble visually reads as growing out of the FAB. ☰: the
   --dock-ceiling above already keeps the dock out of its band; the z-index
   is the second lock, so a page that lost the ceiling (an older max-height
   rule surviving a re-sync) still leaves the ☰ clickable — and a click on
   it closes the dock (openPanel() → closeDock(true), § Panel Chrome). The
   ☰ FAB hides itself (.hidden) once the panel is open, so it never sits
   above the panel it opened. */
.feedback-fab { z-index: 220; }
.panel-fab { z-index: 220; }

.feedback-dock-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 0.25rem;
}
.feedback-dock-header strong { font-size: 1rem; }

/* Minimise button — visual cue is the underscore-low minus, not an ✕,
   so the user understands their text is preserved (not destroyed). */
.feedback-close-btn {
  background: none; border: none; cursor: pointer;
  color: var(--text-secondary, #8b949e);
  font-size: 1.6rem; line-height: 1; font-weight: 500;
  padding: 0 0.4rem 0.2rem; border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}
.feedback-close-btn:hover {
  background: color-mix(in srgb, var(--text-color) 12%, transparent);
  color: var(--text-color, #c9d1d9);
}

/* Maximise/restore — a DISTINCT control from minimise (above): minimise
   closes the dock, this one only resizes it. Same visual language so the
   two read as a pair, but a different icon/meaning entirely. */
.feedback-maximize-btn {
  background: none; border: none; cursor: pointer;
  color: var(--text-secondary, #8b949e);
  font-size: 1.1rem; line-height: 1;
  padding: 0.2rem 0.4rem; border-radius: 6px; margin-right: 0.15rem;
  transition: background 0.15s, color 0.15s;
}
.feedback-maximize-btn:hover {
  background: color-mix(in srgb, var(--text-color) 12%, transparent);
  color: var(--text-color, #c9d1d9);
}
.feedback-maximize-btn[aria-pressed="true"] { color: var(--accent-color); }

.feedback-section { display: flex; flex-direction: column; gap: 0.35rem; }
.feedback-section label { font-size: 0.82rem; color: var(--text-secondary); font-weight: 500; }
.feedback-section label strong { color: var(--accent-color); }
.feedback-section textarea {
  box-sizing: border-box; width: 100%; padding: 0.65rem 0.7rem;
  border: 1px solid var(--border-color); border-radius: 10px;
  background: var(--input-bg, #0d1117); color: var(--text-color, #c9d1d9);
  /* 80px, not 90px: with the reorder the compact dock's normal load is
     three sections (§ Feedback behaviour), so each textarea gives up a
     little height to the max-height budget above — 80px still clears
     ~2-3 visible lines at this line-height/padding, it just no longer
     eats the margin the dock needed for the two rows beside it. */
  font-family: inherit; font-size: 0.95rem; line-height: 1.5; resize: vertical; min-height: 80px;
}
.feedback-section textarea:focus { outline: none; border-color: var(--accent-color); }
.feedback-divider { height: 1px; background: var(--border-color); margin: 0.2rem 0; }
/* The attach bar's own margin-top (§ Attachments CSS) is meant for contexts
   with no flex-gap parent (decision notes, annotation bubbles). Inside the
   dock, .feedback-section already applies that same gap between its
   children (label / textarea / attach-slot), so the bar's margin-top would
   double it — the bar would sit further from "its" textarea than the
   textarea sits from its own label. Zeroing it here keeps the rhythm even
   without touching the shared .attach-bar rule other surfaces still rely on. */
.feedback-dock .attach-bar { margin-top: 0; }

/* Narrow viewports (≤560px): the two fixed widths stop making sense below
   the compact size, so the dock spans the viewport with tight margins.
   Both size variants collapse to the same geometry here. */
@media (max-width: 560px) {
  .feedback-dock,
  .feedback-dock[data-size="wide"],
  .feedback-dock[data-size][data-user-maximized="true"] {
    left: 0.75rem;
    right: 0.75rem;
    width: auto;
    max-height: min(var(--dock-ceiling), 62vh);
    padding: 1rem;
    border-radius: 14px;
  }
}

/* ── Document rounds: the general note only ──
   The dock is the same overlay in every round; what a decision / free round
   shows of it is the header row and the general section. A page copied from
   § Common Structure carries no other rows, so this rule is a no-op there;
   on a page that mixes templates (a design concept's reality-check or final
   report round) it folds the per-screen / per-design / per-view rows and
   every divider away while a document round is on screen, and they come
   back untouched on the next design tab — nothing is rebuilt, only hidden.
   Keyed on the <html data-template> projection (§ Per-Iteration Templates),
   exactly like the design-only chrome list in § Layout CSS, and with the
   `html` type selector for the same reason (a bare :not() also matches
   <body>). The general section is found by its textarea's id so a design
   page's row order (general LAST) does not matter here. */
html:not([data-template="design"]) .feedback-dock .feedback-section:not(:has(#design-general-feedback)),
html:not([data-template="design"]) .feedback-dock .feedback-divider { display: none; }
```

```javascript
// --- Panel chrome (all templates) ---
// Wired at page level, NOT inside the design layout IIFE: a decision- or
// free-only page never runs that IIFE, and when the panel toggle lived there
// such a page had a FAB that did nothing (which is why the panel used to be
// hidden and docked instead).
(() => {
  // Deferred until the DOM is parsed. The generated page puts its inline
  // <script> last in <body>, so this normally runs with everything present —
  // but this block is now on EVERY page, and a page whose script block ends
  // up higher (a re-sync, a hand edit) would otherwise log "markup
  // incomplete" and hand the user an inert ☰ on every template at once.
  const boot = () => {
  const panel = document.getElementById('decision-panel');
  const panelToggle = document.getElementById('panel-toggle');
  const panelCloseBtn = document.getElementById('panel-close');
  const backdrop = document.getElementById('panel-backdrop');
  // These four used to be dereferenced unguarded, and a page missing any one
  // of them died with a TypeError that took every listener after it down —
  // silently: no visible error, just a page that ignores every click.
  const missingPanelParts = [
    ['decision-panel', panel], ['panel-toggle', panelToggle],
    ['panel-close', panelCloseBtn], ['panel-backdrop', backdrop],
  ].filter(([, el]) => !el).map(([id]) => id);
  if (missingPanelParts.length) {
    console.error('[concept] decision-panel markup incomplete, panel disabled — missing: '
      + missingPanelParts.join(', '));
  }
  // The design switcher auto-hides while the panel is open (the panel carries
  // the same navigation) — driven by body.panel-open, see Layout CSS.
  // The ☰ panel and the 💬 dock are both right-edge overlays and therefore
  // mutually exclusive: opening one minimises the other, so they can never
  // sit expanded on top of each other. The reciprocal call belongs in the
  // OPEN paths only — a close path must never touch the other overlay, or
  // dismissing one would resurrect the other.
  // closeDock goes through `window.` and is optional on purpose: it is
  // exported by the dock block below (same section, every template) once
  // that has booted, and a page whose dock markup is missing must still be
  // able to open its panel.
  window.openPanel = () => {
    const dock = document.getElementById('feedback-dock');
    const fromDock = dock?.contains(document.activeElement);
    window.closeDock?.(true);
    panel?.classList.add('open');
    backdrop?.classList.add('visible');
    panelToggle?.classList.add('hidden');
    // Tooltip + a11y label name the NEXT action, exactly like the 💬 FAB.
    // Written inline (no shared helper) because both labels are read off the
    // button's own dataset — the locale substitution happened once, at
    // generation time, in the markup.
    if (panelToggle) {
      panelToggle.setAttribute('aria-expanded', 'true');
      const lbl = panelToggle.dataset.labelClose;
      if (lbl) { panelToggle.setAttribute('aria-label', lbl); panelToggle.dataset.tip = lbl; }
    }
    document.body.classList.add('panel-open');
    // Only re-home focus that the dock just lost — never steal it from a
    // pointer user who was not typing anywhere.
    if (fromDock) panelCloseBtn?.focus();
  };
  window.closePanel = () => {
    panel?.classList.remove('open');
    backdrop?.classList.remove('visible');
    panelToggle?.classList.remove('hidden');
    if (panelToggle) {
      panelToggle.setAttribute('aria-expanded', 'false');
      const lbl = panelToggle.dataset.labelOpen;
      if (lbl) { panelToggle.setAttribute('aria-label', lbl); panelToggle.dataset.tip = lbl; }
    }
    document.body.classList.remove('panel-open');
  };
  // Bound by reference, exactly as before the extraction: both handlers are
  // globals (window.openPanel / window.closePanel), so a bare identifier here
  // resolves to the same function the dock paths call.
  panelToggle?.addEventListener('click', openPanel);
  panelCloseBtn?.addEventListener('click', closePanel);
  backdrop?.addEventListener('click', closePanel);

  // Escape closes it. The panel is a backdropped modal on every page now, and
  // ✕ plus the backdrop were the only ways out for a keyboard user. The
  // content dimmer has its own Escape handler and returns early while the
  // panel is open, so one press never lifts the frozen veil BEHIND the thing
  // the user is dismissing.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.body.classList.contains('panel-open')) return;
    window.closePanel();
  });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
```

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

## Per-Iteration Templates

The template is chosen **per iteration**. Every `<section data-iteration="N">`
MUST carry `data-iteration-template="decision|design|free"` — that attribute is
authoritative:

```html
<html data-template="decision">              <!-- mirrors the ACTIVE iteration -->
  <section data-iteration="1" data-iteration-template="decision" data-active>
  <section data-iteration="2" data-iteration-template="design" hidden>
  <section data-iteration="3" data-iteration-template="decision" hidden>
```

`data-template` on `<html>` stays the single source of truth *for CSS selectors
and JS branches* (`[data-template="design"] …`, `collectDecisions`), but it is a
**projection** of the currently shown iteration, not a page-level constant.
`applyIterationTemplate(section)` writes it on every iteration switch (see
Shared Systems § Tab Switch JS).

Rules:

- Iterations may mix templates freely and in any order — a `decision` round may
  be followed by a `design` round and another `decision` round.
- `prototype` is accepted as a **legacy alias** for `design` and normalised on
  read. Never write it in new pages.
- A missing `data-iteration-template` falls back to the current
  `<html data-template>`, so pages generated before the rename keep working
  unchanged.
- The `<html data-template>` value written at generation time MUST already
  equal the active iteration's (normalised) template — otherwise the first
  paint shows the wrong layout.
- **A page that started as `decision` or `free` keeps its document header**
  (`<h1>` + subtitle inside `.concept-content > header`) and
  its per-iteration `<header class="iteration-intro">` for the rest of its
  life — a later `design` iteration must never delete them, or switching
  back to an earlier round loses its own title. Design mode is
  `position: absolute; inset: 0` and would paint straight over both, so it
  HIDES them in CSS instead: see § Layout CSS → "Document chrome vs. the
  fullscreen canvas" and the frozen-opacity exemption next to it. Both rules
  are mandatory on any page that mixes design with decision/free.

---

