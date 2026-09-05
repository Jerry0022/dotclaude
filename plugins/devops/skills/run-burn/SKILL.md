---
name: run-burn
version: 0.4.0
description: >-
  Autonomous task runner that consumes the remaining weekly budget before it
  resets — as depth per task (better models, higher effort, extra review passes)
  first, added parallel lanes second — and lands every task individually so a
  mid-run limit costs one task, not the whole run.
  EXPLICIT INVOCATION ONLY — the user must type /run-burn to activate.
  Do NOT trigger on any phrasing, keyword, or intent — not on "burn",
  "budget", "limit", "aufbrauchen", "maximize", "alles verbrauchen",
  "token", or ANY other wording. Only the literal /run-burn command.
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

# Run Burn

Consume the remaining weekly token budget before it resets, and turn it into
**landed, verified work** rather than spend rate. Collect tasks from all sources,
derive a plan that is measurably more than a normal `/run-agents` run, then launch
autonomous mode with that plan.

Burn spends along two dimensions — **depth** (better models, higher effort, extra
review passes per task) and **breadth** (more parallel lanes). Depth is preferred
because it raises the cost of a task without raising how many tasks can be lost
when the limit hits; breadth fills the remaining throughput gap. The derivation,
the uplift floor that makes a burn worth running, the reserve, and the durability
protocol all live in `deep-knowledge/burn-scheduler.md` — **read that file at the
start of Step 2.**

**This skill MUST only run when explicitly invoked via `/run-burn`.**
Never trigger from hooks, prompt phrasing, or heuristic matching.

## Step 0 — Load Extensions

Silently check (do not surface "not found"):
1. `~/.claude/skills/run-burn/SKILL.md` + `reference.md`
2. `{project}/.claude/skills/run-burn/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

Extension-overridable knobs: `RESERVE`, `LANE_CAP`, `BASE_PCT_PER_LANE_HOUR`
(see `deep-knowledge/burn-scheduler.md`).

## Step 0.5 — Resume Detection

Before the confirmation gate, check for `BURN-STATE.json` in the project root.

If it exists with a non-empty `queue` or `inFlight`, a previous burn was cut off
— by the weekly limit, a crash, or a session end. Ask via `AskUserQuestion`:

> Ein abgebrochener Burn liegt vor: {done} Tasks gelandet, {queue} offen,
> {inFlight} unklar. Fortsetzen oder neu starten?

Options: `["Fortsetzen", "Neu starten"]`

- **Fortsetzen** → adopt `integrationBranch`, skip everything in `done`, verify
  each `inFlight` branch for commits and either merge it or requeue the task.
  Then run **Step 2** (the stored plan is from the previous window and is stale —
  `profile` and `lanes` must be re-derived from current usage), skip Steps 3–5
  (the queue already exists), and continue at Step 6.
- **Neu starten** → archive to `BURN-STATE.prev.json` (never delete — it is the
  only record of the previous run's branches) and continue to Step 1.

Full protocol: `deep-knowledge/burn-scheduler.md` § Resume.

## Step 1 — Burn Confirmation Gate

**MANDATORY — never skip this step.**

Before doing ANYTHING else, ask via `AskUserQuestion`:

> **BURN MODE**
>
> Dieser Modus verbraucht dein verbleibendes Weekly-Budget gezielt vor dem
> Reset — primär über mehr Tiefe pro Task (stärkere Modelle, höherer Effort,
> zusätzliche Review-Durchläufe), sekundär über parallele Lanes. Bei
> aktivierter Zusatznutzung kann das über dein Standardlimit hinausgehen.
>
> Bist du sicher, dass du den Burn-Modus starten willst?

Options: `["Ja, burn starten", "Nein, abbrechen"]`

- **"Ja, burn starten"** → proceed to Step 2
- **"Nein, abbrechen"** → stop immediately, output: "Burn abgebrochen." — do nothing else

## Step 2 — Budget Assessment & Plan Derivation

**Read `deep-knowledge/burn-scheduler.md` first.** It owns the formulas below;
this step only applies them.

Fetch current usage data:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js" --quiet --summary
```

Read `~/.claude/usage-live.json` and compute:
- **`remainingPct`** — weekly budget left
- **`hoursUntilReset`** — hours until the weekly reset
- **`spendable`** = `remainingPct - RESERVE`
- **`requiredPerHour`** = `spendable / hoursUntilReset`

Then derive the plan **depth first, breadth only to fill** (§ Deriving the plan):

1. `spendable < 10` → cap profile at `deep`, `lanes` at 1.
2. Otherwise start at profile `max`, compute
   `lanes = ceil(requiredPerHour / laneHourly(max))`, clamp to `LANE_CAP`.
3. Compute `uplift = max(depthFactor, lanes / baselineLanes)`.

**Uplift floor — hard gate.** If `uplift < 1.5`, do NOT run a burn. Output and
stop:

> Restbudget und Zeitfenster tragen keinen spürbaren Burn-Effekt (uplift {x}×).
> Nimm `/run-agents` — gleiches Ergebnis, weniger Aufwand.

Otherwise present a one-line summary:

> **Budget: {remaining}% | Reset in {hours}h | Profil: {profile} | Lanes: {n} | Uplift: {x}× | Reserve: {r}%**

If `lanes` hit `LANE_CAP` and still cannot consume `requiredPerHour`, say so
plainly — do not invent extra lanes to close a gap fan-out cannot close:

> Bei {cap} Lanes und Profil {profile} bleiben ca. {gap}% ungenutzt — das
> Zeitfenster gibt nicht mehr her.

## Step 3 — Primary Task Intake

Use `$ARGUMENTS` if provided. If empty, ask:
> **Was ist der Hauptauftrag für den Burn?**

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
gh issue list --state open --limit 30 \
  --json number,title,labels,assignees,body,author
```

**Author trust gate (mandatory).** Keep only issues authored by this repo's
owners and write-level collaborators — resolved per repo at runtime, never a
hardcoded login list. This runner implements and ships unsupervised, so a
stranger's issue must never enter the queue. Rule, fallbacks, and the `🚫 fremd`
reporting format: `{PLUGIN_ROOT}/deep-knowledge/issue-trust.md`.

Then: prioritize assigned-to-user > unassigned > others.
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

### Landability & Size

Two attributes per task, both required before it may enter the queue:

- **Landable** — one coherent commit, its own targeted tests green, meaningful
  without any later task. Split anything larger into landable units; drop what
  cannot be split. This is what makes a mid-run limit cost one task instead of
  the whole run.
- **Size class** — `S` / `M` / `L`. A coarse guard so the reserve gate can refuse
  a task that cannot plausibly fit in `spendable`. Not a token estimate.

### Per-Task Depth

Assign each task the run's profile, **except** mechanical tasks (lint fix, import
sort, rename, dependency bump, generated-file refresh) which stay at `standard`
— opus on a lint fix is spend without quality. See
`deep-knowledge/burn-scheduler.md` § Depth profiles.

### Plan Presentation

Present the consolidated plan:

```
## Burn Plan

**Budget**: {remaining}% | **Reset in**: {hours}h | **Reserve**: {r}%
**Profil**: {profile} | **Lanes**: {n} | **Uplift**: {x}× ggü. /run-agents
**Tasks**: {count} ({S}×S · {M}×M · {L}×L)

### P0 — Hauptauftrag
- {user's primary task}  [{size}, {profile}]

### P1 — Blocking
- {lint errors, failing tests, ...}  [{size}, standard]

### P2 — Zugewiesene Issues
- #{number}: {title}  [{size}, {profile}]

### P3–P5 — Zusaetzliche Tasks
- {list, grouped}

### Execution
- Conveyor: jeder Task landet einzeln (commit → targeted tests → merge → push)
- Integration-Branch: burn/{slug}
- Modelle: {role: default → override, ...}
- Abschluss-QA: eigener Task am Ende, kein Gate
- Drain bei <= {r}% Restbudget
```

Models come from `{PLUGIN_ROOT}/deep-knowledge/agent-orchestration.md` § Model &
Effort Defaults, **upgraded** per the chosen depth profile. Always show
`default → override` so the budget impact is visible. Burn never downgrades a
model for cost — that is what `/run-agents` is for.

Wait for user confirmation:
- "go" / "ja" / "burn" → proceed as planned
- Modifications → adjust
- "weniger" → reduce scope to P0–P2 only (queue shrinks; profile and lanes stay —
  they are budget-derived, not scope-derived)

## Step 7 — Launch Autonomous with Burn Guidance

Invoke `/run-autonomous` with the following composite prompt. The autonomous
skill handles everything from here (desktop questions, permission priming,
execution, reporting, shutdown).

### Composite Prompt Construction

Build the autonomous task prompt from the template in
`deep-knowledge/composite-prompt.md` — it carries the Hauptauftrag, the
prioritized task list with size class and per-task profile, and the burn
guidance (browser Edge Credo, the derived depth/lane plan, the conveyor landing
protocol, the reserve gate, and BURN-STATE bookkeeping).

The derived plan (`profile`, `lanes`, `RESERVE`, `requiredPerHour`,
`integrationBranch`) is part of the prompt — the autonomous run must not
re-derive it, only recalibrate it per
`deep-knowledge/burn-scheduler.md` § In-run recalibration.

**Important:** Pass the filled-in prompt as `$ARGUMENTS` to the autonomous
skill. The autonomous skill then handles Steps 2–8 of its own flow
(desktop questions, permission priming, execution, reporting, optional
shutdown).

## Rules

- **NEVER auto-trigger** — this skill runs ONLY on explicit `/run-burn` invocation
- **NEVER skip the plan step** — always present the consolidated plan and wait for confirmation
- **NEVER skip budget assessment** — the plan is derived from it, not guessed
- **Depth before breadth** — raise the profile first, add lanes only to close a
  throughput gap depth cannot close. Breadth is the lossy dimension.
- **Never downgrade a model for cost** — burn overrides `agent-orchestration.md`
  § Model & Effort Defaults **upward only**. A burn that saves tokens is not a burn.
- **Uplift floor is a hard gate** — `uplift < 1.5` means burn is the wrong tool.
  Say so and stop; do not run a burn that is indistinguishable from `/run-agents`.
- **Every task lands on its own** — commit → targeted tests → merge → push, per
  task. Never batch landing to the end of the run.
- **Push the integration branch, never main** — non-force, no PR, no ship. This
  is the one push exception in `autonomous-execution.md` § Safety Guardrails;
  every other outbound action stays forbidden.
- **Respect autonomous guardrails** — burn mode amplifies throughput and depth,
  not permissions. All other safety rules from run-autonomous still apply.
- **Reserve is not optional** — stop spawning at `RESERVE`, drain, report.
- **BURN-STATE.json after every transition** — it is the only thing that survives
  a hard stop.
- **Never prune a worktree with unmerged commits** — check with
  `git merge-base --is-ancestor` before any cleanup.
- **Deduplication is mandatory** — never let two agents modify the same file simultaneously
- **Primary task always wins** — if budget is tight, drop P3+ tasks, never the user's prompt
- **NEVER skip the confirmation gate** — Step 1 is mandatory, even if the user says "just do it"
- **Task discovery is optional** — if the user says "nur mein Prompt", skip Steps 4–5 entirely
  and jump straight to Step 7 with only the primary task
