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

Ask via `AskUserQuestion` (three sequential questions):

**Question 1 — Execution Mode:**
> **Nur analysieren oder auch implementieren & testen?**
> - "Nur analysieren" — read-only: Code lesen, recherchieren, Architektur-Analyse, Report mit Findings & Empfehlungen. Keine Datei-Änderungen.
> - "Analysieren, implementieren & testen" — erst analysieren, dann implementieren, testen, builden, live verifizieren. Kein Ship — alles bleibt lokal.

Save the choice as `$EXEC_MODE` (`analyze` | `implement`). This controls Step 5.

**Question 2 — Desktop:**
> **Soll ich den Desktop für Tests übernehmen oder im Hintergrund testen?**
> - "Desktop übernehmen" — computer-use for full desktop/native app interaction
> - "Hintergrund" — no desktop takeover, user can keep using the PC

Browser-based testing (Playwright, Preview) runs regardless of this choice — it
operates in its own window and doesn't occupy the desktop. This question only
controls whether computer-use (mouse/keyboard takeover) is used for **native apps**.

**Edge/Chrome browser exception:** Even in "Hintergrund" mode, Claude is allowed to
open, navigate, read, and interact with browser tabs via the **Claude-in-Chrome MCP**
(`mcp__Claude_in_Chrome__*`). This is DOM-based — no mouse/keyboard takeover, no
desktop occupation. The user can keep working while Claude autonomously tests, reads,
and interacts with web pages in a browser tab. Prime these tools in Step 3b.

In `analyze` mode, desktop is only used for visual inspection (screenshots), never for interaction.

**Question 3 — Shutdown:**
> **Soll der PC nach Abschluss automatisch heruntergefahren werden?**
> - "Ja, herunterfahren" / "Nein, nur Bericht"

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
**Claude-in-Chrome** (`mcp__Claude_in_Chrome__*`): Always prime — runs in both
desktop and background mode. Trigger a lightweight call (e.g., `tabs_context_mcp`)
to confirm the extension is connected. This is the primary browser interface in
background mode (DOM-based, no desktop takeover).
**Playwright / Preview**: If the task involves web UI, additionally trigger a
lightweight call (e.g., `browser_snapshot` or `preview_screenshot`) to prime.

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
✅ Computer-Use: {app1, app2} genehmigt
✅ Browser: Playwright/Preview bereit
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

After implementation: run build, run tests, then use Preview/Playwright/computer-use
to open the app, screenshot key flows, verify visually. Track progress via TodoWrite.

## Step 6 — Error Handling

- **Critical** (build unfixable, regression, missing permission, requires forbidden action): stop, write report, skip shutdown
- **Minor** (single test fail, linter warning, optional enhancement): log and continue
- **Related bugs** in same codebase context: fix them, log in report
- **Truly stuck**: commit work locally, write report with BLOCKED status, never shut down

## Step 7 — Report & Completion

Save `AUTONOMOUS-REPORT.md` to project root.

**`implement` mode template:**
```markdown
# Autonomous Report
**Task**: {goal} | **Mode**: Implement | **Status**: COMPLETED | PARTIAL | BLOCKED
**Duration**: {time} | **Branch**: {branch}

## Done
- {actions completed}

## Changes
| File | Action | Summary |
|------|--------|---------|

## Verification
Build: PASS/FAIL | Tests: X passed, Y failed | Live: {results}

## Related Fixes / Blocked Actions / Warnings
- {if any}
```

**`analyze` mode template:**
```markdown
# Autonomous Analysis Report
**Task**: {goal} | **Mode**: Analyze | **Status**: COMPLETED | PARTIAL | BLOCKED
**Duration**: {time}

## Findings
- {key observations}

## Architecture / Code Quality
- {insights}

## Recommendations
| Priority | Area | Recommendation | Effort |
|----------|------|---------------|--------|

## Visual Verification
- {screenshots taken, UI observations}

## Open Questions
- {if any}
```

Then call `render_completion_card` (variant "shipped", pushed: false, pr: null).
Card is the last visible output.

## Step 8 — Shutdown

Only if user chose "Ja" AND status is COMPLETED:
```bash
shutdown /s /t 60 /c "Autonomous task completed. Shutting down in 60s. Run 'shutdown /a' to abort."
```
If BLOCKED or PARTIAL: skip shutdown — user must intervene.
