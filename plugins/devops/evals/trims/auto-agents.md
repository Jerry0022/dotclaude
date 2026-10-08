# Skill trim record — `auto-agents`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-agents` (`plugins/devops/skills/auto-agents/SKILL.md`) |
| Issue | #652 (umbrella #644) |
| Words before (A) | 4207 (`wc -w` at `origin/main` 499cdd2f) |
| Words after (B) | 3896 (−7 %) as trimmed; **4207 (±0 %) shipped — all cuts reverted** |
| Variant A | `origin/main` (sha `499cdd2f`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/652-trim-medium-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A2/ab-*`, `<scratchpad>/results-B-agents{,2,3}/ab-*` (not committed) |

## Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | Step 0 "Use **Glob** to verify each path exists … Do NOT call Read on files that may not exist" | hand-holding | not covered |
| 2 | 2.3 "Prevents permission prompts from interrupting wave execution — especially painful with parallel agents" | rationale; one clause kept | not covered (audit runs only above Inline) |
| 3 | 2.3 "(defense in depth)" paragraph on `--apply` re-validation; "the script writes directly via Node `fs.writeFileSync`"; "The audit is read-only on no findings …" | script internals / duplicate of "Empty → skip silently" | not covered |
| 4 | Step 5 "What the template does" bullets: header, newest-model note, rows, Σ tally | describe what the script/hook renders — the model relays, never types them; the `[W<n>]` prefix instruction is kept | `inline-one-file::no-role-agent` |
| 5 | Step 6 "Treat the user as a collaborator on the plan, not just a recipient of results." | filler | not covered |
| 6 | Rules: "Agent cards, never hand-drawn tables", "Never run agents silently", "Never ship automatically", "Follow handoff protocol" | duplicates of Step 5 (card relay), Step 7 (never ships) and agent-collaboration.md | `inline-one-file::*` |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 0 | Everything — see Verdict | B lost the `▶ Inline` line (2/2 → 0/4) |
| 1 | Step 1 argument table, budget-class paragraph, 2.1 do-run exception, Step 3 budget line, Step 5 card table / model / effort, Step 7 result block, burn conveyor | pinned by `skills/auto-agents/skill-text.test.js`, `do-run/{burn-wiring,do-run-rethink,run-contract-text}.test.js`, `scripts/agent-checkpoints.test.js`; run-contract `auto-agents` obligation |
| 2 | `▶ Inline · <reason: domains, ~files>` line | pinned, and the case grades it |
| 3 | Spawn-card relay ("only the last one … verbatim", "A prose summary … never replaces it") | `pre.agent.relay` hook contract |
| 4 | Permission audit "Never auto-apply — every rule needs user confirmation" | safety (log forgery) |
| 5 | Rules "Invokes no skill", "Under `--burn` the gate decides every spawn" | layer contract / burn gate |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-agents/inline-one-file` | `agents-skill`, `inline-line`, `no-role-agent`, `typo-fixed` (graders.js) | the cheap tier decision: a do-run hand-over of a one-file typo must print the Inline line and spawn nothing |

The first baseline used "Run this through the devops:auto-agents skill: …";
the model skipped the skill both times (Step 2.1 lets a caller skip it for
Inline). The case now hands over `--from=do-run`, the path where the skill
is mandatory; both variants ran the revised prompt.

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/auto-agents/inline-one-file` | agents-skill | 2/2 | 2/2 |
| `skills/auto-agents/inline-one-file` | inline-line | 2/2 | 0/2 |
| `skills/auto-agents/inline-one-file` | no-role-agent | 2/2 | 2/2 |
| `skills/auto-agents/inline-one-file` | typo-fixed | 2/2 | 2/2 |

Reruns: B unchanged (`B-agents2`) → `inline-line` 0/2 again (0/4 in total);
B with removed rows 4 and 6 restored (`B-agents3`) → `inline-line` 1/2, all
other graders 2/2.

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 8/8 | 1,895,875 | $2.89 | 174 s | 0 |
| B | 6/8 | 2,481,624 | $3.48 | 290 s | 0 |

## Verdict

`revert` — every cut is reverted; `SKILL.md` ships unchanged. The full trim
dropped the `▶ Inline · <reason>` line in 4/4 B runs against 2/2 in A: B
named the tier in prose and in the result block (`tier: inline`), but not
in the pinned one-line form. Restoring the Step 5 "What the template does"
bullets and the Rules duplicates (rows 4, 6) brought it back to 1/2 —
inconclusive at n=2, and rows 1–3, 5 are not pure duplicates, so nothing
stays. Lesson for later trims: the Rules block and the card description
looked redundant but carried weight for the one-line tier output; a future
attempt should cut one block at a time with ≥ 4 runs per variant.
