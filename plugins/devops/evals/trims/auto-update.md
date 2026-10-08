# Skill trim record — `auto-update`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-update` (`plugins/devops/skills/auto-update/`) |
| Files | `SKILL.md` |
| Issue | #651 (umbrella #644) |
| Words before (A) | 931 (`wc -w` at `origin/main` e728fbbb) |
| Words after (B) | 635 (−32 %) |
| Variant A | `origin/main` (sha `e728fbbb`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/651-trim-small-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A/ab-*`, `<scratchpad>/results-B/ab-*` (not committed) |

## Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | § Architecture numbered list + "**No duplicated logic.** The hook is the single source of truth …" | rationale; condensed to two sentences in the intro | not covered |
| 2 | "Execute the hook script directly:" | hand-holding | `forced-hook-run::hook-forced` 2/2 → 2/2 |
| 3 | Long `--force` rationale paragraph | history; kept a one-line why (6 h cooldown #324 + deferred repair) so `--force` is not dropped | `forced-hook-run::hook-forced` 2/2 → 2/2 |
| 4 | Hook internals bullet list (ring-model checkout, cache rebuild details, registry, verification, Quiet style refresh mechanics) | describes the hook, not what the model does; one sentence kept | not covered |
| 5 | Step 3 sub-headings 3a–3c with a table and bash block | condensed to a numbered list with the same paths and checks | not covered (update denied in the case) |
| 6 | Known Issues "Cache deleted on restart … Step 3 catches this" and "MCP stale after upgrade" paragraphs | merged: the MCP-stale paragraph became one note under the report (when the warning applies); the cache item merged into the Desktop item | not covered |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Constants block incl. `{PLUGIN_ROOT}` literal-path note | the Bash tool has no $CLAUDE_PLUGIN_ROOT; prevents a known failure |
| 2 | `--channel` re-pin and drift report | user-facing feature; sidecar format |
| 3 | Report block verbatim incl. the pre.mcp.health warning | user-facing output; MCP block is hook-enforced |
| 4 | Quiet-style status derivation | maps hook output lines to the report |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-update/forced-hook-run` | `update-skill`, `hook-forced`, `state-before-hook`, `no-fabricated-success` (graders.js) | the skill's key action (hook with --force) and its ordering; the case denies node/pull/checkout so the real install is never touched |

Commands (A before the trim, B after; same cases, separate plugin dirs so
the B edits could not leak into the A runs):
`node plugins/devops/evals/ab-run.js --case 'skills/auto-update/forced-hook-run' --b <origin/main worktree>/plugins/devops --runs 2`
and the same with `--b <trimmed snapshot>/plugins/devops`.

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/auto-update/forced-hook-run` | update-skill | 2/2 | 2/2 |
| `skills/auto-update/forced-hook-run` | hook-forced | 2/2 | 2/2 |
| `skills/auto-update/forced-hook-run` | state-before-hook | 2/2 | 2/2 |
| `skills/auto-update/forced-hook-run` | no-fabricated-success | 2/2 | 2/2 |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 8/8 | 1,167,540 | $2.02 | 441 s | 0 |
| B | 8/8 | 740,381 | $1.60 | 90 s | 0 |

## Verdict

`ship` — 8/8 → 8/8, no errors: B still captures state first, runs the hook with `--force`, and does not fabricate a success report after the denial. The removed text described the hook's internals and history, not what the skill does.

