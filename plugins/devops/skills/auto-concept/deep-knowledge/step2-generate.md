# Concept step 2 — engine source, page anatomy, submit actions

Engine source, localisation, design defaults, panel layout and anatomy, interactive elements, evaluation rules and submit actions — execution detail of `SKILL.md` Step 2, moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

## Engine source

Mock CSS in a round's `<style>` is namespaced per design (`.d1-…`) and never
names an engine chrome class — the panel, FABs, dock, tabs and frames belong
to the engine's head stylesheet (templates-design-wiring.md § Design layout rules → Mock
CSS is namespaced; gate P32, #400).

The page's **engine** — the Kompass panel skeleton, § Layout CSS, § Section
Navigation JS, § Claude Connection Heartbeat, § Two-Button Submit, § State
Persistence, § Attachments, the viewport switcher — is copied **verbatim from
the template parts of the plugin running this session** (`deep-knowledge/templates.md`
lists all `templates-*.md` parts in reading order; the engine spans all of
them), every time a page is generated. Older concept pages in `docs/concepts/` (this
project's or any other) are **content references only**: read them for
tone, tokens, the project's CSP line and how a mockup was built — never lift
their `<style>`, `<script>` or panel markup. A page assembled that way opens
with whatever engine that older page had on the day it was generated (seen
2026-09-20: a fresh page on the current plugin with a months-old panel — no
rounds chip, no viewport toggle, no freeze-aware heartbeat), and every fix
shipped since is silently missing. `post.concept.gate` blocks such a page as
**STALE ENGINE** (engine-currency markers, `hooks/lib/concept-gate.js`
`ENGINE`); the fix is to re-sync the whole engine from templates.md, not to
add the missing tokens by hand. `scripts/build-concept-fixture.js` assembles
an engine-current skeleton from templates.md when a starting point is
wanted.

## Localisation, design, page anatomy, submit actions

### Localisation (mandatory — do NOT hard-code German/English)

Read the `[ui-locale: xx]` hint injected by `prompt.knowledge.dispatch`. If
the hint is absent, infer from the user's chat language (the language they
are writing to Claude in THIS conversation). Then:

1. Set `<html lang="{locale}">` on the generated page.
2. Render every user-facing label (decision panel, buttons, feedback dock,
   screen counter, warnings, confirms, placeholders, and the mapping
   engine's `map.*` strings — view toggle, tier labels, palette filters,
   counts, status line, reset / copy / add item, "Added by you", violation
   texts, the frozen-without-`submitted` banner) from the matching
   column of the UI Locale table in `deep-knowledge/templates-common.md` § UI Locale.
   `map.*` cells are substituted into single-quoted JS literals
   (`MAP_LOCALE`), so a locale cell that lands in a JS literal contains no
   `'`, no backtick and no backslash — a new column follows the same rule.
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
- Modern, clean design, **dark by default** (`<html data-theme="dark">`; a
  project `reference.md` may override the default).
- The dark/light theme toggle is a quiet emoji button in the ☰ panel's head
  row next to the ✕ (templates-utilities.md § Theme Toggle) — the same control on every
  template, never in the content column, never a FAB.
- Responsive layout (works on any screen size)
- No external dependencies — all CSS/JS inline
- Professional typography, spacing, and color palette
- Subtle animations for interactions (toggle, expand, submit)

### Page Header (keep it lean)

The `<header>` inside `.concept-content` renders the concept title ONCE.

- `<h1>` with the concept title
- Optional: one short subtitle line for session context. Omit if not needed.
- Nothing else — no controls. (The dark/light switch lives in the ☰ panel
  head, see § Design above.)

**DO NOT** render the iteration title/intro in the page header — that
duplicates context and burns vertical space before the user reaches actual
content. The iteration title (e.g. "Iteration 3 · Visual design concept")
and its intro paragraph live INSIDE the active `<section data-iteration="N">`,
as a compact `.iteration-intro` block right after the opening tag.

### Decision Panel Layout

The panel itself is **not** template-specific: one 360px overlay, sliding in
from the right, toggled by the ☰ FAB in the top-right corner, in every
template (`deep-knowledge/templates-panel.md` § Panel Chrome (all templates)). It
used to dock into a ~20% sidebar for `decision` / `free` rounds, which meant a
concept that mixed templates moved its panel — and the surface the user writes
feedback on — from behind the FAB into the page, mid-session.

The same holds for the **💬 feedback dock** (#399): one speech bubble anchored
to the 💬 FAB bottom right, in every template, holding the general note (with
attachments) — the design round adds its itemised rows above it. What IS
template-specific is only what the round adds around the two:

| Template | Extras |
|---|---|
| **decision**, **free** | Itemised comments are written inline, next to the card or section being judged; the dock is `compact` and holds the general note only |
| **design** | The dock additionally carries per-screen / per-design / per-view rows above the general note (specific → general, top to bottom); design switcher when ≥2 designs; `#screen-nav` gains a second group below the designs group, one entry per optional view (§ Views (optional)) |

A concept may mix the two freely from round to round — that choice is about
where itemised feedback belongs, not about where the menu or the dock lives.
The overlay already
works on mobile (`max-width: 90vw`); only the "you are here" head folds away
below 768px.

**Panel anatomy, top-to-bottom (identical across all templates — a flex
column of four parts; only part 2 scrolls, parts 1, 3 and 4 are pinned):**
1. **"You are here"** (`.panel-here`) — pinned head: the selected round's
   label — no "· aktiv" suffix on the live round, an "archiviert" marker on
   a frozen one, and, ONLY when the reading line sits in a variant section,
   "(Variante)" appended ("Iteration 8 (Orbital Ring)") — the TOC entry
   under the reading line (dropped entirely on the final report), on a
   frozen tab a compact "↩ zur Runde N" link, and a 🕘 rounds chip (count of
   PREVIOUS rounds, hidden when none) whose click unfolds a dimmed list of
   those rounds — each with its generated summary and an "archiviert" tag —
   directly under the head line; a row click switches to that round via the
   same `showIteration()` a tab click always used.
2. **The tree** (`.panel-nav-scroll`, `flex: 1; min-height: 0;
   overflow-y: auto`) — **iteration tabs** (`.iteration-tabs`, still one
   plain chip per iteration, but hidden now — `buildIterationTree()` reads
   them to drive the head's rounds chip/list instead) and the **section TOC**
   (`.section-nav`) — auto-populated from EVERY top-level `<section id="…"
   data-nav-label="…">` inside the active iteration. Not limited to
   variants: Ist-Zustand, context blocks, design notes, mockups — anything
   with a nav label gets a scroll anchor here. `buildSectionNav()` moves
   `#section-nav` under the (hidden) selected chip and rebuilds it for the
   live round only, writes a summary line ("14 Einträge · 3 verworfen") on
   every other chip (consumed by the head's rounds list, never shown on the
   bar itself), and either groups the TOC around the **selected variant**
   (one variant left "Miteinbeziehen" while every other is "Verwerfen", or
   the one under the reading line — rendered open with its own nested
   sub-sections, every other variant collapsed into one "Weitere Varianten"
   row) or, absent that, the flat/kind-grouped list (Kontext / Varianten or
   `data-nav-group`) only when ≥2 kinds meet AND the round has >12 entries.
   A "+N weitere" toggle appears only when the list overflows the scroll
   box. The HTML stays a flat chip list — see
   `deep-knowledge/iteration-rules.md` § The panel tree.
3. **Status line** (`.panel-status`) — ONE line, one glyph, six mutually
   exclusive states (saved / saving / connecting / local-only / submitted /
   frozen); the progress steps expand under it after a submit. See
   `deep-knowledge/templates-panel-state.md` § Decision Panel State CSS.
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
  discard choice. See `deep-knowledge/templates-persistence.md` § Comment Slot Injection
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
