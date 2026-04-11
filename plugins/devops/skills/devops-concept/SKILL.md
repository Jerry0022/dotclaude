---
name: devops-concept
version: 0.1.0
description: >-
  Generate an interactive HTML page for analysis, plans, concepts, prototypes,
  comparisons, or creative work — open it in the browser and monitor user
  decisions (toggles, selections, comments) to feed them back into the workflow.
  Triggers on: "concept", "mach mir eine seite", "zeig mir das interaktiv",
  "als webseite", "interaktive Übersicht", "concept page", "interactive plan",
  "show me this as a page", "visualize this".
  Also auto-suggest when Claude completes analysis, planning, comparison,
  or concept work that would benefit from interactive decision-making.
  Do NOT trigger for: simple code explanations (use /devops-explain), debugging
  (use /devops-flow), or static documentation (use /devops-readme).
argument-hint: "[topic, analysis result, plan, or concept to visualize]"
allowed-tools: Read, Write, Glob, Grep, Bash(start *), Bash(cmd *), AskUserQuestion, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__Claude_in_Chrome__*, mcp__plugin_devops_dotclaude-completion__*
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

## Step 1 — Determine Variant

Assess the content and select the appropriate variant:

| Variant | When to use | Interactive elements |
|---------|------------|---------------------|
| **analysis** | Data analysis, metrics review, findings | Toggles to accept/reject findings, priority selectors |
| **plan** | Implementation plans, roadmaps, migration strategies | Checkboxes to approve/skip steps, reorder drag, comments per step |
| **concept** | Architecture concepts, design proposals, feature specs | Toggle variants on/off, rate options, comment fields |
| **comparison** | Technology comparison, option evaluation | Side-by-side toggles, winner selection, weight sliders |
| **prototype** | UI mockups, flow prototypes, wireframes | Interactive UI elements, click-through flows |
| **dashboard** | Status overviews, metric dashboards, health checks | Filters, toggles, expandable sections |
| **creative** | Brainstorming, ideation, mind maps | Add/remove ideas, grouping, voting |

These variants are **recommendations, not rigid categories**. Mix elements
across variants, create hybrid layouts, or invent new structures when the
content calls for it. The table above is a starting point — adapt freely.

See `deep-knowledge/templates.md` for layout inspiration (also non-mandatory).

## Step 2 — Generate HTML

Build a single self-contained HTML file. Requirements:

### Design
- Modern, clean design with dark/light mode toggle
- Responsive layout (works on any screen size)
- No external dependencies — all CSS/JS inline
- Professional typography, spacing, and color palette
- Subtle animations for interactions (toggle, expand, submit)

### Decision Panel Layout
- The decision panel (submit button + global controls) is a **fixed sidebar**
  on the right side, taking **~20% of the screen width** — NOT an overlay
- Content area fills the remaining ~80% on the left
- On mobile/narrow screens: decision panel collapses to bottom (sticky)
- The panel is always visible while scrolling (position: fixed or sticky)

### Interactive Elements (per variant)
- **Toggles/checkboxes**: For binary decisions (accept/reject, include/exclude)
- **Selectors/sliders**: For prioritization, weighting, or rating
- **Comment fields**: Inline text areas for notes on each section —
  use `width: 100%` within their container, `min-height: 80px` for usability
- **Submit button**: Prominent "Entscheidungen abschicken" button in the
  decision panel sidebar

### Variant Evaluation (when variants exist)
When the concept presents multiple variants (concept, comparison, or any
multi-option output), each variant MUST include a **tri-state evaluation**:

| State | Label | Behavior |
|-------|-------|----------|
| **Verwerfen** | "Verwerfen" | Variant is completely discarded |
| **Miteinbeziehen** | "Miteinbeziehen" (default) | Variant is considered in the overall decision |
| **Nur diese** | "Exakt diese Variante" | Select ONLY this variant, discard all others |

- Default state for all variants: **Miteinbeziehen**
- "Nur diese" is exclusive — selecting it for one variant auto-sets all others
  to "Verwerfen" (with visual feedback and undo option)
- Each variant can ADDITIONALLY have rating, comments, and other controls
- The overall submit sends the tri-state per variant PLUS any additional ratings

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
5. Show visual confirmation ("Entscheidungen übermittelt")
6. Disable the submit button to prevent double-submit

### File Location

Write to: `{project}/.claude/devops-concept/{timestamp}-{slug}.html`

- `{timestamp}`: ISO date (`2026-04-05`)
- `{slug}`: kebab-case summary of the topic (max 40 chars)
- Create the directory if it doesn't exist
- Add `.claude/devops-concept/` to `.gitignore` if not already there

## Step 3 — Open in Browser

Open the generated HTML file as a **new tab in the existing Edge browser**.
If Edge is not running, launch it with the file.

```bash
# Windows — opens as new tab in running Edge, or launches Edge
start "" msedge "{filepath}"
```

On macOS: `open -a "Microsoft Edge" "{filepath}"`, on Linux: `microsoft-edge "{filepath}"`.

**Important:** Always target Edge specifically — never use the system default
browser or Chrome. The `start "" msedge` command reuses the running Edge instance
and adds a tab (no new window). The empty `""` is required on Windows — without
it, `cmd.exe` interprets the first quoted argument as a window title.

After opening, inform the user:

> Concept geöffnet. Triff deine Entscheidungen auf der Seite und klick
> "Entscheidungen abschicken" wenn du fertig bist — ich übernehme dann.

## Step 4 — Monitor for Feedback

Poll the browser page for the submit signal. Use `$BROWSER_TOOL` as determined
by the **Browser Tool Strategy** (`deep-knowledge/browser-tool-strategy.md`).
Use the tool mapping table to pick the right eval call.
If no browser tool is available → ask user to confirm manually via `AskUserQuestion`.

**Polling logic:**
- Check: `document.body.classList.contains('concept-submitted')`
- If true → read decisions from `#concept-decisions` JSON
- If false → wait and retry (max 5 minutes, check every 15 seconds)
- If timeout → ask user if they need more time or want to skip

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

### 5b. Process & Act
1. **Summarize** what was selected/rejected/commented
2. **Execute** the decisions immediately:
   - For plans: proceed with approved steps, skip rejected ones
   - For analysis: focus on accepted findings, deprioritize rejected ones
   - For concepts: develop chosen variant, archive alternatives
   - For comparisons: proceed with selected winner
### 5c. Update the Page
After processing, **update the HTML page in the browser** to reflect results:
1. Reset `submitted` to `false` in `#concept-decisions`
2. Remove `concept-submitted` class from `<body>`
3. Re-enable the submit button
4. Update the page content to show processed results, next decisions, or
   confirmation of completed actions
5. Add a visual "Verarbeitet" indicator on processed items

This allows the user to **review the updated state and submit again** for
further refinement or additional decisions.

### 5d. Resume Monitoring
Return to Step 4 (monitor for next submission). The loop continues until:
- The user closes the page
- The user says "fertig" / "done" in chat
- There are no more decisions to make (all items processed)

### 5e. Persist
Write a cumulative summary to `{project}/.claude/devops-concept/{same-slug}-decisions.json`
after each iteration (append, don't overwrite previous rounds).

## Step 6 — Completion

The feedback loop ends when the user is satisfied. Then continue with the
normal workflow. If the concept was the primary task, render a completion
card. If it was part of a larger task, proceed to the next step.

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
- The HTML must work offline — no fetch calls, no server dependency
- Keep file size reasonable (< 500KB) — inline only what's needed
