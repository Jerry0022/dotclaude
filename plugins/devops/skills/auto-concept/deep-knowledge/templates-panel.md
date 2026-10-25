# Concept templates, part 03 of 41: Panel chrome — markup and CSS

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
  border-radius: 18px;
  border: none;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent-color, #58a6ff) 86%, #fff), var(--accent-color, #58a6ff));
  color: #fff;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  /* Island family (variant C): filled inside, soft outer glow, no frame. */
  box-shadow: 0 0 22px color-mix(in srgb, var(--accent-color, #58a6ff) 38%, transparent), 0 6px 16px rgba(0,0,0,0.4);
  z-index: 100;
  transition: transform 0.2s, opacity 0.2s, box-shadow 0.2s;
}
/* The glow pulses briefly on the first open and on a new round, then rests
   (wireDesignOverview toggles body.chrome-glow for ~3.5 s). box-shadow only. */
@keyframes chromeGlow {
  0%, 100% { box-shadow: 0 0 22px color-mix(in srgb, var(--accent-color, #58a6ff) 38%, transparent), 0 6px 16px rgba(0,0,0,0.4); }
  50%      { box-shadow: 0 0 44px color-mix(in srgb, var(--accent-color, #58a6ff) 70%, transparent), 0 6px 16px rgba(0,0,0,0.4); }
}
body.chrome-glow .panel-fab, body.chrome-glow .feedback-fab { animation: chromeGlow 1.4s ease-in-out 2; }
@media (prefers-reduced-motion: reduce) {
  body.chrome-glow .panel-fab, body.chrome-glow .feedback-fab { animation: none; }
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
   0.5rem breathing gap, rounded up. The pill is a fixed pin-sized circle
   (28px), so unlike the indicator/switcher it needs no
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
   ("{{iteration.tab}} 8 (Variante)") takes the left end — `margin-right: auto` on
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
  0%, 100% { transform: scale(1);    box-shadow: 0 0 22px color-mix(in srgb, var(--accent-color, #58a6ff) 38%, transparent), 0 6px 16px rgba(0,0,0,0.4); }
  50%      { transform: scale(1.12); box-shadow: 0 0 22px color-mix(in srgb, var(--accent-color, #58a6ff) 38%, transparent), 0 0 0 12px rgba(88,166,255,0.18); }
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
   * bottom = FAB.bottom + 60 + 14px      → bubble floats 14px above the 60px
                                            FAB; the FAB's own speech tail
                                            (.feedback-fab[aria-expanded]
                                            ::after) bridges that gap, so the
                                            pair reads as "the bubble comes out
                                            of the FAB". It used to overlap the
                                            FAB by 6px, which read as the FAB
                                            stuck in front of the dock's corner.
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
  --dock-ceiling: calc(100vh - (2rem + 60px + 0.75rem) - (2rem + 60px + 14px));
  position: fixed;
  left: auto;
  right: 2rem;
  bottom: calc(2rem + 60px + 14px);
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
  /* anchor: the 💬 FAB's centre (30px in from the right edge, 44px below
     the bottom edge) — the bubble grows out of the FAB, not out of a corner. */
  transform-origin: calc(100% - 30px) calc(100% + 44px);
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
  animation: feedback-dock-in 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.15);
}
@keyframes feedback-dock-in {
  from { opacity: 0; transform: scale(0.35); border-radius: 30px; }
  60%  { opacity: 1; }
  to   { opacity: 1; transform: scale(1); border-radius: 18px; }
}
/* The FAB while its dock is open: pressed in, with a soft ring, and a
   speech tail pointing up into the bubble — the tail lives on the FAB, not
   on the dock, because the dock is overflow-y:auto and would clip it. Same
   fill + border as the dock so tail and bubble read as one shape. */
.feedback-fab[aria-expanded="true"] {
  transform: scale(0.92);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-color) 28%, transparent), 0 4px 12px rgba(0,0,0,0.3);
}
.feedback-fab[aria-expanded="true"]::after {
  content: ''; position: absolute; left: 50%; top: -19px;
  width: 14px; height: 14px; margin-left: -7px;
  background: var(--panel-bg, #161b22);
  border-right: 1px solid var(--border-color, #30363d);
  border-bottom: 1px solid var(--border-color, #30363d);
  transform: rotate(45deg);
  animation: feedback-tail-in 0.28s ease-out;
  pointer-events: none;
}
@keyframes feedback-tail-in {
  from { opacity: 0; top: -6px; }
  to   { opacity: 1; top: -19px; }
}
/* The tail only makes sense while the dock floats above the FAB; the
   ≤560px sheet spans the width and the tail would point at nothing. */
@media (max-width: 560px) {
  .feedback-fab[aria-expanded="true"]::after { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .feedback-dock[data-open="true"],
  .feedback-fab[aria-expanded="true"]::after { animation: none; }
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

/* ── Notes dock fields (R4 "Notiz-Dock"): breadcrumb header per field, soft
   glow on the active one, 📎 inside the field, "Wusstest du schon?" tip. ── */
.feedback-dock .feedback-section { padding: 10px; border-radius: 14px; background: rgba(255,255,255,0.025); }
.feedback-dock .feedback-section:focus-within {
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent-color, #58a6ff) 12%, transparent), rgba(137,87,229,0.07));
}
.feedback-dock .feedback-section textarea:focus {
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent-color, #58a6ff) 45%, transparent), 0 0 18px color-mix(in srgb, var(--accent-color, #58a6ff) 25%, transparent);
}
.dock-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); font-weight: 500; }
.dock-crumb i { font-style: normal; color: color-mix(in srgb, var(--text-secondary) 60%, transparent); }
.dock-crumb .dock-scope { display: inline-flex; align-items: center; gap: 6px; }
.dock-crumb strong, .dock-crumb .dock-crumb-last { color: var(--text-color, #f0f6fc); font-weight: 650; font-size: 13px; }
.dock-crumb .dock-tag {
  margin-left: auto; font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  color: var(--text-secondary); background: rgba(255,255,255,0.05); white-space: nowrap;
}
.feedback-dock .feedback-section:focus-within .dock-tag { color: var(--accent-color); background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent); }
/* The 📎 sits inside the field (bottom-right); thumbnails flow under it. */
.feedback-dock .attach-slot { position: relative; }
.feedback-dock .attach-slot .attach-btn { position: absolute; right: 10px; top: -34px; opacity: 0.7; }
.feedback-dock .attach-slot .attach-btn:hover { opacity: 1; }
.dock-tip {
  display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; padding: 8px 10px; border-radius: 12px;
  background: color-mix(in srgb, var(--warning-color, #e3b341) 8%, transparent); font-size: 12px; color: var(--text-color, #c9d1d9);
}
.dock-tip b { color: var(--warning-color, #e3b341); }
.dock-tip[hidden] { display: none; }
.feedback-divider { height: 1px; background: var(--border-color); margin: 0.2rem 0; }
/* The attach bar's own margin-top (§ Attachments CSS) is meant for contexts
   with no flex-gap parent (decision notes, annotation bubbles). Inside the
   dock, .feedback-section already applies that same gap between its
   children (label / textarea / attach-slot), so the bar's margin-top would
   double it — the bar would sit further from "its" textarea than the
   textarea sits from its own label. Zeroing it here keeps the rhythm even
   without touching the shared .attach-bar rule other surfaces still rely on. */
.feedback-dock .attach-bar { margin-top: 0; }

/* ── Visual weight, specific → general (design rounds) ──
   Three rows of identical weight made the eye land nowhere. The order is
   also the reading order: the eye lands on the FIRST row (this page — or the
   active view, which takes its place), the design row stays neutral (the
   rules above), and the general row is set apart the most while being the
   quietest: its own recessed band, no divider line, smaller label, a
   lower-contrast field that only wakes on focus. On a single-screen design
   the per-page row is hidden, so the design row takes the lead. Keyed on
   html[data-template="design"]: a document round shows the general row
   alone, and there it must not look like an afterthought. */
html[data-template="design"] .feedback-section:has(#screen-textareas) label,
html[data-template="design"] .feedback-section:has(#view-textareas) label,
html[data-template="design"] body[data-single-screen="true"] .feedback-section:has(#design-textareas) label {
  color: var(--text-color); font-size: 0.9rem; font-weight: 600;
}
html[data-template="design"] .feedback-section:has(#screen-textareas) textarea,
html[data-template="design"] .feedback-section:has(#view-textareas) textarea,
html[data-template="design"] body[data-single-screen="true"] .feedback-section:has(#design-textareas) textarea {
  min-height: 104px;
  border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 12%, transparent);
}
.feedback-dock .dock-scope { color: var(--text-secondary); font-weight: 400; }
body[data-single-design="true"] .feedback-dock .dock-scope { display: none; }
html[data-template="design"] .feedback-dock .feedback-divider:nth-last-child(2) { display: none; }
html[data-template="design"] .feedback-section:has(#design-general-feedback) {
  margin-top: 0.5rem; padding: 0.7rem 0.75rem 0.75rem;
  border-radius: 12px;
  background: color-mix(in srgb, var(--text-color) 4%, transparent);
}
html[data-template="design"] .feedback-section:has(#design-general-feedback) label {
  font-size: 0.76rem; font-weight: 500; opacity: 0.8;
}
html[data-template="design"] #design-general-feedback {
  min-height: 60px; font-size: 0.88rem;
  background: transparent;
  border-color: color-mix(in srgb, var(--border-color) 70%, transparent);
}
html[data-template="design"] #design-general-feedback:focus {
  background: var(--input-bg, #0d1117); border-color: var(--accent-color);
}

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
