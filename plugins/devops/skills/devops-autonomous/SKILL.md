---
name: devops-autonomous
version: 0.1.0
description: >-
  Activate fully autonomous agent orchestration for when the user is leaving
  their PC. Collects the task, primes permissions, then runs agents autonomously
  (implementation, computer-use desktop interaction, live browser/app testing).
  Delivers a structured report and completion card when done.
  Optionally shuts down the PC after completion.
  Triggers on: "devops-autonomous", "autonomous", "autonomer modus",
  "ich geh kurz weg", "mach das alleine", "run this while I'm away",
  "autonom weiter", "ich bin gleich weg", "afk mode", "unattended mode",
  "mach weiter ohne mich", "autopilot". Do NOT trigger for normal orchestration
  where the user stays present — use /devops-agents instead.
argument-hint: "[optional: task description]"
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

Browser-based testing (Playwright, Preview) runs regardless of this choice — it
operates in its own window and doesn't occupy the desktop. This question only
controls whether computer-use (mouse/keyboard takeover) is used for **native apps**.

**Browser interaction in background mode:** Even in "Hintergrund" mode, Claude has
full read+write browser access via `$BROWSER_TOOL` (set in Step 3b). The waterfall
(Chrome MCP → Playwright → Preview) ensures a working tool is always selected.
All three are DOM/protocol-based — no mouse/keyboard takeover, no desktop occupation.
**Never fall back to computer-use for browser tasks** — it only has read-tier access
to browsers (screenshots only, no clicks or typing).

In `analyze` mode, desktop is only used for visual inspection (screenshots), never for interaction.

**Question 3 — Shutdown:**
> header: "Shutdown"
> question: "Soll der PC nach Abschluss automatisch heruntergefahren werden?"
> multiSelect: false
> Options (fixed order):
> 1. label: "Nein, nur Bericht (empfohlen)" — description: "Ergebnisse als Report, PC bleibt an."
> 2. label: "Ja, herunterfahren" — description: "PC fährt 60s nach Abschluss automatisch herunter."

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

Follow the **Browser Tool Strategy** (`deep-knowledge/browser-tool-strategy.md`):
Run the waterfall probe (Chrome MCP → Playwright → Preview), set `$BROWSER_TOOL`
to the first responder. If none respond → show the error block from the strategy
doc and abort browser-dependent work. Never use computer-use for browser tasks.

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
✅ Browser: {$BROWSER_TOOL} aktiv (Chrome MCP / Playwright / Preview)
✅ Computer-Use: {app1, app2} genehmigt  (nur wenn Desktop-Modus)
✅ Dateisystem: Lesen/Schreiben genehmigt
✅ Shell: Bash genehmigt
✅ MCP Tools: {list} genehmigt
```
Mark tools that weren't needed as "—  nicht benötigt".

## Step 4 — Final Confirmation

Ask: **"Alle Berechtigungen erteilt. Soll ich jetzt autonom starten?"** → "Ja, los!" / "Noch nicht"

**Auto-start:** If no user response and no new messages for 3 minutes, start
automatically. Output: "3 Minuten ohne Antwort — starte jetzt autonom."

## Step 5 — Autonomous Execution

### Execution Mode Gate

Behavior depends on `$EXEC_MODE` from Step 2:

**`analyze` mode:**
- **Allowed:** Read, Glob, Grep, WebFetch, WebSearch, Agent (research only),
  screenshots (visual inspection), git log/blame/diff
- **Forbidden:** Write, Edit, Bash (except read-only commands like `ls`, `git log`,
  `npm list`, `cat`), git commit, any file modification
- **Output:** Analysis report with findings, architecture insights, recommendations,
  code quality observations, potential improvements — but NO changes applied
- Desktop (if chosen): take screenshots for visual verification, never interact

**`implement` mode:**
- **Phase 1 — Analyse:** Erst vollständige Analyse wie im `analyze`-Modus (Code lesen,
  Architektur verstehen, Abhängigkeiten prüfen, Strategie festlegen).
- **Phase 2 — Implementierung:** Dann implementieren, testen, builden, verifizieren.
- Kein Ship — alles bleibt lokal bis der User zurück ist.

### Safety Guardrails (both modes)

**Forbidden (always):** git push (any branch), force-push, /ship or /devops-ship,
creating PRs, external communications (Discord, email, Slack, GitHub
comments/issues), purchases, account creation, destructive git ops (reset --hard,
clean -f, branch -D), deleting files outside project, modifying system config.
All changes stay local — the user reviews and decides to ship when they return.
Log as "blocked action" if needed for the task.

**Additional allowed in `implement` mode:** git commit (current sub-branch),
git pull/fetch, file ops within project, browser/desktop automation, builds,
tests, linters, installing dev deps.

### Strategy

- **Simple**: work directly, no sub-agents
- **Medium**: 2-3 parallel agents for independent domains
- **Complex**: use devops agent roster (core, frontend, ai, qa, designer)

### Live Testing (implement mode only)

After implementation: run build, run tests, then use `$BROWSER_TOOL` (from Step 3b)
to open the app, screenshot key flows, verify visually. For native desktop apps
(not browser), use computer-use if desktop mode was chosen. Track progress via TodoWrite.

## Step 6 — Error Handling

- **Critical** (build unfixable, regression, missing permission, requires forbidden action): stop, write report, skip shutdown
- **Minor** (single test fail, linter warning, optional enhancement): log and continue
- **Related bugs** in same codebase context: fix them, log in report
- **Truly stuck**: commit work locally, write report with BLOCKED status, never shut down

## Step 7 — Report & Completion

Generate an **interactive HTML report** and open it in Edge. No more markdown files
that nobody reads.

### 7a — Gather Completion Data

Call `render_completion_card` (variant per status: "shipped" for COMPLETED,
"blocked" for BLOCKED, "analysis" for analyze-mode COMPLETED; pushed: false, pr: null).
**Capture the full card output** — it will be embedded in the HTML report.

### 7b — Build HTML Report

Save `AUTONOMOUS-REPORT.html` to project root (replaces any previous report).

The HTML file must be a **self-contained single file** (inline CSS, no external deps).
Use a clean, modern dark-theme design. Structure:

**Header section:**
- Task goal, mode (Implement/Analyze), status badge (green/yellow/red)
- Duration, branch name (implement mode), timestamp

**Completion Card section:**
- Embed the full completion card data in a styled card widget
- Include: summary, changes, test results, build-ID, usage/battery info
- Present it visually (not raw markdown) — use the card's data fields

**`implement` mode — additional sections:**
- **Changes** — collapsible table: file, action, summary
- **Verification** — build status, test results, live test results
- **Related Fixes / Blocked Actions / Warnings** — if any

**`analyze` mode — additional sections:**
- **Findings** — key observations as styled cards or list
- **Architecture / Code Quality** — insights with visual hierarchy
- **Recommendations** — priority-sorted table: priority, area, recommendation, effort
- **Visual Verification** — embedded screenshots (base64 data URIs if taken)

**Both modes — footer:**
- Open questions (if any)
- Timestamp, branch info, git status summary

**Design guidelines:**
- Dark background (#1a1a2e or similar), accent colors for status
- Collapsible sections via `<details>/<summary>`
- Status badge: COMPLETED = green, PARTIAL = amber, BLOCKED = red
- Responsive layout, readable on any screen size
- Monospace font for code/file paths, sans-serif for prose

### 7c — Open in Browser

After writing the HTML file, open it in Edge:
```bash
start msedge "file://$(pwd)/AUTONOMOUS-REPORT.html"
```

The completion card is still rendered in the CLI as the last visible output
(VERBATIM relay as always). The HTML report is the **primary deliverable** —
the CLI card is the quick confirmation.

## Step 8 — Shutdown

Only if user chose "Ja" AND status is COMPLETED:
```bash
shutdown /s /t 60 /c "Autonomous task completed. Shutting down in 60s. Run 'shutdown /a' to abort."
```
If BLOCKED or PARTIAL: skip shutdown — user must intervene.
