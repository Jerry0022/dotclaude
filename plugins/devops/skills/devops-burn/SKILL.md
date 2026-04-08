---
name: devops-burn
version: 0.1.0
description: >-
  High-throughput autonomous task runner with aggressive parallelization.
  EXPLICIT INVOCATION ONLY — the user must type /devops-burn to activate.
  Do NOT trigger on any phrasing, keyword, or intent — not on "burn",
  "budget", "limit", "aufbrauchen", "maximize", "alles verbrauchen",
  "token", or ANY other wording. Only the literal /devops-burn command.
argument-hint: "[task description or goal — additional tasks are discovered automatically]"
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

# Burn

Maximize the remaining weekly token budget. Collect tasks from all sources, then
launch autonomous mode with aggressive parallelization to get maximum value out
of the remaining time window.

**This skill MUST only run when explicitly invoked via `/devops-burn`.**
Never trigger from hooks, prompt phrasing, or heuristic matching.

## Step 0 — Load Extensions

Silently check (do not surface "not found"):
1. `~/.claude/skills/burn/SKILL.md` + `reference.md`
2. `{project}/.claude/skills/burn/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Burn Confirmation Gate

**MANDATORY — never skip this step.**

Before doing ANYTHING else, ask via `AskUserQuestion`:

> **BURN MODE**
>
> Dieser Modus verbraucht aggressiv dein verbleibendes Weekly-Budget
> durch maximale Parallelisierung. Bei aktivierter Zusatznutzung kann
> das ueber dein Standardlimit hinausgehen.
>
> Bist du sicher, dass du den Burn-Modus starten willst?

Options: `["Ja, burn starten", "Nein, abbrechen"]`

- **"Ja, burn starten"** → proceed to Step 2
- **"Nein, abbrechen"** → stop immediately, output: "Burn abgebrochen." — do nothing else

## Step 2 — Budget Assessment

Fetch current usage data to understand how much budget remains:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/devops-refresh-usage-headless.js" --auto-start --quiet --summary
```

Read `~/.claude/usage-live.json` and compute:
- **Weekly remaining %** — how much of the weekly budget is left
- **Time remaining** — hours until weekly reset
- **Burn capacity** — rough estimate: "remaining %" split across available time

Present a one-line summary:
> **Budget: {remaining}% | Reset in {hours}h | Modus: BURN**

If weekly remaining is < 10%, warn:
> "Nur noch {X}% uebrig — Burn-Modus bringt hier wenig. Trotzdem starten?"

## Step 3 — Primary Task Intake

Use `$ARGUMENTS` if provided. If empty, ask:
> **Was ist der Hauptauftrag fuer den Burn?**

Parse into: **Goal** (one sentence), **Scope** (files/systems), **Priority** (high).

## Step 4 — Task Discovery

Ask the user:
> **Soll ich zusaetzlich zu deinem Prompt automatisch Tasks aus folgenden Quellen ziehen?**
>
> 1. GitHub Issues (offen, mir zugewiesen oder unassigned)
> 2. TODO/FIXME/HACK Kommentare im Code
> 3. Code-Qualitaet (Lint-Fehler, Type-Errors, veraltete Dependencies)
> 4. Test-Coverage-Luecken (ungetestete Dateien/Funktionen)
> 5. Offene PR-Reviews
> 6. Alle oben genannten
> 7. Nein, nur mein Prompt
>
> (Mehrfachauswahl moeglich, z.B. "1,2,4")

## Step 5 — Task Collection

Based on the user's selection, collect tasks in parallel:

### 5a. GitHub Issues (if selected)

```bash
gh issue list --state open --limit 30 --json number,title,labels,assignees,body
```

Filter: prioritize assigned-to-user > unassigned > others.
Extract actionable items (skip discussions, questions, epics).

### 5b. TODO/FIXME/HACK Comments (if selected)

Use Grep to find all actionable code comments:
- Pattern: `TODO|FIXME|HACK|XXX|OPTIMIZE|REFACTOR`
- Group by file, deduplicate near-identical entries

### 5c. Code Quality (if selected)

Run in parallel:
```bash
npm run lint 2>&1 || true
npx tsc --noEmit 2>&1 || true
```

Parse errors into fixable tasks. Skip warnings unless trivial to fix.

### 5d. Test Coverage Gaps (if selected)

```bash
npm test -- --coverage --reporter=json 2>&1 || true
```

Identify files/functions below coverage threshold. Create tasks for missing tests.

### 5e. Open PR Reviews (if selected)

```bash
gh pr list --state open --json number,title,reviewDecision,reviewRequests --limit 20
```

Find PRs awaiting review or with requested changes.

## Step 6 — Task Consolidation & Prioritization

Merge all discovered tasks into a single prioritized backlog:

### Priority Tiers

| Tier | Source | Rationale |
|------|--------|-----------|
| **P0** | User's primary prompt | Explicitly requested — always first |
| **P1** | Blocking issues / failing tests / lint errors | Unblocks other work |
| **P2** | Assigned GitHub Issues | User's committed work |
| **P3** | TODO/FIXME in changed files | Close to current context |
| **P4** | Coverage gaps, PR reviews | Valuable but deferrable |
| **P5** | Remaining TODOs, unassigned issues | Fill remaining budget |

### Deduplication

- Merge tasks that touch the same files/modules into a single work unit
- Identify conflicts (two tasks modifying the same function) — sequence them

### Plan Presentation

Present the consolidated plan:

```
## Burn Plan

**Budget**: {remaining}% | **Tasks**: {count} | **Geschaetzte Agents**: {N}

### P0 — Hauptauftrag
- {user's primary task}

### P1 — Blocking
- {lint errors, failing tests, ...}

### P2 — Zugewiesene Issues
- #{number}: {title}

### P3–P5 — Zusaetzliche Tasks
- {list, grouped}

### Execution Strategy
- Waves: {N waves planned}
- Parallel agents per wave: {max feasible}
- Estimated token usage: {aggressive / moderate}
```

Wait for user confirmation:
- "go" / "ja" / "burn" → proceed as planned
- Modifications → adjust
- "weniger" → reduce scope to P0–P2 only

## Step 7 — Launch Autonomous with Burn Guidance

Invoke `/devops-autonomous` with the following composite prompt. The autonomous
skill handles everything from here (desktop questions, permission priming,
execution, reporting, shutdown).

### Composite Prompt Construction

Build the autonomous task prompt as follows:

```
BURN MODE ACTIVE — Maximale Parallelisierung.

## Hauptauftrag
{user's primary task from Step 3}

## Zusaetzliche Tasks (nach Prioritaet)
{P1 tasks}
{P2 tasks}
{P3–P5 tasks}

## Burn-Guidance

### Parallelisierung
- IMMER die maximale Agent-Anzahl nutzen (full devops roster: core, frontend,
  ai, windows, designer, qa, po, research — je nach Relevanz)
- Waves wo moeglich zusammenlegen: wenn keine harte Abhaengigkeit besteht,
  koennen Agents aus verschiedenen Waves parallel starten
- Fuer unabhaengige Tasks: separate Feature-Branches + separate Agent-Gruppen
  die gleichzeitig laufen
- Research-Agent im Hintergrund fuer alle Tasks die Kontext brauchen

### Durchsatz-Optimierung
- Keine uebertriebene Planung — direkt starten
- Bei Zweifeln: implementieren statt recherchieren
- Tests erst am Ende als QA-Wave, nicht nach jedem Einzeltask
- Lint/Type-Fixes koennen ohne eigenen Agent inline passieren
- Kleine Tasks (< 5 Minuten geschaetzt) direkt inline, nicht delegieren

### Task-Reihenfolge
- P0 und P1 Tasks starten sofort in Wave 1
- P2+ Tasks starten parallel sobald Agents frei werden
- Wenn ein Agent frueher fertig wird: naechsten Task aus der Queue ziehen
- Nie idle sein — immer den naechsten Task starten

### Ergebnis-Konsolidierung
- Alle Aenderungen auf dem gleichen Integration-Branch sammeln
- Sub-Branches pro Agent, sequentiell mergen
- Ein finaler QA-Durchlauf ueber alle Aenderungen
- AUTONOMOUS-REPORT.md muss alle Tasks und deren Status enthalten
```

**Important:** Pass this entire prompt as `$ARGUMENTS` to the autonomous skill.
The autonomous skill will then handle Steps 2–8 of its own flow (desktop questions,
permission priming, execution, reporting, optional shutdown).

## Rules

- **NEVER auto-trigger** — this skill runs ONLY on explicit `/devops-burn` invocation
- **NEVER skip the plan step** — always present the consolidated plan and wait for confirmation
- **NEVER skip budget assessment** — the user needs to know remaining capacity
- **Respect autonomous guardrails** — burn mode amplifies throughput, not permissions.
  All safety rules from devops-autonomous still apply (no push, no ship, no external comms)
- **Deduplication is mandatory** — never let two agents modify the same file simultaneously
- **Primary task always wins** — if budget is tight, drop P3+ tasks, never the user's prompt
- **NEVER skip the confirmation gate** — Step 1 is mandatory, even if the user says "just do it"
- **Task discovery is optional** — if the user says "nur mein Prompt", skip Steps 4–5 entirely
  and jump straight to Step 7 with only the primary task
