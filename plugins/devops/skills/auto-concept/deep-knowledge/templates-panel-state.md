# Concept templates, part 24 of 43: Shared systems — decision panel state CSS

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
/* ONE line between the scrolling list and the foot: the .panel-status
   border-top above. The design layout's #screen-nav (the views list is its
   last group) carries its own border-bottom (§ Layout CSS), which sat just
   above it and drew a double grey line in every foot state (with or without
   the open-questions hint, journey row or not). Neutralised here, inside
   the scroll box only, so the one divider stays pinned with the foot. */
.panel-nav-scroll > .screen-nav { border-bottom: 0; padding-bottom: 0; margin-bottom: 0.25rem; }
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

/* Submitted toast — renderSubmittedToast() (§ Status line). Bottom centre,
   between the viewport toggle (bottom-left) and the 💬 FAB (bottom-right),
   the success tint of .submitted-indicator. Above the dimmer (50) so it reads
   over the veil too, below the FABs (100). Hidden while the panel is open
   (the panel shows the same state) and on a past tab (the frozen bar owns
   that moment). The offline strip shares the spot: the toast steps up. */
.submitted-toast {
  position: fixed; left: 50%; bottom: 2rem; transform: translateX(-50%);
  z-index: 97;
  box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 0.5rem;
  max-width: min(560px, calc(100vw - 184px));
  padding: 0.5rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--success-color, #3fb950);
  background: color-mix(in srgb, var(--success-color, #3fb950) 16%, var(--panel-bg, #161b22));
  color: var(--text-color, #c9d1d9);
  font: inherit; font-size: 0.85rem; white-space: nowrap;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  cursor: pointer;
  animation: submitted-toast-in 0.25s ease;
}
.submitted-toast[hidden],
body.panel-open .submitted-toast,
body.viewing-frozen .submitted-toast { display: none; }
.submitted-toast:hover { filter: brightness(1.1); }
.submitted-toast:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: 2px; }
.submitted-toast-check { color: var(--success-color, #3fb950); font-weight: 800; }
.submitted-toast-label { font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
.submitted-toast-sep, .submitted-toast-working { color: var(--text-secondary, #8b949e); }
.submitted-toast-dots:empty { display: none; }
body:has(.draft-offline-strip:not([hidden])) .submitted-toast { bottom: 4.75rem; }
@keyframes submitted-toast-in {
  from { opacity: 0; transform: translate(-50%, 12px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
@media (max-width: 560px) {
  .submitted-toast-sep, .submitted-toast-working { display: none; }
}
@media (prefers-reduced-motion: reduce) { .submitted-toast { animation: none; } }

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
   already on screen twice: the status line ("🕘 Runde N · nur lesen") and
   the frozen bar over the content. The markup stays (screen readers, older
   pages) — the foot is the back button alone (see below). */
#panel-frozen .hint { display: none; font-size: 0.78rem; line-height: 1.35; margin: 0; }
/* The status line already reads "🕘 Runde N · nur lesen" right above, so the
   indicator would be the same state twice (the doubled mark on old rounds).
   The foot is the back button alone; the indicator markup stays for older
   pages and screen readers. */
#panel-frozen .frozen-indicator { display: none; }
#panel-frozen .link-btn { margin-top: 0; }

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
```

