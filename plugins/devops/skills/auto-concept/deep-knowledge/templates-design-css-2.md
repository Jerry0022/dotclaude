# Concept templates, part 12 of 42: Template: design — layout CSS (continued 2)

```css
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
/* The `?` glyph in front of a view's short title (viewNavTitle()). */
.screen-nav-view-item .screen-idx { color: var(--accent-color); font-weight: 600; margin-right: 0.5rem; }

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
   bottoms out at calc(2rem + 60px + 14px) = 106px — a 40px gap that holds
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

/* ── Device switch beside the eye ──
   Inside the header the cycling pill gives way to one bare icon button per
   declared device (renderViewportModes), styled exactly like the eye: no
   box, dimmed until pointed at, the current device in the accent colour. */
.viewport-modes { display: none; }
.design-header .viewport-toggle { display: none; }
.design-header .viewport-modes { display: inline-flex; align-items: center; gap: 2px; margin-left: 4px; }
.viewport-mode {
  display: inline-grid; place-items: center; box-sizing: border-box;
  width: 28px; height: 28px; padding: 0; border-radius: 50%; cursor: pointer;
  border: 1px solid transparent; background: transparent;
  color: var(--text-secondary, #8b949e); opacity: 0.45;
  transition: opacity 0.16s ease, border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
}
.viewport-mode svg { width: 16px; height: 16px; display: block; }
.viewport-mode[aria-pressed="true"] { color: var(--accent-color, #58a6ff); opacity: 0.7; }
.viewport-mode:hover, .viewport-mode:focus-visible {
  opacity: 1; border-color: var(--border-color, #30363d);
  background: color-mix(in srgb, var(--panel-bg, #161b22) 85%, transparent);
}
.viewport-mode:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: 2px; }
body[data-single-viewport="true"] .viewport-modes,
body[data-view-active="true"] .viewport-modes,
body[data-overview-active="true"] .viewport-modes { display: none !important; }

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
/* Whole-app screens (data-screen-fit="full", on the screen or its design):
   the mock IS the page, so it fills the content area edge to edge — no chrome
   padding, no stage wash, no device caption. FABs and the navigation overlap
   the app instead of pushing it. Element-level screens keep the padded,
   captioned look. */
[data-template="design"] section[data-screen][data-screen-fit="full"],
[data-template="design"] [data-design][data-screen-fit="full"] section[data-screen] {
  padding: 0; align-items: stretch; justify-content: stretch;
}
[data-template="design"] section[data-screen][data-screen-fit="full"] > :not([data-anno-layer]):not(.device-stage),
[data-template="design"] [data-design][data-screen-fit="full"] section[data-screen] > :not([data-anno-layer]):not(.device-stage) {
  max-width: none; min-height: 100%; border-radius: 0;
}
[data-template="design"] section[data-screen][data-screen-fit="full"] .device-stage,
[data-template="design"] [data-design][data-screen-fit="full"] .device-stage { background: none; border-radius: 0; }
[data-screen-fit="full"] .device-caption { display: none; }
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
