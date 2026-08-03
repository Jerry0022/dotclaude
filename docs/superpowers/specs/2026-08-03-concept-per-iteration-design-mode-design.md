# Concept — Per-Iteration Layout & Fullscreen Design Mode

*Date: 2026-08-03 · Skill: `plugins/devops/skills/concept`*

## Problem

Fullscreen design-concepting is unreachable in practice. Two rules force every
concept that mixes design directions with mockups into the sidebar `decision`
layout:

1. `skills/concept/SKILL.md:93` — tie-breaker: *"A page with variants AND
   mockups (rare) is a `decision` with inline mockups, not a `prototype` —
   prototype is reserved for single-artefact presentation."*
2. `skills/tune-rethink/SKILL.md:138` — *"Invoke `concept` (decision
   template). Each approach is a variant."* Hard-wired.

Observed failure: a concept page with 21 variants rendered as `decision`, where
the layout options `A1/A2/A3` appear **twice** — once conceptually with
pros/cons, once again labelled `— visuell` — because mockups do not fit into
340px variant cards. The same decision, written twice.

Second gap: even when `prototype` *is* chosen, it models `concept → screens`.
There is no notion of several competing **designs**, each owning its own set of
pages.

## Goal

A concept is a stack of iterations. **Each iteration independently picks its own
layout** — `decision`, `free`, or `design` — in any order, as often as needed.
Iteration 1 may be a decision round, iteration 2 a fullscreen design round,
iteration 3 a decision round again.

The `design` layout gives the entire viewport to the mockup, carries several
designs per iteration (each with 1..n pages), and collects feedback on three
levels: general, per design, per page.

## Non-goals

- No fourth template with duplicated layout/JS. `design` is the existing
  `prototype` path, extended.
- No variant tri-state inside the design layout. Non-visual decisions belong in
  a `decision` iteration, not squeezed into the overlay panel.
- No change to the bridge server, submit protocol, or persistence contract
  beyond additive payload fields.

---

## Architecture

### Per-iteration layout

`data-template` on `<html>` stays as the single source of truth *for CSS
selectors and JS branches*, but becomes a **projection** of the active
iteration rather than a page-level constant:

```html
<html data-template="decision">              <!-- mirrors the ACTIVE iteration -->
  <section data-iteration="1" data-iteration-template="decision" data-active>
  <section data-iteration="2" data-iteration-template="design" hidden>
  <section data-iteration="3" data-iteration-template="decision" hidden>
```

`data-iteration-template` on the section is authoritative. A new
`applyIterationTemplate(section)` copies its value onto
`document.documentElement.dataset.template` and is called from `showIteration()`
(`templates.md:3546`) **before** `buildSectionNav()` — every existing CSS rule
(`.concept-layout[data-template="design"]`) and JS branch
(`collectDecisions`, `templates.md:2632`) then works unchanged.

**Canonical value is `design`.** `prototype` is accepted as a legacy alias and
normalised to `design` inside `applyIterationTemplate()` (one line), so existing
pages such as `2026-06-03-sc-org-vereinsseite.html` keep working.

If `data-iteration-template` is absent, fall back to the `<html data-template>`
value written at generation time. Pages generated before this change keep their
current behaviour with zero edits.

### What the switch toggles

| | `decision` / `free` | `design` |
|---|---|---|
| Layout | grid `1fr 340px` | fullscreen, `overflow: hidden` |
| Panel | docked, always visible | overlay behind ☰ |
| ☰ FAB | absent | **top right** |
| 💬 FAB | absent | bottom left |
| Feedback dock | absent | present, three levels |
| Design switcher | absent | ghost bar, top centre, only when ≥2 designs |
| Body scroll | normal | locked |

The switch is CSS-driven off `<html data-template>`; `applyIterationTemplate()`
only sets the attribute and locks/unlocks `body` scroll. No layout code runs per
iteration beyond that.

### Frozen design iterations

A frozen `design` iteration stays navigable: design switcher and page navigation
keep working (the user must be able to revisit mockups), textareas are
`readonly`, submit is not armed. Same freeze rules as
`iteration-rules.md:24`, with navigation explicitly exempt from the
`disabled`-everything sweep — freeze must skip `.design-switch-item`,
`.screen-nav-item`, `#panel-toggle`, `#feedback-toggle` and `#feedback-close`.

---

## The design layer

### Markup

```html
<section data-iteration="2" data-iteration-template="design" data-active>
  <section data-design="dispatch" data-nav-label="Dispatch and Apparatus" data-design-active="true">
    <section id="d1-s1" data-screen data-nav-label="Übersicht" data-screen-active="true">
      <div class="device-frame">…mock…</div>
    </section>
    <section id="d1-s2" data-screen data-nav-label="Detail" hidden>…</div>
  </section>
  <section data-design="holotable" data-nav-label="Holotable" hidden>
    <section id="d2-s1" data-screen data-nav-label="Übersicht" data-screen-active="true">…</section>
  </section>
</section>
```

Rules:

- Exactly one `data-design` carries `data-design-active="true"`; the others are
  `hidden`.
- Within the active design, exactly one `data-screen` carries
  `data-screen-active="true"`.
- Each design remembers its own last-viewed page. Switching away and back
  returns to that page, not to page 1.
- **One design** → degenerates to today's behaviour: no switcher, no per-design
  feedback field. The `data-design` wrapper is still required so the markup
  shape stays uniform.
- `data-screen-link` click-dummy wiring (`templates.md:874`) is scoped to the
  active design — a link may only target screens within its own design.

### Design switcher — ghost bar

Top centre, horizontally centred, `top: 0.75rem`. Must never collide with the ☰
FAB (top right) or the screen indicator (top left).

- **Resting state:** `opacity: 0.18`, backdrop blur, the active design's label
  only, no separators, no background fill. Deliberately barely there — the
  viewport belongs to the mockup.
- **On hover / keyboard focus:** transitions to `opacity: 1` over 160ms and
  expands to the full segmented control (one segment per design).
- Focus-visible must reveal it for keyboard users; it is not hover-only.
- Hidden entirely when the iteration has fewer than two designs.
- Auto-hides while the ☰ panel is open (the panel carries the same navigation).

### Screen indicator

Extended from `Screen N / Total · Label` to carry the full position, since the
iteration tabs live inside the now-hidden panel:

```
Iteration 2 · Dispatch · Seite 1 / 3 · Übersicht
```

The iteration segment renders only when the concept has more than one
iteration; the design segment only when the iteration has more than one design.

### Panel navigation

`screen-nav` becomes two-level: a design heading per `data-design`, its pages
nested beneath. The existing `●` unsubmitted-notes marker applies at both
levels — a design heading shows it when any of its pages or its own design-level
field carries unsubmitted text. Clicking either level switches and closes the
panel, as today.

Panel content is otherwise **unchanged** from what `templates.md:961-1023`
already renders: iteration tabs, connection pill, submit-iterate,
submit-implement, submitted progress list.

---

## Feedback dock

### Three levels

```
┌─ Feedback ──────────────── − ┐
│ Allgemein                    │  data-comment="general"
│ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ │
│ ──────────────────────────── │
│ Zu Design: Dispatch          │  data-comment="design-{id}"
│ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ │  data-design-comment="{id}"
│ ──────────────────────────── │
│ Zu Seite: Übersicht          │  data-comment="{screen-id}"
│ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ │  data-screen-comment="{screen-id}"
└──────────────────────────────┘
```

One hidden textarea per design and per screen; only the ones matching the
current position are visible. Same swap mechanism the screen textareas already
use (`templates.md:1042`). The design row is omitted when the iteration has one
design.

Order is general → design → page: the stable field sits at the top so it does
not jump when the user navigates.

### Open by default, closes on first interaction

`data-open="true"` at load. It closes automatically on the **first** of:

- a click anywhere inside the mockup (`.device-frame` or any `data-screen`),
- a design switch,
- a page switch.

After that first auto-close the dock behaves exactly as today — manual toggle
via 💬 only, never auto-closing again. A `data-auto-close-armed` flag on the
dock tracks this; it is cleared on first fire.

Auto-close must **not** trigger on clicks inside the dock itself, on either FAB,
or on the design switcher.

The auto-close is not applied to frozen iterations (nothing to type there, the
dock opens read-only for review).

### FAB positions

- ☰ `panel-fab`: **top right** (`top: 2rem; right: 2rem`) — was
  `bottom: 2rem; right: 2rem` (`templates.md:1133`).
- 💬 `feedback-fab`: unchanged, bottom left.

Moving ☰ out of the bottom-right corner **simplifies** the dock geometry: the
current bubble reserves horizontal space for the ☰ FAB
(`right: FAB.right + 56 + 1rem`, `templates.md:1181`) and lifts itself above the
FAB on narrow viewports (`templates.md:1257`). Both reservations are removed —
the dock may now span to the right edge minus a normal margin. The
`transform-origin` anchoring to the 💬 FAB stays.

Verify at 1280px, 768px and 375px that dock, switcher, indicator and both FABs
do not overlap.

---

### Locale keys

Localisation is mandatory (`SKILL.md` § Localisation) — nothing below may be
hard-coded in German or English. Existing `proto.*` keys (`templates.md:109-115`)
are reused under a `design.*` namespace, with the `proto.*` names kept as aliases
so legacy pages resolve. New keys required:

| Key | en | de |
|---|---|---|
| `design.feedback_design` | Notes on this design | Anmerkungen zu diesem Design |
| `design.feedback_design_placeholder` | Write a note on this design… | Notiz zu diesem Design… |
| `design.switch_label` | Switch design | Design wechseln |
| `design.position` | Iteration {i} · {design} · Page {n} / {total} | Iteration {i} · {design} · Seite {n} / {total} |

`proto.feedback_general` currently reads "General notes on this **prototype**".
Reword to "on this concept" / "zu diesem Konzept" — with several designs on
screen, "prototype" no longer names the thing being commented on.

### Single-design collapse

The existing `body[data-single-screen="true"]` mechanism (`templates.md:1278`)
gains a sibling `body[data-single-design="true"]`, set by the same wiring pass.
It hides the design switcher and the design feedback row via CSS only — no JS
branching, matching how single-screen is already handled.

## Payload

`collectPrototypeDecisions()` (`templates.md:1567`) is renamed
`collectDesignDecisions()` and extended. Additive only — existing consumers keep
working:

```json
{
  "submitted": true,
  "template": "design",
  "iteration": 2,
  "decisions": [],
  "comments": {
    "general": "…",
    "designs": { "dispatch": "…", "holotable": "…" },
    "screens": { "d1-s1": "…", "d1-s2": "…" }
  }
}
```

`comments.screens` keeps the existing flat screen-id keying, so no consumer
needs to learn the design nesting to read page feedback. The dispatcher at
`templates.md:2632` reads the active iteration's template instead of
`<html>`'s — behaviour is identical whenever a page has one iteration.

The generic collection gate (`iteration-rules.md:59`) still applies: collection
must stay a `querySelectorAll('input, select, textarea')` scoped to
`[data-active]`, never hand-listed selectors.

---

## Selection rules

### `skills/concept/SKILL.md`

- Step 1a becomes **per-iteration**: the ordered check runs when an iteration is
  created, not once per page.
- The tie-breaker at `:93` ("variants AND mockups → decision") is **deleted**.
  It is the direct cause of the observed failure.
- New wording for step 1: if the options an iteration puts up for decision are
  primarily visual — layouts, design directions, screen composition, visual
  arrangement — the iteration is `design`. If they are ≥2 substantive
  non-visual alternatives → `decision`. Otherwise → `free`.
- Add: a concept whose visual and non-visual questions are entangled should
  **split them across iterations**, not mix them into one layout.
- `:98` updated: `data-template` on `<html>` mirrors the active iteration;
  `data-iteration-template` on each section is authoritative.

### `skills/tune-rethink/SKILL.md:138`

No longer hard-wired to `decision`. Rethink emits the approaches as one or more
iterations, each picking its layout by the rule above — visual design directions
land in a `design` iteration with real mockups instead of being flattened into
variant cards.

### `deep-knowledge/validation-gate.md`

`:7`, `:145`, `:213` — validate `data-iteration-template` on every
`section[data-iteration]`, and `<html data-template>` matching the active
section. Missing `data-iteration-template` is a warning (legacy fallback), a
mismatch between `<html>` and the active section is an error.

---

## Testing

The concept skill has no unit-test harness; verification is the existing
`validation-gate.md` gate plus a rendered page opened in the browser.

1. **Regression:** open `2026-06-03-sc-org-vereinsseite.html` (legacy
   `prototype`, no `data-iteration-template`). Must render and navigate exactly
   as before.
2. **Mixed concept:** generate a three-iteration page — decision, design (2
   designs × 2 pages), decision. Verify each tab switches the layout, the dock
   appears only in iteration 2, and the panel docks/undocks correctly.
3. **Freeze:** submit iteration 2, append iteration 3, click back to tab 2.
   Mockups navigable, textareas read-only, submit not armed.
4. **Payload:** fill all three feedback levels, submit, inspect
   `#concept-decisions`. Every textarea from the active iteration must appear.
5. **Viewports:** 1280 / 768 / 375 — no overlap between dock, switcher,
   indicator and FABs.

## Risks

- **`showIteration()` is load-bearing.** It already drives panel state, section
  nav and the final-report gate. Adding the layout switch there is correct but
  must not reorder the existing calls — `applyIterationTemplate()` runs first,
  everything else keeps its order.
- **`templates.md` is 3899 lines.** The design-layout section must be edited in
  place, not appended, or the file grows a second competing description of the
  same layout.
- **Legacy pages.** Anything relying on `<html data-template>` being constant
  breaks if the projection is not set before first paint. `DOMContentLoaded`
  already calls `showIteration()` (`templates.md:3583`); the initial value
  written at generation time must already match the active iteration so there is
  no flash of the wrong layout.
