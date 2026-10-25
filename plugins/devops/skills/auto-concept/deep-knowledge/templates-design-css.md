# Concept templates, part 11 of 41: Template: design — layout CSS

## Layout CSS

```css
/* ── Scrollbars (ui-defaults.md R5) ─────────────────────────────────────
   Deliberately UNSCOPED and UNIVERSAL (the only rules in this section that
   are): every scroll container of the page wears the same skin in every
   template and both themes — the dock, the panel TOC, the CTA foot, a
   design screen taller than the safe area, and every box the page content
   adds (code blocks, mapping tables, textareas). Scoping it to design mode
   or to a list of boxes would leave the rest on the raw platform bar, an
   opaque 16px slab against a dark panel — measured on a real page as the
   single loudest piece of chrome in a 430px dock. Thin + border-coloured
   thumb on a transparent track reads as part of the page instead. Both
   syntaxes: `scrollbar-*` covers Firefox and modern Chromium (which then
   ignores the `::-webkit-*` rules), the pseudo-elements cover WebKit and
   older Chromium. `color-scheme` follows the theme so whatever the platform
   still draws (form controls, the canvas) matches light/dark. */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-color, #30363d) transparent;
}
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-thumb {
  background: var(--border-color, #30363d);
  border-radius: 4px;
}
*::-webkit-scrollbar-thumb:hover { background: var(--text-secondary, #8b949e); }
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner { background: transparent; }
html[data-theme="dark"] { color-scheme: dark; }
html:not([data-theme="dark"]) { color-scheme: light; }

/* EVERY rule below is scoped to html[data-template="design"]. That attribute
   is a projection of the ACTIVE iteration (see § Per-Iteration Templates), so
   flipping it flips the whole layout: a decision/free iteration on the same
   page falls back to the normal grid + document scroll with zero JS. Never
   write these rules unscoped — an unscoped `html, body { overflow: hidden }`
   would lock scrolling for the sidebar iterations too. */
html { margin: 0; padding: 0; }
body { margin: 0; padding: 0; }
html[data-template="design"],
html[data-template="design"] body { height: 100%; overflow: hidden; }
[data-template="design"] .concept-layout.design.fullscreen { display: block; width: 100vw; height: 100vh; overflow: hidden; }
/* The canvas takes the whole viewport: the document column's `max-width:
   1100px; padding: 2rem` (§ Layout CSS) is lifted here — a fullscreen mock
   letterboxed to 1164px on a 1680px display was #418. Decision / free rounds
   keep the cap. */
[data-template="design"] .concept-layout.design .concept-content { position: absolute; inset: 0; overflow: hidden; max-width: none; padding: 0; }

/* ── Document chrome vs. the fullscreen canvas ──────────────────────────
   A page may START as decision or free (§ Per-Iteration Templates), and
   those templates put a `<header>` with the <h1> and the subtitle directly
   inside .concept-content, plus a
   `<header class="iteration-intro">` at the top of every iteration section.
   Both stay in NORMAL FLOW. Design mode then makes the iteration section
   `position: absolute; inset: 0` — it paints OVER them instead of pushing
   them aside, and the frozen-iteration opacity below let the h1 and the
   intro shine through the mockup right under the fixed screen indicator
   (measured at 1280x720: h1 at y=32, intro at y=0, indicator top-left, all
   three overlapping and the page reading as "empty" after a ☰ switch).
   Design mode owns the whole viewport, so the document header and the
   per-iteration intro are hidden while it is active; flipping
   `<html data-template>` back to decision/free brings both back, unchanged.
   Hiding the header hides no control: the theme toggle lives in the ☰
   panel's .panel-head row (§ Theme Toggle), which is page chrome on every
   template and stays reachable in design mode. It used to be the header's
   last child and was simply gone in design rounds. Do NOT re-home it into
   the design chrome as a floating control: the two FABs are a closed pair
   (P13), and the panel head is the one place every round shares. */
html[data-template="design"] .concept-content > header,
html[data-template="design"] section[data-iteration] > .iteration-intro { display: none; }

/* Frozen design iterations stay FULLY opaque. The generic
   `section[data-iteration]:not([data-active]) { opacity: 0.85 }`
   (§ Tab Bar CSS) is a legible "this round is history" cue for a sidebar
   iteration in normal flow. On an absolute/inset:0 design section it is a
   bleed-through instead: whatever is behind the canvas — the document
   header, a sibling iteration's intro — shows through the mockup. Frozen
   state is already communicated here by the panel's frozen state and the
   read-only dock (applyDockFreezeState), so the opacity buys nothing. */
html[data-template="design"] section[data-iteration]:not([data-active]) { opacity: 1; }

/* ── Chrome safe area ───────────────────────────────────────────────────
   Every fixed control in design mode sits on the viewport's top or bottom
   edge while the canvas beneath runs edge to edge (inset: 0). A flat 2rem
   padding therefore starts the content at 32px where the chrome reaches
   92px, so the first rows of any screen tall enough to fill the viewport
   are painted UNDER the indicator, the design switcher and the ☰ FAB
   (measured in Edge at 921x873: content top 32px, indicator bottom 50px —
   18px of unreadable overlap on every screen of the page).

   The § Layout CSS top-edge partition above solves the chrome-vs-chrome
   collisions; this is the missing chrome-vs-CONTENT one. Two tokens, derived
   from the geometry already fixed there, so the reserve can never drift from
   the chrome that caused it:
     TOP     .panel-fab        2rem offset + 60px circle   = 92px  (right)
             .anno-toggle-fab  3.75rem offset + ~2rem pill = 92px  (left)
             .screen-indicator 1rem offset + ~2.1rem pill  = 50px  (left)
             .design-switcher  0.75rem offset + ~2.3rem    = 49px  (centre)
     BOTTOM  .feedback-fab     2rem offset + 60px circle   = 92px  (right)
             .viewport-toggle  2rem offset + 34px pill     = 66px  (left)

   The reserve is deliberately NOT symmetric, because the two edges are not.
   The top edge is occupied across its whole width — indicator on the left,
   switcher in the centre, ☰ on the right — so content must clear its
   deepest element everywhere: 92px = 5.75rem. The bottom edge carries two
   CORNER controls and nothing in between, so the ordinary 2rem gutter is
   the honest reserve there; a 60px FAB floating over a canvas corner is the
   normal pattern, and mirroring the top would have spent another 60px of
   artefact height on an edge that is empty across ~96% of its width. In
   device mode that height is multiplicative — fitDeviceStage() scales the
   frame pair to the box — so it is the most expensive space on the page.
   The cost of the asymmetry is that `align-items: center` now centres the
   artefact 30px below the true optical centre at 873px height (3.4%), which
   is well under the threshold where anyone reads it as misaligned.
   Chromium keeps centred overflow reachable in a scroll container (verified:
   a 2000px probe in a 560px box still scrolls to its first row), so the
   smaller content box this creates needs no `safe center` companion.

   Every consumer repeats the value as a var() fallback. That is not
   belt-and-braces: this file is a REFERENCE that gets copied in pieces, and
   a page that takes the section rules without this declaration would have
   the whole `padding` shorthand invalidated at computed-value time — losing
   the horizontal gutter too, silently, with no chrome reserve either. */
html[data-template="design"] {
  --chrome-safe-top: 5.75rem;
  --chrome-safe-bottom: 2rem;
}

/* Iteration sections fill the viewport. Screens inside do too —
   only the active one is visible (hidden attribute on the others).
   Outside design mode iterations stay in normal document flow. */
[data-template="design"] section[data-iteration] { position: absolute; inset: 0; }
section[data-iteration][hidden] { display: none; }
[data-template="design"] section[data-screen] {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  /* Chrome safe area top, plain gutter sides and bottom. */
  padding: var(--chrome-safe-top, 5.75rem) 2rem var(--chrome-safe-bottom, 2rem);
  overflow-y: auto;
  /* No blanket entrance: a fade on every switch read as a flicker. The
     direction-aware motion is § Page transitions (overview CSS, part 2). */
}
section[data-screen][hidden] { display: none; }
/* The screen centers its mock with flexbox, and a flex item shrinks to its
   content: a mock root with `max-width: 1080px` whose only wide child is an
   absolute popup collapsed to ~510px and clipped that popup (#708). Full
   width for every mock root lets its own max-width decide; the screen still
   centers it. The annotation layer keeps its own sizing. */
[data-template="design"] section[data-screen] > :not([data-anno-layer]) { width: 100%; }
/* Structural backstop for the "exactly one of these is on screen" invariant.
   `hidden` is the switchers' mechanism, and the markup above asks for it on
   every inactive design and screen — but nothing enforces that, and these
   boxes are position:absolute/inset:0. A single forgotten `hidden` therefore
   does not misplace a section, it paints every sibling onto the same square:
   three designs' mockups drawn on top of each other, their headings and
   labels interleaved, the page unreadable and every click ambiguous.
   The active flags are already this page's own source of truth — both
   activeDesign() and activeScreen() resolve by them, and showDesign() /
   showScreen() keep them in step with `hidden` on every switch — so they can
   carry the visibility too. Both rules are `:has()`-guarded: they bite only
   once a sibling IS marked active, so markup that omits the flags entirely
   degrades to the old behaviour instead of blanking the canvas. */
section[data-iteration]:has(> section[data-design][data-design-active="true"])
  > section[data-design]:not([data-design-active="true"]) { display: none; }
section[data-design]:has(section[data-screen][data-screen-active="true"])
  section[data-screen]:not([data-screen-active="true"]) { display: none; }
@keyframes screen-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* ── Views (optional, § Views (optional)) — top-level siblings of
   section[data-design]. Unlike a screen, a view SCROLLS inside its own box
   — body stays overflow:hidden throughout design mode (see the html/body
   rule above), only .view-frame's ancestor here gets overflow-y. Same
   position:absolute/inset:0 fullscreen treatment as a screen otherwise, so
   switching between a design and a view never shifts the surrounding
   chrome (indicator/switcher/FABs stay put). */
[data-template="design"] section[data-view] {
  position: absolute; inset: 0;
  /* Same chrome safe area as a screen — a view is the other thing that can
     be full-height, and it is the one that always scrolls. */
  padding: var(--chrome-safe-top, 5.75rem) 2rem var(--chrome-safe-bottom, 2rem);
  overflow-y: auto;
}
section[data-view][hidden] { display: none; }
/* Same backstop, the other direction: outside view mode NO view paints, flag
   or not. A view is fullscreen and absolutely positioned like a screen, so a
   view that boots without `hidden` covers the design the page opened on.
   body[data-view-active] is maintained by showView() (true) and by
   showDesign() + the iteration switch (false), and its ABSENCE — nothing ran
   yet — reads as "not in view mode", which is exactly the boot state. */
body:not([data-view-active="true"]) section[data-view] { display: none; }
.view-frame { max-width: 860px; margin: 0 auto; }
/* Comparison view kind — see § Views (optional) → View kind `comparison`. */
.cmp-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.25rem;
  margin: 1.25rem 0;
}
.cmp-option {
  border: 1px solid var(--border-color, #30363d);
  border-radius: 12px;
  padding: 1rem 1.25rem;
  background: color-mix(in srgb, var(--panel-bg, #161b22) 60%, transparent);
}
.cmp-favourite {
  display: flex; flex-wrap: wrap; align-items: center; gap: 1rem;
  border: 1px solid var(--border-color, #30363d); border-radius: 10px;
  padding: 0.75rem 1rem; margin: 1rem 0;
}
.cmp-favourite legend { padding: 0 0.4rem; font-size: 0.85rem; color: var(--text-secondary); }
/* data-compare-layout="table": the comparison IS the table. Wrapped in its
   own scroll container so five options never widen the page — the view
   scrolls vertically, this one horizontally, and body never scrolls. */
.view-compare[data-compare-layout="table"] .cmp-options { display: block; overflow-x: auto; }
.cmp-table { width: 100%; min-width: 34rem; border-collapse: collapse; margin: 1rem 0; }
.cmp-table th, .cmp-table td {
  border: 1px solid var(--border-color); padding: 0.55rem 0.7rem;
  text-align: left; vertical-align: top; font-size: 0.9rem;
}
.cmp-table thead th { position: sticky; top: 0; background: var(--bg-secondary, #161b22); }
.cmp-table tbody th { font-weight: 500; color: var(--text-secondary); white-space: nowrap; }
.cmp-table tr:hover td { background: rgba(127, 127, 127, 0.06); }
.cmp-table .cmp-verdict-row td { border-top: 2px solid var(--border-color); }
.cmp-matrix { width: 100%; border-collapse: collapse; margin: 1rem 0; }
.cmp-matrix th, .cmp-matrix td {
  border: 1px solid var(--border-color, #30363d); padding: 0.5rem 0.75rem;
  text-align: left; font-size: 0.9rem;
}

/* Design-only chrome: the screen indicator, the switchers, the device
   toggle and the annotation layer all describe a fullscreen mockup, so they
   exist in the DOM on every page but only render in design mode.
   `.panel-fab`, `.feedback-fab` and `.feedback-dock` are deliberately NOT in
   this list: the ☰ decision panel and the 💬 feedback dock are page chrome,
   reached the same way in every template (§ Panel Chrome (all templates)).
   All three used to be hidden here (the panel docked into a sidebar instead,
   the dock simply vanished) — which is how a concept that mixed templates
   moved its whole feedback surface between rounds. What a document round
   shows of the dock is decided by the compact rule in § Panel Chrome CSS,
   not by hiding it.
   The `html` type selector is REQUIRED — a bare `:not([data-template="design"])`
   also matches <body> (which never carries the attribute) and would hide the
   chrome in design mode too. */
html:not([data-template="design"]) .screen-indicator,
html:not([data-template="design"]) .viewport-toggle,
html:not([data-template="design"]) .design-switcher,
html:not([data-template="design"]) .anno-toggle-fab,
html:not([data-template="design"]) .anno-layer { display: none !important; }

/* The panel carries BOTH navs because a page may mix iteration templates:
   #screen-nav for design iterations, #section-nav for decision/free ones
   (incl. the final report). Exactly one may render at a time, and the swap
   must be driven by the template, never by JS: buildDesignUI() returns early
   when the visible iteration has no design (`if (!active) return`), BEFORE it
   clears nav.innerHTML — so on a decision tab the previous design's entries
   are still sitting in #screen-nav. Without this rule they render as a dead
   TOC whose headings switch to a design nobody is looking at. */
html:not([data-template="design"]) #screen-nav,
html[data-template="design"] #section-nav { display: none !important; }

/* Minimal screen counter — NOT a header bar.
   Left-anchored at 1rem and content-sized, so its natural width grows with
   the page label while the switcher stays centred. Without a cap the two
   overlap on narrow viewports (measured: 21px overlap at 768px, full
   overlap at 375px). The cap is derived from the switcher's own geometry
   below — switcher max-width 34vw, centred ⇒ its left edge is at 33vw, so
   the indicator may occupy at most 33vw minus its 1rem offset minus a
   0.5rem gap. Truncation with an ellipsis is the right degradation here:
   the leading "page N/total" segment is the load-bearing part, the trailing
   screen label is not. */
.screen-indicator {
  position: fixed; top: 1rem; left: 1rem; z-index: 90;
  padding: 0.4rem 0.75rem; border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg) 85%, transparent);
  border: 1px solid var(--border-color);
  color: var(--text-secondary); font-size: 0.8rem;
  backdrop-filter: blur(6px);
  /* border-box is REQUIRED: with the default content-box the 0.75rem
     padding and the border are added ON TOP of max-width and the element
     still runs into the switcher (measured: 25px over budget at 375px). */
  box-sizing: border-box;
  /* The 240px cap is a promise the expanded switcher relies on: it reserves
     exactly this much on the left (see .design-switcher:hover). */
  max-width: min(calc(33vw - 1.5rem), 240px);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* No switcher to avoid when the iteration has a single design — the only
   neighbour left is the ☰ FAB at the top right (left edge 100vw - 88px). */
body[data-single-design="true"]:not(:has(.view-switch-item)) .screen-indicator { max-width: calc(100vw - 8rem); }
.screen-indicator strong { color: var(--text); }

/* ── Annotation layer eye pill — left edge, directly below the screen
   indicator (see the top-edge partition comment at .panel-fab below for the
   3.75rem derivation). `hidden` by default in the markup; JS only unhides it
   once the active screen has ≥1 annotation. Sits between the design switcher
   (z-index 95) and the two FABs (z-index 100) — it is chrome of the same
   weight as the switcher, not as load-bearing as the FABs. Theming hooks:
   restyle via --anno-accent / --anno-bubble-bg, never by overriding this
   rule's geometry per page (same discipline as the FAB pair below). */
/* Shaped like an annotation pin on purpose (same size, ring, accent and
   shadow as .anno-pin below) with an eye glyph instead of a number — it
   reads as "the pins' switch" at a glance. No count: a number next to an
   eye was read as a view counter, not as "open pins". */
.anno-toggle-fab {
  position: fixed; top: 3.75rem; left: 1rem; z-index: 96;
  box-sizing: border-box;
  width: var(--anno-pin-size, 28px); height: var(--anno-pin-size, 28px);
  padding: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--anno-accent, var(--accent-color, #58a6ff));
  background: var(--anno-bubble-bg, var(--panel-bg, #161b22));
  color: var(--anno-accent, var(--accent-color, #58a6ff));
  box-shadow: 0 2px 8px rgba(0,0,0,0.35);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.anno-toggle-fab:hover { transform: scale(1.08); }
.anno-toggle-fab[hidden] { display: none; }
.anno-toggle-fab svg { width: 15px; height: 15px; display: block; }
.anno-toggle-fab .anno-eye-off { display: none; }
/* Hidden layer state: the eye pill itself always stays visible/clickable
   (it is the only remnant, per spec) — everything ELSE the layer owns
   disappears completely, not just dims. The pill swaps to a struck-through
   eye with a dimmed ring, so "layer off" is visible without a label. */
body.anno-hidden .anno-toggle-fab { border-style: dashed; color: var(--text-secondary); opacity: 0.75; }
body.anno-hidden .anno-toggle-fab .anno-eye-on { display: none; }
body.anno-hidden .anno-toggle-fab .anno-eye-off { display: block; }
body.anno-hidden .anno-layer { display: none !important; }
/* The eye hides EVERYTHING except the header and the FABs: pins, connectors,
   summaries, own pins, the overview's top-3 info box and its change chip. */
body.anno-hidden .upin-layer, body.anno-hidden .design-ov-overlay, body.anno-hidden .design-ov-change { display: none !important; }
/* Calm view: the same eye also takes the quick nav, the design switcher and
   both FABs (☰, 💬) away, so the concept can be looked at undisturbed. The
   eye itself (and the device switch beside it) stays, dimmed. visibility
   keeps the hidden controls out of the tab order; their hotkeys still work.
   !important beats the intro keyframes, which animate opacity too. */
body.anno-hidden #design-quick, body.anno-hidden .design-switcher,
body.anno-hidden .panel-fab, body.anno-hidden .feedback-fab {
  opacity: 0 !important; visibility: hidden; pointer-events: none;
  transition: opacity 0.18s ease, visibility 0s linear 0.18s;
}
@media (prefers-reduced-motion: reduce) {
  body.anno-hidden #design-quick, body.anno-hidden .design-switcher,
  body.anno-hidden .panel-fab, body.anno-hidden .feedback-fab { transition: none; }
}
/* Eye = island control: filled, glow, no ring. The counter is the number of
   OPEN (unanswered) notes of the page; it hides at 0, the eye itself stays. */
.anno-toggle-fab {
  border: 0;
  background: color-mix(in srgb, var(--anno-accent, var(--accent-color, #58a6ff)) 20%, var(--panel-bg, #161b22));
  box-shadow: 0 0 14px color-mix(in srgb, var(--anno-accent, var(--accent-color, #58a6ff)) 32%, transparent);
}
.anno-eye-count {
  position: absolute; top: -6px; right: -7px; min-width: 15px; height: 15px; padding: 0 4px; box-sizing: border-box;
  border-radius: 8px; background: var(--accent-color, #58a6ff); color: #fff; font: 700 10px/15px system-ui, sans-serif; text-align: center;
  box-shadow: 0 0 10px color-mix(in srgb, var(--accent-color, #58a6ff) 60%, transparent); pointer-events: none; /* the notes FAB's blue */
}
.anno-eye-count[hidden] { display: none; }
/* Auto-hides while the ☰ panel is open, same treatment as the design
   switcher — both are secondary chrome the overlay panel supersedes. */
body.panel-open .anno-toggle-fab { opacity: 0; pointer-events: none; }

/* ── Annotation layer — pins pinned to a screen element via percentage
   coordinates (--anno-x / --anno-y), each with a short leader line to a
   speech bubble. Every visual property below is a CSS custom property with
   a sane default so a concept can restyle the layer to match its own theme
   without touching the data-attribute contract (§ Annotation Layer). ── */
.anno-layer {
  position: absolute; inset: 0; pointer-events: none; z-index: 40;
}
.anno {
  position: absolute;
  left: var(--anno-x, 50%); top: var(--anno-y, 50%);
  transform: translate(-50%, -50%);
  pointer-events: auto;
}
.anno-pin {
  position: relative;
  width: var(--anno-pin-size, 28px); height: var(--anno-pin-size, 28px);
  border-radius: 50%;
  border: 0;
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--anno-accent, var(--accent-color, #58a6ff)) 70%, #fff), var(--anno-accent, var(--accent-color, #58a6ff)));
  color: #fff;
  /* No number: the pin is a glowing bubble (the authored digit stays in the
     markup as its accessible name only). */
  font-size: 0; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--anno-accent, var(--accent-color, #58a6ff)) 18%, transparent), 0 0 18px color-mix(in srgb, var(--anno-accent, var(--accent-color, #58a6ff)) 55%, transparent), 0 4px 10px rgba(0,0,0,0.4);
  transition: transform 0.15s, opacity 0.2s;
  animation: annoGlow 2.8s ease-in-out infinite;
}
.anno-pin::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #fff; opacity: 0.92; }
@keyframes annoGlow { 50% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--anno-accent, var(--accent-color, #58a6ff)) 10%, transparent), 0 0 26px color-mix(in srgb, var(--anno-accent, var(--accent-color, #58a6ff)) 70%, transparent), 0 4px 10px rgba(0,0,0,0.4); } }
@media (prefers-reduced-motion: reduce) { .anno-pin { animation: none; } }
.anno-pin:hover { transform: scale(1.08); }
/* A pin can be dragged aside (wireAnnotationLayer() § moving a pin):
   touch-action keeps a touch drag from scrolling the canvas instead, and
   user-select keeps the drag from selecting the mock's text. */
.anno-pin { touch-action: none; user-select: none; -webkit-user-select: none; }
.anno[data-anno-dragging="true"] { z-index: 3; }
.anno[data-anno-dragging="true"] .anno-pin { cursor: grabbing; transform: scale(1.12); transition: none; }
/* Answered pins invert to a filled state — visibly different at a glance
   from the still-open questions. Recomputed on every input, never only at
   generation time (see wireAnnotationLayer()). */
.anno-pin[data-answered="true"] { animation: none; }
.anno-pin[data-answered="true"]::after { content: '✓'; width: auto; height: auto; background: none; font-size: 1rem; font-weight: 900; line-height: 1; }
/* While ANY note's input is open (anno bubble or own pin) the connectors and
   summaries of all the others go away; their pins stay, faded. */
body[data-note-editing="true"] .anno:not([data-editing="true"]) .anno-bubble { display: none; }
body[data-note-editing="true"] .anno:not([data-editing="true"]) .anno-pin,
body[data-note-editing="true"] .upin:not([data-editing="true"]) .upin-pin { opacity: 0.35; box-shadow: none; animation: none; }
.anno-bubble {
  position: absolute;
  z-index: 1;
  min-width: 180px; max-width: min(280px, 60vw);
  background: var(--anno-bubble-bg, var(--panel-bg, #161b22));
  border: 1px solid var(--border-color, #30363d);
  border-radius: var(--anno-bubble-radius, 12px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  font-size: 0.85rem;
}
/* One open bubble reads above every collapsed pin/bubble around it. Uses
   :has() rather than a JS-set attribute — same pattern as the single-screen
   collapse rules above (body[data-single-screen] .feedback-section:has(...)). */
.anno:has(.anno-bubble[data-open="true"]) { z-index: 2; }
/* An OPEN bubble is a writing surface, not a tooltip: it widens so a
   two-sentence answer fits without the user dragging the field taller. */
.anno-bubble[data-open="true"] { width: min(360px, 80vw); max-width: min(360px, 80vw); }
.anno-bubble-summary {
  display: flex; align-items: center; gap: 0.4rem; width: 100%;
  padding: 0.55rem 0.75rem; border: none; background: none; cursor: pointer;
  color: var(--text-color, #c9d1d9); text-align: left; font: inherit;
}
.anno-bubble-question {
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.anno-bubble[data-open="true"] .anno-bubble-question { white-space: normal; }
.anno-chevron { transition: transform 0.15s; color: var(--text-secondary); }
.anno-bubble[data-open="true"] .anno-chevron { transform: rotate(90deg); }
.anno-bubble-body { display: none; flex-direction: column; gap: 0.5rem; padding: 0 0.75rem 0.75rem; min-width: 0; }
.anno-bubble[data-open="true"] .anno-bubble-body { display: flex; }
/* border-box is load-bearing: with the default content-box, `width: 100%`
   plus padding and border makes the answer field ~20px wider than the
   bubble body, so an expanded bubble shows it sticking out past its right
   edge. `max-width` also caps a user drag-resize (resize: vertical only,
   but some engines still honour a horizontal grip). */
.anno-answer {
  display: block; box-sizing: border-box;
  width: 100%; max-width: 100%; resize: vertical;
  /* Three visible lines before any interaction: 3 × line-height plus the
     vertical padding and the 2px border (border-box). */
  line-height: 1.4; min-height: calc(3 * 1.4em + 1rem + 2px);
  padding: 0.5rem 0.6rem; border-radius: 8px;
  border: 1px solid var(--border-color, #30363d);
  background: var(--input-bg, #0d1117); color: var(--text-color, #c9d1d9);
  font: inherit;
}
/* Attachment mount — deliberately empty, see § Annotation Layer. */
.attach-slot:empty { display: none; }
/* …and deliberately hidden while the field it belongs to is. The dock builds
   one textarea PER screen / design / view and hides all but the active one
   (§ Layout JS), but `.attach-slot` is that textarea's SIBLING, not its child:
   the moment initCommentAttachments() mounts a bar the slot stops being
   `:empty`, so without this rule every inactive field's bar renders under the
   one visible textarea — a stack of N identical 📎 rows instead of one.
   The mount is always emitted immediately after its textarea, so the adjacent
   sibling combinator ties their visibility together with no JS to keep in
   sync — showScreen()/showDesign()/showView() only touch `ta.hidden`. The
   `.attach-bar` half covers the mountless fallback path, where the bar is
   inserted straight after the textarea instead of into a slot. */
textarea[hidden] + .attach-slot,
textarea[hidden] + .attach-bar { display: none; }
/* Leader line + bubble offset, one rule pair per side. The line is a short
   fixed-length connector (14px), never computed at runtime. */
.anno[data-anno-side="right"] .anno-bubble { left: calc(var(--anno-pin-size, 28px) + 14px); top: 50%; transform: translateY(-50%); }
.anno[data-anno-side="right"] .anno-bubble::before { content: ''; position: absolute; top: 50%; left: -14px; width: 14px; height: 2px; background: var(--anno-accent, var(--accent-color, #58a6ff)); transform: translateY(-50%); }
.anno[data-anno-side="left"] .anno-bubble { right: calc(var(--anno-pin-size, 28px) + 14px); top: 50%; transform: translateY(-50%); }
.anno[data-anno-side="left"] .anno-bubble::before { content: ''; position: absolute; top: 50%; right: -14px; width: 14px; height: 2px; background: var(--anno-accent, var(--accent-color, #58a6ff)); transform: translateY(-50%); }
.anno[data-anno-side="top"] .anno-bubble { left: 50%; bottom: calc(var(--anno-pin-size, 28px) + 14px); transform: translateX(-50%); }
.anno[data-anno-side="top"] .anno-bubble::before { content: ''; position: absolute; left: 50%; bottom: -14px; width: 2px; height: 14px; background: var(--anno-accent, var(--accent-color, #58a6ff)); transform: translateX(-50%); }
.anno[data-anno-side="bottom"] .anno-bubble { left: 50%; top: calc(var(--anno-pin-size, 28px) + 14px); transform: translateX(-50%); }
.anno[data-anno-side="bottom"] .anno-bubble::before { content: ''; position: absolute; left: 50%; top: -14px; width: 2px; height: 14px; background: var(--anno-accent, var(--accent-color, #58a6ff)); transform: translateX(-50%); }

/* ── Design switcher — ghost bar, top centre ──
   Deliberately barely-there at rest: the viewport belongs to the mockup, not
   to chrome. Only the active design's label shows, no background fill, no
   separators. Hover AND :focus-within reveal the full segmented control —
   :focus-within (not :focus-visible) is deliberate: the expanding element is
   the container, and it must expand as soon as focus lands on ANY of its
   segment buttons, which is exactly what keyboard tabbing produces. That
   keeps the control reachable without a mouse.
   Never collides with the screen indicator (top-left) or the ☰ FAB
   (top-right once Wave 3 moves it there) — guaranteed by the width bands
   documented at .panel-fab below, not by the labels happening to be short.
   Hidden entirely below two designs (body[data-single-design="true"]). */
.design-switcher {
  position: fixed; top: 0.75rem; left: 50%; transform: translateX(-50%);
  z-index: 95;
  display: flex; gap: 2px;
  padding: 0.3rem; border-radius: 999px;
  background: transparent;
  backdrop-filter: blur(6px);
  opacity: 0.18;
  transition: opacity 0.16s ease;
  /* Hard width budget so the expanded (hover/focus) state cannot grow into
     the screen indicator on the left or the ☰ FAB on the right — it spans
     33vw…67vw at every viewport. Segments shrink and ellipsise instead;
     min-width:0 is required or flex refuses to shrink below content width
     because the labels are nowrap. */
  box-sizing: border-box;
  max-width: 34vw;
  overflow: hidden;
}
.design-switcher:hover,
.design-switcher:focus-within { opacity: 1; }
.design-switch-item {
  border: none; background: transparent; cursor: pointer;
  padding: 0.35rem 0.85rem; border-radius: 999px;
  font-size: 0.8rem; color: var(--text-secondary);
  white-space: nowrap; transition: background 0.15s, color 0.15s;
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
/* Resting state shows ONLY the active label — siblings collapse to width 0
   so no separators/background are visible until the bar expands on hover. */
.design-switcher:not(:hover):not(:focus-within) .design-switch-item:not([data-active="true"]) {
  width: 0; padding: 0; margin: 0; overflow: hidden; pointer-events: none;
}
.design-switcher:not(:hover):not(:focus-within) {
  background: transparent; border: none;
}
.design-switcher:hover,
.design-switcher:focus-within {
  background: color-mix(in srgb, var(--panel-bg) 85%, transparent);
  border: 1px solid var(--border-color);
  /* Expanded = two rows: designs on the first, views (the other topics) on
     the second — the divider turns into the row break (rule below). In the
     34vw resting band six segments shrank to "B · Zeitstr…", so the open
     bar gets the width actually free between the left column and the ☰
     FAB: 100vw minus, on each side, the indicator's offset + its hard cap
     (.screen-indicator, 240px) + a 0.75rem gap. The left reservation is
     the larger of the two (the ☰ band is 92px), and the bar is centred, so
     reserving it on both sides keeps both clear. Measured: 1280px → 776px,
     1920px → 1416px of room. Only below ~900px, where even that room
     cannot hold a row, does a row wrap a third time.
     z-index 98 lifts the open bar over .frozen-bar (97), which sits in the
     row below on a frozen design round — it is only open while the user is
     pointing at it, and the frozen bar is back the moment they leave. */
  max-width: calc(100vw - 2 * (1rem + min(33vw - 1.5rem, 240px) + 0.75rem));
  z-index: 98;
  flex-wrap: wrap; justify-content: center; row-gap: 2px;
  border-radius: 1rem;
}
.design-switcher:hover .design-switch-item,
.design-switcher:focus-within .design-switch-item,
.design-switcher:hover .view-switch-item,
.design-switcher:focus-within .view-switch-item { flex: 0 0 auto; max-width: 100%; }
.design-switcher:hover .switcher-divider,
.design-switcher:focus-within .switcher-divider {
  flex: 0 0 100%; width: auto; height: 1px; margin: 2px 0.6rem;
}
.design-switch-item[data-active="true"] {
  color: var(--text); font-weight: 600;
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
}
.design-switch-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
/* Auto-hides while the ☰ panel is open — the panel carries the same nav. */
body.panel-open .design-switcher { opacity: 0; pointer-events: none; }

/* ── View segments (§ Views (optional)) — same row as the design segments,
   separated by a thin divider so switching between a design and a question
   about it is one click. Same class family shape as .design-switch-item on
   purpose: they read as one continuous control, not two bars glued
   together. Only rendered (by buildDesignUI()) when the iteration has ≥1
   view — a design-only iteration never emits either. */
.switcher-divider {
  align-self: center;
  width: 1px; height: 1.1rem;
  margin: 0 2px;
  background: var(--border-color);
  flex: none;
}
.design-switcher:not(:hover):not(:focus-within) .switcher-divider { width: 0; margin: 0; overflow: hidden; }
.view-switch-item {
  border: none; background: transparent; cursor: pointer;
  padding: 0.35rem 0.85rem; border-radius: 999px;
  font-size: 0.8rem; color: var(--text-secondary);
  white-space: nowrap; transition: background 0.15s, color 0.15s;
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
.design-switcher:not(:hover):not(:focus-within) .view-switch-item:not([data-active="true"]) {
  width: 0; padding: 0; margin: 0; overflow: hidden; pointer-events: none;
}
.view-switch-item[data-active="true"] {
  color: var(--text); font-weight: 600;
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
}
.view-switch-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
/* Resting state: if a VIEW is the active item, its own segment must stay
   visible even though the bar is collapsed — same rule the resting design
   segment already gets, just for the sibling class. */
.design-switcher:not(:hover):not(:focus-within) .design-switch-item[data-active="true"] { width: auto; padding: 0.35rem 0.85rem; }

/* Panel chrome (overlay aside, ☰ FAB, backdrop, close button) is NOT in this
   section — it applies in every template and lives in § Panel Chrome (all
   templates), so a decision- or free-only page carries it without taking the
   design layout with it. The 💬 FAB, its dock and the FAB's reserved row
   under the panel foot moved there too (#399) — the dock is page chrome in
   every template; only the design-side row collapse rules stay below. */
```

