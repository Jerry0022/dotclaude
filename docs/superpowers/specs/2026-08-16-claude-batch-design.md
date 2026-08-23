# claude-batch — Collect Prompts, Merge Once

**Date:** 2026-08-16
**Status:** Approved for implementation
**Skill:** `/claude-batch`

## Problem

Working on a running app produces a stream of small observations — a misplaced
button, a wrong error string, an idea for a filter. Sending each as its own
prompt has two costs:

1. **Turn cost.** Every prompt pays the full accumulated context as input plus
   orientation reads and output. Eight observations are eight turns, not eight
   prompts' worth of tokens.
2. **Rework.** Observation 5 frequently supersedes observation 1. Anything built
   for 1 was built for nothing. This is the larger cost by an order of
   magnitude, and it is the cost this feature is primarily designed against.

The repo already covers the ends of this pipeline but not the middle:
`/setup-issue` rejects small observations by design (the user-value gate refuses
issues that are "only valuable together with other issues"), and `/run-backlog`
consumes GitHub issues as its input. What is missing is lightweight capture
*below* the issue threshold.

## Non-goals

- Replacing `/setup-issue` + `/run-backlog` for work that deserves an issue.
- Persisting a second backlog representation that must stay in sync with
  GitHub issues.
- Interpreting or judging notes during the collection phase.

## Design

### Activation

Opt-in per session. `/claude-batch on` writes a mode file; `/claude-batch off`
removes it. On very first use the skill asks once for the **execute marker** and
stores it user-globally in `~/.claude/claude-batch.json`. Default proposal: `>>`
at the start of the line.

**A marker may not start with `!`, `/`, `#` or `@`.** The harness claims those
before a prompt exists — `!` switches the input line to bash mode and runs it as
a shell command, `/` expands a slash command, `#` appends to CLAUDE.md, `@`
expands a file mention. None of them arrive at UserPromptSubmit as a prompt, so a
marker built on one is dead on arrival: collection keeps blocking every prompt
while the single documented escape does nothing. `validateMarker` therefore
rejects them (`reason: 'harness-reserved'`) instead of warning, and `loadConfig`
re-validates on every read so a config written before this rule (`!`) falls back
to the default rather than trapping the user.

#### The activation race

The activating prompt is the one prompt collection can never catch. The hook arms
the mode *in the turn that prompt starts*, so it necessarily sees that prompt
while the mode is still off and has to let it through. When the user activates
and types their first observations into the same prompt — `/claude-batch on der
Header ist rot …`, or "Sammelmodus an, erste Notiz: …" — the model reads
actionable text, starts working it, and skips the marker question. The notes are
never filed: the mode ends up **on and empty** while the work it exists to defer
is already half-done. Observed twice in real use.

The hook cannot fix this by storing the text itself. Nothing has activated at
UserPromptSubmit time, and a "note" written for a prompt that turns out to be a
question *about* the mode would be pure corruption. So the split is:

- `detectActivation()` (`batch-state.js`) recognises an activating prompt —
  either an expanded `/claude-batch`, or a trigger phrase that shares its clause
  with an intent word (`an`, `on`, `aktivier…`); naming the mode in passing is
  not activating it. Machine prompts are excluded, same as in collection. It
  then reports whether anything beyond the route word rides along.
- The hook injects a **guard** into that turn: the extra content is a note, do
  not act on it, do not skip Step 2.1, file it in Step 2.4.
- `SKILL.md` Step 1 routes on the first token only and Step 2.4 seeds the
  remainder verbatim as one note via `appendNote`.

Guidance, not enforcement — deliberately. The detection is a heuristic, and the
guard says so: a false positive must cost nothing but a few ignored lines, never
a swallowed prompt.

### Collection

While the mode is active, `prompt.batch.collect` (UserPromptSubmit) blocks the
prompt via `{"decision": "block", "reason": …}` and appends it to
`.claude/batch.md`.

Per the official hook docs, exit-2 / `decision: block` on UserPromptSubmit
"blocks prompt processing and erases the prompt" — it never reaches the model
and never enters the transcript. The `reason` is surfaced to the user, which is
the acknowledgement channel.

**Appends use `fs.appendFileSync`, never read-modify-write.** A read-modify-write
loses entries when the optional compaction child rewrites the file concurrently.

**Storage is a project file, not `os.tmpdir()`:**
- survives crash, reboot, and `/clear` (which mints a new `session_id` and would
  orphan a session-scoped temp file)
- is readable and editable in the editor, and can be filled without Claude
  running at all
- is not subject to Windows Storage Sense cleanup
- avoids the glob fallback in `hooks/lib/session-id.js`, which can return
  another window's file

`.claude/batch.md` is registered in the repo-local git exclude, not `.gitignore`
(it is machine state, not a project decision).

### What is never collected

Passthrough is unconditional for:

| Class | Why |
|---|---|
| Machine prompts | Cron re-entries arrive as UserPromptSubmit. Collecting them kills the `/concept` bridge, which polls once a minute. (Note: git-sync no longer re-enters via cron since #287 moved it to a detached background sync — the `Silently run …` shape stays on the allowlist because other crons use it.) |
| `AUTONOMOUS_AUTOSTART:` / `AUTONOMOUS_RESUME:` | These do **not** match the existing patterns in `prompt.flow.silent-turn.js` — an allowlist reusing only that module misses them, and an AFK run would never start. |
| Expanded slash commands | Arrive with a `<command-name>` tag; the raw text is not literally `/claude-batch off`. A naive text comparison misses exactly the escape hatch it is meant to protect. |
| Prompts with attachments or `@file` | The prompt is *erased* from the UI on block. A collected screenshot is unrecoverable, and an expanded `@file` would dump whole files into the queue — inverting the saving. |

### Firing

A prompt starting with the execute marker means "work on it now", not "handle
this one prompt normally". The hook passes it through and injects the full note
list as context. Claude then:

1. reads every collected note (verbatim; summarised only when oversized),
2. feasibility-checks the merged intent against the actual code,
3. lists contradictions **individually** rather than silently resolving them by
   "later wins",
4. presents the plan for approval.

After approval: `/concept` when the conflicts justify a decision page, otherwise
straight to implementation. Implementation is deliberately broad — code,
concepting, UI concepting, or only a first step.

**Firing deactivates the mode**, in the same hook run that injects the notes.
Everything after the fired prompt is the conversation *about* the implementation —
plan approval, answers to Claude's questions, course corrections — and collecting
those blocks and erases the very prompts the work depends on, with the note queue
already archived. The mode is single-shot per activation: re-arming is an explicit
`/claude-batch on`. A marker prompt on an **empty** queue fires nothing and
therefore leaves the mode armed.

### Reminder

A detached watchdog (`scripts/batch-watchdog.js`) fires a Windows toast after 10
minutes without a **user** prompt.

The inactivity clock reads a dedicated timestamp file, **not** the notes file's
mtime. Machine prompts touch the session every minute; a clock hanging off
general activity would never reach 10 minutes.

Against orphans: PID lockfile with a liveness check before spawning, hard
self-expiry after 2 hours, and self-exit as soon as the mode file disappears.

Reuses `spawnBgRunner` semantics from `hooks/lib/graphify-state.js` (spawn
`node` directly, never `shell: true` — a shell layer pops a visible Windows
Terminal tab) and the PowerShell `NotifyIcon` pattern from
`scripts/post-merge-watcher.js`.

### Local LLM (optional)

Deduplication and formatting only. **No interpretation, no contradiction
detection, no summarisation of intent** — `plugins/local-llm/deep-knowledge/delegation-rules.md`
classifies ambiguous user requests as RED (never delegate) and caps practical
context at ~8K tokens. A wrong compaction is worse than none: the master plan
silently loses a requirement and the original is no longer in the UI to check
against.

Contradiction detection stays with Claude at fire time, where the code is
visible. If AnythingLLM is not running, the list simply stays raw.

The dependency is soft: `devops` and `local-llm` are independently installable,
so the call is a guarded path resolution, never a hard cross-plugin `require`.

### Failsafe

The mode file carries `expiresAt` and `maxNotes`. Either limit deactivates
collection automatically. A bug in marker comparison can therefore never lock
the user out of their own session — the worst case is a bounded collection
window, after which prompts flow normally again.

## Accepted residual risks

1. **A forgotten marker on a real question.** The question lands silently in the
   queue instead of being answered, and subsequent notes may build on an
   unverified assumption. Mitigation (not elimination): when a note ends in a
   question mark, the acknowledgement appends a hint that it was stored as a
   note and would be answered if re-sent with the marker. This is a hint, not a
   classification — the hook never decides what is a question.
2. **Sibling hooks run on a blocked prompt.** Hooks in one event group execute
   in parallel with no ordering guarantee and are not short-circuited by a
   sibling's block. State-writing UserPromptSubmit hooks therefore burn one-shot
   state on a prompt that produces no turn. Fixed by having each affected hook
   check the mode file itself; tracked as its own implementation step.
3. **Token-freedom is not contractually guaranteed.** The docs state only that a
   blocked prompt never reaches the model. Zero billing follows logically but is
   nowhere promised by Anthropic. Verify experimentally against the usage
   dashboard before relying on it.
4. **Context growth at execution time.** A ten-item master plan executed in one
   session maximises context growth and compaction loss; ten fresh sessions
   would each carry only their own. Where items are independent, prefer routing
   them through `/run-backlog`'s per-issue cycle rather than one long run.

## Naming

`/claude-batch`. The `claude-*` prefix in this repo marks skills that govern
*how Claude works* (`claude-learn`, `claude-lint`, `claude-extend-skill`) rather
than what happens to the project. A collection mode belongs there. `queue` was
rejected: `run-backlog` already uses it for its work queue, and reusing the word
for something else is a real comprehension cost.

## Files

| Path | Role |
|---|---|
| `hooks/lib/batch-state.js` | Mode file, marker config, classification, note I/O |
| `hooks/user-prompt-submit/prompt.batch.collect.js` | The collecting hook |
| `scripts/batch-watchdog.js` | Inactivity watchdog + toast |
| `skills/claude-batch/SKILL.md` | Activation, marker setup, merge and routing |
| `.claude/batch.md` | The notes (git-excluded, per project) |
| `~/.claude/claude-batch.json` | Marker + defaults (user-global) |

## 0.3.0 — hardening after the first real collection run

Five defects, all with the same visible symptom: notes went in and did not come
out.

1. **The marker lost to the attachment rule.** `classify()` checked
   `hasAttachment` before `startsWithMarker`, so `>> so wie hier [Image #1]` —
   the natural way to fire a merge while pointing at something — was demoted to
   a plain turn. No notes were injected, and the model correctly reported an
   empty batch while ten notes sat in the file. The two rules exist for opposite
   reasons: attachments pass through so a *blocked* prompt can never erase an
   image, and an execute prompt is never blocked. The marker now wins.
2. **Attachment prompts left no trace.** While collecting, a prompt carrying an
   image passed through untouched: the model acted on it immediately (the one
   thing the mode exists to prevent) and the merge never learned it happened.
   It still cannot be collected — blocking erases the image — so the hook now
   injects a guard telling the turn to file it as a note with a written
   `[Anhang]` description and `[Anhang-Datei]` paths. The turn is the only place
   the attachment is ever visible, so it is the only place that can preserve it.
3. **CRLF emptied the queue.** `readNotes` matched `-->\n`. The file header
   invites manual editing and every Windows editor rewrites it CRLF on save, at
   which point the whole queue parsed as zero notes with no error anywhere.
   Line endings are normalised before parsing.
4. **An unreadable queue was reported as an empty one.** The execute path exited
   silently on zero notes, which is indistinguishable from "no notes were ever
   taken". It now injects a notice naming the file, whether it exists and its
   size, and — when the file has content the parser could not split — forbids
   the denial and requires a raw read instead.
5. **Long queues lost their tail.** Over `INLINE_LIMIT` the merge context
   dropped every note for a bare file pointer. It now always carries a numbered
   index of all notes plus a mandatory full read, and says explicitly when the
   index itself had to be truncated.

Two behavioural additions follow from the same principle — the notes outlive the
mode that collected them:

- The marker fires the merge even when collection already ended (expiry, note
  cap, manual off). Otherwise the failsafes silently strand the queue.
- The merge context requires a coverage list: one line per note, `#1` … `#N`,
  each with a disposition. A note without a line is a lost requirement, not a
  shorter plan.
