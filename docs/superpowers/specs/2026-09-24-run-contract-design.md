# Run contract — what the user chose in do-run is enforced, not hoped for

Date: 2026-09-24 · Status: approved for implementation · Owner: devops plugin

## Why

An audit of all sessions of 2026-09-24 found three failures of the same kind:
the user made a choice and the model walked past it.

1. **Backlog run** (`/do-run backlog`, answers *Weg · Ship automatisch*, *Mit
   Umfeld*, *Harden danach + Polish danach*, six issues). All six shipped, but:
   - no issue got the Harden or Polish pass the user ticked;
   - every issue was shipped by calling the `ship_*` MCP tools directly — never
     `Skill("devops:do-ship")` — so the ship-time diff passes and the Codex
     review of do-ship were skipped too;
   - `auto-agents` was never invoked (no tier decision, no start table), no
     `devops:qa` agent ran, backlog Step 2 (pre-triage agents, `auto-issue`
     refine per issue) was skipped;
   - the answer *Something else* (the Other option, submitted without text) in
     the issue selection was silently ignored.
2. **Batch fire** (`do-batch`, "los: implementiere alles direkt …"). The rule
   says a ready plan goes to `do-run --from=do-batch`. The session read the
   do-run skill file, then implemented everything itself: no do-run questions,
   no `auto-agents` start table, no passes.

Root cause: every one of these obligations lives only in skill prose. Nothing
checks it, and two escape hatches make skipping look legitimate — the router's
"Inline shortcut" and auto-agents' "a caller may skip this skill for Inline".

## Principle

1. **The hook records the choice, not the model.** The do-run router's
   answers are read by a PostToolUse hook straight from the `AskUserQuestion`
   result and written to a contract file. No model cooperation is needed to
   arm it.
2. **The tool call that would walk past an open obligation is refused** by a
   PreToolUse hook (exit 2) with the exact call that satisfies it.
3. **Every deviation is explicit and visible.** A conscious skip is one CLI
   call with a reason; the completion card shows it as ⚠. Nothing is ever
   silently dropped — an open obligation shows as ✗ on every card.
4. **Criteria, not self-judgment.** Where the rules name a measurable
   criterion (files changed, code vs. docs), the gate measures it from git.

## Components

### A. `hooks/lib/run-contract.js` — state, parsing, obligations, CLI

State lives in the **work-tree root** (`project-root.js`), next to
`strict-mode.json`:

- `.claude/run-contract.json` — the header, written on arm / update / close.
- `.claude/run-contract.events.jsonl` — append-only events (one JSON object
  per line, `appendFileSync`), so parallel writers never lose a whole file.

These, plus `.claude/run-contract.prev.json` (archive),
`.claude/run-contract.pending` (arm marker, B) and `.claude/batch-handoff.json`
(E), go into `runtime-ignores.js` `PLUGIN_STATE` (and therefore into
`scripts/check-claude-artifacts.js` coverage).

Header:

```json
{
  "v": 1,
  "id": "rc-<ts36>-<rand>",
  "armedAt": "<iso>",
  "source": "router | machine | cli",
  "sessionId": "<session id or null>",
  "mode": "prompt | backlog | audit",
  "flow": "interactive | autonomous",
  "ship": "auto | manual",
  "strict": false,
  "passes": ["harden", "polish"],
  "rethink": false,
  "burn": false,
  "presence": true,
  "items": ["483", "477"],
  "milestones": [],
  "auditResult": "implement | concept | null",
  "closedAt": null,
  "closeReason": null
}
```

`presence` is false when the contract was armed from a machine prompt
(`RUN_BACKLOG_AUTOSTART:` presence timeout skips backlog Step 2).

Events (`k` = kind, `t` = iso time):

| k | fields | written by |
|---|---|---|
| `skill` | `name` (normalized, current name via `skill-names`), `args` (≤ 400 chars) | PostToolUse Skill |
| `agent` | `type` (`subagent_type`, default `general-purpose`) | PostToolUse Agent |
| `edit` | — (only when the previous event is not `edit`) | PostToolUse Edit/Write/NotebookEdit on a gated path |
| `commit` | — | PostToolUse Bash/PowerShell `git commit` (exit 0) |
| `branch` | `name` | PostToolUse Bash/PowerShell `git checkout -b` / `git switch -c` / `git worktree add` (exit 0) |
| `release` | `ok`, `merged`, `closes: ["473"]` (from `Closes #N` in `tool_input.body`) | PostToolUse `ship_release` |
| `card` | `variant` | PostToolUse `render_completion_card` |
| `skip` | `ob`, `reason`, `item?` | CLI `skip` |

API (CommonJS, pure where possible, every fs error swallowed → "no contract"):
`readContract(cwd)`, `arm(cwd, header)`, `update(cwd, patch)`,
`record(cwd, event)`, `close(cwd, reason)`, `events(cwd)`,
`segments(contract, events)`, `openObligations(contract, events, gate, ctx)`,
`parseRouterAnswers(questions, answers, { doRunArgs })`,
`parseMachinePrompt(text)`, `formatBlock(contract, open, gate)`,
`summaryForCard(contract, events, lang)`.

Expiry: a contract with no event for 12 h (interactive) / 30 h (autonomous
or backlog) reads as absent and is archived to `run-contract.prev.json` on the
next write. A new router answer set replaces an active contract (archived).

Kill switch: `DOTCLAUDE_RUN_CONTRACT=off` disables arming and every gate.

CLI (`node hooks/lib/run-contract.js …`, prints one JSON line):

- `status` — header + open obligations of the current segment.
- `skip <ob> [--item <N>] --reason "<why>"` — records a conscious skip.
  `<ob>` ∈ `auto-agents | harden | polish | qa | do-ship | refine | triage`.
  Refuses without a reason.
- `done [--reason "<why>"]` — closes the contract (run finished).
- `abort --reason "<why>"` — closes it as aborted (card shows it).

### B. Parsing the router answers

The router's call is recognised by its headers — `Durchgänge?` (Q4, never
dropped) or both `Ablauf?` and `Umfang?`. Answers come from
`tool_response.answers` (object keyed by question text; values are a string or
a string array), falling back to `tool_input.answers`. A string that is no
exact option label is split on `,` (older runtimes joined multi-select).

| Header | Answer → field |
|---|---|
| `Was?` | `Prompt umsetzen` → `prompt` · `Audit` → `audit` · `Backlog` → `backlog` |
| `Ablauf?` | starts `Interaktiv` or legacy `Dabei` → `interactive`; `Autonom` / legacy `Weg` → `autonomous`; contains `Ship automatisch` → `auto`, `Ship manuell` → `manual` |
| `Umfang?` | `Strikt` / legacy `Nur das` → `strict: true`; `Flexibel` / legacy `Mit Umfeld` → false |
| `Durchgänge?` | empty → every option whose label carries `(Recommended)`; `Harden danach` → harden · `Polish danach` → polish · `Rethink vorher` → rethink · `Budget verbrennen` → burn; free text `keine` / `none` → no passes |

Q1 missing (preset): mode = first token of the last `do-run` Skill args in
the transcript (`backlog`, `audit`; `autonomous` / `burn` / `rethink` keep
`prompt` and set flow / flags); `--from=do-batch` → `prompt`; default `prompt`.

**Arming must not fail silently.** PostToolUse Skill `do-run` writes a
`.claude/run-contract.pending` marker (runtime-ignored). The AskUserQuestion
arm deletes it. If it still exists when the PreToolUse hook sees a gated call
(D), the hook scans the transcript tail once (`transcript_path`, last ~2 MB)
for the newest `toolUseResult` carrying router headers, arms from it and
deletes the marker; no such result → it arms the click-through defaults
(Prompt umsetzen · Interaktiv · Ship manuell · Flexibel · Harden + Polish) with
`source: fallback` and says so in `additionalContext`. A marker older than
2 h is ignored and removed.

Follow-up call (same hook, updates the active contract):
`Ergebnis` (`Audit als Concept` → `auditResult: concept`, passes cleared —
the concept page owns what gets built), `Milestones` (titles), headers
starting `Issues` (every `#N` in the selected labels → `items`),
`PC danach` (recorded only).

### C. Obligations

Evaluated on the **current segment** — the events since the last item
boundary. Boundary: a `release` with `ok: true`, and in backlog mode also a
`branch` event. A segment **has work** when it holds an `edit`, `commit` or
`auto-agents` skill event.

| Obligation | Applies | Satisfied by (in the segment unless noted) |
|---|---|---|
| `auto-agents` | mode `prompt` or `backlog` | `skill` `auto-agents` |
| `harden` | `passes` has harden, segment has work | `skill` `auto-harden` whose args do NOT contain `--invoked-by=ship` |
| `polish` | `passes` has polish, segment has work | `skill` `auto-polish`, same args rule |
| `qa` | segment has work, and changed **code** files (git, `browsertest-guard.isCodeChange`) ≥ 1 in backlog or > 5 in prompt mode | `agent` of type `devops:qa` |
| `do-ship` | `ship: auto`, segment has work | release gate: a `skill` `do-ship` in the segment · card/branch gate: a `release` ok, or a `card` `ship-blocked` / `aborted` in the segment |
| `refine` | backlog, `presence`, release closes `#N` | a `skill` `auto-issue` anywhere in the contract whose args name `#N` (or `issue` … `N`) |
| `triage` | backlog, `presence`, first `auto-agents` of the contract | ≥ 1 `agent` event since arm |

Every obligation is also satisfied by a matching `skip` event (for `refine`,
one per item). `audit` contracts carry only `harden`, `polish`, `do-ship`
(audit applies its fixes itself, `audit.md` 7a).

### D. Gates — `hooks/pre-tool-use/pre.run.contract.js`

Early exit when none of `.claude/run-contract.json`,
`.claude/run-contract.pending` and `.claude/batch-handoff.json` exists (one
`existsSync` each, before the lib is loaded). The real cost on the
no-contract path is the one `node` spawn per matched call that every command
hook pays — the early exit only keeps the hook from adding work on top.

| Tool call | Checks |
|---|---|
| Edit / Write / NotebookEdit on a path inside the work tree that is not exempt | `auto-agents`; batch handoff (E) |
| Bash / PowerShell `git commit` | `auto-agents`; batch handoff |
| Bash / PowerShell branch creation, backlog mode, segment has work | `harden`, `polish`, `qa`, `do-ship` of the segment being left |
| Skill `auto-agents`, backlog, first of the contract | `triage` |
| `mcp__plugin_devops_dotclaude-ship__ship_release` | `auto-agents`, `harden`, `polish`, `qa`, `do-ship`, `refine` |
| `mcp__plugin_devops_dotclaude-completion__render_completion_card`, variant ∈ `ship-successful · ready · ready-files · released · test`, no non-empty `pending`, no `concept` | `auto-agents`, `harden`, `polish`, `qa`, `do-ship` |
| Bash / PowerShell running the offline card renderer (`mcp-server/index.js --render-card <payload.json>` — the path `stop.flow.guard` prescribes when the MCP server is dead) | same as the card row, read from the payload file |

An interrupted or blocked run ends with `run-contract.js abort --reason
"<status>: <why>"` before its card; an aborted contract passes the card gate
and the card line shows it as aborted with the open obligations.

Exempt paths (never gated): outside the work tree (scratchpad, temp, home),
`.claude/**`, `.git/**`, `BACKLOG-*`, `AUTONOMOUS-*`, `BURN-*`,
`docs/concepts/**`.

Git reads (diff for `qa`) only at the release / card / branch gates, 5 s
timeout; any git failure means "unknown" and never blocks.

Block message (stderr, exit 2) — English, stable prefix, one screen:

```
[run-contract] BLOCKED at <gate>: the run the user chose is not finished.
Chosen: Backlog · Autonom · Ship automatisch · Harden + Polish
Open for this item: harden, polish, do-ship
Do now:
  Skill("devops:auto-harden", "--invoked-by=autonomous")
  Skill("devops:auto-polish", "--invoked-by=autonomous")
  Skill("devops:do-ship", "--queued=<n>/<N>")   ← never the ship_* MCP tools directly
Conscious skip (shown on the card as ⚠): node "<lib>" skip <ob> --reason "<why>"
Run finished or this is not part of it: node "<lib>" done
```

`--invoked-by` in the hint follows the contract: `autonomous` for an
autonomous flow, `do-run` for an interactive one; `--strict` is appended
under Strikt.

### E. Batch hand-off gate

`prompt.batch.collect.js`, when a batch fires, writes
`.claude/batch-handoff.json` `{ firedAt, sessionId }` (runtime-ignored) and
says in its merge context that the hand-off is enforced. While it exists and is
younger than 6 h, the PreToolUse hook refuses Edit / Write / NotebookEdit on
gated paths and `git commit` with:

```
[run-contract] BLOCKED: a do-batch plan is waiting for its hand-off.
A ready plan goes to Skill("devops:do-run", "--from=do-batch …"), a plan with
open decisions to Skill("devops:auto-concept", "--from=do-batch …") — never
implemented directly. Reading, exploring and planning stay allowed.
```

PostToolUse Skill `do-run` or `auto-concept` deletes the marker.

### F. Answers without text — `hooks/post-tool-use/post.ask.answers.js`

After every `AskUserQuestion`: an answer token that equals the Other
placeholder (`Something else`, `Other`, `Etwas anderes`, `Sonstiges`,
case-insensitive) and is not an option label of that question means the user
picked Other without typing. Inject `additionalContext`:

```
[answer-check] "<question>" was answered with "Something else" and no text.
The user wants something the options did not offer. Ask what, in ONE
AskUserQuestion, before acting on this question's answer.
```

### G. Arming from machine prompts — `hooks/user-prompt-submit/prompt.run.contract.js`

`RUN_BACKLOG_AUTOSTART:` and `AUTONOMOUS_AUTOSTART:` prompts carry the
answers as `key=value` pairs (`ship=`, `passes=`, `strict=`, `queue=`,
`burnMode=`, `phase=`). Arm (or refresh) the contract from them with
`source: machine`; `phase=presence` sets `presence: false`.

### H. Recording and closing — `hooks/post-tool-use/post.run.contract.js`

Writes the events of table A, arms/updates from router answers (B), deletes
the batch marker (E), and closes:

- `prompt` / `audit`: after a final-variant card (D) whose gate passed.
- `backlog`: on `done`, or when every item in `items` has a `release` closing
  it or an item `skip`.

### I. Skill and doc changes

- `skills/do-run/SKILL.md` — new **Step 5b Run contract** (armed by the hook
  from the answers; the gates; `skip` / `done`); the router's Inline shortcut
  is removed: inside a do-run run `auto-agents` always decides the tier.
  Step 7 names the gates. Rules gain "every chosen pass runs or is skipped
  with a reason on the card".
- `skills/auto-agents/SKILL.md` — "a caller may skip this skill for Inline"
  gets the exception "not a do-run run"; the Inline tier prints one line
  (`▶ Inline · <reason: domains, ~files>`) so the tier decision is visible.
- `skills/do-run/modes/backlog.md` — Step 4 loop: IMPLEMENT via auto-agents,
  QA via `devops:qa`, PASSES via auto-harden / auto-polish, SHIP only via
  `Skill("devops:do-ship", "--queued=<n>/<N> --keep")` — never the `ship_*`
  MCP tools directly; each is gated. Step 5 ends with `run-contract.js done`.
- `skills/do-run/modes/autonomous.md` — Step 7 / 8: `done` after the report.
- `skills/do-batch/SKILL.md` — the hand-off is hook-enforced (E).
- `deep-knowledge/run-contract.md` — the mechanism for readers; regenerate
  the deep-knowledge index (`scripts/gen-dk-index.mjs`).
- `hooks/hooks.json` — register the four hooks (matchers per D, F, G, H).

### J. Completion card

`mcp-server/lib/mode-state.js` reads the contract (pure read, failures
swallowed) and the card shows one line when a contract is active or was
closed / aborted in the last 15 minutes (so the closing card still carries it):

```
🧾 Run · Backlog · Autonom · Ship auto — auto-agents ✓ · Harden ✓ · Polish ⚠ (keine UI) · QA ✓ · do-ship ✓
```

Backlog aggregates over segments with work (`Harden 6/6`). ✓ done · ⚠ skipped
(reason) · ✗ open. Localized de/en like the rest of the card.

## Acceptance

1. **Replay test** (`hooks/run-contract.replay.test.js`): the tool sequences of
   the two audited sessions, reduced to hook inputs, are refused at the first
   violating call — the backlog session at its first `Write` after the answers
   (`auto-agents`) and, when forced past it, at its first `ship_release`
   (`harden`, `polish`, `do-ship`, `refine`); the batch session at its first
   `Edit` after the fire. The *Something else* answer yields the
   `[answer-check]` context.
2. **Happy path test**: arm → triage agent → `auto-issue` refine #473 →
   `auto-agents` → Edit → `auto-harden --invoked-by=autonomous` →
   `auto-polish` → `devops:qa` agent → `do-ship` → `ship_release`
   (`Closes #473`) passes every gate; the card line reads all ✓.
3. Unit tests for parsing (current and legacy labels, empty Q4, free text,
   comma-joined strings), segmentation, each obligation, skip, expiry, kill
   switch, exempt paths, and the no-contract fast path.
4. `npm test` and `npm run lint` green.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A misfiring gate wedges a session | every block names `skip` and `done`; `DOTCLAUDE_RUN_CONTRACT=off`; expiry |
| A leftover contract gates unrelated later work | 12 h / 30 h idle expiry; a new router answer set replaces it; `done` in every block message |
| Latency on every Edit / Bash | existence check first; git only at release / card / branch gates |
| Parallel subagents writing events | append-only JSONL; header written only on arm / update / close |
| Worktree-isolated agents | own work-tree root → no contract there → never gated |
| Old cached plugin labels | legacy labels parsed (table B) |
