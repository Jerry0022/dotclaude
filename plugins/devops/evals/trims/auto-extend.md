# Skill trim record — `auto-extend`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-extend` (`plugins/devops/skills/auto-extend/`) |
| Files | `SKILL.md` |
| Issue | #651 (umbrella #644) |
| Words before (A) | 765 (`wc -w` at `origin/main` e728fbbb) |
| Words after (B) | 565 (−26 %) |
| Variant A | `origin/main` (sha `e728fbbb`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/651-trim-small-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A/ab-*`, `<scratchpad>/results-B/ab-*` (not committed) |

## Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | "Use **Glob** to verify each path exists before reading. Do NOT call Read on files that may not exist — skip missing files silently (no output)." | CAPS/stacked emphasis; condensed to "Glob each path before reading; skip missing files silently" (same rule, CONVENTIONS § Step 0) | not covered (extension load is identical in A and B runs: no extension exists) |
| 2 | Step 1 "Detect project root … Store as `{project}`" as its own step | hand-holding; folded into one sentence under Step 0 | `scaffold-ship-extension::reference-md-scaffolded` 2/2 → 2/2 |
| 3 | Step 2 numbered procedure "List all available plugin skills … Present the list via AskUserQuestion" with a quoted German question and option list | model builds the question itself; kept as one sentence | not covered (case passes the skill name) |
| 4 | Step 3 quoted German report template and 4-option menu for an existing extension | scripted wording; replaced by the three outcomes (edit / add missing / abort) | not covered (scaffold has no extension) |
| 5 | 4.1 "Read the plugin skill for context … This informs the scaffold content." as a sub-step | folded into one sentence | `scaffold-ship-extension::scaffold-minimal` 2/2 → 2/2 |
| 6 | "The scaffold MUST be minimal … Do NOT pre-fill steps unless …" | CAPS; rule kept verbatim in plain wording | `scaffold-ship-extension::scaffold-minimal` 2/2 → 2/2 |
| 7 | Step 5 quoted German confirmation block | scripted wording; replaced by what the confirmation must name | not covered (wording only) |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Pre-PR-2 / PR-3 RETIRED name translation paragraph | domain knowledge the model cannot infer (table in hooks/lib/skill-names.js); used by Step 1 |
| 2 | Both scaffold templates verbatim | the exact files users get; `do-learn` C-override reuses the SKILL.md template |
| 3 | "`.claude/skills/` must not be gitignored — warn, do not edit `.gitignore`" | safety: no silent edit of a tracked config file |
| 4 | Step 0 list items incl. the `claude-extend-skill` fallback | `skill-contracts.test.js` pins the Step 0 dirs to the skill name / pre-PR-2 names |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-extend/scaffold-ship-extension` | `extend-skill`, `skill-md-scaffolded`, `reference-md-scaffolded`, `scaffold-minimal` (graders.js) | the skill's observable output: both extension files under the new skill name, SKILL.md scaffold minimal |

Commands (A before the trim, B after; same cases, separate plugin dirs so
the B edits could not leak into the A runs):
`node plugins/devops/evals/ab-run.js --case 'skills/auto-extend/scaffold-ship-extension' --b <origin/main worktree>/plugins/devops --runs 2`
and the same with `--b <trimmed snapshot>/plugins/devops`.

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/auto-extend/scaffold-ship-extension` | extend-skill | 2/2 | 2/2 |
| `skills/auto-extend/scaffold-ship-extension` | skill-md-scaffolded | 2/2 | 2/2 |
| `skills/auto-extend/scaffold-ship-extension` | reference-md-scaffolded | 2/2 | 2/2 |
| `skills/auto-extend/scaffold-ship-extension` | scaffold-minimal | 2/2 | 2/2 |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 8/8 | 1,414,661 | $2.17 | 245 s | 0 |
| B | 8/8 | 924,615 | $1.74 | 168 s | 0 |

## Verdict

`ship` — every grader passes in both variants (8/8 → 8/8, no errors); the removed text was scripted wording, CAPS emphasis and a step the model folds in anyway. B also used fewer tokens and less time, which at n=2 is a hint, not evidence.

