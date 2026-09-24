# Run Contract — what the user chose in do-run is enforced, not hoped for

A hook records the answers to `do-run`'s questions and refuses the tool call that would walk past one of them — a skipped `auto-agents` classification, a dropped pass, a ship that bypasses `devops:do-ship` — so a chosen run is no longer only a prose promise. Design spec: `docs/superpowers/specs/2026-09-24-run-contract-design.md`.

## Why

An audit of 2026-09-24 sessions found the same failure three times: the user
made a choice in `do-run` and the model walked past it — chosen Harden/Polish
never ran, `ship_*` MCP tools were called directly instead of `devops:do-ship`,
`auto-agents` / `devops:qa` / backlog triage+refine were skipped, and a
`do-batch` fire was implemented without ever handing off to `do-run`. Every
one of these obligations lived only in skill prose; nothing checked it.

## What is recorded

A PostToolUse hook reads the do-run router's `AskUserQuestion` result — mode
(`prompt` / `backlog` / `audit`), flow (interactive / autonomous), ship
(auto / manual), scope (strict), the chosen passes (harden / polish /
rethink / burn) — and writes it to `.claude/run-contract.json` (header) plus
an append-only `.claude/run-contract.events.jsonl` (skill/agent/edit/commit/
branch/release/card/skip events). No model cooperation is needed to arm it:
the hook reads the tool result directly. `RUN_BACKLOG_AUTOSTART:` /
`AUTONOMOUS_AUTOSTART:` machine prompts arm it the same way, from their
`key=value` pairs. Arming never fails silently: a `.claude/run-contract.pending`
marker (written the instant `do-run` starts) is scanned from the transcript
if the `AskUserQuestion` arm is somehow missed, or falls back to the
click-through defaults with `source: fallback`. A contract armed from the
fallback or a machine prompt is announced once (PostToolUse
`additionalContext`) with the `arm` / `done` call that corrects it. A
repeated machine prompt of the same mode refreshes the active contract in
place — its events and segments survive every wake of a loop.

A contract expires — reads as absent, archived to `run-contract.prev.json` —
after 12 h idle (interactive) or 30 h (autonomous / backlog), so a leftover
contract never gates an unrelated later session.

## Obligations

Evaluated on the current **segment** (the events since the last item
boundary — a successful `release`, or in backlog mode also a new `branch`):

| Obligation | Applies when | Satisfied by |
|---|---|---|
| `auto-agents` | mode `prompt` or `backlog` | a `Skill("devops:auto-agents")` call in the segment |
| `harden` | Harden was chosen, segment has work | `Skill("devops:auto-harden")` without `--invoked-by=ship` |
| `polish` | Polish was chosen, segment has work | `Skill("devops:auto-polish")`, same rule |
| `qa` | segment has work and changed code files past the threshold (≥1 backlog, >5 prompt) | a `devops:qa` agent |
| `do-ship` | `ship: auto`, segment has work | a `Skill("devops:do-ship")` call, then a `release: ok` or a blocked/aborted card |
| `refine` | backlog, present user, a release closes `#N` | a `devops:auto-issue` refine of `#N` |
| `triage` | backlog, present user, first `auto-agents` of the run | ≥1 agent event since arm |

Every obligation is also satisfied by a matching `skip` event.

## Gates

A PreToolUse hook (`hooks/pre-tool-use/pre.run.contract.js`) exits 2 with the
exact `Skill(...)` call that satisfies the open obligation, before:

- an Edit/Write/NotebookEdit or `git commit` on a gated path, when `auto-agents` is open;
- a branch switch in backlog mode, for the segment's open `harden`/`polish`/`qa`/`do-ship`;
- the first `auto-agents` call of a backlog run, when `triage` is open;
- `ship_release`, for every obligation above still open;
- a final-variant completion card (`ship-successful`, `ready`, `released`, `test`, …), for `auto-agents`/`harden`/`polish`/`qa`/`do-ship`.

The check exits fast (existence check only) when no contract and no batch
hand-off marker exist, so it stays cheap on the overwhelming majority of
calls that carry no run at all.

## Skip, done, abort

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" skip <ob> [--item <N>] --reason "<why>"
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" done [--reason "<why>"]
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" abort --reason "<why>"
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" status
```

`<ob>` is one of `auto-agents | harden | polish | qa | do-ship | refine |
triage`. `skip` refuses without a reason — a conscious deviation is always
explicit, never silent, and the completion card shows it as `⚠ <reason>`.
`done` closes the contract when the run is genuinely finished (`prompt` /
`audit`: after the final card; `backlog`: on `done`, or once every queued
item has shipped or been skipped). `abort` closes an interrupted or blocked
run *before* its card, so the card still passes the gate and reports the
open obligations instead of wedging the session. `status` prints the header
and what is still open for the current segment — useful when picking a run
back up.

## The batch hand-off gate

When a `do-batch` merge fires, `prompt.batch.collect.js` writes
`.claude/batch-handoff.json`. While it exists (and is under 6 h old), the
same PreToolUse hook refuses Edit/Write/NotebookEdit and `git commit` with a
message pointing at `Skill("devops:do-run", "--from=do-batch …")` for a
ready plan or `Skill("devops:auto-concept", "--from=do-batch …")` for one
with open decisions — reading, exploring and planning stay allowed. The
`do-run` / `auto-concept` PostToolUse call deletes the marker.

## The answer-check

After every `AskUserQuestion`, `hooks/post-tool-use/post.ask.answers.js`
checks for an answer token that equals an "Other" placeholder (`Something
else`, `Sonstiges`, …) with no typed text — that combination means the user
wanted something the options did not offer, not that they picked nothing.
It injects a context note telling the model to ask what, in one more
question, before acting on that answer.

## Kill switch and state

`DOTCLAUDE_RUN_CONTRACT=off` disables arming and every gate — use it if a
misfiring gate wedges a session; `skip`/`done` on the CLI are the normal
escape hatches, the kill switch is the emergency one. State lives in the
work-tree root, next to `strict-mode.json`: `.claude/run-contract.json`,
`.claude/run-contract.events.jsonl`, `.claude/run-contract.prev.json`
(archive), `.claude/run-contract.pending` (arm marker) and
`.claude/batch-handoff.json`. All are runtime-ignored (`runtime-ignores.js`
`PLUGIN_STATE`) — never commit them.
