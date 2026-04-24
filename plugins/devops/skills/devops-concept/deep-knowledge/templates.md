# Concept HTML Templates

Three page-level **templates** (layout modes) cover every concept use case:

| Template | Layout | When to use |
|---|---|---|
| **decision** | Sidebar (~80/~20), multi-variant cards | Multi-option evaluation, trade-offs, architecture or tech decisions — the canonical "pick one" flow with bi-state (Verwerfen / Miteinbeziehen) per variant and multiple iterations |
| **prototype** | Fullscreen content + overlay decision panel (FAB-toggled, right) + collapsible feedback dock (bottom, per-screen comments) | UI mockups, wireframes, visual design concepts, click-through flows — one artefact that needs maximum screen real estate, plus structured per-screen feedback |
| **free** | Sidebar (~80/~20), freeform body content | Analysis, walkthrough, brainstorm, explainer, timeline — structured content without forced variant framing. Bi-state evaluation is optional (opt-in per section) |

**Content variants (analysis, plan, concept, comparison, dashboard, creative)
are sub-structures of the decision template** — they describe how to lay out
the cards inside a decision page, not separate page templates.

All three templates share the same monitoring backbone (heartbeat, submit
handler, state persistence, iteration tabs, section TOC, reload polling,
theme toggle) — see the "Shared Systems" section at the bottom of this file.

**These are recommendations, not mandatory structures.** Claude should adapt
layout, elements, and design to fit the specific content. Use these as
starting points and inspiration — deviate freely when the content calls for it.

## UI Locale

**Every user-facing string on the rendered concept page comes from the
locale table below.** Claude picks the locale from the `[ui-locale: xx]`
hint injected by the `prompt.knowledge.dispatch` hook at session start,
which in turn derives the user's language from their profile/chat language.

**How to use:**
1. Read the locale code from `[ui-locale: xx]` (e.g. `de`, `en`, `fr`, `hi`, `ja`).
2. Set `<html lang="{locale}">` on the generated page.
3. Swap every UI string from the matching column of the table below. Never
   hard-code German/English text — always reference the table.
4. **If the locale is not in the table yet:** Claude MUST add the missing
   column inline (translating all keys at generation time) and also persist
   that column back into this file so future generations have it. Fallback
   for truly unreachable translations: use the `en` column and document it
   in a comment.

Do NOT assume "English-only" — users in India, Japan, France, Brazil etc.
must see their own language. The locale hint is authoritative.

| Key | en | de |
|---|---|---|
| `panel.heading`                | Decisions                      | Entscheidungen |
| `panel.submit`                 | Submit decisions               | Entscheidungen abschicken |
| `panel.submit_hint`            | Your selection goes straight to Claude. | Deine Auswahl wird direkt an Claude übermittelt. |
| `panel.submit_iterate`         | Next iteration                 | Zur nächsten Iteration |
| `panel.submit_iterate_hint`    | Your selection goes to Claude for the next iteration. No code changes. | Deine Auswahl geht an Claude für die nächste Iteration. Es wird kein Code geschrieben. |
| `panel.submit_implement`       | Implement with feedback       | Mit Feedback implementieren |
| `panel.submit_implement_hint`  | Claude applies the selection as real changes now. | Claude setzt die Auswahl jetzt in echte Änderungen um. |
| `panel.submit_implement_confirm` | Implement with feedback now? Claude will write code changes. | Mit Feedback jetzt implementieren? Claude schreibt jetzt Code-Änderungen. |
| `panel.submitted`              | Decisions submitted            | Entscheidungen übermittelt |
| `panel.submitted_hint`         | Claude is processing your selection. Switch to the **Claude chat** to follow progress. | Claude verarbeitet deine Auswahl. Wechsle zum **Claude Chat** um den Fortschritt zu sehen. |
| `panel.disconnected_title`     | Claude is not connected        | Claude ist nicht verbunden |
| `panel.disconnected_hint`      | You can still submit — your click is queued and delivered as soon as Claude is back. | Du kannst trotzdem absenden — der Klick wird gespeichert und gesendet, sobald Claude wieder da ist. |
| `panel.connecting_title`       | Claude is connecting           | Claude verbindet sich |
| `panel.connecting_hint`        | One moment — establishing the connection. | Einen Moment — die Verbindung wird aufgebaut. |
| `panel.toggle_open`            | Open decisions                 | Entscheidungen öffnen |
| `panel.close`                  | Close                          | Schliessen |
| `variant.include`              | Include                        | Miteinbeziehen |
| `variant.discard`              | Discard                        | Verwerfen |
| `iteration.label`              | Iterations                     | Iterationen |
| `iteration.active_suffix`      | · active                       | · aktiv |
| `nav.sections`                 | Sections                       | Abschnitte |
| `proto.feedback_title`         | Feedback                       | Feedback |
| `proto.feedback_toggle`        | Open feedback                  | Feedback öffnen |
| `proto.feedback_general`       | General notes on this prototype | Allgemeine Anmerkungen zum Prototyp |
| `proto.feedback_general_hint`  | Persists across all screens    | Screen-übergreifend persistent |
| `proto.feedback_current`       | Current screen                 | Aktueller Screen |
| `proto.feedback_placeholder`   | Write a note on this screen…   | Notiz zu diesem Screen… |
| `proto.screen_counter`         | Screen {n} / {total}           | Screen {n} / {total} |

**Locale tag example on `<html>`:** `<html lang="de">`, `<html lang="en">`,
`<html lang="fr">`, `<html lang="hi">`, `<html lang="ja">`. Match whatever
the `[ui-locale: ...]` hint produced.

## Common Structure (all templates)

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark" data-page-version="{generation-timestamp}" data-template="decision">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Concept — {title}</title>
  <style>/* all CSS inline */</style>
</head>
<body>
  <div class="concept-layout">
    <!-- Main content -->
    <div class="concept-content">
      <header>
        <!-- HEADER MUST STAY LEAN.
             Keep to <h1> + ONE short subtitle line (or omit subtitle entirely).
             Do NOT repeat the iteration title/intro here — that belongs INSIDE
             the active <section data-iteration="N">. Double-intros (header +
             iteration-intro) eat vertical space and duplicate context. -->
        <h1>{title}</h1>
        <p class="subtitle">{optional one-line context — omit if not needed}</p>
        <button id="theme-toggle" aria-label="Toggle theme">🌙/☀️</button>
      </header>

      <main>
        <!-- One <section data-iteration="N"> per iteration. Exactly one has
             data-active. All others render their controls disabled/readonly
             and preserve the values the user submitted that round.
             Each iteration section may open with its own iteration-intro
             block (title + one paragraph) BEFORE the variant/content cards. -->
        <!--
        <section data-iteration="1" hidden>...frozen first round...</section>
        <section data-iteration="2" data-active>...current round (active)...</section>
        -->
      </main>
    </div>

    <!-- Decision panel. Layout varies per template:
         decision: sticky sidebar, always visible.
         prototype: overlay, FAB-toggled.
         free: sticky sidebar (same as decision). -->
    <aside class="concept-decision-panel">
      <!-- All visible strings are referenced by key in the locale table above.
           Swap to the `de` column when [ui-locale: de] is active. -->

      <!-- Iteration tabs — live at the TOP of the decision panel (not in the
           content area). Compact vertical chip list; the active tab shows
           the current round, older tabs stay clickable but show frozen
           snapshots when selected. Auto-populated, one entry per
           <section data-iteration="N">. -->
      <nav class="iteration-tabs" role="tablist" aria-label="{{iteration.label}}">
        <!--
        <button class="iteration-tab" role="tab" data-iteration="1" aria-selected="false">Iteration 1</button>
        <button class="iteration-tab" role="tab" data-iteration="2" aria-selected="true">Iteration 2 · active</button>
        -->
      </nav>

      <h3>{{panel.heading}}</h3>

      <!-- Section TOC — auto-populated from EVERY <section id="..."
           data-nav-label="..."> inside the active iteration, not just variants.
           Sections that carry a bi-state radio group (eval-{id}) display their
           current state label; plain sections (Ist-Zustand, Context, Design-Notes,
           etc.) just show the label and anchor-scroll on click. -->
      <nav class="section-nav" id="section-nav" aria-label="{{nav.sections}}">
        <!-- auto-populated -->
      </nav>

      <!-- Normal state: decision summary + two submit buttons.
           The disconnected warning lives INSIDE #panel-ready and covers
           the submit area as an overlay when Claude is offline. -->
      <div id="panel-ready">
        <div id="decision-summary">
          <!-- Auto-populated summary of current selections -->
        </div>

        <!-- Connection overlays. Three possible states:
             1. Page just loaded, heartbeat not yet confirmed → #connection-connecting
                visible (default), warning hidden.
             2. Heartbeat confirmed fresh → both hidden.
             3. Past grace period AND heartbeat stale → #connection-warning
                visible, connecting hidden.
             Both are absolute overlays on top of #panel-ready. -->
        <div id="connection-connecting" class="panel-warning panel-warning--connecting" style="display: flex;">
          <span class="warning-icon" aria-hidden="true">⋯</span>
          <strong>{{panel.connecting_title}}</strong>
          <p class="warning-message">{{panel.connecting_hint}}</p>
        </div>
        <div id="connection-warning" class="panel-warning" style="display: none;">
          <span class="warning-icon" aria-hidden="true">⚠</span>
          <strong>{{panel.disconnected_title}}</strong>
          <p class="warning-message">{{panel.disconnected_hint}}</p>
        </div>

        <button id="submit-iterate-btn" class="primary submit-btn">{{panel.submit_iterate}}</button>
        <p class="hint">{{panel.submit_iterate_hint}}</p>
        <div class="submit-gap" aria-hidden="true"></div>
        <button id="submit-implement-btn" class="implement-btn">
          <span class="warn-icon" aria-hidden="true">⚠</span>
          {{panel.submit_implement}}
        </button>
        <p class="hint hint-warn">{{panel.submit_implement_hint}}</p>
      </div>

      <!-- Post-submit state: waiting for Claude -->
      <div id="panel-submitted" style="display: none;">
        <div class="submitted-indicator">
          <span class="check-icon">✓</span>
          <strong>{{panel.submitted}}</strong>
        </div>
        <p class="submitted-hint">{{panel.submitted_hint}}</p>
        <div class="waiting-animation"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
      </div>
    </aside>
  </div>

  <script type="application/json" id="concept-decisions">
    {"submitted": false, "decisions": [], "comments": []}
  </script>
  <script>/* all JS inline */</script>
</body>
</html>
```

Set `data-template` on the `<html>` element to one of `decision` | `prototype` | `free`. This is the single source of truth that drives template-specific CSS (`.concept-layout[data-template="prototype"]`) and JS branches (`collectDecisions`).

---

# Template: decision

Multi-variant evaluation with sidebar layout. This is the canonical flow:
Claude presents 2+ options, user picks bi-state per variant, submits,
Claude iterates.

## Layout — Sidebar

Content left (~80%), decision panel right (~20%), always visible. Best for
structured evaluation where the user wants to see the panel at all times.

```css
.concept-layout {
  display: flex;
  min-height: 100vh;
}
.concept-content {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
}
.concept-decision-panel {
  width: 20%;
  min-width: 240px;
  max-width: 360px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  padding: 1.5rem;
  border-left: 1px solid var(--border-color);
  background: var(--panel-bg);
}
/* Mobile: collapse to sticky bottom */
@media (max-width: 768px) {
  .concept-layout { flex-direction: column; }
  .concept-decision-panel {
    width: 100%;
    max-width: none;
    height: auto;
    position: sticky;
    bottom: 0;
    border-left: none;
    border-top: 1px solid var(--border-color);
  }
}
```

## Bi-State Variant Evaluation

Every variant in a decision page MUST include a **bi-state** selector with
exactly two options.

| State | Label | Behavior |
|-------|-------|----------|
| **Miteinbeziehen** | "Miteinbeziehen" (default) | Claude considers this variant in the next iteration or implementation |
| **Verwerfen** | "Verwerfen" | Claude discards this variant and excludes it from all further steps |

- Default state for all variants: **Miteinbeziehen**
- No "Nur diese" / "only" option — the user implicitly picks a single
  variant by setting all others to "Verwerfen"
- No "Claude setzt um" / "Feedback" hint labels — the action-vs-feedback
  distinction is now expressed by the two submit buttons (iterate vs.
  implement), NOT by the evaluation selector
- Each variant can ADDITIONALLY have rating, comments, and other controls

### HTML

```html
<div class="variant-evaluation" data-decision="variant-a" data-label="Variant A">
  <div class="eval-group">
    <label class="eval-option">
      <input type="radio" name="eval-variant-a" value="discard">
      <span class="eval-label">Verwerfen</span>
    </label>
    <label class="eval-option">
      <input type="radio" name="eval-variant-a" value="include" checked>
      <span class="eval-label">Miteinbeziehen</span>
    </label>
  </div>
</div>
```

Legacy class names `tri-state-group` / `tri-state-option` / `tri-state-label`
are deprecated but still accepted by the CSS selectors below for backward
compatibility.

### CSS

```css
/* Bi-state — legacy tri-state-* class names still supported */
.eval-group, .tri-state-group {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  overflow: hidden;
}
.eval-option, .tri-state-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  text-align: center;
  position: relative;
  border-right: 1px solid var(--border-color, #30363d);
  transition: background 0.2s, box-shadow 0.2s;
}
.eval-option:last-child, .tri-state-option:last-child { border-right: none; }

.eval-option:hover, .tri-state-option:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}

.eval-option input, .tri-state-option input { display: none; }

.eval-option:has(input:checked) .eval-label,
.tri-state-option:has(input:checked) .tri-state-label {
  font-weight: 700;
}

.eval-label, .tri-state-label { font-size: 0.9rem; transition: font-weight 0.15s; }

/* Checkmark badge on the selected option */
.eval-option:has(input:checked)::after,
.tri-state-option:has(input:checked)::after {
  content: '✓';
  position: absolute;
  top: 4px;
  right: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  pointer-events: none;
}

/* Miteinbeziehen (default, accent) */
.eval-option:has(input[value="include"]:checked),
.tri-state-option:has(input[value="include"]:checked) {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent);
  box-shadow: inset 0 0 0 2px var(--accent-color, #58a6ff);
}
.eval-option:has(input[value="include"]:checked)::after,
.tri-state-option:has(input[value="include"]:checked)::after {
  background: var(--accent-color, #58a6ff);
  color: white;
}

/* Verwerfen (danger) */
.eval-option:has(input[value="discard"]:checked),
.tri-state-option:has(input[value="discard"]:checked) {
  background: color-mix(in srgb, var(--danger-color, #f85149) 12%, transparent);
  box-shadow: inset 0 0 0 2px var(--danger-color, #f85149);
}
.eval-option:has(input[value="discard"]:checked)::after,
.tri-state-option:has(input[value="discard"]:checked)::after {
  background: var(--danger-color, #f85149);
  color: white;
}
.eval-option:has(input[value="discard"]:checked) .eval-label,
.tri-state-option:has(input[value="discard"]:checked) .tri-state-label {
  color: var(--danger-color, #f85149);
}

/* Unselected state */
.eval-option:has(input:not(:checked)),
.tri-state-option:has(input:not(:checked)) {
  opacity: 0.7;
}
.eval-option:has(input:not(:checked)):hover,
.tri-state-option:has(input:not(:checked)):hover {
  opacity: 1;
}
```

**Behavior:**
- Default: "Miteinbeziehen" (all variants considered)
- "Verwerfen": grays out the variant card visually (still accessible)
- To pick a single variant, set all others to "Verwerfen" manually

### Decision schema

```json
{
  "template": "decision",
  "action": "iterate",
  "decisions": [
    { "id": "variant-a", "label": "...", "evaluation": "include", "rating": 4 },
    { "id": "variant-b", "label": "...", "evaluation": "discard", "rating": 2 },
    { "id": "variant-c", "label": "...", "evaluation": "include", "rating": 5 }
  ],
  "comments": [
    { "id": "variant-a", "text": "..." }
  ]
}
```

`evaluation` values: `"discard"` | `"include"`
`action` values: `"iterate"` | `"implement"` — determined by which submit
button the user clicked. See § Two-Button Submit below.

## Content Variants (within the decision template)

The decision template has six content sub-variants. They describe the shape
of the variant cards — not a different page layout.

### Variant: analysis

**Purpose:** Present findings from a data analysis with accept/reject controls.

```
[Header: Analysis title + date]
[Summary card: key metrics / TL;DR]

[Finding 1]
  ├── Description + evidence
  ├── [Tri-state: Verwerfen / Miteinbeziehen (default) / Nur diese]
  ├── [Priority: Hoch / Mittel / Niedrig]
  └── [Comment field: "Anmerkung..."]

[Finding 2]
  └── ...

[Submit button]
```

### Variant: plan

**Purpose:** Present an implementation plan with step approval controls.

```
[Header: Plan title]
[Overview card: goal, scope, timeline]

[Phase 1: Name]
  [Step 1.1]
    ├── Description + rationale
    ├── [Checkbox: Einschliessen]
    ├── [Effort indicator: S / M / L / XL]
    └── [Comment field]

  [Step 1.2]
    └── ...

[Submit button]
```

### Variant: concept

**Purpose:** Present architecture or design variants for evaluation.

```
[Header: Concept title]
[Context card: problem statement]

[Variant A: Name]
  ├── Description + diagram/illustration
  ├── Pro/Con list
  ├── [Tri-state: Verwerfen / Miteinbeziehen (default) / Nur diese]
  ├── [Rating: 1-5 stars or slider]
  └── [Comment field (wide, min-height: 80px)]

[Variant B: Name]
  └── ...

[Decision panel sidebar: summary + submit]
```

### Variant: comparison

**Purpose:** Side-by-side comparison of options with winner selection.

```
[Header: Comparison title]

[Criteria table / matrix]
  ├── Row per criterion
  ├── Column per option
  ├── [Weight slider per criterion]
  └── Auto-calculated weighted scores

[Per-option detail cards]
  ├── Strengths
  ├── Weaknesses
  ├── [Tri-state: Verwerfen / Miteinbeziehen (default) / Nur diese]
  └── [Comment field (wide)]

[Decision panel sidebar: summary + submit]
```

Each option in the comparison gets the same **bi-state evaluation** as
concept variants. Decision schema matches the decision template schema, with
additional `weight-*` entries for weight sliders.

### Variant: dashboard

**Purpose:** Status overview or metric dashboard with filters.

```
[Header + date range]
[KPI cards row: 3-5 key metrics]

[Filter bar: toggles for categories/segments]

[Expandable sections]
  ├── Section title + summary stat
  ├── Expanded: detail table or chart
  └── [Comment field per section]

[Action items section]
  ├── [Checkbox per item]
  └── [Comment field]

[Submit button]
```

### Variant: creative

**Purpose:** Brainstorming, ideation, collecting ideas.

```
[Header: Topic]
[Context / constraints]

[Idea cards grid]
  ├── Idea title + description
  ├── [Vote: thumbs up/down]
  ├── [Tag selector: category]
  └── [Comment field]

[Add new idea button → inline form]
[Submit button]
```

---

# Template: prototype

**One visual artefact, one screen at a time, 100 % viewport.** The body shows
exactly one screen from the flow. The user switches between screens via the
screen-nav inside the ☰ decision panel, keyboard arrows, OR by clicking
buttons inside the mockup itself (click-dummy behaviour). The viewport
has no header bar, no sidebars — just the current screen and two floating
buttons:

## Rules

- **Click-dummy by default (2+ screens):** buttons/links inside the mockup
  MUST navigate between screens when clicked. A real "Continue" button on
  screen 1 takes the user to screen 2; "Back" goes to screen 1; etc. The
  user can thereby click through the whole flow as if it were a real app.
- **"Screen" = logical state, not necessarily full page.** A screen is any
  user-distinguishable state the reviewer should be able to annotate
  separately:
  - Full-page transitions (welcome / credentials / success)
  - Modal / drawer / dialog toggles (main view without modal vs. with
    modal open)
  - Tab or accordion selections (tab A content vs. tab B content)
  - Empty / loading / populated / error states of the same component
  - Before / after user action (form empty vs. form submitted)

  Each such state becomes its own `<section data-screen>`. The click-dummy
  wiring with `data-screen-link` handles the transition like any other
  screen switch.
- **Single-screen prototype (exactly one `<section data-screen>`):**
  - No screen-nav rendered inside the ☰ panel
  - Feedback dock shows ONLY the general-notes textarea (no
    per-screen section, no "Aktueller Screen" label)
  - No click-dummy wiring required — nothing to navigate to
  - The screen-indicator overlay can be hidden or simplified
  - `buildScreenUI()` detects `screens.length === 1` and sets
    `document.body.dataset.singleScreen = 'true'` so CSS can hide the
    per-screen UI. CSS adds: `body[data-single-screen="true"] #screen-nav,
    body[data-single-screen="true"] .feedback-section:has(#screen-textareas)
    { display: none }`.
- **Do NOT invent artificial screens** to make the template fit. If the
  artefact has no meaningful secondary state, leave it as a single screen
  and let the dock collapse to general notes only.
- **Design system alignment:** the prototype MUST use the project's existing
  design tokens (colors, typography, spacing, component shapes) unless the
  user explicitly requests a different look. Read `design-tokens.*`,
  Tailwind config, Figma variables via the design MCP, or the existing UI
  layer before inventing a style. The example in this file uses the generic
  GitHub-style palette only because dotclaude has no project-specific
  tokens — consumer projects will differ.

## Click-through wiring (`data-screen-link`)

Buttons inside a mockup get `data-screen-link` to declare their navigation:

```html
<div class="device-frame">
  <h4>Welcome</h4>
  <button class="mock-btn" data-screen-link="screen-credentials">Los geht's</button>
  <button class="mock-btn secondary" data-screen-link="screen-login">Anmelden</button>
</div>
```

Values:
- `data-screen-link="screen-id"` — jump to the screen with that id
- `data-screen-link="next"` — advance to the next screen in DOM order
- `data-screen-link="prev"` — go to the previous screen
- Omit the attribute entirely for decorative / terminal buttons

The wiring is a single delegated click handler installed alongside
`showScreen` — see § Click-through Handler below.

- `☰` (bottom-right) → Decision panel: iteration tabs, screen navigation, submit
- `💬` (bottom-left) → Feedback dock: **context-sensitive** textarea for the
  currently-visible screen + a persistent "general notes" textarea below

### Feedback behaviour (strict)

- The 💬 dock always shows **one textarea for the currently-active screen**
  (label: "Aktueller Screen: {screen-label}"). Its content is private to that
  screen.
- Below a divider, a **second textarea for general notes** stays visible
  regardless of the active screen — the user can append from any screen.
- When the user switches screens (via ☰ or keyboard), the screen textarea
  swaps to the new screen's notes. Previous screen's notes are preserved and
  come back when the user returns.
- `localStorage` persists all screen notes independently + the general notes
  + the active-screen id, so refresh / tab-close / browser-restart don't
  lose state.
- After Submit, a new iteration is appended (like decision). The user can
  switch back to iteration N via the iteration-tabs and re-read their frozen
  notes per screen.

## Layout — Fullscreen single-screen + Overlay Panel + Feedback Dock

```html
<html data-template="prototype">
<body style="overflow: hidden">
  <div class="concept-layout prototype fullscreen">
    <div class="concept-content">
      <main>
        <section data-iteration="1" data-active>
          <!-- All screens live here. Exactly one carries data-screen-active="true"
               (others get `hidden`). Every screen is position: absolute; inset: 0
               so it fills the viewport. A <div class="device-frame"> inside
               holds the actual mock content. -->
          <section id="screen-1" data-screen data-nav-label="Welcome" data-screen-active="true">
            <div class="device-frame">…mock…</div>
          </section>
          <section id="screen-2" data-screen data-nav-label="Credentials" hidden>
            <div class="device-frame">…mock…</div>
          </section>
          <section id="screen-3" data-screen data-nav-label="Success" hidden>
            <div class="device-frame">…mock…</div>
          </section>
        </section>
      </main>
    </div>

    <!-- Minimal screen counter (top-left overlay) — NOT a header bar.
         Shows "Screen N / Total · {label}" so the user always knows where
         they are. -->
    <div class="screen-indicator">
      Screen <strong id="active-screen-idx">1</strong> / <span id="total-screens">3</span>
      · <span id="active-screen-label">Welcome</span>
    </div>

    <!-- Two FABs — the only floating UI besides the screen itself. -->
    <button id="panel-toggle" class="panel-fab" aria-label="{{panel.toggle_open}}">☰</button>
    <button id="feedback-toggle" class="feedback-fab" aria-label="{{proto.feedback_toggle}}">💬</button>

    <!-- Decision panel (☰) — contains: iteration-tabs, screen-nav, submit.
         No section-TOC here: the screen-nav replaces it for prototype. -->
    <aside class="concept-decision-panel overlay" id="decision-panel">
      <button id="panel-close" class="panel-close-btn" aria-label="{{panel.close}}">✕</button>
      <nav class="iteration-tabs" role="tablist" aria-label="{{iteration.label}}"><!-- chips --></nav>
      <nav class="screen-nav" id="screen-nav" aria-label="Screens">
        <!-- auto-populated: one button per <section data-screen>.
             Each shows the screen index, label, and a ● marker when that
             screen has unsubmitted notes. Clicking switches the active screen
             AND closes the panel. -->
      </nav>
      <div id="panel-ready">
        <button id="submit-iterate-btn" class="primary submit-btn">{{panel.submit_iterate}}</button>
        <p class="hint">{{panel.submit_iterate_hint}}</p>
        <div class="submit-gap" aria-hidden="true"></div>
        <button id="submit-implement-btn" class="implement-btn">
          <span class="warn-icon" aria-hidden="true">⚠</span>
          {{panel.submit_implement}}
        </button>
        <p class="hint hint-warn">{{panel.submit_implement_hint}}</p>
      </div>
      <div id="panel-submitted" style="display: none;"><!-- waiting state --></div>
    </aside>
    <div class="panel-backdrop" id="panel-backdrop"></div>

    <!-- Feedback dock (💬) — context-sensitive.
         * Top: ONE textarea for the active screen (swapped on navigation).
         * Bottom: ONE textarea for general notes, always visible. -->
    <aside class="feedback-dock" id="feedback-dock" data-open="false">
      <div class="feedback-dock-header">
        <strong>Feedback</strong>
        <button id="feedback-close" class="feedback-close-btn" aria-label="{{panel.close}}">✕</button>
      </div>
      <div class="feedback-section">
        <label>Aktueller Screen: <strong id="dock-screen-label">Welcome</strong></label>
        <!-- One hidden textarea per screen. Only the active one is shown.
             Each carries data-comment="{screen-id}" AND
             data-screen-comment="{screen-id}" — so saveState/restoreState
             treats it like any comment field. -->
        <div id="screen-textareas"><!-- auto-populated --></div>
      </div>
      <div class="feedback-divider"></div>
      <div class="feedback-section">
        <label>{{proto.feedback_general}}</label>
        <textarea id="proto-general-feedback" data-comment="general"
                  placeholder="{{proto.feedback_general}}"></textarea>
      </div>
    </aside>
  </div>
</body>
</html>
```

## Layout CSS

```css
/* Fullscreen prototype — no body scroll, exactly one screen fills viewport */
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
.concept-layout.prototype.fullscreen { display: block; width: 100vw; height: 100vh; overflow: hidden; }
.concept-layout.prototype .concept-content { position: absolute; inset: 0; overflow: hidden; }

/* Iteration sections fill the viewport. Screens inside do too —
   only the active one is visible (hidden attribute on the others). */
section[data-iteration] { position: absolute; inset: 0; }
section[data-iteration][hidden] { display: none; }
section[data-screen] {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 2rem; overflow-y: auto;
  animation: screen-in 0.25s ease;
}
section[data-screen][hidden] { display: none; }
@keyframes screen-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* Minimal screen counter — NOT a header bar */
.screen-indicator {
  position: fixed; top: 1rem; left: 1rem; z-index: 90;
  padding: 0.4rem 0.75rem; border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg) 85%, transparent);
  border: 1px solid var(--border-color);
  color: var(--text-secondary); font-size: 0.8rem;
  backdrop-filter: blur(6px);
}
.screen-indicator strong { color: var(--text); }

/* Overlay decision panel — hidden by default, same slide-in as non-prototype overlay */
.concept-layout.prototype .concept-decision-panel {
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  right: -400px;
  width: 360px;
  max-width: 90vw;
  height: 100vh;
  padding: 1.5rem;
  background: var(--panel-bg, #161b22);
  border-left: 1px solid var(--border-color, #30363d);
  z-index: 200;
  overflow-y: auto;
  transition: right 0.3s ease;
}
.concept-layout.prototype .concept-decision-panel.open {
  right: 0;
}

.panel-fab,
.feedback-fab {
  position: fixed;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 100;
  transition: transform 0.2s, opacity 0.2s;
}
.panel-fab { bottom: 2rem; right: 2rem; background: var(--accent-color, #58a6ff); }
.feedback-fab { bottom: 2rem; left: 2rem; background: var(--warning-color, #d29922); }
.panel-fab:hover,
.feedback-fab:hover { transform: scale(1.1); }
.panel-fab.hidden,
.feedback-fab.hidden { opacity: 0; pointer-events: none; }

.panel-close-btn,
.feedback-close-btn {
  align-self: flex-end;
  background: none;
  border: none;
  color: var(--text-color, #c9d1d9);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.25rem;
}

.panel-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 150;
}
.panel-backdrop.visible { display: block; }

/* ── Screen navigation inside the ☰ panel ── */
.screen-nav { display: flex; flex-direction: column; gap: 4px;
  margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-color); }
.screen-nav-item { display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 0.85rem; border-radius: 8px; text-decoration: none;
  color: var(--text-color, #c9d1d9); font-size: 0.95rem;
  border: 1px solid var(--border-color); background: transparent;
  cursor: pointer; transition: all 0.15s; text-align: left; }
.screen-nav-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.screen-nav-item[data-active="true"] {
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
  border-color: var(--accent-color); font-weight: 600;
}
.screen-nav-item .screen-idx { color: var(--accent-color); font-weight: 600; margin-right: 0.5rem; }
.screen-nav-item .has-notes { color: var(--warning-color); font-size: 0.75rem; }

/* ── Feedback Dock (bottom, collapsible, context-sensitive) ── */
.feedback-dock {
  position: fixed; left: 0; right: 0; bottom: -100%; max-height: 70vh;
  padding: 1.5rem; background: var(--panel-bg, #161b22);
  border-top: 1px solid var(--border-color, #30363d);
  box-shadow: 0 -6px 20px rgba(0,0,0,0.35); z-index: 180; overflow-y: auto;
  transition: bottom 0.3s ease;
  display: flex; flex-direction: column; gap: 1.25rem;
}
.feedback-dock[data-open="true"] { bottom: 0; }
.feedback-dock-header { display: flex; justify-content: space-between; align-items: center; }
.feedback-section { display: flex; flex-direction: column; gap: 0.4rem; }
.feedback-section label { font-size: 0.9rem; color: var(--text-secondary); font-weight: 500; }
.feedback-section label strong { color: var(--accent-color); }
.feedback-section textarea {
  width: 100%; padding: 0.8rem;
  border: 1px solid var(--border-color); border-radius: 10px;
  background: var(--input-bg, #0d1117); color: var(--text-color, #c9d1d9);
  font-family: inherit; font-size: 0.95rem; line-height: 1.5; resize: vertical; min-height: 90px;
}
.feedback-section textarea:focus { outline: none; border-color: var(--accent-color); }
.feedback-divider { height: 1px; background: var(--border-color); margin: 0.25rem 0; }

/* Hidden per-screen textareas inside #screen-textareas: only active shown */
#screen-textareas textarea[hidden] { display: none; }

/* Single-screen prototype: hide screen-nav + per-screen feedback section.
   Only general notes remain visible. */
body[data-single-screen="true"] #screen-nav,
body[data-single-screen="true"] .feedback-section:has(#screen-textareas),
body[data-single-screen="true"] .feedback-divider:has(+ .feedback-section #proto-general-feedback) {
  display: none;
}
```

## Layout JS — single-screen navigation + context-sensitive feedback

Only one screen is visible at a time. `showScreen(id)` swaps the active
screen, updates the counter overlay, and swaps the feedback-dock textarea
to the matching per-screen `<textarea>`. Per-screen textareas stay in the
DOM (just hidden), so each one's value persists independently via
`localStorage` (same mechanism as any `data-comment` field).

```javascript
(function wirePrototypeLayout() {
  if (document.documentElement.dataset.template !== 'prototype') return;

  // Build screen-nav buttons (☰) and per-screen textareas (💬) from every
  // <section data-screen> inside the VISIBLE iteration (may be a frozen
  // tab the user clicked back to, not necessarily the live one).
  function buildScreenUI() {
    const visible = document.querySelector('section[data-iteration]:not([hidden])');
    if (!visible) return;
    const screens = [...visible.querySelectorAll('section[data-screen][id]')];
    document.getElementById('total-screens').textContent = screens.length;

    // Single-screen prototypes: hide screen-nav + per-screen feedback.
    // CSS keys off body[data-single-screen="true"].
    document.body.dataset.singleScreen = screens.length <= 1 ? 'true' : 'false';
    if (screens.length <= 1) {
      const indicator = document.querySelector('.screen-indicator');
      if (indicator) indicator.style.display = 'none';
    }

    const nav = document.getElementById('screen-nav');
    nav.innerHTML = '';
    screens.forEach((sec, idx) => {
      const btn = document.createElement('button');
      btn.className = 'screen-nav-item';
      btn.dataset.screenId = sec.id;
      btn.innerHTML = `<span><span class="screen-idx">${idx + 1}.</span>${sec.dataset.navLabel || sec.id}</span>
        <span class="has-notes" data-note-marker></span>`;
      btn.addEventListener('click', () => { showScreen(sec.id); closePanel(); });
      nav.appendChild(btn);
    });

    const container = document.getElementById('screen-textareas');
    container.innerHTML = '';
    screens.forEach(sec => {
      const ta = document.createElement('textarea');
      ta.dataset.comment = sec.id;
      ta.dataset.screenComment = sec.id;
      ta.placeholder = `Notiz zu ${sec.dataset.navLabel || sec.id}…`;
      ta.hidden = true;
      container.appendChild(ta);
    });
  }

  window.showScreen = function(id) {
    const screens = document.querySelectorAll(
      'section[data-iteration]:not([hidden]) section[data-screen][id]');
    let idx = 0;
    screens.forEach((s, i) => {
      const match = s.id === id;
      s.hidden = !match;
      s.dataset.screenActive = match ? 'true' : 'false';
      if (match) idx = i;
    });
    const screen = document.getElementById(id);
    const label = screen?.dataset.navLabel || id;
    document.getElementById('active-screen-label').textContent = label;
    document.getElementById('active-screen-idx').textContent = idx + 1;
    document.getElementById('dock-screen-label').textContent = label;
    document.querySelectorAll('[data-screen-comment]').forEach(ta => {
      ta.hidden = ta.dataset.screenComment !== id;
    });
    document.querySelectorAll('.screen-nav-item').forEach(item => {
      item.dataset.active = String(item.dataset.screenId === id);
    });
    updateNoteMarkers();
    if (typeof saveState === 'function') saveState();
  };

  function updateNoteMarkers() {
    document.querySelectorAll('.screen-nav-item').forEach(item => {
      const id = item.dataset.screenId;
      const ta = document.querySelector(`[data-screen-comment="${id}"]`);
      const marker = item.querySelector('[data-note-marker]');
      if (marker) marker.textContent = (ta && ta.value.trim()) ? '● Notiz' : '';
    });
  }
  window.updateNoteMarkers = updateNoteMarkers;

  // Panel + dock toggles
  const panel = document.getElementById('decision-panel');
  const panelToggle = document.getElementById('panel-toggle');
  const panelCloseBtn = document.getElementById('panel-close');
  const backdrop = document.getElementById('panel-backdrop');
  window.openPanel = () => { panel.classList.add('open'); backdrop.classList.add('visible'); panelToggle.classList.add('hidden'); };
  window.closePanel = () => { panel.classList.remove('open'); backdrop.classList.remove('visible'); panelToggle.classList.remove('hidden'); };
  panelToggle.addEventListener('click', openPanel);
  panelCloseBtn.addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);

  const dock = document.getElementById('feedback-dock');
  const dockToggle = document.getElementById('feedback-toggle');
  const dockClose = document.getElementById('feedback-close');
  function closeDock() { dock.dataset.open = 'false'; dockToggle.classList.remove('hidden'); }
  window.closeDock = closeDock;
  dockToggle.addEventListener('click', () => { dock.dataset.open = 'true'; dockToggle.classList.add('hidden'); });
  dockClose.addEventListener('click', closeDock);

  // Click outside the dock (anywhere on the prototype screen) closes it.
  // The ✕ button still works — this just adds click-away as an alternative
  // dismissal. Uses capture so it runs before the screen-link handler,
  // which is fine: the click also triggers navigation if it hit a
  // data-screen-link element, and dismissing the dock first is harmless.
  document.addEventListener('click', (e) => {
    if (dock.dataset.open !== 'true') return;
    if (e.target.closest('#feedback-dock')) return;
    if (e.target.closest('#feedback-toggle')) return;
    closeDock();
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    buildScreenUI();
    const active = document.querySelector('section[data-iteration][data-active]');
    if (active) {
      // Restore last active screen from localStorage if available,
      // otherwise default to the first screen.
      let restored = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) restored = JSON.parse(raw)._activeScreen;
      } catch (e) {}
      const first = active.querySelector('section[data-screen]');
      showScreen(restored && document.getElementById(restored) ? restored : (first ? first.id : ''));
    }
    document.addEventListener('input', updateNoteMarkers);
  });

  // Rebuild after iteration switches (fresh screens, fresh textareas).
  // Preserve the previously active screen if it still exists in the newly
  // visible iteration; otherwise fall back to the first screen.
  document.addEventListener('iteration:changed', () => {
    buildScreenUI();
    const visible = document.querySelector('section[data-iteration]:not([hidden])');
    const prevId = document.querySelector('[data-screen][data-screen-active="true"]')?.id;
    const stillThere = prevId && visible?.querySelector(`section[data-screen]#${CSS.escape(prevId)}`);
    const first = visible?.querySelector('section[data-screen]');
    const target = stillThere ? prevId : first?.id;
    if (target) showScreen(target);
  });

  // Keyboard: Arrow Left/Right (and Space) jump between screens when no
  // textarea/input is focused and no overlay is open.
  document.addEventListener('keydown', e => {
    if (dock.dataset.open === 'true' || panel.classList.contains('open')) return;
    if (e.target.matches('textarea, input')) return;
    const screens = [...document.querySelectorAll(
      'section[data-iteration]:not([hidden]) section[data-screen]')];
    const currentIdx = screens.findIndex(s => s.dataset.screenActive === 'true');
    if (currentIdx < 0) return;
    let nextIdx = currentIdx;
    if (e.key === 'ArrowRight' || e.key === ' ') nextIdx = Math.min(currentIdx + 1, screens.length - 1);
    else if (e.key === 'ArrowLeft') nextIdx = Math.max(currentIdx - 1, 0);
    else return;
    e.preventDefault();
    showScreen(screens[nextIdx].id);
  });
})();
```

**Persistence extension:** the prototype's `saveState()` must also write
`_activeScreen: '{current-screen-id}'` into the localStorage payload so the
restore path on page load lands the user back on the last-viewed screen.

## Click-through Handler

Single delegated listener that interprets `data-screen-link` on any element
inside a `[data-screen]` section. Closes the ☰ panel (harmless no-op if
it's not open) and fires `showScreen()`.

```javascript
document.addEventListener('click', e => {
  const link = e.target.closest('[data-screen-link]');
  if (!link) return;
  const dest = link.dataset.screenLink;
  const screens = [...document.querySelectorAll(
    'section[data-iteration]:not([hidden]) section[data-screen]')];
  const currentIdx = screens.findIndex(s => s.dataset.screenActive === 'true');
  let targetId = null;
  if (dest === 'next') targetId = screens[Math.min(currentIdx + 1, screens.length - 1)]?.id;
  else if (dest === 'prev') targetId = screens[Math.max(currentIdx - 1, 0)]?.id;
  else targetId = dest;
  if (!targetId || !document.getElementById(targetId)) return;
  e.preventDefault();
  if (typeof closePanel === 'function') closePanel();
  showScreen(targetId);
});
```

## Screen-pattern markup

Each logical screen in the prototype is a `<section>` with `data-screen`:

```html
<section data-iteration="1" data-active>
  <header class="iteration-intro">
    <h2>Iteration 1 · Login flow mockup</h2>
    <p>High-fidelity walkthrough of the three-step sign-in flow.</p>
  </header>

  <section id="screen-welcome" data-nav-label="Welcome" data-screen>
    <div class="prototype-frame">…mockup HTML for welcome screen…</div>
  </section>

  <section id="screen-credentials" data-nav-label="Credentials" data-screen>
    <div class="prototype-frame">…mockup HTML for credentials screen…</div>
  </section>

  <section id="screen-success" data-nav-label="Success" data-screen>
    <div class="prototype-frame">…mockup HTML for success screen…</div>
  </section>
</section>
```

**Rules:**
- `data-screen` marks a block as a "feedback target" — it appears as a
  per-screen textarea in the dock. Use it only for screens worth commenting on.
- Every `data-screen` section MUST also have `id` and `data-nav-label` so
  the panel TOC and the feedback dock can reference it.
- The prototype iteration section can still contain non-screen `<section>`s
  (e.g. `id="design-notes" data-nav-label="Design notes"`). Those appear in
  the TOC but NOT in the feedback dock.
- Iteration tabs still apply — when Claude iterates on feedback, a new
  `<section data-iteration="N+1">` is appended with updated screens and the
  old one is frozen (see Shared Systems § Iteration Tabs).

## Decision schema

Prototype submit payload has **no variant evaluations** — only comments:

```json
{
  "template": "prototype",
  "decisions": [],
  "comments": [
    { "id": "general", "text": "..." },
    { "id": "screen-welcome", "label": "Welcome", "text": "..." },
    { "id": "screen-credentials", "label": "Credentials", "text": "..." }
  ]
}
```

## collectDecisions (prototype branch)

```javascript
// Called by the shared submit handler; `data-template` picks the branch.
function collectPrototypeDecisions() {
  const comments = [];
  // General notes
  const general = document.getElementById('proto-general-feedback');
  if (general && general.value.trim()) {
    comments.push({ id: 'general', text: general.value.trim() });
  }
  // Per-screen comments
  document.querySelectorAll('[data-screen-comment]').forEach(el => {
    if (!el.value.trim()) return;
    const id = el.dataset.screenComment;
    const screenEl = document.getElementById(id);
    comments.push({
      id,
      label: screenEl ? (screenEl.dataset.navLabel || id) : id,
      text: el.value.trim()
    });
  });
  return { submitted: true, template: 'prototype', decisions: [], comments };
}
```

---

# Template: free

A sidebar layout (same as decision) but the body is Claude-authored free
content: analysis, walkthrough, brainstorm, explainer, timeline. Tri-state
evaluation is **opt-in** per section — Claude adds it only where it makes
sense.

## Layout — Sidebar, freeform body

Identical to the decision layout (sticky sidebar, ~80/~20 split). The
difference is in the body: no forced variant-card framing, no mandatory
bi-state. Claude chooses the structure that fits the content.

```html
<html data-template="free">
<body>
  <div class="concept-layout">
    <div class="concept-content">
      <header>
        <h1>{title}</h1>
        <p class="subtitle">{optional}</p>
        <button id="theme-toggle">🌙/☀️</button>
      </header>
      <main>
        <section data-iteration="1" data-active>
          <header class="iteration-intro">
            <h2>Iteration 1 · {subject}</h2>
            <p>Short intro paragraph.</p>
          </header>

          <!-- Freeform body. Every nested <section id data-nav-label> gets
               a scroll anchor in the panel TOC. A section becomes "evaluable"
               by adding an eval-{id} radio group inside it (optional). -->
          <section id="context" data-nav-label="Context">
            <p>…</p>
          </section>

          <section id="finding-1" data-nav-label="Finding: latency spike">
            <p>…</p>
            <!-- OPT-IN bi-state: only present when Claude wants the user to
                 confirm the finding is valid. Section id MUST match the
                 radio name suffix (eval-{id}). -->
            <div class="tri-state-group">
              <label class="tri-state-option">
                <input type="radio" name="eval-finding-1" value="discard">
                <span class="tri-state-label">Verwerfen</span>
              </label>
              <label class="tri-state-option">
                <input type="radio" name="eval-finding-1" value="include" checked>
                <span class="tri-state-label">Miteinbeziehen</span>
              </label>
            </div>
            <textarea data-comment="finding-1" placeholder="Anmerkung…"></textarea>
          </section>

          <section id="recommendation" data-nav-label="Recommendation">
            <!-- plain section, no bi-state — just content -->
            <p>…</p>
          </section>
        </section>
      </main>
    </div>

    <aside class="concept-decision-panel">
      <!-- Same structure as decision. Panel TOC auto-detects which sections
           have eval-{id} radios and mirrors their current state. -->
    </aside>
  </div>
</body>
</html>
```

## Optional bi-state auto-detection

The section nav auto-detects whether a `<section data-nav-label>` contains an
`eval-{id}` radio group and mirrors its current state (Miteinbeziehen /
Verwerfen). Sections without a radio group just get a scroll anchor. See
Shared Systems § Section Navigation for the implementation.

## Decision schema

The free template emits **only the sections that actually have bi-state
radios**, plus whatever comments the user typed:

```json
{
  "template": "free",
  "decisions": [
    { "id": "finding-1", "label": "Finding: latency spike", "evaluation": "include" }
  ],
  "comments": [
    { "id": "finding-1", "text": "..." },
    { "id": "recommendation", "text": "..." }
  ]
}
```

If no section has bi-state markers, `decisions` is an empty array and the
submit payload is effectively a general-notes post.

## collectDecisions (free branch)

```javascript
function collectFreeDecisions() {
  const decisions = [];
  document.querySelectorAll('section[id][data-nav-label]').forEach(sec => {
    const radio = sec.querySelector(`input[name="eval-${CSS.escape(sec.id)}"]:checked`);
    if (!radio) return;
    decisions.push({
      id: sec.id,
      label: sec.dataset.navLabel || sec.id,
      evaluation: radio.value
    });
  });
  const comments = [];
  document.querySelectorAll('[data-comment]').forEach(el => {
    if (el.value.trim()) comments.push({ id: el.dataset.comment, text: el.value.trim() });
  });
  return { submitted: true, template: 'free', decisions, comments };
}
```

---

# Shared Systems (all templates)

All three templates reuse the same iteration, persistence, heartbeat, submit
handler, and navigation plumbing. The only template-specific parts are the
layout CSS and `collectDecisions` branch shown above. Everything below
applies uniformly.

## Section Navigation (Decision Panel as TOC)

The decision panel doubles as a full table-of-contents for the active
iteration. EVERY major `<section id="…" data-nav-label="…">` inside the
current iteration gets a clickable nav entry — not just variants. Sections
with a bi-state radio group additionally display the current evaluation
state.

```css
.section-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 1rem;
}
.section-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  text-decoration: none;
  color: var(--text-color, #c9d1d9);
  font-size: 0.9rem;
  transition: background 0.15s;
  cursor: pointer;
}
.section-nav-item:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}
.section-nav-item:not([data-variant]) .section-nav-label {
  font-weight: 500;
  opacity: 0.9;
}
.section-nav-state {
  font-size: 0.8rem;
  color: var(--accent-color, #58a6ff);
  white-space: nowrap;
}
.section-nav-state.state-discard { color: var(--danger-color, #f85149); }
.section-nav-state.state-only { color: var(--success-color, #3fb950); }
.section-nav-item.is-active {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 18%, transparent);
  font-weight: 600;
}
```

**Every navigable section needs a matching `id` AND a `data-nav-label`:**
```html
<!-- Plain section — TOC entry, scroll only -->
<section id="ist-zustand" data-nav-label="Ist-Zustand">...</section>

<!-- Variant section — TOC entry + bi-state evaluation -->
<section id="variant-a" class="variant-card" data-nav-label="A Orbital Ring">...</section>
```

Sections without `data-nav-label` are skipped by the TOC auto-populator.

```javascript
// --- Section Navigation (Decision Panel as TOC) ---
function buildSectionNav() {
  const nav = document.getElementById('section-nav');
  if (!nav) return;
  // Use :not([hidden]) so the nav reflects the VISIBLE iteration (may be
  // a frozen tab the user is reviewing), not the live/latest one.
  const activeIteration = document.querySelector('section[data-iteration]:not([hidden])');
  if (!activeIteration) return;
  const sections = activeIteration.querySelectorAll('section[id][data-nav-label]');
  nav.innerHTML = '';
  sections.forEach(sec => {
    const id = sec.id;
    const label = sec.dataset.navLabel;
    const hasTriState = !!sec.querySelector(`input[name="eval-${id}"]`);
    const link = document.createElement('a');
    link.href = '#' + id;
    link.className = 'section-nav-item';
    link.dataset.sectionId = id;
    if (hasTriState) link.setAttribute('data-variant', '');
    const labelEl = document.createElement('span');
    labelEl.className = 'section-nav-label';
    labelEl.textContent = label;
    link.appendChild(labelEl);
    if (hasTriState) {
      const stateEl = document.createElement('span');
      stateEl.className = 'section-nav-state';
      link.appendChild(stateEl);
    }
    nav.appendChild(link);
  });
  updateSectionNavState();
}

function updateSectionNavState() {
  const labels = { include: 'Miteinbeziehen', discard: 'Verwerfen' };
  document.querySelectorAll('.section-nav-item[data-variant]').forEach(link => {
    const id = link.dataset.sectionId;
    const checked = document.querySelector(`input[name="eval-${id}"]:checked`);
    const currentState = checked ? checked.value : 'include';
    const stateEl = link.querySelector('.section-nav-state');
    if (stateEl) {
      stateEl.textContent = labels[currentState] || currentState;
      stateEl.className = 'section-nav-state state-' + currentState;
    }
  });
}

document.addEventListener('click', e => {
  const link = e.target.closest('.section-nav-item');
  if (!link) return;
  e.preventDefault();
  const target = document.querySelector(link.getAttribute('href'));
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function installScrollSpy() {
  const items = document.querySelectorAll('.section-nav-item');
  if (!items.length) return;
  const byId = new Map();
  items.forEach(i => byId.set(i.dataset.sectionId, i));
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      const item = byId.get(en.target.id);
      if (!item) return;
      if (en.isIntersecting) {
        items.forEach(i => i.classList.remove('is-active'));
        item.classList.add('is-active');
      }
    });
  }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
  byId.forEach((_, id) => {
    const sec = document.getElementById(id);
    if (sec) io.observe(sec);
  });
}

document.addEventListener('change', updateSectionNavState);
document.addEventListener('DOMContentLoaded', () => {
  buildSectionNav();
  installScrollSpy();
});
```

**Important:**
- Every navigable `<section>` needs `id` AND `data-nav-label`.
- If a section has a bi-state radio group, its `name` MUST be `eval-{section-id}`.
- `buildSectionNav()` must run again after every iteration switch.

## Decision Panel State CSS

```css
/* Connection warning — overlays the submit area when Claude is offline.
   Requires #panel-ready to be position: relative.
   pointer-events: none so the user can still click the submit buttons
   through the overlay — clicks land in the offline queue and are
   auto-delivered on reconnect. */
#panel-ready { position: relative; }
.panel-warning {
  position: absolute; inset: 0; z-index: 5;
  pointer-events: none;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 0.75rem; text-align: center; padding: 1.5rem;
  border-radius: 10px;
  border: 1px solid var(--warning-color, #d29922);
  background: color-mix(in srgb, var(--panel-bg, #161b22) 70%, transparent);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  color: var(--text-color, #c9d1d9);
}
.panel-warning .warning-icon { font-size: 2.25rem; color: var(--warning-color, #d29922); line-height: 1; }
.panel-warning strong { color: var(--warning-color, #d29922); font-size: 1rem; }
.panel-warning .warning-message {
  font-size: 0.88rem; color: var(--text-secondary, #8b949e);
  line-height: 1.5; max-width: 280px; margin: 0;
}
/* Connecting variant — same overlay, accent color + pulsing icon */
.panel-warning--connecting { border-color: var(--accent-color, #58a6ff); }
.panel-warning--connecting .warning-icon {
  color: var(--accent-color, #58a6ff);
  animation: pulse-connect 1.4s ease-in-out infinite;
}
.panel-warning--connecting strong { color: var(--accent-color, #58a6ff); }
@keyframes pulse-connect {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

/* Submitted state */
.submitted-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  margin-bottom: 0.75rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
  border: 1px solid var(--success-color, #3fb950);
}
.submitted-indicator .check-icon {
  font-size: 1.3rem;
  color: var(--success-color, #3fb950);
}
.submitted-hint {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

/* Waiting dots animation */
.waiting-animation {
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 0.5rem 0;
}
.waiting-animation .dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--accent-color, #58a6ff);
  animation: pulse 1.4s ease-in-out infinite;
}
.waiting-animation .dot:nth-child(2) { animation-delay: 0.2s; }
.waiting-animation .dot:nth-child(3) { animation-delay: 0.4s; }
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

## State Persistence (localStorage + TTL)

Interactive element state MUST survive page reloads AND accidental tab closes
via `localStorage` with a time-to-live (TTL). This prevents the user from
losing selections, comments, and ratings.

**Storage key:** `concept-state-{slug}` (derived from the page's filename slug)
**TTL:** 24 hours — auto-clears stale state from previous days

```javascript
const STORAGE_KEY = 'concept-state-' + location.pathname.split('/').pop().replace('.html', '');
const STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function saveState() {
  const state = {
    _savedAt: Date.now(),
    _pageVersion: document.documentElement.dataset.pageVersion || ''
  };
  document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
    if (el.name || el.id) state['input:' + (el.name || el.id) + ':' + el.value] = el.checked;
  });
  document.querySelectorAll('textarea, input[type="text"], input[type="number"]').forEach(el => {
    if (el.id || el.dataset.comment) state['text:' + (el.id || el.dataset.comment)] = el.value;
  });
  document.querySelectorAll('input[type="range"]').forEach(el => {
    if (el.id || el.name) state['range:' + (el.id || el.name)] = el.value;
  });
  document.querySelectorAll('select').forEach(el => {
    if (el.id || el.name) state['select:' + (el.id || el.name)] = el.value;
  });
  state['theme'] = document.documentElement.getAttribute('data-theme');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    if (state._savedAt && (Date.now() - state._savedAt) > STATE_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const currentVersion = document.documentElement.dataset.pageVersion || '';
    if (state._pageVersion && state._pageVersion !== currentVersion) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (state.theme) document.documentElement.setAttribute('data-theme', state.theme);
    Object.entries(state).forEach(([key, value]) => {
      if (key.startsWith('_')) return;
      const [type, ...rest] = key.split(':');
      if (type === 'input') {
        const [name, val] = [rest.slice(0, -1).join(':'), rest[rest.length - 1]];
        const el = document.querySelector(`input[name="${name}"][value="${val}"], input[id="${name}"][value="${val}"]`);
        if (el) el.checked = value;
      } else if (type === 'text') {
        const id = rest.join(':');
        const el = document.querySelector(`[data-comment="${id}"]`) || document.querySelector(`textarea#${CSS.escape(id)}, input#${CSS.escape(id)}`);
        if (el) el.value = value;
      } else if (type === 'range') {
        const id = rest.join(':');
        const el = document.getElementById(id) || document.querySelector(`input[name="${id}"]`);
        if (el) { el.value = value; el.dispatchEvent(new Event('input')); }
      } else if (type === 'select') {
        const id = rest.join(':');
        const el = document.getElementById(id) || document.querySelector(`select[name="${id}"]`);
        if (el) el.value = value;
      }
    });
  } catch (e) { /* corrupt storage — ignore */ }
}

document.addEventListener('DOMContentLoaded', restoreState);
document.addEventListener('change', saveState);
document.addEventListener('input', saveState);
```

**Rules:**
- Use `localStorage` with a 24-hour TTL
- Save on every `change` and `input` event — not just on submit
- Restore runs on `DOMContentLoaded` — before the user sees the page
- The `concept-submitted` class is NOT persisted
- Theme preference IS persisted — prevents dark/light flash on reload

## collectDecisions (dispatcher)

The submit handler picks the branch based on `data-template` on `<html>`.
An `action` (`iterate` | `implement`) is passed in from the button that was
clicked and merged into the payload.

The dispatcher ALSO runs a generic catch-all scoped to the active
iteration (`section[data-iteration][data-active]`) so every named form
element ships in `allFields`, regardless of whether the template-specific
branch was updated for new fields. This is the safety net mandated by
`validation-gate.md` § Generic Form Collection — never remove it, never
replace it with hand-listed selectors. The typed sub-objects (`decisions`,
`comments`) live alongside `allFields` for ergonomics; they do not
substitute for it.

```javascript
function collectAllFormFields(scope) {
  const fields = {};
  // Catch-all: every named input, select, textarea inside scope.
  scope.querySelectorAll('input, select, textarea').forEach(el => {
    const key = el.dataset.field
             || el.dataset.v4
             || el.dataset.confirm
             || el.dataset.rename
             || el.dataset.entities
             || el.dataset.comment
             || el.name
             || el.id;
    if (!key) return;  // unnamed control — skip
    if (el.type === 'checkbox') {
      fields[key] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) fields[el.name] = el.value;
    } else {
      fields[key] = el.value;
    }
  });
  return fields;
}

function collectDecisions(action = 'iterate') {
  const active = document.querySelector('section[data-iteration][data-active]')
              || document.body;
  const allFields = collectAllFormFields(active);

  const template = document.documentElement.dataset.template || 'decision';
  let payload;
  if (template === 'prototype') payload = collectPrototypeDecisions();
  else if (template === 'free') payload = collectFreeDecisions();
  else payload = collectDecisionDecisions();
  payload.action = action;
  payload.allFields = allFields;
  return payload;
}

function collectDecisionDecisions() {
  const decisions = [];
  const comments = [];

  document.querySelectorAll('[data-decision]').forEach(el => {
    decisions.push({
      id: el.dataset.decision,
      label: el.dataset.label || '',
      ...getElementState(el)
    });
  });

  document.querySelectorAll('[data-comment]').forEach(el => {
    if (el.value.trim()) {
      comments.push({
        id: el.dataset.comment,
        text: el.value.trim()
      });
    }
  });

  return { submitted: true, template: 'decision', decisions, comments };
}
```

## Two-Button Submit (iterate vs. implement)

Every decision panel carries **two** submit buttons, not one. The primary
button ("Zur nächsten Iteration") is always visible and fires
`action: "iterate"` — a Claude turn that never touches code. The secondary
button ("Mit Feedback implementieren") sits below a visible gap and fires
`action: "implement"` — a Claude turn that DOES apply real file/code
changes. The gap is mandatory so the user has to move the mouse
deliberately to reach the implement button.

### HTML

```html
<div id="panel-ready">
  <div id="decision-summary"><!-- auto-summary --></div>

  <!-- Primary: safe, never implements -->
  <button id="submit-iterate-btn" class="primary submit-btn">
    Zur nächsten Iteration
  </button>
  <p class="hint">
    Deine Auswahl geht an Claude für die nächste Iteration. Es wird kein Code geschrieben.
  </p>

  <!-- Mandatory gap so the user does not misclick -->
  <div class="submit-gap" aria-hidden="true"></div>

  <!-- Secondary: explicit implementation commit -->
  <button id="submit-implement-btn" class="implement-btn">
    <span class="warn-icon" aria-hidden="true">⚠</span>
    Mit Feedback implementieren
  </button>
  <p class="hint hint-warn">
    Claude setzt die Auswahl jetzt in echte Änderungen um.
  </p>
</div>
```

### CSS

```css
.submit-btn, .implement-btn {
  width: 100%;
  padding: 0.8rem 1rem;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  margin-top: 0.5rem;
}
.submit-btn {
  border: none;
  background: var(--accent-color, #58a6ff);
  color: white;
}
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.submit-gap { height: 2rem; }

.implement-btn {
  background: transparent;
  color: var(--warning-color, #d29922);
  border: 1px solid var(--warning-color, #d29922);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}
.implement-btn:hover {
  background: color-mix(in srgb, var(--warning-color, #d29922) 15%, transparent);
}
.implement-btn .warn-icon { font-size: 1rem; }
.hint-warn { color: var(--warning-color, #d29922); }
```

### JS

```javascript
let _submittedAt = 0;

function wireSubmit(btnId, action) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => submitWithAction(action));
}

async function submitWithAction(action) {
  const data = collectDecisions(action);
  const container = document.getElementById('concept-decisions');
  container.textContent = JSON.stringify(data);
  document.body.classList.add('concept-submitted');
  _submittedAt = Date.now();

  document.getElementById('panel-ready').style.display = 'none';
  document.getElementById('panel-submitted').style.display = 'block';

  try {
    await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (e) {
    localStorage.setItem(STORAGE_KEY + '-pending', JSON.stringify(data));
  }
  saveState();
}

wireSubmit('submit-iterate-btn', 'iterate');
wireSubmit('submit-implement-btn', 'implement');

// --- Offline Submit Queue ---
async function retryPendingSubmission() {
  const pendingKey = STORAGE_KEY + '-pending';
  const pending = localStorage.getItem(pendingKey);
  if (!pending) return;
  try {
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: pending
    });
    if (res.ok) localStorage.removeItem(pendingKey);
  } catch (e) { /* still offline */ }
}
```

Claude-side: on receiving the payload, branch on `action`:
- `iterate` → Step 5b iterate branch: summarize + append next iteration only
- `implement` → Step 5b implement branch: actually write code/files, then
  still append a new iteration as a frozen "implementiert" record

## Panel State Reset

When Claude finishes processing, it POSTs `/reset` on the bridge server.
The server stamps `_processed_at`; the page's heartbeat poll sees the
updated timestamp and restores the ready panel. No browser eval injection.

```javascript
function restorePanelToReady() {
  document.getElementById('panel-submitted').style.display = 'none';
  document.getElementById('panel-ready').style.display = 'block';
  ['submit-iterate-btn', 'submit-implement-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = false;
  });
  document.body.classList.remove('concept-submitted');
  _submittedAt = 0;
  const slug = location.pathname.split('/').pop().replace('.html', '');
  localStorage.removeItem('concept-state-' + slug);
}
```

## Theme Toggle

```javascript
document.getElementById('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
});
```

## Claude Connection Heartbeat (HTTP Bridge)

```javascript
const HEARTBEAT_STALE_MS = 90000;
const HEARTBEAT_GRACE_MS = 30000;
const _pageLoadedAt = Date.now();
let _lastHeartbeatTs = 0;

async function pollHeartbeat() {
  try {
    const res = await fetch('/heartbeat', { cache: 'no-store' });
    const data = await res.json();
    _lastHeartbeatTs = data.ts || 0;
  } catch (e) { /* server unreachable */ }
}

async function pollProcessedState() {
  if (!_submittedAt) return;
  try {
    const res = await fetch('/decisions', { cache: 'no-store' });
    const data = await res.json();
    const processedIso = data && data._processed_at;
    if (!processedIso) return;
    const processedMs = Date.parse(processedIso);
    if (Number.isFinite(processedMs) && processedMs > _submittedAt) {
      restorePanelToReady();
    }
  } catch (e) { /* retry next tick */ }
}

function checkClaudeConnection() {
  const isConnected = _lastHeartbeatTs && (Date.now() - _lastHeartbeatTs) < HEARTBEAT_STALE_MS;
  const inGrace = Date.now() - _pageLoadedAt < HEARTBEAT_GRACE_MS;
  const connecting = document.getElementById('connection-connecting');
  const warning = document.getElementById('connection-warning');
  const btns = ['submit-iterate-btn', 'submit-implement-btn']
    .map(id => document.getElementById(id)).filter(Boolean);
  const panelSubmitted = document.getElementById('panel-submitted');

  if (panelSubmitted && panelSubmitted.style.display !== 'none') return;

  if (isConnected) {
    if (connecting) connecting.style.display = 'none';
    if (warning) warning.style.display = 'none';
    btns.forEach(b => b.disabled = false);
    retryPendingSubmission();
  } else if (inGrace) {
    // Still in grace period — show "connecting" overlay, no warning yet
    if (connecting) connecting.style.display = 'flex';
    if (warning) warning.style.display = 'none';
    btns.forEach(b => b.disabled = false);
  } else {
    // Past grace AND heartbeat stale → disconnected warning
    if (connecting) connecting.style.display = 'none';
    if (warning) warning.style.display = 'flex';
    // Buttons stay enabled: offline submissions are cached & retried
    btns.forEach(b => b.disabled = false);
  }
}

setInterval(async () => {
  await pollHeartbeat();
  checkClaudeConnection();
  await pollProcessedState();
}, 5000);
```

**Claude-side heartbeat** (executed by Claude via Bash or CronCreate):
```bash
curl -s -X POST http://localhost:{port}/heartbeat
```

## Iteration Tabs

Iterations of a concept page are appended as `<section data-iteration="N">`
blocks inside the same HTML file. The tab bar lives **at the top of the
right-side decision panel** (a compact vertical chip list, rendered above
the section TOC and submit block). All three templates support iterations —
prototype and free include them identically.

### Tab Bar HTML

```html
<nav class="iteration-tabs" role="tablist" aria-label="Iterationen">
  <button class="iteration-tab" role="tab"
          data-iteration="1" aria-selected="false" aria-controls="iter-1">
    Iteration 1
  </button>
  <button class="iteration-tab" role="tab"
          data-iteration="2" aria-selected="true" aria-controls="iter-2">
    Iteration 2
  </button>
</nav>

<main>
  <section id="iter-1" data-iteration="1" hidden>…frozen round 1…</section>
  <section id="iter-2" data-iteration="2" data-active>…active round 2…</section>
</main>
```

Rules:
- Exactly one section carries `data-active`. The matching tab has
  `aria-selected="true"`.
- Non-active sections get the `hidden` attribute AND are frozen
  (see "Freezing Past Iterations").
- Tabs stay clickable — switching tab reveals the chosen section and
  hides all others.

### Tab Bar CSS

```css
.iteration-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-color, #30363d);
}
.iteration-tab {
  flex: 0 0 auto;
  text-align: left;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  background: var(--bg-subtle, transparent);
  color: var(--text-secondary, #8b949e);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.iteration-tab:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
  color: var(--text-color, #c9d1d9);
}
.iteration-tab[aria-selected="true"] {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent);
  color: var(--text-color, #c9d1d9);
  border-color: var(--accent-color, #58a6ff);
  font-weight: 600;
}
.iteration-tab[aria-selected="true"]::before {
  content: "● ";
  color: var(--accent-color, #58a6ff);
}
section[data-iteration]:not([data-active]) {
  opacity: 0.85;
}
section[data-iteration]:not([data-active]) .tri-state-btn,
section[data-iteration]:not([data-active]) input,
section[data-iteration]:not([data-active]) textarea,
section[data-iteration]:not([data-active]) select {
  pointer-events: none;
  filter: grayscale(0.4);
}
```

### Freezing Past Iterations

When appending iteration N+1, Claude must freeze the previous section:

1. Remove `data-active`, add `hidden` to the previous `<section>`.
2. On every `input`, `textarea`, `select`, `button` inside it: set `disabled`.
3. On every `textarea`, `input[type="text"]`: set `readonly`.
4. For bi-state buttons: keep the `aria-pressed`/selected class exactly as
   the user submitted it — do NOT clear selections.
5. Add a small "Eingefroren — Iteration N" banner at the top (optional).

### Tab Switch JS

```javascript
function showIteration(n) {
  document.querySelectorAll('section[data-iteration]').forEach(sec => {
    const match = String(sec.dataset.iteration) === String(n);
    sec.hidden = !match;
  });
  document.querySelectorAll('.iteration-tab').forEach(tab => {
    const match = String(tab.dataset.iteration) === String(n);
    tab.setAttribute('aria-selected', match ? 'true' : 'false');
  });
  const activeSec = document.querySelector('section[data-iteration][data-active]');
  const isLive = activeSec && String(activeSec.dataset.iteration) === String(n);
  document.body.classList.toggle('viewing-frozen', !isLive);
  const panelReady = document.getElementById('panel-ready');
  const panelSubmitted = document.getElementById('panel-submitted');
  const panelFrozen = document.getElementById('panel-frozen');
  if (panelReady) panelReady.style.display = isLive ? 'block' : 'none';
  if (panelSubmitted) {
    const submitted = document.body.classList.contains('concept-submitted');
    panelSubmitted.style.display = (isLive && submitted) ? 'block' : 'none';
  }
  if (panelFrozen) panelFrozen.style.display = isLive ? 'none' : 'block';
  if (typeof buildSectionNav === 'function') buildSectionNav();
  document.dispatchEvent(new CustomEvent('iteration:changed'));
}

document.querySelectorAll('.iteration-tab').forEach(tab => {
  tab.addEventListener('click', () => showIteration(tab.dataset.iteration));
});

document.addEventListener('DOMContentLoaded', () => {
  const active = document.querySelector('section[data-iteration][data-active]');
  if (active) showIteration(active.dataset.iteration);
});
```

### Reload Polling

```javascript
let _bootReloadCounter = null;
async function pollReload() {
  try {
    const res = await fetch('/reload', { cache: 'no-store' });
    if (!res.ok) return;
    const { counter } = await res.json();
    if (_bootReloadCounter === null) { _bootReloadCounter = counter; return; }
    if (counter > _bootReloadCounter) {
      location.reload();
    }
  } catch (e) { /* bridge offline */ }
}
setInterval(pollReload, 3000);
document.addEventListener('DOMContentLoaded', pollReload);
```

## Design System

### Colors
- Dark mode: `#0d1117` background, `#c9d1d9` text, `#58a6ff` accent
- Light mode: `#ffffff` background, `#24292f` text, `#0969da` accent
- Success: `#3fb950` / `#1a7f37`
- Warning: `#d29922` / `#9a6700`
- Danger: `#f85149` / `#cf222e`

### Typography
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Headings: 600 weight, tight letter-spacing
- Body: 400 weight, 1.6 line-height
- Code: `'Cascadia Code', 'Fira Code', monospace`

### Spacing
- Section gap: `2rem`
- Card padding: `1.5rem`
- Element gap: `0.75rem`

### Interactive Elements
- Toggle switches: 44px wide, smooth transition, clear on/off state
- Checkboxes: custom styled, visible check mark
- Comment fields: `width: 100%` within their container, `min-height: 80px`,
  auto-expanding textarea
- Text inputs: `width: 100%` within container, generous padding (`0.75rem`)
- Submit button: in decision panel, full-width within panel
- Sliders: labeled endpoints, current value display, full container width
