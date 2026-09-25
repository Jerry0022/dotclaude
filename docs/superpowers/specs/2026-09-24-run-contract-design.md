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

`run-contract.js` (AUD-016) is a thin facade re-exporting every name below
unchanged; the implementation lives in siblings: `run-contract-store.js`
(state — header/events/markers I/O, lock, quarantine, compaction),
`run-contract-answers.js` (router / follow-up / machine-prompt parsing, B/G),
`run-contract-obligations.js` (segments, obligations, gate evaluation,
messages, C/D) and `run-contract-cli.js` (the CLI below). Shared helpers:
`run-contract-qa.js` (the qa measurement `status`/`done` and the gate both
call) and `lib/git-timeout.js` (`GIT_TIMEOUT_MS` = 5000, the one per-call git
subprocess timeout, and `gitBudget(totalMs)` / `TOTAL_GIT_BUDGET_MS` = 15000,
a shared deadline for a gate's whole chain of git calls — AUD-019/AUD-031).

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

A header is normalised on read as well as on write (`sanitize()`): a
hand-edited or older header with a missing / non-array `passes`, `items` or
`milestones` reads as `[]`, unknown `mode` / `flow` / `ship` values fall back
to `prompt` / `interactive` / `manual` — the gates never throw on it (H-B6).

Writes: the header, the pending and batch markers and the archive go through
temp + rename with one retry after 50 ms, and an event append retries once
the same way (AUD-009: Windows EPERM / EBUSY from AV / indexers). A marker
(`run-contract.pending`, `batch-handoff.json`) that was read but does not
parse, is no object or lacks a valid timestamp is deleted on read, so it
cannot defeat the fast path forever (H-B14); a READ error (EBUSY / EPERM)
keeps the file and only reads as "no marker" this once (H-B14b).

**Corrupt header (AUD-022).** A header that fails to PARSE (not a read
error — an EBUSY/EPERM keeps the file untouched, RT1-R3) is re-read once and,
if still unreadable, quarantined: renamed to
`run-contract.json.corrupt-<ts>-<pid>-<rand>` (a unique name per quarantine,
RT1-R4 — never a fixed `.corrupt` a second quarantining process could unlink
from under the first), never deleted; only the newest 3 copies are kept. If a
fresh header (a race with `arm()`) shows up before the rename lands, the
rename is skipped and the fresh header wins. One `run-contract.json.corrupt.pending`
marker records that a quarantine happened; both the fast (existence-check)
and the normal path see it, and it is delivered once via `additionalContext`
with the `arm` re-arm line, then deleted (R5).

**Locking (AUD-017).** `update()` and `close()` serialise their
read-modify-write under `run-contract.json.lock` (`fs 'wx'`, a pid+nonce
token; `releaseLock()` only unlinks a lock that still holds that token). A
lock older than 1 s is stale and taken over (renamed out of the way, not
unlinked-then-recreated, RT1-R7) rather than blocking indefinitely; on
Windows a delete-pending lock (EPERM/EBUSY) is retried (R6). `close()` still
writes even when it could not acquire the lock — a close must never be
silently dropped just because the lock was busy.

**Events compaction.** `record()` compacts `run-contract.events.jsonl` once
it has grown more than 500 lines (`EVENTS_COMPACT_LINES`) past the line count
as of the last compaction — dropping foreign/previous-contract lines and,
within each already-closed segment, the `block`/`measure`/`card` lines
obligations never read. Compaction runs under the header lock and re-checks
the file size right before the rename so a lock-free append that raced in is
never silently lost (skipped, retried next time, RT1-R8).

Events (`k` = kind, `t` = iso time):

| k | fields | written by |
|---|---|---|
| `skill` | `name` (normalized, current name via `skill-names`), `args` (≤ 400 chars) | PostToolUse Skill, and UserPromptSubmit for a prompt that starts with a typed devops slash command (section G) |
| `agent` | `type` (`subagent_type`, default `general-purpose`) | PostToolUse Agent |
| `edit` | — (only when the previous event is not `edit`) | PostToolUse Edit/Write/NotebookEdit on a gated path |
| `commit` | — | PostToolUse Bash/PowerShell `git commit` (exit 0: a non-zero exit fires PostToolUseFailure, which records nothing; an interrupted call or a non-zero exit code in `tool_response` records nothing either — RT3-X1) |
| `branch` | `name` | PostToolUse Bash/PowerShell `git checkout -b` / `git switch -c`, `git branch X` followed by `git switch X` / `git checkout X` in the same command, `gh issue develop N -c` (exit 0, same failure rule as `commit`) — an ITEM boundary only (R6): not from a subagent, not `git worktree add`, not `--detach`, not a `<current>-*` / `<current>/*` sub-branch. `git worktree add` never writes a `branch` event; a lone `git branch <name>` is no branch creation (work starts only on a branch the command switches to) |
| `release` | `ok`, `merged`, `closes: ["473"]` (from `Closes #N` in `tool_input.body`) | PostToolUse `ship_release` |
| `release` | `ok` (GitHub's own `{merged}` shape — the tool's own `{content:[{text}]}` MCP envelope is parsed too, R2), `merged` (same as `ok`), `closes` (from `Closes #N` in `commit_title`/`commit_message`, else the tool's response text) | PostToolUse GitHub MCP `*__merge_pull_request` (AUD-025) — only when `tool_input.owner`/`repo` match this checkout's `origin` (a budgeted git call, R15; an unknown origin still records, unchanged from before the check existed) |
| `card` | `variant` | PostToolUse `render_completion_card`, and Bash/PowerShell running the offline `--render-card` renderer (an unreadable payload is recorded with variant `null`; whether it closes is H) — never idle-expiry activity (H-B10) |
| `skip` | `ob`, `reason`, `item?` | CLI `skip` — satisfies that obligation only, never finishes a backlog item (RT3-R1) |
| `park` | `item`, `reason` (ends the segment) | CLI `park` |
| `measure` | `codeFiles` (number or null) | PreToolUse release / card / branch gate — never counts as work, a segment boundary or idle-expiry activity (RT2-R3); not written again when the CURRENT segment's last `measure` has the same count (a new item still gets its own, H-B5) |
| `block` | `gate`, `open` (obligation names refused) | PreToolUse, right before `return 2` — never counts as work, a segment boundary or idle-expiry activity (RT2-R3); not written again when the current segment's last `block` has the same gate and list |

API (CommonJS, pure where possible, every fs error swallowed → "no contract"):
`readContract(cwd)`, `arm(cwd, header)`, `update(cwd, patch)`,
`record(cwd, event)`, `close(cwd, reason)`, `events(cwd)`,
`segments(contract, events)`, `openObligations(contract, events, gate, ctx)`,
`parseRouterAnswers(questions, answers, { doRunArgs })`,
`parseMachinePrompt(text)`, `formatBlock(contract, open, gate)`,
`summaryForCard(contract, events, lang)`.

Expiry: a contract with no activity for 12 h (interactive) / 30 h
(autonomous or backlog) — every event but `block`, `measure` and `card`
counts — reads as absent and is archived to `run-contract.prev.json` on the
next write. A new router answer set replaces an active contract (archived).
When post finds this session's contract expired unclosed (a Q&A-only run —
cards are no activity), it says so once in `additionalContext` with the `arm`
re-arm line and marks the header `expiryAnnounced` (RT3-X2).

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

**Card session ownership (R9).** The completion card's run line is shown
under a session id of `"self"` (the ccd_session convention), a Claude
Desktop `local_…` id, or none — those count as "the calling session itself",
not as a stored/foreign id. Any other explicit id must match the contract's
own `sessionId` (`mode-state.js#isSelfSessionId`).

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
`Result`, `Audit scope`, `Milestones`, `Issues`, `PC after`. A FULL router
call (Ablauf + Umfang + Durchgänge) is do-run's own signature and arms with
or without the marker. A PARTIAL router call (it lacks one of them: Flow +
Scope, or Passes alone) is resolved in this order (H-B13, RT3-R8):
(1) a fresh same-session do-run arm marker → a new run → arm;
(2) else this session has an ACTIVE contract (not closed, not expired, any
age) → merge only the answered fields into it;
(3) else nothing is recorded, and `additionalContext` says so with the `arm`
CLI line — a model-written question elsewhere never arms.

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
(D), the hook scans the transcript once (`transcript_path`, read backwards in
2 MB chunks, up to 32 MB)
for the newest `toolUseResult` carrying router headers, arms from it and
deletes the marker — when that newest one is a partial re-ask, the scan goes
on to the full router call before it (same window) and the re-ask replaces
only the fields it answered (R7, H-C2c); follow-up answers after the first
router call of that chain are applied. No such result → it arms the click-through defaults
(Prompt umsetzen · Interaktiv · Ship manuell · Flexibel · Harden + Polish) with
`source: fallback` and says so in `additionalContext`. A marker older than
2 h is ignored and removed.

Follow-up call (same hook, updates the active contract):
`Ergebnis` (`Audit als Concept` → `auditResult: concept`, passes cleared —
the concept page owns what gets built), `Milestones` (titles), `Issues`
(every `#N` in the selected labels → `items`), `PC danach` (recorded only).
Only the exact headers do-run pins (SKILL.md F3 / F4, backlog.md Step 1.2)
count: `Milestones` / `Issues` and their numbered continuations in the same
call — `Issues 2`, `Issues (2)`, `Issues 2/3`, `Milestones 2`, `Milestones
(2)` — whose selections are merged. `Issues found`, `Lose Issues`, `Open
issues list` or any other header merely containing the word is no follow-up
(H-B7, RT3-R7). An empty or Other-placeholder `Milestones` / `Issues` answer
leaves the recorded list unchanged (H-B7).

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
| `triage` | backlog, `presence`: at the first `auto-agents` of the contract, at every release, and at the final card once the contract has work (an `edit`, `commit` or `auto-agents` anywhere — H-B2) | ≥ 1 `agent` event since arm whose `description` (set by the pre-triage step, backlog.md Step 2.1, format `Triage #<N> — <title>`) contains "triage" (case-insensitive) — RT3-R10 |

RT3-R10: only an `agent` event whose recorded `description` names the
pre-triage step counts (before, ANY agent event — even an unrelated Explore
search — satisfied `triage`). An event recorded before this change with no
`description` field at all is grandfathered as satisfying it, so a backlog
run already in flight across a plugin update does not silently fail its
triage obligation retroactively; a description-carrying event (even an empty
string) is held to the new rule.

Every obligation is also satisfied by a matching `skip` event (for `refine`,
one per item). Satisfying an obligation is not finishing an item: a skip —
even `skip refine --item N` or `skip qa --item N` — never counts toward the
backlog close (H, RT3-R1). `audit` contracts carry only `harden`, `polish`, `do-ship`
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
| `mcp__plugin_devops_dotclaude-ship__ship_release` | `auto-agents`, `harden`, `polish`, `qa`, `do-ship`, `refine`, `triage` |
| `mcp__plugin_devops_dotclaude-completion__render_completion_card`, variant ∈ `ship-successful · ready · ready-files · released · test`, no non-empty `pending`, no `concept` | `auto-agents`, `harden`, `polish`, `qa`, `do-ship`; `triage` for a backlog + presence contract with work |
| Bash / PowerShell running the offline card renderer (`mcp-server/index.js --render-card <payload.json>` — the path `stop.flow.guard` prescribes when the MCP server is dead) | same as the card row, read from the payload file; an unreadable payload (`-`, `$var`, a missing file or one relative to a `cd` in the same command) is gated as final; post closes on it only under H's stricter rule (RT3-R2) |
| Bash / PowerShell `gh pr merge`, `gh api -X PUT …/pulls/N/merge`, `gh api graphql … mergePullRequest`, `git push` onto `main` / `master` (also `+main`, `+HEAD:main`), a bare `git push` / `git push origin` / `git push origin HEAD` while HEAD is `main` / `master` (HEAD is resolved only under `ship: auto`; a git error or timeout there reads as no release); contract `ship: auto` | same as `ship_release` |
| GitHub MCP `mcp__*__merge_pull_request`, contract `ship: auto` | same as `ship_release` (hooks.json matcher `mcp__.*__merge_pull_request`, RT3-R4) |
| final card, backlog, `presence`, `ship: manual` | additionally `refine` of every item in `items` |

Commands are read at COMMAND POSITION (`run-contract-calls.js`
`commandFacts`, shared by pre and post): the line is split quote-aware at
`&&`, `||`, `;`, `|`, a lone `&` (not `2>&1` / `&>`) and newlines; a quoted
executable (`"C:\…\git.exe"`, `& '…'`), `git.exe`, git's global flags (`-C`,
`-c`, `--no-pager`, …), `VAR=value`, leading `(` / `{` / `!` and a trailing
`)` / `}` on the subcommand, and the wrapper prefixes `sudo`, `doas`, `env`,
`command`, `exec`, `time`, `nice`, `nohup`, `timeout`, `builtin`, `xargs` are
looked through. Shell payloads are parsed again, up to 4 levels: `sh` /
`bash` / `zsh` `-c`, `cmd /c`, `pwsh` / `powershell` `-Command` and
`-EncodedCommand`, `eval`, `env -S`, PowerShell `Start-Process <file>
-ArgumentList …`, and `$(…)` / backtick substitutions (outside single quotes;
one holding a heredoc is text, so a commit / PR body never counts). Text
inside quotes (`echo "git commit"`, `grep "gh pr merge"`) never matches.

Also looked through (RT3): PowerShell `$x = …` / `$x += …` assignments (the
right-hand side is a command), the keywords `if` / `then` / `else` / `elif` /
`elseif` / `do` / `while` / `until` / `for` / `foreach` / `try` / `catch` /
`finally` before a command, PowerShell `(cond) { … }` blocks (`{` / `}` split
commands there, so `} else { git commit }` is read) and `ForEach-Object { … }`
/ `% { … }`, `iex` / `Invoke-Expression [-Command]`, and line continuations
(`\` / backtick + newline), joined before parsing. The shell is known from the
tool: in the PowerShell tool the backtick is an escape, never a substitution,
and `$(…)` is code. Heredoc bodies are data: a quoted delimiter's body is
stripped, an unquoted one's is scanned only for `$(…)` / backticks, a heredoc
fed to a shell (`bash|sh|zsh|dash|ksh <<EOF`, `pwsh -Command - <<EOF`) is parsed
as a script, and a heredoc without a terminator line is not stripped.
PowerShell `@'…'@` is literal; `@"…"@` is scanned for `$(…)`. The parsed text
is capped at 256 KB after heredoc stripping (`MAX_PARSE`).

Contract root (H-B1, identical in pre and post): the session root first,
then — for the MCP tools only (`ship_release` and the MCP card, which act on
`tool_input.cwd`) — `projectRoot(tool_input.cwd)`. The qa diff runs in the
input root when there is one; the MCP card is recorded and closes the
contract in the root it was gated in. The base is `tool_input.base`, else
`origin/HEAD`, else `main`, else `master`. At the card and branch gates the
count also includes working-tree changes and untracked code files (`git
ls-files --others --exclude-standard`, H-B4; an `ls-files` failure keeps the
diff-based count); the release gate counts the branch diff only. The gate records a `measure` event `{codeFiles:n|null}`
before deciding; the card shows `QA ?` when it is unknown.

An interrupted or blocked run ends with `run-contract.js abort --reason
"<status>: <why>"` before its card; an aborted contract passes the card gate
and the card line shows it as aborted with the open obligations.

Exempt paths (never gated): outside the work tree (scratchpad, temp, home),
`.claude/**`, `.git/**`, `BACKLOG-*`, `AUTONOMOUS-*`, `BURN-*`,
`docs/concepts/**`.

Git reads (diff for `qa`) only at the release / card / branch gates,
`GIT_TIMEOUT_MS` = 5000 per call; any git failure means "unknown" and never
blocks. The release gate's whole git chain (incl. the transcript walk for the
arm fallback) shares one `gitBudget(TOTAL_GIT_BUDGET_MS)` = 15000 ceiling
(AUD-019/AUD-031) — an expired budget also reads as "unknown" (`QA ?`), never
a block. Post's `baseBranch()` lookup (2 calls) shares its own
`POST_BASE_BRANCH_BUDGET_MS` = 6000 budget (R11), inside the hook's own
`hooks.json` timeout (pre 20 s; post, prompt and the answer-check hook
10 s each). AUD-023: a release-gate evaluation makes 3 git calls; measured
403 ms median on a 301-file diff idle, 588 ms median under load (a synthetic
CPU load), pinned by a deterministic budget test.

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

`prompt.batch.collect.js`, when a batch fires, shows its merge context (which
says the hand-off is enforced) and only then writes
`.claude/batch-handoff.json` `{ firedAt, sessionId }` (runtime-ignored). A
corrupt marker is deleted when read (A). While it exists and is
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

- `prompt` / `audit`: after a final-variant card (D) whose gate passed — MCP
  or a READABLE offline payload. The close follows from the card being
  final, not from its `card` event being written: a card that was shown but
  whose append failed still ends the run (H-B8). An offline payload post
  cannot read (`-`, `$p`, a file removed in the same command) may be an
  interim card pre let through, so it closes only when the contract has work
  AND `openObligations(contract, events, 'card')` is empty — exactly where a
  final card could have passed with nothing open (RT3-R2).
- `backlog`: on `done`, or when every item in `items` has an ok `release`
  closing `#N` or a `park N` — checked after `ship_release` and after every
  other recorded call, so the park that finishes the queue closes it too
  (H-C5). An obligation `skip` never finishes an item (RT3-R1).
- `audit`, `analysis` card (AUD-012, RT3-R1 guard): an `analysis` card is
  deliberately NOT a `FINAL_VARIANTS` member — the PreToolUse gate never
  refuses it — but a run ending on one must still close an AUDIT run, or it
  never closes. It is never gated. Closing is conditional, not automatic on
  any analysis card: it closes only when the card carries no non-empty
  `pending` and no `concept` (either one means the run hands off, not ends)
  AND the contract's mode is `audit` AND (the current segment has no work yet
  OR `openObligations(contract, events, 'card')` is empty) — an analysis card
  mid-run (an auto-harden "nothing fixed" card, a concept hand-off) must not
  close past a non-empty `pending`, an open `concept`, or open
  harden/polish/do-ship obligations. `prompt` / `backlog` runs are
  unaffected: an analysis card there is recorded but closes nothing.

Post also answers a partial router call it could not record (B, case 3)
and announces this session's expired contract once (A) via `additionalContext`.

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
- `deep-knowledge/run-contract.md` — the mechanism for readers, including
  the 6-file nudge (K), the one enforcement mechanism that reaches outside
  an active run; regenerate the deep-knowledge index
  (`scripts/gen-dk-index.mjs`). Not `agent-proactivity.md`: it is injected
  in full at every session start and skipped entirely past
  `MAX_ALWAYS_ON_BYTES` (`ss.knowledge.index.js`), with no room left.
- `hooks/hooks.json` — register the hooks (matchers per D, F, G, H, K).

### J. Completion card

`mcp-server/lib/mode-state.js` reads the contract (pure read, failures
swallowed) and the card shows one line when a contract is active or was
closed / aborted in the last 15 minutes (so the closing card still carries it):

```
🧾 Run · Backlog · Autonom · Ship auto — auto-agents ✓ · Harden ✓ · Polish ⚠ (keine UI) · QA ✓ · do-ship ✓
```

Backlog aggregates over segments with work (`Harden 6/6`). ✓ done · ⚠ skipped
(reason) · ✗ open. Localized de/en like the rest of the card.

### K. The 6-file nudge (AUD-024) — `hooks/post-tool-use/post.agent.nudge.js`

Outside an active run contract, the delegation policy
(`deep-knowledge/agent-proactivity.md`) is prompt-level advice only — nothing
enforces it. This PostToolUse hook (matcher `Write|Edit|NotebookEdit`) counts
the DISTINCT files the current turn has changed, from the transcript, scoped
to the turn by the same turn-boundary walk `skill-invocations.js` and
`card-guard.js` use, and filtered to the session's own work tree. At the
first call where that running count is 6 or more (`NUDGE_AT` — the parallel
Edit/Write calls of one message are already in the transcript when the first
of them runs, so the count can jump from 5 straight past 6), it emits ONE
`additionalContext` note telling the model to MENTION the `auto-agents` skill
in one sentence — an offer, never an auto-start, never a block (agent-
proactivity.md's Full-ceremony rule). It stays silent: before that call; for
a subagent's own edits (`hook.agent_id` set); outside the
session's own work tree; while a run contract is active for this session
(the run's own gates apply instead); on a non-user-typed turn (machine,
scheduled, silent); once ANY devops skill already ran this turn (Skill tool
or a typed slash command); once the nudge already fired this turn (a
once-per-turn marker keyed by the turn's opening prompt entry's `uuid`, its
`timestamp` when it has none — not its text, so a later turn that repeats a
short prompt such as "weiter" is nudged again (Q8); every later call of the
turn also counts 6 or more, and the transcript is only read as a 1 MB tail,
so on a very long turn the count can climb past 6 a second time); and
when the delegation kill switch (`lib/delegation.js`) is off. Every failure
path exits 0 silently.

## Limits

A contract exists only after the do-run router answered (B) or a machine
prompt armed one (G). Work that meets every criterion do-run itself would
apply — a code change, a ship — but that never went through do-run or a
machine-prompt run is not gated at all: outside a run, the delegation policy
(`hooks/lib/delegation.js`) stays an advisory kill switch — the 6-file nudge
(K) offers the skill once but never blocks — and
`prompt.skill.enforce.js` only suggests a skill, it does not refuse the call.
The one place outside an active run where a mechanism still forces a skill is
the do-batch hand-off gate (E) — its `.claude/batch-handoff.json` blocks Edit
/ Write / NotebookEdit and `git commit` regardless of any contract.

Known gaps of the command reading (D), each needing a real shell parser or
runtime state to close:

- A Windows path ending in `\` right before its closing quote
  (`"C:\tools\" commit`) reads as an escaped quote, so the quoted string
  runs on and the executable after it is missed.
- cmd's `start git commit …` and a command assembled at runtime (`$cmd =
  "git"; & $cmd commit`, `git $(echo commit)`) are out of scope; aliases and
  shell functions are not resolved.
- `git commit-tree` (plumbing) is not a commit.
- `git push --all` / `--mirror` can push `main` without being read as a
  release.
- PowerShell `for (…; …; …) { git commit }` is missed: the `;` inside the
  parentheses splits the command. A command inside a PowerShell `if (…)`
  condition (`if (git push origin main) { … }`) is not read either.
- A heredoc whose terminator shares its line with the closing `)`
  (`… EOF)`) is not stripped; that substitution falls back to "holds a
  heredoc → text".
- A failed `git commit` whose exit is masked by a later command
  (`git commit …; echo done`) reaches PostToolUse as a success and still
  records `commit` — the harness reports only the last exit (RT3-X1).
- The expiry notice (A) is emitted by post only (after the next matched
  call), not by pre. `env -S` / `xargs` / `Start-Process` are read only in
  their plain forms (`Start-Process` flags other than the file / argument /
  value flags are assumed to take no value).
- `lib/plugin-guard.js` still requires `project-root` at load time; H-B17
  only moved the hooks' own requires into their try/catch.
- Two sessions in ONE checkout share one contract file: the second
  session's router answers archive the first one's contract (B11); worktree
  isolation (one work tree per session) avoids it.

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
