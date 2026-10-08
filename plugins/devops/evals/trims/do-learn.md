# Skill trim record — `do-learn`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:do-learn` (`plugins/devops/skills/do-learn/`) |
| Files | `SKILL.md` + `deep-knowledge/{routing-details,feedback-cleanup}.md` |
| Issue | #651 (umbrella #644) |
| Words before (A) | 4439 (`wc -w` at `origin/main` e728fbbb) |
| Words after (B) | 4051 (−9 %) |
| Variant A | `origin/main` (sha `e728fbbb`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/651-trim-small-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A/ab-*`, `<scratchpad>/results-B/ab-*` (not committed) |

## Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | Step 0 "The directory name is the skill's own `name` … Any other spelling silently loads nothing." | convention restated (CONVENTIONS § Extension Mechanism, contract-tested) | not covered |
| 2 | "1 in 4 invocations", "(the case in every run so far)", "Across the first 23 runs …", "Every one of the last six branch-A runs …", "the state three earlier runs produced" | run statistics/history that do not change behaviour | not covered |
| 3 | "The learning MUST end up …", "without the reason the rule becomes superstition …" | CAPS + rationale; rule kept | `project-rule-branch-c::rule-in-project` 2/2 → 2/2 |
| 4 | Tie-breaker 3 tail about `pre.plugin.scope` standing down in the source repo | rationale; the rule (B writes nothing locally, never into ~/.claude/plugins/**) moved into Step 3's B/D sentence | `project-rule-branch-c::no-issue` 2/2 → 2/2 |
| 5 | routing-details intro "so the decision never has to compete with the procedure for attention" | rationale | not covered |
| 6 | routing-details A: "Do not ship from inside this skill …" | duplicate of SKILL.md Step 3 (ship only when asked) | not covered |
| 7 | routing-details A/B/D: repeated explanations of the `**User value:**` gate and "persisted nowhere" | said three times; one mention per branch kept | not covered |
| 8 | routing-details C-override "**Default is branch B … If unsure, it stays B.**" / "Route to B." | duplicate of SKILL.md tie-breaker 3; now a pointer | not covered |
| 9 | feedback-cleanup.md intro rationale | rationale | not covered |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Gate + Q1–Q3 matrix, special case, tie-breakers, worked examples | the judgment content of the skill; trimming it risks mis-routing |
| 2 | Q2 plugin-source detection branch for branch | mirrors `isPluginSourceRepo` in hooks/lib/plugin-scope.js |
| 3 | "Capture, don't audit" with a one-line incident (17 min on i18n keys) | one-line why for a known regression |
| 4 | Step 4 index-only + per-match confirmation; Rules (never write feedback memory, ask before global, never overwrite an opposite rule) | safety |
| 5 | Q3 middle outcome (hint outside ~/IdeaProjects → ask) | safety property against filing a rule into the wrong project |
| 6 | Completion-card variant table + VERBATIM LAST | stop-hook card contract |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/do-learn/project-rule-branch-c` | `learn-skill`, `rule-in-project`, `no-issue`, `no-memory-write` (graders.js) | routing: a project-only rule in a consumer project must land in the project's own instructions (branch C), no issue, no memory write |

Commands (A before the trim, B after; same cases, separate plugin dirs so
the B edits could not leak into the A runs):
`node plugins/devops/evals/ab-run.js --case 'skills/do-learn/project-rule-branch-c' --b <origin/main worktree>/plugins/devops --runs 2`
and the same with `--b <trimmed snapshot>/plugins/devops`.

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/do-learn/project-rule-branch-c` | learn-skill | 2/2 | 2/2 |
| `skills/do-learn/project-rule-branch-c` | rule-in-project | 2/2 | 2/2 |
| `skills/do-learn/project-rule-branch-c` | no-issue | 2/2 | 2/2 |
| `skills/do-learn/project-rule-branch-c` | no-memory-write | 2/2 | 2/2 |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 8/8 | 1,472,380 | $2.30 | 190 s | 0 |
| B | 8/8 | 1,417,536 | $3.16 | 120 s | 0 |

## Verdict

`ship` — 8/8 → 8/8, no errors: the project rule still lands in the project's own `.claude/`, no issue, no memory write. The cuts were run statistics, history and rules said two or three times; the routing matrix and its examples are untouched. Branches A/B/D/E have no case — those cuts are pure duplication removal (one copy of each rule stays).

