# Concept templates, part 05 of 16: Template: design — layout CSS

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
  animation: screen-in 0.25s ease;
}
section[data-screen][hidden] { display: none; }
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
  animation: screen-in 0.25s ease;
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
  max-width: calc(33vw - 1.5rem);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* No switcher to avoid when the iteration has a single design — the only
   neighbour left is the ☰ FAB at the top right (left edge 100vw - 88px). */
body[data-single-design="true"] .screen-indicator { max-width: calc(100vw - 8rem); }
.screen-indicator strong { color: var(--text); }

/* ── Annotation layer eye pill — left edge, directly below the screen
   indicator (see the top-edge partition comment at .panel-fab below for the
   3.75rem derivation). `hidden` by default in the markup; JS only unhides it
   once the active screen has ≥1 annotation. Sits between the design switcher
   (z-index 95) and the two FABs (z-index 100) — it is chrome of the same
   weight as the switcher, not as load-bearing as the FABs. Theming hooks:
   restyle via --anno-accent / --anno-bubble-bg, never by overriding this
   rule's geometry per page (same discipline as the FAB pair below). */
.anno-toggle-fab {
  position: fixed; top: 3.75rem; left: 1rem; z-index: 96;
  display: flex; align-items: center; gap: 0.35rem;
  padding: 0.35rem 0.7rem; border-radius: 999px; border: none;
  background: color-mix(in srgb, var(--panel-bg) 85%, transparent);
  border: 1px solid var(--border-color);
  color: var(--text-secondary); font-size: 0.8rem;
  backdrop-filter: blur(6px);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.anno-toggle-fab:hover { transform: scale(1.04); }
.anno-toggle-fab[hidden] { display: none; }
.anno-toggle-fab .anno-eye { font-size: 0.95rem; line-height: 1; }
.anno-toggle-fab .anno-count {
  min-width: 1.1rem; text-align: center; font-weight: 600; color: var(--text);
}
/* Hidden layer state: the eye pill itself always stays visible/clickable
   (it is the only remnant, per spec) — everything ELSE the layer owns
   disappears completely, not just dims. */
body.anno-hidden .anno-toggle-fab .anno-eye { opacity: 0.5; }
body.anno-hidden .anno-layer { display: none !important; }
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
  width: var(--anno-pin-size, 28px); height: var(--anno-pin-size, 28px);
  border-radius: 50%;
  border: 2px solid var(--anno-accent, var(--accent-color, #58a6ff));
  background: var(--anno-bubble-bg, var(--panel-bg, #161b22));
  color: var(--anno-accent, var(--accent-color, #58a6ff));
  font-size: 0.8rem; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.35);
  transition: transform 0.15s;
}
.anno-pin:hover { transform: scale(1.08); }
/* Answered pins invert to a filled state — visibly different at a glance
   from the still-open questions. Recomputed on every input, never only at
   generation time (see wireAnnotationLayer()). */
.anno-pin[data-answered="true"] {
  background: var(--anno-accent, var(--accent-color, #58a6ff));
  color: #fff;
}
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
  width: 100%; max-width: 100%; min-height: 64px; resize: vertical;
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

/* ── Screen navigation inside the ☰ panel ── */
.screen-nav { display: flex; flex-direction: column; gap: 4px;
  margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-color); }
.screen-nav-item { display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 0.85rem; border-radius: 8px; text-decoration: none;
  color: var(--text-color, #c9d1d9); font-size: 0.95rem;
  border: 1px solid var(--border-color); background: transparent;
  cursor: pointer; transition: all 0.15s; text-align: left; }
.screen-nav-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.screen-nav-item[data-active="true"] {
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
  border-color: var(--accent-color); font-weight: 600;
}
.screen-nav-item .screen-idx { color: var(--accent-color); font-weight: 600; margin-right: 0.5rem; }
.screen-nav-item .has-notes { color: var(--warning-color); font-size: 0.75rem; }

/* Two-level nav: a design heading per <section data-design>, its pages
   nested/indented beneath. Single-design pages never render the heading
   (see body[data-single-design="true"] below), so this stays invisible
   until it's needed. */
.screen-nav-group { display: flex; flex-direction: column; gap: 2px; }
.screen-nav-group + .screen-nav-group { margin-top: 0.5rem; }
.screen-nav-design-heading {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.5rem 0.85rem; border-radius: 8px; border: none;
  background: transparent; color: var(--text); font-size: 0.9rem;
  font-weight: 700; cursor: pointer; text-align: left; transition: background 0.15s;
}
.screen-nav-design-heading:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.screen-nav-design-heading[data-active="true"] { color: var(--accent-color); }
.screen-nav-design-heading .has-notes { color: var(--warning-color); font-size: 0.75rem; }
.screen-nav-group .screen-nav-item { margin-left: 0.75rem; }

/* ── Views group (§ Views (optional)) — second .screen-nav-group, only
   rendered when the iteration has ≥1 view. The heading is a plain label,
   NOT a button (unlike .screen-nav-design-heading): there is no single
   "views" thing to switch to, only individual views below it. */
.screen-nav-views-heading {
  padding: 0.5rem 0.85rem 0.25rem;
  color: var(--text-secondary); font-size: 0.75rem;
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
}
.screen-nav-view-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 0.85rem; border-radius: 8px; text-decoration: none;
  color: var(--text-color, #c9d1d9); font-size: 0.95rem;
  border: 1px solid var(--border-color); background: transparent;
  cursor: pointer; transition: all 0.15s; text-align: left;
}
.screen-nav-view-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.screen-nav-view-item[data-active="true"] {
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
  border-color: var(--accent-color); font-weight: 600;
}
.screen-nav-view-item .has-notes { color: var(--warning-color); font-size: 0.75rem; }

/* Hidden per-screen / per-design / per-view textareas: only the active one
   shown. #view-textareas belongs here for the same reason the other two do —
   buildViewTextareas() hides every one of its textareas identically. */
#screen-textareas textarea[hidden],
#design-textareas textarea[hidden],
#view-textareas textarea[hidden] { display: none; }

/* Single-screen design: hide the per-screen feedback section + its own
   leading divider. Order is screen -> design -> view -> general (specific
   to general, top to bottom — general is always last and never hides), so
   the divider that must disappear with the screen row is the one
   immediately AFTER it (:has(+ .feedback-section ...) targets a divider by
   what follows it, not by index), leaving general's own leading divider
   alone regardless of how many of the rows above it are hidden. Only
   general (and, if >=2 designs, per-design) notes remain visible.
   body[data-single-screen] is the correct scope HERE: the dock always talks
   about the screen currently on the canvas, so an active-design flag is
   exactly what it needs. */
body[data-single-screen="true"] .feedback-section:has(#screen-textareas),
body[data-single-screen="true"] .feedback-divider:has(+ .feedback-section #screen-textareas) {
  display: none;
}

/* The panel TOC collapses PER GROUP, never per body. #screen-nav is a
   CROSS-design container: one .screen-nav-group per design, each led by the
   heading that switches to it. body[data-single-screen] is written by
   updateScreenScope() from the ACTIVE design's screen count, so gating the
   container on it blanked the entire table of contents — every other
   design's entry, and the only in-panel way back — the moment the user
   switched to a design that happened to hold one screen. The flag belongs
   on the group, stamped once per design by buildDesignUI(), where it is
   also stable across switches instead of flipping under the user. */
.screen-nav-group[data-single-screen="true"] .screen-nav-item { display: none; }

/* Only when there is genuinely nothing left to navigate — one design, that
   one design holds one screen, AND the iteration has no views — may the
   container itself go. Without this the emptied flex box keeps its
   border-bottom and paints a stray divider under the iteration tabs.
   The :has() guard keeps the PANEL route to the views: their group lives
   inside THIS container, and collapsing it would take that route with it.
   The switcher route is independent — the .view-switch-item row inside
   .design-switcher stays visible whenever view segments exist (see the
   :not(:has(.view-switch-item)) guard two rules down) — so dropping the
   guard here would not strand the views, it would leave them reachable
   from the switcher only. "Nothing left to navigate" still has to mean
   nothing, views included: the panel lists them, so it must not vanish
   while they exist. */
body[data-single-design="true"][data-single-screen="true"]
  #screen-nav:not(:has(.screen-nav-view-item)) {
  display: none;
}

/* Single-design iteration: sibling mechanism to single-screen above, set by
   the same wiring pass (buildDesignUI()). Hides the design switcher and the
   per-design feedback row via CSS only — no JS branching needed at the call
   site, matching how single-screen already collapses. The design heading
   level of #screen-nav also collapses back to a flat list since there is
   nothing to group. The :not(:has(.view-switch-item)) guard on the switcher
   selector keeps the switcher visible when the iteration has views: with a
   single design plus views the switcher is the one-click route to the view
   segments, so only a genuinely single-design, view-less switcher collapses. */
body[data-single-design="true"] .design-switcher:not(:has(.view-switch-item)),
body[data-single-design="true"] .screen-nav-design-heading,
body[data-single-design="true"] .feedback-section:has([data-design-comment]),
body[data-single-design="true"] .feedback-divider:has(+ .feedback-section [data-design-comment]) {
  display: none;
}
body[data-single-design="true"] .screen-nav-group .screen-nav-item { margin-left: 0; }

/* ── View mode dock swap (§ Views (optional)) — the dock never shows the
   design/screen rows and the view row at once. Default (no view active):
   the view row (built once per iteration, may be empty of any view) stays
   hidden along with its leading divider. Once a view IS active
   (body[data-view-active="true"], set by showView()/showDesign()), the
   design + screen rows and THEIR leading dividers hide instead, and the
   view row takes their place. Same :has()-based divider targeting as the
   single-screen/single-design rules above. */
body:not([data-view-active="true"]) .feedback-section:has(#view-textareas),
body:not([data-view-active="true"]) .feedback-divider:has(+ .feedback-section #view-textareas) {
  display: none;
}
body[data-view-active="true"] .feedback-section:has(#design-textareas),
body[data-view-active="true"] .feedback-divider:has(+ .feedback-section #design-textareas),
body[data-view-active="true"] .feedback-section:has(#screen-textareas),
body[data-view-active="true"] .feedback-divider:has(+ .feedback-section #screen-textareas) {
  display: none;
}

/* General is always visible and now sits last, so it always carries a
   leading divider — except the one case where screen, design AND view are
   ALL hidden at once (single-design + single-screen + no view active):
   general is then the only row left, and a divider with nothing above it
   would float above an otherwise-empty dock. #design-general-feedback is
   the general textarea's own id, so this targets exactly its divider. */
body[data-single-design="true"][data-single-screen="true"]:not([data-view-active="true"])
  .feedback-divider:has(+ .feedback-section #design-general-feedback) {
  display: none;
}

/* Indicator swap (§ Views (optional)) — belt-and-suspenders CSS mirror of
   the JS hidden-toggle in updateIndicator(); JS is authoritative (it also
   fills #active-view-label), this rule only guards against a stale paint
   between a view switch and the next updateIndicator() call. */
body[data-view-active="true"] #indicator-screen-info { display: none; }
body:not([data-view-active="true"]) #indicator-view { display: none; }

/* ── Viewport toggle — device switcher, bottom-left ──
   The fourth corner: indicator top-left, switcher top-centre, ☰ top-right,
   💬 bottom-right. It must read as the quietest element on the page, and it
   is deliberately 34px against the FABs' 60px — a third circle of the same
   size would read as a third action, which this is not. Do NOT fold it into
   the .panel-fab/.feedback-fab rule; that rule is one component with two
   positions and this is a different component.
   Corner arithmetic, so nobody has to re-derive it:
     toggle   left 32px … 32+160px = 192px   (expanded), top edge 66px
     💬 FAB   left 100vw - 92px                (60px + 2rem margin)
   The two can only meet below 284px viewport width, which is out of scope.
   Vertically the expanded toggle tops out at 66px while .feedback-dock
   bottoms out at calc(2rem + 60px - 6px) = 86px — a 20px gap that holds
   even where the dock becomes a full-width sheet at ≤560px. */
.viewport-toggle {
  position: fixed;
  left: 2rem;
  bottom: 2rem;
  /* Same tier as .screen-indicator: quiet corner chrome. Above
     .content-dimmer (50) so the view stays switchable after a submit,
     below .panel-backdrop (150), .feedback-dock (180) and the panel (200). */
  z-index: 90;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 34px;
  /* Resting state is a plain circle showing only the glyph. max-width — not
     width — is what animates: `width: auto` is not interpolable, and
     animating a fixed width re-positions the glyph mid-transition. With
     overflow: hidden the label reveals without the left edge ever moving,
     which is what keeps a bottom-LEFT anchored control growing rightward
     instead of drifting into the corner. */
  max-width: 34px;
  overflow: hidden;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-color, #30363d) 70%, transparent);
  background: color-mix(in srgb, var(--panel-bg, #161b22) 70%, transparent);
  color: var(--text-secondary, #8b949e);
  /* Barely-there, but not the switcher's 0.18: that bar can afford near-
     invisibility because it carries a readable text label. An icon-only
     button at 0.18 is undiscoverable. */
  opacity: 0.55;
  cursor: pointer;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: max-width 0.22s cubic-bezier(0.2, 0.9, 0.3, 1),
              opacity 0.16s ease, background 0.16s ease, border-color 0.16s ease;
}
.viewport-toggle svg { flex: none; width: 20px; height: 20px; }
/* Exactly one glyph is visible, picked by the mode the JS wrote onto the
   button. Driving it from CSS keeps the JS free of SVG construction. */
.viewport-toggle svg { display: none; }
.viewport-toggle[data-mode="desktop"] svg[data-glyph="desktop"],
.viewport-toggle[data-mode="tablet"] svg[data-glyph="tablet"],
.viewport-toggle[data-mode="phone"] svg[data-glyph="phone"] { display: block; }
.viewport-toggle-label {
  font-size: 0.8rem;               /* .screen-indicator's scale */
  color: var(--text, #c9d1d9);
  white-space: nowrap;
  opacity: 0;
  /* Delayed so the text fades in once the pill has mostly finished
     widening — fading in while still clipped looks like chewed-off text. */
  transition: opacity 0.15s ease 0.05s;
}
.viewport-toggle:hover,
.viewport-toggle:focus-visible {
  max-width: 160px;
  opacity: 1;
  background: color-mix(in srgb, var(--panel-bg, #161b22) 92%, transparent);
  border-color: var(--border-color, #30363d);
}
.viewport-toggle:hover .viewport-toggle-label,
.viewport-toggle:focus-visible .viewport-toggle-label { opacity: 1; }
/* Outline, not a border swap: a border change would fight the max-width
   transition and shift the glyph by a pixel on focus. */
.viewport-toggle:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: 2px; }
/* Press-in, deliberately the inverse of the FABs' :hover grow, so the two
   never read as the same gesture. */
.viewport-toggle:active { transform: scale(0.93); transition: transform 0.1s ease; }
/* One declared viewport is no choice, so there is no control. Same collapse
   idiom as body[data-single-design] / body[data-single-screen] above. */
body[data-single-viewport="true"] .viewport-toggle { display: none; }
/* A view (§ Views (optional)) replaces the design as the active top-level
   item — no screen is on display, so there is no device to switch. Mirrors
   the dock/indicator swaps that key off the same flag. */
body[data-view-active="true"] .viewport-toggle { display: none; }
/* Fades out under an open ☰ panel exactly like .design-switcher — it sits
   below the backdrop anyway, and a half-dimmed control invites dead clicks. */
body.panel-open .viewport-toggle { opacity: 0; pointer-events: none; }

/* ── Device stage — the portrait/landscape frame pair ──
   Only ever built for the ACTIVE screen, and only outside desktop mode.
   Desktop mode has no stage at all, which IS the visual distinction: bezels
   and a canvas wash appear, nothing more elaborate.
   The authored mockup stays in the DOM as the clone source and is hidden
   with display:none — NOT opacity or off-screen positioning, both of which
   leave it focusable and readable by a screen reader, i.e. the content would
   be announced three times instead of two. */
[data-template="design"] section[data-screen][data-device-mode] > *:not(.device-stage) { display: none; }
/* Device mode replaces the section's own scrolling with the stage's. Leaving
   overflow-y: auto here makes the scrollbar's appearance shrink clientWidth,
   which lowers the fit scale, which removes the scrollbar again — a visible
   oscillation, and a "ResizeObserver loop" warning in Chromium. */
[data-template="design"] section[data-screen][data-device-mode] { overflow: hidden; padding: var(--chrome-safe-top, 5.75rem) 1.5rem var(--chrome-safe-bottom, 2rem); }
.device-stage {
  align-self: stretch;             /* the section centres its children; the
                                      stage must instead fill it, or the
                                      available height is undefined and the
                                      fit maths has nothing to measure */
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* A quiet wash so the eye reads "staged device view" without a new colour:
     40% of --input-bg, already the recessed-surface token of this template. */
  background: color-mix(in srgb, var(--input-bg, #0d1117) 40%, transparent);
  border-radius: 12px;
}
/* Below MIN_DEVICE_SCALE the pair genuinely does not fit and scrolling beats
   squinting. Centred content that overflows its scroll container is unreachable
   at the leading edge, so the alignment flips with the overflow. */
.device-stage[data-clamped="true"] { overflow: auto; align-items: flex-start; justify-content: flex-start; }
/* transform: scale() leaves the LAYOUT box at full size. .device-fit is the
   compensator: JS sets it to the SCALED size while .device-pair scales inside
   it from the top-left corner. Without this pair of elements a scaled-down
   mock still reserves its full unscaled height, the section grows scrollbars
   around empty space, and the top of the stage ends up above the scroll
   origin where it cannot be reached at all. */
.device-fit { position: relative; flex: none; }
.device-pair {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  /* ONE gap for both axes, deliberately. fitDeviceStage() reads it once and
     scores the row and the column candidate with the same value, because the
     axis is not known until bestFit() has answered. An axis-specific gap
     override would therefore be scored with the PREVIOUS render's value and
     the pick would lag one switch behind. If a differing gap is ever wanted,
     bestFit() has to take one per axis — do not add a
     `[data-axis="…"] { gap }` rule here. */
  gap: 2rem;
}
/* Axis is chosen by JS from whichever direction yields the larger scale, not
   by a width breakpoint — see bestFit() for why a fixed breakpoint is wrong
   in both directions. */
.device-pair[data-axis="column"] { flex-direction: column; }
.device-shell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  /* Never shrink individually: the pair is scaled once, as a unit. Flex's
     default shrink would otherwise make the two frames different sizes and
     destroy the comparison the pair exists for. */
  flex: none;
}
/* Restrained bezel: one border in --panel-bg so it recedes instead of
   reading as glossy plastic, a hairline inset ring for definition against
   dark backgrounds, one soft shadow for elevation. Phones carry thinner
   bezels and rounder corners than tablets on every shipping device, so a
   single uniform radius reads as wrong to anyone who has held either. */
.device-bezel {
  box-sizing: content-box;
  background: var(--panel-bg, #161b22);
  border: var(--device-bezel, 10px) solid var(--panel-bg, #161b22);
  border-radius: var(--device-radius-outer, 20px);
  box-shadow: 0 8px 28px rgba(0,0,0,0.35), inset 0 0 0 1px var(--border-color, #30363d);
}
.device-bezel[data-device="tablet"] { --device-bezel: 10px; --device-radius-outer: 20px; --device-radius-inner: 10px; }
.device-bezel[data-device="phone"]  { --device-bezel: 8px;  --device-radius-outer: 26px; --device-radius-inner: 18px; }
/* The simulated screen. It scrolls itself — that is what a real device's
   screen does, and it saves every mockup from managing its own scroll
   region. container-type: size is what makes @container device (…) inside
   the mock resolve against the SIMULATED size instead of the browser
   window; it is the only mechanism that can, since the window never
   changes. */
.device-viewport {
  width: var(--device-w);
  height: var(--device-h);
  border-radius: var(--device-radius-inner, 12px);
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--input-bg, #0d1117);
  container-type: size;
  container-name: device;
}
/* Same quiet-metadata register as .screen-indicator, so captions do not read
   as a new text style. */
.device-caption { font-size: 0.8rem; color: var(--text-secondary, #8b949e); text-align: center; }
.device-caption strong { color: var(--text, #c9d1d9); font-weight: 600; }
@media (prefers-reduced-motion: reduce) {
  /* The pill still expands — it has to, or the label is unreachable — it
     just snaps rather than animating. */
  .viewport-toggle { transition: opacity 0.16s ease, background 0.16s ease, border-color 0.16s ease; }
  .viewport-toggle:active { transform: none; transition: none; }
  /* Nothing to disable on .device-pair: its transform is recomputed on every
     resize frame, so it is deliberately NOT transitioned in the base rule —
     an animated scale would lag a frame behind the .device-fit box that has
     to change instantly with it. */
}
```

