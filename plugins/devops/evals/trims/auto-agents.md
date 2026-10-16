# Skill trim record — `auto-agents`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text. Two attempts: #652 (full trim, reverted) and
#687 (one cut per variant, below first).

## Attempt 2 — #687, one cut at a time

### Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-agents` (`plugins/devops/skills/auto-agents/SKILL.md`) |
| Issue | #687 (split out of #667, umbrella #644) |
| Words before (A) | 4207 (`wc -w` at `origin/main` b3df3b2a) |
| Words after | 4170 (−37, −0.9 %) — cuts 1 and 4 kept |
| Variant A | `origin/main` (sha `b3df3b2a`) via `--a-ref`, detached temp worktree |
| Variant B | one snapshot copy of `plugins/devops` per cut: `origin/main` + that single cut, nothing else |
| Runs per variant | 8 (two rounds of `--runs 4`; A ran in both rounds, alongside cut 1) |
| Results dir | `<scratchpad>/t687/res{,2}-c{1..4}/ab-*` (not committed) |

Step 5 (agent cards, the `▶ Inline` line) and the Rules block were left
untouched, following attempt 1's lesson.

### Cuts and verdicts

| # | Cut (removed text → replacement) | Words | Verdict |
|---|---|---|---|
| 1 | Step 0 "Use **Glob** to verify each path exists before reading. Do NOT call Read on files that may not exist — skip missing files silently (no output)." → "skip missing files silently." | −22 | **keep** |
| 2 | 2.3 "Prevents permission prompts from interrupting wave execution — especially painful with parallel agents." → "so no permission prompt stalls a wave." | −6 | **revert** (`agents-skill` 7/8 vs 8/8) |
| 3 | 2.3 "the script writes directly via Node `fs.writeFileSync`"; the "(defense in depth)" `--apply` re-validation paragraph; "The audit is read-only on no findings — never blocks the flow when there's nothing to fix." | −45 | **revert** (`inline-line` 4/8 vs 5/8, `agents-skill` 6/8 vs 8/8) |
| 4 | Step 6 "Treat the user as a collaborator on the plan, not just a recipient of results." | −15 | **keep** |

### Per-grader results (`skills/auto-agents/inline-one-file`, 8 runs each)

| Grader | A | Cut 1 | Cut 2 | Cut 3 | Cut 4 |
|---|---|---|---|---|---|
| agents-skill | 8/8 | 8/8 | 7/8 | 6/8 | 8/8 |
| inline-line | 5/8 | 5/8 | 6/8 | 4/8 | 8/8 |
| no-role-agent | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 |
| typo-fixed | 7/8 | 8/8 | 8/8 | 8/8 | 8/8 |

Per round (round 1 / round 2): A `inline-line` 3/4 / 2/4, `typo-fixed`
4/4 / 3/4; cut 1 `inline-line` 3/4 / 2/4; cut 2 `inline-line` 3/4 / 3/4,
`agents-skill` 4/4 / 3/4; cut 3 `inline-line` 2/4 / 2/4, `agents-skill`
3/4 / 3/4; cut 4 4/4 on every grader in both rounds.

A itself misses `inline-line` in 3 of 8 runs, so B is judged against A's
rate, not against a perfect score. The baseline is noisy at this n: cut 4's
8/8 is not evidence that the cut *helps*, only that it does not hurt.

Note on the `agents-skill` misses (cuts 2 and 3): in all three failing runs
the model never called the Skill tool. It edited the file directly and
skipped the skill, so the trimmed body was never loaded. The cut cannot have
caused that, since the frontmatter description is unchanged. The cuts are
reverted anyway: the rule is that a lost grader point reverts, and the
evidence can't tell this apart from a real regression.

### Summary

Tokens = input + output + cache read/creation, summed over the 8 runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 28/32 | 8,320,189 | $13.11 | 261 s | 0 |
| Cut 1 | 29/32 | 7,910,357 | $11.61 | 246 s | 0 |
| Cut 2 | 29/32 | 6,980,654 | $11.16 | 236 s | 0 |
| Cut 3 | 26/32 | 8,591,421 | $12.52 | 246 s | 0 |
| Cut 4 | 32/32 | 8,974,385 | $12.60 | 235 s | 0 |

### Verdict

`keep` cuts 1 and 4, `revert` cuts 2 and 3. Each cut was measured in
isolation. Cuts 1 and 4 have no A/B run in combination. They sit in disjoint
sections (Step 0 overrides, Step 6 interactive mode) and neither touches the
tier decision or the `▶ Inline` line. The text-pin suites
(`skills/auto-agents/skill-text.test.js`, `do-run/*`,
`scripts/agent-checkpoints.test.js`) pass with all four cuts applied together.

## Attempt 1 — #652, full trim (reverted)

### Skill

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

### Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | Step 0 "Use **Glob** to verify each path exists … Do NOT call Read on files that may not exist" | hand-holding | not covered |
| 2 | 2.3 "Prevents permission prompts from interrupting wave execution — especially painful with parallel agents" | rationale; one clause kept | not covered (audit runs only above Inline) |
| 3 | 2.3 "(defense in depth)" paragraph on `--apply` re-validation; "the script writes directly via Node `fs.writeFileSync`"; "The audit is read-only on no findings …" | script internals / duplicate of "Empty → skip silently" | not covered |
| 4 | Step 5 "What the template does" bullets: header, newest-model note, rows, Σ tally | describe what the script/hook renders — the model relays, never types them; the `[W<n>]` prefix instruction is kept | `inline-one-file::no-role-agent` |
| 5 | Step 6 "Treat the user as a collaborator on the plan, not just a recipient of results." | filler | not covered |
| 6 | Rules: "Agent cards, never hand-drawn tables", "Never run agents silently", "Never ship automatically", "Follow handoff protocol" | duplicates of Step 5 (card relay), Step 7 (never ships) and agent-collaboration.md | `inline-one-file::*` |

### Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 0 | Everything — see Verdict | B lost the `▶ Inline` line (2/2 → 0/4) |
| 1 | Step 1 argument table, budget-class paragraph, 2.1 do-run exception, Step 3 budget line, Step 5 card table / model / effort, Step 7 result block, burn conveyor | pinned by `skills/auto-agents/skill-text.test.js`, `do-run/{burn-wiring,do-run-rethink,run-contract-text}.test.js`, `scripts/agent-checkpoints.test.js`; run-contract `auto-agents` obligation |
| 2 | `▶ Inline · <reason: domains, ~files>` line | pinned, and the case grades it |
| 3 | Spawn-card relay ("only the last one … verbatim", "A prose summary … never replaces it") | `pre.agent.relay` hook contract |
| 4 | Permission audit "Never auto-apply — every rule needs user confirmation" | safety (log forgery) |
| 5 | Rules "Invokes no skill", "Under `--burn` the gate decides every spawn" | layer contract / burn gate |

### Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-agents/inline-one-file` | `agents-skill`, `inline-line`, `no-role-agent`, `typo-fixed` (graders.js) | the cheap tier decision: a do-run hand-over of a one-file typo must print the Inline line and spawn nothing |

The first baseline used "Run this through the devops:auto-agents skill: …";
the model skipped the skill both times (Step 2.1 lets a caller skip it for
Inline). The case now hands over `--from=do-run`, the path where the skill
is mandatory; both variants ran the revised prompt.

### Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/auto-agents/inline-one-file` | agents-skill | 2/2 | 2/2 |
| `skills/auto-agents/inline-one-file` | inline-line | 2/2 | 0/2 |
| `skills/auto-agents/inline-one-file` | no-role-agent | 2/2 | 2/2 |
| `skills/auto-agents/inline-one-file` | typo-fixed | 2/2 | 2/2 |

Reruns: B unchanged (`B-agents2`) → `inline-line` 0/2 again (0/4 in total);
B with removed rows 4 and 6 restored (`B-agents3`) → `inline-line` 1/2, all
other graders 2/2.

### Summary

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 8/8 | 1,895,875 | $2.89 | 174 s | 0 |
| B | 6/8 | 2,481,624 | $3.48 | 290 s | 0 |

### Verdict

`revert`: every cut was reverted and `SKILL.md` shipped unchanged. The full
trim dropped the `▶ Inline · <reason>` line in 4/4 B runs against 2/2 in A.
B named the tier in prose and in the result block (`tier: inline`), but not
in the pinned one-line form. Restoring the Step 5 "What the template does"
bullets and the Rules duplicates (rows 4, 6) brought it back to 1/2, which is
inconclusive at n=2. Rows 1–3 and 5 are not pure duplicates, so nothing
stayed. Attempt 2 shows that A's 2/2 was optimistic: over 8 runs A prints the
line in 5.
