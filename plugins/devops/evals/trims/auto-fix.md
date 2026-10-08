# Skill trim record — `auto-fix`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-fix` (`plugins/devops/skills/auto-fix/`) |
| Files | `SKILL.md` |
| Issue | #651 (umbrella #644) |
| Words before (A) | 1120 (`wc -w` at `origin/main` e728fbbb) |
| Words after (B) | 826 (−26 %) as tested; **reverted** — shipped text stays 1120 |
| Variant A | `origin/main` (sha `e728fbbb`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/651-trim-small-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A/ab-*`, `<scratchpad>/results-B/ab-*` (not committed) |

## Removed instructions

Tested and **reverted** (see Verdict) — none of these cuts ships.

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | Step 0 Glob/"Do NOT call Read" preamble | stacked emphasis; condensed | not covered |
| 2 | Codex line "**MUST** be called via … NEVER via the `/codex:rescue` Agent tool" | CAPS stacking; rule kept in plain wording ("only through codex-safe.sh, never through /codex:rescue") | not covered (no Codex in the case) |
| 3 | Step 1 "Do NOT ask multiple questions — get the symptom, then investigate." | duplicate of "ask ONE focused question" | not covered (case has a clear symptom) |
| 4 | Steps 2–4 as three steps (recent changes / discover logs with a 3-item list / Grep the error string) | hand-holding the model does by default; merged into one "Investigate" step keeping the git commands and log globs | `off-by-one-root-cause::root-cause-before-edit` 2/2 → 1/2 |
| 5 | Step 5 question list ("What assumption is violated? What changed …? data, logic or configuration issue?") | model does this unprompted; kept the one-sentence invariant rule | `off-by-one-root-cause::root-cause-before-edit` 2/2 → 1/2 |
| 6 | Codex exit-code list in the decision table (rc=124/75/126/127) | duplicate of codex-integration.md "Hard Timeout", which Step 0 makes the model read; pointer kept | not covered |
| 7 | Pre-mortem bullet list (callers / papering over / root cause reappearing) | duplicate of pre-mortem.md; kept the focus question and two concerns in one sentence | `off-by-one-root-cause::loop-fixed` 2/2 → 2/2 |
| 8 | Verify numbered list | condensed to one sentence | not covered |
| 9 | Rules "Root-cause first", "Report the exact file:line", "Implementation above the Inline tier runs through auto-agents" | duplicates of Steps 3, 6 and 5 | `off-by-one-root-cause::reports-file-line` 0/2 → 2/2 |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Decision table (trivial / low / medium risk / unclear / architectural) | policy the model cannot infer; drives fix-vs-propose |
| 2 | `--from=auto-fix --mode=interactive` / `--mode=background` and the Inline skip | auto-agents call contract |
| 3 | Completion-card variant table + "Output the returned markdown VERBATIM as the LAST thing" | stop-hook completion-card contract |
| 4 | Codex only via codex-safe.sh, never /codex:rescue | known regression (hung Agent tool); safety |
| 5 | Report fields incl. "Sicher behoben" vs. "Hypothese" | observable output contract |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-fix/off-by-one-root-cause` + `skills/auto-fix/explicit-off-by-one` (prompt names the skill) | `fix-skill`, `loop-fixed`, `root-cause-before-edit`, `reports-file-line` (graders.js) | the skill's core contract: root cause named before the first edit, fix applied, file:line in the report |

Commands (A before the trim, B after; same cases, separate plugin dirs so
the B edits could not leak into the A runs):
`node plugins/devops/evals/ab-run.js --case 'skills/auto-fix/off-by-one-root-cause' --b <origin/main worktree>/plugins/devops --runs 2`
and the same with `--b <trimmed snapshot>/plugins/devops`.

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/auto-fix/explicit-off-by-one` | fix-skill | 2/2 | 2/2 |
| `skills/auto-fix/explicit-off-by-one` | loop-fixed | 2/2 | 2/2 |
| `skills/auto-fix/explicit-off-by-one` | root-cause-before-edit | 2/2 | 2/2 |
| `skills/auto-fix/explicit-off-by-one` | reports-file-line | 2/2 | 1/2 |
| `skills/auto-fix/off-by-one-root-cause` | fix-skill | 0/2 | 2/2 |
| `skills/auto-fix/off-by-one-root-cause` | loop-fixed | 2/2 | 2/2 |
| `skills/auto-fix/off-by-one-root-cause` | root-cause-before-edit | 2/2 | 1/2 |
| `skills/auto-fix/off-by-one-root-cause` | reports-file-line | 0/2 | 2/2 |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 12/16 | 3,109,299 | $5.33 | 241 s | 0 |
| B | 14/16 | 3,805,841 | $5.16 | 457 s | 0 |

## Verdict

`revert` — with the skill loaded, B is worse on two deterministic graders.
Explicit case: `root-cause-before-edit` 2/2 → 2/2 but `reports-file-line`
2/2 → 1/2 (the run fixed and rendered the card without the Step 8 report).
A partial restore (B2: "Always report:" plus the Rules lines "Root-cause
first", "Report the exact file:line") did not recover it: explicit case
`root-cause-before-edit` 1/2, `reports-file-line` 1/2 (the failing run went
Read → Edit with no text in between). The cut most likely responsible is the
merge of Steps 2–5 into one "Investigate" step, which dropped the separate
root-cause step and its questions. The natural-prompt case cannot decide it:
A never loaded the skill there (`fix-skill` 0/2), B did in the first run
(2/2) and not in the B2 rerun (0/2) — routing noise, the description was not
changed. `SKILL.md` therefore ships unchanged (1120 words); the rows above
are the tested-and-rejected cuts. A follow-up could retry the low-risk cuts
alone (Step 0 preamble, Codex exit-code list, pre-mortem bullets) with the
original Steps 2–5 kept.

