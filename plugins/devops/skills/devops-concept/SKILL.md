---
name: devops-concept
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
  (use /devops-flow), or static documentation (use /devops-readme).
argument-hint: "[topic, analysis result, plan, or concept to visualize]"
allowed-tools: Read, Write, Glob, Grep, Bash(start *), Bash(cmd *), Bash(python *), Bash(curl *), Bash(kill *), AskUserQuestion, CronCreate, CronDelete, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__plugin_devops_dotclaude-completion__*
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

## Step 1 — Pick Template, then Content Variant

### 1a. Pick the page template (layout mode)

Every concept page uses one of three layout **templates**. Pick via the
**strict ordered check below** — first matching template wins, free is the
explicit fallback when neither of the first two applies. Do NOT skip the
order; `free` must never be chosen while `prototype` or `decision` would
also fit.

**Order of evaluation (mandatory):**

1. **Is this a PROTOTYPE?**
   Visual mockup, wireframe, click-through flow, screen-by-screen UI design,
   any "design me / sketch / lay out a UI" task. If the output needs maximum
   viewport real estate and per-screen feedback → `prototype`. **Stop.**

   **Prototype is almost always a click-dummy.** If there are 2+ screens,
   the mockup's own buttons/links MUST be wired to navigate between screens
   (not just styled rectangles) — clicking "Continue" on screen 1 lands on
   screen 2, "Back" returns, etc. See `deep-knowledge/templates.md`
   § Template: prototype for the `data-screen-link` attribute pattern.

   **"Screen" is a logical state, not a full page.** A screen can be a
   distinct view (welcome → credentials → success), but it can also be a
   meaningful state of the same view (modal closed → modal open → form
   submitted, tab A → tab B, collapsed drawer → expanded drawer, empty
   list → populated list). Every state the user should be able to give
   feedback on separately becomes its own `<section data-screen>`.

   **Single-screen prototype (exactly one `data-screen`):** no screen-nav,
   no per-screen feedback textarea — the dock shows ONLY the general-notes
   textarea. A static single-screen prototype needs no click-dummy wiring.
   Do NOT invent artificial "screens" to justify the template; if the
   artefact has no meaningful secondary states, one screen is correct.

   **Design system:** the prototype MUST follow the project's existing
   design system (colors, typography, component shapes, spacing) unless
   the user explicitly asks for a different style in the request. Check
   `design-tokens.*`, `theme.*`, `tailwind.config.*`, Figma tokens via
   the design MCP, or the existing UI code before inventing a look.

2. **Is this a DECISION?**
   Multi-option evaluation where the user must pick from 2+ mutually-exclusive
   alternatives (architecture, tech, strategy, library, approach, …). If there
   are explicit variants A/B/C with pros/cons to weigh → `decision`. **Stop.**

3. **Otherwise → FREE.**
   Only reach this step after 1 AND 2 have both been ruled out. Analysis,
   walkthrough, brainstorm, explainer, timeline, status deep-dive, retro,
   post-mortem — structured content that has no forced variant framing.
   Tri-state is opt-in per section (Claude adds it only where a finding
   genuinely needs user evaluation).

| Template | Layout signature |
|---|---|
| **prototype** | Fullscreen content, overlay decision panel (FAB right), bottom feedback dock (per-screen comments) |
| **decision** | Sidebar (~80/~20), variant cards, tri-state per variant |
| **free** | Sidebar (~80/~20), Claude-authored freeform body, optional tri-state per section |

**Tie-breakers:**
- A page with variants AND mockups (rare) is a `decision` with inline mockups,
  not a `prototype` — prototype is reserved for single-artefact presentation.
- A page that presents one recommended approach (no alternatives) is `free`,
  not `decision` — decision requires ≥2 mutually-exclusive options.

Set `<html data-template="...">` on the generated file so `collectDecisions`
picks the right branch and template-specific CSS/JS activates. See
`deep-knowledge/templates.md` for the full layout reference.

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

Prototype and free templates have no sub-variants — their body is
content-specific (prototype = visual mockup; free = Claude-authored).

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

### Decision Panel Layout (template-specific)

Panel layout depends on the template picked in Step 1a:

| Template | Panel mode | Extras |
|---|---|---|
| **decision** | Fixed sticky sidebar (~20% screen width), always visible | — |
| **prototype** | Overlay panel (360px slide-in from right), FAB-toggled | Collapsible **feedback dock** at the bottom with per-screen comments |
| **free** | Fixed sticky sidebar (~20%), always visible | — |

On narrow screens (<768px), sidebar-mode panels collapse to a sticky bottom
bar. Overlay panels already work on mobile via the FAB.

**Panel top-to-bottom order (identical across all templates):**
1. **Iteration tabs** (`.iteration-tabs`) — compact vertical chip list,
   one per iteration. Active chip = current round; older chips stay
   clickable to review frozen snapshots.
2. **Section TOC** (`.section-nav`) — auto-populated from EVERY
   `<section id="…" data-nav-label="…">` inside the active iteration.
   Not limited to variants: Ist-Zustand, context blocks, design notes,
   mockups — anything with a nav label gets a scroll anchor here.
3. Decision summary + submit button.
4. Connection warning + post-submit state.

The iteration tab bar must NEVER live inside the left-hand content area.
The content area is reserved for the actual concept.

### Interactive Elements (per variant)
- **Toggles/checkboxes**: For binary decisions (accept/reject, include/exclude)
- **Selectors/sliders**: For prioritization, weighting, or rating
- **Comment fields**: Inline text areas for notes on each section —
  use `width: 100%` within their container, `min-height: 80px` for usability
- **Submit button**: Prominent "Entscheidungen abschicken" button in the
  decision panel sidebar

### Evaluation Rules (by template) — bi-state

Variant/section evaluation uses a **bi-state selector** (not tri-state):

| Template | Evaluation behavior |
|---|---|
| **decision** | **Mandatory per variant card.** Every variant MUST carry the bi-state selector. |
| **prototype** | **No evaluation.** Feedback is collected via the bottom feedback dock (per-screen textareas + general notes). |
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

The decision panel always shows **two submit buttons**, never one. A
decision-panel submit by itself MUST NEVER trigger code changes — that only
happens when the user explicitly clicks the implement button.

| Button | Label (de / en) | Action | Style |
|---|---|---|---|
| Primary | "Zur nächsten Iteration" / "Next iteration" | `action: "iterate"` — Claude processes the feedback and appends a new iteration section (no code changes) | Full-width, accent color |
| Secondary | "Mit Feedback implementieren" / "Implement with feedback" | `action: "implement"` — Claude applies the selections as actual code/file changes | Warning-colored border, extra top margin (~2rem) so the user cannot misclick, ⚠ icon |

The click-away handler in the feedback dock does NOT apply to these buttons
— they are explicit commits. The extra gap before the implement button is
mandatory: the user must move the mouse deliberately to reach it.

`collectDecisions()` adds `action: "iterate" | "implement"` to the payload
based on which button was clicked. Claude reads that field and either runs
another iteration (Step 5c) or executes code changes (Step 5b).

This applies to **all three templates** — even prototype (implement = "build
what we prototyped with the feedback") and free (implement = "act on the
findings I marked Miteinbeziehen").

### Prototype Feedback Dock

The prototype template has no tri-state. Instead, a collapsible **feedback
dock** at the bottom of the viewport holds structured feedback:

- A top-level textarea for general notes on the prototype
- One textarea per `<section data-screen>` inside the active iteration,
  auto-populated by the dock (label = `data-nav-label` of that screen)

The dock is toggled via a floating action button (bottom-left). See
`deep-knowledge/templates.md` § Template: prototype for the full HTML/CSS/JS.

### Reload Resilience

The HTML page MUST persist interactive element state via `localStorage` (with
a 24-hour TTL) so that user selections survive page reloads, accidental tab
closes, and even browser restarts. Include the state persistence pattern from
`deep-knowledge/templates.md` § State Persistence in every generated concept
page. Theme preference is also persisted to prevent flash.

The `concept-submitted` class is NOT persisted — after a reload the page is
back to "not yet submitted" (correct behavior, the user can re-submit).

### Page Version Tag

Set `data-page-version="{timestamp}"` on the `<html>` element (use the
ISO timestamp of generation, e.g. `2026-04-15T14:30:00`). This value is
stored alongside localStorage state. When the page version changes (new
generation), old localStorage state is automatically discarded so the user
sees a clean new version instead of stale selections from a previous page.

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
4. Add class `concept-submitted` to `<body>`
5. Switch the decision panel from "ready" to "submitted" state — showing a
   clear "Entscheidungen übermittelt" indicator with a hint to switch to the
   Claude chat (see `deep-knowledge/templates.md` § Submit Handler)

**Decision panel states:**
- **Ready**: Submit button active, decision summary visible
- **Disconnected**: Submit button disabled, warning banner visible (Claude
  heartbeat stale — see `deep-knowledge/templates.md` § Claude Connection Heartbeat)
- **Submitted**: Waiting indicator, "Wechsle zum Claude Chat" hint
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
- This directory is **git-tracked** — concepts are project artifacts meant
  to be shared with other repo users
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

After writing the HTML file, grep it for the 22 mandatory interactive
patterns (heartbeat, panel states, iteration tabs, section TOC, reload
polling, generic form-collection catch-all scoped to the active
iteration, etc.).
**If ANY pattern is missing → DO NOT open the page.** Fix the HTML first,
then re-validate. See `deep-knowledge/validation-gate.md` for the full
pattern list and common failure modes.

## Step 3 — Open in Browser

Open the generated HTML file **inside the user's existing Edge window** — never
open a separate browser window.

### Concept Bridge Server + Edge

Start the bridge server (`scripts/concept-server.py`) on a random port
(8700-8999), arm the combined heartbeat + auto-poll cron (fires every
minute, handles heartbeat + decision pickup + conditional reset), send
the first heartbeat, and open the page in the user's existing Edge window.

See `deep-knowledge/bridge-server.md` for the full setup — script lookup,
launch command, cron body, rationale for `/pending` over substring checks,
and cleanup.

### After opening, inform the user:

Pick the wording that matches the `[ui-locale: ...]` hint injected by
`prompt.knowledge.dispatch.js` (defaults to `en`):

**en:**
> Concept opened. Make your decisions on the page and click
> "Submit decisions" when you're done — I'll take it from there.

**de:**
> Concept geöffnet. Triff deine Entscheidungen auf der Seite und klick
> "Entscheidungen abschicken" wenn du fertig bist — ich übernehme dann.

## Step 4 — Monitor via HTTP Bridge

The bridge server handles all communication — no JS eval injection needed.

**Heartbeat** is handled by the cron job set up in Step 3. Additionally,
send a heartbeat POST on each manual poll cycle:

```bash
curl -s -X POST http://localhost:$PORT/heartbeat
```

**Polling for decisions** — check if the user has submitted:

```bash
curl -s http://localhost:$PORT/decisions
```

Parse the JSON response. If `submitted` is `true` → process decisions (Step 5).
If `false` → wait and retry.

**Polling schedule:**
- **Primary mechanism**: the combined cron from Step 3 fires every minute and
  handles heartbeat + decision pickup + reset automatically. No manual polling
  needed from Claude between user turns.
- **Initial wait**: 10 seconds after opening, then send one manual heartbeat +
  decision check to close the 0–60 s gap before the first cron tick lands.
- **No timeout** — monitoring runs indefinitely until the user ends it
  (says "fertig"/"done", closes the page, or closes Claude).
- **On demand**: if the user asks "did my submission arrive?", do a manual
  `curl http://localhost:$PORT/decisions` — do NOT wait for the next cron tick.

**Important:** While waiting, do NOT block the conversation. Inform the
user that you're monitoring and they can continue chatting. If the user
sends a message while monitoring, pause monitoring and respond normally.
Resume monitoring after responding.

## Step 5 — Live Feedback Loop

Feedback is processed **iteratively**, not as a one-shot. The cycle:

```
User submits → Claude reads → Claude processes → Claude updates page → User can act again
```

### 5a. Read & Parse
1. Read the JSON from `#concept-decisions`
2. Parse into structured decisions and comments

**Coverage check:** before processing decisions, verify every named form
field that exists in the just-frozen iteration HTML appears in the
`decisions` payload (specifically the `allFields` catch-all). If a field
is in the DOM but missing in the payload, flag it to the user immediately
("the JS missed these fields, please re-submit after I fix the collection
function"). See `deep-knowledge/validation-gate.md` § Generic Form
Collection for the required pattern.

### 5b. Process & Act — branch by `action`

The submit payload carries an `action` field (`"iterate"` or `"implement"`).
Branch on it:

**`action: "iterate"` (default — "Zur nächsten Iteration" button):**
1. **Summarize** what was selected/rejected/commented
2. **Do NOT modify code, files, or external systems** — iterate ONLY updates
   the concept page
3. Proceed to Step 5c (append next iteration with refined options that
   reflect the Miteinbeziehen/Verwerfen choices)

**`action: "implement"` ("Mit Feedback implementieren" button):**
1. **Summarize** what was selected/rejected/commented
2. **Execute** the decisions as real changes — "Execute" means Claude acts:
   - For plans: implement the approved steps
   - For concepts: develop the chosen variant, archive alternatives
   - For comparisons: proceed with the implicitly-selected winner (all
     others marked Verwerfen)
   - For free-template findings: apply the Miteinbeziehen findings as fixes
   - For prototypes: build the designed UI/flow with the feedback applied
3. After the implementation is done, still append a new iteration that
   shows "implementiert — siehe commit {hash}" as a frozen record, so the
   concept page stays the source of truth for what happened

**Critical invariant:** a submit with `action: "iterate"` MUST NEVER cause
code or file changes outside of the concept HTML file itself. The user
relies on that guarantee to explore ideas safely.
### 5c. Update the Page
After processing, **append a new iteration tab** to the same HTML file and
signal the browser to reload. This is the ONLY update path — there is no
separate "in-place edit" vs. "new file" distinction anymore.

Procedure on every iteration (including the very first response to feedback).
Before the steps below, POST `/reset` with the captured `_version` (see cron
prompt in Step 3). This stamps `_processed_at` on the server so the
browser's `pollProcessedState` can restore the panel to the ready state
automatically — Claude does NOT send a browser-eval reset. The subsequent
`pollReload` tick picks up the file rewrite and the tab reloads onto the
new active iteration. See `deep-knowledge/templates.md` § Panel State Reset
for the polling contract.

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
3. Append a new `<section data-iteration="{N+1}" data-active>` with the
   updated / next-round content (new variants, refined options, whatever
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

The tab bar is anchored at the top of the right-side decision panel —
above the section TOC and the submit block. It must never appear inside
the left-hand content area. Render as a compact vertical chip list.

Do NOT write a redirect file. Do NOT create a new `-v{N}` file. The entire
concept session — first render, every iteration, "nochmal neu" reworks —
lives in the single `{date}-{slug}.html`.

### 5d. Resume Monitoring
Return to Step 4 (monitor for next submission). The loop continues until:
- The user closes the page
- The user says "fertig" / "done" in chat
- There are no more decisions to make (all items processed)

### 5e. Persist
Write a cumulative summary to `docs/concepts/{same-timestamp}-{same-slug}-decisions.json`
after each iteration (append a new entry per iteration — don't overwrite
previous rounds; each entry records its `iteration` number).

## Step 6 — Completion Card

The feedback loop ends when the user is satisfied (user says "fertig"/"done",
closes the page, or all items are processed). Then render a completion card.

Call `mcp__plugin_devops_dotclaude-completion__render_completion_card`:

| Situation | Variant |
|-----------|---------|
| Concept was the primary task (read-only result) | `analysis` |
| Concept submitted decisions → Claude executed code changes in Step 5b | `ready` (code edits happened) |
| Concept discarded / user aborted | `aborted` |

Pass: `variant`, `summary` (e.g. "Concept auth-middleware-redesign finalized"),
`lang`, `session_id`, `changes` (what the concept covered and which decisions
were acted on), and `state` when files changed.

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
