---
name: concept
version: 0.1.0
description: >-
  Generate an interactive HTML page for analysis, plans, concepts, prototypes,
  comparisons, or creative work — open it in the browser and monitor user
  decisions (toggles, selections, comments) to feed them back into the workflow.
  Triggers on: "concept", "concept page", "interactive plan",
  "show me this as a page", "visualize this".
  Also auto-suggest when Claude completes analysis, planning, comparison,
  or concept work that would benefit from interactive decision-making.
  Do NOT trigger for: simple code explanations, debugging
  (use /fix), or static documentation (use /setup-readme).
argument-hint: "[topic, analysis result, plan, or concept to visualize]"
allowed-tools: Read, Write, Glob, Grep, Bash(start *), Bash(cmd *), Bash(python *), Bash(curl *), Bash(kill *), Bash(node *), AskUserQuestion, CronCreate, CronDelete, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__plugin_devops_dotclaude-completion__*
---

# Concept

Generate an interactive HTML page for `$ARGUMENTS`, open it in the browser,
and monitor for user decisions.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/concept/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/concept/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 0.5 — Concept Mode (asked once, at the start)

Before Step 1 runs for the **first** iteration, settle which kind of
concept the user wants. Three modes exist:

| Mode | What the page is | Templates in scope |
|---|---|---|
| **decision** | Pure decision concept — non-visual alternatives to weigh (architecture, strategy, library, approach, …) | `decision` (plus `free` for surrounding analysis) — no mockups |
| **design** | Pure design concept — visual directions / mockups / click-dummies | `design` only — no decision views, no `decision` iteration |
| **mixed** | Both — the visual call AND the non-visual calls belong to the same concept | `design` iteration(s) carrying decision views where the question is *about the mock*, and/or a separate `decision` iteration where it stands on its own (entangled-questions rule in 1a) |

**Ask unless it is already obvious.** If the invocation prompt names the
mode, or it can be derived unambiguously — "design me the settings page"
→ design; "which auth library should we take" → decision; "concept for the
onboarding: the flow, the screens and which state library" → mixed; a
caller skill (e.g. `/tune-rethink`, `/setup-cleanup`) that pins the
template → that — **skip the question and proceed.** Otherwise ask exactly
ONE `AskUserQuestion` with the three modes, **mixed first and marked
"(Recommended)"**, one line of description each (what the page will
contain). Whenever the prompt allows two readings, lean towards mixed —
a decision-only page hides the visual consequences, a design-only page
hides the trade-offs behind the visuals. Do NOT prefix this question with
"Erstmal in Ruhe durchlesen" — no inline result precedes it. A typed
"Other" answer is a real answer (`{PLUGIN_ROOT}/deep-knowledge/decision-format.md`).

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

## Step 1 — Pick Template, then Content Variant

### 1a. Pick the template — per iteration

A concept page is a **stack of iterations**, and each iteration independently
picks its own layout **template** — `decision`, `free`, or `design`. This
check runs every time an iteration is created (the first one, and every one
appended later via tune/rethink/iterate) — it is NOT a one-time, page-level
decision. Iteration 1 may be a decision round, iteration 2 a fullscreen
design round, iteration 3 a decision round again; nothing forces the page to
stay on one template throughout.

Pick via the **strict ordered check below** — first matching template wins,
free is the explicit fallback when neither of the first two applies. Do NOT
skip the order; `free` must never be chosen while `design` or `decision`
would also fit.

**Order of evaluation (mandatory, per iteration):**

1. **Is this iteration primarily VISUAL?**
   The options this iteration puts up for decision are primarily visual —
   layouts, design directions, screen composition, visual arrangement, a
   click-through flow, screen-by-screen UI design, any "design me / sketch /
   lay out a UI" task. If the output needs maximum viewport real estate and
   per-screen (and, with 2+ competing designs, per-design) feedback →
   `design`. **Stop.**

   **`design` is almost always a click-dummy.** If a design has 2+ screens,
   the mockup's own buttons/links MUST be wired to navigate between screens
   (not just styled rectangles) — clicking "Continue" on screen 1 lands on
   screen 2, "Back" returns, etc. See `deep-knowledge/templates.md`
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

   **Optional annotation layer:** when Claude has a concrete, element-level
   question about a specific spot in the mock, pin it there instead of (or
   in addition to) the general feedback dock — see § Annotation Layer
   (optional) below. Skip it entirely when there is nothing that specific
   to ask; it is not a default addition to every design iteration.

   **Optional views:** alongside the ≥1 design, this same `design` iteration
   MAY also hold `section[data-view]` — fullscreen, non-visual questions
   with their own TOC entry, switched exactly like a design (see
   `deep-knowledge/templates.md` § Views (optional)). Two kinds ship as
   templates: `decision` (2..n named alternatives, bi-state per alternative)
   and `comparison` (2..n concrete candidates side by side, verdict per
   option, optional criteria matrix); count preference 7 per view (Step
   0.5). In **design** mode (Step 0.5) views are out of scope — the
   non-visual questions belong to a later `decision` iteration only when
   the user widens the mode. **Rule of thumb — view vs. its own
   `decision` iteration:** if the question is *about the artefact in front
   of the user* (they need to look at, or click through, the mock to answer
   sensibly) → a view inside this iteration. If the question stands on its
   own, independent of any one screen → its own `decision` iteration one
   round later. Views are never mandatory and never a substitute for the
   ≥1 design — an iteration that is only questions is a `decision`
   iteration, not a `design` one with zero designs.

2. **Are there ≥2 substantive non-visual alternatives?**
   Multi-option evaluation where the user must pick from 2+ mutually-exclusive
   alternatives (architecture, tech, strategy, library, approach, …). If there
   are explicit variants A/B/C with pros/cons to weigh → `decision`. **Stop.**
   Count preference: 7 alternatives compared (Step 0.5). In **design** mode
   (Step 0.5) this step is skipped — visual-only concepts do not get a
   `decision` iteration.

3. **Otherwise → FREE.**
   Only reach this step after 1 AND 2 have both been ruled out. Analysis,
   walkthrough, brainstorm, explainer, timeline, status deep-dive, retro,
   post-mortem — structured content that has no forced variant framing.
   Tri-state is opt-in per section (Claude adds it only where a finding
   genuinely needs user evaluation).

**Entangled questions split across iterations (the mixed mode, Step 0.5).**
If a concept's visual questions (which layout / design direction) and its
non-visual questions (which architecture / which library / which strategy)
are entangled, do NOT mix them into one layout. Split them: a `decision` iteration for the
non-visual call, a separate `design` iteration for the visual one. This is
the fix for the "same decision, written twice" failure — mockups do not fit
into 340px variant cards, so stop trying to fit them there.

| Template | Layout signature |
|---|---|
| **design** | Fullscreen content, overlay decision panel (☰ FAB top right, collapsed by default), speech-bubble feedback dock on the 💬 FAB bottom right (same 60px circle as ☰; collapsed by default; general / per-design / per-screen / per-view comments), design switcher when ≥2 designs; both FABs carry a locale tooltip (`title` + `aria-label`, swapped open/close) and the 💬 FAB pulses once until first use so it is not an unlabelled circle; view segments alongside it when ≥1 optional view (§ Views (optional)), device-view toggle bottom-left when ≥2 form factors |
| **decision** | Document column, variant cards, tri-state per variant; notes inline on the card |
| **free** | Document column, Claude-authored freeform body, optional tri-state per section; notes inline |

The ☰ panel is the same overlay in all three — it is page chrome, not part of
the layout, and it never moves between rounds (`deep-knowledge/templates.md`
§ Panel Chrome (all templates)). What differs per round is only where
feedback is written: the 💬 dock over a mockup, inline textareas in a
document round.

`design` is the canonical name; `prototype` is accepted as a legacy alias
(older pages/prompts) and is normalised to `design` — see
`deep-knowledge/templates.md` § `applyIterationTemplate()`.

**Template continuity — decide once, per concept.** The template belongs to
the concept, not to the mood of a round. Once a concept has rendered a
`design` round, every later round stays `design` unless the user asked for
something else — a non-visual question that comes up later (a refinement, a
reality-check collision) belongs in a `data-view-kind="decision"` view inside
a design round, not in a `decision` round of its own. The deliberate
exceptions are exactly two:
- the **mixed mode** of Step 0.5 above, where entangled visual and non-visual
  questions are split on purpose and the user knows why;
- the **final report**, which is always `free` — it is a document with a TOC,
  and the design layout (absolutely positioned sections, hidden
  `.iteration-intro`) is built for a mockup.

This is not a style rule. A `decision` round in a design concept swaps the
feedback surface underneath the reviewer: the 💬 dock disappears and the notes
move into the cards. That happened on real concepts — a reality-check round
appended as `decision` in a three-round design concept — and it reads as the
page breaking. Whatever you choose, **write it on the section**: an appended
round without `data-iteration-template` used to inherit whatever tab the
reader arrived from.

Set `data-iteration-template="..."` on each `<section data-iteration="N">` —
this is the **authoritative** value per iteration, and it is MANDATORY on
every section you append (regular round, reality-check round, final report).
`applyIterationTemplate()` copies the active iteration's value onto
`<html data-template="...">` on every `showIteration()` call, so `<html
data-template>` always **mirrors the active iteration** rather than being a
page-level constant. This projection is what lets `collectDecisions` and all
existing template-scoped CSS/JS keep branching on `<html data-template>`
unchanged. See `deep-knowledge/templates.md` for the full layout reference.

### 1a-ii. If template is `design`: declare the target form factors

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
`deep-knowledge/templates.md` § Responsive device views for what each of
those does once the screen is cloned into a frame.

### 1b. If template is `decision`: pick a content variant

The decision template has six content sub-variants that shape the variant
cards:

| Variant | When to use | Interactive elements |
|---------|------------|---------------------|
| **analysis** | Data analysis, metrics review, findings | Tri-state per finding, priority selectors |
| **plan** | Implementation plans, roadmaps, migration strategies | Checkboxes to approve/skip steps, effort tags, comments per step |
| **concept** | Architecture concepts, design proposals, feature specs | Tri-state per variant, rate options, comment fields |
| **comparison** | Technology comparison, option evaluation | Criteria matrix, weight sliders, winner selection, tri-state per option |
| **dashboard** | Status overviews, metric dashboards, health checks | Filters, toggles, expandable sections |
| **creative** | Brainstorming, ideation, mind maps | Add/remove ideas, grouping, voting |

Design and free templates have no sub-variants — their body is
content-specific (design = visual mockup(s); free = Claude-authored).

These are **recommendations, not rigid categories**. Mix elements across
variants, create hybrid layouts, or invent new structures when the content
calls for it.

## Step 2 — Generate HTML

Build a single self-contained HTML file. Requirements:

### Localisation (mandatory — do NOT hard-code German/English)

Read the `[ui-locale: xx]` hint injected by `prompt.knowledge.dispatch`. If
the hint is absent, infer from the user's chat language (the language they
are writing to Claude in THIS conversation). Then:

1. Set `<html lang="{locale}">` on the generated page.
2. Render every user-facing label (decision panel, buttons, feedback dock,
   screen counter, warnings, confirms, placeholders) from the matching
   column of the UI Locale table in `deep-knowledge/templates.md` § UI Locale.
3. If the user's locale isn't a column in the table yet (`fr`, `hi`, `ja`,
   `pt-br`, `zh`, …), Claude MUST translate every key inline at generation
   time and also append a new column to the table in `templates.md` so the
   next session has it cached. Fallback per-key: `en` value if translation
   is impossible.

User-authored content (concept title, subtitle, variant descriptions,
pro/con lists, mockup copy, finding text, …) is always in the user's
language — same rule, same locale hint. Do not mix languages inside one
page.

### Design
- Modern, clean design with dark/light mode toggle
- Responsive layout (works on any screen size)
- No external dependencies — all CSS/JS inline
- Professional typography, spacing, and color palette
- Subtle animations for interactions (toggle, expand, submit)

### Page Header (keep it lean)

The `<header>` inside `.concept-content` renders the concept title ONCE.

- `<h1>` with the concept title
- Optional: one short subtitle line for session context. Omit if not needed.
- Theme toggle button

**DO NOT** render the iteration title/intro in the page header — that
duplicates context and burns vertical space before the user reaches actual
content. The iteration title (e.g. "Iteration 3 · Visual design concept")
and its intro paragraph live INSIDE the active `<section data-iteration="N">`,
as a compact `.iteration-intro` block right after the opening tag.

### Decision Panel Layout

The panel itself is **not** template-specific: one 360px overlay, sliding in
from the right, toggled by the ☰ FAB in the top-right corner, in every
template (`deep-knowledge/templates.md` § Panel Chrome (all templates)). It
used to dock into a ~20% sidebar for `decision` / `free` rounds, which meant a
concept that mixed templates moved its panel — and the surface the user writes
feedback on — from behind the FAB into the page, mid-session.

What IS template-specific is only what the round adds around it:

| Template | Extras |
|---|---|
| **decision**, **free** | Comments are written inline, next to the card or section being judged |
| **design** | **Feedback dock** as a speech bubble anchored to the 💬 FAB bottom right, with general / per-design / per-screen / per-view comments; design switcher when ≥2 designs; `#screen-nav` gains a second group below the designs group, one entry per optional view (§ Views (optional)) |

A concept may mix the two freely from round to round — that choice is about
where feedback belongs, not about where the menu lives. The overlay already
works on mobile (`max-width: 90vw`); only the "you are here" head folds away
below 768px.

**Panel anatomy, top-to-bottom (identical across all templates — a flex
column of four parts; only part 2 scrolls, parts 1, 3 and 4 are pinned):**
1. **"You are here"** (`.panel-here`) — pinned head: the selected round's
   label ("Iteration 8 · aktiv"), the TOC entry under the reading line, and
   on a frozen tab a compact "↩ zur Runde N" link.
2. **The tree** (`.panel-nav-scroll`, `flex: 1; min-height: 0;
   overflow-y: auto`) — **iteration tabs** (`.iteration-tabs`, compact
   vertical chip list, one per iteration; active chip = current round, older
   chips stay clickable to review frozen snapshots) and the **section TOC**
   (`.section-nav`) — auto-populated from EVERY `<section id="…"
   data-nav-label="…">` inside the active iteration. Not limited to
   variants: Ist-Zustand, context blocks, design notes, mockups — anything
   with a nav label gets a scroll anchor here. At runtime the two are ONE
   tree ("Kompass"): `buildSectionNav()` moves `#section-nav` under the
   selected chip, writes a summary line ("14 Einträge · 3 verworfen") on
   every other chip, folds the chips before the live one into an archive
   from 4 previous rounds upward, and groups the TOC (Kontext / Varianten
   or `data-nav-group`) only when ≥2 kinds meet AND the round has >12
   entries. The HTML stays a flat chip list — see
   `deep-knowledge/iteration-rules.md` § The panel tree.
3. **Status line** (`.panel-status`) — ONE line, one glyph, six mutually
   exclusive states (saved / saving / connecting / local-only / submitted /
   frozen); the progress steps expand under it after a submit. See
   `deep-knowledge/templates.md` § Decision Panel State CSS.
4. **CTA foot** (`.panel-cta`, ≤120px) — the split button (primary +
   ▾ menu with the implement action), or the submitted / frozen /
   final-report block. Reachable without scrolling the panel, however many
   rounds or TOC entries the page has.

The iteration tab bar must NEVER live inside the left-hand content area.
The content area is reserved for the actual concept.

### Interactive Elements (per variant)
- **Toggles/checkboxes**: For binary decisions (accept/reject, include/exclude)
- **Selectors/sliders**: For prioritization, weighting, or rating
- **Comment fields**: Inline text areas for notes on each section —
  use `width: 100%` within their container, `min-height: 80px` for usability
- **Per-decision note textarea (MANDATORY for every `[data-decision]` group):**
  every Bi-State variant/finding card MUST carry an adjacent
  `<textarea data-comment="$decisionId-note">` so the user can attach a
  free-form override (e.g. "only for X", "with variant Y") to the include/
  discard choice. See `deep-knowledge/templates.md` § Comment Slot Injection
  for the HTML pattern, the `ensureCommentSlots()` JS safety net, and the
  rationale. Skipping this is the most common interactive-element regression
  — the user has nowhere to caveat their selection.
- **Submit button**: Prominent "Entscheidungen abschicken" button in the
  decision panel's pinned foot

### Evaluation Rules (by template) — bi-state

Variant/section evaluation uses a **bi-state selector** (not tri-state):

| Template | Evaluation behavior |
|---|---|
| **decision** | **Mandatory per variant card.** Every variant MUST carry the bi-state selector. |
| **design** | **No evaluation on screens.** Feedback on the mockups themselves is collected via the feedback dock (general + per-design + per-screen textareas). **Bi-state inside optional question views** — a `data-view-kind="decision"` or `"comparison"` view (§ Views (optional)) carries the same mandatory `[data-decision]` bi-state as the decision template; screens stay evaluation-free either way. |
| **free** | **Opt-in per section.** Claude decides per section whether user evaluation is useful; sections with an `eval-{id}` radio group get evaluated, plain sections just show content. |

**The two states:**

| State | Label | Behavior |
|-------|-------|----------|
| **Miteinbeziehen** | "Miteinbeziehen" (default) | Claude considers this variant/finding in the next iteration or implementation |
| **Verwerfen** | "Verwerfen" | Claude discards this variant/finding and excludes it from all further steps |

- Default: **Miteinbeziehen** for every variant/section
- No "Nur diese"/"only" option — the user implicitly picks a single option by
  setting all other variants to "Verwerfen"
- No "Claude setzt um" / "Feedback" hint labels — bi-state makes the intent
  self-explanatory, and the action-vs-feedback distinction is now handled by
  the two submit buttons, not the evaluation selector
- Each variant/section can ADDITIONALLY have rating, comments, and other controls

### Submit actions — iterate vs. implement

The decision panel always offers **two submit actions**, never one, as a
**split button**. A decision-panel submit by itself MUST NEVER trigger code
changes — that only happens when the user explicitly picks the implement
action from the menu and confirms.

| Button | Label (de / en) | Action | Style |
|---|---|---|---|
| Primary (`#submit-iterate-btn`) | "Zur nächsten Iteration" / "Next iteration" | `action: "iterate"` — Claude processes the feedback and appends a new iteration section (no code changes) | Fills the row, accent color; its hint is the `title` tooltip |
| Caret (`#submit-menu-btn`) | ▾ | Opens `#submit-menu` (`role="menu"`, `aria-expanded`); Escape / outside click closes it | Same accent pill, right end |
| Secondary (`#submit-implement-btn`, inside the menu) | "Mit Feedback implementieren" / "Implement with feedback" | `action: "implement"` — Claude applies the selections as actual code/file changes, after the `panel.submit_implement_confirm` dialog | Warning-colored border + ⚠ icon, one level deeper behind the caret |

The click-away handler in the feedback dock does NOT apply to these buttons
— they are explicit commits. The misclick barrier is colour + border + the
extra click, **not distance**: there is no gap in the ready panel, which is
what keeps the pinned foot at ≤120px (the `.submit-gap` survives only in the
final-report close-out sheet).

`collectDecisions()` adds `action: "iterate" | "implement"` to the payload
based on which button was clicked. Claude reads that field and either runs
another iteration (Step 5c) or executes code changes (Step 5b).

This applies to **all three templates** — even design (implement = "build
what we designed with the feedback") and free (implement = "act on the
findings I marked Miteinbeziehen").

### Design Feedback Dock

The design template has no tri-state. Instead, a **speech-bubble feedback
dock** anchored to the 💬 FAB (bottom-right) holds structured feedback:

- A top-level textarea for general notes on the concept
- One textarea per `data-design` (only when the iteration has ≥2 designs)
- One textarea per `<section data-screen>` inside the active design,
  auto-populated by the dock (label = `data-nav-label` of that screen)

The dock is toggled via the 💬 FAB and starts **collapsed** — the artefact,
not an empty form, is what a concept opens on. The FAB stays visible AND
clickable while the dock is open (clicking it toggles closed again). The
close button is a **minimise** (`−`), not a destroy: text content stays
intact in `localStorage` when the dock is closed.

Both FABs are labelled by **tooltip only** (`title` + `aria-label` from the
locale table, swapped between the open and close wording as the control
toggles) — no visible text, because a label inside the button would break the
shared circle. The 💬 FAB additionally carries `data-untouched="true"` for a
one-shot attention pulse (box-shadow/scale only, suppressed under
`prefers-reduced-motion`) that the JS clears on the first dock open or the
first keystroke inside the dock.

**Fixed chrome geometry — do not restyle per page.** Both FABs are one 60px
accent circle differing only in glyph and corner, and the open dock has
exactly two widths (compact 420px / wide 560px, picked by `applyDockSize()`).
Copy these verbatim; hand-tuning them per concept is what made the two FABs
different sizes and the dock alternately a mini-box and a full-width bar. See
`deep-knowledge/templates.md` § Template: design for the full HTML/CSS/JS and
the geometry rationale.

### Annotation Layer (optional)

A second, independent feedback channel for the design template: instead of
(or alongside) the dock's free-form notes, pin a numbered question directly
onto a concrete element of a screen — "should this list auto-refresh?", "is
this the right empty state?" — and the user answers it right there, next to
the thing it's about. **Use it only when there is a concrete, element-level
question to ask; it is not a default decoration on every design iteration.**
A screen with nothing specific to ask about simply has no
`[data-anno-layer]` — nothing degrades, nothing is missing.

- A pin sits on the element, connected by a short leader line to a speech
  bubble beside it. Collapsed, the bubble shows a truncated question line;
  clicking it (or the pin) expands to the full question, an answer
  textarea, and an attachment bar — any file type, drag & drop / Ctrl+V /
  picker, same as every other feedback field (`deep-knowledge/templates.md`
  § Attachments).
- The **eye pill** (top-left, directly below the screen-position indicator)
  toggles the whole layer for the whole page. It shows how many questions
  are open on the *current* screen and is the only thing left visible once
  the layer is hidden, so the user can always bring it back.
- **The ☰ and 💬 FABs are completely unaffected** — they keep working
  exactly as before, independently of whether the annotation layer is shown
  or hidden. The feedback dock stays the normal, always-available way to
  leave general notes.

See `deep-knowledge/templates.md` § Annotation Layer (optional) for the
full HTML/CSS/JS reference, the payload shape (`annotations[]`), and how a
frozen iteration keeps its annotations browsable and read-only.

### Views (optional)

A third, independent thing a `design` iteration may hold: fullscreen,
non-visual questions that belong in the SAME round as the artefact they are
about — `section[data-view]`, a top-level sibling of `section[data-design]`,
switched exactly like a design (its own switcher segment, its own second
`#screen-nav` group). Two kinds: `data-view-kind="decision"` (2..n named
alternatives, bi-state per alternative) and `data-view-kind="comparison"`
(2..n concrete candidates side by side, verdict per option, optional
criteria matrix — mandatory skeleton, free interior). See § Step 1a above
for when to use a view instead of a separate `decision` iteration, and
`deep-knowledge/templates.md` § Views (optional) for the full HTML/CSS/JS
reference and the payload shape (`decisions[].view`, `comments.views`).
**≥1 `data-design` stays mandatory** — views augment a design iteration,
they never replace it.

### Reload Resilience

The HTML page MUST persist interactive element state via `localStorage` (with
a 24-hour TTL) so that user selections survive page reloads, accidental tab
closes, and even browser restarts. Include the state persistence pattern from
`deep-knowledge/templates.md` § State Persistence in every generated concept
page. Theme preference is also persisted to prevent flash.

The `concept-submitted` class is NOT persisted — after a reload the page is
back to "not yet submitted" (correct behavior, the user can re-submit).

### Comments are never lost — the one non-negotiable

A concept round is hours of the user's thinking, typed into a page. Losing it
is the worst thing this skill can do, and it is worse than every rendering
defect combined, so the persistence engine is copied **verbatim** from
`templates.md` — never abbreviated, never "simplified for this page".

Four properties carry the guarantee (gate entries 49–53,
`deep-knowledge/validation-gate.md`):

1. **Nothing deletes the state blob.** No `localStorage.removeItem(STORAGE_KEY)`
   anywhere — not on TTL expiry, not on a page-version change, not on a panel
   reset. Stale state is pruned key by key; typed text is always kept.
2. **Typed keys are namespaced per round** (`text:i3:d1-s1`), so the shared
   feedback dock cannot show or overwrite one round's notes under another's.
3. **A frozen round is never persisted**, so browsing an earlier tab — which is
   what the tabs are for — cannot write its submitted answers over the live
   round's unsent ones.
4. **Every autosave is mirrored to the bridge** (`POST /draft`, fsynced before
   the ack, append-only log). That is the copy that survives a power cut, a
   wiped browser profile, and a Claude that has stopped answering mid-round.

When a user reports missing comments, the first action is always
`GET /draft?slug={slug}` and reading `recovered` back to them — never asking
them to retype. See `deep-knowledge/monitoring.md` § failure table.

### Page Version Tag

Set `data-page-version="{timestamp}"` on the `<html>` element (use the
ISO timestamp of generation, e.g. `2026-04-15T14:30:00`). This value is
stored alongside localStorage state. When the page version changes (new
generation), the stale half of the stored state (checkbox states, navigation
positions) is dropped so the user sees a clean new version instead of stale
selections from a previous page — but **everything the user typed is carried
over and restored**, with a strip on the page saying so, and the original blob
is archived under `{key}-archive`. A version bump is a reason to discard
selections, never a reason to discard comments.

**Rules:**
- Every iteration append (Step 5c): keep the SAME `data-page-version`
  → user selections on earlier frozen tabs survive the reload
- A fresh `data-page-version` is only ever set if the user explicitly
  starts a brand-new concept session for the same slug (rare — usually
  a new date means a new file anyway)

Additionally, the offline submit queue (`localStorage` key `{slug}-pending`)
caches decisions submitted while Claude is disconnected and auto-delivers
them when the connection is restored (see `templates.md` § Offline Submit Queue).

### Feedback Mechanism

The HTML page MUST include a feedback data layer:

```html
<!-- Hidden container for structured decisions -->
<script type="application/json" id="concept-decisions">
  { "submitted": false, "decisions": [], "comments": [] }
</script>
```

The submit button collects all interactive element states into this JSON
and adds the CSS class `concept-submitted` to `<body>`. This is the
signal Claude monitors.

**Submit button behavior:**
1. Collect all toggle/checkbox states → `decisions[]`
2. Collect all comment field values → `comments[]`
3. Set `submitted: true` in the JSON block
4. Add classes `concept-submitted` and `content-dimmed` to `<body>` and
   reveal `#content-dimmer` so the content area visually fades. The decision
   panel + FABs sit at higher z-index and stay clear + interactive. The
   dimmer is click-to-dismiss; otherwise it auto-clears on the next page
   reload (next iteration / final report). The same dimmer doubles as the
   **frozen veil**: `showIteration()` re-arms it on every non-live tab and
   shows the `#frozen-bar` floating pill with a back-to-live button (see
   `deep-knowledge/iteration-rules.md` § Rules, "Veil + floating bar").
5. Switch the decision panel from "ready" to "submitted" state — showing a
   clear "Entscheidungen übermittelt" indicator with a hint to switch to the
   Claude chat (see `deep-knowledge/templates.md` § Submit Handler)

**Decision panel states** (the foot + the pinned status line above it):
- **Ready**: split button active, decision summary visible; the status line
  reads "✓ Gespeichert · verbunden" (or "… Speichert" while the draft mirror
  flushes, "◐ Gespeichert · verbinde…" before the first heartbeat)
- **Disconnected**: the buttons stay ENABLED (a click is cached and delivered
  on reconnect, the cache badge on the button says so); the status line flips
  to the one categorically different state, "⚠ Nur lokal gespeichert ·
  getrennt" on a warning background (Claude heartbeat stale or three failed
  draft flushes — see `deep-knowledge/templates.md` § Claude Connection
  Heartbeat)
- **Submitted**: "Entscheidungen übermittelt" + "Wechsle zum Claude Chat"
  hint in the foot; the status line reads "⏳ Übermittelt · Claude arbeitet"
  with one progress dot per step (the step list expands under it)
- **Frozen** (any non-live tab): `#panel-frozen` with the back-link; the
  status line reads "🕘 Iteration N · nur lesen"
- After Claude processes and resets the page → back to **Ready**

### File Location

Write to: `docs/concepts/{timestamp}-{slug}.html`

**Fixed naming pattern** (both segments mandatory, in this order):

| Segment | Format | Example |
|---------|--------|---------|
| `{timestamp}` | ISO date `YYYY-MM-DD` | `2026-04-12` |
| `{slug}` | kebab-case topic summary, max 40 chars | `auth-middleware-redesign` |

Full example: `docs/concepts/2026-04-12-auth-middleware-redesign.html`

- Create the `docs/concepts/` directory if it doesn't exist
- The directory is git-tracked by default, but **individual concept files
  default to discard**. See § Disposition Control in
  `deep-knowledge/templates.md` and Step 6a. Concepts are project artifacts
  only when the user explicitly chooses "Im Projekt behalten" on the
  final-report panel; the default cleanup deletes both HTML and decisions
  JSON. Power users may also opt for "Nur lokal / .gitignore" to keep
  files locally without polluting the repo
- **One file per concept session** — all iterations live inside the same
  HTML file as separate `<section data-iteration="N">` blocks, switched via
  tabs in the decision panel (see "Iteration Tabs" below). There are no
  `-v2`, `-v3` files.
- If a file for the same slug already exists on the same day and the user
  starts a genuinely new topic, append a short disambiguator (e.g.
  `…-auth-middleware-redesign-2.html`) — do NOT treat this as a version bump.

### Iteration Tabs (single file, many iterations)

Every concept page is a stack of iteration tabs. The tab bar lives at the
**top of the right-side decision panel** (compact vertical chip list) —
NOT in the left-hand content area. Only the active iteration accepts input;
earlier ones are clickable but frozen. See `deep-knowledge/iteration-rules.md`
for the full rules (panel placement, freeze behavior, single-file invariant)
and `deep-knowledge/templates.md` § Iteration Tabs for the reference HTML.

### Post-Generation Validation (mandatory gate)

After writing the HTML file, grep it for every mandatory interactive
pattern listed in Phase 1 (heartbeat, all four panel states incl. the
frozen one, iteration tabs, section TOC, reload polling, generic
form-collection catch-all scoped to the active iteration, post-submit
content dimmer, persistent status channel + close-out sheet, etc.).
**If ANY pattern is missing → DO NOT open the page.** Fix the HTML first,
then re-validate. See `deep-knowledge/validation-gate.md` for the full
pattern list and common failure modes.

## Step 3 — Open in Browser

Open the generated HTML file **inside the user's existing Edge window** as
a new tab — NEVER open a separate browser window.

### MANDATORY — Real Edge browser only

The concept page MUST be opened in the user's **real Edge browser** via the
OS shell. **Forbidden alternatives** that will produce a broken session:

- ❌ **Never** use `mcp__Claude_Preview__preview_start` / `preview_*` to
  display the page. The preview pane is a sandboxed in-IDE iframe — it
  has no heartbeat connection, no cron polling, and the user cannot
  interact with it the way the concept flow needs. `mcp__Claude_Preview__*`
  is in `allowed-tools` ONLY for `preview_eval` during Step 5 page
  updates, never for opening the page.
- ❌ **Never** use `mcp__plugin_playwright_playwright__browser_navigate`
  to open the page. Playwright spawns its own browser instance — the user
  will not see it.
- ❌ **Never** print "Concept opened at file:///… open it in your browser"
  and stop. The bridge server requires the page to be loaded via
  `http://localhost:{port}/…`, not `file://`.
- ❌ **Never** bake a "copy the decisions JSON and paste it into the chat"
  block (clipboard button, `navigator.clipboard`, "In Zwischenablage
  kopieren", "füg es mir in den Chat ein") into the page. That manual
  handoff is the failure this whole flow exists to avoid — the live bridge
  already delivers decisions. The decision panel's two submit buttons +
  bridge are the **only** sanctioned mechanism, and the panel may never be
  omitted. The `post.concept.gate` hook blocks any page that violates this.

The **only** correct invocation is the OS `start`/`open` shell command
that hands the URL to the user's default Edge window, which then opens
a new tab. The exact command per platform:

```bash
# Build the URL ONCE. $PORT and $HTML_PATH must be set in THIS SAME Bash
# call — shell state does NOT survive across separate tool calls, so if you
# launched the server in an earlier call these are empty here and the URL
# collapses to "http://localhost:/" (the "concept url not found" symptom).
# Either re-set them in this call or inline the concrete port + path. The
# path is project-root-relative (the server's cwd), e.g.
# docs/concepts/{date}-{slug}.html — it MUST equal the --html value exactly.
URL="http://localhost:$PORT/$HTML_PATH"

# Gate the open on a real 200 — NEVER open a tab on a 404. This single check
# catches every cause of "concept url not found": wrong path (bare filename
# vs full relative path), a server cwd that does not contain the file
# (worktree/main-root mismatch), and empty $PORT/$HTML_PATH.
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$URL")
[ "$CODE" = "200" ] || { echo "Concept URL $URL -> HTTP $CODE (expected 200) - aborting open. Check the server cwd contains $HTML_PATH and that \$PORT/\$HTML_PATH are set in this shell."; exit 1; }

# Windows (this project's primary target)
start "" msedge "$URL"

# macOS
open -a "Microsoft Edge" "$URL"

# Linux
microsoft-edge "$URL" &
```

The empty `""` on Windows is required — without it, `cmd.exe` interprets
the first quoted argument as a window title.

**Computed-token check — between the 200 gate and the `start` (#346).** A
page can pass every grep and still open white: the design-token block is
swallowed when a `<style>` opens inside a `<style>` (engine CSS carried over
from an older page) or a stray brace ends `:root` early. `post.concept.gate`
and `validation-gate.md` § Phase 0b catch the tag structure; this step catches
what only a CSS parser sees. Load `$URL` in a headless browser context (the
Claude browser pane / Playwright — NOT the tab the user will get; this is a
read of the rendered CSS, no bridge interaction) and evaluate:

> **Verification tabs use their own browser profile — always.** Two tabs of
> the same profile share `localStorage`, and the page keeps its navigation
> state (`_activeView`, `_activeScreen*`, `_viewportMode`) there. A
> verification tab opened in the user's Edge profile therefore lands on
> whatever view the user is reading, and its own autosaves write its
> position back over theirs (#347). Playwright and the Claude browser pane
> run an isolated profile; a tab in the user's window does not. The bridge
> mirror is not the leak — `recovered` carries `text:` keys only, on both
> ends.

```js
getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim()
```

`--accent-color` is the token every page defines and the panel's split button,
chips and status line consume; the reference CSS itself defines no tokens, and
pages differ on `--bg` vs `--bg-color`, so those are not reliable probes. (A
page that uses a different accent name is one you authored — probe the token
your `:root` block defines.) Non-empty → proceed to `start`. Empty → do NOT
open the tab; regenerate the `<style>` block from `templates.md` § Layout
(exactly one `<style>` opener, closed before the next tag), re-run the gate,
re-check. Skip the check only when no browser tool is reachable at all — then
say so in the completion card's `userFinalTest` so the user knows the theme
was not verified.

**If the `start "" msedge …` command errors** (Edge not installed, not in
PATH), do NOT silently fall back to the preview MCP. Tell the user the
exact error and ask whether to try the Edge protocol handler
(`start microsoft-edge:"http://localhost:$PORT/…"`) or another browser
they prefer. The whole concept flow assumes a real, user-visible browser
window — there is no usable degraded mode.

### Concept Bridge Server + Edge

Start the bridge server (`scripts/concept-server.py`) on a port chosen via the
cross-session registry (`node scripts/concept-port-registry.js pick "<project-root>"`
— skips ports owned by another live concept session; see bridge-server.md
§ port selection), arm the combined heartbeat + auto-poll cron (fires every
minute, handles heartbeat + decision pickup + conditional reset), write
`.claude/concept-active.json` so a future SessionStart can rediscover this
concept, **send the first heartbeat AND verify it round-trips with a
non-zero `claude_ts`** (see `deep-knowledge/bridge-server.md` § Step 5 —
the read-back is mandatory; a naked POST leaves a dead-bridge failure
mode invisible until the user submits and gets no response), then open
the page in the user's existing Edge window using the exact command above.

**Then launch the two background tasks — the concept does not work without
them.** Both are the same script in two modes, `scripts/concept-watch.js`,
launched via the Bash tool with `run_in_background: true` (exact invocations in
`deep-knowledge/bridge-server.md` § step 3):

1. **Keepalive pulser** — POSTs `/heartbeat` every ~20 s for the whole session
   and never exits on a pending submission, so the connection indicator stays
   green even through a long `implement`.
2. **Pickup waker** — polls `/pending` every ~20 s and exits the instant a
   submission lands, which wakes Claude immediately.

The cron alone is NOT sufficient for either job: it fires only while the REPL
is idle and has multi-minute gaps in practice (observed: 638 s with the cron
registered and the session idle). It stays armed as the backup pickup path,
never as the primary one.

**Neither task — nor the bridge server — is pending work.** They run for the
whole concept and never yield a result; they are the waiting itself.
`stop.flow.guard` ignores them, and they must NEVER appear in a completion
card's `pending` field. See § Completion cards while the concept is open.

Pass the state file's **absolute** path via `--state`. The watchers used to
test a relative `.claude/concept-active.json` against their own cwd, which is
not always the project root the state file lives in — both then exited
`STATE_GONE` on their first iteration, which looks exactly like the bug they
prevent. They also tolerate the state file not existing yet (60 s grace), so
launching them here, before step 4 writes it, is safe.

**Capture the reality-check baseline right after writing the state file:**

```bash
node "{plugin-root}/scripts/concept-drift.js" --capture \
     --state "{project-root}/.claude/concept-active.json"
```

It records the default branch's current remote tip into the state file, which is
what the implement gate later diffs against (Step 5b step 0). Capture it at
concept open, not at first implement — a baseline taken minutes before the
implement click would show no drift at all, which is precisely the failure this
gate exists to prevent. In a repo with no remote the call is a silent no-op and
the gate stays disabled for the session; that is intended.

The state file (`port`, `html_path`, `slug`, `server_pid`, `cron_id`,
`started_at`, plus `baseline_ref` / `baseline_sha` / `baseline_captured_at`)
is what makes the concept survivable across Claude restarts:
the `ss.concept.resume` SessionStart hook reads it, verifies the bridge
is still running via `GET /heartbeat`, and tells the new session whether
to re-arm the polling cron or pick up an unprocessed submission. Without
the state file the new session has no way to know a concept was ever
opened — the polling cron is session-only and dies with the old session.

See `deep-knowledge/bridge-server.md` for the full setup — script lookup,
launch command, cron body, state-file schema, rationale for `/pending`
over substring checks, and cleanup ordering.

### After opening, inform the user:

Pick the wording that matches the `[ui-locale: ...]` hint injected by
`prompt.knowledge.dispatch.js` (defaults to `en`):

**en:**
> Concept opened. Make your decisions on the page and click
> "Submit decisions" when you're done — I'll take it from there.

**de:**
> Concept geöffnet. Triff deine Entscheidungen auf der Seite und klick
> "Entscheidungen abschicken" wenn du fertig bist — ich übernehme dann.

### Completion cards while the concept is open

Every turn that ends with the concept still open — right after opening the
page, after each processing round, after a stale wake — renders its completion
card with the `concept` field. That replaces the CTA of whatever variant the
turn earned (and outranks `pending`) with the one statement that is true:

| `concept.phase` | When | CTA (DE) |
|---|---|---|
| `waiting` (default) | Page is open, next step is the user's submission | `🧭 CONCEPT läuft. Warte auf deine Entscheidungen auf der Seite — ich MELDE mich` |
| `iterating` | A submission was processed and the next iteration is still being produced (e.g. by background agents) | `🧭 CONCEPT läuft. Arbeite an der nächsten Iteration — ich MELDE mich` |
| `implementing` | An `implement` submission is being executed and the turn hands back before it lands | `🧭 CONCEPT läuft. Arbeite an der Implementierung — ich MELDE mich` |

Real content work still goes into `pending` — a feature agent implementing the
submission, a research workflow preparing the next round — and the card folds
it into that line (`… mit 2 Agenten`) and names each item in the pending block.
The bridge server, keepalive pulser and pickup waker are **not** content work:
never list them there. A card that names them is the bug this field fixes.

The final card (Step 6b) carries no `concept` field: by then the bridge is
down and the concept is closed.

## Step 4 — Monitor via HTTP Bridge

The bridge server handles all communication — no JS eval injection needed.

**Heartbeat** is the keepalive pulser's job (Step 3, task 1), backed up by the
cron. Send an extra POST on any manual poll cycle:

```bash
curl -s -X POST http://localhost:$PORT/heartbeat
```

**Checking for a submission** — use `/pending`, not `/decisions`:

```bash
curl -s http://localhost:$PORT/pending
```

`/pending` is the only endpoint that acks a pickup: it stamps `_picked_up_at`,
which is what advances the "Claude verarbeitet" step in the page's submitted
panel. A poll of `/decisions` reads the same data but acks nothing, so the user
watches a progress list that never moves. Once `pending` is `true`, fetch the
full payload from `/decisions` and process it (Step 5).

**Polling schedule:**
- **Primary mechanism**: the **pickup waker** from Step 3. It exits the moment
  a submission lands, which wakes Claude — no user chat message required.
- **Backup**: the combined cron from Step 3, every minute — and only a partial
  one. It covers the window between the waker exiting and being re-launched
  ONLY while the REPL is idle, which is exactly when that window is not open:
  during a processing round the REPL is busy and the cron cannot fire. That is
  why 5c step 7 re-launches the waker immediately rather than leaving the gap
  to the cron.
- **Initial wait**: 10 seconds after opening, then one manual heartbeat +
  `/pending` check to close the gap before the first waker cycle lands.
- **No timeout** — monitoring runs indefinitely until the user ends it
  (says "fertig"/"done", closes the page, or closes Claude).
- **On demand**: if the user asks "did my submission arrive?", poll
  `/pending` manually — do NOT wait for the next tick.

**Important:** monitoring MUST NOT block the conversation, and it must not
depend on one either. The waker runs detached, so an idle turn keeps watching
on its own; a user who clicks submit and types nothing still gets picked up.
If the user sends an unrelated message, respond normally — the waker keeps
running and wakes you when the submission arrives.

## Step 5 — Live Feedback Loop

Feedback is processed **iteratively**, not as a one-shot. The cycle:

```
User submits → Claude reads → Claude processes → Claude updates page → User can act again
```

### 5a. Read & Parse
1. Read the JSON from `#concept-decisions`
2. Parse into structured decisions and comments
3. **Open every attachment — any file type, not just images.** A `decision`/
   `free` template comment may carry `attachments: [{id, name, mime, size,
   path}]` inline; a `design` template iteration instead carries a
   top-level `attachments` object keyed by slot (`general`, `design-{id}`,
   `{screenId}`, `view-{id}`, `anno-{id}`, `{decisionId}-note}` — see
   `deep-knowledge/templates.md` § Decision schema (design branch) — walk
   every key and treat each entry the same as an inline one. Both shapes
   are already persisted by the bridge at
   `.claude/concepts/{date}-{slug}/attachments/<id>` (§ Bridge server §
   Attachment HTTP contract). Read every one with the Read tool before
   acting on the comment it belongs to: text/code/markdown/JSON files read
   directly, images render inline, and for a format the Read tool cannot
   open (an archive, a binary office format) at least surface the filename
   and size to the user in your response rather than silently skipping it.
   A comment (or a design slot) can also be attachment-ONLY with an empty
   `text`; that is a complete remark, not an empty one, and skipping it
   because the text is blank silently discards the user's point.

**Coverage check:** before processing decisions, verify every named form
field that exists in the just-frozen iteration HTML appears in the
`decisions` payload (specifically the `allFields` catch-all). If a field
is in the DOM but missing in the payload, flag it to the user immediately
("the JS missed these fields, please re-submit after I fix the collection
function"). See `deep-knowledge/validation-gate.md` § Generic Form
Collection for the required pattern.

### 5b. Process & Act — branch by `action`

The submit payload carries an `action` field — `"iterate"` / `"implement"`
from an iteration panel, `"finalize"` from the final report's close-out
sheet. Branch on it:

**Checkpoint duty (all branches except `iterate`).** `implement` and the
issues / ship parts of `finalize` create real, externally-visible artifacts,
and any of them can be cut short mid-flight — a usage limit, a crash, a PC
restart.
POST a checkpoint to the bridge as each artifact comes into existence:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"action":"ship","step":"pr-opened","status":"done","version":<captured _version>,"artifacts":{"branch":"feat/x","pr":42}}' \
  http://localhost:$PORT/progress
```

Use `step` values that name what now exists in the world — `branch-created`,
`code-written`, `committed`, `pr-opened`, `merged`, `issues-created` (with the
numbers in `artifacts`) — not internal phases. A resumed session replays these
to learn how far the dead run got.

**Namespace the `action` for finalize parts:** `finalize:issues`,
`finalize:ship`, `finalize:cleanup` — never a bare `"ship"`. A bare `"ship"`
checkpoint is indistinguishable from a legacy stand-alone ship submission, and
a resumed session that reads it as one verifies the PR, calls the job done and
never runs part C — leaving the concept files, the durable store and
`.claude/concept-active.json` behind as a phantom resume hint.

**And on the receiving end: verify, never trust.** When you resume a run that
has checkpoints (`ss.concept.resume` hands you the mandate, or `GET /recovery`
shows them), establish the real state before acting — `git rev-parse --verify`
for a branch, `gh pr view <n> --json state,mergedAt` for a PR, `gh issue view`
for issues, and read the files for code changes. Then continue from what you
observed. Never re-create an artifact that exists, never re-merge a merged PR,
never re-run a completed step. The checkpoint records what the previous run
*believed* it had done, and it died for a reason.

**`action: "iterate"` (default — "Zur nächsten Iteration" button):**
1. **Summarize** what was selected/rejected/commented
2. **Do NOT modify code, files, or external systems** — iterate ONLY updates
   the concept page
3. **If the submitted section carries `data-reality-check`, advance the
   baseline** before appending — the user has just answered that drift, and a
   decision they made is never asked again:
   ```bash
   node "{plugin-root}/scripts/concept-drift.js" --capture \
        --state "{project-root}/.claude/concept-active.json" --sha <section's data-reality-head>
   ```
   The commit to pin is the one that round was generated from, and the round
   carries it itself in `data-reality-head` — so this works from a resumed
   session that never saw the check run.
   Skipping this is the one way the gate can feel like a loop: iterate once more
   after a reality check, click implement, and the same already-answered cards
   come back. The state file is not code and not an external system — this stays
   inside the iterate guarantee.
4. Proceed to Step 5c (append next iteration with refined options that
   reflect the Miteinbeziehen/Verwerfen choices)

**`action: "implement"` ("Mit Feedback implementieren" button):**

0. **Reality check — run this BEFORE writing anything.** The default branch may
   have moved since this concept was written, which would make the approved plan
   produce wrong, dead or duplicate code. Full procedure, force classes and
   resume semantics: `deep-knowledge/reality-check.md`. In short:
   - **Skip the check entirely** when the just-submitted section carries
     `data-reality-check` — that round WAS the check, and implementing from it
     goes straight through. This is what makes a second forced round impossible.
   - Otherwise `POST /status {"phase":"reality-check","version":$NOTED_VERSION}`
     (before the fetch, so the longer wait stays legible), then run
     `node "{plugin-root}/scripts/concept-drift.js" --state "{project-root}/.claude/concept-active.json" --paths "<paths the concept names>"`.
   - `verdict: "skip"` or `"clear"` → advance the baseline (`--capture --sha
     <advanceTo>`) and continue with step 1 below. Every unresolvable condition
     — no remote, offline, force-pushed baseline — lands here: the check never
     blocks an implement order.
   - `verdict: "candidates"` → apply the force classes. Nothing that must force
     → continue with step 1, mentioning the drift in the final report. Something
     must force → checkpoint `reality-check-forced`, then append ONE
     reality-check round instead of implementing (Step 5c) and stop. Do NOT post
     `phase: "implemented"` — no code was written.
1. **Summarize** what was selected/rejected/commented
2. **Execute** the decisions as real changes — **through the devops role
   agents, not inline.** An implement order is the one place in a concept
   session where code gets written, it is usually multi-domain, and the main
   session has a second job while it runs (heartbeat, `/status` POSTs,
   checkpoints). So dispatch it the way `run-agents` does: split the approved
   work by domain, hand each part to the agent that owns it — `devops:core`
   (services, data models, APIs), `devops:frontend` (UI, templates, styling),
   `devops:designer`, `devops:ai`, `devops:windows` — send independent parts
   in ONE message so they run in parallel, and let `devops:qa` verify while
   the rest finishes. `{PLUGIN_ROOT}/deep-knowledge/agent-orchestration.md` is
   the authority on who owns what and how wide to fan out. Give every agent
   the concept file path and the decisions it must honour, not a paraphrase.

   Doing it inline is the exception and needs a reason: a change small enough
   that one dispatch costs more than it saves (a one-line fix, a copy change).
   Take that exception when it applies, and name it in the final report.

   What the decisions mean per template — this is the brief you hand the
   agents, not a second implementation path:
   - For plans: implement the approved steps
   - For concepts: develop the chosen variant, archive alternatives
   - For comparisons: proceed with the implicitly-selected winner (all
     others marked Verwerfen)
   - For free-template findings: apply the Miteinbeziehen findings as fixes
   - For design iterations: build the designed UI/flow with the feedback applied
3. **Signal completion to the panel.** Right after the implementation work
   is done — and BEFORE the final-report append + `/reload` in Step 5c — POST
   the implemented phase so the submit panel's third progress step lights
   up while the user is still looking at it. Pass the `_version` noted in
   Step 5a so a stale worker cannot pin "implemented" onto a newer
   submission:
   ```bash
   curl -s -X POST -H "Content-Type: application/json" \
        -d "{\"phase\":\"implemented\",\"version\":$NOTED_VERSION}" \
        http://localhost:$PORT/status
   ```
   The server responds 409 if a newer `POST /decisions` has landed since
   Step 5a — in that case the user re-submitted and our implement work is
   superseded, so skip the rest of Step 5b (no /reload, no /reset) and
   loop back to Step 5a to fetch the new payload.

   The browser polls `/decisions` every 5 s and reads `_phase` from the
   response — so the ✓ next to "Implementierung abgeschlossen" appears
   within ~5 s. The subsequent `/reload` (Step 5c) replaces the panel
   with the final report shortly after.
4. After the implementation is done, append a **Final Report**
   (`Abschlussbericht`) section instead of a regular iteration. This is the
   closing artefact of the concept session — see Step 5c §
   "Final-report append (implement only)" for the structure.

**`action: "finalize"` (close-out sheet — only on the final report):**

The final-report panel is a **single close-out sheet**, not a wall of buttons
and not a step chain, so one submission carries every close-out decision the
user made:

```json
{ "action": "finalize",
  "issues":    { "create": true, "items": [ … ] },
  "implement": { "run": true,    "items": [ … ] },
  "ship":      { "run": true },
  "disposition": { "mode": "discard", "moveTo": null } }
```

`issues.items` and `implement.items` are **disjoint** and carry the same item
shape: the sheet gives every open point one of three routes — file it, build
it now, drop it — so a point is never in both buckets and a dropped one is in
neither.

**Zero-prompt invariant.** The user committed against the sheet's live plan,
which listed every consequence by name, in execution order, before they
clicked. Asking a follow-up question — for issue body, labels, milestone,
ship confirmation, anything — is
a UX regression equivalent to the old "paste the JSON from the console"
anti-pattern. Every field needed is in the payload OR derivable from the
concept HTML in `docs/concepts/{date}-{slug}.html`. If a field is genuinely
missing AND the project requires it, fall back to a sane default (silent) —
never an `AskUserQuestion`. The only justified interruptions are a hard `gh`
failure or a ship-pipeline gate failure that need the user's eyes.

**Fixed execution order — A (issues) → B (implement) → C (ship) → D
(cleanup).** Never reorder: issues are cheap and independent and must not
depend on anything else succeeding, the follow-ups the user chose to build
must land BEFORE a release rather than after it, ship is the one part that
can hard-fail, and cleanup can DELETE the concept HTML — running it before
the outward-facing parts would destroy the record while it is still needed.
Skip any part whose flag is false; a payload may legitimately carry none of
them (`ship.run: false`, `issues.create: false`, `implement.run: false`) and
then finalize is just Step 6.

**Checkpoint each part as it lands** (see Checkpoint duty above) — a finalize
that dies mid-flight must be resumable without re-creating issues or
re-shipping.

### A · Issues (`issues.create === true`)

1. Read the `items` array from `issues` — each entry carries
   `{ id, title, type, description, role?, module?, milestone?, selected: true }`.
   `description` falls back to the visible `.oq-label` text when the
   author of the final-report did not set `data-issue-body`; either is
   enough to skip prompting.
2. Read the `disposition` sub-object from the same payload and store it for
   part D. Do NOT apply it here — cleanup runs last, after ship.
3. **User-value gate (silent, mandatory).** Apply the gate from the
   `setup-issue` skill's `{PLUGIN_ROOT}/skills/setup-issue/deep-knowledge/issue-rules.md` to the
   selected items BEFORE creating anything: each issue must deliver a
   standalone user effect — direct (feature, visual, bug fixed, fewer
   crashes) or indirect (performance, stability, security). Items that
   only produce value in combination (file-level / layer-level tasks
   serving one use case) are **merged into ONE issue**: title = the user
   value they jointly deliver, original items as a checklist in the
   body. Merging is a silent sane default under the zero-prompt
   invariant — never an `AskUserQuestion`. Every resulting body carries
   a `**User value:** <effect>` line. Never emit a swarm of code-change
   tasks that only make sense together.
4. For each gated item, create the GitHub issue **directly via
   `gh issue create`** — do NOT invoke the `setup-issue` skill,
   which runs an interactive `AskUserQuestion` Step 1. Build the
   command from the payload + concept-extension labels (see § Project
   label enrichment below):

   ```bash
   gh issue create \
     --title "<item.title>" \
     --body  "<item.description>\n\n_Created from concept: docs/concepts/{date}-{slug}.html_" \
     --label "type:<item.type><,role:R><,module:M>" \
     [--milestone "<item.milestone>"]
   ```

   Capture the resulting issue number + URL from stdout. On `gh` error,
   abort this item, surface the error to the user, and continue with
   the remaining items — partial success beats silent loss.

5. **Project label enrichment (role / module).** Before calling `gh`,
   resolve project-specific labels in this order:
   - If `item.role` / `item.module` is set in the payload → use directly.
   - Else, check the project's `setup-issue` extension
     (`{project}/.claude/skills/setup-issue/reference.md` / `SKILL.md`)
     for the declared label sets. If the concept's slug, file paths, or
     final-report content unambiguously maps to exactly one role / module
     value → apply it.
   - Else → omit the label silently. NEVER ask. A minimal `type:*`-only
     issue is preferable to interrupting the user.

6. **Issue body composition.** Always end the body with a backlink:
   `_Created from concept: docs/concepts/{date}-{slug}.html_`. This is
   how the human reader (and future Claude session) recovers the
   originating context months later. Prepend whatever richer body the
   payload's `item.description` carries.

7. Update the final-report HTML: in the open-questions section, replace
   each created item's label with `[Issue #NNN] {title}` (linked to the
   issue URL), disable the checkbox, and add a small ✓ badge. For items
   that were merged by the user-value gate, link ALL source items to the
   one merged issue. Disabling is what makes the row disappear from the
   close-out sheet on the next render — an already-routed item can never be
   submitted twice.

### B · Implement the selected follow-ups (`implement.run === true`)

The points the user routed to "Jetzt umsetzen" are ordinary implementation
work that happens to arrive at close-out time. Build them exactly the way the
`implement` branch does — **through the devops role agents** (§ `action:
"implement"` step 2), never inline because the session feels like it is
ending.

1. Read `implement.items[]`. Each entry carries the part-A item shape
   (`title`, `type`, `description`, optional `role` / `module`); `role` and
   `module` are the strongest signal for which agent owns the work.
2. Dispatch by domain, independent items in parallel, `devops:qa` verifying.
   The user-value gate from part A does NOT apply here — it exists to keep the
   issue tracker free of fragments, and these items are being built, not
   filed.
3. Checkpoint each item as its code lands (`action: "finalize:implement"`,
   `step: "followup-implemented"`, the item id in `artifacts`). A resumed run
   must not rebuild what already exists.
4. Rewrite the item's `<li>` in the report the way part A does for issues:
   keep the checkbox, add `disabled`, append an `.oq-done` note
   (`{{final.done_prefix}}` + what landed). Disabling is what drops the row
   from the close-out sheet on the next render.
5. Add a short **Nachtrag** section to the final report naming what was built
   and where. Do NOT append a new iteration — the final report is the closing
   artefact and stays the last tab.
6. If an item cannot be built (it turns out to need a decision, or it breaks
   something), stop that item, leave its checkbox live, and say so in the
   Nachtrag. Never silently downgrade it to an issue: the user asked for code
   and has to see that they did not get it.

### C · Ship (`ship.run === true`)

1. Run the full ship pipeline via the `ship` skill (ship_preflight →
   ship_build → ship_version_bump → ship_release → ship_cleanup). The execute
   click authorises the ship; it does NOT waive the gates `ship` already
   enforces. If a gate blocks, report the blocker to the user and STOP —
   never fake a completion or force past a failing gate. (A force-push to
   main/master still requires explicit user confirmation per the user's own
   rules — the execute click does not stand in for that.)
2. **On a blocked ship, stop the whole finalize here.** Issues created in
   part A and follow-ups built in part B stand; part D does NOT run. POST
   `/reload` then `/reset`, leave the concept session open so the user can
   retry from the sheet, and report the blocker verbatim. Never fall through
   to cleanup — a `discard` disposition would delete the concept the user
   still needs.
3. On a successful release, rewrite the live final-report section in place:
   add a one-line "Shipped" note (version + tag) to the Zusammenfassung.

### D · Close out

1. **`keep` / `gitignore`:** add `data-closed` to the
   `<section data-final-report>` (the sheet renders its done state instead of
   re-arming — the bridge is about to be shut down, so a live execute button
   would queue a submission nobody picks up), then POST `/reload` so the
   browser shows the rewritten report (issue links, implemented notes,
   shipped note), and only AFTER that POST `/reset` with the captured
   `_version` —
   reload-before-reset, same order as every other branch.
   **`discard`:** POST `/reset` only, no `/reload`. The browser's reload poll
   runs on a 3 s interval and the file is about to be deleted, so a `/reload`
   here is a coin flip on whether the user's closing impression is the final
   report or an HTTP 404. The bridge shutdown that follows is the honest
   end-of-session signal.
2. Proceed to Step 6 with the `disposition` stored in part A step 2. Treat
   this submission as the explicit "fertig" signal from the user.
3. **Card selection:** if part C ran successfully, `ship` already rendered
   its own ship card — that is the authoritative closing artefact and you
   MUST NOT render a second concept completion card (duplicate summary).
   Otherwise render the concept card per Step 6b.

### Legacy final-report actions

Pages generated before the close-out sheet submit one action at a time:
`create-issues` (part A + Step 6 with the bundled disposition),
`ship` (part B + Step 6), `dispose-concept` (part C only). Keep accepting
them — a mid-session plugin update leaves such a page open in the browser —
and map each onto the matching part above. Newly generated pages MUST emit
`finalize` only.

**Critical invariant:** a submit with `action: "iterate"` MUST NEVER cause
code or file changes outside of the concept HTML file itself. The user
relies on that guarantee to explore ideas safely. Within `finalize`, part A
only writes GitHub issues + the final-report HTML and part D only disposes of
the concept's own artefacts — neither touches project code. Parts B and C are
the ones that reach further: B writes code, and only for the items the user
explicitly routed to "Jetzt umsetzen" (default: Issue, which writes nothing);
C reaches outside the repo, and only when `ship.run` is true, which has no
default at all. Both consequences are named on the sheet's live plan, in
execution order, above the single execute button.
### 5c. Update the Page
After processing, **append a new tab** to the same HTML file and signal
the browser to reload. This is the ONLY update path — there is no
separate "in-place edit" vs. "new file" distinction anymore.

For `action: "iterate"` → append a regular iteration section.
For `action: "implement"` → append a **final-report section** (one-time,
see § "Final-report append (implement only)" below).
For `action: "implement"` that Step 5b step 0 diverted → append a **regular
iteration section carrying `data-reality-check` and
`data-reality-head="<examined sha>"`** instead, with the
`{{iteration.reality_tab}}` label on its tab and the `.reality-banner`
explainer as its first child. Everything else about the append is identical to
a normal iteration, including the append checklist and the `/reset` ordering.
**It also keeps the concept's template** (§ Step 1a · Template continuity): in
a `design` concept the collision cards go into a
`section[data-view] data-view-kind="decision"` alongside the design the round
is about, NOT into a `decision` round — a gate that swaps the reviewer's
feedback surface mid-session reads as the page breaking.
**Read the file back and confirm both attributes landed before `/reload`** — a
marker that silently failed to write re-arms a check the user already answered.
See `deep-knowledge/reality-check.md` § The forced round.
For `action: "finalize"` → no new section; rewrite the existing final-report
HTML in place (linked `[Issue #NNN]` labels for routed items, a shipped note
when part B ran) and POST `/reload`.

Procedure on every iteration (including the very first response to feedback).

**Order matters — `/reset` is the LAST step, NOT the first.** Posting `/reset`
early stamps `_processed_at` on the server, which makes the browser's
`pollProcessedState` flip the panel back to "ready" before the new iteration
is on disk. The user then sees the still-active OLD iteration with
re-enabled submit buttons and can fire a duplicate submission. The new
iteration must be live in the browser BEFORE the server signals "processed".

1. Read the existing HTML file (same path, always).
2. Freeze the currently-active iteration section per the rules in
   `deep-knowledge/templates.md` § Freezing Past Iterations (authoritative
   source). In short: remove `data-active`, add `hidden`, disable every
   `input`/`textarea`/`select`/`button` inside the section, set `readonly`
   on text inputs and textareas, preserve the submitted values exactly
   (read them from the just-processed decisions JSON).
2.5. **Verify form collection coverage.** Read the existing JS for
   `collectDecisions()` (or its template-specific variant). Confirm it
   uses a generic `querySelectorAll('input, select, textarea')` scoped
   to `[data-active]`. If it uses hand-listed selectors instead, fix it
   NOW before appending the new iteration — otherwise the new section's
   fields will silently fail to upload at submit time. See
   `deep-knowledge/iteration-rules.md` § Procedure on every iteration —
   coverage gate and `deep-knowledge/validation-gate.md` § Generic Form
   Collection for the required pattern.
2.6. **Engine drift check.** Run `deep-knowledge/validation-gate.md` over
   the EXISTING page — the gate applies to the whole file on every append,
   not only at first generation. The page's shared engine (Attachments
   JS/CSS, § Layout CSS chrome rules, tab-switch JS) is whatever
   templates.md said on the day it was generated, and every later round
   re-uses it. If any engine entry fails (30b, 44, 46, 47, 48, 49–53, 54,
   56, 59–61, tab-switch), re-sync that whole block **verbatim from
   templates.md NOW**, before appending — otherwise the new iteration
   inherits the old defect and the user sees the same bug after updating
   the plugin. A page from before the Kompass panel (fails 56 / 59–61) gets
   the whole panel block — skeleton, § Layout, § Section Navigation,
   § Two-Button Submit — on this append, no opt-out (#344). See
   `deep-knowledge/validation-gate.md` § Engine drift on iteration append.
3. Append a new
   `<section data-iteration="{N+1}" data-iteration-template="…" data-active>`
   with the updated / next-round content. The template attribute is
   mandatory and carries the concept's template forward (§ Step 1a ·
   Template continuity) — a round that silently switches it swaps the
   reviewer's whole feedback surface (new variants, refined options, whatever
   the feedback produced). Set `submitted: false` in `#concept-decisions`,
   remove `concept-submitted` from `<body>`, re-enable the submit button.
4. Append a new entry in the `.iteration-tabs` bar for iteration N+1 and
   mark it active (set `aria-selected="true"`, remove that attribute from
   the previous tab — but keep the previous tab clickable so the user can
   re-read their frozen history).
5. POST to the bridge: `curl -s -X POST http://localhost:{port}/reload`.
   The browser's `pollReload` loop sees the counter bump and calls
   `location.reload()`. The reload lands on the new active iteration
   because the HTML declares it via `data-active`.
6. **Only now** POST `/reset` with the captured `_version` (see cron
   prompt in Step 3). This stamps `_processed_at` on the server as the
   final step. The browser's `pollProcessedState` is a safety-net —
   it will only restore the panel state when a reload counter advance
   has been observed OR a long stale timeout elapses. See
   `deep-knowledge/templates.md` § Panel State Reset for the polling contract.
7. **Immediately re-launch the pickup waker** (Step 5d) — right here, not
   after the rest of the round. `/reset` clears the pending flag and
   `/reload` has already handed the user a fresh panel, so from this moment
   they can submit again. Every second between here and the re-launch is a
   window with nothing watching, and the cron cannot cover it: it fires only
   while the REPL is idle, and processing an `implement` keeps the REPL busy
   for minutes.

The tab bar is anchored at the top of the right-side decision panel —
above the section TOC and the submit block. It must never appear inside
the left-hand content area. Render as a compact vertical chip list.

Do NOT write a redirect file. Do NOT create a new `-v{N}` file. The entire
concept session — first render, every iteration, "nochmal neu" reworks —
lives in the single `{date}-{slug}.html`.

### Final-report append (implement only)

When `action: "implement"` is being processed, step 3 of the procedure above
differs: instead of appending a regular iteration, append a **final-report
section**. Everything else (freeze previous, /reload, /reset, version
preservation) stays identical.

1. Freeze the previous iteration the same way (step 1–2 above).
2. Append a
   `<section data-iteration="{N+1}" data-iteration-template="free" data-final-report data-active>`
   to the same file. The `data-final-report` flag switches the panel to
   `panel-final-report` mode (no iterate/implement buttons — see
   `deep-knowledge/templates.md` § Final Report Panel). The template is
   **always `free`** and is never omitted: a report is a document with a TOC,
   the `design` layout is built for a mockup, and a section that declares no
   template used to inherit whatever tab the reader came from — the same
   report rendered two different ways depending on the route taken to it.
   The ☰ panel does not move with that choice (§ Panel Chrome (all
   templates)), so the reader keeps the menu they have used all session.
3. Inside, render a structured report with several `<section id data-nav-label>`
   blocks so the existing TOC auto-populates. Recommended structure
   (Claude picks which sections actually fit the concept):
   - **Zusammenfassung** — what was implemented in one paragraph + commit hash
   - **Geänderte Dateien** — bulleted list with brief rationale per file
   - **Tests / Verifikation** — what was run, what passed, what was skipped
   - **Offene Fragen & TODOs** *(optional, see below)* — checkbox list of
     things noted during implementation that were intentionally left out,
     bugs found but not fixed, doc gaps, future improvements
   - **Nächste Schritte** *(optional)* — recommendations for follow-up work
4. Append a new entry in the `.iteration-tabs` bar for the final report.
   **Tab label MUST be `iteration.final_tab`** (locale: "Abschlussbericht" /
   "Final report"), NOT "Iteration N+1". Mark it `aria-selected="true"` and
   carry `data-final-report` so the tab-bar JS can style it distinctly.
5. Set `submitted: false` in `#concept-decisions`, remove `concept-submitted`
   from `<body>`. The submit-button reset is irrelevant because the
   final-report panel doesn't surface iterate/implement at all.
6. /reload → /reset → **re-launch the pickup waker**, as steps 5–7 above.
   Step 7 is not optional here: the final-report panel still accepts the
   `finalize` submission, and `implement` is the longest round there is —
   leaving it unwatched is the widest window in the whole flow.

**Verbatim copy directive (mandatory):**
The final-report JS block — `refreshCloseout`, `renderCloseout`,
`openQuestionBoxes`, `followUpRoute`, `followUpItem`, `collectFollowUps`,
`collectIssueItems`, `collectImplementItems`, `collectDisposition`,
`closeoutShipChoice`, `buildFollowUpList`, `buildCloseoutPlan`,
`setCloseoutFrozen`, `restoreCloseoutToReady`, `submitFinalize`, plus the
`closeout-execute` / `view-iterations-btn` wiring, the `change` listener and
the `DOMContentLoaded` wiring — MUST be copied verbatim from
`deep-knowledge/templates.md` (the block starting at the comment
`// --- Final-report close-out sheet (action: "finalize") ---`). Do NOT
inline a simplified sheet, collapse it back into separate buttons, re-introduce
a step chain, or omit the event-listener wiring; any omission leaves a
visible-but-inert control or a flow the user cannot finish. After writing, the
post-generation validation gate (`deep-knowledge/validation-gate.md` Phase 1)
MUST find the panel-state and close-out patterns (28–38b) in the generated
file.

**Open questions / TODOs section — when to include:**

Include the `<section data-open-questions>` block only when there are real
items worth carrying past the concept — things you knowingly deferred, bugs
surfaced but out of scope, doc gaps, follow-up refactors. Each becomes one row
on the close-out sheet, where the user routes it to a GitHub issue, to
"jetzt umsetzen" (built during the close-out, part B), or to nothing. Write
`data-issue-body` for every item as if it were BOTH: an issue read cold in
three months and a brief handed to an implementing agent ten minutes later. Skip it
entirely (do NOT render an empty stub) when the implementation is
genuinely clean. The presence of this section is what adds the issues step to
the close-out sheet — see `deep-knowledge/templates.md` § Final Report Panel
for the HTML pattern. Default each `<input type="checkbox">` to `checked` so
the user opts items OUT rather than IN.

**No further iterations from the final report.** The panel deliberately
omits the iterate/implement buttons. If the user wants more work after
the final report, they can start a new concept session — that's a clear
new scope, not an additional iteration on a closed one.

### 5d. Resume Monitoring

**Re-launch the pickup waker.** It exited to wake you for the submission you
just processed, so nothing is watching `/pending` until you start it again —
exactly as in Step 3 (`bridge-server.md` § step 3, task 2), with
`run_in_background: true`. Do this at 5c step 7, the moment `/reset` lands; by
the time you reach 5d it should already be running.

**Before processing a wake, re-confirm.** Two wakers on the same port both exit
`PENDING_SUBMISSION`, and the second wake arrives after `/reset` has already
cleared the flag. Acting on it re-runs Step 5b — for `action: "implement"` that
means writing real code changes a second time, which no version guard catches
(`/reset`'s 409 only detects a *newer* submission). So on every wake, poll
`/pending` once before doing anything: `false` means the wake is stale — just
re-launch the waker and carry on. If it is `true`, compare `_version` against
the one you last processed: **equal means the previous round's `/reset` never
landed**, not that the user resubmitted. Retry the reset instead of running the
same payload again.

**One exception, and check it before applying that shortcut: `GET /recovery`.**
If a `reality-check-*` checkpoint sits on that same `_version`, the previous run
did not finish and simply fail to reset — it died mid-round, and the reset was
never due. Resetting there discards the user's implement click with no code, no
round and no error. Resume from the recorded verdict instead
(`deep-knowledge/reality-check.md` § Checkpoints and resume).

Skipping it is how a concept silently stops responding after iteration 1: the
page still shows a green indicator (the pulser keeps `claude_ts` warm), the user
submits again, and nothing picks it up until they ask in chat.

**Act on the exit reason.** A background task announces why it stopped; each
reason has exactly one correct response:

| Exit line | What happened | Do this |
|---|---|---|
| `WAKER_EXIT reason=PENDING_SUBMISSION` | A submission landed | Re-confirm via `/pending`, then process it (Step 5a) and re-launch the waker. A `false` here is a stale wake — re-launch and carry on |
| `WAKER_EXIT reason=SERVER_DEAD` / `PULSER_EXIT reason=SERVER_DEAD` | 4 consecutive failed polls — the bridge is gone | Restart the bridge server **on the same port** (do NOT pick a new one — the state file, the open tab and both watchers are all bound to it), then re-launch **both** tasks |
| `*_EXIT reason=STATE_GONE` | `.claude/concept-active.json` is gone — the concept ended | Nothing. Do not re-launch; the session is over |
| `*_EXIT reason=STATE_NEVER_APPEARED` | The launch outran the step that writes the state file | Write it, then re-launch. NOT the same as STATE_GONE — the concept is alive |
| `*_EXIT reason=PORT_CHANGED` | A newer concept took over | Nothing. This task belongs to a superseded session |
| No `*_EXIT` line at all | The task died without announcing why — bad arguments, a crash, `node` missing, killed | Do NOT assume the session ended. Verify the bridge with one `curl /heartbeat`, then re-launch both tasks |

Re-launch the pulser only when you actually saw a `PULSER_EXIT` — normally it
runs for the whole session and a second one on the same port is wasted work.

Then return to Step 4 (monitor for next submission). The loop continues until:
- The user closes the page
- The user says "fertig" / "done" in chat
- There are no more decisions to make (all items processed)

If the active section is the final report, the submission Claude expects is
`action: "finalize"` — one payload from the close-out sheet carrying
`issues` (open points routed to a GitHub issue), `implement` (open points the
user wants built now), `ship` (run the release or not) and `disposition`
(discard / keep / gitignore + optional moveTo). Legacy pages may
still send `ship`, `create-issues` or `dispose-concept` individually; map them
per Step 5b § Legacy final-report actions.

All other action types from the final-report panel should be treated as
protocol errors and reported back to the user.

### 5e. Persist
Write a cumulative summary to `docs/concepts/{same-timestamp}-{same-slug}-decisions.json`
after each iteration (append a new entry per iteration — don't overwrite
previous rounds; each entry records its `iteration` number).

## Step 6 — Completion Card

The feedback loop ends when the user is satisfied (user says "fertig"/"done",
closes the page, or all items are processed). Then **clean up the
bridge-server state** and render a completion card.

### 6a. Clean up the active-concept state — Cleanup-By-Disposition

Before rendering the completion card, dispose of the bridge server, its
state file, AND the on-disk concept artefacts. The on-disk steps depend
on the user's disposition choice (see `deep-knowledge/templates.md`
§ Disposition Control for the UI + payload shape).

**Determine the disposition** in this order of preference:

1. The `finalize` payload's `disposition` field → use it directly.
2. Otherwise, the last legacy payload (`dispose-concept`, then
   `create-issues`, then `ship`) that carried a `disposition` field.
3. Otherwise (no payload carried a disposition — old session, user
   aborted, page closed before finishing the close-out): default to
   `{ mode: "discard", moveTo: null }`.

The default = `discard` is deliberate. Most concept sessions are one-shot
refinements whose outcome already landed in commits / GitHub issues /
the implement step. Persisting the HTML in git by default accumulates
silt in `docs/concepts/`. Power users opt in to `keep` or `gitignore`
in the sheet's files block.

**Cleanup procedure (always):**

```bash
curl -s -X POST http://localhost:$PORT/shutdown > /dev/null 2>&1 || true
rm -f .claude/concept-active.json
```

Then `CronDelete <cron_id>`. `/shutdown` replaces the older `kill $SERVER_PID`:
on Windows the PID could already be reused by an unrelated process, and
swallowing `kill` errors hid that case. The HTTP endpoint targets the live
server by port and is a no-op when the server is already dead. Removing
`concept-active.json` is mandatory — if the file lingers, the next
SessionStart's `ss.concept.resume` hook will surface a phantom resume hint
pointing at a server that no longer exists. Even if `/shutdown` fails (server
already gone, port unbound), the watchdog terminates any surviving instance
within 30 s once the cron stops POSTing heartbeats.

**Apply disposition on the concept files.** Files are named
`docs/concepts/{date}-{slug}.html` and `docs/concepts/{date}-{slug}-decisions.json`
— always include the `{date}-` prefix in patterns; bare `{slug}` does
NOT match.

| `mode` | `moveTo` | Action |
|---|---|---|
| `discard` | (any) | `rm -f -- "<html>" "<decisions.json>"` — `moveTo` is ignored. |
| `keep` | null | No file change. Files remain at their original git-tracked path. |
| `keep` | set | `mkdir -p -- "<moveTo>"` then `git mv -- "<html>" "<moveTo>/"` (if tracked, else `mv -- "<html>" "<moveTo>/"`); same for the decisions JSON. Files remain git-tracked at the new path. |
| `gitignore` | null | Files stay at original path. Append `docs/concepts/{date}-{slug}.*` to `.gitignore` if not already covered. Run `git rm --cached -- "<html>" "<decisions.json>"` to untrack them if they were already added. |
| `gitignore` | set | `mkdir -p -- "<moveTo>"` then `mv -- "<html>" "<moveTo>/"`; same for the decisions JSON. Append `<moveTo>/{date}-{slug}.*` to `.gitignore` if not already covered. Run `git rm --cached -- "<original-html>" "<original-decisions.json>"` on the original tracked entries. |

**Also dispose of the durable store.** The bridge keeps every submission,
progress checkpoint and pasted image under
`.claude/concepts/{date}-{slug}/` (§ Durable store in `concept-server.py`).
It is deliberately gitignored and invisible, which is exactly why it needs an
explicit disposition step — otherwise pasted screenshots silt up forever in a
directory nobody looks at.

| `mode` | Store action |
|---|---|
| `discard` | `rm -rf -- ".claude/concepts/{date}-{slug}"` — journal and attachments go with the concept. Subject to the UNPROCESSED guard below. |
| `keep` | Keep the store. If it holds attachments, copy them to `docs/concepts/{date}-{slug}-attachments/` and `git add` them, so the kept record is self-contained instead of pointing into an ignored directory. Skip when there are none. |
| `gitignore` | Leave the store in place — it is already outside git. No extra `.gitignore` entry is needed beyond the blanket `.claude/concepts/` rule. |

**UNPROCESSED guard — never discard unseen work.** Before any `rm -rf` of a
store, check for `.claude/concepts/{date}-{slug}/UNPROCESSED`. Its presence
means a submission was made that Claude never finished processing, so the user
has not yet seen a result for it. Deleting that is the very loss this whole
mechanism exists to prevent, and a default-`discard` disposition (§ above:
`discard` is what an aborted session falls back to) would otherwise do it
silently.

```bash
store=".claude/concepts/{date}-{slug}"
if [ -e "$store/UNPROCESSED" ]; then
  echo "UNPROCESSED submission in $store — not deleting"
else
  rm -rf -- "$store"
fi
```

When the guard trips: keep the store, and report it as a `⏸ Rückfrage`-style
line in the completion card naming the directory, so the user can decide.
Never resolve it by deleting.

**Orphan sweep.** A store whose concept HTML no longer exists — the file was
deleted manually, a worktree was wiped, an older session never ran cleanup —
is an orphan. So is a `port-<n>/` store: a bridge started without `--html`
(older test runs did this, #342) anchors its store under that name, and no
`docs/concepts/port-<n>.html` ever exists, so the same rule catches it. Sweep
those whose `state.json` is older than 7 days, applying the same UNPROCESSED
guard to each:

```bash
for d in .claude/concepts/*/; do
  slug="$(basename "$d")"
  [ -e "docs/concepts/$slug.html" ] && continue          # live concept
  [ -e "$d/UNPROCESSED" ] && continue                    # unseen work — keep
  [ -n "$(find "$d/state.json" -mtime +7 2>/dev/null)" ] && rm -rf -- "$d"
done
```

**Safety rules:**

- `moveTo` is treated as a project-relative path. Resolve it relative to
  the project root (NOT the worktree root if you happen to be in one).
  Reject any path that resolves outside the project root, contains
  `..`, or is absolute — fall back to the non-`moveTo` branch and
  surface a warning to the user.
- All path-bearing shell commands (`rm`, `mv`, `git mv`, `git rm`,
  `mkdir`) MUST use the `--` argument terminator AND double-quote
  every path interpolation, so `moveTo` values containing spaces or
  shell metacharacters land as a single literal argument. Never
  inline a raw `{path}` substitution.
- `.gitignore` patterns use the FULL filename including the date
  prefix (`docs/concepts/{date}-{slug}.*`), NOT bare `{slug}.*` — the
  shorter pattern silently fails to match the timestamp-prefixed
  files this skill produces.
- Never delete a file that does NOT match the
  `docs/concepts/{date}-{slug}.*` pattern for THIS session's slug.
  Other concept HTML files in `docs/concepts/` belong to other
  sessions and MUST be preserved.
- The same applies to the store: `rm -rf` exactly
  `.claude/concepts/{date}-{slug}` and nothing else. A parallel concept
  session in another worktree has its own directory next to it, and a
  glob that catches it destroys a live bridge's state. Never
  `rm -rf .claude/concepts/*` outside the guarded orphan sweep above.
- `.gitignore` edits are append-only. Before appending, grep for an
  existing exact match (the full `docs/concepts/{date}-{slug}.*` line)
  — if it already exists, skip the append. Never rewrite or reorder
  the file.
- If `git rm --cached` errors because the file was never tracked,
  swallow the error and continue — the file is already in the right
  state for `.gitignore`.

**Reporting:** the completion card's `changes` array should include one
short line describing the disposition action that was applied (e.g.
"Concept-Files verworfen", "Concept-Files behalten unter docs/architecture/",
"Concept-Files in .gitignore aufgenommen"). Skip this line for the
default `discard` path when the user explicitly aborted the session
without ever opening the final-report panel.

### 6b. Render the completion card

Call `mcp__plugin_devops_dotclaude-completion__render_completion_card`:

| Situation | Variant |
|-----------|---------|
| Concept was the primary task (read-only result) | `analysis` |
| Concept submitted decisions → Claude executed code changes in Step 5b | `ready` (code edits happened) |
| Concept discarded / user aborted | `aborted` |

Pass: `variant`, `summary` (e.g. "Concept auth-middleware-redesign finalized"),
`lang`, `session_id`, `changes` (what the concept covered and which decisions
were acted on), and `state` when files changed. Do **not** pass `concept` here —
the concept is closed; that field belongs to the mid-concept cards only (Step 3
§ Completion cards while the concept is open).

Output the returned markdown VERBATIM as the LAST thing in the response —
nothing after the closing `---`.

If the concept is part of a larger task (e.g. called mid-flow from another
skill), skip the card and return control — the parent skill renders its own.

## Smart Trigger Rules

The concept skill should be **auto-suggested** (not auto-triggered) when:

1. Claude completes a **multi-option analysis** (3+ options with trade-offs)
2. Claude presents an **implementation plan** with 5+ steps
3. Claude delivers a **comparison** of technologies/approaches
4. Claude finishes **concept work** with multiple variants
5. Claude produces any output where **user decisions** are needed to proceed

**How to suggest:**
Append to the response: "Soll ich das als Concept-Seite aufbereiten?"

**When NOT to suggest:**
- Simple yes/no questions — just ask directly
- Single-option recommendations — no decision needed
- Code-only outputs — not suitable for HTML visualization
- User explicitly declined a concept page earlier in the session

## Rules

- Always self-contained HTML — no CDN links, no external resources
- Never include sensitive data (API keys, passwords) in the HTML
- Comment fields are optional — include only where comments add value
- Design quality matters — this is a deliverable, not a debug dump
- German UI labels (buttons, headers) unless project language says otherwise
- The HTML must be self-contained — no CDN or external fetch calls.
  Bridge server fetch calls (`/heartbeat`, `/decisions`) are the only exception
- Keep file size reasonable (< 500KB) — inline only what's needed
