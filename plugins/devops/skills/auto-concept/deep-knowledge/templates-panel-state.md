# Concept templates, part 10 of 16: Shared systems — decision panel state CSS

## Decision Panel State CSS

```css
/* ── Panel anatomy (all templates) ──
   .concept-decision-panel is a flex column (§ Panel Chrome sets that);
   below the .panel-head chrome row (theme toggle + ✕, `flex: 0 0 auto`,
   § Panel Chrome) these four children split it. `min-height: 0` on the scroll box is
   load-bearing: a flex child refuses to shrink below its content height
   without it, so the tree would grow past the viewport and push the pinned
   foot off screen — exactly the "scroll the menu to find the button" defect
   this anatomy exists to remove. */
/* The "you are here" box below the head row: the "› TOC entry" sub-line
   and, while the 🕘 chip is unfolded, the rounds list. The round label and
   the chip themselves sit in .panel-head (§ Panel Chrome) — this box is
   empty on the final report (no sub-line there) and then collapses to its
   divider. */
.panel-here {
  flex: none;
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.15rem 0.5rem;
  padding-bottom: 0.5rem;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-color, #30363d);
  font-size: 0.8rem;
  color: var(--text-secondary, #8b949e);
}
.panel-here-round { font-weight: 600; color: var(--text-color, #c9d1d9); white-space: nowrap; }
/* #panel-here-back + the 🕘 chip as one group at the right end of the head
   row, left of the theme toggle. margin-left: auto lives HERE, not on
   either child: #panel-here-back is [hidden] on the live round (the common
   case), and an auto margin on the child itself would then contribute
   nothing, leaving the chip stranded next to the round label instead of at
   the right edge. The wrapper is always present, so the pair is always
   pushed right, back link or not. */
.panel-here-right {
  flex: none;
  display: inline-flex; align-items: center; gap: 0.35rem;
  margin-left: auto;
}
.panel-here-section {
  flex: 1 1 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 🕘 rounds chip. */
.panel-here-rounds-btn {
  flex: none;
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.45rem;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary, #8b949e);
  font-size: 0.78rem;
  cursor: pointer;
}
.panel-here-rounds-btn:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
  color: var(--text-color, #c9d1d9);
}
/* Toggled list — a plain disclosure, closed by default, no persistence.
   Lives INSIDE .panel-here (flex-basis 100%) so it never scrolls with the
   tree below it. */
.panel-here-rounds-list {
  flex: 1 1 100%;
  display: flex; flex-direction: column; gap: 2px;
  margin-top: 0.4rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--border-color, #30363d);
  max-height: 40vh;
  overflow-y: auto;
}
.panel-here-rounds-list[hidden] { display: none; }
.panel-here-rounds-item {
  display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem;
  width: 100%;
  padding: 0.3rem 0.4rem;
  border: none; border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #8b949e);
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
  opacity: 0.85;
}
.panel-here-rounds-item:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
  opacity: 1;
}
.panel-here-rounds-label { font-weight: 600; white-space: nowrap; }
.panel-here-rounds-summary { flex: 1 1 auto; text-align: right; }
.panel-here-rounds-tag {
  flex: none;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--border-color, #30363d);
  font-size: 0.68rem;
  text-transform: uppercase; letter-spacing: 0.03em;
}
.panel-here-section[hidden],
.panel-here-back[hidden],
.panel-here-rounds-btn[hidden] { display: none; }
/* The head does NOT fold on narrow viewports any more. It used to (#341):
   the panel was a 487px bottom sheet there and the head cost 51px of it. The
   panel is a full-height overlay in every template now, so the space argument
   is gone — and the fold took `#panel-here-back` with it, one of the three
   ways back to the live round from a frozen one, on exactly the viewport
   where the other two are hardest to hit. */
.panel-nav-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
/* On the final report the TOC is secondary — the close-out sheet is the main
   content, and it needs most of the foot's height (§ CTA foot below). By
   default the tree is a 3-entry window around the reading line
   (applyNavWindow(), § Section Nav JS), so it normally fits this cap
   without scrolling; the cap still applies once the user expands the list
   with "+N weitere". A live check at 1440×768 with the rows region still
   floored at 220px found only 1–3 of the 4 row heads fitting with a body
   open; capping the tree tighter (28vh → 18vh) is what gives
   `.closeout-rows` the room it needs. `min-height: 56px` keeps a sliver of
   the tree reachable rather than letting it collapse to nothing — it is
   secondary, not gone. */
body.viewing-final .panel-nav-scroll {
  flex: 0 1 auto;
  max-height: 18vh;
  min-height: 56px;
}
.panel-status {
  flex: none;
  margin-top: 0.75rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--border-color, #30363d);
}
/* Hard cap. The smallest case (one round, three sections) and the largest
   (ten rounds, twenty-five entries) get the same foot; what varies is only
   how much of the tree is on screen. #367: this box is deliberately NOT
   `position: relative` — #submit-menu's containing block must be
   `.concept-decision-panel` (the overlay aside itself, already `position:
   fixed`, see § Panel Chrome), never this one. Per CSS 2.1 § overflow, an
   ancestor only clips an absolutely positioned descendant when it IS (or
   contains) that descendant's containing block; skipping `position:
   relative` here means `.panel-cta`'s own `overflow-y: auto` below cannot
   clip the menu, however the foot is currently scrolled. */
.panel-cta {
  flex: none;
  max-height: 120px;
  padding-top: 0.6rem;
  /* Safety net, never the plan: the cap is what keeps the call to action on
     screen, so a foot whose content outgrows it scrolls inside the foot
     instead of clipping — the first live check (#341) found the frozen block
     at 157px with its "back to the live round" button cut off below the cap.
     The scrollbar rules above already cover .panel-cta. Every foot state is
     sized to fit WITHOUT scrolling (see #panel-frozen .hint and
     .submitted-indicator below); this only catches the next overflow.
     #367: an EARLIER fix routed #submit-menu around this clip with
     `position: fixed`, sampling the split button's viewport rect once at
     open time — but on the design layout the panel is still mid slide-in
     transition when the caret is clicked fast, so that viewport rect was
     stale by the time the transition finished and the menu opened up to
     400px off-screen. Never anchor the menu to the viewport; it must move
     WITH the panel, which is what removing `position: relative` from this
     box achieves (see .submit-menu below). */
  overflow-y: auto;
}
/* The close-out sheet is the one legitimate exception: a form to fill in, not
   a call to action. On the final-report tab the foot grows to take the space
   `.panel-nav-scroll` gave up above (§ .panel-nav-scroll) and becomes a flex
   column itself — `overflow: hidden`, NOT `auto`: the foot must never scroll
   as a whole, only `.closeout-rows` inside `#closeout-sheet` may (§ below).
   A live check at 1440×768/900 found #closeout-execute below the fold with
   EVERY row open before this: `.panel-cta` had a bounded height but stayed
   `display: block` (its default from the base rule), so its child
   `#panel-final-report` never became the flex column the sheet's own
   internal flex/scroll needed a bounded parent height to shrink against —
   a percentage/flex height against a `display: block` ancestor with
   `height: auto` just resolves to the content's own natural size, i.e. no
   cap at all. */
body.viewing-final .panel-cta {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* `#panel-final-report` is the one child of `.panel-cta` actually shown in
   this state (showIteration() sets its OWN inline `display: flex`, which is
   what makes these apply at all — the other three sibling panel states stay
   `display: none` and never become flex items). It must itself be the flex
   column that hands `#closeout-sheet` a bounded, shrinkable height. */
#panel-final-report {
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}
/* The final report has no status line: the sheet's one button carries the
   submission state itself (running/done/stalled — setCloseoutButtonState())
   and the disconnected case as its "wird zwischengespeichert" label
   (updateCloseoutButton()), so a second, separate line above the sheet only
   cost the rows region ~40px for information the button already shows. */
body.viewing-final .panel-status { display: none; }

/* ── Status line ── one line, one glyph, six mutually exclusive states on
   .panel-status[data-status], rendered by renderPanelStatus() (§ Claude
   Connection Heartbeat):
     saved       ✓ Gespeichert · verbunden           success
     saving      … Speichert                         muted, transient
     connecting  ◐ Gespeichert · verbinde…           accent, pulsing glyph
     local-only  ⚠ Nur lokal gespeichert · getrennt  warning BACKGROUND — the one
                 state that is categorically different: the work is not delivered
     submitted   ⏳ Übermittelt · Claude arbeitet     accent (+ progress dots)
     frozen      🕘 Iteration N · nur lesen           warning text
   #connection-status inside it keeps the raw heartbeat on [data-state]
   (connecting | connected | disconnected — the monitoring + gate contract).
   Purely informational: it NEVER overlays or disables the submit buttons and
   has no acknowledge button. Details stay in the DOM (the step list expands
   under the line), never tooltip-only. */
.status-line {
  display: flex; align-items: center; gap: 0.45rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  font-size: 0.8rem; font-weight: 600; line-height: 1.3;
  color: var(--text-secondary, #8b949e);
  transition: color 0.25s, background 0.25s;
}
.status-glyph { flex: none; width: 1.15em; text-align: center; }
.conn-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-status[data-status="saved"] .status-line { color: var(--success-color, #3fb950); }
.panel-status[data-status="saving"] .status-line { color: var(--text-secondary, #8b949e); }
.panel-status[data-status="connecting"] .status-line { color: var(--accent-color, #58a6ff); }
.panel-status[data-status="submitted"] .status-line { color: var(--accent-color, #58a6ff); }
.panel-status[data-status="frozen"] .status-line { color: var(--warning-color, #d29922); }
.panel-status[data-status="local-only"] .status-line {
  color: var(--text-color, #c9d1d9);
  background: color-mix(in srgb, var(--warning-color, #d29922) 22%, transparent);
  box-shadow: inset 3px 0 0 var(--warning-color, #d29922);
}
/* connecting + submitted pulse the glyph; every other state is steady. */
.panel-status[data-status="connecting"] .status-glyph,
.panel-status[data-status="submitted"] .status-glyph {
  animation: conn-pulse 1.2s ease-in-out infinite;
}
@keyframes conn-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.82); }
  50%      { opacity: 1;   transform: scale(1); }
}
/* Progress dots — the compact rendering of #status-steps for the pinned
   line. One <i data-state> per visible step; the <ol> underneath is the
   source of truth and opens on click. */
.status-detail { margin-top: 0.25rem; }
.status-detail[hidden] { display: none; }
.status-detail > summary {
  list-style: none;
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.1rem 0.5rem;
  font-size: 0.72rem;
  color: var(--text-secondary, #8b949e);
  cursor: pointer;
}
.status-detail > summary::-webkit-details-marker { display: none; }
.status-detail > summary::after { content: "▸"; margin-left: auto; }
.status-detail[open] > summary::after { content: "▾"; }
.status-dots { display: inline-flex; gap: 5px; }
.status-dots i {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--border-color, #30363d);
}
.status-dots i[data-state="active"] {
  background: var(--accent-color, #58a6ff);
  animation: pulse 1.4s ease-in-out infinite;
}
.status-dots i[data-state="done"] { background: var(--success-color, #3fb950); }
.status-detail .status-steps { margin: 0.4rem 0 0.2rem 0.5rem; }
@media (prefers-reduced-motion: reduce) {
  .status-glyph, .status-dots i { animation: none !important; }
}

/* Cache hint — shown only while Claude is disconnected, so the user knows
   the click will be queued and auto-delivered on reconnect. Toggled via
   [hidden] by _setCacheHints(): an inline badge INSIDE the primary button
   and a line inside the submit menu. */
.hint-cache {
  font-size: 0.78rem;
  line-height: 1.35;
  margin: 0.25rem 0 0;
  color: var(--warning-color, #d29922);
  display: flex; align-items: center; gap: 0.35rem;
}
.hint-cache[hidden] { display: none; }
.submit-btn .hint-cache {
  font-size: 0.68rem; font-weight: 500; line-height: 1.2;
  margin: 0; color: #fff; opacity: 0.9;
}

/* Content dimmer — covers the content area after submit so the user's focus
   lands on the decision panel / FAB. Decision panel, FABs, feedback dock,
   panel backdrop, and screen-indicator all sit at z-index ≥ 90 (the panel
   itself at 200), so they paint above the dimmer
   and stay clear + interactive. The dimmer itself is click-to-dismiss.
   Auto-clears on page reload (next iteration / final report) because the
   body class is not persisted. */
.content-dimmer {
  position: fixed;
  inset: 0;
  z-index: 50;
  /* Theme-neutral grey overlay — works on dark and light backgrounds without
     a CSS variable dependency. Same opacity range as .panel-backdrop. */
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(1.5px);
  -webkit-backdrop-filter: blur(1.5px);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}
body.content-dimmed .content-dimmer:not([hidden]) {
  opacity: 1;
  pointer-events: auto;
}
.content-dimmer[hidden] { display: none; }
.content-dimmer:focus-visible {
  outline: 2px solid var(--accent-color, #58a6ff);
  outline-offset: -4px;
}

/* Frozen-iteration floating bar — shown by showIteration() on every non-live
   tab, together with the re-armed dimmer (the "veil"). The veil is what gets
   clicked away by reflex; the bar is what still says "you are in history"
   afterwards, so it deliberately uses the WARNING tint rather than the muted
   history colour of .frozen-indicator — being overlooked is the failure mode
   it exists to fix. Sits above the dimmer (50) and the design chrome sharing
   its band (switcher 95, anno pill 96), below the FABs (100), the panel
   backdrop (150) and the panel itself. */
.frozen-bar {
  position: fixed; top: 0.75rem; left: 50%; transform: translateX(-50%);
  z-index: 97;
  box-sizing: border-box;
  display: flex; align-items: center; gap: 0.6rem;
  max-width: min(560px, calc(100vw - 2rem));
  padding: 0.4rem 0.45rem 0.4rem 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--warning-color, #d29922);
  background: color-mix(in srgb, var(--warning-color, #d29922) 16%, var(--panel-bg, #161b22));
  color: var(--text-color, #c9d1d9);
  font-size: 0.82rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.frozen-bar[hidden] { display: none; }
.frozen-bar-text {
  min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.frozen-bar-text strong { color: var(--text-color, #c9d1d9); }
.frozen-bar button {
  flex-shrink: 0;
  padding: 0.3rem 0.75rem; border-radius: 999px; border: none;
  background: var(--accent-color, #58a6ff); color: #fff;
  font-size: 0.8rem; font-weight: 600; cursor: pointer;
  transition: filter 0.15s ease;
}
.frozen-bar button:hover { filter: brightness(1.12); }
.frozen-bar button:focus-visible {
  outline: 2px solid var(--accent-color, #58a6ff);
  outline-offset: 2px;
}
/* Design template: the top-centre band at 0.75rem belongs to .design-switcher.
   Drop into the row below it (same 3.75rem derivation as .anno-toggle-fab)
   and stay inside the switcher's 34vw width band, so the bar can never run
   into the screen-indicator column on the left or the ☰ FAB on the right —
   the same geometry contract every other piece of design chrome follows. */
/* Document rounds: the ☰ FAB (top: 2rem; right: 2rem, a 60px circle) is new
   here — it used to be design-only — and the bar's band runs straight through
   it on a narrow viewport. Measured at 375px before this cap: the circle
   covered ~44px of #frozen-bar-back, the on-content way back to the live
   round. Ending the bar before the FAB's column costs nothing wide (the bar
   is centred and far narrower than the cap there). */
.frozen-bar { max-width: min(560px, calc(100vw - 184px)); }
html[data-template="design"] .frozen-bar {
  top: 3.75rem;
  max-width: min(34vw, 560px);
}

/* Submitted state — compact: it shares the ≤120px foot with the frozen block
   and the split button, and the progress itself lives in the status line.
   Measured at panel width (#341): indicator 63px + hint 54px overran the cap
   by 3px, so the indicator lost a little padding — 58 + 54 = 112, no scroll. */
.submitted-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  margin-bottom: 0.3rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
  border: 1px solid var(--success-color, #3fb950);
  font-size: 0.9rem;
}
.submitted-indicator .check-icon {
  font-size: 1.1rem;
  color: var(--success-color, #3fb950);
}
.submitted-hint {
  font-size: 0.8rem;
  line-height: 1.4;
  color: var(--text-secondary);
  margin: 0;
}

/* Frozen panel state — same indicator language as the submitted panel, in the
   muted border colour rather than a status colour: a frozen tab is neither
   good news nor a warning, it is history. Same compactness rule as above. */
.frozen-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.3rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #30363d);
  background: color-mix(in srgb, var(--text-secondary, #8b949e) 10%, transparent);
  color: var(--text-secondary, #8b949e);
  font-size: 0.9rem;
}
.frozen-indicator .frozen-icon { font-size: 1.1rem; }
/* The hint paragraph does not render in the foot (#341): at panel width it
   wraps to three lines (67px) and pushes the frozen block to 157px — past the
   120px cap, with the back button clipped below it. The same sentence is
   already on screen twice: the status line ("🕘 Iteration N · nur lesen") and
   the frozen bar over the content. The markup stays (screen readers, older
   pages) — the foot is indicator + back button, ≈85px. */
#panel-frozen .hint { display: none; font-size: 0.78rem; line-height: 1.35; margin: 0; }
#panel-frozen .link-btn { margin-top: 0.3rem; }

/* Progress steps under the status line.
   Three states per <li>:
     data-state="pending" → not yet started (muted, ○ icon)
     data-state="active"  → currently happening (full text color, ⏳ icon
                            with a slow pulse so the user sees motion)
     data-state="done"    → completed (success color, ✓ icon)
   The <li data-step="implemented"> is only revealed for action="implement"
   submissions; submitWithAction sets its `hidden`. The <li
   data-step="reality-check"> before it stays hidden even then, and is
   unhidden by updateStatusSteps only if the check actually runs. */
.status-steps {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.85rem;
}
.status-steps li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary, #8b949e);
  transition: color 0.2s ease;
}
.status-steps li[data-state="active"] {
  color: var(--text-color, #c9d1d9);
  font-weight: 500;
}
.status-steps li[data-state="done"] {
  color: var(--success-color, #3fb950);
}
.status-steps .step-icon {
  display: inline-block;
  width: 1rem;
  text-align: center;
  flex-shrink: 0;
}
.status-steps li[data-state="active"] .step-icon {
  animation: step-pulse 1.4s ease-in-out infinite;
}
@keyframes step-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
/* State-dependent step labels. When an <li> carries multiple
   .step-label[data-state-label] spans, only the one matching the li's
   current data-state is visible. Used by the "implemented" step where
   "Implementierung läuft" (active) reads differently than "Implementierung
   abgeschlossen" (done). Steps without data-state-label spans are
   unaffected — their plain .step-label stays visible always. */
.status-steps li .step-label[data-state-label] {
  display: none;
}
.status-steps li[data-state="pending"] .step-label[data-state-label="pending"],
.status-steps li[data-state="active"] .step-label[data-state-label="active"],
.status-steps li[data-state="done"] .step-label[data-state-label="done"] {
  display: inline;
}

/* Shared pulse (used by the active progress dot in the status line). */
@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

#submit-iterate-btn:disabled,
#submit-implement-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Close-out sheet. Every question at once inside one bounded box — the box
   is what tells the user this is a form to fill in, not a wall of
   independent buttons.
   The padding deliberately undercuts the 1.5rem "card padding" token from
   § Design System: the panel is 360px (min(360px, 90vw) — 337px at a 375px
   viewport), and after the panel's own 1.5rem gutters a 1.5rem sheet padding
   would leave ~230px for two-column rows like [radio][label]. Do not "restore"
   it to the token without re-checking that budget. */
.closeout-sheet {
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  padding: 0.9rem 0.95rem 1rem;
  /* The sheet is its own flex column so #closeout-execute stays
     PINNED at the bottom regardless of which row is open — only
     .closeout-rows (§ below) scrolls. `flex: 1 1 auto; min-height: 0`, NOT
     `height: 100%`: the sheet's parent (`#panel-final-report`) is itself a
     flex column now (§ CTA foot), so the sheet is a flex ITEM there and
     should size itself the normal flexbox way. A `height: 100%` here once
     tried to resolve against `#panel-final-report`, but that element was
     still `display: block` with an auto height at the time — a
     percentage/flex height against a block ancestor with `height: auto`
     just falls back to the content's own natural size, i.e. no cap at all,
     which is why the button still sat below the fold at 1440×768/900 after
     that first attempt. The whole chain — `.panel-cta` →
     `#panel-final-report` → `.closeout-sheet` → `.closeout-rows` — must be
     flex columns end to end, or the cap breaks at whichever link isn't. */
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.closeout-sheet .closeout-head {
  flex: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
}
/* The rows region: every accordion head + whichever ONE body is open. The
   thing that scrolls internally so the button below it never has to.
   `min-height: 0`, NOT a pixel floor: a fixed floor (260px, then before it
   220px) either squeezed the plan/button off a short viewport or still only
   fit 1 of 4 heads once a body was open. Sticky heads (§ below) are what
   actually solve "all four heads always visible" now — the region itself is
   free to flex to whatever height is left, however little. */
.closeout-sheet .closeout-rows {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* `display: contents`: a `.closeout-block` inside the rows region generates
   NO BOX of its own — its head + body become direct flow children of
   `.closeout-rows` instead. This is load-bearing, not cosmetic: a sticky
   element's containing block is its nearest block-container ANCESTOR, and
   with the block as a real box that ancestor was the (short) block itself,
   not the scroll region — `bottom: N × H` could never pull a head above its
   own block's top edge, so with a tall body open in an earlier row, every
   LATER head sat below the visible region entirely (a live check measured
   heads 2–4 at y=912/948/983 while the region's own box ended at y=711).
   With `display: contents` the block disappears as a box and the heads'
   containing block becomes `.closeout-rows` itself, so the offsets in
   layoutCloseoutRowHeads() finally resolve against the region both edges
   need to reach. `[hidden]` must keep winning (a hidden block's children
   must not render at all) — the override two rules down is deliberately
   MORE specific than this one so source order cannot flip it. */
.closeout-sheet .closeout-rows > .closeout-block {
  display: contents;
}
.closeout-sheet .closeout-rows > .closeout-block[hidden] {
  display: none;
}
/* Sticky-both-edges row heads: each head gets `top: i × H` AND
   `bottom: (n-1-i) × H` (H = `.closeout-row`'s own fixed `min-height`,
   computed per visible block by layoutCloseoutRowHeads()). `top` alone
   piles heads at the TOP as the region scrolls down, but the region is
   almost always shorter than n × H here — a live check found only 1 of 4
   heads fitting — so without the symmetric `bottom` constraint the later
   heads still get pushed off the BOTTOM as the earlier ones pile at the
   top. Both constraints together pin every head inside a fixed H-tall slot
   regardless of scroll position, with no scroll listener and no measured
   layout. `z-index` + an opaque `background` keep a stuck head above the
   body content scrolling underneath it. Selector targets the head directly
   (not `> .closeout-block > [data-closeout-row]`) because `display:
   contents` above removes `.closeout-block` from the box tree entirely —
   `>` through it would no longer match a rendered box to combine with. */
.closeout-sheet .closeout-rows [data-closeout-row] {
  position: sticky;
  z-index: 1;
  background: var(--panel-bg, #161b22);
  border-bottom: 1px solid var(--border-color, #30363d);
}
/* A fixed, known height for the sticky math above to key off — it must
   match CLOSEOUT_HEAD_H_REM in the JS exactly, or consecutive stuck heads
   gap or overlap. */
.closeout-sheet .closeout-row { min-height: 2.2rem; }
/* No divider rule keyed off `.closeout-block + .closeout-block` inside the
   rows region any more — with `display: contents` the block generates no
   box for a `+` adjacent-sibling margin/border to land on regardless; the
   divider lives entirely on the head's own border-bottom (above), which
   travels with the sticky head and keeps every slot flush (zero gap), which
   the offset math depends on. */
/* Pinned foot: never inside .closeout-rows, always laid out after it, and
   never fighting .closeout-rows for space. The button and the one stalled
   hint are `flex: none` — a live check found `flex: 0 1 auto; min-height:
   0` on a foot element let it collapse to 7px (invisible) exactly when
   space was tight; a fixed pixel floor on `.closeout-rows` (above) pushed
   the foot AND the "Iterationen ansehen" link below the viewport instead,
   clipped by `.panel-cta`'s own `overflow: hidden`. `min-height: 0` on the
   rows region (this time paired with sticky heads, not a floor) is what
   lets the rows region give ground to this pinned foot rather than the
   other way round. */
.closeout-sheet #closeout-execute,
.closeout-sheet .hint[data-finalize-state] {
  flex: none;
}
.closeout-sheet .closeout-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary, #8b949e);
}
/* "n von N beantwortet" — lives next to the title while the sheet is live;
   renderCloseout()/updateCloseoutProgress() empties it once the section is
   data-closed (nothing left to answer). */
.closeout-sheet .closeout-progress {
  font-size: 0.72rem;
  color: var(--text-secondary, #8b949e);
  font-variant-numeric: tabular-nums;
}
.closeout-sheet .closeout-count {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-secondary, #8b949e);
  font-variant-numeric: tabular-nums;
}
/* Legacy heading style — the rows get their heading from .closeout-row-label
   instead (§ below). */
.closeout-sheet .closeout-q {
  margin: 0 0 0.5rem 0;
  font-size: 0.95rem;
  font-weight: 600;
}
/* One rule separates the blocks, so the sheet reads as separate rows rather
   than one long column of controls. */
.closeout-sheet .closeout-block + .closeout-block {
  margin-top: 1.1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color, #30363d);
}
.closeout-sheet .closeout-block[hidden] { display: none; }
/* Accordion row head — always visible, one line when collapsed. A real
   <button> (not a div+click) so Enter/Space open it and it disables for free
   under setCloseoutFrozen()'s `sheet.querySelectorAll('input, button')`. */
.closeout-sheet .closeout-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.5rem;
  padding: 0.2rem 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
/* The done state's hand-offs row (renderCloseout()'s data-closed branch):
   still a <button> in the DOM (so its icon+label stay in normal flow), but
   permanently `disabled` and stripped of every answerable affordance — no
   mark, no summary, no aria-expanded. Without this override the row still
   LOOKS clickable: `disabled` alone does not touch our own `cursor: pointer`
   above. */
.closeout-sheet .closeout-row:disabled {
  cursor: default;
}
.closeout-sheet .closeout-mark {
  flex: none;
  width: 1.1rem;
  text-align: center;
  color: var(--text-secondary, #8b949e);
}
/* ✓ / ● / ○ — set by updateCloseoutRowSummary() from the block's own
   data-answered / data-open, never painted from CSS alone: the glyph IS the
   state a screen reader has nothing else to announce it by. */
.closeout-sheet .closeout-block[data-answered="true"] .closeout-mark {
  color: var(--success-color, #3fb950);
}
.closeout-sheet .closeout-block[data-open="true"]:not([data-answered="true"]) .closeout-mark {
  color: var(--accent-color, #58a6ff);
}
/* Locked — a row AFTER the current one that has not been answered yet
   (updateCloseoutRowSummary() sets data-locked + `disabled` on the head).
   Dimmed as a whole and stripped of its summary: it is a preview of what is
   still to come, not a question that can be answered out of order, and a
   default like "Seite löschen" on a row the user has not reached yet would
   read as already decided. `:disabled` alone would not touch our own
   `cursor: pointer` (§ .closeout-row above). */
.closeout-sheet .closeout-block[data-locked="true"] .closeout-row {
  opacity: 0.4;
  cursor: not-allowed;
}
.closeout-sheet .closeout-block[data-locked="true"] .closeout-row-summary { display: none; }
.closeout-sheet .closeout-row-icon { flex: none; font-size: 1rem; line-height: 1; }
.closeout-sheet .closeout-row-label { flex: none; font-size: 0.85rem; font-weight: 600; }
/* Right-aligned, truncated rather than wrapped — a collapsed row is one
   line, whatever the answer reads like ("2 · Issue, Issue"). */
.closeout-sheet .closeout-row-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  color: var(--text-secondary, #8b949e);
  font-size: 0.78rem;
}
/* The summary is what the row looks like collapsed; once it is the one open
   row the expanded body says the same thing in full, so the one-liner would
   just repeat it back squeezed into no space. */
.closeout-sheet .closeout-row[aria-expanded="true"] .closeout-row-summary { display: none; }
.closeout-sheet .closeout-row-body { margin-top: 0.6rem; }
.closeout-sheet .closeout-row-body[hidden] { display: none; }
.closeout-sheet .followup-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin: 0.6rem 0 0.2rem;
}
/* One open point: its title, then its three routes on their own row. The
   routes do NOT sit next to the title — at 360px panel width three segments
   plus a title on one line is ~55px per segment, which truncates every label
   the user needs to read before choosing. */
.closeout-sheet .followup {
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  padding: 0.5rem 0.6rem 0.55rem;
}
.closeout-sheet .followup-title {
  display: block;
  font-size: 0.85rem;
  line-height: 1.4;
  overflow-wrap: break-word;
  margin-bottom: 0.45rem;
}
/* Origin tag — "bewusst vertagt" / "unterwegs gefunden". Muted on purpose:
   it explains why the row exists, it is not a fourth choice. */
.closeout-sheet .followup-origin {
  display: inline-block;
  margin: -0.2rem 0 0.45rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-size: 0.66rem;
  line-height: 1.5;
  color: var(--text-secondary, #8b949e);
  background: color-mix(in srgb, var(--text-secondary, #8b949e) 12%, transparent);
}
.closeout-sheet .followup-routes {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  overflow: hidden;
}
.closeout-sheet .followup-route {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  cursor: pointer;
}
.closeout-sheet .followup-route + .followup-route {
  border-left: 1px solid var(--border-color, #30363d);
}
/* The radio itself is the state, not the paint: hiding it visually while
   keeping it focusable is what lets the label carry the selected look and
   keeps keyboard/AT behaviour to a plain radio group. */
.closeout-sheet .followup-route input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.closeout-sheet .followup-route span {
  display: block;
  padding: 0.35rem 0.2rem;
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--text-secondary, #8b949e);
}
.closeout-sheet .followup-route:hover span {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}
.closeout-sheet .followup-route input:checked + span {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 20%, transparent);
  color: var(--text-color, #c9d1d9);
  font-weight: 600;
}
/* "Jetzt umsetzen" writes code — it gets the warning colour the implement
   button uses, so the one row that reaches into the repo is visible at a
   glance in a list of otherwise harmless choices. */
.closeout-sheet .followup-route input[value="implement"]:checked + span {
  background: color-mix(in srgb, var(--warning-color, #d29922) 22%, transparent);
  color: var(--warning-color, #d29922);
}
.closeout-sheet .followup-route input:focus-visible + span {
  outline: 2px solid var(--accent-color, #58a6ff);
  outline-offset: -2px;
}
.closeout-sheet .closeout-choice {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.55rem 0.6rem;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1.4;
  margin-bottom: 0.45rem;
}
.closeout-sheet .closeout-choice:hover {
  border-color: var(--accent-color, #58a6ff);
}
.closeout-sheet .closeout-choice input[type="radio"] {
  margin-top: 0.15rem;
  flex-shrink: 0;
}
.closeout-sheet .closeout-choice-label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
/* Flex items default to min-width:auto, so a row only refuses to shrink below
   its longest unbroken token — which in German (and in any URL-ish
   data-issue-title) is easily 35+ characters. At the 375px viewport the row
   has ~240px to work with, so without these three the block scrolls
   horizontally instead of wrapping. */
.closeout-sheet .closeout-choice-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}
.closeout-sheet .closeout-sub {
  color: var(--text-secondary, #8b949e);
  font-size: 0.78rem;
  line-height: 1.4;
}
/* Hand-offs — the steps only the user can take once the close-out is
   through. Warning-coloured like the routes that reach outside the page, and
   the one block renderCloseout() keeps after data-closed: the last thing on
   the sheet is the thing still left to do. Done state hides its own
   .closeout-row head (no controls left) and shows the body directly. */
.closeout-sheet .closeout-handoffs {
  border: 1px solid color-mix(in srgb, var(--warning-color, #d29922) 55%, transparent);
  background: color-mix(in srgb, var(--warning-color, #d29922) 10%, transparent);
  border-radius: 6px;
  padding: 0.6rem 0.7rem;
}
.closeout-sheet .closeout-handoffs .closeout-row-label { color: var(--warning-color, #d29922); }
.closeout-sheet .closeout-handoffs-list {
  margin: 0.4rem 0 0;
  padding-left: 1.2rem;
  font-size: 0.85rem;
  line-height: 1.5;
}
.closeout-sheet .closeout-handoffs-list li { margin-bottom: 0.3rem; }
.closeout-sheet #closeout-execute {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-weight: 600;
}
.closeout-sheet #closeout-execute:disabled { opacity: 0.5; cursor: not-allowed; }
/* One button, five states, never a second element: neutral/accent
   "Weiter ›" while rows are still unanswered, the warning-coloured
   "⚠ Ausführen" once every visible row is (updateCloseoutButton() sets
   [data-ready]), then — after the click — the submission's own status on
   [data-finalize-state] (setCloseoutButtonState()): running (accent),
   done (success), stalled (warning). `.implement-btn` (below, § Two-Button
   Submit) supplies the warning colours as the base/default look; the
   overrides here are the other four. The finalize states are disabled by
   setCloseoutFrozen() and keep full opacity: they are a status readout,
   not a greyed-out control. */
.closeout-sheet #closeout-execute:not([data-ready="true"]) {
  color: var(--accent-color, #58a6ff);
  border-color: var(--accent-color, #58a6ff);
}
.closeout-sheet #closeout-execute:not([data-ready="true"]):hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent);
}
.closeout-sheet #closeout-execute[data-finalize-state] { opacity: 1; cursor: default; }
.closeout-sheet #closeout-execute[data-finalize-state="running"] {
  color: var(--accent-color, #58a6ff);
  border-color: var(--accent-color, #58a6ff);
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}
.closeout-sheet #closeout-execute[data-finalize-state="done"] {
  color: var(--success-color, #3fb950);
  border-color: var(--success-color, #3fb950);
  background: color-mix(in srgb, var(--success-color, #3fb950) 10%, transparent);
}
.closeout-sheet #closeout-execute[data-finalize-state="stalled"] {
  color: var(--warning-color, #d29922);
  border-color: var(--warning-color, #d29922);
}
.link-btn {
  display: inline-block;
  margin-top: 0.6rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-color, #58a6ff);
  font-size: 0.8rem;
  cursor: pointer;
  text-decoration: underline;
}
.link-btn:hover { opacity: 0.8; }

.closeout-sheet #closeout-followups-none {
  color: var(--warning-color, #d29922);
}

/* Disposition fieldset — controls Step 6 cleanup. Lives inside the sheet's
   "files" block; default selection is "discard" (matches the typical one-shot
   refinement workflow). */
.dispose-fieldset {
  margin-top: 0;
  padding: 0.85rem 0.95rem 1rem;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-color, #0d1117) 70%, transparent);
}
.dispose-fieldset legend {
  padding: 0 0.4rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-color, #c9d1d9);
}
.dispose-fieldset .dispose-hint {
  margin: 0 0 0.75rem 0;
  color: var(--text-secondary, #8b949e);
  font-size: 0.78rem;
  line-height: 1.4;
}
.dispose-fieldset .dispose-option {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.dispose-fieldset .dispose-option:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 8%, transparent);
}
.dispose-fieldset .dispose-option input[type="radio"] {
  margin-top: 0.25rem;
  accent-color: var(--accent-color, #58a6ff);
}
.dispose-fieldset .dispose-label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.dispose-fieldset .dispose-label strong {
  font-size: 0.85rem;
  font-weight: 600;
}
.dispose-fieldset .dispose-sub {
  font-size: 0.74rem;
  color: var(--text-secondary, #8b949e);
  line-height: 1.4;
}
.dispose-fieldset .dispose-move-row {
  margin-top: 0.65rem;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--border-color, #30363d);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.dispose-fieldset .dispose-move-row label {
  font-size: 0.78rem;
  color: var(--text-secondary, #8b949e);
  font-weight: 500;
}
.dispose-fieldset .dispose-move-row input {
  width: 100%;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--border-color, #30363d);
  background: color-mix(in srgb, var(--bg-color, #0d1117) 80%, transparent);
  color: var(--text-color, #c9d1d9);
  font: inherit;
  font-size: 0.82rem;
}
.dispose-fieldset .dispose-move-row input:focus {
  outline: none;
  border-color: var(--accent-color, #58a6ff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color, #58a6ff) 30%, transparent);
}

/* Iteration tab styling for the final-report tab — distinct from
   numbered iteration tabs so the closing step reads as a milestone. */
.iteration-tab[data-final-report] {
  border-color: var(--success-color, #3fb950);
  color: var(--success-color, #3fb950);
}
.iteration-tab[data-final-report][aria-selected="true"] {
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
  border-color: var(--success-color, #3fb950);
  color: var(--text-color, #c9d1d9);
}
.iteration-tab[data-final-report][aria-selected="true"]::before {
  content: "✓ ";
  color: var(--success-color, #3fb950);
}
.iteration-tab[data-final-report]:not([aria-selected="true"])::before {
  content: "";
}

/* Iteration tab styling for a reality-check round. Warning-toned, not error-
   toned: nothing went wrong, the branch simply moved, and the round is a
   normal iteration the user answers and moves on from. Loud enough that the
   user understands why an implement click produced another round, quiet
   enough that it does not read as a blocker. */
.iteration-tab[data-reality-check] {
  border-color: var(--warning-color, #d29922);
  color: var(--warning-color, #d29922);
}
.iteration-tab[data-reality-check][aria-selected="true"] {
  background: color-mix(in srgb, var(--warning-color, #d29922) 15%, transparent);
  border-color: var(--warning-color, #d29922);
  color: var(--text-color, #c9d1d9);
}
.iteration-tab[data-reality-check]::before {
  content: "⟲ ";
  color: var(--warning-color, #d29922);
}

/* The explainer that opens a reality-check section. It is the first thing the
   user reads after clicking implement and NOT getting code, so it carries the
   whole "why am I looking at this" load — including the reassurance that the
   implement order still stands. */
.reality-banner {
  border: 1px solid var(--warning-color, #d29922);
  border-left-width: 4px;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.5rem;
  background: color-mix(in srgb, var(--warning-color, #d29922) 8%, transparent);
}
.reality-banner h2 {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  color: var(--text-color, #c9d1d9);
}
.reality-banner p { margin: 0.4rem 0 0; color: var(--text-secondary, #8b949e); }
.reality-banner .reality-reassure { color: var(--text-color, #c9d1d9); font-weight: 600; }
.reality-evidence {
  margin: 0.6rem 0 0;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text-secondary, #8b949e) 10%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  color: var(--text-secondary, #8b949e);
  overflow-x: auto;
}

/* Open-questions section — checkbox list with optional "[Issue #NNN]"
   linked badges once items have been routed to GitHub. */
/* Hand-offs section in the report body — what the user has to do by hand
   after the merge. It used to be one more paragraph among the others and
   disappeared visually; it is the one part of the report that turns into a
   to-do for a person, so it is the one part that is painted. */
section[data-handoffs] {
  border-left: 4px solid var(--warning-color, #d29922);
  background: color-mix(in srgb, var(--warning-color, #d29922) 8%, transparent);
  border-radius: 0 8px 8px 0;
  padding: 0.9rem 1.1rem;
  margin: 1.5rem 0;
}
section[data-handoffs] h3::before { content: '⚠ '; color: var(--warning-color, #d29922); }
section[data-handoffs] ol { padding-left: 1.3rem; }
section[data-handoffs] li { margin-bottom: 0.45rem; }
section[data-open-questions] .open-questions-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
section[data-open-questions] .open-questions-list li {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  background: var(--bg-subtle, transparent);
}
section[data-open-questions] .open-questions-list label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}
section[data-open-questions] .oq-done {
  margin-left: 0.5rem;
  font-size: 0.8rem;
  color: var(--success-color, #3fb950);
}
section[data-open-questions] .open-questions-list input[type="checkbox"]:disabled + .oq-label {
  opacity: 0.7;
}
section[data-open-questions] .oq-issue-link {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 1px 6px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--success-color, #3fb950);
  border: 1px solid var(--success-color, #3fb950);
  border-radius: 4px;
  text-decoration: none;
}
section[data-open-questions] .oq-issue-link:hover {
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
}
```

