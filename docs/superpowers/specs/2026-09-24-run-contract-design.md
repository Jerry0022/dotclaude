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
  "source": "router | machine | cli | fallback",
  "sessionId": "<session id or null>",
  "mode": "prompt | backlog | audit",
  "modeFrom": "router | machine | cli | default",
  "flow": "interactive | autonomous",
  "ship": "auto | manual",
  "strict": false,
  "passes": ["harden", "polish"],
  "rethink": false,
  "burn": false,
  "presence": true,
  "alsoAudit": false,
  "items": ["483", "477"],
  "milestones": [],
  "auditResult": "implement | concept | null",
  "unresolved": false,
  "announced": false,
  "pcAfter": null,
  "phase": "presence | null",
  "closedAt": null,
  "closeReason": null,
  "aborted": false
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
| `branch` | `name` | PostToolUse Bash/PowerShell `git checkout -b` / `git switch -c` (exit 0) — an ITEM boundary only (R6): not from a subagent, not `git worktree add`, not `--detach`, not a `<current>-*` / `<current>/*` sub-branch. `git worktree add` never writes a `branch` event |
| `release` | `ok`, `merged`, `closes: ["473"]` (from `Closes #N` in `tool_input.body`) | PostToolUse `ship_release` |
| `card` | `variant` | PostToolUse `render_completion_card` |
| `skip` | `ob`, `reason`, `item?` | CLI `skip` |
| `park` | `item`, `reason` (ends the segment) | CLI `park` |
| `measure` | `codeFiles` (number or null) | PreToolUse release / card / branch gate |
| `block` | `gate`, `open` (obligation names refused) | PreToolUse, right before `return 2` — never counts as work or a segment boundary |

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
- `park <item> --reason "<why>"` — one `park` event for a blocked / parked
  backlog item: satisfies every obligation of the current segment (not
  `triage`), counts as the item's refine, and ends the segment.
- `done [--reason "<why>"]` — closes the contract, only when every chosen step
  ran. With open obligations (card-gate set) it refuses without `--reason`
  and closes as `aborted: true` with one (card: ✗ + reason).
- `abort --reason "<why>"` — closes it as aborted (card shows it).
- `batch-clear --reason "<why>"` — deletes a stale batch hand-off marker.
- `arm … [--session <id>]` — manual arm; without `--session` the first
  session hook that sees the fresh contract claims it.

Session binding: every header and marker stores `sessionId`; gates, arming,
recording and the card line apply only when it equals the hook's
`session_id` (when both are known). No stored id → foreign once the file is
10 min old (Claude Desktop copies the untracked `.claude/` into new
worktrees). A machine prompt over an active same-session contract refreshes
ship / passes / strict / items / presence only — never the mode, except
`RUN_BACKLOG_AUTOSTART` (→ backlog) and `mode=analyze` over audit (passes
cleared). A pending marker never replaces an active same-session contract.

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
| `Durchgänge?` | empty → every option whose label carries `(Recommended)`; `Harden danach` → harden · `Polish danach` → polish · `Rethink vorher` → rethink · `Budget verbrennen` → burn; free text `keine` / `none` → no passes; `ohne X` / `kein X` / `without X` / `no X` excludes X; an unrecognised or Other-placeholder token → the recommended set plus `unresolved: true` (card: `Durchgänge ?`) |

Headers are normalised (NFC, trimmed, trailing `?` stripped, case-folded) and
English aliases are accepted: `What`, `Flow`, `Scope`, `Passes`; follow-ups
`Result`, `Audit scope`, `Milestones`, `Issues`, `PC after`. A later
router-shaped call of the same session within 30 min that lacks one of
`Ablauf` / `Umfang` / `Durchgänge` merges only its answered fields.

Q1 missing (preset): mode = first token of the last `do-run` Skill args in
the transcript (`backlog`, `audit`; `autonomous` / `burn` / `rethink` keep
`prompt` and set flow / flags); `--from=do-batch` → `prompt`; else the
follow-up headers of the same call (`Milestones` / `Issues*` → backlog,
`Ergebnis` / `Audit-Umfang` → audit); default `prompt` (`modeFrom: default`),
which a later follow-up of the same session within 30 min upgrades to the
mode its headers imply. A user-typed `/do-run …` makes no Skill call:
`prompt.run.contract.js` writes the arm marker with its args instead.

**Arming must not fail silently.** PostToolUse Skill `do-run` writes a
`.claude/run-contract.pending` marker (runtime-ignored) — not in a turn opened
by a machine prompt; an answered `Fortsetzen` (resume) question deletes it.
The AskUserQuestion arm deletes it; an active same-session contract makes the
PreToolUse hook delete it without re-arming. If it still exists when the PreToolUse hook sees a gated call
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
| Bash / PowerShell branch creation, backlog mode, segment has work — only an item branch: no `agent_id`, not `git worktree add` / `--detach`, not `<current>-*` / `<current>/*` | `harden`, `polish`, `qa`, `do-ship` of the segment being left |
| Skill `auto-agents`, backlog, first of the contract | `triage` |
| `mcp__plugin_devops_dotclaude-ship__ship_release` | `auto-agents`, `harden`, `polish`, `qa`, `do-ship`, `refine` |
| `mcp__plugin_devops_dotclaude-completion__render_completion_card`, variant ∈ `ship-successful · ready · ready-files · released · test`, no non-empty `pending`, no `concept` | `auto-agents`, `harden`, `polish`, `qa`, `do-ship` |
| Bash / PowerShell running the offline card renderer (`mcp-server/index.js --render-card <payload.json>` — the path `stop.flow.guard` prescribes when the MCP server is dead) | same as the card row, read from the payload file; an unreadable payload (`-`, `$var`) counts as final |
| Bash / PowerShell `gh pr merge` or `git push` onto `main` / `master`, contract `ship: auto` | same as `ship_release` |
| final card, backlog, `presence`, `ship: manual` | additionally `refine` of every item in `items` |

Commands are normalised before matching (`&`, `git.exe`, git's global flags
such as `--no-pager`, `-C`, `-c`). Release / card gates look up the contract
in the session root first, then `projectRoot(tool_input.cwd)`, and run the qa
diff there; the base is `tool_input.base`, else `origin/HEAD`, else `main`,
else `master`. The gate records a `measure` event `{codeFiles:n|null}` before
deciding; the card shows `QA ?` when it is unknown.

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
Item parked (blocked ship / ⏸ Rückfrage): node "<lib>" park <item> --reason "<why>"   (backlog only)
Run over with open steps (card shows ✗): node "<lib>" abort --reason "<why>"
Only when every chosen step ran: node "<lib>" done
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
Stale marker / not a do-batch hand-off: node "<lib>" batch-clear --reason "<why>"
Kill switch (every run-contract gate): DOTCLAUDE_RUN_CONTRACT=off
```

PostToolUse Skill `do-run` or `auto-concept` deletes the marker. The marker is
session-bound like every other state file: another session's marker never
blocks.

### F. Answers without text — `hooks/post-tool-use/post.ask.answers.js`

After every `AskUserQuestion`: an answer token that equals the Other
placeholder (`run-contract.js` `OTHER_PLACEHOLDERS`: `Something else`,
`Other`, `Etwas anderes`, `Sonstiges`, `andere`, case-insensitive — the one
list; `post.ask.answers.js` imports it, never keeps its own copy) and is not
an option label of that question means the user picked Other without typing.
Inject `additionalContext`:

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

A user-TYPED devops slash command other than `do-run` / `auto-concept`
(`/auto-harden`, `/auto-polish`, `/do-ship`, `/auto-agents`, `/auto-issue`,
with or without the `devops:` prefix, in the typed `/x args` form or the
harness `<command-name>/devops:x</command-name><command-args>…` form) never
reaches the Skill tool, so without this hook its obligation would never
record. This hook writes the same `skill` event PostToolUse's Skill branch
would (B, table A) onto the active same-session contract. A typed `/do-run`
or `/auto-concept` also clears a pending `.claude/batch-handoff.json` (E) —
the same take-over the Skill-tool path already does.

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

## Limits

A contract exists only after the do-run router answered (B) or a machine
prompt armed one (G). Work that meets every criterion do-run itself would
apply — a code change, a ship — but that never went through do-run or a
machine-prompt run is not gated at all: outside a run, the delegation policy
(`hooks/lib/delegation.js`) stays an advisory kill switch and
`prompt.skill.enforce.js` only suggests a skill, it does not refuse the call.
The one place outside an active run where a mechanism still forces a skill is
the do-batch hand-off gate (E) — its `.claude/batch-handoff.json` blocks Edit
/ Write / NotebookEdit and `git commit` regardless of any contract.

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
