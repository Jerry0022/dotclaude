# Burn wiring — from prose contract to tested code

Date: 2026-09-25 · Status: implemented · Supersedes the executable parts of
`2026-09-06-run-burn-depth-vs-breadth-design.md` (its philosophy stands).

## Why

A theoretical audit of `/do-run burn` asked one question: can a burn end with
the limit used up, little or nothing landed and the sub-agents' context
lost? Rated on paper 7/10, in effect 3/10. The #335 design (depth before
breadth, per-task landing, reserve, resume state) was right, but it existed
only as text in a composite prompt handed through four skill layers.

| # | Finding | Consequence |
|---|---------|-------------|
| K1 | `auto-agents` — the single execution path — never mentioned burn, lanes, the conveyor or `BURN-STATE.json` | Whether tasks land one by one depended on the model resolving four layers of conflicting defaults, also after a compaction |
| K2 | "Commit before returning"; resume checked commits only; prune guard `merge-base --is-ancestor` | An agent killed by a limit never commits; its uncommitted work was requeued from scratch and its worktree counted as safe to delete |
| K3 | Only the weekly budget was modelled | With Opus at full depth the 5-hour window is the likelier stop — a hard stop, no drain |
| H1 | Uplift gate `max(depthFactor, …) ≥ 1.5` with depthFactor always ≥ 1.8 | The gate could never fire |
| H2 | `BASE_PCT_PER_LANE_HOUR = 1.5` "calibrate per project", no mechanism | Lane arithmetic on guessed numbers |
| H3 | Q4 showed the option above 80 % weekly use | Exactly where little is left and a normal run uses it anyway |
| H4 | Fixed 5 % reserve; no rule for unreadable usage | Several lanes overrun the reserve during the drain; a blind scraper spends on a cached number |
| M1 | Burn Steps 4 and 6 still asked, without an autostart | A user who left after the router found a run waiting |
| M2 | Depth = PO review + second QA per task | About half the extra spend bought no quality |
| M3 | Filler (TODOs, coverage) ran at full depth | "Limit gone, little done" |
| M4 | Backlog budget mode still said "aggressive agent parallelization" | The philosophy #335 had rejected |
| M5 | No full-suite gate before the integration branch | Acceptable (nothing ships unless COMPLETED); kept, documented |

## Decisions

1. **Code, not prose.** `plugins/devops/scripts/burn-plan.js` owns `offer`,
   `plan`, `init`, `gate`, every `state` transition, `resumed`,
   `resume-check`, `prune-check`, `status`. The model never computes a lane,
   a reserve or a fit.
2. **Wired into the execution path.** `auto-agents --burn=<BURN-STATE.json>`
   replaces tiers and waves with the burn conveyor: gate → spawn (models
   from the gate) → `state agent` (agent id recorded) → checkpoint commits →
   redteam pass → targeted tests → merge → push → `state land`. Autonomous
   mode passes `--burn`; backlog budget mode uses the same gate per issue.
3. **Uplift against standard depth.** `spendable ÷ core-queue cost at
   standard`; below 1.5 the plan is refused (`no-uplift`) — a normal run
   spends the budget anyway.
4. **Profiles slimmed.** `deep`/`max`: Opus implementers (max: also QA) +
   one redteam pass; no PO review, no second QA. Mechanical and filler tasks
   always standard.
5. **The 5-hour window is a gate input.** A task starts only if its whole run
   (with every busy lane) stays under 92 % of the window, projected from the
   window rate measured in this window. Nothing fits → wait, then pause —
   never end — until the reset: with a `BURN_RESUME:` cron when auto-resume
   is armed, else until the user nudges (and is asked).
   A new window re-arms the cron, so a stop in a later window resumes too.
6. **Dynamic reserve** `max(5 %, lanes × one L task at the profile)`.
7. **Unreadable usage**: hold twice, then blind mode (one lane, half the last
   spendable, estimates ×1.5), then drain.
8. **Durability**: checkpoint `wip(burn):` commits while working; after a stop
   `resume-check --apply` salvages dirty worktrees (hook refuses → patch),
   continues the agent with its context in the same session, otherwise
   requeues on the wip branch. `prune-check` requires merged AND clean.
9. **Calibration**: each finished run records a lane-hour and a unit-cost
   sample (normalized to standard) in `~/.claude/burn-calibration.json`;
   three samples replace the defaults with their median.
10. **Offer**: Q4 shows the option when, at the user's pace this week, ≥ 10 %
    above the reserve would expire unused.
11. **Questions folded**: task sources → router F8 (multi-select, empty = only
    the prompt); plan confirmation → autonomous Step 4 with its 3-minute
    autostart.

## After a limit stop (user requirements, 2026-09-25)

- **Manual nudge** in the next cycle ("weiter" or anything typed in the
  stopped session): the burn is not continued silently. `prompt.burn.resume`
  detects the stop from the transcript (Claude Code's synthetic
  `error: "rate_limit"` assistant line) or a paused state and makes Claude
  ask one question — **Burn abschalten** (recommended) · Burn fortsetzen ·
  Run beenden. A new session opening the worktree of a quiet open run is
  asked once; the router's resume question for a burn is Ohne Burn
  fortsetzen (recommended) · Mit Burn fortsetzen · Run neu starten.
- **Automatic resume**: when the user chose auto-resume (F6 "PC an · mit
  Resume"), the next question F7 asks whether the burn resumes with it —
  **Burn fortsetzen** (recommended) · Burn abschalten. `BURN_RESUME:` and
  `AUTONOMOUS_RESUME:` prompts apply that answer without asking.
- **Weekly reset** since the burn started → the burn goes off whatever was
  chosen: the budget it was burning no longer exists.
- **Off** means the run continues without burn: open core tasks at standard
  depth on one lane, filler dropped. **Continue** re-derives the plan from
  the current usage and falls back to off when it no longer clears the
  uplift gate.

## Checkpoint commits for every agent

The durability fix is not burn-specific: any agent cut off by a limit or a
crash loses what it did not commit. So checkpoint commits are the general
rule for every code-writing agent (`core`, `frontend`, `ai`, `windows`,
`designer`, `feature`): `wip(<scope>): …` after every green sub-step, at the
latest every ~10 file-changing tool calls (`deep-knowledge/commit-conventions.md`
§ Checkpoint commits). The orchestration prompt template passes it verbatim;
`agent-orchestration.md` § Recovering a cut-off agent secures the rest,
continues the agent (or a fresh one on its branch) and never prunes a
worktree that `prune-check` would keep. `/do-ship` squash-merges by default,
so checkpoints never reach `main` as separate commits. The salvage's `git
add -A` — the one exception to "stage files by name" — never stages
secret-shaped files.

**Never above the session's branch.** Three cases: no git repo (e.g. files
on a network share) — no branches, no commits; the session on a feature /
worktree branch (the normal case) — checkpoints on the agent's sub-branch or
that feature branch, never on `main`, `master` or the remote's default
branch, local or remote, which are reached only through `/do-ship`; the
session itself on `main` by necessity — `main` is its branch, so
checkpoints and merges land there. `burn-plan.js` enforces it where it
writes (`mayWrite`): `init` and `state integration` refuse a protected
branch as the conveyor's merge target unless it is the session's own branch
(backlog budget mode merges into each issue's branch, switched per issue
with `state integration`), and a salvage never commits onto a protected
branch above the session's. A merge onto the session's own `main`, or in a
repo without a remote, stays local (`state land --pushed=false`): pushing
`main` remains the ship's job.

## Dry runs (no tokens)

`node plugins/devops/scripts/burn-plan.js simulate --all --text` drives the
real decision code against a synthetic account (weekly budget, rolling
5-hour window, other sessions spending, a scraper that can go blind). Each
scenario runs the pre-change burn (`current`, followed faithfully) next to
this one. Pinned by `scripts/burn-sim.test.js`:

| Scenario | current | new |
|----------|---------|-----|
| happy-path | 4/4 core · lost 0 min · stops 0 · asked 0 · 6.5 % · queue-empty | 4/4 core · lost 0 min · stops 0 · asked 0 · 5 % · queue-empty |
| five-hour-window | 6/8 core · lost 10 min · stops 2 · asked 0 · 13.6 % · stuck after a hard stop | 8/8 core · lost 0 min · stops 0 · asked 0 · 12 % · queue-empty |
| weekly-stop-other-session | 4/4 core · lost 20 min · stops 1 · asked 0 · 9.1 % · queue-empty | 4/4 core · lost 0 min · stops 1 · asked 1 · 4 % · queue-empty |
| usage-blind | 8/10 core · lost 20 min · stops 1 · asked 0 · 22.1 % · stuck after a hard stop | 4/10 core · lost 0 min · stops 0 · asked 0 · 6 % · usage-unknown |
| multi-lane-drain | 12/16 core · lost 120 min · stops 1 (1 in drain) · asked 0 · 50.7 % · stuck after a hard stop | 16/16 core · lost 0 min · stops 0 · asked 0 · 41.6 % · reserve |
| manual-resume-after-limit | 3/3 core · lost 10 min · stops 1 · asked 0 · 11 % · queue-empty | 3/3 core · lost 0 min · stops 1 · asked 1 · 4 % · queue-empty |
| window-pause-manual | 3/3 core · lost 0 min · stops 1 · asked 0 · 9.7 % · queue-empty | 3/3 core · lost 0 min · stops 0 · asked 1 · 5 % · queue-empty |
| auto-resume-burn-off | 3/3 core · lost 15 min · stops 1 · asked 0 · 10.1 % · queue-empty | 3/3 core · lost 0 min · stops 0 · asked 0 · 3.8 % · queue-empty |
| no-uplift | 4/9 core · lost 0 min · stops 0 · asked 0 · 7.2 % · reserve | refused (no-uplift) |
| filler-heavy | 1/1 core · lost 0 min · stops 0 · asked 0 · 9.7 % · queue-empty | 1/1 core · lost 0 min · stops 0 · asked 0 · 4.8 % · queue-empty |
| agent-cannot-continue | 3/3 core · lost 20 min · stops 1 · asked 0 · 7.8 % · queue-empty | 3/3 core · lost 0 min · stops 1 · asked 1 · 3.3 % · queue-empty |

Trade-off made on purpose: with a blind scraper the new burn lands fewer
tasks (4/10 vs 8/10) because it refuses to bet the weekly limit on a number
nobody can see; the old one ran the account to 0 % — no Claude for anyone
until the weekly reset.

The account model uses the same planning estimates as the planner; the
comparison is about decisions (who loses work, who over-spends, who asks),
not a token forecast. The git side (salvage, patch fallback, prune-check,
CLI lifecycle) is dry-run against throw-away repos in
`scripts/burn-plan.git.test.js`.

## Limits

- Estimates stay estimates until a few real runs have calibrated them; the
  5-hour-window rate falls back to "weekly lane rate × 10" until measured.
- Usage is account-wide: other sessions' spend is indistinguishable from
  the burn's. It only ever makes the gate more careful.
- `continue-agent` assumes `SendMessage` reaches an agent that was cut off by
  a limit; when it does not, the task is requeued on its wip branch.
- Nothing here was run against the real account — by design.
