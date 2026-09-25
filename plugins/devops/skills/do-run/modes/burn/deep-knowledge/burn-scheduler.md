# Burn Scheduler — Depth, Breadth, Reserve, Window, Durability

Read this at the start of `/do-run burn` Step 2. It explains the rules that
`{PLUGIN_ROOT}/scripts/burn-plan.js` implements — the script is the source of
truth for every number; this file is the why. Nothing here is computed by
the model.

## Why this file exists

The first burn said "always use the maximum agent count, never be idle": spend
rate up, nothing landed when the limit hit. The #335 redesign fixed the
philosophy (depth before breadth, per-task landing) but left it as prose the
execution path never saw: `auto-agents` knew nothing about lanes, the
conveyor or `BURN-STATE.json`; the uplift gate could never fire; the 5-hour
window was not modelled; a hard stop lost the in-flight work, and a resume
silently burned on. The 2026-09-25 audit moved every rule that is arithmetic
or bookkeeping into `burn-plan.js`, wired it into `auto-agents --burn`, and
dry-runs whole burns in `burn-sim.js`.

Burn's goal is **landed, verified work from budget that would otherwise
expire** — spend is the means, never the measure.

## The two spend dimensions

| Dimension | Spends by | In-flight unlanded work | Loss on hard stop |
|-----------|-----------|-------------------------|-------------------|
| **Depth** | Opus instead of Sonnet, a redteam pass, a higher tool-call ceiling | unchanged | the unfinished part of one task |
| **Breadth** | More lanes working different tasks at once | grows with lane count | one unfinished part per lane |

Depth first; lanes only fill a time gap depth cannot close.

## Depth profiles

| Profile | Opus for | Extra pass | Tool calls | depthFactor |
|---------|----------|------------|------------|-------------|
| `standard` | per `agent-orchestration.md` § Model & Effort Defaults | — | 15–30 | 1.0 |
| `deep` | core, frontend, ai, windows, designer | redteam on the task diff | 30–45 | 1.5 |
| `max` | deep + qa, gamer | redteam on the task diff | 45–60 | 2.0 |

The first version's per-task **PO review** and **second QA** are gone: the
second QA re-ran what the first had verified, and a PO weighs trade-offs that
nobody decides while the user is away. Effort is not a tool parameter (the
Agent tool has none) — the model, the pass and the ceiling are what change.

Mechanical tasks (lint, rename, import sort, dependency bump) and filler
(P3–P5, discovery sources) always run at `standard`. Only the user's own work
— the prompt and assigned issues — gets depth.

## When the option is offered — `offer`

Q4 shows "Budget verbrennen" when, at the user's own pace this week
(`used % ÷ elapsed hours`, at least 12 h elapsed), at least 10 % above the
reserve would expire unused. The first version showed it above 80 % used —
where little is left and a normal run uses it anyway.

## Deriving the plan — `plan`

1. **Profile** — `max`; `deep` when less than 10 % is spendable, or when the
   core queue fits the budget at deep but not at max (finishing the user's
   tasks beats half of them at maximum depth).
2. **Lanes** — as many as it takes to spend the affordable part of the queue
   (`min(queue cost, spendable)`) within 80 % of the time left, clamped to
   `LANE_CAP` (4). Usually one.
3. **Reserve** — `max(5 %, lanes × one L task at the profile)`. A fixed 5 %
   is overrun when several lanes are still finishing as the drain starts.
4. **Uplift gate** — spendable ÷ the core queue's cost at **standard** depth.
   Below 1.5 a normal run spends the budget anyway: the plan is refused
   (`no-uplift`) and the mode stops. (The first gate compared depth factors
   that were always ≥ 1.8 and could never fire.)
5. **Honest gaps** — `gapPct` (time too short for the lanes) and
   `leftoverPct` (the queue needs less than the budget) are reported, never
   filled with invented tasks or lanes.

Estimates: a standard lane spends `laneHourlyPct` of the weekly budget per
hour, a task costs `unitCostPct × size weight (S 1 · M 2.5 · L 5) ×
depthFactor`. Defaults are set for Max 20x and scaled by plan capacity (Max
5x ×4, Pro ×20). After every finished run `state finish` records one sample
of each, normalized to standard depth, in `~/.claude/burn-calibration.json`;
from three samples on, the median replaces the default. Usage numbers are
account-wide — another session's spend makes the samples more conservative,
never less.

## The gate — before every spawn

`burn-plan.js gate` decides and claims (the task moves to `inFlight` before
the agent starts). Order:

1. Finished / paused → `stop`. Drained → `wait` until the lanes are empty,
   then `finish`.
2. **Usage unreadable** (scraper down, cache served, stale) → `hold` twice
   (each call retries the refresh). From the third on: **blind mode** — one
   lane, at most half of what was spendable at the last reading, every
   estimate counted 1.5×; when that allowance is used up → drain
   (`usage-unknown`). A fresh reading ends blind mode. The first version
   acted on whatever number was cached and ran the account into the limit.
3. **Week reset** since the start → drain (`week-reset`): the budget being
   burned is gone.
4. **Reserve** reached → drain (`reserve`).
5. **Recalibration** — observed weekly spend per hour vs the plan's required
   rate, one step per 30 min: under-burning (< 0.6×) raises the profile
   before it adds a lane; over-burning (> 1.6×) drops a lane.
6. **Lanes full** → `wait`. **Queue empty** → `wait`, then `finish`.
7. **Pick** the first queue item (priority order) that fits
   - the weekly budget above the reserve,
   - the **5-hour window**: its whole run, with every busy lane, must stay
     under 92 % — projected from the window rate measured in this window's
     readings (fallback: weekly lane rate × 10). A window under 10 % takes
     any task, so a task bigger than a window cannot wait forever;
   - no file of a task in flight.

   A smaller task may go ahead of a bigger one only because the bigger one
   cannot start now anyway.
8. Budget left but no window → `wait` while lanes are busy, then **`pause`**
   — never an end: the run stays resumable after the reset. With auto-resume
   armed the result carries a one-shot cron for the window reset + 15 min
   (`resumeCron`) — arm it with `CronCreate` and `burn-plan.js state
   resume-cron --for=<resumeAt> --job=<id>`. Without it (`resumeCron: null`)
   the run waits for the user: their next prompt is a manual nudge and gets
   the burn-on/off question.
9. A new 5-hour window since the last resume cron → `rearmResumeCron` on the
   result: arm it the same way, so a hard stop in this window is resumed too.

## Landing protocol — the conveyor

Every queue item is an **independently landable unit**: one coherent commit,
its own targeted tests green, meaningful without a later item. Per task:

1. `gate` → `spawn`: the agent works on `burn/<slug>-<role>-<n>` in its own
   worktree. `burn-plan.js state agent <id> --agent-id=<id> --agent=<role>
   --branch=<b> --worktree=<w>` right after the spawn — the agent id is what
   lets a cut-off agent be continued with its context.
2. **Checkpoint commits while working** — the rule every implementing agent
   follows (`{PLUGIN_ROOT}/deep-knowledge/commit-conventions.md` § Checkpoint
   commits), here as `wip(burn): …`; the orchestrator records them with
   `state checkpoint <id>`. The first version's "commit before returning"
   saved nothing: an agent killed by a limit never returns.
3. Passes per profile — `redteam` reviews a substantive task diff; a
   high-severity finding goes back to the implementing agent once.
4. Targeted tests for the changed modules only.
5. Merge the sub-branch into `burn/<slug>`; `git push -u origin burn/<slug>`
   (non-force, no PR, no ship — `autonomous-execution.md` § Safety
   Guardrails). No remote, or the integration branch is the session's own
   `main` → the merge stays local and `state land` gets `--pushed=false`. `init` and `state integration` refuse `main`, `master` and
   the remote's default branch as the integration branch, and a salvage never
   commits onto them — unless the session itself works on that branch (no
   feature branch, by necessity). From a feature branch, `main` is reached
   only through `/do-ship`.
6. `burn-plan.js state land <id> --sha=<sha>`.
7. `gate` for the next task.

The full QA run is an ordinary queue task at the end, not a gate.

## Lane mechanics

- `foreground: true` (one lane) → spawn in the foreground; more lanes →
  `run_in_background: true`, and only one merge at a time.
- **Never remove a burn worktree without `burn-plan.js prune-check
  --branch=<b> --worktree=<w>`** — exit 0 only when the branch has nothing the
  integration branch lacks AND the worktree is clean. `git merge-base
  --is-ancestor` alone called a worktree with no commits "safe" while it held
  the only copy of an agent's uncommitted work.

## Resume after a limit stop

A hard stop (5-hour or weekly limit, crash) leaves `status` running or
paused and the tasks in `inFlight`. Who decides what happens next:

| Entry | Who | Choice |
|-------|-----|--------|
| The user types after the stop (same session) | `prompt.burn.resume` → one question | **Burn abschalten** (recommended) · Burn fortsetzen · Run beenden |
| Another session opens the worktree of a quiet run | same hook, once per session | same question |
| `/do-run` in a new session | router Step 2 | **Ohne Burn fortsetzen** (recommended) · Mit Burn fortsetzen · Run neu starten |
| `BURN_RESUME:` (window pause cron) / `AUTONOMOUS_RESUME:` | hook, no question (user away) | the user's F7 answer — **Burn fortsetzen** (recommended) or Burn abschalten |
| Any entry after the weekly reset | `resumed` | burn **off**, whatever was asked |

`burn-plan.js resumed --trigger=… --choice=…`:

- **off** — the burn stops, the run does not: open core tasks finish at
  standard depth on one lane; filler moves to `skipped`.
- **continue** — profile and lanes are re-derived from the **current** usage
  (the old window's numbers are stale); a plan that no longer clears the
  uplift gate, or a weekly reset, falls back to off (`why`).
- **end** — drain: finish what is in flight, report, card.

Then `resume-check --apply` for the in-flight tasks: a dirty worktree is
salvaged as a `wip(burn):` commit on its own branch (a refusing pre-commit
hook → `BURN-SALVAGE-<id>.patch`; hooks are never skipped); then
`continue-agent` (same session, agent id known → `SendMessage`, context
intact) · `merge` · `requeue-with-branch` (a fresh agent continues the wip
branch — it re-reads, it does not redo) · `requeue`.

## BURN-STATE.json (v2)

Written only through `burn-plan.js`, atomically, after every transition.
Project root of the run's worktree; git-excluded (`/BURN-*`, autonomous Step
3c).

```json
{
  "version": 2,
  "slug": "burn-2026-09-25-1420",
  "integrationBranch": "burn/burn-2026-09-25-1420",
  "status": "running | paused | draining | finished",
  "burn": { "active": true },
  "profile": "max", "lanes": 1, "laneCap": 4, "reservePct": 5,
  "plan": { "requiredPerHour": 0.4, "uplift": 6.7, "reservePct": 5, "remainingAtStart": 30, "startedAt": "…", "planName": "Max 20x", "estimates": {} },
  "weekResetAt": "…",
  "sessionId": "<CLAUDE_CODE_SESSION_ID>",
  "resume": { "auto": "continue | off", "autoArmed": true, "cronFor": "…" },
  "budgetAt": { "remainingPct": 28, "sessionPct": 41, "checkedAt": "…" },
  "readings": [{ "at": "…", "weeklyRemaining": 28, "sessionUsed": 41, "lanesBusy": 1 }],
  "holds": 0, "blind": null,
  "queue":    [{ "id": "t7", "task": "…", "size": "M", "priority": "P2", "source": "issue", "files": [], "branch": "…(after a requeue)" }],
  "inFlight": [{ "id": "t4", "profile": "max", "agent": "core", "agentId": "…", "sessionId": "…", "branch": "burn/…-core-4", "worktree": "…", "checkpoints": 3 }],
  "done":     [{ "id": "t1", "sha": "abc1234", "pushed": true, "profile": "max", "claimedAt": "…", "landedAt": "…" }],
  "failed": [], "skipped": [],
  "drained": false, "drainReason": null, "pause": null,
  "lastResume": { "at": "…", "trigger": "manual", "requested": "off", "applied": "off", "why": null },
  "events": [{ "at": "…", "type": "claim | land | requeue | hold | blind | drain | pause | resumed | recalibrate | …" }],
  "heartbeatAt": "…"
}
```

A v1 file (no `status`) is still recognized as an open run by the router and
the hook; `resumed` upgrades nothing it does not need.

## Dry runs — `burn-plan.js simulate`

`node burn-plan.js simulate --all --text` plays whole burns against a
synthetic account — weekly budget, rolling 5-hour window, other sessions
spending in parallel, a scraper that goes blind — with the real decision
code, the pre-audit burn next to this one. No tokens. Scenarios:
happy-path · five-hour-window · weekly-stop-other-session · usage-blind ·
multi-lane-drain · manual-resume-after-limit · window-pause-manual ·
auto-resume-burn-off · no-uplift · filler-heavy · agent-cannot-continue. `scripts/burn-sim.test.js`
pins their outcomes; add a scenario for every new failure mode before
changing the gate.
