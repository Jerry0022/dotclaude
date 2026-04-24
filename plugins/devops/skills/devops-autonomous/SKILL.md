---
name: devops-autonomous
description: >-
  Fully autonomous agent orchestration for when the user is away from the PC.
  Runs agents without supervision (implementation, desktop interaction, live
  browser/app tests) and can OPTIONALLY SHUT DOWN THE PC after completion.
  Triggers: "autonomous", "run this while I'm away", "afk mode", "autopilot".
  Do NOT trigger when the user stays present — use /devops-agents instead.
argument-hint: "[task, e.g. 'refactor auth module and run tests']"
allowed-tools: >-
  Bash(*), Read, Write, Edit, Glob, Grep, Agent,
  AskUserQuestion, CronCreate, CronDelete, CronList,
  EnterWorktree, ExitWorktree, TodoWrite,
  WebFetch, WebSearch,
  mcp__computer-use__*, mcp__Claude_in_Chrome__*,
  mcp__Claude_Preview__*,
  mcp__plugin_playwright_playwright__*,
  mcp__plugin_devops_dotclaude-completion__*,
  mcp__plugin_devops_dotclaude-ship__*,
  mcp__plugin_devops_dotclaude-issues__*
---

# Devops Autonomous

User is leaving the PC. Collect the task, prime permissions, confirm, then work independently.

## Step 0 — Load Extensions

Silently check (do not surface "not found"):
1. `~/.claude/skills/autonomous/SKILL.md` + `reference.md`
2. `{project}/.claude/skills/autonomous/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 0.1 — Auto-Start Prompt Detection

If the incoming user message starts with `AUTONOMOUS_AUTOSTART:`, this is the
3-minute timeout from Step 4 firing. The user is likely AFK.

1. **Pending-question guard:** If an `AskUserQuestion` is currently active (the
   Step 4b confirmation, a clarifying question, or anything else), do NOT
   auto-start. Re-arm a fresh one-shot cron at `now + 3min` with the same
   `AUTONOMOUS_AUTOSTART:` prompt and context, log "Autostart verschoben —
   offene Frage aktiv", continue waiting.
2. If no question is pending: parse `task`, `mode`, `desktop`, `shutdown`,
   `branch` from the prompt.
3. Output once: **"3-Minuten-Timeout — starte jetzt autonom."**
4. Skip Steps 1-4 entirely. Permissions were already primed in the parent session.
5. Jump directly to Step 5 with the parsed context. The Post-Confirmation Lockout
   is active from this moment.

## Step 0.5 — Resume Detection

Before Task Intake, check for `AUTONOMOUS-RESUME.json` in the project root.
If not found → proceed to Step 1.

If found:
1. Read the resume file (contains: task, mode, progress, missing permission, shutdown pref, branch)
2. Show: **"Unterbrochene Session gefunden: {task}. Fehlende Berechtigung: {missingPermission}."**
3. Ask via `AskUserQuestion`:
   > header: "Fortsetzen"
   > question: "Unterbrochene autonome Session gefunden — fortsetzen oder neu starten?"
   > multiSelect: false
   > Options (fixed order):
   > 1. label: "Ja, fortsetzen (empfohlen)" — description: "Fehlende Berechtigungen jetzt erteilen, dann weiter wo es aufgehört hat."
   > 2. label: "Nein, neu starten" — description: "Alte Session verwerfen, neuen Task starten."

**If resuming:**
- Re-prime ALL permissions including the previously missing one (run Step 3 again)
- Ask via `AskUserQuestion`:
   > header: "Abschluss"
   > question: "Was soll beim nächsten Abschluss passieren?"
   > multiSelect: false
   > Options (fixed order):
   > 1. label: "Nur Bericht (empfohlen)" — description: "Ergebnisse als Report, PC bleibt an."
   > 2. label: "Herunterfahren" — description: "PC fährt nach Abschluss herunter. Wartet vorher, falls andere Claude-Sessions (egal welches Projekt) noch arbeiten."
- Delete the resume file
- Skip Steps 1-4, jump directly to Step 5 with the resumed context
- On completion, proceed normally through Steps 7-8

**If starting fresh:** delete the resume file and proceed to Step 1.

## Step 1 — Task Intake

Use `$ARGUMENTS` if provided, otherwise ask: **"Was soll ich autonom erledigen?"**

Parse into: **Goal** (one sentence), **Scope** (files/systems), **Success criteria**.
If ambiguous, ask ONE clarifying question — time is limited.

## Step 2 — Mode & Preference Questions

Ask via `AskUserQuestion` — three sequential questions. **Option order is fixed** as
listed below (option 1 first, option 2 second). Never shuffle. Mark the recommended
option with "(empfohlen)" in its label.

**Question 1 — Execution Mode:**
> header: "Modus"
> question: "Nur analysieren oder auch implementieren & testen?"
> multiSelect: false
> Options (fixed order):
> 1. label: "Analysieren & implementieren (empfohlen)" — description: "Erst analysieren, dann implementieren, testen, builden, live verifizieren. Kein Ship — alles bleibt lokal."
> 2. label: "Nur analysieren" — description: "Read-only: Code lesen, recherchieren, Architektur-Analyse, Report mit Findings & Empfehlungen. Keine Datei-Änderungen."

Save the choice as `$EXEC_MODE` (`implement` if option 1, `analyze` if option 2). This controls Step 5.

**Question 2 — Desktop:**
> header: "Desktop"
> question: "Soll ich den Desktop für Tests übernehmen oder im Hintergrund testen?"
> multiSelect: false
> Options (fixed order):
> 1. label: "Hintergrund (empfohlen)" — description: "Kein Desktop-Takeover, du kannst den PC weiter nutzen. Browser-Tests (Playwright/Preview) laufen trotzdem."
> 2. label: "Desktop übernehmen" — description: "Computer-Use für volle Desktop-/Native-App-Interaktion (Maus/Tastatur)."

This question only controls whether computer-use (mouse/keyboard takeover) is used
for **native apps**. Browser tools (`$BROWSER_TOOL` from Step 3b) work in both modes
and never occupy the desktop. Never fall back to computer-use for browser tasks —
see `deep-knowledge/browser-tool-strategy.md` (§ Edge Credo applies identically
in autonomous mode).

In `analyze` mode, desktop is only used for visual inspection (screenshots), never for interaction.

**Question 3 — Shutdown:**
> header: "Shutdown"
> question: "Soll der PC nach Abschluss automatisch heruntergefahren werden?"
> multiSelect: false
> Options (fixed order):
> 1. label: "Nein, nur Bericht (empfohlen)" — description: "Ergebnisse als Report, PC bleibt an."
> 2. label: "Ja, herunterfahren" — description: "PC fährt 60s nach Abschluss herunter. Wartet vorher, falls andere Claude-Sessions (egal welches Projekt) noch arbeiten."

## Step 3 — Permission Priming (ALL permissions BEFORE confirmation)

**This step MUST complete fully before Step 4.** The user must not be interrupted
by any permission prompt after confirming "Ja, los!".

Determine which tool categories the task requires based on `$EXEC_MODE` and
desktop choice, then prime ALL of them now:

### 3a — Computer-Use Access (if desktop chosen)
Call `mcp__computer-use__request_access` with the list of applications needed
(e.g., the app under test, file explorer, etc.). Wait for user approval.
Then take a test `mcp__computer-use__screenshot` to confirm access works.

### 3b — Browser Tools

Follow the **Browser Tool Strategy** (`deep-knowledge/browser-tool-strategy.md`),
including the **Edge Credo** (§ Edge Credo — Hard Rules):
- Edge only, Claude extension by default — computer-use for browser only if user chose "Desktop übernehmen"
- Always use the user's installed Edge with their profile/login context
- New tab in existing Edge window — never a new Edge window
- These rules apply in BOTH foreground and background/autonomous mode

**Browser probing is MANDATORY when any web-tech gate signal is true** (see
`deep-knowledge/test-strategy.md` § Web Tech → Always Browser-Test). This includes
Electron/Tauri: their renderer is web tech and must be verified in a browser with
mocks, even though the packaged app itself cannot be driven via Chrome-MCP. Never
skip browser probing with "Electron app, no preview server" — the renderer still
needs browser-based component verification.

Run the waterfall probe (Chrome MCP → Playwright → Preview), set `$BROWSER_TOOL`
to the first responder. If none respond → show the error block from the strategy
doc and abort browser-dependent work. Never use computer-use for browser tasks.

Mark `[--] Browser nicht benötigt` ONLY for pure non-UI work (CLI tool without
web frontend, backend-only service, config/docs/scripts). If ANY web-tech gate
signal applies, `$BROWSER_TOOL` must be active before proceeding.

### 3c — File & Shell Tools
Run a harmless `Bash` command (e.g., `echo "permission primed"`), `Read` a file,
and (if `$EXEC_MODE` = `implement`) `Write` a temp file + delete it. This ensures
file and shell permissions are pre-approved.

### 3d — MCP Tool Permissions
If the task uses any MCP tools (completion card, ship preflight, issues, etc.),
trigger a lightweight read-only call to each to prime the permission.

### 3e — Confirmation Checklist
Display a checklist of all primed permissions:
```
[OK] Browser: {$BROWSER_TOOL} aktiv (Chrome MCP / Playwright / Preview)
[OK] Computer-Use: {app1, app2} genehmigt  (nur wenn Desktop-Modus)
[OK] Dateisystem: Lesen/Schreiben genehmigt
[OK] Shell: Bash genehmigt
[OK] MCP Tools: {list} genehmigt
```
Mark tools that weren't needed as `[--] nicht benötigt`.

## Step 4 — Final Confirmation with 3-Minute Auto-Start

**The user may already be walking away.** The confirmation must NOT block autonomous
execution if the user doesn't answer. Implement the 3-minute auto-start via a
one-shot cron BEFORE asking the question.

### 4a — Arm the Auto-Start Timer

Compute `now + 3 minutes` in local time. Derive the 5-field cron expression
(minute, hour, day-of-month, month, `*`). Example for "today 14:26":
`26 14 <today_dom> <today_month> *`.

Call `CronCreate` with `recurring: false` and a prompt that encodes the full
execution context (the user will not be there to re-enter it):

```
CronCreate({
  cron: "<M> <H> <D> <Mo> *",
  recurring: false,
  prompt: "AUTONOMOUS_AUTOSTART: 3-minute confirmation timeout reached. Resume devops-autonomous Step 5 with: task=<goal>, mode=<EXEC_MODE>, desktop=<yes|no>, shutdown=<yes|no>, branch=<current-branch>."
})
```

Save the returned `jobId` as `$TIMEOUT_JOB_ID`.

### 4b — Ask Confirmation

Ask via `AskUserQuestion`:
> header: "Start"
> question: "Alle Berechtigungen erteilt. Soll ich jetzt autonom starten? (Ohne Antwort starte ich nach 3 Minuten automatisch.)"
> Options (fixed order):
> 1. label: "Ja, los!" — description: "Sofort starten, PC kann verlassen werden."
> 2. label: "Noch nicht" — description: "Timer um 3 Minuten zurücksetzen — ich kann noch Rückfragen stellen."

### 4c — Resolve

- **"Ja, los!"** → `CronDelete($TIMEOUT_JOB_ID)`, proceed to Step 5.
- **"Noch nicht"** → `CronDelete($TIMEOUT_JOB_ID)`, then re-arm fresh: `CronCreate`
  one-shot at `now + 3min` with the same `AUTONOMOUS_AUTOSTART:` prompt, save
  new `$TIMEOUT_JOB_ID`. The user may now ask clarifying questions or reconsider.
  Every additional "Noch nicht" resets the timer again. The only way out is
  "Ja, los!" (start) or full session close (user abandoned).
- **No answer / timeout fires** → see Step 0.1 for the auto-start handler.

**Re-arm guard (cron fires while another question is pending):** If the
`AUTONOMOUS_AUTOSTART:` prompt arrives WHILE an `AskUserQuestion` is still
active (e.g. a clarifying question from Claude), do NOT auto-start. Instead
re-arm a fresh one-shot cron at `now + 3min` and continue waiting for the
pending answer. This prevents the auto-start from interrupting a legitimate
in-flight question. Log once: "Autostart verschoben — offene Frage aktiv."

**Critical:** The cron is session-only (in-memory). If the user fully closes the
Claude session before the timeout elapses, auto-start will NOT fire. Tell the
user verbally: the session must stay running.

### Post-Confirmation Lockout

**After the user confirms, ZERO user interaction is allowed.**
No `AskUserQuestion`, no inline questions, no confirmation prompts, no permission
requests. The user is AFK — they will not see anything.

If something unexpected happens during autonomous execution:
- **Missing permission** → trigger Late Permission Protocol (see `deep-knowledge/autonomous-execution.md`)
- **Ambiguous decision** → choose the safer/simpler option, log the choice in the report
- **Blocked action** → log it, continue with remaining work
- **Shutdown was requested** → always execute shutdown, even if work is incomplete (after saving progress)

This lockout is absolute. There is no exception. The only user interaction point
after confirmation is the next session (via Resume Detection in Step 0.5).

## Step 5 — Autonomous Execution

Behavior depends on `$EXEC_MODE` from Step 2. The full execution gate, safety
guardrails, and late-permission protocol live in
`deep-knowledge/autonomous-execution.md` — read that file at the start of Step 5.

**Mandatory pre-mortem before any executing step (implement mode):**
Unsupervised execution means no user is there to catch a bad call mid-flight.
Before the first Write/Edit/Bash that mutates state, apply the inline pre-mortem
from `deep-knowledge/pre-mortem.md` — full question set, all triggers treated
as active by default (security, migration, breaking-change, refactor, concurrency,
destructive, external). Fold the output into guards, tests, and scope cuts.
If a `high`-severity risk has no concrete mitigation, pause execution and write
it to `AUTONOMOUS-RESUME.json` as a BLOCKER rather than proceeding.

Quick summary:
- `analyze` → read-only (Read, Glob, Grep, WebFetch, git log/blame/diff, screenshots). No Write/Edit/commit.
- `implement` → Phase 1 analyse, Phase 2 implement+test+build+verify. No push/ship/PR.
- **Forbidden in both modes:** push, force-push, /ship, create PRs, external comms, purchases, destructive git ops, system config changes.

### Strategy

Select agents and execute waves per `deep-knowledge/agent-orchestration.md`:
- § Agent Selection for roster, criteria, and complexity tiers (Simple/Medium/Complex)
- § Wave Execution for spawning mechanics, prompt template, and branch strategy
- § QA Wave — Testing Protocol for unit tests, build checks, and browser-based visual verification
- § Single-Agent Shortcut when only one domain is involved

All agents use the **Autonomous** interaction directive (no AskUserQuestion).
Collaboration protocol (handoffs, merge order): `deep-knowledge/agent-collaboration.md`.

### Live Testing (implement mode only)

Follow the **QA Testing Protocol** from `deep-knowledge/agent-orchestration.md` § QA Wave.
Use `$BROWSER_TOOL` (from Step 3b) for all browser-based visual verification.

**Autonomous-specific additions:**
- **Web tech**: browser verification is MANDATORY (rule 3). Mocks are expected.
  Never skip because "no preview server".
- **Packaged Electron/Tauri**: renderer tested via `$BROWSER_TOOL` with mocks
  (rule 4). If user chose "Desktop übernehmen", run the packaged-app final test
  via computer-use. Otherwise add a `userFinalTest` item (string form) for the
  completion card — renders as `🧑 TESTE bitte noch:`.
- **3rd-party integrations**: mock automated tests (rule 5). Always add a
  `userFinalTest` item with `afterDeployment: true` — renders under the same
  `🧑 TESTE bitte noch:` block with `— nach Deployment` suffix. Never mark the
  integration "verified" on mocks alone.
- Track progress via TodoWrite.

## Step 6 — Error Handling

- **Critical** (build unfixable, regression, requires forbidden action): stop, write report, skip shutdown
- **Late Permission** (unanticipated permission needed during execution): save progress,
  write `AUTONOMOUS-RESUME.json`, generate INTERRUPTED report, **execute shutdown if
  requested**. See "Late Permission Handling" in Step 5.
- **Minor** (single test fail, linter warning, optional enhancement): log and continue
- **Related bugs** in same codebase context: fix them, log in report
- **Truly stuck**: commit work locally, write report with BLOCKED status, never shut down

**Status hierarchy:** COMPLETED > INTERRUPTED > BLOCKED.
INTERRUPTED means useful work was done but couldn't finish due to missing permission.
The resume file enables continuation. Shutdown is safe because progress is saved.

## Step 7 — Report & Completion

Generate an **interactive HTML report** and open it in Edge. No more markdown files
that nobody reads.

### 7a — Gather Completion Data

Call `render_completion_card` (variant per status: "ship-successful" for COMPLETED,
"ship-blocked" for BLOCKED, "ready" for INTERRUPTED,
"analysis" for analyze-mode COMPLETED; pushed: false, pr: null).
**Capture the full card output** — it will be embedded in the HTML report.

**Always forward `userFinalTest` items** collected during Step 5 Live Testing
(packaged Electron/Tauri without takeover, 3rd-party integrations). The card
renders a unified `🧑 TESTE bitte noch:` block — this is the only signal the
user sees about work that automation couldn't cover, so never drop or summarize
these items away.

### 7b — Build HTML Report

Write a self-contained `AUTONOMOUS-REPORT.html` (inline CSS, no external deps,
dark theme) to project root — replacing any previous report.

See `deep-knowledge/html-report.md` for the full structure (header,
completion-card widget, implement/analyze sections, footer) and the
design guidelines (colors, status badges, collapsible sections, fonts).

### 7c — Open in Browser

After writing the HTML file, open it in Edge. **Always convert the Git-Bash
path to a native Windows path first** — `$(pwd)` returns `/c/Users/...` which
produces a broken `file:///c/Users/...` URL (Chromium/Edge can't resolve the
missing drive colon → `ERR_FILE_NOT_FOUND`):

```bash
start msedge "file:///$(cygpath -m "$(pwd)")/AUTONOMOUS-REPORT.html"
```

See `deep-knowledge/browser-file-urls.md` for the full rule.

The completion card is still rendered in the CLI as the last visible output
(VERBATIM relay as always). The HTML report is the **primary deliverable** —
the CLI card is the quick confirmation.

## Step 8 — Shutdown

Execute if user chose "Ja, herunterfahren" AND status is COMPLETED or INTERRUPTED.

### 8a — Wait for Other Active Claude Sessions

Never cut off another running Claude session — any project, any worktree. Before
the shutdown command, poll `~/.claude/projects/**/*.jsonl` mtimes. A jsonl modified
within the last 2 minutes means that session is mid-thought or mid-tool-call.
Exclude our own project tree entirely (our main session + any subagents we spawned).

Self-detection: env vars like `CLAUDE_SESSION_ID` are not exposed to Bash. Use
`basename($PWD)` — Claude encodes the project path as a directory under
`~/.claude/projects/` whose name ends with the worktree/project basename
(e.g. `…-eager-rubin-98f8d6`).

Loop max 30 minutes, then proceed regardless (avoid indefinite hang):

```bash
PROJECTS="$HOME/.claude/projects"
BASE=$(basename "$PWD")
SELF_DIR=$(find "$PROJECTS" -maxdepth 1 -type d -name "*-${BASE}" 2>/dev/null | head -1)
for i in $(seq 1 60); do
  active=$(find "$PROJECTS" -name '*.jsonl' -newermt '2 minutes ago' 2>/dev/null \
            | grep -vF -- "${SELF_DIR}/" | head -1)
  [ -z "$active" ] && break
  sleep 30
done
```

### 8b — Execute Shutdown

```bash
shutdown /s /t 60 /c "Autonomous task completed. Shutting down in 60s. Run 'shutdown /a' to abort."
```

**INTERRUPTED:** Shutdown is safe because progress is saved in `AUTONOMOUS-RESUME.json`
and committed locally. The user can resume on next boot via Step 0.5.

**BLOCKED:** Skip shutdown — user must intervene immediately, data integrity may be at risk.

**Never ask about shutdown inline.** The decision was made in Step 2 (or Step 0.5 on
resume). Just execute it (after the 8a wait).
