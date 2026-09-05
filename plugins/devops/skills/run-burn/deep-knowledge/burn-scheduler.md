# Burn Scheduler — Depth, Breadth, Reserve, Durability

Read this at the start of `/run-burn` Step 2. It defines how a burn plan is
derived, what makes a burn worth running at all, and how work is kept durable
when the weekly limit lands mid-run.

## Why this file exists

Burn's earlier guidance was "always use the maximum agent count, never be idle".
That maximizes *spend rate* while leaving every task unfinished at the moment the
limit hits — the run ends with N in-flight agents and nothing landed. Burn's goal
is **landed, verified work per token**, with spend as the means, not the end.

## The two spend dimensions

There are exactly two ways to consume the remaining budget, and they fail
differently:

| Dimension | Spends by | In-flight unlanded work | Loss on hard stop |
|-----------|-----------|-------------------------|-------------------|
| **Depth** | Better model, higher effort, higher tool-call ceiling, extra review passes per task | unchanged | at most 1 task |
| **Breadth** | More lanes working different tasks at once | grows linearly with lane count | up to N tasks |

Depth is the cheaper failure mode: it raises the cost of a task without raising
the number of tasks that can be lost. **Prefer depth. Use breadth only as a
throughput filler** when depth alone cannot consume the budget in the remaining
wall-clock window.

## The uplift floor — what makes a burn a burn

Burn must be *noticeably* more than a normal `/run-agents` run on at least one
dimension. A burn that lands at baseline is a burn the user did not need.

```
baselineLanes  = lanes /run-agents would pick for this task set (complexity tier)
breadthFactor  = lanes / baselineLanes
depthFactor    = from the profile table below
uplift         = max(depthFactor, breadthFactor)
```

**Floor: `uplift >= 1.5`.** If the derived plan does not clear it, do not run a
burn — report:

> Restbudget und Zeitfenster tragen keinen spuerbaren Burn-Effekt (uplift {x}x).
> Nimm `/run-agents` — gleiches Ergebnis, weniger Aufwand.

## Depth profiles

| Profile | Model | Effort | Tool-call ceiling | Extra passes per task | depthFactor |
|---------|-------|--------|-------------------|-----------------------|-------------|
| `standard` | per `agent-orchestration.md` § Model & Effort Defaults | default | 15–30 | — | 1.0 |
| `deep` | opus for core, frontend, ai, windows, qa (po/research/redteam are opus already) | high | 40–60 | redteam review + second QA | 1.8 |
| `max` | opus for every agent | high | 60+ | redteam + second QA + po review | 2.6 |

`depthFactor` values are **planning estimates** used for the floor check and the
lane maths. They are not measured token ratios and must not be reported as spend
predictions.

This is the one place burn is allowed to override
`agent-orchestration.md` § Model & Effort Defaults — and it overrides **upward
only**. Burn never downgrades a model for cost; that is what `/run-agents` is for.

**Depth is capped by task substance, not only by budget.** A mechanical task
(lint fix, import sort, rename, dependency bump, generated-file refresh) stays at
`standard` regardless of the run's profile — opus on a lint fix is spend without
quality. Substantive tasks (feature, refactor, bugfix with an unclear root cause,
API or contract design) take the run's profile. Record the profile actually used
per task in `BURN-STATE.json` so the report shows where the budget went.

## Deriving the plan

```
RESERVE                = 5      # % of weekly budget
LANE_CAP               = 4      # override via skill extension
BASE_PCT_PER_LANE_HOUR = 1.5    # calibrate per project

spendable       = remainingPct - RESERVE
requiredPerHour = spendable / hoursUntilReset
laneHourly(p)   = BASE_PCT_PER_LANE_HOUR * depthFactor(p)
```

Selection order — **depth first, breadth only to fill**:

1. If `spendable < 10`, cap the profile at `deep` and `lanes` at 1. A near-empty
   budget cannot support max-depth fan-out; the floor check then decides whether
   the run is worth starting at all.
2. Otherwise start at profile `max`. Compute
   `lanes = ceil(requiredPerHour / laneHourly(max))`.
3. `lanes <= 1` → one lane at `max`. Depth alone consumes the budget; adding
   lanes would only add loss surface.
4. Otherwise clamp `lanes` to `LANE_CAP`.
5. If `lanes` hit the cap and `lanes * laneHourly(max) < requiredPerHour`, the
   budget cannot be consumed in the window. Say so plainly, run at the cap, and
   do not invent extra lanes to close a gap that fan-out cannot close.
6. Run the floor check.

## In-run recalibration

Per-agent token consumption is not observable from the orchestrator — only the
aggregate weekly number is. That aggregate is the only feedback loop burn has.
Before each new task spawn:

```
observedPerHour = (remainingAtStart - remainingNow) / hoursElapsed
```

- `observedPerHour < 0.6 * requiredPerHour` → under-burning. Add a lane (up to
  `LANE_CAP`) or raise the profile for the next task.
- `observedPerHour > 1.6 * requiredPerHour` → over-burning; the reserve will be
  reached early. Drop a lane.

Log every adjustment as one line in `AUTONOMOUS-LOG.md`.

## Reserve and drain

- Re-read usage before each new task spawn. A snapshot 60 s old or newer counts
  as fresh; otherwise refresh:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js" --quiet --summary
  ```
  Re-check **per task**, never per tool call — the headless scrape costs seconds.
- `remainingPct <= RESERVE` → **drain phase**: spawn nothing new, let in-flight
  lanes finish, merge, push, render the report and the completion card.
- Never start a task whose size class cannot plausibly fit in `spendable`. Size
  classes are S / M / L, assigned in Step 6 — a coarse guard, not a token
  estimate.

## Landing protocol — the conveyor

Every queue item must be an **independently landable unit**: one coherent commit,
its own targeted tests green, no dependency on a later item to be meaningful. An
item that is not independently landable is split in Step 6 or dropped.

Per task, in order:

1. Agent implements on `burn/<slug>-<role>-<n>`.
2. Agent commits **before returning**. Unfinished work is committed as `wip:`
   with a message naming what is missing — nothing is left uncommitted.
3. Targeted tests for the changed modules only, not the full suite.
4. Orchestrator merges the sub-branch into the integration branch `burn/<slug>`.
5. `git push -u origin burn/<slug>` — non-force, never `main`/`master`, no PR,
   no ship. See `autonomous-execution.md` § Safety Guardrails.
6. Update `BURN-STATE.json`.
7. Pull the next task.

The full QA run is an ordinary queue task at the end, **not a gate**. No task
waits on it to count as done. This is what makes a mid-run limit cost one task
instead of all of them.

## Lane mechanics

- `lanes == 1` → spawn **foreground**. This avoids the spawn-triggered worktree
  re-sync window documented in `agent-orchestration.md` § Inter-Wave Verification
  Gate.
- `lanes > 1` → spawn with `run_in_background: true`. Merge and push on each
  completion, one at a time — never two merges concurrently.
- **Never remove or prune a worktree** whose branch holds commits not reachable
  from the integration branch. Check before any cleanup:
  ```bash
  git merge-base --is-ancestor <sub-branch> burn/<slug> || echo "unmerged — keep"
  ```

## BURN-STATE.json

Written to the project root after **every** state transition (task started, task
landed, lane count changed, profile changed, drain entered).

```json
{
  "version": 1,
  "slug": "burn-2026-09-06-1420",
  "integrationBranch": "burn/burn-2026-09-06-1420",
  "profile": "max",
  "lanes": 3,
  "laneCap": 4,
  "reservePct": 5,
  "plan": {
    "requiredPerHour": 6.2,
    "baselineLanes": 2,
    "uplift": 2.6
  },
  "budgetAt": { "remainingPct": 41, "checkedAt": "2026-09-06T14:20:00Z" },
  "queue": [
    { "id": "t7", "task": "...", "size": "M", "priority": "P2", "profile": "max" }
  ],
  "done": [
    { "id": "t1", "task": "...", "sha": "abc1234", "pushed": true, "profile": "max" }
  ],
  "inFlight": [
    { "id": "t4", "task": "...", "agent": "core", "branch": "burn/...-core-4", "worktree": "..." }
  ],
  "drained": false
}
```

## Resume

`/run-burn` Step 0.5 checks for `BURN-STATE.json` before anything else.

If it exists with a non-empty `queue` or `inFlight`:

1. Offer resume via `AskUserQuestion` — resume, or discard and start fresh.
2. On resume: adopt `integrationBranch`, skip everything in `done`, re-derive
   `profile` and `lanes` from **current** usage (the previous window's numbers
   are stale), and treat `inFlight` entries as unverified — check each branch for
   commits and either merge them or requeue the task.
3. On discard: archive the file to `BURN-STATE.prev.json` and start fresh. Never
   delete it outright — it is the only record of the previous run's branches.

This composes with the existing `AUTONOMOUS-RESUME.json` mechanism from
`run-autonomous` Step 0.5; it does not replace it. `BURN-STATE.json` tracks the
task conveyor, `AUTONOMOUS-RESUME.json` tracks the autonomous session envelope.
