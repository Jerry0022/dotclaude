# do-batch Merge — sync, images, archive, retire, gate, compaction

Execution detail for Step 4 of `SKILL.md`. The **decisions** stay in the skill
body — the coverage list, the bundle plan, the do-run / auto-concept decision
rule, the hand-off body; this file only answers "I am in that step, now what
exactly?". Step numbers refer to `SKILL.md`.

## Sync main (Step 4.0)

- Marker path: the hook already ran `scripts/git-sync.js` synchronously and
  injected the result as "SCHRITT 0". Read it first. A `⚠` / `✗` line is a
  conflict or failure — resolve it (merge-safety.md: never `--ours`/`--theirs`)
  before Step 4.1. "Der Sync konnte im Hook nicht laufen" means: run it yourself
  now.
- `/do-batch go` (also `los`, `merge`) runs through the same hook and gets the
  same "SCHRITT 0". Only without an injected merge context: run it yourself,
  synchronously, before anything else, and report the line:

  ```bash
  node "{PLUGIN_ROOT}/scripts/git-sync.js" --explain
  ```

  It merges the parent chain (`origin/main` → … → this branch, sub-branches
  included); it never rebases and never touches main itself. `--explain` makes
  every no-merge exit speak: `=` = nothing to merge (already in, on main, no
  remote) — say so in one clause.

**`– skipped:` is not "up to date".** The sync steps aside on uncommitted
changes that overlap the incoming merge, a detached HEAD, an unfinished
merge/rebase, or a running `/do-ship` — the branch may still be behind main.
Fix the named cause (commit the WIP, check out the branch, finish the
operation), re-run the command, and only then read the notes.

## Bundle plan (Step 4.4)

The plan must carry:

1. **Every concrete detail of every note.** Thresholds, examples, edge cases,
   timings, the user's wording where it is precise. A coverage line is not
   enough: "85 von 85 erst wenn das Item auf einem FREIEN Platz gelandet ist,
   dann ~1 s Delay, in dieser 1 s kein Abwerfen" goes into the plan as
   written, never as "Zähler-Timing anpassen". A detail missing from the plan
   is lost, because the receiving skill never sees the notes. That includes
   every `[Anhang-Datei] <path>` line: it goes into the bundle of its note
   verbatim, and `auto-agents` puts it into that agent's prompt with the order
   to Read it first (`agent-orchestration.md` § Agent Prompt Template item 11).
2. **One bundle per area, not per note.** Cut bundles along coherent areas
   of the product — one screen or flow, one subsystem, one data path — and
   put every note that touches that area into its bundle, so one agent
   explores the area once instead of several agents exploring it in
   parallel. Bundles own separate files and can run in parallel.
   Two bundles never own the same file; notes on a file that cannot be
   split share its bundle. Sizing, as a recommendation: a typical batch of 5–15
   notes lands at **2–6 bundles**. One bundle only when everything really
   touches one area; split an area once it carries more than ~6 notes or
   ~15 files, along a seam inside it (sub-screen, layer). Never one bundle
   per note, never a bundle for a single trivial note that an area bundle
   next to it can absorb. Name the area in the bundle name.
3. **Named interfaces and order.** Where bundles meet, name the contract, e.g.
   "engine emits a spawn event at turn end, UI animates it". Where one bundle
   needs another first, say so ("B2 after B1"). No dependency means the
   bundles run in parallel.
4. **Verification per bundle.** How each bundle is shown to work: the test,
   the check, the screen.
5. **Findings per bundle — hand the 4.3 analysis on.** What the feasibility
   check already established for this bundle: the files and lines involved,
   the existing function or component to change, the approach chosen, the
   traps seen (a shared helper, a test that pins the behaviour). The agent
   that builds the bundle starts with an empty context; without this line it
   searches the same code again, and in measured batches more than half of
   an implementing agent's calls were reads and searches. Facts only, with
   `file:line` — no guesses dressed as findings. A bundle the check did not
   look at says so (`Befunde: —`).

## Late image matching (Step 4.1)

The injected merge context already carries `[Anhang-Datei]` lines the
hook matched late: every image of this session that no note took goes to the
note nearest to it in time (up to 60 s; an image nearer to the marker prompt
stays with that prompt). A note that has an `[Anhang]` description but no
existing image file gets its image from the session transcript, matched by the
note TEXT (a prompt sent while a turn ran is queued, and the harness never
saves its image to the images folder). The hook appends these lines to
`batch.md` too, so the archived collection names them. A line ending
in "per Zeitstempel zugeordnet, N s Abstand — prüfen …" is a guess: open the
image and check it fits the note before relying on it.
Where a note refers to an image ("siehe Bild", "Screenshot") and neither
path nor description exists, say so in its coverage line instead of guessing.

## Archive (Step 4.7)

Image copies in
`.claude/batch-assets/` stay where they are — their names carry the note's
timestamp, so the archived notes still point at them. `archiveNotes` removes
copies older than 30 days that no note in `batch.md` or any archived
`batch-*.md` still names — an archive keeps its images.

## Retire (Step 4.8, Step 5, expiry)

Stop the watchdog so it does not linger for its next poll:

```bash
node "{PLUGIN_ROOT}/scripts/batch-watchdog.js" stop .
```

Then restore the session title: `mcp__ccd_session_mgmt__get_session` `self`;
if the `title` starts with `📥 Batch – `, call
`mcp__ccd_session_mgmt__set_session_title` `self` with that prefix removed. A
title without the prefix is left alone — the user renamed it meanwhile, and
that name wins. Desktop app only (deferred is not unavailable — load both tools via `ToolSearch` first, `deep-knowledge/mcp-deferred-tools.md`); skip silently elsewhere. The injected merge
context repeats this instruction because the hook path never loads this skill.

## Hand-off gate (Step 4.9)

When the merge fires,
`prompt.batch.collect.js` writes `.claude/batch-handoff.json`
(`{ firedAt, sessionId }`, runtime-ignored). While it exists and is younger
than 6 h, a PreToolUse hook refuses Edit / Write / NotebookEdit on gated
paths and `git commit` with the same message this step's decision rule
already gives: a ready plan goes to `Skill("devops:do-run", "--from=do-batch
…")`, a plan with open decisions to `Skill("devops:auto-concept",
"--from=do-batch …")` — never implemented directly here. Reading, exploring
and planning stay allowed; the marker is cleared by the PostToolUse `do-run`
or `auto-concept` call itself, so a normal hand-off never sees the gate.

## Local compaction (optional)

When the `local-llm` plugin is installed AND AnythingLLM answers, the notes may
be de-duplicated and reformatted locally at zero API cost.

**Strictly formatting only.** No interpretation, no contradiction detection, no
summarising of intent — `plugins/local-llm/deep-knowledge/delegation-rules.md`
classifies ambiguous user requests as RED (never delegate) and caps practical
context at ~8K tokens. A wrong compaction is worse than none: the plan silently
loses a requirement and the original is no longer in the UI to check against.

The dependency is soft. Resolve the plugin path and skip silently if absent —
`devops` and `local-llm` are independently installable and must stay that way.
