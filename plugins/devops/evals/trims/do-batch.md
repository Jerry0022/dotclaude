# Skill trim record — `do-batch`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:do-batch` (`plugins/devops/skills/do-batch/`) |
| Files | `SKILL.md` + `deep-knowledge/{activation,merge}.md` |
| Issue | #652 (umbrella #644) |
| Words before (A) | 6488 (`wc -w` at `origin/main` 499cdd2f) |
| Words after (B) | 6034 (−7 %) |
| Variant A | `origin/main` (sha `499cdd2f`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/652-trim-medium-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A-auto-agents_do-batch/ab-*`, `<scratchpad>/results-B-batch/ab-*` (not committed) |

## Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | "The content fallback is not an error path … lost without a trace (#306)." | history; the fallback row itself stays | not covered |
| 2 | Marker pre-check "A dead marker that is re-reported on every `status` but never repaired is the failure this rule ends." | rationale | not covered |
| 3 | "This is the one prompt collection can never catch" explanation (mode ends up active and empty …) and "A prompt full of tasks … is the reason the question exists" | rationale; the three bullets stay | `activate-and-seed::note-verbatim` |
| 4 | 2.1 "the marker is typed dozens of times per session" | rationale; "colon-free" kept with a one-clause why | not covered |
| 5 | 2.2b green-dot scenario | rationale; one line kept | not covered (session tools denied) |
| 6 | 2.4 "Guessing boundaries only risks losing a requirement" and the restated "a note is the user's own words" | duplicate / rationale | `activate-and-seed::note-verbatim` |
| 7 | Step 4 "the `go` route is no longer a separate, weaker path", "In both cases the procedure is identical" | history / duplicate | not covered |
| 8 | "Firing ends collection" and 4.0 / 4.2 / 4.3 / 4.5 / 4.6 / 4.7 / 4.8 rationale sentences ("the defect this whole mode exists to prevent", "the step that pays for the whole mode", "a second gate … would ask the same thing twice", …) | rationale; every step and rule stays | not covered (merge path needs a hand-off) |
| 9 | Rules "The activating prompt is never executed", "Never resolve a contradiction silently", "The plan keeps every detail …", "A plan built on a stale branch is not a plan." | duplicates of Step 1, 4.5, 4.4, 4.0 | `activate-and-seed::note-verbatim` |
| 10 | activation.md "it is what the user wants their marker to be … Never read it as 'the question wasn't answered'" | duplicate of SKILL.md 2.1 | not covered |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Routing table, "Activation ends ON", marker pre-check on every route, `>>`/`>go`/`>start` options, 2.2b prefix, 2.5 card-only confirmation, 4.0 sync, 4.4 bundle plan, 4.6 decision rule, 4.9 hand-off block, title-prefix rule | pinned by `skills/do-batch/skill-text.test.js` and `do-run/run-contract-text.test.js` |
| 2 | "Hook-enforced, not just written down" (`batch-handoff.json`) | hand-off gate contract |
| 3 | 2.6 attachment filing, Git-exclude guard | prevents lost screenshots / writes at the filesystem root |
| 4 | Rules on the red hook panel and "never report an empty queue without looking" | prevent known misdiagnoses |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/do-batch/activate-and-seed` | `batch-skill`, `mode-file`, `note-verbatim`, `git-exclude`, `card-with-cwd` (graders.js) | activation with seed content: the mode file, the verbatim note, the exclude entry and the card with `cwd` are all observable (watchdog and session-title tools denied) |

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/do-batch/activate-and-seed` | batch-skill | 2/2 | 2/2 |
| `skills/do-batch/activate-and-seed` | mode-file | 2/2 | 2/2 |
| `skills/do-batch/activate-and-seed` | note-verbatim | 2/2 | 2/2 |
| `skills/do-batch/activate-and-seed` | git-exclude | 2/2 | 2/2 |
| `skills/do-batch/activate-and-seed` | card-with-cwd | 2/2 | 2/2 |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 10/10 | 1,674,734 | $2.56 | 146 s | 0 |
| B | 10/10 | 2,084,942 | $2.85 | 227 s | 0 |

## Verdict

`ship` — 10/10 → 10/10. The merge path (Step 4) has no case: it needs a
collected queue and ends in a hand-off to do-run / auto-concept; its cuts
are rationale sentences only, every step, table and pinned phrase stays
(`skill-text.test.js` green).
