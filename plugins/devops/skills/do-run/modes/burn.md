<!-- do-run mode `burn` — the body of the former `run-burn` skill (v0.4.0), moved in PR 2 of the skill restructure (docs/superpowers/specs/2026-09-24-skill-restructure-design.md) and rewired onto scripts/burn-plan.js by the 2026-09-25 burn audit (docs/superpowers/specs/2026-09-25-burn-wiring-design.md). Its triggers, allowed tools and argument hint live in ../SKILL.md. -->

# Run Burn

Turn budget that would otherwise expire this week into **landed, verified
work** — not into spend rate. Burn spends along two dimensions: **depth**
(stronger models, a redteam pass, a higher tool-call ceiling per task) and
**breadth** (parallel lanes). Depth comes first because it raises the cost of
a task without raising how many tasks a limit can cut off; lanes only fill
the time a single lane cannot.

**Everything that is arithmetic or bookkeeping is code:**
`{PLUGIN_ROOT}/scripts/burn-plan.js` derives the plan, decides every spawn
(`gate`), writes `BURN-STATE.json`, checks what a hard stop left behind and
whether a worktree may go. This file never asks the model to compute a lane
count, a reserve or a fit. The model's part is judgment: splitting tasks,
running agents, landing their work. Rules and rationale:
`{PLUGIN_ROOT}/skills/do-run/modes/burn/deep-knowledge/burn-scheduler.md` —
**read it at the start of Step 2.**

**This mode MUST only run when explicitly invoked via `/do-run burn` (or the pre-PR-2 `/run-burn`),
or when the user ticked "Budget verbrennen" in the do-run router's Q4.**
Never trigger from hooks, prompt phrasing, or heuristic matching.

`burn-plan.js` below means `node "{PLUGIN_ROOT}/scripts/burn-plan.js"`. Its
`--session` defaults to `$CLAUDE_CODE_SESSION_ID` — the id the hooks see — so
it is passed only where a `[burn-resume]` block names one.

## Step 0 — Load Extensions

Silently check (do not surface "not found"):
1. `~/.claude/skills/do-run/SKILL.md` + `reference.md` — the do-run extension (already loaded by do-run Step 0)
2. `{project}/.claude/skills/do-run/SKILL.md` + `reference.md` — same
   Pre-PR-2 fallback: also read `~/.claude/skills/run-burn/` and `{project}/.claude/skills/run-burn/` (`SKILL.md` + `reference.md`) when present — an extension written for the old `run-burn` skill applies to this mode unchanged.
3. Merge: project > global > plugin defaults

Extension-overridable knobs: `LANE_CAP` (`--lane-cap=N`) and the base
`RESERVE` (`--reserve=N`), passed to `burn-plan.js plan` / `init`.

## Step 0.5 — Resume Detection (router answer)

Before the confirmation gate, check for `BURN-STATE.json` in the project root
(`burn-plan.js status` → `open: true`). The do-run router already asked
before its base call (`../SKILL.md` Step 2) — take that answer, never ask
again:

- **"Ohne Burn fortsetzen"** → `burn-plan.js resumed --trigger=router --choice=off`,
  then Step 0.6 from "resume-check".
- **"Mit Burn fortsetzen"** → `burn-plan.js resumed --trigger=router --choice=continue`
  (re-derives profile and lanes from the current usage; falls back to off
  when the budget no longer carries a burn or the week has reset — it says
  so in `why`), then Step 0.6 from "resume-check".
- **"Run neu starten"** → continue to Step 1; `init --force` in Step 7
  archives the old state to `BURN-STATE.prev.json` (never delete it — it is
  the only record of the previous run's branches).

## Step 0.6 — Resume after a limit stop

Entered from Step 0.5, from a `BURN_RESUME:` machine prompt (do-run Step 1),
or when the `prompt.burn.resume` hook injects a `[burn-resume]` block. The
block says which case applies:

- **Manual nudge** (the user typed something after the limit): ask the ONE
  question the block spells out — `"Burn abschalten (Recommended)"` ·
  `"Burn fortsetzen"` · `"Run beenden"` — unless the prompt already answers
  it. The user is present, so the autonomous post-confirmation lockout does
  not forbid this question.
- **Automatic resume** (`BURN_RESUME:` / `AUTONOMOUS_RESUME:`): no question.
  The block names the policy — the user's F7 answer, or `off` after a
  weekly reset.

Then, in order:

1. `burn-plan.js resumed --trigger=<manual|auto> --choice=<off|continue|end>`
   (skip when Step 0.5 already ran it).
2. `burn-plan.js resume-check --apply` — for every
   in-flight task it salvages a dirty worktree as a `wip(burn):` commit on its
   own branch (a refusing pre-commit hook → a `BURN-SALVAGE-<id>.patch`
   instead), then reports one action:
   - `continue-agent` → `SendMessage` to the recorded `agentId`: "Your run was
     cut off by a usage limit; your work so far is committed as wip on
     `<branch>`. Finish the task, commit, report." If the agent cannot be
     reached, `burn-plan.js state requeue <id> --branch=<branch>`.
   - `merge` → land it (Step 7 conveyor, from "targeted tests").
   - `requeue` / `requeue-with-branch` → already requeued by `--apply`; the
     next agent starts on the wip branch, not from scratch.
3. `choice=end` → no new spawns: finish what is in flight, then the report
   and card (autonomous Step 7). Otherwise continue the conveyor
   (auto-agents `--burn`, Step 7).

## Step 1 — Burn Confirmation Gate

**Answered by the do-run router — do not ask.** The confirmation is the
user's own "Budget verbrennen" tick in the router's Q4 (never recommended,
never pre-selected, only shown when `burn-plan.js offer` finds budget that
would expire unused) or the literal `/do-run burn` / `/run-burn`. Proceed to
Step 2.

## Step 2 — Budget Assessment & Plan Derivation

**Read `{PLUGIN_ROOT}/skills/do-run/modes/burn/deep-knowledge/burn-scheduler.md` first.**

Build the queue (Steps 3–6), then derive the plan from it — the plan depends
on the queue's cost, not only on the budget:

```bash
burn-plan.js plan --queue=@<queue.json>
```

`plan` refreshes usage itself when the snapshot is stale. Read the JSON:

- `ok: false, reason: "no-uplift"` — the queue at standard depth already
  costs ≥ ⅔ of what can be spent: a normal run uses the budget anyway.
  **Do not run a burn.** Output and stop:
  > Restbudget und Queue tragen keinen spürbaren Burn-Effekt (uplift {uplift}×).
  > Nimm einen normalen Run — gleiches Ergebnis, weniger Aufwand.
- `ok: false` with another reason (`usage-unknown`, `reset-imminent`,
  `no-budget`, `empty-queue`) — say so in one line and stop.
- `ok: true` — one summary line:
  > **Budget: {remainingPct}% | Reset in {hoursUntilReset}h | Profil: {profile} | Lanes: {lanes} | Uplift: {uplift}× | Reserve: {reservePct}%**

  `gapPct > 0` → "Bei {lanes} Lanes bleiben ca. {gapPct} % ungenutzt — das
  Zeitfenster gibt nicht mehr her." `leftoverPct > 0` → "Die Queue braucht
  nur ca. {costProfilePct} % — {leftoverPct} % bleiben ungenutzt." Never
  invent tasks or lanes to close either gap.

## Step 3 — Primary Task Intake

The do-run router passes the prompt as `$ARGUMENTS`. Only if empty, ask:
> **Was ist der Hauptauftrag für den Burn?**

Parse into: **Goal** (one sentence), **Scope** (files/systems), **Priority** (P0).

## Step 4 — Task Sources

**Answered by the do-run router — do not ask.** The sources come from its
follow-up F8 ("Zusatz-Tasks"): Issues · TODO/FIXME · Lint & Typen ·
Coverage-Lücken; an empty answer means only the prompt — skip Step 5.

## Step 5 — Task Collection

Collect the chosen sources in parallel:

### 5a. GitHub Issues (F8 "Issues")

```bash
gh issue list --state open --limit 30 \
  --json number,title,labels,assignees,body,author
```

**Author trust gate (mandatory).** Keep only issues authored by this repo's
owners and write-level collaborators — resolved per repo at runtime, never a
hardcoded login list. This runner implements and ships unsupervised, so a
stranger's issue must never enter the queue. Rule, fallbacks, and the `🚫 fremd`
reporting format: `{PLUGIN_ROOT}/deep-knowledge/issue-trust.md`.

Assigned to the user → P2 (core). Unassigned → P5 (filler). Extract
actionable items (skip discussions, questions, epics).

### 5b. TODO/FIXME/HACK Comments (F8 "TODO/FIXME")

Grep `TODO|FIXME|HACK|XXX|OPTIMIZE|REFACTOR`, group by file, deduplicate.
In changed files → P3, elsewhere → P5. All filler.

### 5c. Lint & Types (F8 "Lint & Typen")

```bash
npm run lint 2>&1 || true
npx tsc --noEmit 2>&1 || true
```

Errors → P1 tasks, `mechanical: true`. Skip warnings unless trivial.

### 5d. Coverage Gaps (F8 "Coverage-Lücken")

```bash
npm test -- --coverage --reporter=json 2>&1 || true
```

Files/functions below threshold → P4 tasks (filler).

## Step 6 — Task Consolidation

Merge everything into one queue file (JSON array). Per task:

```json
{ "id": "t3", "task": "…", "size": "S|M|L", "priority": "P0…P5",
  "mechanical": false, "source": "prompt|issue|discovery", "files": ["src/a.js"] }
```

| Tier | Source | Class |
|------|--------|-------|
| **P0** | User's primary prompt | core — always first |
| **P1** | Lint / type errors, failing tests | mechanical — standard depth |
| **P2** | Issues assigned to the user | core |
| **P3** | TODO/FIXME in changed files | filler — standard depth |
| **P4** | Coverage gaps | filler — standard depth |
| **P5** | Remaining TODOs, unassigned issues | filler — standard depth |

- **Landable** — one coherent commit, its own targeted tests green,
  meaningful without any later task. Split anything larger; drop what
  cannot be split. This is what makes a limit cost at most the unfinished
  part of one task per lane.
- **Size** — `S` / `M` / `L`, a coarse class the gate uses for the budget and
  window fit. Not a token estimate.
- **Files** — the files a task will touch; the gate never runs two tasks on
  the same file at once.
- **Depth is assigned by the script:** core tasks take the run's profile,
  mechanical and filler tasks stay at `standard` — opus on a lint fix or a
  coverage filler is spend without quality.

Then Step 2 (`plan`). Present the plan — **no separate confirmation**: the
router's tick was the burn confirmation, and autonomous Step 4 asks
"Soll ich jetzt autonom starten?" with its 3-minute autostart:

```
## Burn Plan

**Budget**: {remainingPct}% | **Reset in**: {hoursUntilReset}h | **Reserve**: {reservePct}%
**Profil**: {profile} | **Lanes**: {lanes} | **Uplift**: {uplift}× ggü. Standard-Tiefe
**Tasks**: {count} ({S}×S · {M}×M · {L}×L) — Kern {coreTasks}, Füll {count − coreTasks}
**Auto-Resume**: {F7: Burn fortsetzen | Burn abschalten}

### P0 — Hauptauftrag
- {task}  [{size}, {profile}]
### P1–P2
- …  [{size}, standard | {profile}]
### P3–P5 — Füll-Tasks (Standard-Tiefe)
- …

### Execution
- Conveyor: jeder Task landet einzeln (Checkpoint-Commits → gezielte Tests → Merge → Push)
- Integration-Branch: burn/{slug}
- Modelle: {role: default → opus, …}
- 5h-Fenster: kein Task startet, der das Fenster sprengt — Pause bis zum Reset
- Drain bei Reserve {reservePct}% (deckt alle Lanes)
```

## Step 7 — Launch Autonomous with Burn Guidance

1. **Write the state** (this also arms the conveyor for auto-agents):

   ```bash
   burn-plan.js init --queue=@<queue.json> --slug=<slug> --integration-branch=burn/<slug> \
     --resume-auto=<continue|off from F7> --auto-armed=<yes|no from F6>
   ```

   `init` refuses while an open run exists (`open-run-exists`) — that is
   Step 0.5's case, not a reason to `--force`.
2. Switch to autonomous mode (`modes/autonomous.md`, same skill — no new Skill
   call) with the composite prompt from
   `{PLUGIN_ROOT}/skills/do-run/modes/burn/deep-knowledge/composite-prompt.md`.
   The autonomous mode handles permission priming, the 3-minute start
   confirmation, execution, report and shutdown; its desktop and
   shutdown/resume answers come from the router's F5 / F6, and its Step 6.5
   hands `$PASSES` / `$SHIP` back to the router.
3. Its Step 5 runs auto-agents with **`--burn=<project root>/BURN-STATE.json`**
   — the conveyor in `{PLUGIN_ROOT}/skills/auto-agents/SKILL.md` § Burn
   conveyor. The plan is never re-derived in the run; the gate recalibrates
   it.

## Rules

- **NEVER auto-trigger** — only `/do-run burn` (or legacy `/run-burn`) or the router's "Budget verbrennen" tick
- **The script decides, the model executes** — plan, spawn, reserve, window,
  fit, resume action and prune safety come from `burn-plan.js`; never
  compute or override them by hand.
- **No uplift, no burn** — `plan` refusing with `no-uplift` ends the mode.
- **Depth before breadth** — the script raises the profile before it adds a
  lane; lanes only fill a time gap.
- **Never downgrade a model for cost** while the burn is on — overrides go
  upward only. Mechanical and filler tasks simply never get the upgrade.
- **Every task lands on its own** — checkpoint commits while working, then
  commit → targeted tests → merge → push, per task.
- **Push the integration branch, never main** — non-force, no PR, no ship.
  This is the one push exception in `autonomous-execution.md` § Safety
  Guardrails; the router's single ship after the run (Q2 "Ship automatisch")
  is not part of the conveyor.
- **Respect autonomous guardrails** — burn amplifies depth and throughput,
  not permissions.
- **A limit stop is never burned through silently** — a manual nudge asks
  (Step 0.6), an automatic resume follows F7, a weekly reset ends the burn.
- **BURN-STATE.json after every transition** — through `burn-plan.js state …`
  only; it is the only thing that survives a hard stop.
- **Never prune a burn worktree without `burn-plan.js prune-check`** — exit 0
  only when the branch is merged AND the worktree is clean.
- **Primary task always wins** — if budget is tight, filler goes first, never P0.
