# Skill trim record — `<skill>`

Copy this file per trimmed skill (e.g. into the trim PR description or
`docs/trims/<skill>.md`) and fill every section. Evidence comes from
`ab-run.js` (see `README.md` → "A/B runner"): variant A = the skill's
current text, variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:<skill>` (`plugins/devops/skills/<skill>/SKILL.md`) |
| Issue | #<n> |
| Words before (A) | <n> (`wc -w SKILL.md` at `<ref>`) |
| Words after (B) | <n> (−<n> %) |
| Variant A | `--a-ref <ref>` (sha `<sha>`) |
| Variant B | working tree of `<branch>` (sha `<sha>`) |
| Runs per variant | <n> |
| Results dir | `evals/results/ab-<timestamp>/` (not committed) |

## Removed instructions

One row per removed or rewritten instruction. "A/B result" names the
grader(s) that cover it with the pass rate A → B, or `not covered` with a
reason why no case can observe it.

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | "…" | duplicate of / model does this unprompted / dead branch / … | `case::grader` 3/3 → 3/3 |

## Kept instructions that looked prescriptive

Instructions that read like removable boilerplate but stay, and why.

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | "…" | without it B failed `case::grader` (3/3 → 1/3) / guards a hook contract / … |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `triggers/<case>` | `<grader>` (md) / `<grader>` (graders.js) | proves the skill still triggers from a natural prompt |

Command: `node plugins/devops/evals/ab-run.js --case '<glob>' --a-ref <ref> --runs <n>`

## Summary

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | | | | | |
| B | | | | | |

## Verdict

`ship` / `ship with kept rows above` / `revert` — one sentence on why, citing
the rows that decide it. Undecided grades (`n/a`) and error runs are not
evidence; rerun them before deciding.
