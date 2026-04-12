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

### Layout Modes

Choose the layout mode that fits the content best:

| Mode | When | Panel | Content |
|------|------|-------|---------|
| **Sidebar** (default) | Most concepts, comparisons, plans | Fixed sidebar ~20% right | ~80% left, scrollable |
| **Fullscreen + Overlay** | Visual prototypes, mockups, previews that need full width | Floating overlay button → slide-in panel | 100% content, panel overlays on demand |
| **Stacked** | Mobile / narrow screens (auto-fallback) | Sticky bottom bar | Full width, scrollable |

**Sidebar** is the default. Switch to **Fullscreen + Overlay** when the
content has large visuals (mockups, diagrams, previews) that benefit from
full-width display. The overlay panel is toggled via a floating action
button (bottom-right corner).

See `deep-knowledge/templates.md` § Layout Modes for CSS patterns.

### Decision Panel

The panel contains:
1. **Variant Navigation (TOC)** — each variant gets a clickable entry that
   smooth-scrolls to its section and shows the current evaluation state.
   Only evaluable items are listed, not headers or context sections.
   See `deep-knowledge/templates.md` § Variant Navigation for the pattern.
2. **Topic-specific controls** — additional elements relevant to the specific
   concept (e.g., global weight sliders for comparisons, filter toggles for
   dashboards, priority selectors for plans). These are placed between the
   navigation and the submit button. Adapt freely based on what the content
   needs — the panel is extensible, not fixed.
3. **Connection warning** — shown when Claude heartbeat is stale
4. **Submit button** + hint text
5. **Post-submit state** — waiting indicator

### Interactive Elements (per variant)
- **Toggles/checkboxes**: For binary decisions (accept/reject, include/exclude)
- **Selectors/sliders**: For prioritization, weighting, or rating
- **Star ratings**: Use the JS-based implementation from
  `deep-knowledge/interactive-components.md` — **never** use CSS-only
  `direction: rtl` hacks. Stars fill left-to-right, support hover preview,
  click-to-select, click-same-to-deselect, and re-selection.
- **Comment fields**: Inline text areas for notes on each section —
  use `width: 100%` within their container, `min-height: 80px` for usability
- **Submit button**: Prominent "Entscheidungen abschicken" button in the
  decision panel sidebar

See `deep-knowledge/interactive-components.md` for tested reference
implementations of all interactive components (star ratings, sliders,
toggles, expandable sections, comment fields).

### Variant Evaluation (when variants exist)
When the concept presents multiple variants (concept, comparison, or any
multi-option output), each variant MUST include a **tri-state evaluation**:

| State | Label | Type | Behavior |
|-------|-------|------|----------|
| **Miteinbeziehen** | "Miteinbeziehen" (default) | Feedback | Informs Claude's decision — variant stays in consideration |
| **Verwerfen** | "Verwerfen" | Feedback | Signals disinterest — Claude weighs this but takes no immediate action |
| **Nur diese** | "Exakt diese Variante" | ⚠️ Claude setzt um | Claude proceeds with ONLY this variant and discards all others |

- Default state for all variants: **Miteinbeziehen**
- "Nur diese" is exclusive — selecting it for one variant auto-sets all others
  to "Verwerfen" (with visual feedback and undo option)
- Each variant can ADDITIONALLY have rating, comments, and other controls
- The overall submit sends the tri-state per variant PLUS any additional ratings

**Visual indicators on the generated HTML page (mandatory):**
Each tri-state option button MUST show a visual indicator so the user sees
BEFORE clicking what kind of effect the selection has:
- **Miteinbeziehen** and **Verwerfen**: show a "(Feedback)" label — these
  are passive input, Claude considers them but takes no direct action
- **Exakt diese Variante** only: show a `⚠️ Claude setzt um` warning label
  directly on or below the button — the user must see this before submitting,
  so they understand clicking Submit will cause Claude to actively act on
  this choice (proceed with only this variant, discard all others)

### Reload Resilience

The HTML page MUST persist interactive element state via `sessionStorage` so
that user selections survive a page reload (F5). Include the state persistence
pattern from `deep-knowledge/templates.md` § State Persistence in every
generated concept page. Theme preference is also persisted to prevent flash.

The `concept-submitted` class is NOT persisted — after a reload the page is
back to "not yet submitted" (correct behavior, the user can re-submit).

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

Write to: `docs/concepts/{timestamp}-{slug}-v{version}.html`

**Fixed naming pattern** (all three segments mandatory, in this order):

| Segment | Format | Example |
|---------|--------|---------|
| `{timestamp}` | ISO date `YYYY-MM-DD` | `2026-04-12` |
| `{slug}` | kebab-case topic summary, max 40 chars | `auth-middleware-redesign` |
| `{version}` | Integer starting at `1`, incremented per revision of the same slug | `1` |

Full example: `docs/concepts/2026-04-12-auth-middleware-redesign-v1.html`

- Create the `docs/concepts/` directory if it doesn't exist
- This directory is **git-tracked** — concepts are project artifacts meant
  to be shared with other repo users
- To determine the next version: glob for `docs/concepts/*-{slug}-v*.html`,
  parse the highest existing version number, and increment by 1.
  If no match exists, start at `v1`

### Versioning vs. In-Place Update

| Situation | Action | Version |
|-----------|--------|---------|
| Feedback loop iteration (Step 5c) | Update the **same file** in-place, refresh the existing tab | No bump — stays `v1` |
| New concept session for the same topic (user revisits later) | Create a **new file** with incremented version | Bump → `v2`, `v3`, … |
| Fundamental rework after feedback (user says "nochmal neu") | Create a **new file** with incremented version | Bump → next `vN` |

**Rule of thumb:** within an active feedback loop, never bump the version.
A version bump only happens when a new file is created.

### Post-Generation Validation (mandatory gate)

After writing the HTML file, validate that all mandatory interactive patterns
are present. **Grep the generated file** for each required pattern:

| # | Pattern to grep | Purpose |
|---|----------------|---------|
| 1 | `concept-decisions` | Decision data JSON container |
| 2 | `concept-submitted` | CSS class for monitoring detection signal |
| 3 | `connection-warning` | Disconnection warning element |
| 4 | `checkClaudeConnection` | Heartbeat checker function |
| 5 | `HEARTBEAT_STALE_MS` | Heartbeat staleness threshold |
| 6 | `pollHeartbeat` | HTTP heartbeat polling function |
| 7 | `panel-ready` | Ready-state panel element |
| 8 | `panel-submitted` | Submitted-state panel element |
| 9 | `sessionStorage` | Reload resilience (state persistence) |
| 10 | `variant-nav` | Decision panel navigation / TOC (when variants exist) |

**If ANY pattern is missing → DO NOT open the page.** Fix the HTML first,
then re-validate. This is a **blocking gate** — no exceptions, no "this
page doesn't need it". Every concept page needs monitoring, every monitored
page needs the heartbeat guard.

**Common failures this gate catches:**
- Heartbeat system omitted → submit button stays clickable without monitoring
- Connection warning missing → user gets no feedback when Claude disconnects
- Panel states missing → no visual transition on submit/reset cycle
- sessionStorage missing → user selections lost on F5

The patterns in `deep-knowledge/templates.md` (§ Claude Connection Heartbeat,
§ Submit Handler, § State Persistence) provide the reference implementations.

## Step 3 — Open in Browser

Open the generated HTML file **inside the user's existing Edge window** — never
open a separate browser window. Follow the **Edge Credo**
(`deep-knowledge/browser-tool-strategy.md` § Edge Credo — Hard Rules):
- Always the user's installed Edge with their profile/login context
- New tab in running Edge — never a new window or sandboxed instance
- Claude extension for browser interaction (computer-use only if user chose desktop takeover)
- These rules apply regardless of execution mode (interactive, background, autonomous)

### Concept Bridge Server + Edge

The **concept bridge server** (`scripts/concept-server.py`) serves static files
AND provides HTTP endpoints for heartbeat and decision exchange.

1. Find the bridge server script:
   ```bash
   PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-server.py 2>/dev/null | head -1)
   ```

2. Start the bridge server in the concept directory:
   ```bash
   python "$PLUGIN_ROOT" {random-port} "{concept-dir}" &
   ```
   Use a random port (8700-8999) to avoid conflicts. Store the port as `$PORT`.

3. Set up the heartbeat cron (keeps the connection indicator green):
   ```
   CronCreate(cron: "* * * * *", prompt: "Run: curl -s -X POST http://localhost:{port}/heartbeat > /dev/null")
   ```
   This fires every ~60s. For tighter heartbeat, also send an initial POST
   immediately and on each monitoring poll via Bash.

4. Send the first heartbeat immediately:
   ```bash
   curl -s -X POST http://localhost:{port}/heartbeat
   ```

5. Open in Edge (reuses the running instance, adds a tab):
   ```bash
   # Windows — per Edge Credo (see browser-tool-strategy.md)
   start "" msedge "http://localhost:{port}/{filename}"
   ```
   On macOS: `open -a "Microsoft Edge" "http://…"`, on Linux: `microsoft-edge "http://…"`.

   The empty `""` is required on Windows — without it, `cmd.exe` interprets
   the first quoted argument as a window title.

6. After monitoring ends, clean up:
   ```bash
   kill %1  # or track the PID
   ```
   Also delete the heartbeat cron via `CronDelete`.

### After opening, inform the user:

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
- **Initial wait**: 10 seconds after opening
- **Poll interval**: 15 seconds (via conversation-driven checks or cron)
- **Timeout**: 5 minutes → ask user via AskUserQuestion
- On each poll, also POST `/heartbeat` to keep the connection indicator green

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
2. **Execute** the decisions immediately — "Execute" means **Claude acts** based
   on the submitted feedback. The concept page itself does nothing when the user
   clicks Submit; it only records the decisions and signals Claude. It is Claude
   who then reads those decisions and takes the actual action (writes code, updates
   a plan, archives alternatives, etc.). The page is the input channel — Claude
   is the actor:
   - For plans: proceed with approved steps, skip rejected ones
   - For analysis: focus on accepted findings, deprioritize rejected ones
   - For concepts: develop chosen variant, archive alternatives
   - For comparisons: proceed with selected winner
### 5c. Update the Page
After processing, **update the HTML page in the browser** to reflect results.

**In-place update (same version, normal case):**
1. Reset `submitted` to `false` in `#concept-decisions`
2. Remove `concept-submitted` class from `<body>`
3. Re-enable the submit button
4. Update the page content to show processed results, next decisions, or
   confirmation of completed actions
5. Add a visual "Verarbeitet" indicator on processed items

For JS eval, use the browser tool waterfall from
`deep-knowledge/browser-tool-strategy.md` (Playwright → Preview).
If no eval tool is available, inform the user to refresh the page manually.

This allows the user to **review the updated state and submit again** for
further refinement or additional decisions.

**New version (version bump, e.g. after "nochmal neu"):**
When a new version file is created while the old tab is still open:
1. Write the new HTML file (`docs/concepts/…-v{N+1}.html`)
2. The bridge server already serves all files in `docs/concepts/` — the new
   file is immediately accessible at `http://localhost:{port}/{new-filename}`
3. **Redirect the existing tab** by overwriting the old HTML file with a
   minimal redirect page:
   ```html
   <!DOCTYPE html>
   <html><head>
     <meta http-equiv="refresh" content="0;url=http://localhost:{port}/{new-filename}">
   </head><body>
     <p>Neue Version: <a href="http://localhost:{port}/{new-filename}">{new-filename}</a></p>
   </body></html>
   ```
   The user's tab auto-navigates to the new version within 1 second.
4. Do NOT leave the old tab in "Entscheidungen übermittelt" state — the user
   must never be stuck waiting on a tab that Claude is no longer monitoring

### 5d. Resume Monitoring
Return to Step 4 (monitor for next submission). The loop continues until:
- The user closes the page
- The user says "fertig" / "done" in chat
- There are no more decisions to make (all items processed)

### 5e. Persist
Write a cumulative summary to `docs/concepts/{same-timestamp}-{same-slug}-v{same-version}-decisions.json`
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
- The HTML must be self-contained — no CDN or external fetch calls.
  Bridge server fetch calls (`/heartbeat`, `/decisions`) are the only exception
- Keep file size reasonable (< 500KB) — inline only what's needed
