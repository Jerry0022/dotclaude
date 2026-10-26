# Concept templates, part 25 of 43: Shared systems — decision panel state CSS (continued 2)

```css
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
   the foot AND the "Runden ansehen" link below the viewport instead,
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
```

