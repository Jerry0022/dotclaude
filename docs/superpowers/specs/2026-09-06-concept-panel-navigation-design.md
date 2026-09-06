# Concept Decision Panel — "Kompass" Navigation, Pinned Foot, Split-Button CTA

**Status:** approved on the concept page (2 rounds, `implement` on round 2)
**Scope:** `/concept` skill reference (`deep-knowledge/templates.md`), its
rules (`SKILL.md`, `iteration-rules.md`, `validation-gate.md`) and the tests
under `plugins/devops/skills/concept/`.

## Problem

The decision panel is one scrolling column: iteration chips, then a flat TOC,
then the connection pill, then the two CTAs. With many rounds or a long TOC the
CTAs sit below the fold — the user scrolls the *menu* to find the call to
action. The status area is noise at rest ("Claude verbunden") and silent about
the thing the user wants to know: "is my work saved / delivered, or am I still
working?"

## Decisions taken on the concept page

Round 1 (all accepted): fold previous rounds only from 4 upward; group TOC
entries only when ≥2 kinds AND >12 entries; one-open applies inside the TOC
only; the scroll spy may open a group, never close one; status details stay in
the DOM (never tooltip-only); compact CTA block; implement in two phases
(foot + status first, folding second).

Round 2 (chosen direction **C3 · Kompass, Menü statt Abstand**; all five
details accepted): drop the hint line under the primary button (tooltip
instead); show progress dots only after submit; misclick barrier by colour +
border, not distance; the implement action lives one level deeper behind a
caret menu; the foot is hard-capped at ≤120 px in the smallest and largest
case alike.

## Panel anatomy (all templates)

```
.concept-decision-panel          display:flex; flex-direction:column; height:100vh
├─ .panel-here        (pinned)   "Iteration 8 · aktiv" / "› V4 Session-Broker"
├─ .panel-nav-scroll  (flex:1 1 auto; min-height:0; overflow-y:auto)
│    └─ nav.iteration-tabs       ONE tree: every .iteration-tab is a node header;
│         #section-nav           the active node's body (moved there by JS)
├─ .panel-status      (pinned)   one status line (+ progress dots after submit)
└─ .panel-cta         (pinned)   #panel-ready | #panel-submitted | #panel-frozen | #panel-final-report
```

`min-height: 0` on `.panel-nav-scroll` is load-bearing. The pin is structural
(flex split), not `position: sticky` inside the scroll box.

Mobile (`max-width: 768px`): the panel keeps `height: auto; max-height: 60vh`
so the flex split still works; `.panel-here` collapses into the status line.

Design template (overlay panel): `.panel-cta` reserves `padding-bottom:
calc(60px + 2rem)` so the pinned foot never sits under the 💬 FAB (60 px
circle, `bottom: 2rem`).

## "Kompass" tree — iteration tabs and TOC merged

- `nav.iteration-tabs` keeps its DOM contract: one
  `<button class="iteration-tab" role="tab" data-iteration="N">` per round,
  appended by string edit exactly as today (iteration-rules.md § append
  checklist is unchanged).
- `buildSectionNav()` renders `#section-nav` and **inserts it directly after
  the `aria-selected="true"` tab**, so the open node is always the round on
  screen. There is no code path that closes it — switching tabs moves it.
- Every non-selected tab gets a generated one-line summary
  (`<span class="iteration-tab-summary">14 Einträge · 3 verworfen</span>`)
  computed from that round's `section[id][data-nav-label]` and its
  `eval-*` radios. Reality-check and final-report tabs keep their glyph
  labels.
- **Fold from 4 previous rounds:** when ≥4 tabs precede the live one, they
  are wrapped by JS in `<details class="iteration-archive"><summary>N
  vorherige Runden</summary>…</details>`. The archive auto-opens whenever a
  frozen tab is selected. Below the threshold nothing is wrapped.
- **TOC grouping (phase 2):** kinds are inferred from the existing
  contract — a section with an `eval-{id}` radio group is a *Variante*,
  anything else is *Kontext* — with an optional `data-nav-group="…"`
  override on the section. Groups render as `<details class="nav-group">`
  only when ≥2 kinds are present AND the round has >12 entries; otherwise
  the list stays flat. One-open applies among `.nav-group` only; the
  listener is bound inside `buildSectionNav()` (the nav DOM is rebuilt on
  every tab switch). The scroll spy opens the group that holds the active
  entry and never closes anything; a manual close is honoured for 4 s.
- `revealNavItem()` returns early when `item.getClientRects().length === 0`
  (entry inside a closed `<details>`), so a hidden active entry cannot drag
  the scroll box to the top on every frame.

## Status line (`.panel-status`)

One line, one glyph, mutually exclusive states; `#connection-status` keeps
its id and `[data-state]` contract but moves here (outside `#panel-ready`),
and `checkClaudeConnection()` updates it in every panel state — it only skips
the *button* handling while `#panel-submitted` is visible.

| State | Line | Styling |
|---|---|---|
| saved (rest) | `✓ Gespeichert · verbunden` | success |
| saving (transient) | `… Speichert` | muted |
| connecting | `◐ Gespeichert · verbinde…` | accent, pulsing dot |
| not delivered | `⚠ Nur lokal gespeichert · getrennt` | warning **background**, categorically different |
| submitted | `⏳ Übermittelt · Claude arbeitet` + progress dots | accent |
| frozen view | `🕘 Iteration N · nur lesen` | warning text |

"Saved" is driven by the draft mirror: `queueDraftSync` → "Speichert",
successful `flushDraft` → "Gespeichert", `_setDraftHealth(false)` after 3
failures → "Nur lokal". `#status-steps` stays a real `<ol>` in the DOM
(hidden until submit); the dots are a compact rendering of the same
`data-state` values, and the list expands under the line via
`<details class="status-detail">`.

## CTA foot (`.panel-cta`, ≤120 px)

```
[ Zur nächsten Iteration            ][ ▾ ]   ← #submit-iterate-btn + #submit-menu-btn
   ▲ popover (hidden): ⚠ Mit Feedback implementieren — schreibt Code   ← #submit-implement-btn
                        Kein Code beim Primär-Button                    ← hint, muted
```

- `#submit-iterate-btn`, `#submit-implement-btn` keep their ids and handlers;
  the implement button now lives inside `#submit-menu` (`role="menu"`),
  toggled by `#submit-menu-btn` (`aria-haspopup="menu"`, `aria-expanded`).
  Escape / outside click closes it. The `panel.submit_implement_confirm`
  confirm dialog stays.
- No hint paragraph under the primary button; its text moves to `title`.
- `.submit-gap` is no longer used inside `.panel-cta` (it stays for the
  final-report wizard's execute button).
- `[data-cache-hint]` stays as an inline badge on the primary button and as
  a line inside the menu, still toggled by `_setCacheHints()`.
- `#panel-frozen` keeps `#back-to-live-btn`; `.panel-here` additionally shows
  a compact "↩ zur Runde N" link.

## Smallest case

One round, three sections: no archive `<details>`, no `.nav-group`, no
summary lines; the tree is one open node with three entries. The foot is
identical in height to the largest case.

## Tests

- `panel-anatomy.test.js` (new): flex split + `min-height: 0`; foot cap;
  FAB gutter in design mode; mobile `max-height`.
- `section-nav` tests: `#section-nav` sits after the selected tab; summary
  lines on other tabs; archive only from 4 previous rounds; groups only when
  ≥2 kinds and >12 entries; one-open bound inside `buildSectionNav`;
  zero-rect guard in `revealNavItem`.
- `panel-chrome` / `templates-reference` / `frozen-veil-bar` /
  `final-report-wizard` updated for the moved pill, the menu, and the kept
  ids (`panel-frozen`, `back-to-live-btn`, `status-steps`, `data-cache-hint`).
- `validation-gate.md`: new entries for `.panel-nav-scroll` + `min-height`,
  `#submit-menu-btn`, `.panel-status`, zero-rect guard; entry 3 reworded
  (pill lives in `.panel-status`).
