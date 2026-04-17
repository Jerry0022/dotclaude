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

| State | Label | Type | Behavior |
|-------|-------|------|----------|
| **Miteinbeziehen** | "Miteinbeziehen" (default) | Feedback | Informs Claude's decision — no immediate action taken |
| **Verwerfen** | "Verwerfen" | ⚠️ Claude setzt um | Claude actively discards this variant and excludes it from all further steps |
| **Nur diese** | "Exakt diese Variante" | ⚠️ Claude setzt um | Claude proceeds with only this variant and discards all others |

- Default state for all variants: **Miteinbeziehen**
- "Nur diese" is exclusive — selecting it for one variant auto-sets all others
  to "Verwerfen" (with visual feedback and undo option)
- Each variant can ADDITIONALLY have rating, comments, and other controls
- The overall submit sends the tri-state per variant PLUS any additional ratings

**Visual indicators on the generated HTML page (mandatory):**
Each tri-state option button MUST show a visual indicator so the user sees
BEFORE clicking what kind of effect the selection has:
- **Miteinbeziehen**: show a subtle info icon (ℹ) or "(Feedback)" label —
  this is passive input, Claude will consider it but take no direct action
- **Verwerfen** and **Exakt diese Variante**: show a `⚠️ Claude setzt um`
  warning label directly on or below the button — the user must see this
  before submitting, so they understand clicking Submit will cause Claude to
  actively act on this choice (discard a variant, write code, update a plan, etc.)

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

Every concept page is a stack of iteration tabs. The **tab bar lives in the
decision panel at the top** of the content area (a slim strip above the
variants, not in the right sidebar — the sidebar stays reserved for submit
controls). Each tab shows exactly one iteration; the active one is interactive,
all earlier ones are frozen (disabled inputs showing the user's submitted
selections, read-only comments).

| Situation | Action | Result |
|-----------|--------|--------|
| First generation | Write the file with `<section data-iteration="1" data-active>` and one tab "Iteration 1" | Tab 1 active |
| Feedback loop iteration (Step 5c) | Append `<section data-iteration="N+1" data-active>` to the same file, remove `data-active` from the previous section, freeze it, add a new tab and make it active | New tab "Iteration N+1" auto-active, old tab selectable and read-only |
| Fundamental rework ("nochmal neu") | Same as a feedback iteration — just another tab. The full history stays visible. | Another tab appended |

**Rules:**
- **Never create a second file** for iterations of the same concept — always
  append a section to the existing file and POST `/reload` (see Step 5c).
- The active iteration is the only one that accepts input. Submit sends
  decisions for the active iteration only.
- Freeze previous iterations visually: disabled tri-state buttons showing
  which state the user submitted, read-only comment fields with the text
  the user entered. Users can click back to earlier tabs to review their
  own past feedback at any time.
- Only the active tab runs the heartbeat / submit UI ("music"). Clicking
  an older tab shows its frozen snapshot but does not re-arm submit.
- Tab bar must stay compact (one line, horizontally scrollable if many
  iterations) so it does not push variant content out of view.

See `deep-knowledge/templates.md` § Iteration Tabs for the reference
HTML/CSS/JS.

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
| 6 | `HEARTBEAT_GRACE_MS` | Grace period — suppresses warning during startup |
| 7 | `pollHeartbeat` | HTTP heartbeat polling function |
| 8 | `panel-ready` | Ready-state panel element |
| 9 | `panel-submitted` | Submitted-state panel element |
| 10 | `localStorage` | Reload resilience (state persistence with TTL) |
| 11 | `data-page-version` | Page version tag for localStorage invalidation |
| 12 | `data-iteration` | Iteration section marker |
| 13 | `iteration-tabs` | Tab bar container in the decision panel |
| 14 | `pollReload` | Reload-signal poller (picks up file rewrites) |
| 15 | `sec.hidden` | Tab-switch JS toggles the `hidden` attribute — prevents all iterations rendering at once |

**If ANY pattern is missing → DO NOT open the page.** Fix the HTML first,
then re-validate. This is a **blocking gate** — no exceptions, no "this
page doesn't need it". Every concept page needs monitoring, every monitored
page needs the heartbeat guard.

**Common failures this gate catches:**
- Heartbeat system omitted → submit button stays clickable without monitoring
- Connection warning missing → user gets no feedback when Claude disconnects
- Panel states missing → no visual transition on submit/reset cycle
- localStorage missing → user selections lost on reload or tab close

The patterns in `deep-knowledge/templates.md` (§ Claude Connection Heartbeat,
§ Submit Handler, § State Persistence) provide the reference implementations.

## Step 3 — Open in Browser

Open the generated HTML file **inside the user's existing Edge window** — never
open a separate browser window.

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

3. Set up the **combined heartbeat + auto-poll cron**. This single cron keeps
   the connection indicator green AND automatically picks up user submissions
   — no manual trigger needed from the user.

   ```
   CronCreate(cron: "* * * * *", recurring: true, prompt: <<EOF
   Silently run both steps for the concept bridge on port {port}:

   (1) Heartbeat POST:
       Bash: curl -s -X POST http://localhost:{port}/heartbeat > /dev/null

   (2) Decision poll with optimistic-concurrency reset:
       Bash: curl -s http://localhost:{port}/decisions

       If the response contains `"submitted":true` →
         • Note the `_version` field from the response.
         • Parse the JSON (decisions + comments) — strip `_version` before processing.
         • Process them per Step 5 (Live Feedback Loop) — act on the user's
           choices (approve/tweak/reject, included options, comment-driven tweaks).
         • After processing, reset conditionally — pass the noted version:
           Bash: curl -s -X POST -H "Content-Type: application/json" \
                       -d '{"version": <noted>}' http://localhost:{port}/reset
         • If the response is `409` (version mismatch) → the user submitted
           again while you were processing. Re-fetch `/decisions`, process the
           new payload (which supersedes what you just finished), then retry
           the conditional reset with the new `_version`.
         • Report the outcome to the user.

       If `"submitted":false` → produce NO user-visible output. Silent tick.
   EOF)
   ```

   **Why combined, not two crons?** One cron minimizes race conditions and makes
   the contract explicit: every tick does both. Minimum cron resolution is 1 min,
   so the max submit-to-process lag is ~60 s — acceptable for interactive flows.

4. Send the first heartbeat immediately:
   ```bash
   curl -s -X POST http://localhost:{port}/heartbeat
   ```

5. Open in Edge (reuses the running instance, adds a tab):
   ```bash
   # Windows
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
After processing, **append a new iteration tab** to the same HTML file and
signal the browser to reload. This is the ONLY update path — there is no
separate "in-place edit" vs. "new file" distinction anymore.

Procedure on every iteration (including the very first response to feedback):

1. Read the existing HTML file (same path, always).
2. Freeze the currently-active iteration section per the rules in
   `deep-knowledge/templates.md` § Freezing Past Iterations (authoritative
   source). In short: remove `data-active`, add `hidden`, disable every
   `input`/`textarea`/`select`/`button` inside the section, set `readonly`
   on text inputs and textareas, preserve the submitted values exactly
   (read them from the just-processed decisions JSON).
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

The tab bar is anchored at the top of the content area inside the decision
panel header — it must never shift into the right-side submit sidebar, and
it must stay on a single row (horizontal scroll if it overflows).

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
