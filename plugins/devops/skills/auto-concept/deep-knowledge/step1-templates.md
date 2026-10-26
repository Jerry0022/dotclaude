# Concept steps 0.5–1 — mode question, count preferences, template authoring

Mode question, count preferences, per-iteration template choice, design authoring, form factors, content variants and mapping specs — execution detail of `SKILL.md` Step 0.5 and Step 1 (1a, 1a-ii, 1b, 1c), moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

## Step 0.5 · Asking, the do-batch start, count preferences

**Ask unless it is already obvious.** If the invocation prompt names the
mode, or it can be derived unambiguously — "design me the settings page"
→ design; "which auth library should we take" → decision; "concept for the
onboarding: the flow, the screens and which state library" → mixed; a
caller skill (e.g. `/do-run rethink`, auto-cleanup) that pins the
template → that — **skip the question and proceed.** Otherwise ask exactly
ONE `AskUserQuestion` with the three modes, **mixed first and marked
"(Recommended)"**, one line of description each (what the page will
contain). Whenever the prompt allows two readings, lean towards mixed —
a decision-only page hides the visual consequences, a design-only page
hides the trade-offs behind the visuals. Do NOT prefix this question with
"Erstmal in Ruhe durchlesen" — no inline result precedes it. A typed
"Other" answer is a real answer (`{PLUGIN_ROOT}/deep-knowledge/decision-format.md`).

**Started from do-batch (`--from=do-batch`).** The args carry the merged,
feasibility-checked plan of a collect run: the coverage list (`#1 … #N`
with dispositions), the plan, and the open decisions that made do-batch
route here instead of to do-run (do-batch Step 4.6). Iteration 1 is that
plan with every open decision as a decision item — conflicts ("#2 rot, #6
blau"), infeasible notes whose dependents need a new direction, analysis
requests; settled parts are shown as context, not re-asked. The `Bündel:`
section (bundles, owned files, interfaces, order) is shown as the plan's
structure and passed unchanged to the implement click. The mode
follows from the open decisions (all visual → design, none visual →
decision, both → mixed) — skip the question. Never drop a coverage line:
the list travels into the page unchanged. Implementation then runs through
the implement click (`auto-agents`), not through a second do-run.

The mode is decided **once per concept**, not once per iteration. Later
iterations (Step 5c) still pick their own template through the 1a check —
the mode only says which templates are in scope. Feedback that pulls the
concept the other way ("zeig mir das mal als Mockup" on a decision concept)
widens the mode silently; no second question.

### Count preferences — recommendations, not instructions

These keep the page scannable for the user. They are Claude's defaults,
not user instructions: an explicit count from the user always wins, and
Claude may deviate when the content genuinely demands it.

- **Decision concepts and decision/comparison views: prefer 7 alternatives**
  set against each other. Fewer when the problem honestly has fewer
  distinct answers — never pad with near-duplicates to reach seven. More
  than seven gets unreadable; fold minor variants into one card instead.
- **Design concepts: prefer 3 main designs**, each **clearly — even
  excessively — different** from the other two (unless the user asked for
  subtle variants). Show each design in its relevant states/screens
  (1a: "a screen is a logical state"). Fine-tuning within one direction is
  a later iteration's job, not designs 4 to 7.
- **Mixed concepts** combine both: 7 on the decision side, 3 on the design
  side.
- **Annotations: round 1 top 3 to top 7 per design; rounds 2+ at most 3 per
  changed screen** (unchanged screens and the overview get none; improved
  elements add an `.anno-bubble-improved` line, see templates-design-screens.md).
  Component-level questions
  are pinned onto the mock (Step 1a → Annotation layer); a view or a
  `decision` round never carries them.

## 1a · Per-iteration choice

A concept page is a **stack of iterations**, and each iteration independently
picks its own layout **template** — `decision`, `free`, or `design`. This
check runs every time an iteration is created (the first one, and every one
appended later via tune/rethink/iterate) — it is NOT a one-time, page-level
decision. Iteration 1 may be a decision round, iteration 2 a fullscreen
design round, iteration 3 a decision round again; nothing forces the page to
stay on one template throughout.

A `free` round that is a report or audit with several evaluable items opens
with an overview table carrying a recommendation column and jump links
(`templates-free.md` § Report / audit rounds).

## 1a · Design iteration authoring

   **`design` is almost always a click-dummy.** If a design has 2+ screens,
   the mockup's own buttons/links MUST be wired to navigate between screens
   (not just styled rectangles) — clicking "Continue" on screen 1 lands on
   screen 2, "Back" returns, etc. See `deep-knowledge/templates-design.md`
   § Template: design for the `data-screen-link` attribute pattern.

   **"Screen" is a logical state, not a full page.** A screen can be a
   distinct view (welcome → credentials → success), but it can also be a
   meaningful state of the same view (modal closed → modal open → form
   submitted, tab A → tab B, collapsed drawer → expanded drawer, empty
   list → populated list). Every state the user should be able to give
   feedback on separately becomes its own `<section data-screen>`.

   **Several competing visual directions** (e.g. 21 layout variants that
   don't fit a 340px card) are several **designs within the same `design`
   iteration**, each with its own `data-design` wrapper and its own 1..n
   screens (count preference: 3 main designs, distinctly different — see
   Step 0.5) — not variant cards, and not a second, duplicate "— visuell"
   pass through a `decision` iteration. See the Architecture spec
   (`docs/superpowers/specs/2026-08-03-concept-per-iteration-design-mode-design.md`)
   for the markup shape.

   **One visual topic per design set.** When a design concept has several
   independent visual topics (e.g. a sidebar layout AND an icon set), the
   designs of a round vary ONE of them; every other topic is held identical
   across the designs. Once the user has a favourite for a topic, it stays
   fixed and the next round varies the next topic. Bundling them forces the
   user, who already likes design 2's layout, to keep switching to designs 1
   and 3 just to compare their icons (seen in a 10-round title-icon concept).
   Do not add a second axis or a view to work around it — sequence the topics.
   Exception: topics that are genuinely coupled (a theme that restyles many
   elements at once) belong in one design together.

   **Two or more designs → overview attributes.** Every
   `section[data-design]` of a round with ≥2 designs carries
   `data-design-motto` (a 2–5 word slogan), `data-design-traits` (exactly
   three `|`-separated traits that are genuine differences to the OTHER
   designs — never something they all share), `data-design-icon` (a built-in
   icon name or an entity-escaped inline SVG — pick it thematically per
   concept, it is how the user tells the designs apart) and optionally
   `data-design-color` (never the accent blue), `data-design-overlay`
   (`tl|tr|bl|br|tc|bc`, default `bl` — the corner of the preview that hides
   the least) and `data-design-overlay-tone="warm"` (for a bluish preview).
   The iteration carries `data-design-set="alternatives"` whenever the
   designs are alternatives for the same thing (the usual case — one visual
   topic per round; only then the favourite ☆ exists) or `"topics"` when they
   show different topics. The engine builds the variant overview carousel,
   the header and the quick nav from them; the gate warns when one is
   missing. See `deep-knowledge/templates-design-views.md` § Variant
   overview (≥2 designs).

   **Single-screen, single-design (exactly one `data-screen`):** no
   screen-nav, no per-screen feedback textarea — the dock shows ONLY the
   general-notes textarea. A static single-screen design needs no
   click-dummy wiring. Do NOT invent artificial "screens" to justify the
   template; if the artefact has no meaningful secondary states, one screen
   is correct.

   **Design system:** the mockup MUST follow the project's existing design
   system (colors, typography, component shapes, spacing) unless the user
   explicitly asks for a different style in the request. Check
   `design-tokens.*`, `theme.*`, `tailwind.config.*`, Figma tokens via
   the design MCP, or the existing UI code before inventing a look.

   **Annotation layer — where component questions live:** every question
   about a *part* of a design (this list, that header, the empty state, the
   badge) is pinned onto that element as an annotation — pin, leader line,
   answer field — never lifted out into a view or a `decision` round. Per
   design pin in round 1 the **top 3 at least, top 7 at most**, ranked by how
   much the answer changes the design; below three the design is not being
   questioned enough, above seven the mock is wallpapered. From round 2 only
   the screens that changed get pins, **at most 3 each** (no floor — a small
   change may need one), never the overview; unchanged screens get none. See
   `step2-feedback.md` § Annotation Layer (optional). Skip the layer only when a design
   genuinely has nothing element-level to ask — a rare case, not the
   default.

   **Optional views:** alongside the ≥1 design, this same `design` iteration
   MAY also hold `section[data-view]` — fullscreen, non-visual questions
   with their own TOC entry, switched exactly like a design (see
   `deep-knowledge/templates-design-views.md` § Views (optional)).
   Three kinds ship as templates: `decision` (2..n named alternatives, bi-state per alternative),
   `comparison` (2..n concrete candidates side by side, verdict per
   option, optional criteria matrix) and `mapping` (many items assigned to
   the schematic UI elements of a design or to matrix targets — an
   assignment, not a choice; § Views (optional) → View kind `mapping`, rules
   in § 1c below); count preference 7 per `decision` / `comparison` view
   (Step 0.5). A fourth kind, `analysis`, is the **Lite** analysis — up to
   5 questions with their finding beside them, one at a time
   (§ 1b · Analysis results and decisions — Full vs Lite); prefer it over a
   bi-state `decision` view whenever a question rests on a finding. Any view, whatever its kind, MAY name the design it belongs
   to with `data-view-for="{designId}"` — the ☰ nav then nests it under that
   design instead of the flat views group. In **design** mode (Step 0.5) views are out of scope — the
   non-visual questions belong to a later `decision` iteration only when
   the user widens the mode. **Rule of thumb — view vs. its own
   `decision` iteration:** if the question is *about the artefact in front
   of the user* (they need to look at, or click through, the mock to answer
   sensibly) → a view inside this iteration. If the question stands on its
   own, independent of any one screen → its own `decision` iteration one
   round later. Views are never mandatory and never a substitute for the
   ≥1 design — an iteration that is only questions is a `decision`
   iteration, not a `design` one with zero designs.

## 1a · Orthogonality test

   Test before authoring: if the alternatives would collapse into
   "Design A / B / C", the view duplicates the dock — drop it. If an
   alternative only makes sense under one design, say so in ONE line on
   that alternative ("needed by Holotable") and leave the verdict on the
   design itself to the dock. The deterministic gate refuses the crudest
   form — an alternative labelled like a design of the same round
   (`deep-knowledge/validation-gate.md` P31); the rest is authoring
   discipline.

## 1a · Entangled questions and layout signatures

**Entangled questions split across iterations (the mixed mode, Step 0.5).**
If a concept's visual questions (which layout / design direction) and its
non-visual questions (which architecture / which library / which strategy)
are entangled, do NOT mix them into one layout. Split them: a `decision` iteration for the
non-visual call, a separate `design` iteration for the visual one. This is
the fix for the "same decision, written twice" failure — mockups do not fit
into 340px variant cards, so stop trying to fit them there. The split cuts
both ways: the `decision` iteration that follows a design round is bound by
the same orthogonality rule as a view (1a above). It does not open with a
recap of how the designs differed, does not carry variant cards that
restate those differences, and does not weigh in on which design should
win — the user already said that in the dock, and the design round's
per-design notes are the only place that verdict is read from. The
decision round's intro names the design the user picked in one clause at
most and then asks its own, design-independent question.

| Template | Layout signature |
|---|---|
| **design** | Fullscreen content, overlay decision panel (☰ FAB top right, collapsed by default), speech-bubble feedback dock on the 💬 FAB bottom right (same 60px circle as ☰; collapsed by default; general / per-design / per-screen / per-view comments), design switcher when ≥2 designs; both FABs carry a locale tooltip (`title` + `aria-label`, swapped open/close) and the 💬 FAB pulses once until first use so it is not an unlabelled circle; view segments alongside it when ≥1 optional view (`step2-feedback.md` § Views (optional)), device-view toggle bottom-left when ≥2 form factors |
| **decision** | Document column, variant cards, one decision per card in its mode (`decision-modes.md`; legacy: bi-state per variant); notes inline on the card; the 💬 dock (bottom right, same as design) holds the general note + attachments. With `data-analysis="full"` the round is the guided analysis flow instead (§ 1b · Analysis results and decisions — Full vs Lite) |
| **free** | Document column, Claude-authored freeform body, optional decision per section (a mode, or the legacy bi-state); notes inline; the 💬 dock holds the general note + attachments |

The ☰ panel and the 💬 feedback dock are the same overlays in all three —
both are page chrome, not part of the layout, and neither moves between
rounds (`deep-knowledge/templates-panel.md` § Panel Chrome (all templates)). What
differs per round is only what the dock holds and where the itemised
feedback is written: per-screen / per-design / per-view rows over a mockup,
inline textareas in a document round — the general note lives in the dock
in every round.

`design` is the canonical name; `prototype` is accepted as a legacy alias
(older pages/prompts) and is normalised to `design` — see
`deep-knowledge/templates-rounds.md` § `applyIterationTemplate()`.

## 1a · Why continuity

This is not a style rule. A `decision` round in a design concept swaps the
feedback surface underneath the reviewer: the dock folds down to its general
note and the itemised notes move into the cards. That happened on real
concepts — a reality-check round appended as `decision` in a three-round
design concept — and it reads as the page breaking (before #399 the dock
vanished outright, taking the typed note with it). Whatever you choose, **write it on the section**: an appended
round without `data-iteration-template` used to inherit whatever tab the
reader arrived from.

## 1a · Template projection

`applyIterationTemplate()` copies the active iteration's value onto
`<html data-template="...">` on every `showIteration()` call, so `<html
data-template>` always **mirrors the active iteration** rather than being a
page-level constant. This projection is what lets `collectDecisions` and all
existing template-scoped CSS/JS keep branching on `<html data-template>`
unchanged. See `deep-knowledge/templates.md` for the full layout reference.

## 1a-ii · Form factors

Before writing any mockup, decide which form factors the app or site being
designed actually ships on, and declare them on the iteration section:
`data-viewports="desktop tablet phone"` (the order is the click-cycle order),
plus `data-viewport-default` and `data-orientations` where they differ from
the defaults. Portrait and landscape are shown **side by side at once** in
tablet/phone mode, so a reviewer compares them without switching.

Derive the answer from evidence, not assumption — a responsive web app in
the repo, a mobile manifest, the user's own words ("app", "website",
"mobile-only"). When it is genuinely a desktop tool, declare nothing: the
toggle then never renders and the layout is exactly what it was before device
views existed. When it is phone-only, declare `data-viewports="phone"` and
the page opens straight into the phone frames.

Declaring device views constrains the mockup markup — no `<script>`,
`<canvas>`, `<style>` or `<iframe>` inside a screen, no `vh`/`vw` units, no
`position: fixed`, no `#id` selectors in mock CSS. See
`deep-knowledge/templates-design.md` § Responsive device views for what each of
those does once the screen is cloned into a frame.

## 1b · Content variants

The decision template has six content sub-variants that shape the variant
cards. Every question on any of them is authored in a decision mode
(`deep-knowledge/decision-modes.md`); the include / discard bi-state is legacy
(`templates-decision.md` § Bi-State Variant Evaluation).

| Variant | When to use | Interactive elements |
|---------|------------|---------------------|
| **analysis** | Analysis results and the decisions that follow from them | The guided **Full** analysis (`data-analysis="full"`) — § 1b · Analysis results and decisions — Full vs Lite |
| **plan** | Implementation plans, roadmaps, migration strategies | `multi` for the steps in scope, `order` where sequence matters, effort tags, comments per step |
| **concept** | Architecture concepts, design proposals, feature specs | `single` across the alternatives (never N bi-states), comment fields |
| **comparison** | Technology comparison, option evaluation | Criteria matrix (Scorecard / Vergleichstabelle from `analysis-palette.md`), `single` for the winner, `slider` for a weight |
| **dashboard** | Status overviews, metric dashboards, health checks | Palette displays, filters, expandable sections; `verify` where a status needs confirming |
| **creative** | Brainstorming, ideation, mind maps | `multi` to keep ideas, `wording` for names, grouping |

Design and free templates have no sub-variants — their body is
content-specific (design = visual mockup(s); free = Claude-authored). Both
may embed a **Lite** analysis (§ 1b · Analysis results and decisions — Full
vs Lite).

These are **recommendations, not rigid categories**. Mix elements across
variants, create hybrid layouts, or invent new structures when the content
calls for it — but a question is always a decision in its mode.

## 1b · Analysis results and decisions — Full vs Lite

Before writing a single decision or analysis display, read
`deep-knowledge/decision-modes.md` and `deep-knowledge/analysis-palette.md`
completely (SKILL.md Step 1b-ii names both). Markup, payload and gate rules:
`templates-analysis.md` and `validation-gate.md` § Analysis & decision modes.

**Which variant.**

| Situation | Variant | Shape |
|---|---|---|
| The concept's content IS analysis results + the decisions that follow (an audit, a measurement, "where do the tokens go", a findings review) | **Full** — `data-analysis="full"` on a `decision` round | Briefing → one Themenfeld after another → one decision per stage → Review → Nächste Runde |
| A few questions come up inside another concept — a design round, a prototype, a plan — and need their finding beside them | **Lite** — `data-analysis="lite"` (a `data-view-kind="analysis"` view in a design round, or a section in a `decision` / `free` round) | L1 + L3, one decision at a time with progress dots, **≤ 5 decisions** |
| More than 5 such questions | Full, as its own round | — |

Lite never gets topics or a briefing; Full never hides inside a design round.

**The briefing (Full).** It reads top to bottom: **Analyse** (1–2 sentences,
what was analysed and found) → **Potential** (one prominent number, e.g.
"≈ 51 M Tokens", as a `kpi`) → the **Themenfelder** as chips linked to the
potential by connector lines (`data-share` = their part of it) → the
**"Los geht's"** CTA that names the duration ("≈ 6 min"). The motivation is
short and punchy — two sentences at most, no "was wir gemessen haben"
sub-header, no "Deine drei Themenfelder" heading, no level numbers. A Full
without what / why / potential fails the gate (A1).

**Themenfelder.** At most **3** per Full with at most **7** decisions each —
3 and 7 are the golden numbers (gate A4 warns beyond). Group by what the
decisions change, not by where the finding came from. Topic colours are never
red, green or orange (status colours); `analysis-palette.md` § Style rules.

**Every decision** carries the anatomy of `decision-modes.md` § Anatomy: a
real question, Gilt für, the finding it rests on (L3), outcome label +
consequence per option, recommendation + why, preselection = recommendation.
The mode comes from `decision-modes.md` § Which mode?. Timing is never a
decision; deferring is the "Als Issue anlegen" link.

**Kurz / lang per level.** The level the reader is on is long, the others
short; one level long at a time.

| Level | Title (`data-title`) | Short | Long |
|---|---|---|---|
| L1 · Briefing / overall | the briefing's stepper name | the potential as KPI or mini graphic + 1 sentence | the overall display (e.g. Wirkungsmatrix, Rangbalken per topic) + 2–4 sentences — shown in the briefing, collapses after it, reopenable |
| L2 · Themenfeld (Full only) | the topic's stepper name | always the topic's **result**, never its progress | the display that shows what the topic's problem is made of (e.g. Wasserfall) + 2–4 sentences |
| L3 · this decision | the decision's stepper name | after deciding: the answer in a sentence | undecided: the finding; decided: the consequence of the chosen option |

Short = one sentence (≤ 140 characters) + KPI or mini graphic, strongly
preferring the mini graphic whenever there is a number; no number →
Formatierter Text. Long = one palette display + 2–4 sentences, never scrolls;
evidence goes into `data-evidence` (opens as popup). Display choice, slot
budgets and custom-type rules: `analysis-palette.md`.

## 1c · Mapping spec rules

A mapping (`section[data-mapping]` in a `free` round, or a
`data-view-kind="mapping"` view in a `design` round) is rendered entirely by
the engine from one JSON spec — Claude writes the wrapper, the heading /
intro, the spec and (free rounds only) the note textarea; never a cell, a
state input or a control. Field table and grammar:
`deep-knowledge/templates-mapping.md` § Information Mapping (engine) → Spec. Rules:

- **A proposal is mandatory.** Pre-fill `proposal` for every matrix — the
  user corrects an assignment, they do not build one from zero. In a later
  round the proposal is the user's previous `assigned` (§ 5b).
- **Ids:** `^[a-z0-9_]+$` for every id (mapping, item, element, part, axis,
  column, context value — all engine-checked). `group` is a label, not an
  id: group strings are rendered verbatim as headers. Item ids matching
  `u\d+` are reserved for ad-hoc items and rejected by the engine. Mapping
  ids are unique page-wide (they become DOM ids and TOC anchors) and equal
  the wrapper's `id`; item / element / axis ids unique per mapping, part
  ids per element.
- **Count preferences (recommendations, like 7 / 3 in Step 0.5):** ≤ 60
  items, ≤ 20 targets per matrix, ≤ 4 context values per mapping. Beyond
  that, split into several mappings rather than one dense grid.
- **Tiers:** `tier: "after"` only for parts that are genuinely behind a
  click (detail sheet, expanded row); everything visible at first glance is
  `"first"`.
- **`accepts: "one"`** for single-value slots (badge, title);
  multi-value slots use `min` / `max`.
- **`elements`** when the targets are UI parts of a design (schematic view
  + matrix), **`axes`** when they are plain columns (matrix only); both may
  coexist in one spec, each matrix gets its own tab.
- A mapping subpage in a design round MAY name its variant with
  `data-view-for="{designId}"` — the ☰ nav nests it under that design.
- **Labels are content:** no `{{…}}` locale tokens, and never the literal
  `</script>` inside a label — the HTML parser would end the JSON block.
- **Note channel per home:** in a design round there is NO inline note —
  the dock's view note (`view-{id}`) is the mapping note. In a free round
  the inline `textarea[data-comment="map-{m}-note"][data-attachable]` inside
  the section is mandatory (gate rule M5).
