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
branch/release/card/skip/park/measure events). Headers are normalised and
English aliases (`What`, `Flow`, `Scope`, `Passes`) count. A Q4 answer the
hook cannot read (Other placeholder, free text) keeps the recommended passes
and marks the contract `unresolved` (card: `Durchgänge ?`); `ohne X` /
`without X` excludes X. When Q1 was preset away, the mode comes from the
do-run args or the follow-up headers (`Issues` / `Milestones` → backlog,
`Ergebnis` / `Audit-Umfang` → audit).

Arming never fails silently: a `.claude/run-contract.pending` marker —
written when `do-run` starts, by the Skill call or a typed `/do-run …` — is
scanned from the transcript if the `AskUserQuestion` arm is missed, or falls
back to the click-through defaults with `source: fallback` (announced once
with the `arm` / `done` call that corrects it). A do-run that skips the
router (resume, machine prompt, backlog's own sub-run) never replaces an
active contract. `RUN_BACKLOG_AUTOSTART:` / `AUTONOMOUS_AUTOSTART:` machine
prompts arm from their `key=value` pairs; over an active contract they only
refresh ship / passes / strict / items / presence — never the mode (except
`RUN_BACKLOG_AUTOSTART` → backlog), so events and segments survive every wake.

A devops skill the user TYPES as a slash command — `/auto-harden`,
`/auto-polish`, `/do-ship`, `/auto-agents`, `/auto-issue`, with or without the
`devops:` prefix — never reaches the Skill tool, so `prompt.run.contract.js`
records it as the same `skill` event the Skill-tool path would; a typed
`/do-run` or `/auto-concept` also clears a pending do-batch hand-off marker,
the same take-over the Skill-tool path already does.

Every header and marker is **session-bound**: it gates, arms and shows on
the card only for the session whose `session_id` it stores (Claude Desktop
copies the main checkout's untracked `.claude/` into every new worktree, so
a copied file must never gate a foreign session). A file without a stored
session id counts as foreign once it is 10 min old; a fresh one (CLI `arm`)
is claimed by the first session that touches it. A contract also expires —
reads as absent, archived to `run-contract.prev.json` — after 12 h idle
(interactive) or 30 h (autonomous / backlog).

## Obligations

Evaluated on the current **segment** (the events since the last item
boundary — a successful `release`, a `park`, or in backlog mode a new item
branch: not from a subagent, not `git worktree add` / `--detach`, not a
`<current>-*` / `<current>/*` sub-branch):

| Obligation | Applies when | Satisfied by |
|---|---|---|
| `auto-agents` | mode `prompt` or `backlog` | a `Skill("devops:auto-agents")` call in the segment |
| `harden` | Harden was chosen, segment has work | `Skill("devops:auto-harden")` without `--invoked-by=ship` |
| `polish` | Polish was chosen, segment has work | `Skill("devops:auto-polish")`, same rule |
| `qa` | segment has work and changed code files past the threshold (≥1 backlog, >5 prompt) | a `devops:qa` agent |
| `do-ship` | `ship: auto`, segment has work | a `Skill("devops:do-ship")` call, then a `release: ok` or a blocked/aborted card |
| `refine` | backlog, present user: a release closing `#N`, or (Ship manuell) the final card for every queued item | a `devops:auto-issue` refine of `#N` |
| `triage` | backlog, present user, first `auto-agents` of the run | ≥1 agent event since arm |

Every obligation is also satisfied by a matching `skip`, every one but
`triage` by a `park` of the item. `qa` diffs against `tool_input.base`, else
`origin/HEAD`, else `main` / `master`; the gate records the count as a
`measure` event first — unknown (no base, unborn HEAD) shows as `QA ?`.

## Gates

A PreToolUse hook (`hooks/pre-tool-use/pre.run.contract.js`) exits 2 with the
exact `Skill(...)` call that satisfies the open obligation, before:

- an Edit/Write/NotebookEdit or `git commit` on a gated path, when `auto-agents` is open;
- an item branch in backlog mode, for the segment's open `harden`/`polish`/`qa`/`do-ship`;
- the first `auto-agents` call of a backlog run, when `triage` is open;
- `ship_release` — and, while `ship: auto`, `gh pr merge` or a `git push` onto `main` / `master` — for every obligation above still open;
- a final-variant completion card (`ship-successful`, `ready`, `released`, `test`, …; an unreadable `--render-card` payload counts as final), for `auto-agents`/`harden`/`polish`/`qa`/`do-ship` (+ `refine` in Ship-manuell backlog).

Commands are normalised first (`&`, `git.exe`, `--no-pager`, `-C`, `-c`).
Release / card gates use the contract of the session root, else of
`tool_input.cwd`. The check exits fast (existence checks only) when no
contract and no marker exist; the remaining cost is the one `node` spawn
every matched call pays. A refused call writes a `block` event (`gate`, the
open obligation names) before it exits 2 — a lasting trace beyond the stderr
message; it counts as neither work nor a segment boundary.

## Limits

A contract exists only after do-run's router answered, or a machine prompt
armed one. Work that meets do-run's own criteria but that never went through
do-run (or a machine-prompt run) is not gated at all — outside an active run
the delegation policy stays advisory (a kill switch, not a gate) and the
trigger router only suggests a skill. The one place outside a run that still
forces a skill is the do-batch hand-off gate below.

## CLI: status, skip, park, abort, done, batch-clear

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" status
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" skip <ob> [--item <N>] --reason "<why>"
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" park <N> --reason "<why>"
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" abort --reason "<why>"
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" done [--reason "<why>"]
node "${CLAUDE_PLUGIN_ROOT}/hooks/lib/run-contract.js" batch-clear --reason "<why>"
```

`<ob>` is one of `auto-agents | harden | polish | qa | do-ship | refine |
triage`. Every call but `status` refuses without a reason where one is
listed — a deviation is explicit, never silent. `skip` shows as `⚠ <reason>`.
`park` records a blocked / `⏸ Rückfrage` backlog item once and ends its
segment. `abort` closes a run that is over with open steps (card: ✗ +
reason), before its card. `done` is only for a run where every chosen step
ran (`prompt` / `audit` close at the final card anyway; `backlog` once every
queued item shipped, was skipped or parked); with open obligations it
refuses unless `--reason` is given and then closes as aborted.

## The batch hand-off gate

When a `do-batch` merge fires, `prompt.batch.collect.js` writes
`.claude/batch-handoff.json`. While it exists (same session, under 6 h), the
PreToolUse hook refuses Edit/Write/NotebookEdit and `git commit` with a
message pointing at `Skill("devops:do-run", "--from=do-batch …")` for a
ready plan or `Skill("devops:auto-concept", "--from=do-batch …")` for one
with open decisions — reading, exploring and planning stay allowed. The
`do-run` / `auto-concept` PostToolUse call deletes the marker; a stale one
goes with `batch-clear --reason`, which the block names with the kill switch.

## The answer-check

After every `AskUserQuestion`, `hooks/post-tool-use/post.ask.answers.js`
checks for an answer token that equals an "Other" placeholder (the one list,
`run-contract.js` `OTHER_PLACEHOLDERS`: `Something else`, `Other`, `Etwas
anderes`, `Sonstiges`, `andere`, …) with no typed text — that combination
means the user wanted something the options did not offer, not that they
picked nothing. It injects a context note telling the model to ask what, in
one more question, before acting on that answer.

## Kill switch and state

`DOTCLAUDE_RUN_CONTRACT=off` disables arming and every gate — use it if a
misfiring gate wedges a session; the CLI verbs above are the normal escape
hatches, the kill switch is the emergency one. State lives in the work-tree
root, next to `strict-mode.json`: `.claude/run-contract.json`,
`.claude/run-contract.events.jsonl`, `.claude/run-contract.prev.json`
(archive), `.claude/run-contract.pending` (arm marker) and
`.claude/batch-handoff.json`. All are runtime-ignored (`runtime-ignores.js`
`PLUGIN_STATE`) — never commit them.
