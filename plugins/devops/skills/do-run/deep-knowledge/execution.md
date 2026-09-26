# Router Execution — Strikt, Run Contract, auto-agents, Ship Lockout

Execution detail for `/do-run`: what Steps 5–7 of `SKILL.md` do once the
answers are in. The **decision** stays in the skill body — Flexibel or
Strikt (Step 5), which mode and flow the answers select (Step 6), the order
of passes and ship (Step 7); this file only answers "I am in that branch,
now what exactly?". Step numbers and `modes/…` paths refer to `SKILL.md`
and its directory.

## Strikt

Arm an inline mode exactly as `prompt.strict.enforce` does for
`strict: <task>` — never over a branch mode or a mode bound to a running
concept / autonomous workflow (the CLI keeps those, `kept: true`):

```bash
node "{PLUGIN_ROOT}/hooks/lib/strict-state.js" inline
```

It prints one JSON line and then the contract block — the block only when
the mode is verifiably active. A non-zero exit means strict is NOT on:
say so in one line and ask whether to continue without it; never proceed
as if strict were armed.
The printed block is binding for the rest of the run, with the duties of
`{PLUGIN_ROOT}/deep-knowledge/strict.md` (contract, execution, report): the block at the top of every Agent prompt
(`pre.strict.agent-gate` refuses a spawn without it), `--strict` on every
auto-harden / auto-polish call, `strict=on` in every `AUTONOMOUS_AUTOSTART:`
/ `RUN_BACKLOG_AUTOSTART:` cron prompt, the strict report before the card.
`stop.strict.release` binds the inline mode to a running workflow
(`AUTONOMOUS-LOCKOUT.flag`, `.claude/concept-active.json`) or releases it
at turn end.

## Run contract

**Armed automatically — no action needed here.** A PostToolUse hook reads
this router's own answers (Q1–Q4, the follow-up) straight from the
`AskUserQuestion` result and writes them to `.claude/run-contract.json`. From
that point on, a PreToolUse hook refuses the tool call that would walk past a
chosen pass, a skipped `auto-agents` classification, an unrefined issue, or a
ship that bypasses `devops:do-ship` — with the exact call that satisfies it.
Mechanism, obligations and gates: `{PLUGIN_ROOT}/deep-knowledge/run-contract.md`.

| Gate hits… | Applies to |
|---|---|
| `auto-agents` | every `prompt` / `backlog` run — the tier decision is never skipped |
| `harden` / `polish` | a chosen pass, once the segment has real work |
| `qa` | code changes past the size threshold |
| `do-ship` | `Ship automatisch` — a `ship_release` call is refused without a prior `Skill("devops:do-ship")` |
| `refine` / `triage` | backlog mode's Präsenz obligations |

A conscious deviation is one CLI call, never a silent skip — the completion
card shows it as ⚠:

```bash
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" status
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" skip <ob> [--item <N>] --reason "<why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" park <N> --reason "<why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" abort --reason "<status>: <why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" done
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" batch-clear --reason "<why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" arm --mode <m> --flow <f> --ship <s> --passes <p> [--strict] [--items 1,2] [--session <id>] [--cwd <path>] [--replace]
```

`status` prints the header and what is still open for the current segment.
`skip` is one conscious skip (card: ⚠). `park` (backlog) records a blocked /
`⏸ Rückfrage` item once — it satisfies every open obligation of that item and
ends its segment. `abort` closes a run that is over with open steps (card:
✗ + reason) — before its card. `done` only when every chosen step ran
(`prompt` / `audit`: the final card closes it anyway; `backlog`: once every
queued item shipped, was skipped or parked); with open obligations it
refuses unless `--reason` is given, and then closes as aborted. `batch-clear`
drops a stale do-batch hand-off marker. The contract, its markers and the
card line belong to the session that armed them — a `.claude/` copied into a
new worktree never gates another session.

## auto-agents hand-off

**What `auto-agents` returns (Step 6).** It shows its own agent cards,
returns a result block (`tier`, `done`, `open`, `needs-decision`, `ship`)
and never ships or renders a card — this router acts on the block and
renders the card.

Act on the auto-agents result block: `ship: auto` → Step 7, item 3;
`needs-decision` stops before Step 7 — Interaktiv → open an `auto-concept` page
for the fork (`Skill("devops:auto-concept")`) and call auto-agents again with
the answer; Autonom → log it, skip the fork, continue. The completion card is
this router's (or do-run's composed do-ship's), never auto-agents'.

**Nothing left to fix at the ship (not under Strikt).** The block's `open`
list is worked off BEFORE Step 7 — it never lands on the ship card as work the
user has to ask for with "Nachbessern" and then ship again:
- a finding or shortfall inside the task's scope → fix it now: call
  auto-agents again with the list (or fix it inline), then re-check;
- a fork only the user can decide → `needs-decision` as above (Autonom: take
  the recommended option and report the choice);
- something outside the task's scope → a task chip (`spawn_task`, Desktop app)
  — the chip is the offer, and the card drops a point that repeats one.

The card's `open` then holds only decisions the user must take, or a concept
that needs their feedback. Under **Strikt** the scope is closed: a shortfall
beyond the named scope is not widened into, it goes into the strict report.

## Autonom ship lockout

`$SHIP=auto`, Autonom (Step 7, item 3) → arm the lockout first so no ship
gate can wedge the run on a modal, ship, clear it:

`node "{PLUGIN_ROOT}/scripts/autonomous-lockout.js" arm do-run` →
`Skill("devops:do-ship")` → `… autonomous-lockout.js clear`. A blocked
ship is reported, never retried interactively. **The clear runs on every
exit of this step**, before anything else is reported:
- ship succeeded (`ship-successful` / `ready` card) → clear;
- ship blocked (`ship-blocked`, a parked gate, a failed MCP step) → clear,
  then report the block;
- ship aborted (do-ship errored or was skipped, the run is interrupted,
  a pass before it stopped the run) → clear before handing back to
  `modes/autonomous.md` Step 7.
After a compaction or a resumed session, run `… autonomous-lockout.js
check` first; `active:true` with `owner:"do-run"` and no ship running
→ clear it. A lockout that still slips through (crash) expires on its
own: `do-run` lockouts are stale after 6 h and are ignored and removed
by every reader (`readLockout`, `check` reports `stale:true`).

## Mode files

| Mode | Follow | Former skill |
|---|---|---|
| `backlog` | `modes/backlog.md` | `run-backlog` |
| `autonomous` | `modes/autonomous.md` | `run-autonomous` |
| `burn` | `modes/burn.md` | `run-burn` |
| `rethink` | `modes/rethink.md` | `tune-rethink` |
| `audit` | `modes/audit.md` | `tune-audit` |

Each mode additionally reads the extension of the skill it was folded from
(its own Step 0), so extensions written before the restructure keep working.
