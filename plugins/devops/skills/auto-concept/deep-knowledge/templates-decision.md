# Concept templates, part 07 of 43: Template: decision

# Template: decision

Multi-variant evaluation in a document column, with the ☰ overlay panel over
it. This is the canonical flow: Claude presents 2+ options, user picks
bi-state per variant, submits, Claude iterates.

## Layout — Document rounds (decision / free)

The content column fills the page; the decision panel is the **same ☰ overlay
a design round uses** and is not part of the flow, and the **same 💬 feedback
dock** sits on the bottom-right FAB — reduced to its general-notes section
here (#399). There is no docked-sidebar variant any more — see § Panel Chrome
(all templates) for why both are page chrome rather than a per-template
layout, and for the markup + CSS + JS every page carries.

```css
.concept-layout {
  display: flex;
  min-height: 100vh;
}
.concept-content {
  flex: 1;
  /* The panel is position: fixed, so the column no longer competes with a 20%
     sidebar. Capped for line length instead — a 2000px paragraph is not an
     improvement over the old split. Design rounds lift the cap (see the
     design-mode rule in § Fullscreen canvas). */
  max-width: 1100px;
  margin: 0 auto;
  padding: 2rem;
  overflow-y: auto;
}
/* The ☰ FAB is fixed at top: 2rem; right: 2rem and would otherwise sit on the
   header's right edge (a long <h1> or subtitle runs under it — the header
   carries no controls of its own any more, the theme toggle is in the panel
   head). 92px = the FAB's 60px circle plus its 2rem margin. */
.concept-content > header { padding-right: 92px; }
```

## Bi-State Variant Evaluation

**Legacy control.** New decisions are authored in one of the seven decision
modes (`decision-modes.md`; markup in `templates-analysis.md` § Decision
modes) — a `[data-decision]` with `data-decision-mode`. A `[data-decision]`
WITHOUT a mode is this bi-state: old and frozen rounds keep it and its
`evaluation` payload unchanged, and a new round may still use it for its one
fitting job — independent items, each taken or left — though `multi` is
preferred there. Mutually exclusive alternatives are always `single`, never
the emulation below (gate A7).

In a legacy-style decision page, every variant includes a **bi-state**
selector with exactly two options.

| State | Label | Behavior |
|-------|-------|----------|
| **Miteinbeziehen** | "Miteinbeziehen" | Claude considers this variant in the next iteration or implementation |
| **Verwerfen** | "Verwerfen" | Claude discards this variant and excludes it from all further steps |

- **The pre-selected state is Claude's recommendation** — the user may flip
  any of them, nothing is locked:
  - **Mutually exclusive alternatives** (only one can be built — one
    architecture, one library, one strategy) are a `single` decision in new
    rounds. On a legacy page: exactly ONE variant is pre-selected
    **Miteinbeziehen** — the one Claude recommends — and every other one
    **Verwerfen**. All-included reads as "take them all", which an exclusive
    choice cannot mean and which left users unsure what to do.
  - **Independent topics or findings** (each can be taken on its own):
    **Miteinbeziehen** by default; **Verwerfen** only where Claude actually
    advises against one.
  - A page may mix both: decide per `[data-decision]` group.
- No "Nur diese" / "only" option and no third state — a single pick out of
  alternatives is a `single` decision (radio cards), not a bi-state
- No "Claude setzt um" / "Feedback" hint labels — the action-vs-feedback
  distinction is now expressed by the two submit buttons (iterate vs.
  implement), NOT by the evaluation selector
- Each variant can ADDITIONALLY have rating, comments, and other controls

### HTML

Every `[data-decision]` group MUST be followed by an adjacent
`<textarea data-comment="$decisionId-note" data-attachable>` so the user can
attach a free-form override (e.g. "only for X", "with variant Y") to the
bi-state choice, and attach a file to it (§ Attachments). Place the textarea
inside the same row container so the comment is visually anchored to the
card. The catch-all `collectAllFormFields` picks it up via `data-comment`
without any collector change. Always emit the full `.decision-comment-row`
wrapper with its label, never a bare `<textarea>` after the group — the bare
form only gets the CSS safety net below, not the label.

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
  <div class="field-row decision-comment-row">
    <label for="variant-a-note">{{decision.comment_label}}</label>
    <textarea id="variant-a-note"
              data-comment="variant-a-note"
              data-attachable
              placeholder="{{decision.comment_placeholder}}"
              rows="2"></textarea>
  </div>
</div>
```

Legacy class names `tri-state-group` / `tri-state-option` / `tri-state-label`
are deprecated but still accepted by the CSS selectors below for backward
compatibility.

**Backwards compatibility:** older pages that emitted the bi-state group
without the textarea are upgraded at runtime by `ensureCommentSlots()` (see
§ Shared Systems → Comment Slot Injection). Generated pages SHOULD still
emit the textarea inline so the validation gate and `localStorage` restore
see it immediately, but the JS safety net guarantees the user always has
the override slot.

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

/* Per-decision comment row — slotted directly under the bi-state group so
   the override is visually anchored to the variant card. Width tracks the
   group width via the container. The field matches the 💬 dock's textarea
   (.feedback-section textarea: 80px ≈ three lines, 10px radius, --input-bg)
   so every note field on the page looks the same; resize stays vertical and
   max-width 100% so a drag never widens the page into a horizontal scroll. */
.decision-comment-row {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.decision-comment-row label {
  font-size: 0.78rem;
  color: var(--text-muted, #8b949e);
  font-weight: 500;
  letter-spacing: 0.01em;
}
.decision-comment-row textarea {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-height: 80px;
  padding: 0.65rem 0.7rem;
  border-radius: 10px;
  border: 1px solid var(--border-color, #30363d);
  background: var(--input-bg, #0d1117);
  color: var(--text-color, #c9d1d9);
  font: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  resize: vertical;
  transition: border-color 0.15s;
}
.decision-comment-row textarea:focus {
  outline: none;
  border-color: var(--accent-color, #58a6ff);
}
.decision-comment-row textarea::placeholder {
  color: var(--text-muted, #8b949e);
  opacity: 0.6;
}
/* Safety net for a comment textarea emitted WITHOUT the row wrapper (a bare
   `<textarea data-comment>` after the bi-state group). Without it the browser
   default applies: monospace, ~20 columns, two rows, system-grey border.
   The :not() list keeps it off every textarea that already has its own look
   (feedback dock, the row above, comment field, mapping slot note, annotation
   answer), and :where() keeps specificity at zero so a page rule still wins. */
:where(textarea[data-comment]:not(#feedback-dock textarea, .decision-comment-row textarea, .comment-field textarea, .map-slot-note textarea, .anno-answer)) {
  box-sizing: border-box;
  display: block;
  width: 100%;
  max-width: 100%;
  min-height: 80px;
  margin-top: 0.75rem;
  padding: 0.65rem 0.7rem;
  border-radius: 10px;
  border: 1px solid var(--border-color, #30363d);
  background: var(--input-bg, #0d1117);
  color: var(--text-color, #c9d1d9);
  font: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  resize: vertical;
  transition: border-color 0.15s;
}
:where(textarea[data-comment]:not(#feedback-dock textarea, .decision-comment-row textarea, .comment-field textarea, .map-slot-note textarea, .anno-answer)):focus {
  outline: none;
  border-color: var(--accent-color, #58a6ff);
}
:where(textarea[data-comment]:not(#feedback-dock textarea, .decision-comment-row textarea, .comment-field textarea, .map-slot-note textarea, .anno-answer))::placeholder {
  color: var(--text-muted, #8b949e);
  opacity: 0.6;
}
```

**Behavior:**
- Default: "Miteinbeziehen" (all variants considered)
- "Verwerfen": grays out the variant card visually (still accessible)
- A single pick out of alternatives is a `single` decision in new rounds; a
  legacy page reads it as the one "Miteinbeziehen" left among "Verwerfen"

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
  "comments": {
    "general": { "text": "...", "attachments": [] },
    "items": [
      { "id": "variant-a-note", "text": "...", "attachments": [] }
    ]
  }
}
```

`comments` is the one shape every template emits (§ collectDecisions
(dispatcher)): `general` is the 💬 dock's general note — always present, even
empty — and `items` lists every inline note of the live round that carries
text or an attachment.

`evaluation` values: `"discard"` | `"include"`
`action` values: `"iterate"` | `"implement"` — determined by which submit
button the user clicked. See § Two-Button Submit below.

## Content Variants (within the decision template)

The decision template has six content sub-variants. They describe the shape
of the variant cards — not a different page layout. Every question on them is
a decision in one of the seven modes (`decision-modes.md`, markup in
`templates-analysis.md` § Decision modes); the include / discard bi-state
above is the legacy control and there is no tri-state, no "Nur diese" and no
priority selector.

### Variant: analysis

**Purpose:** Analysis results and the decisions that follow from them.

This variant is the guided **Full** analysis: `data-analysis="full"` on the
`decision` round — Briefing → Themenfelder → one decision per stage →
Review. Markup in `templates-analysis.md`; authoring rules (Full vs Lite,
briefing, kurz / lang per level) in `step1-templates.md` § 1b · Analysis
results and decisions — Full vs Lite; displays from `analysis-palette.md`.

```
[Briefing: Analyse → Potential (KPI) → Themenfelder (≤ 3) → "Los geht's" (duration)]

[Themenfeld 1]
  [Decision stage]                         [Analysis column ≈ 33 %]
    ├── Gilt für (quiet text)                ├── L1 Briefing  · short
    ├── Question (largest type)              ├── L2 Themenfeld · short (its result)
    ├── One context sentence                 └── L3 this decision · long (palette display + 2–4 sentences)
    ├── Options in the mode, ★ = recommendation, preselected
    ├── Note (one inline field) · "Als Issue anlegen"
    └── Weiter (Enter) · Zurück (⇧ + Enter)

[Review: deviations → issues → untouched; "Was deine Auswahl bewirkt" chart]
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
  └── [Comment field (wide, min-height: 80px)]

[Variant B: Name]
  └── ...

[Decision, mode single: "Welche Architektur bauen wir?" — one option card
 per variant (outcome label + consequence), ★ = recommendation, preselected]

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
  └── [Comment field (wide)]

[Decision, mode single: the winner — one option card per candidate, ★ preselected]
[Decision panel sidebar: summary + submit]
```

The winner is ONE `single` decision across the options (`decision-modes.md`),
never a bi-state per option — N include / discard toggles for one exclusive
choice is gate warning A7. Legacy pages with a bi-state per option keep their
`evaluation` payload; weight sliders still add `weight-*` entries.

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

