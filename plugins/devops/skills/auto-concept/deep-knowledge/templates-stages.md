# Concept templates, part 47 of 48: Shared systems — Etappen (stages): contract, head name, round row, stepper tabs, next-stage — markup and CSS

## Etappen (stages)

A concept may be split into **Etappen** (`page.json` `stages`, 1–7 entries
`{id: "A"…"G", name ≤ 24 chars}`). The build injects
`<script type="application/json" id="concept-stages">{stages, current, icon, title}</script>`
and keeps `data-stage="<id>"` on every round section, frozen ones included.
The engine only READS both — it never derives stages itself. Without the
script the page is a concept without Etappen and everything below except
the two all-concept changes is inert.

All concepts (with or without Etappen):

- **Panel head** names the concept on the live round: `<icon> <title>`
  (`conceptHeadName()`; icon from `#concept-stages`, default 🧭; title from
  `#concept-stages`, otherwise the page `<title>` without its status glyph),
  full name as app tooltip. A frozen round keeps "🧭 Runde N · archiviert",
  the final report "🏁 Abschluss" (showIteration, § Iteration Tabs).
- **Round in the nav**: the design overview row reads "Übersicht · Runde N"
  (`.screen-nav-rnd`); a round without a visible overview row gets a plain
  "Runde N" row (`#panel-round-row`) at the top of the scroll box. Both are
  hidden on a frozen round and on the final report (the head names those).

Only with Etappen:

- **No structure button on the page.** The stages live in the ☰ panel only:
  no Etappen glyph sits in the page's top-left corner (it duplicated the tab
  row and read as noise on the mock — user note, Kleingarten concept round 3).
- **Etappen stepper** (`#stage-tabs`) directly under the head: tabs of one
  width (widened to span the row when all fit, at most 7rem), each a **kind node** (26px circle) above the name (two lines, never
  ellipsised — the 24-char limit is an authoring rule). The node shows the
  glyph of the Etappe's kind, read from its newest round (`_stKindOf()`):
  `pick` (≥2 designs, alternatives), `seq` (designs as topics), `open` (≥2
  designs, no set), `one` (one design), `analysis` (`data-analysis="full"`),
  `doc` (decision / free sections); an Etappe without a round yet shows its
  letter instead. The letter otherwise sits as a small badge on the node.
  The nodes are joined by a 2px connector at their centre height (done →
  success colour, ahead → border colour), so the row reads as one stepper
  and needs no more height than a tab. App tooltip, two lines: the kind
  ("3 Richtungen, eine gewählt" / "3 Themen nacheinander" / "1 Richtung" /
  "n Abschnitte" / "n Entscheidungen, geführt") and "Etappe B · Runde 4" (the
  newest round), or "Beginnt nach der aktuellen Etappe." for an Etappe not
  reached yet. Scroll-snap per tab, the viewport sized to whole tabs so
  none is cut. ‹ › are plain glyphs in their own gutters beside the row,
  shown on hover or keyboard focus only, and only when the row overflows.
  Roving tabindex: ←/→/Home/End move focus, Enter/Space opens the tab. On
  every panel open the tab of the visible round's Etappe is selected and
  scrolled into view.
- **Tab content**: the visible round's Etappe → today's nav (design screen
  nav or section TOC), plus a 🕘 disclosure for that Etappe's earlier rounds.
  Any other Etappe → `#stage-pane`: its NEWEST round as a "Runde N" row and
  that round's TOC (click = jump there), and the 🕘 disclosure listing its
  earlier rounds the same way. An Etappe not reached yet shows one quiet
  line. No counters.
- The head's 🕘 rounds chip leaves the live head (it lives in the tabs);
  a frozen round's head is unchanged.
- **Journey row**: while the live round is not in the LAST Etappe,
  "Nächste Etappe ›" (`#jr-next-stage`) replaces the 🔒 · 🤖 · 🏁 stations;
  "👉 Zur nächsten Runde" stays. Click submits
  `submitWithAction('next-stage', {stage, next})` through the normal submit
  path. In the last Etappe the row is exactly as without Etappen.

```css
/* ── Etappen + round row (§ Etappen) ── */
.panel-round-row {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.6rem; margin-bottom: 2px;
  font-size: 0.85rem; font-weight: 700; color: var(--text-color, #e6edf3);
}
.panel-round-row::before {
  content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--accent-color, #58a6ff);
}
.panel-round-row[hidden] { display: none; }
.screen-nav-rnd { margin-left: 0.4rem; font-weight: 500; color: var(--text-secondary, #8b949e); white-space: nowrap; }
body.viewing-frozen .screen-nav-rnd, body.viewing-frozen .panel-round-row { display: none; }
/* Live head of a staged concept: the 🕘 chip lives in the Etappen tabs. */
body[data-staged]:not(.viewing-frozen) #panel-here-rounds,
body[data-staged]:not(.viewing-frozen) #panel-here-rounds-list { display: none !important; }

.stage-tabs { --stage-tab-w: 4.6rem; --stage-tab-gap: 4px; --stage-node: 26px; position: relative; flex: 0 0 auto;
  display: flex; align-items: center; margin: 0 0 0.6rem; }
.stage-tabs-sc { flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden;
  scroll-snap-type: x mandatory; scroll-behavior: smooth; padding-bottom: 2px; }
.stage-tabs[data-overflow] .stage-tabs-sc { flex: none; }
.stage-tabs-in { display: flex; gap: var(--stage-tab-gap); }
.stage-tab {
  position: relative; flex: none; box-sizing: border-box; width: var(--stage-tab-w); min-height: 3.5rem;
  padding: 4px 3px; border-radius: 9px; border: 1px solid transparent; background: none;
  display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center;
  scroll-snap-align: start; cursor: pointer; font: inherit; color: var(--text-secondary, #8b949e);
}
.stage-tab:hover { background: color-mix(in srgb, var(--accent-color, #58a6ff) 8%, transparent); }
.stage-tab:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: -2px; }
/* Stepper connector: from the previous node's right edge to this node's
   left edge, at the node centre (the tab's own box is the reference). */
.stage-tab + .stage-tab::before {
  content: ""; position: absolute; z-index: 0; height: 2px; border-radius: 1px; pointer-events: none;
  top: calc(5px + var(--stage-node) / 2 - 1px);
  left: calc(-50% - var(--stage-tab-gap) + var(--stage-node) / 2 + 3px);
  right: calc(50% + var(--stage-node) / 2 + 3px);
  background: var(--border-color, #30363d);
}
.stage-tab:is([data-state="done"], [data-state="now"]) + .stage-tab:is([data-state="done"], [data-state="now"])::before {
  background: color-mix(in srgb, var(--success-color, #3fb950) 70%, transparent);
}
.stage-node { position: relative; z-index: 1; box-sizing: border-box; width: var(--stage-node); height: var(--stage-node);
  flex: none; border-radius: 50%; display: grid; place-items: center;
  border: 1.5px solid var(--border-color, #30363d); background: var(--panel-bg, #161b22); color: var(--text-secondary, #8b949e); }
.stage-node svg { display: block; width: 14px; height: 14px; }
.stage-tl { position: absolute; right: -5px; bottom: -4px; box-sizing: border-box; min-width: 13px; height: 13px; padding: 0 2px;
  border-radius: 7px; display: grid; place-items: center; font-size: 8px; font-weight: 700; line-height: 1;
  background: var(--panel-bg, #161b22); color: inherit; border: 1px solid currentColor; }
.stage-node[data-kind="none"] .stage-tl { position: static; min-width: 0; height: auto; padding: 0; border: 0;
  background: none; font-size: 11px; }
.stage-tn { font-size: 0.66rem; line-height: 1.15; hyphens: auto; overflow-wrap: break-word; }
.stage-tab[data-state="done"] .stage-node {
  border-color: color-mix(in srgb, var(--success-color, #3fb950) 70%, transparent); color: var(--success-color, #3fb950);
  background: color-mix(in srgb, var(--success-color, #3fb950) 16%, var(--panel-bg, #161b22));
}
.stage-tab[data-state="now"] .stage-node {
  border-color: var(--accent-color, #58a6ff); background: var(--accent-color, #58a6ff); color: #fff;
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent-color, #58a6ff) 60%, transparent);
}
.stage-tab[data-state="now"] .stage-tl { background: var(--accent-color, #58a6ff); }
.stage-tab[data-state="ahead"] .stage-node { border-style: dashed; }
.stage-tab[aria-selected="true"] {
  color: var(--text-color, #e6edf3); background: color-mix(in srgb, var(--accent-color, #58a6ff) 13%, transparent);
  border-color: color-mix(in srgb, var(--accent-color, #58a6ff) 45%, transparent);
}
.stage-tab[aria-selected="true"] .stage-tn { font-weight: 600; }
/* ‹ › : plain glyphs in their own 18px gutters, no frame; only while the row
   overflows, visible on hover or keyboard focus. */
.stage-arr { display: none; flex: none; width: 18px; align-self: stretch; padding: 0; border: 0; background: none;
  font: inherit; font-size: 17px; line-height: 1; color: var(--text-secondary, #8b949e);
  cursor: pointer; opacity: 0; transition: opacity 0.15s; }
.stage-tabs[data-overflow] .stage-arr { display: grid; place-items: center; }
.stage-arr-prev { justify-items: start; }
.stage-arr-next { justify-items: end; }
.stage-tabs:hover .stage-arr, .stage-tabs:focus-within .stage-arr { opacity: 0.75; }
.stage-arr:hover, .stage-arr:focus-visible { opacity: 1 !important; color: var(--text-color, #e6edf3); }
.stage-arr:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: -2px; border-radius: 6px; }
.stage-arr:disabled { visibility: hidden; }
@media (hover: none) { .stage-tabs[data-overflow] .stage-arr { opacity: 0.75; } }

/* Another Etappe selected: its pane replaces the live nav in the scroll box. */
.panel-nav-scroll[data-stage-view="other"] > :not(#stage-pane) { display: none !important; }
.stage-pane[hidden] { display: none; }
.stage-round {
  display: flex; align-items: center; gap: 0.5rem; width: 100%; box-sizing: border-box; padding: 0.4rem 0.6rem;
  border: 0; border-radius: 8px; background: none; font: inherit; font-size: 0.85rem; font-weight: 700;
  color: var(--text-color, #e6edf3); text-align: left; cursor: pointer;
}
.stage-round::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--text-secondary, #8b949e); }
.stage-round:hover { background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent); }
.stage-round:focus-visible, .stage-ti:focus-visible, .stage-older-btn:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: -2px; }
.stage-toc { display: flex; flex-direction: column; gap: 1px; margin: 2px 0 8px 0.5rem; padding-left: 0.5rem;
  border-left: 2px solid color-mix(in srgb, var(--accent-color, #58a6ff) 45%, transparent); }
.stage-ti {
  display: block; width: 100%; box-sizing: border-box; padding: 4px 8px; border: 0; border-radius: 6px;
  background: none; font: inherit; font-size: 0.8rem; color: var(--text-color, #c9d1d9); text-align: left; cursor: pointer;
}
.stage-ti:hover { background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent); }
.stage-older-btn {
  display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box; margin-top: 6px; padding: 5px 10px;
  border: 0; border-radius: 8px; background: none; font: inherit; font-size: 0.8rem; color: var(--text-secondary, #8b949e);
  text-align: left; cursor: pointer;
}
.stage-older-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--border-color, #30363d); }
.stage-older-btn[aria-expanded="true"] .stage-older-chip {
  border-color: color-mix(in srgb, var(--accent-color, #58a6ff) 55%, transparent); color: var(--text-color, #e6edf3);
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 12%, transparent);
}
.stage-older-caret { margin-left: auto; font-size: 10px; }
.stage-older { display: flex; flex-direction: column; gap: 1px; margin: 2px 0 0 0.5rem; padding-left: 0.5rem;
  border-left: 2px dashed var(--border-color, #30363d); }
.stage-older[hidden] { display: none; }
.stage-ahead { margin: 0.5rem 0.6rem; font-size: 0.8rem; color: var(--text-secondary, #8b949e); }

/* Journey: "Nächste Etappe ›" takes the 🔒 · 🤖 · 🏁 stations' place. */
body[data-stage-next] .journey > .jr-impl,
body[data-stage-next] .journey > .jr-fold,
body[data-stage-next] .journey > .jr-node,
body[data-stage-next] .journey > .jr-wire:not(.jr-wire-a) { display: none !important; }
.jr-next-stage { display: none; }
body[data-stage-next] .jr-next-stage {
  display: flex; align-items: center; flex: none; height: 36px; padding: 0 10px; border: 0; border-radius: 999px;
  white-space: nowrap; font: inherit; font-size: 0.72rem; font-weight: 600; cursor: pointer;
  color: var(--text-color, #e6edf3); background: color-mix(in srgb, var(--text-color, #c9d1d9) 7%, var(--panel-bg, #161b22));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color, #58a6ff) 55%, transparent), 0 2px 8px rgba(0, 0, 0, 0.3);
}
body[data-stage-next] .jr-next-stage:hover { box-shadow: inset 0 0 0 1px var(--accent-color, #58a6ff), 0 2px 8px rgba(0, 0, 0, 0.3); }
body[data-stage-next] .jr-next-stage:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: 2px; }
body[data-stage-next] .jr-next-stage:disabled { opacity: 0.5; cursor: default; }
```
