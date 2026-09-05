# run-burn — Depth vs. Breadth, Reserve, Durability

**Date:** 2026-09-06
**Status:** Approved
**Skill version:** `run-burn` 0.3.0 → 0.4.0

## Problem

`/run-burn` exhausted the weekly token budget without finishing anything. When
the usage limit landed, the run held N in-flight agents and zero landed work, so
the entire spend was lost.

Three causes, all in the shipped skill:

1. **Burn overrode the orchestration safeguards it was built on.**
   `composite-prompt.md` instructed *"IMMER die maximale Agent-Anzahl nutzen
   (full devops roster)"* and *"Nie idle sein"*, directly contradicting
   `agent-orchestration.md`: *"Include an agent only if it adds concrete value —
   not for coverage"* and *"Reserve large fan-out for genuinely breadth-parallel
   work; most coding tasks do not need it (15× token overhead)"*.

2. **Budget was measured once and never again.** Step 2 read usage at the start.
   No re-check, no reserve, no admission control per task.

3. **Value landed only at the end.** One integration branch, one final QA run,
   one report — plus the explicit rule *"Tests erst am Ende als QA-Wave"*. Until
   that tail ran, no task was done. Sub-branches were committed locally but not
   pushed, so a session death or a worktree prune erased them.

Underlying all three: burn optimized for **spend rate** rather than **landed work
per token**. Parallelism does not increase the total budget — it compresses the
same spend into less wall-clock time while linearly increasing how much unlanded
work is in flight when the limit hits.

## Goal

Burn exists to consume the remaining weekly budget before it resets, and the user
must *feel* the difference against a normal `/run-agents` run — otherwise the
skill has no reason to exist. The uplift may come from either dimension, but it
must be real.

## Design

### Two spend dimensions

| Dimension | Spends by | In-flight unlanded work | Loss on hard stop |
|-----------|-----------|-------------------------|-------------------|
| **Depth** | Better model, higher effort, higher tool-call ceiling, extra review passes per task | unchanged | at most 1 task |
| **Breadth** | More lanes working different tasks at once | grows linearly with lane count | up to N tasks |

Depth is the cheaper failure mode. **Depth first; breadth only fills the
throughput gap depth cannot close.**

### Uplift floor

```
uplift = max(depthFactor, lanes / baselineLanes)
```

`uplift >= 1.5` is a hard gate. Below it, burn refuses to run and points at
`/run-agents`. A burn indistinguishable from a normal run is a burn the user did
not need.

### Depth profiles

`standard` (1.0) · `deep` (1.8) · `max` (2.6). Factors are planning estimates for
the floor check and lane maths, not measured token ratios.

Burn overrides `agent-orchestration.md` § Model & Effort Defaults **upward only**
— it never downgrades a model for cost. Mechanical tasks (lint, rename, import
sort, dependency bump) stay at `standard` regardless of profile: opus on a lint
fix is spend without quality.

### Plan derivation

```
spendable       = remainingPct - RESERVE            # RESERVE = 5
requiredPerHour = spendable / hoursUntilReset
laneHourly(p)   = BASE_PCT_PER_LANE_HOUR * depthFactor(p)
lanes           = clamp(ceil(requiredPerHour / laneHourly(max)), 1, LANE_CAP)
```

`spendable < 10` caps the profile at `deep` and lanes at 1. If lanes hit the cap
and still cannot consume `requiredPerHour`, the shortfall is reported honestly
rather than papered over with more agents.

### In-run recalibration

Per-agent token use is not observable from the orchestrator; the aggregate weekly
number is the only feedback signal. Before each spawn, compare `observedPerHour`
against `requiredPerHour` and add or drop a lane outside a 0.6×–1.6× band.

### Conveyor landing protocol

Every queue item must be independently landable — one coherent commit, own
targeted tests green, meaningful without any later item. Per task: implement →
commit (unfinished as `wip:`) → targeted tests → merge into `burn/<slug>` →
`git push -u origin burn/<slug>` → update `BURN-STATE.json` → next task.

The full QA run becomes an ordinary queue task at the end, **not a gate**. This
is what turns a mid-run limit into the loss of one task instead of the run.

### Reserve and drain

Usage is re-read before each spawn (60 s freshness window). At
`remainingPct <= RESERVE`, burn stops spawning, drains in-flight lanes, merges,
pushes, and renders the report and completion card.

### Durability

`BURN-STATE.json` is written after every state transition and carries the queue,
landed SHAs, in-flight branches, and the derived plan. Step 0.5 offers resume;
on resume the profile and lanes are re-derived from *current* usage, and
in-flight branches are verified rather than trusted. Worktrees with commits not
reachable from the integration branch are never pruned.

### Push guardrail — contradiction resolved

`autonomous-execution.md` banned `git push (any branch)` while
`agent-orchestration.md` required `git push -u origin <integration-branch>` after
each wave. `/run-autonomous` loads both. Resolved in favour of durability, scoped
narrowly:

- **Allowed:** non-force push of the run's own integration/sub-branch to origin.
- **Forbidden:** push to `main`/`master` or any shared branch, force-push to
  anything, PRs, ship, external comms.

## Out of scope (YAGNI)

- Per-agent token accounting — not observable from the orchestrator.
- Mid-run model downgrade — contradicts burn's purpose.
- New MCP tooling — this is a skill and documentation change only.

## Files

| File | Change |
|------|--------|
| `plugins/devops/skills/run-burn/SKILL.md` | 0.3.0 → 0.4.0; new Step 0.5 (resume), Step 2 rewritten as plan derivation, Step 6 gains landability/size/per-task depth, Step 7 passes the derived plan, rules rewritten |
| `plugins/devops/skills/run-burn/deep-knowledge/burn-scheduler.md` | **new** — dimensions, uplift floor, profiles, derivation, recalibration, reserve, conveyor, lane mechanics, `BURN-STATE.json`, resume |
| `plugins/devops/skills/run-burn/deep-knowledge/composite-prompt.md` | rewritten — max-fan-out and end-QA guidance removed, plan/conveyor/reserve guidance added |
| `plugins/devops/deep-knowledge/autonomous-execution.md` | push ban narrowed to shared branches + force-push; durability exception documented |
| `plugins/devops/deep-knowledge/agent-orchestration.md` | burn's upward-only model override noted; push rule cross-linked to the exception |
