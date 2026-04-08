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
  where the user stays present — use /devops-orchestrate instead.
argument-hint: "[optional: task description]"
allowed-tools: >-
  Bash(*), Read, Write, Edit, Glob, Grep, Agent,
  AskUserQuestion, CronCreate, CronDelete, CronList,
  EnterWorktree, ExitWorktree, TodoWrite,
  WebFetch, WebSearch,
  mcp__computer-use__*, mcp__Claude_Preview__*,
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

## Step 2 — Desktop & Shutdown Questions

Ask via `AskUserQuestion` (two sequential questions):

**Question 1:**
> **Soll ich den Desktop fuer Tests uebernehmen oder im Hintergrund testen?**
> - "Desktop uebernehmen" — computer-use for full desktop/native app interaction
> - "Hintergrund" — no desktop takeover, user can keep using the PC

Browser-based testing (Playwright, Preview) runs regardless of this choice — it
operates in its own window and doesn't occupy the desktop. This question only
controls whether computer-use (mouse/keyboard takeover) is used for native apps.

**Question 2:**
> **Soll der PC nach Abschluss automatisch heruntergefahren werden?**
> - "Ja, herunterfahren" / "Nein, nur Bericht"

## Step 3 — Permission Priming

Trigger lightweight test calls to each tool category the task needs so the user
can approve permissions now: screenshot (computer-use), browser navigate, file
write, bash command. Confirm each with a checkmark.

## Step 4 — Final Confirmation

Ask: **"Alles vorbereitet. Soll ich jetzt autonom starten?"** → "Ja, los!" / "Noch nicht"

**Auto-start:** If no user response and no new messages for 5 minutes, start
automatically. Output: "5 Minuten ohne Antwort — starte jetzt autonom."

## Step 5 — Autonomous Execution

### Safety Guardrails

**Allowed:** git commit (current sub-branch), git pull/fetch, file ops within
project, browser/desktop automation, builds, tests, linters, installing dev deps.

**Forbidden:** git push (any branch), force-push, /ship or /devops-ship, creating
PRs, external communications (Discord, email, Slack, GitHub comments/issues),
purchases, account creation, destructive git ops (reset --hard, clean -f,
branch -D), deleting files outside project, modifying system config.
All changes stay local — the user reviews and decides to ship when they return.
Log as "blocked action" if needed for the task.

### Strategy

- **Simple**: work directly, no sub-agents
- **Medium**: 2-3 parallel agents for independent domains
- **Complex**: use devops agent roster (core, frontend, ai, qa, designer)

### Live Testing

After implementation: run build, run tests, then use Preview/Playwright/computer-use
to open the app, screenshot key flows, verify visually. Track progress via TodoWrite.

## Step 6 — Error Handling

- **Critical** (build unfixable, regression, missing permission, requires forbidden action): stop, write report, skip shutdown
- **Minor** (single test fail, linter warning, optional enhancement): log and continue
- **Related bugs** in same codebase context: fix them, log in report
- **Truly stuck**: commit work locally, write report with BLOCKED status, never shut down

## Step 7 — Report & Completion

Save `AUTONOMOUS-REPORT.md` to project root:

```markdown
# Autonomous Report
**Task**: {goal} | **Status**: COMPLETED | PARTIAL | BLOCKED
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

Then call `render_completion_card` (variant "shipped", pushed: false, pr: null).
Card is the last visible output.

## Step 8 — Shutdown

Only if user chose "Ja" AND status is COMPLETED:
```bash
shutdown /s /t 60 /c "Autonomous task completed. Shutting down in 60s. Run 'shutdown /a' to abort."
```
If BLOCKED or PARTIAL: skip shutdown — user must intervene.
