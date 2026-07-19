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
  (use /devops-fix), or static documentation (use /devops-setup-readme).
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
- **Per-decision note textarea (MANDATORY for every `[data-decision]` group):**
  every Bi-State variant/finding card MUST carry an adjacent
  `<textarea data-comment="$decisionId-note">` so the user can attach a
  free-form override (e.g. "only for X", "with variant Y") to the include/
  discard choice. See `deep-knowledge/templates.md` § Comment Slot Injection
  for the HTML pattern, the `ensureCommentSlots()` JS safety net, and the
  rationale. Skipping this is the most common interactive-element regression
  — the user has nowhere to caveat their selection.
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

The prototype template has no tri-state. Instead, a **speech-bubble feedback
dock** anchored to the 💬 FAB (bottom-left) holds structured feedback:

- A top-level textarea for general notes on the prototype
- One textarea per `<section data-screen>` inside the active iteration,
  auto-populated by the dock (label = `data-nav-label` of that screen)

The dock is toggled via the 💬 FAB. The FAB stays visible AND clickable
while the dock is open (clicking it toggles closed again), and the dock's
right edge stops before the ☰ Menü-FAB so decisions remain reachable
during feedback. The close button is a **minimise** (`−`), not a destroy:
text content stays intact in `localStorage` when the dock is closed. See
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
4. Add classes `concept-submitted` and `content-dimmed` to `<body>` and
   reveal `#content-dimmer` so the content area visually fades. The decision
   panel + FABs sit at higher z-index and stay clear + interactive. The
   dimmer is click-to-dismiss; otherwise it auto-clears on the next page
   reload (next iteration / final report).
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

After writing the HTML file, grep it for the 38 mandatory interactive
patterns (heartbeat, panel states, iteration tabs, section TOC, reload
polling, generic form-collection catch-all scoped to the active
iteration, post-submit content dimmer, persistent status channel + ship
CTA, etc.).
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

**If the `start "" msedge …` command errors** (Edge not installed, not in
PATH), do NOT silently fall back to the preview MCP. Tell the user the
exact error and ask whether to try the Edge protocol handler
(`start microsoft-edge:"http://localhost:$PORT/…"`) or another browser
they prefer. The whole concept flow assumes a real, user-visible browser
window — there is no usable degraded mode.

### Concept Bridge Server + Edge

Start the bridge server (`scripts/concept-server.py`) on a random port
(8700-8999), arm the combined heartbeat + auto-poll cron (fires every
minute, handles heartbeat + decision pickup + conditional reset), write
`.claude/concept-active.json` so a future SessionStart can rediscover this
concept, **send the first heartbeat AND verify it round-trips with a
non-zero `claude_ts`** (see `deep-knowledge/bridge-server.md` § Step 5 —
the read-back is mandatory; a naked POST leaves a dead-bridge failure
mode invisible until the user submits and gets no response), then open
the page in the user's existing Edge window using the exact command above.

The state file (`port`, `html_path`, `slug`, `server_pid`, `cron_id`,
`started_at`) is what makes the concept survivable across Claude restarts:
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

**`action: "create-issues"` ("Issues erstellen" button — only on final report):**

**Zero-prompt invariant.** The user already committed when they clicked
"Issues erstellen". Asking a follow-up question — for issue body, labels,
milestone, anything — is a UX regression equivalent to the old
"paste the JSON from the console" anti-pattern. Every field needed to
land a complete `gh issue create` call is in the payload OR derivable
from the concept HTML in `docs/concepts/{date}-{slug}.html`. If a field
is genuinely missing AND the project requires it, fall back to a sane
default (silent) — never an `AskUserQuestion`. The only justified
interruption is a hard `gh` failure that needs the user's eyes.

1. Read the `items` array from the payload — each entry now carries
   `{ id, title, type, description, role?, module?, milestone?, selected: true }`.
   `description` falls back to the visible `.oq-label` text when the
   author of the final-report did not set `data-issue-body`; either is
   enough to skip prompting.
2. Read the `disposition` sub-object from the same payload — even if the
   user never touches "Concept beenden", `submitCreateIssues` always
   bundles the current disposition state for Step 6 cleanup. Store it
   for use in Step 6a; do NOT apply it now — issue routing and cleanup
   are decoupled so the user can still review the page before closing.
3. **User-value gate (silent, mandatory).** Apply the gate from the
   `devops-setup-issue` skill's deep-knowledge/issue-rules.md to the
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
   `gh issue create`** — do NOT invoke the `devops-setup-issue` skill,
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
   - Else, check the project's `devops-setup-issue` extension
     (`{project}/.claude/skills/new-issue/reference.md` / `SKILL.md`)
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
   one merged issue.
8. POST `/reload` so the browser shows the updated state. If every item
   was processed, the "Issues erstellen" button auto-hides on reload
   (panel JS gates it on the presence of un-created checkable items).
9. Then POST `/reset` with the captured `_version` as usual.
10. The concept session stays open — the user may still review previous
   iteration tabs but cannot trigger further iterate/implement actions
   from the final report.

**`action: "dispose-concept"` ("Concept beenden" button — only on final report):**
1. Read the `disposition` sub-object from the payload — shape
   `{ mode: "discard" | "keep" | "gitignore", moveTo: string | null }`.
2. Do NOT apply the cleanup here — instead, record the disposition for
   Step 6a (which is the authoritative cleanup step) and signal session
   end. Treat this submission as the explicit "fertig" signal from the
   user.
3. POST `/reset` with the captured `_version` so the bridge stops
   surfacing this submission as `_pending`.
4. Proceed to Step 6 — Completion Card. The disposition recorded here
   drives the cleanup branch in Step 6a.

**`action: "ship"` ("🚀 Shippen" button — only on final report):**

**Zero-prompt invariant.** The user committed by clicking Shippen — an
explicit authorisation for a real, outward-facing release, exactly like the
"Mit Feedback implementieren" button authorises real code changes. Do NOT ask
a follow-up question; the payload plus the final-report context are
sufficient. The ONLY justified interruption is a hard ship-pipeline failure
that needs the user's eyes (merge conflict, failing build/preflight gate) —
surface that verbatim and stop.

1. Read the `disposition` sub-object from the payload (same shape as
   dispose-concept) and store it for Step 6a. Do NOT apply cleanup yet.
2. Run the full ship pipeline via the `devops-ship` skill (ship_preflight →
   ship_build → ship_version_bump → ship_release → ship_cleanup). The button
   click authorises the ship; it does NOT waive the gates `devops-ship`
   already enforces. If a gate blocks, report the blocker to the user and
   STOP — never fake a completion or force past a failing gate. (A force-push
   to main/master still requires explicit user confirmation per the user's
   own rules — the Shippen click does not stand in for that.)
3. On a successful release, rewrite the live final-report section in place:
   - Reveal the `[data-ship-state="done"]` hint and set the channel to the
     shipped state, including the version (e.g. "Geshippt · v0.113.0").
   - Add a one-line "Shipped" note (version + tag) to the Zusammenfassung.
   Then POST `/reload`, and only AFTER that POST `/reset` with the captured
   `_version` (reload-before-reset, same order as every other branch).
4. Run Step 6a cleanup only (bridge shutdown + disposition from step 1). Do
   **NOT** render a second concept completion card — `devops-ship` already
   rendered its own ship card, which is the authoritative closing artefact
   (rendering another here would be a duplicate summary). If the ship was
   blocked at a gate in step 2, skip cleanup, leave the concept session open
   so the user can retry, and report the blocker instead.

**Critical invariant:** a submit with `action: "iterate"` MUST NEVER cause
code or file changes outside of the concept HTML file itself. The user
relies on that guarantee to explore ideas safely. `action: "create-issues"`
only writes GitHub issues + the final-report HTML — no code/file changes
in the project tree. `action: "dispose-concept"` only triggers Step 6
cleanup — no code/file changes either, just disposition of the concept's
own HTML / decisions JSON artefacts. `action: "ship"` is the one action that
DOES reach outward — it runs the real release pipeline — and that is exactly
why it is gated behind its own explicit final-report button, never behind
iterate/implement.
### 5c. Update the Page
After processing, **append a new tab** to the same HTML file and signal
the browser to reload. This is the ONLY update path — there is no
separate "in-place edit" vs. "new file" distinction anymore.

For `action: "iterate"` → append a regular iteration section.
For `action: "implement"` → append a **final-report section** (one-time,
see § "Final-report append (implement only)" below).
For `action: "create-issues"` → no new section; rewrite the existing
final-report HTML in place (replace processed items with linked
`[Issue #NNN]` labels) and POST `/reload`.

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
6. **Only now** POST `/reset` with the captured `_version` (see cron
   prompt in Step 3). This stamps `_processed_at` on the server as the
   final step. The browser's `pollProcessedState` is a safety-net —
   it will only restore the panel state when a reload counter advance
   has been observed OR a long stale timeout elapses. See
   `deep-knowledge/templates.md` § Panel State Reset for the polling contract.

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
2. Append a `<section data-iteration="{N+1}" data-final-report data-active>`
   to the same file. This carries the `data-final-report` flag so the
   panel auto-switches to `panel-final-report` mode (no iterate/implement
   buttons — see `deep-knowledge/templates.md` § Final Report Panel).
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
6. /reload → /reset as steps 5–6 above.

**Verbatim copy directive (mandatory):**
The final-report JS block — `updateCreateIssuesPanel`, `submitCreateIssues`,
`collectDisposition`, `submitShip`, `submitDisposeConcept`, plus the
`ship-btn` / `view-iterations-btn` wiring, the `change` listener on
`section[data-open-questions] input[type="checkbox"]` and the
`DOMContentLoaded` wiring — MUST be copied verbatim from
`deep-knowledge/templates.md` (the block starting at the comment
`// --- Final-report "Issues erstellen" action ---` through the
`// --- Final-report "Shippen" action ---` block). Do NOT
inline a simplified `updateCreateIssuesPanel`, drop `submitShip`, or omit the
event-listener wiring; any omission leaves a visible-but-inert button.
After writing, the post-generation validation gate
(`deep-knowledge/validation-gate.md` Phase 1) MUST find patterns 28–38
in the generated file.

**Open questions / TODOs section — when to include:**

Include the `<section data-open-questions>` block only when there are real
items worth tracking as GitHub issues — things you knowingly deferred,
bugs surfaced but out of scope, doc gaps, follow-up refactors. Skip it
entirely (do NOT render an empty stub) when the implementation is
genuinely clean. The presence of this section is what surfaces the
"Issues erstellen" button in the panel — see `deep-knowledge/templates.md`
§ Final Report Panel for the HTML pattern. Default each `<input
type="checkbox">` to `checked` so the user opts items OUT rather than IN.

**No further iterations from the final report.** The panel deliberately
omits the iterate/implement buttons. If the user wants more work after
the final report, they can start a new concept session — that's a clear
new scope, not an additional iteration on a closed one.

### 5d. Resume Monitoring
Return to Step 4 (monitor for next submission). The loop continues until:
- The user closes the page
- The user says "fertig" / "done" in chat
- There are no more decisions to make (all items processed)

If the active section is the final report, the submissions Claude expects
are:
- `action: "ship"` — fired by the persistent status channel's primary
  "🚀 Shippen" button. Runs the real release pipeline (Step 5b · ship).
  Carries the current disposition for Step 6a cleanup.
- `action: "create-issues"` — fired by the "Issues erstellen" button when
  open questions / TODOs are present and at least one is selected.
- `action: "dispose-concept"` — fired by the always-visible "Concept
  beenden" button. Carries the file disposition decision (discard /
  keep / gitignore + optional moveTo).

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

1. The last `dispose-concept` payload received this session → use its
   `disposition` field directly.
2. Otherwise, the last `create-issues` payload's `disposition` field.
3. Otherwise (no payload carried a disposition — old session, user
   aborted, page closed before clicking either final-report button):
   default to `{ mode: "discard", moveTo: null }`.

The default = `discard` is deliberate. Most concept sessions are one-shot
refinements whose outcome already landed in commits / GitHub issues /
the implement step. Persisting the HTML in git by default accumulates
silt in `docs/concepts/`. Power users opt in to `keep` or `gitignore`
via the final-report panel.

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
