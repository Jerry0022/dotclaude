# Run Contract — what the user chose in do-run is enforced, not hoped for

A hook records the answers to `do-run`'s questions and refuses the tool call that would walk past one of them — a skipped `auto-agents` classification, a dropped pass, a ship that bypasses `devops:do-ship` — so a chosen run is no longer only a prose promise. Design spec: `docs/superpowers/specs/2026-09-24-run-contract-design.md`.

## Why

An audit of 2026-09-24 sessions found the same failure three times: the user made a choice in `do-run` and the model walked past it — chosen Harden/Polish never ran, `ship_*` MCP tools were called directly instead of `devops:do-ship`, `auto-agents` / `devops:qa` / backlog triage+refine were skipped, and a `do-batch` fire was implemented without ever handing off to `do-run`. Every obligation lived only in skill prose; nothing checked it.

## What is recorded

A PostToolUse hook reads the do-run router's `AskUserQuestion` result — mode (`prompt` / `backlog` / `audit`), flow (interactive / autonomous), ship (auto / manual), scope (strict), the chosen passes (harden / polish / rethink / burn) — and writes it to `.claude/run-contract.json` (header) plus an append-only `.claude/run-contract.events.jsonl` (skill/agent/edit/commit/branch/release/card/skip/park/measure/block events). Headers are normalised and English aliases (`What`, `Flow`, `Scope`, `Passes`) count. A Q4 answer the hook cannot read (Other placeholder, free text) keeps the recommended passes and marks the contract `unresolved` (card: `Durchgänge ?`); `ohne X` / `without X` excludes X. When Q1 was preset away, the mode comes from the do-run args or the follow-up headers (`Issues` / `Milestones` → backlog, `Ergebnis` / `Audit-Umfang` → audit). Only the exact headers do-run pins are follow-ups — `Issues` / `Milestones` and their numbered continuations in the same call (`Issues 2`, `Issues (2)`, `Issues 2/3`, `Milestones 2`); `Issues found` or `Open issues list` is not; an empty or "Other" answer there leaves the recorded list unchanged. A header on disk is normalised on read too (a missing `passes` reads as `[]`).

Arming never fails silently: a `.claude/run-contract.pending` marker — written when `do-run` starts, by the Skill call or a typed `/do-run …` (only when the prompt itself opens with it, not a `<command-name>` tag pasted mid-prompt) — is scanned from the transcript if the `AskUserQuestion` arm is missed, else falls back to the click-through defaults with `source: fallback` (announced once with the `arm` / `done` call that corrects it). When the newest router answer in the transcript is a partial re-ask, it merges over the full answers before it instead of replacing them. A partial router call (Flow + Scope, or Passes alone) arms after a fresh same-session do-run marker, else merges its answered fields into this session's active contract (any age), else is not recorded — and says so with the `arm` line; a full one arms with or without the marker. A marker that does not parse is deleted when read; a transient read error (Windows EBUSY / EPERM) keeps it. Header, marker and archive writes and event appends retry once. A do-run that skips the router (resume, machine prompt, backlog's own sub-run) never replaces an active contract. `RUN_BACKLOG_AUTOSTART:` / `AUTONOMOUS_AUTOSTART:` machine prompts arm from their `key=value` pairs; over an active contract they only refresh ship / passes / strict / items / presence — never the mode (except `RUN_BACKLOG_AUTOSTART` → backlog).

A devops skill the user TYPES as a slash command — `/auto-harden`, `/auto-polish`, `/do-ship`, `/auto-agents`, `/auto-issue`, bare or under `devops:`, same start-of-prompt rule — never reaches the Skill tool, so `prompt.run.contract.js` (a `skill` event's second writer, besides PostToolUse Skill) records it like the Skill-tool path would; typed `/do-run` or `/auto-concept` also clears a pending do-batch hand-off marker. A typed `/auto-agents` this way skips the PreToolUse `auto-agents` gate that would otherwise check backlog pre-triage — the release gate's own `triage` check (below) is the safety net that still catches it before ship.

Every header and marker is **session-bound**: it gates, arms and shows on the card only for the session whose `session_id` it stores (Claude Desktop copies the main checkout's untracked `.claude/` into every new worktree, so a copied file must never gate a foreign session). A file without a stored session id counts as foreign once it is 10 min old; a fresh one (CLI `arm`) is claimed by the first session that touches it. A contract also expires — reads as absent, archived to `run-contract.prev.json` — after 12 h idle (interactive) or 30 h (autonomous / backlog); `block` / `measure` / `card` events never count toward that idle activity, only real work does, so a Q&A-only run expires and post then says so once, with the `arm` line; `measure` / `block` are deduplicated within the current segment only. An interrupted call or a non-zero exit code records no `commit` / `branch`.

## Obligations

Evaluated on the current **segment** (events since the last item boundary — a successful `release`, a `park`, or in backlog mode a new item branch: not from a subagent, not `git worktree add` / `--detach`, not a `<current>-*` / `<current>/*` sub-branch):

| Obligation | Applies when | Satisfied by |
|---|---|---|
| `auto-agents` | mode `prompt` or `backlog` | a `Skill("devops:auto-agents")` call in the segment |
| `harden` | Harden was chosen, segment has work | `Skill("devops:auto-harden")` without `--invoked-by=ship` |
| `polish` | Polish was chosen, segment has work | `Skill("devops:auto-polish")`, same rule |
| `qa` | segment has work and changed code files past the threshold (≥1 backlog, >5 prompt) | a `devops:qa` agent |
| `do-ship` | `ship: auto`, segment has work | a `Skill("devops:do-ship")` call, then a `release: ok` or a blocked/aborted card |
| `refine` | backlog, present user: a release closing `#N`, or (Ship manuell) the final card for every queued item | a `devops:auto-issue` refine of `#N` |
| `triage` | backlog, present user, first `auto-agents` of the run, every `release`, and the final card once the run did work | ≥1 agent event since arm |

Every obligation is also satisfied by a matching `skip`, every one but `triage` by a `park` of the item. A skip never finishes a backlog item — only an ok release closing `#N` or `park N` does. `qa` diffs against `tool_input.base`, else `origin/HEAD`, else `main` / `master`; the gate records the count as a `measure` event first — unknown (no base, unborn HEAD) shows as `QA ?`.

## Gates

A PreToolUse hook (`hooks/pre-tool-use/pre.run.contract.js`) exits 2 with the exact `Skill(...)` call that satisfies the open obligation, before:

- an Edit/Write/NotebookEdit or `git commit` on a gated path, when `auto-agents` is open;
- an item branch in backlog mode, for the segment's open `harden`/`polish`/`qa`/`do-ship`;
- the first `auto-agents` call of a backlog run, when `triage` is open;
- `ship_release` — and, while `ship: auto`, `gh pr merge`, `gh api -X PUT …/pulls/N/merge`, a `git push` onto `main` / `master` (`+main`, or a bare `git push` / `git push origin HEAD` while on main) and the GitHub MCP `merge_pull_request` — for every obligation above still open, `triage` included;
- a final-variant completion card (`ship-successful`, `ready`, `released`, `test`, …; an unreadable `--render-card` payload is gated as final), for `auto-agents`/`harden`/`polish`/`qa`/`do-ship` (+ `refine` in Ship-manuell backlog, + `triage` in a backlog run with a present user once it did work). A final card closes a `prompt` / `audit` run even if its `card` event could not be written; an unreadable offline payload closes it only when the run did work and nothing is open at the card gate.

Commands are read at command position, quote-aware (text inside quotes never matches): quoted executables and `git.exe`, git's global flags, wrapper prefixes (`sudo`, `env`, `command`, `exec`, `time`, `nice`, `nohup`, `timeout`, `xargs`, …), shell / `eval` / `-EncodedCommand` / `env -S` / `Start-Process` payloads and `$(…)` substitutions, a lone `&` as a separator, PowerShell `$x =` assignments, `{ }` blocks and `iex`, bash `if`/`while` one-liners, joined line continuations. The shell is known: in the PowerShell tool a backtick is an escape. Heredoc bodies are data unless fed to a shell (an unquoted one is scanned for `$(…)` only); `@'…'@` is literal. At most 256 KB is parsed. A lone `git branch <name>` creates no item branch — `checkout -b` / `switch -c`, `git branch X && git switch X` and `gh issue develop N -c` do. The contract lives in the session root; only the MCP tools (`ship_release`, the MCP card) also look in `tool_input.cwd`'s root, in pre and post alike. The qa count at card / branch gates includes uncommitted and untracked code files. The check exits fast (existence checks only) when no contract and no marker exist; the remaining cost is one `node` spawn per matched call. A refused call writes a `block` event (`gate`, the open obligation names) before it exits 2 — a lasting trace beyond the stderr message; it counts as neither work, a boundary nor idle activity.

## Limits

A contract exists only after do-run's router answered, or a machine prompt armed one. Work that meets do-run's own criteria but that never went through do-run (or a machine-prompt run) is not gated at all — outside an active run the delegation policy stays advisory (a kill switch, not a gate) and the trigger router only suggests a skill. The one place outside a run that still forces a skill is the do-batch hand-off gate below. The command reading has known gaps (a Windows path ending in `\` right before its closing quote; cmd's `start` and commands built at runtime are out of scope; `git commit-tree` is no commit — see the spec's Limits), and two sessions in one checkout share one contract file (the later router answers replace the earlier run's contract) — use a worktree per session.

## CLI: status, skip, park, abort, done, batch-clear

```bash
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" status
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" skip <ob> [--item <N>] --reason "<why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" park <N> --reason "<why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" abort --reason "<why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" done [--reason "<why>"]
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" batch-clear --reason "<why>"
```

`<ob>` is one of `auto-agents | harden | polish | qa | do-ship | refine | triage`. Every call but `status` refuses without a reason where one is listed — a deviation is explicit, never silent. `skip` shows as `⚠ <reason>`. `park` records a blocked / `⏸ Rückfrage` backlog item once and ends its segment. `abort` closes a run that is over with open steps (card: ✗ + reason), before its card. `done` is only for a run where every chosen step ran (`prompt` / `audit` close at the final card anyway; `backlog` once every queued item shipped or was parked); with open obligations it refuses unless `--reason` is given and then closes as aborted.

## The batch hand-off gate

When a `do-batch` merge fires, `prompt.batch.collect.js` shows its merge context and then writes `.claude/batch-handoff.json`. While it exists (same session, under 6 h), the PreToolUse hook refuses Edit/Write/NotebookEdit and `git commit` with a message pointing at `Skill("devops:do-run", "--from=do-batch …")` for a ready plan or `Skill("devops:auto-concept", "--from=do-batch …")` for one with open decisions — reading, exploring and planning stay allowed. The `do-run` / `auto-concept` PostToolUse call deletes the marker; a stale one goes with `batch-clear --reason`, which the block names with the kill switch.

## The answer-check

After every `AskUserQuestion`, `hooks/post-tool-use/post.ask.answers.js` checks for an answer token that equals an "Other" placeholder (the one list, `run-contract.js` `OTHER_PLACEHOLDERS`: `Something else`, `Other`, `Etwas anderes`, `Sonstiges`, `andere`, …) with no typed text — that combination means the user wanted something the options did not offer, not that they picked nothing. It injects a context note telling the model to ask what, in one more question, before acting on that answer.

## Kill switch and state

`DOTCLAUDE_RUN_CONTRACT=off` disables arming and every gate — use it if a misfiring gate wedges a session; the CLI verbs above are the normal escape hatches, the kill switch is the emergency one. State lives in the work-tree root, next to `strict-mode.json`: `.claude/run-contract.json`, `.claude/run-contract.events.jsonl`, `.claude/run-contract.prev.json` (archive), `.claude/run-contract.pending` (arm marker) and `.claude/batch-handoff.json`. All are runtime-ignored (`runtime-ignores.js` `PLUGIN_STATE`) — never commit them.
