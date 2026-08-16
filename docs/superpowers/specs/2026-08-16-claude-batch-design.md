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
stores it user-globally in `~/.claude/claude-batch.json`. Default proposal: `!`
at the start of the line.

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
