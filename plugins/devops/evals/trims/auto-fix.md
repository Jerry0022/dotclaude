# Skill trim record — `auto-fix`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text. Two attempts, both reverted: the retry (#720)
first, the first attempt (#651) below it.

## Retry — #720 (low-risk cuts only)

### Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-fix` (`plugins/devops/skills/auto-fix/`) |
| Files | `SKILL.md` |
| Issue | #720 (umbrella #665, retry of #651) |
| Words before (A) | 1120 (`wc -w` at `origin/main` 8797cc5c) |
| Words after (B) | 1090 (−2.7 %) final candidate (cuts 2+3), 1031 (−8 %) all four cuts; **reverted** — shipped text stays 1120 |
| Variant A | `--a-ref origin/main` (8797cc5c; confirmation run b3df3b2a, same `auto-fix/SKILL.md`) |
| Variant B | cumulative snapshot copies of `plugins/devops`: B1 = cut 1, B2 = cuts 1–2, B3 = cuts 1–3, B4 = cuts 1–4 |
| Runs per variant | 4 per invocation; B1 and B4 ran twice (8 runs) |
| Results dir | `<scratchpad>/720/res-c{1..4}/ab-*`, `res-final/ab-*`, `res-final2/ab-*` (not committed) |

Steps 1–5, the decision table rows, the auto-agents contract, Step 8 and
the completion-card step are untouched. Every run's `init.plugins` shows a
single `devops@inline` from the variant dir — the installed
`devops@dotclaude` is disabled through `--settings`.

### Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result | Verdict |
|---|---|---|---|---|
| 1 | Step 0 "Check for optional overrides. Use **Glob** to verify … Do NOT call Read on files that may not exist …" → "Optional overrides — Glob first, skip missing files silently:" | stacked emphasis | B1 vs A (8 runs): explicit `reports-file-line` 6/8 → 5/8, natural `root-cause-before-edit` 8/8 → 7/8 (that run never loaded the skill), natural `reports-file-line` 6/8 → 8/8 | **revert** — loses grader points |
| 2 | Decision table: "rc=124 → continue without Codex findings, note "Codex timed out"; rc=75 → usage limit …; rc=126/127 → skip silently." → "Handle its exit codes per codex-integration.md "Hard Timeout" section." | duplicate of codex-integration.md's exit-code table, which Step 0 makes the model read; the "never /codex:rescue" rule stays | B2 vs A (4 runs): every grader equal or better — natural `reports-file-line` 3/4 → 4/4, all others 4/4 → 4/4; final confirmation with cut 3: see below | **revert** — final confirmation lost a point |
| 3 | Step 7 Verify list (1. error gone / 2. related functionality / 3. run tests) → one sentence with the same three checks | numbered list for three short clauses | B3 vs A (4 runs): every grader equal or better — natural `reports-file-line` 3/4 → 4/4, `fix-skill` 2/4 → 2/4; final confirmation with cut 2: see below | **revert** — final confirmation lost a point |
| 4 | Step 7 pre-mortem bullets (callers / papering over / root cause reappearing) and "Cover:" | duplicate of pre-mortem.md; the focus question stays | B4 vs A (8 runs): explicit `reports-file-line` 8/8 → 7/8, explicit `root-cause-before-edit` 7/8 → 8/8, natural all equal | **revert** — loses a grader point |

Cuts 1 and 4 most likely lost to noise, not to the text. The failing runs
in A and B fail the same way: the turn ends with the completion card and no
Step 8 text report, so `total.js:3` never appears. B2 and B3 also contain
cut 1 and lost nothing. Across all four invocations A itself scored
explicit `reports-file-line` 22/24 and natural `reports-file-line` 18/24.
The rule is "a cut that loses a grader point gets reverted", so both ship
reverted. A retry with ≥ 8 runs per variant could clear them.

### Kept instructions that looked prescriptive

Unchanged from the first attempt (table below). Also kept on purpose:
Steps 2–5 verbatim. Merging them cost `root-cause-before-edit` in #651.

### Eval cases used

Same as #651: `skills/auto-fix/explicit-off-by-one` and
`skills/auto-fix/off-by-one-root-cause` (`fix-skill`, `loop-fixed`,
`root-cause-before-edit`, `reports-file-line`).

```bash
node plugins/devops/evals/ab-run.js --case 'skills/auto-fix/*' --a-ref origin/main --b <snapshot>/plugins/devops --runs 4 --timeout-min 12
```

### Per-grader results (cumulative variants, A from the same invocation)

| Case | Grader | A / B1 | A / B2 | A / B3 | A / B4 |
|---|---|---|---|---|---|
| explicit-off-by-one | fix-skill | 8/8 / 8/8 | 4/4 / 4/4 | 4/4 / 4/4 | 8/8 / 8/8 |
| explicit-off-by-one | loop-fixed | 8/8 / 8/8 | 4/4 / 4/4 | 4/4 / 4/4 | 8/8 / 8/8 |
| explicit-off-by-one | root-cause-before-edit | 8/8 / 8/8 | 4/4 / 4/4 | 4/4 / 4/4 | 7/8 / 8/8 |
| explicit-off-by-one | reports-file-line | 6/8 / **5/8** | 4/4 / 4/4 | 4/4 / 4/4 | 8/8 / **7/8** |
| off-by-one-root-cause | fix-skill | 6/8 / 6/8 | 4/4 / 4/4 | 2/4 / 2/4 | 6/8 / 6/8 |
| off-by-one-root-cause | loop-fixed | 8/8 / 8/8 | 4/4 / 4/4 | 4/4 / 4/4 | 8/8 / 8/8 |
| off-by-one-root-cause | root-cause-before-edit | 8/8 / **7/8** | 4/4 / 4/4 | 4/4 / 4/4 | 8/8 / 8/8 |
| off-by-one-root-cause | reports-file-line | 6/8 / 8/8 | 3/4 / 4/4 | 3/4 / 4/4 | 6/8 / 6/8 |

Confirmation of the final candidate (cuts 2+3, cuts 1 and 4 reverted) vs A
at b3df3b2a. The first try hit the account session limit (12 of 16 runs
errored; the 4 graded runs scored 2/2 → 2/2 on the explicit case). Re-run
after the reset with `--runs 2`:

| Case | Grader | A | B |
|---|---|---|---|
| explicit-off-by-one | fix-skill | 2/2 | 2/2 |
| explicit-off-by-one | loop-fixed | 2/2 | 2/2 |
| explicit-off-by-one | root-cause-before-edit | 2/2 | 2/2 |
| explicit-off-by-one | reports-file-line | 2/2 | 2/2 |
| off-by-one-root-cause | fix-skill | 1/2 | 2/2 |
| off-by-one-root-cause | loop-fixed | 2/2 | 2/2 |
| off-by-one-root-cause | root-cause-before-edit | 2/2 | 2/2 |
| off-by-one-root-cause | reports-file-line | 2/2 | **1/2** |

Pass rate A 15/16, B 15/16. Tokens A 4,557,743 / B 4,383,231, cost
$6.24 / $5.46, mean duration 240 s / 217 s, 0 errors. The failing B run
loaded the skill, named the root cause and fixed the loop, then rendered the
card offline (`card-payload.json` + `node`) without a Step 8 report. Every
earlier `reports-file-line` miss, in A and B alike, failed the same way.
Neither cut 2 (the Codex row, unreachable on a clear root cause) nor cut 3
(the Verify sentence) touches that path, so the loss cannot be pinned on one
cut.

### Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Errors |
|---|---|---|---|---|
| A (B1 invocations) | 58/64 | 14,151,472 | $25.30 | 0 |
| B1 | 58/64 | 13,067,764 | $23.99 | 0 |
| A (B2 invocation) | 31/32 | 7,858,661 | $13.08 | 0 |
| B2 | 32/32 | 7,488,814 | $11.12 | 0 |
| A (B3 invocation) | 29/32 | 6,932,487 | $12.94 | 0 |
| B3 | 30/32 | 6,998,912 | $12.72 | 0 |
| A (B4 invocations) | 59/64 | 14,453,740 | $25.50 | 0 |
| B4 | 59/64 | 14,393,431 | $24.31 | 0 |

### Verdict

`revert` — all four cuts. Cuts 1 and 4 each lost a point in their own
comparison. The final combination of cuts 2+3 lost natural
`reports-file-line` 2/2 → 1/2. No single cut can be blamed, so the rule "a
cut that loses a grader point gets reverted" applies to both. `SKILL.md`
ships unchanged at 1120 words. At these run counts `reports-file-line`
swings by ±1 for A alone (natural case: A scored 18/24 across the B1–B4
invocations), and the −2.7 % on offer is smaller than this grader can
resolve. A further retry needs ≥ 8 runs per variant. Or fix the
card-without-report failure mode first: it is a skill behaviour gap of its
own, and no trim causes it.

## First attempt — #651 (reverted)

### Skill

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

### Removed instructions

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

### Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Decision table (trivial / low / medium risk / unclear / architectural) | policy the model cannot infer; drives fix-vs-propose |
| 2 | `--from=auto-fix --mode=interactive` / `--mode=background` and the Inline skip | auto-agents call contract |
| 3 | Completion-card variant table + "Output the returned markdown VERBATIM as the LAST thing" | stop-hook completion-card contract |
| 4 | Codex only via codex-safe.sh, never /codex:rescue | known regression (hung Agent tool); safety |
| 5 | Report fields incl. "Sicher behoben" vs. "Hypothese" | observable output contract |

### Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-fix/off-by-one-root-cause` + `skills/auto-fix/explicit-off-by-one` (prompt names the skill) | `fix-skill`, `loop-fixed`, `root-cause-before-edit`, `reports-file-line` (graders.js) | the skill's core contract: root cause named before the first edit, fix applied, file:line in the report |

Commands (A before the trim, B after; same cases, separate plugin dirs so
the B edits could not leak into the A runs):
`node plugins/devops/evals/ab-run.js --case 'skills/auto-fix/off-by-one-root-cause' --b <origin/main worktree>/plugins/devops --runs 2`
and the same with `--b <trimmed snapshot>/plugins/devops`.

### Per-grader results

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

### Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 12/16 | 3,109,299 | $5.33 | 241 s | 0 |
| B | 14/16 | 3,805,841 | $5.16 | 457 s | 0 |

### Verdict

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

