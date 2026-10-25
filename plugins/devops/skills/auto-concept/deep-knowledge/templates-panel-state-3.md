# Concept templates, part 25 of 41: Shared systems — decision panel state CSS (continued 3)

```css
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

/* ── Journey row (§ Submit → Journey row) ──────────────────────────────────
   One row replaces the old split button, the progress dots, the green
   "übermittelt" box and its hint: round toggle — wire — lock — wire — 🤖
   Umsetzung — wire — 🏁 Abschluss. mountJourney() builds it and adopts
   #submit-iterate-btn / #submit-implement-btn as the toggles' fill halves;
   renderJourney() writes .journey[data-phase] = you | rethinking | unlock |
   implementing. Unlock never transform-scales anything: the two toggles trade
   flex-grow (the sum stays 1, so 🏁 and its wire do not move) while their
   faces cross-fade — the outgoing face is gone before the width moves, the
   incoming one fades in once the width has arrived, so no frame shows a
   squeezed or half-clipped glyph. */
.journey {
  --jr-track: color-mix(in srgb, var(--text-color, #c9d1d9) 7%, var(--panel-bg, #161b22));
  --jr-you: var(--accent-color, #388bfd);
  --jr-ai: var(--success-color, #3fb950);
  --jr-gold: #e3b341;
  --jr-ease: cubic-bezier(.4, 0, .2, 1);
  display: flex; align-items: center;
  padding: 0.15rem 0 0.4rem;
}
body.viewing-frozen .journey, body.viewing-final .journey:not(.journey-final) { display: none; }
/* Finished row on the final report (mountFinalJourney): mini ✓✓, Umsetzung
   bar full, 🏁 lit. Sits on top of #panel-final-report, never interactive. */
.journey-final { flex: none; padding: 0 0 0.6rem; }
.journey-final .jr-round { flex: 0 0 62px; }
.journey-final .jr-impl {
  flex: 1 1 0; height: 44px; padding: 3px;
  background: var(--jr-track);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .3), inset 0 1px 0 rgba(255, 255, 255, .04);
}
.journey-final .jr-mini { cursor: default; }
.journey-final .jr-dot { color: var(--jr-ai); background: color-mix(in srgb, var(--jr-ai) 14%, transparent); }
.journey-final .jr-dot .jr-chk { display: block; }
.journey-final .jr-run .jr-other { position: relative; z-index: 1; color: var(--jr-ai); }
.journey-final .jr-run b { position: relative; z-index: 1; }
.journey-final .jr-finish {
  width: 34px; height: 34px; font-size: 15px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--jr-gold) 92%, #fff), #c6901a);
  box-shadow: 0 0 18px rgba(227, 179, 65, .45), 0 2px 8px rgba(0, 0, 0, .35);
}
.journey [hidden] { display: none !important; }
#panel-submitted { display: none !important; }
.submit-split[hidden], #submit-menu.jr-retired { display: none !important; }
.jr-wire {
  flex: none; display: block; width: 6px; height: 2px; border-radius: 2px;
  background: color-mix(in srgb, var(--text-color, #c9d1d9) 14%, transparent);
  transition: width .38s var(--jr-ease) .06s, opacity .15s, background .3s;
}
.jr-wire[data-ok] { background: color-mix(in srgb, var(--jr-ai) 55%, transparent); }
.jr-node {
  width: 28px; height: 28px; flex: none; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; line-height: 1; color: var(--text-secondary, #8b949e);
  background: var(--jr-track);
  box-shadow: 0 2px 6px rgba(0, 0, 0, .3), inset 0 1px 0 rgba(255, 255, 255, .05);
  overflow: hidden;
  transition: width .38s var(--jr-ease) .06s, opacity .15s;
}
/* The 🤖 Umsetzung node and its wire fold into the implement toggle. */
.journey[data-phase="unlock"] .jr-fold,
.journey[data-phase="implementing"] .jr-fold { width: 0; opacity: 0; }
.jr-toggle {
  position: relative; box-sizing: border-box; min-width: 0;
  display: grid; grid-template-areas: "f"; grid-template-columns: minmax(0, 1fr); align-items: center;
  height: 44px; padding: 3px; border-radius: 999px;
  background: var(--jr-track);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .3), inset 0 1px 0 rgba(255, 255, 255, .04);
  transition: flex-grow .38s var(--jr-ease) .06s, flex-basis .38s var(--jr-ease) .06s,
              height .2s, padding .2s, background .2s, box-shadow .2s;
}
.jr-round { flex: 1 1 0; }
.jr-impl  { flex: 0 1 38px; background: transparent; box-shadow: none; padding: 0; height: 38px; }
.journey[data-phase="unlock"] .jr-round,
.journey[data-phase="implementing"] .jr-round { flex: 0 0 62px; }
.journey[data-phase="unlock"] .jr-impl,
.journey[data-phase="implementing"] .jr-impl {
  flex: 1 1 0; height: 44px; padding: 3px;
  background: var(--jr-track);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .3), inset 0 1px 0 rgba(255, 255, 255, .04);
}
/* Faces: stacked in one grid cell; exactly one per toggle carries [data-on]. */
.jr-face {
  grid-area: f; min-width: 0; height: 100%;
  display: flex; align-items: center; gap: 3px;
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity .12s, visibility 0s linear .12s;
}
.jr-face[data-on] {
  opacity: 1; visibility: visible; pointer-events: auto;
  transition: opacity .2s .34s, visibility 0s;
}
/* The lock is the implement toggle's seed: it stays while the track grows,
   then hands over to the 🔓 face at the same spot. */
.jr-face-lock { transition: opacity .15s .3s, visibility 0s linear .45s; }
.jr-face-lock[data-on] { transition: opacity .2s .3s, visibility 0s; }
.jr-other, .jr-dot {
  flex: none; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  line-height: 1; color: var(--text-secondary, #8b949e);
}
.jr-other { width: 30px; height: 30px; font-size: 14px; }
.jr-other[data-ok] { color: var(--jr-ai); background: color-mix(in srgb, var(--jr-ai) 14%, transparent); }
.jr-chk { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 3.4; stroke-linecap: round; stroke-linejoin: round; }
.journey .jr-fill, .journey .submit-btn.jr-fill, .journey .implement-btn.jr-fill {
  flex: 1 1 auto; min-width: 0; width: auto; height: 38px; margin: 0; padding: 0 8px;
  border: 0; border-radius: 999px;
  display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 8px;
  font: inherit; font-size: 13px; font-weight: 600; line-height: var(--pill-line-height, 1.3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: #fff; cursor: pointer;
  background: linear-gradient(180deg, color-mix(in srgb, var(--jr-you) 88%, #fff), var(--jr-you));
  box-shadow: 0 4px 14px color-mix(in srgb, var(--jr-you) 40%, transparent), inset 0 1px 0 rgba(255, 255, 255, .22);
}
.journey .jr-fill:hover:not(:disabled) { filter: brightness(1.08); }
.journey .jr-fill:focus-visible, .jr-lock:focus-visible, .jr-mini:focus-visible {
  outline: 2px solid var(--jr-you); outline-offset: 2px;
}
.journey .jr-fill:disabled { opacity: .55; cursor: not-allowed; }
.journey .hint-cache, .journey .warn-icon { display: none; }
.journey .submit-label { overflow: hidden; text-overflow: ellipsis; }
.journey .implement-btn.jr-fill {
  justify-content: flex-start; padding: 0 10px 0 4px; color: #1f1500;
  background: linear-gradient(100deg, #c6901a, var(--jr-gold));
  box-shadow: 0 6px 18px rgba(227, 179, 65, .35), inset 0 1px 0 rgba(255, 255, 255, .35);
}
.journey .implement-btn.jr-fill:hover:not(:disabled) { background: linear-gradient(100deg, #c6901a, var(--jr-gold)); }
.jr-ul-ico {
  width: 30px; height: 30px; flex: none; border-radius: 50%;
  background: rgba(31, 21, 0, .18);
  display: flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1;
}
.jr-ul-txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; text-align: left; }
.jr-ul-txt b { font-size: 13.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
.jr-ul-txt small { font-size: 10.5px; font-weight: 500; opacity: .72; overflow: hidden; text-overflow: ellipsis; }
.jr-lock {
  width: 38px; height: 38px; flex: none; border: 0; border-radius: 50%; padding: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; line-height: 1; cursor: pointer;
  background: linear-gradient(180deg, var(--jr-gold), #c6901a);
  box-shadow: 0 0 16px rgba(227, 179, 65, .35), 0 2px 8px rgba(0, 0, 0, .35), inset 0 1px 0 rgba(255, 255, 255, .35);
  transition: transform .2s, box-shadow .2s, filter .2s;
}
.jr-lock:hover:not(:disabled) { transform: scale(1.07); box-shadow: 0 0 24px rgba(227, 179, 65, .55), 0 2px 8px rgba(0, 0, 0, .35); }
.jr-lock:disabled { filter: grayscale(.7) brightness(.8); cursor: default; box-shadow: none; }
/* Mini toggle (↩ | 🤖): the shrunk round toggle after unlock. */
.jr-mini {
  display: flex; align-items: center; gap: 3px; height: 100%; padding: 0; margin: 0;
  border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 999px;
}
.jr-mini:disabled { cursor: default; }
.jr-dot { width: 26px; height: 26px; font-size: 12px; }
.jr-dot[data-on] { background: linear-gradient(180deg, color-mix(in srgb, var(--jr-you) 88%, #fff), var(--jr-you)); color: #fff; font-weight: 700; }
.jr-dot .jr-chk { width: 15px; height: 15px; display: none; }
.journey[data-phase="implementing"] .jr-dot { color: var(--jr-ai); background: color-mix(in srgb, var(--jr-ai) 14%, transparent); }
.journey[data-phase="implementing"] .jr-dot > span { display: none; }
.journey[data-phase="implementing"] .jr-dot .jr-chk { display: block; }
/* Run bar — the filled AI half. Shared 1:1 with the toast (renderSubmittedToast). */
.jr-run {
  position: relative; flex: 1 1 auto; min-width: 0; height: 38px; box-sizing: border-box;
  display: flex; align-items: center; gap: 8px; padding: 0 14px 0 4px;
  border-radius: 999px; overflow: hidden; white-space: nowrap;
  font-size: 14px; font-weight: 600; line-height: var(--pill-line-height, 1.3); color: #fff;
  background: color-mix(in srgb, var(--jr-ai) 9%, #0c1410);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--jr-ai) 45%, transparent), 0 4px 14px color-mix(in srgb, var(--jr-ai) 25%, transparent);
}
.jr-run-done {
  position: absolute; top: 0; bottom: 0; left: 0; overflow: hidden; border-radius: 999px;
  background: color-mix(in srgb, var(--jr-ai) 42%, transparent);
  transition: width .5s var(--jr-ease);
}
.jr-shine {
  position: absolute; top: 0; bottom: 0; width: 45%; left: -45%;
  background: linear-gradient(90deg, transparent, rgba(170, 255, 180, .35), transparent);
  animation: jr-shine 1.6s linear infinite;
}
/* Indeterminate (no _progress yet): the SAME left-anchored fill as a real
   count, sized to cover 🤖 + label, the shimmer running only inside it — in
   the ☰ journey row and the toast alike (one rule for both). The old
   travelling 38% oval (jr-sweep) read as a stray blob in the narrow row. */
.jr-run[data-indeterminate] .jr-run-done { width: min(100%, 9.5rem) !important; }
.jr-bot {
  position: relative; width: 30px; height: 30px; flex: none; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 15px; line-height: 1;
  background: linear-gradient(180deg, color-mix(in srgb, var(--jr-ai) 85%, #fff), color-mix(in srgb, var(--jr-ai) 75%, #000));
  animation: jr-breathe 2.4s ease-in-out infinite;
}
.jr-run b { position: relative; font-weight: 650; overflow: hidden; text-overflow: ellipsis; line-height: var(--pill-line-height, 1.3); padding-block: 1px; }
.jr-count { position: relative; margin-left: auto; font-style: normal; font-size: 13px; font-weight: 700; color: color-mix(in srgb, var(--jr-ai) 70%, #fff); cursor: help; }
.jr-count:empty { display: none; }
.jr-run[data-paused] { filter: saturate(.45) brightness(.85); }
.jr-run[data-paused] .jr-shine, .jr-run[data-paused] .jr-bot, .jr-run[data-paused] .jr-run-done { animation-play-state: paused; }
@keyframes jr-shine { to { left: 100%; } }
@keyframes jr-breathe { 50% { transform: scale(.9); } }
/* Build-up: once per round, the row assembles left → right. */
.journey.jr-build > * { animation: jr-in .42s ease-out both; }
.journey.jr-build > :nth-child(2) { animation-delay: .12s; }
.journey.jr-build > :nth-child(3) { animation-delay: .24s; }
.journey.jr-build > :nth-child(4) { animation-delay: .36s; }
.journey.jr-build > :nth-child(5) { animation-delay: .48s; }
.journey.jr-build > :nth-child(6) { animation-delay: .6s; }
.journey.jr-build > :nth-child(7) { animation-delay: .72s; }
@keyframes jr-in { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }

/* Status line under the row: "👉 Du bist dran · gespeichert". */
.panel-status { --jr-you: var(--accent-color, #388bfd); --jr-ai: var(--success-color, #3fb950); }
.panel-status .status-line { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; min-width: 0; white-space: nowrap; }
.panel-status .status-line .conn-label { overflow: hidden; text-overflow: ellipsis; }
.status-turn { font-weight: 650; }
.status-turn:empty { display: none; }
.status-turn:not(:empty)::after { content: " ·"; font-weight: 400; color: var(--text-secondary, #8b949e); }
.panel-status[data-turn="you"] .status-line { color: var(--text-secondary, #8b949e); }
/* Mixed toward --text-color, not #fff: on the light theme the white mix
   left pale text on a pale panel. */
.panel-status[data-turn="you"] .status-turn { color: color-mix(in srgb, var(--jr-you) 70%, var(--text-color, #fff)); }
.panel-status[data-turn="rethinking"] .status-line,
.panel-status[data-turn="implementing"] .status-line { color: color-mix(in srgb, var(--jr-ai) 75%, var(--text-color, #fff)); }
/* The steps list stays the data model of the counter (x/y + tooltip); its
   own dots/disclosure are no longer drawn. */
.panel-status .status-detail { display: none !important; }

/* The ☰ head row is secondary chrome: quiet, one size, one rhythm with the
   panel body. ✕ and the theme toggle are the same 28px ghost button in
   --text-secondary that firms up to --text-color on hover / focus; no
   oversized ✕, no greyed emoji (that read as a dusty gear). */
.panel-head .panel-close-btn,
.panel-head .theme-toggle-btn {
  width: 28px; height: 28px; padding: 0; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  align-self: center; font-size: 15px; line-height: 1;
  color: var(--text-secondary, #8b949e); opacity: 1; filter: none;
  transition: color 0.15s, background-color 0.15s;
}
.panel-head .panel-close-btn:hover, .panel-head .panel-close-btn:focus-visible,
.panel-head .theme-toggle-btn:hover, .panel-head .theme-toggle-btn:focus-visible {
  color: var(--text-color, #c9d1d9);
  background: color-mix(in srgb, var(--text-color, #c9d1d9) 8%, transparent);
  filter: none;
}
.panel-head .panel-close-btn:focus-visible,
.panel-head .theme-toggle-btn:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: 1px; }
/* Theme glyphs as monochrome line icons in currentColor (masked SVG), so
   they take the head's text colour in both themes; the emoji stay in the
   markup as the fallback for engines without mask support. */
@supports ((mask: url("")) or (-webkit-mask: url(""))) {
  .panel-head .theme-toggle-btn .theme-glyph {
    width: 16px; height: 16px; font-size: 0; color: transparent;
    background: var(--text-secondary, #8b949e);
    -webkit-mask: var(--glyph) center / contain no-repeat; mask: var(--glyph) center / contain no-repeat;
  }
  .panel-head .theme-toggle-btn:hover .theme-glyph,
  .panel-head .theme-toggle-btn:focus-visible .theme-glyph { background: var(--text-color, #c9d1d9); }
  .panel-head .theme-toggle-btn [data-glyph="sun"] {
    --glyph: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='4'/%3E%3Cpath d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'/%3E%3C/svg%3E");
  }
  .panel-head .theme-toggle-btn [data-glyph="moon"] {
    --glyph: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linejoin='round'%3E%3Cpath d='M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'/%3E%3C/svg%3E");
  }
}

/* What is open now — marked in the ☰ menu at all times (markPanelCurrent,
   § Panel Chrome JS mirrors the layout's data-active to aria-current). One
   look for every entry type: accent tint + a 3px accent bar + full text
   colour; a design heading only takes the accent text. */
.concept-decision-panel [aria-current="page"] {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 16%, transparent);
  box-shadow: inset 3px 0 0 var(--accent-color, #58a6ff);
  color: var(--text-color, #c9d1d9);
  font-weight: 600;
}
.concept-decision-panel .screen-nav-design-heading[aria-current="true"] { color: var(--accent-color, #58a6ff); }

/* Round label in the panel head — secondary info, NOT a pill: the head's
   own small text in --text-secondary, a 6px dot in the colour of whose turn
   it is (you = accent, 🤖 = success, a frozen past round = muted). The old
   gradient pill with glow read as dusty and out of place above the calm
   panel body. */
.panel-head .panel-here-round:not(:empty) {
  flex: 0 1 auto; display: inline-flex; align-items: center; gap: 7px;
  font-size: 12px; font-weight: 600; letter-spacing: .02em;
  line-height: var(--pill-line-height, 1.3);
  color: var(--text-secondary, #8b949e);
  --round-dot: var(--accent-color, #388bfd);
}
.panel-head .panel-here-round:not(:empty)::before {
  content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--round-dot);
}
body[data-journey="rethinking"] .panel-head .panel-here-round:not(:empty),
body[data-journey="implementing"] .panel-head .panel-here-round:not(:empty) { --round-dot: var(--success-color, #3fb950); }
body.viewing-frozen .panel-head .panel-here-round:not(:empty) { --round-dot: var(--text-secondary, #8b949e); }

/* ── Status toast — the same pill as the panel (renderSubmittedToast) ── */
.jr-toast {
  position: fixed; left: 50%; bottom: 2rem; transform: translateX(-50%);
  z-index: 97; width: min(340px, calc(100vw - 184px));
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  --jr-you: var(--accent-color, #388bfd); --jr-ai: var(--success-color, #3fb950); --jr-gold: #e3b341;
  cursor: pointer; animation: jr-toast-in .25s ease;
}
.jr-toast[hidden], body.panel-open .jr-toast, body.viewing-frozen .jr-toast { display: none; }
.jr-toast-cap { font-size: 10.5px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; color: var(--text-secondary, #8b949e); }
.jr-toast .jr-run { width: 100%; height: 42px; flex: none; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--jr-ai) 50%, transparent), 0 10px 26px rgba(0, 0, 0, .45); }
.jr-toast-you {
  box-sizing: border-box; width: 100%; height: 42px; flex: none; border-radius: 999px; padding: 0 16px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 14px; color: #fff; white-space: nowrap; overflow: hidden;
  background: linear-gradient(180deg, color-mix(in srgb, var(--jr-you) 88%, #fff), var(--jr-you));
  box-shadow: 0 10px 26px color-mix(in srgb, var(--jr-you) 40%, transparent), inset 0 1px 0 rgba(255, 255, 255, .22);
}
.jr-toast-you[hidden], .jr-toast .jr-run[hidden] { display: none; }
.jr-toast-you span { opacity: .85; }
.jr-float { font-size: 11.5px; font-weight: 600; letter-spacing: .02em; color: var(--jr-gold); animation: jr-float 2.4s ease-in-out infinite; }
.jr-float[hidden] { display: none; }
.jr-float i { font-style: normal; animation: jr-dot 1.2s infinite; }
.jr-float i:nth-child(2) { animation-delay: .2s; }
.jr-float i:nth-child(3) { animation-delay: .4s; }
@keyframes jr-dot { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes jr-float { 50% { transform: translateY(-2px); } }
@keyframes jr-toast-in { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
body:has(.draft-offline-strip:not([hidden])) .jr-toast { bottom: 4.75rem; }

@media (prefers-reduced-motion: reduce) {
  .jr-toggle, .jr-face, .jr-face[data-on], .jr-face-lock, .jr-face-lock[data-on], .jr-wire, .jr-node, .jr-run-done { transition: none !important; }
  .jr-shine, .jr-bot, .journey.jr-build > *, .jr-toast, .jr-float, .jr-float i { animation: none !important; }
  .jr-lock:hover:not(:disabled) { transform: none; }
}
```

