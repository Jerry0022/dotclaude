# Skill trim record — `auto-concept` (pass 1)

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-concept` (`plugins/devops/skills/auto-concept/`) |
| Files | `SKILL.md`, `deep-knowledge/step4-monitor.md`, `deep-knowledge/pause-resume.md`, `deep-knowledge/artifact-fallback.md` |
| Issue | #722 (umbrella #688) |
| Lines / words before (A) | `SKILL.md` 498 / 5283; `step4-monitor.md` 46; `pause-resume.md` 47; `artifact-fallback.md` 48 (`origin/main` 8797cc5c) |
| Lines / words after (B) | `SKILL.md` 430 / 4620 (−14 % lines, −13 % words); `step4-monitor.md` 41 / 331; `pause-resume.md` 44 / 342; `artifact-fallback.md` 47 / 399 |
| Variant A | `origin/main` via `--a-ref` (batch 1: 8797cc5c; batch 2: b3df3b2a — `skills/auto-concept/` identical in both) |
| Variant B | working tree of `refactor/722-auto-concept-trim-1` (batch 1 at cd7aeeb7, batch 2 at dfe6d703) |
| Runs per variant | 2 (batch 2: 1 valid — see Verdict) |
| Results dir | `plugins/devops/evals/results/ab-2026-10-16T15-16-19-453Z` (batch 1), `…/ab-2026-10-16T15-53-51-672Z` (batch 2) — not committed |

## Removed instructions

Batch 1 = commit `refactor(auto-concept): trim SKILL.md rationale prose`,
batch 2 = commit `refactor(auto-concept): trim rationale in small
deep-knowledge files`. Every guard sentence that `skill-source.test.js`
pins inline and every `**Before executing this step, …**` pointer line stays
verbatim. A/B numbers are the case total (8 graders × runs).

| # | Excerpt (removed text) | Reason for removal | A/B result | Verdict |
|---|---|---|---|---|
| 1 | Step 0 "Use **Glob** to verify … Do NOT call Read on files that may not exist" | two sentences for one rule; condensed to one line | batch 1: 16/16 → 16/16 | keep |
| 2 | Step 1a "Pick via the strict ordered check below …" paragraph | duplicated the bold "Order of evaluation" line; merged into it | batch 1: 16/16 → 16/16 (`no-mode-question`, `decision-panel` 2/2 → 2/2) | keep |
| 3 | Step 1a items 1–3 body prose (viewport real-estate, count preference repeat, "Only reach this step after 1 AND 2") | examples and repeats of Step 0.5; kept the trigger lists and the design-mode skip | batch 1: 16/16 → 16/16 | keep |
| 4 | Template continuity rationale ("belongs to the concept, not to the mood of a round", why the design layout cannot hold a report) | explanation; rule, `data-view-kind="decision"` and both exceptions kept | batch 1: 16/16 → 16/16 (not exercised: one round only) | keep |
| 5 | Post-generation validation list of Phase 1 patterns | the build enforces Phase 1 by construction; list lives in `validation-gate.md` | batch 1: 16/16 → 16/16 (`page-built`, `built-by-script` 2/2 → 2/2) | keep |
| 6 | Step 3 forbidden-list continuation sentences (preview iframe, Playwright, `file://`, why the clipboard hand-off is wrong) | rationale; every bullet head (test-pinned), the `preview_eval` exception and the `post.concept.gate` note kept | batch 1: 16/16 → 16/16 (`no-browser-tool`, `no-clipboard-handoff` 2/2 → 2/2) | keep |
| 7 | Finalize "Fixed execution order" rationale | shortened to one clause per part; order sentence and "Never reorder" kept | batch 1: 16/16 → 16/16 (not exercised) | keep |
| 8 | "/reset is the LAST step" mechanism (`_processed_at`, `pollProcessedState`) | implementation detail; consequence kept in one sentence | batch 1: 16/16 → 16/16 (not exercised) | keep |
| 9 | Final-report append intro | duplicate of the 5c action list; now names `data-iteration-template="free"` | batch 1: 16/16 → 16/16 (not exercised) | keep |
| 10 | Step 6 / 6a intros | duplicate of the 6a pointer; kept "nothing may still run when the card renders" | batch 1: 16/16 → 16/16 (not exercised) | keep |
| 11 | UNPROCESSED guard rationale | shortened; bold guard (test-pinned) and the path kept | batch 1: 16/16 → 16/16 (not exercised) | keep |
| 12 | 6c pause summary (stop list, state-file mark, resume steps) | duplicate of `pause-resume.md`; pointer kept | batch 1: 16/16 → 16/16 (not exercised) | keep |
| 13 | Smart Trigger Rules numbered lists | 18 lines → 4; every trigger, the suggestion phrase and every exclusion kept | batch 1: 16/16 → 16/16 (not exercised) | keep |
| 14 | Rules: duplicate "self-contained HTML" bullet and its wordier twin | duplicate | batch 1: 16/16 → 16/16 | keep |
| 15 | `step4-monitor.md` Backstop rationale and "Important" paragraph | explanation of why the cron cannot cover the gap; consequence kept | batch 2: 8/8 → 8/8 (1 run each; not exercised — bridge denied in the case) | keep |
| 16 | `pause-resume.md` pause intro rationale | why leaving processes running is wasteful | batch 2: 8/8 → 8/8 (not exercised) | keep |
| 17 | `artifact-fallback.md` wrapper note ("same rule as `concept-server.py`", "behave exactly as before") | rationale; both contract facts kept | batch 2: 8/8 → 8/8 (not exercised) | keep |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | "No reachable bridge ≠ no concept" section | the eval harness denies the bridge; this is the text that keeps the page on the engine (`page-built`, `built-by-script`) |
| 2 | Step 3 "MANDATORY — Real Edge browser only" bullet heads | hook-enforced (`post.concept.gate`) and test-pinned; drive `no-browser-tool` / `no-clipboard-handoff` |
| 3 | Step 5b implement step 0 (reality check) | test-pinned guard |
| 4 | Part C ship steps, "The ship card comes last", force-push confirmation | ship gate and completion-card contract |
| 5 | 6b "Output the returned markdown VERBATIM as the LAST thing" | stop-hook completion-card contract |
| 6 | All `**Before executing this step, (Re-)Read …**` pointer lines | `skill-source.js` resolves them; Step 5 re-read wording is test-pinned |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-concept/decision-page` (#721) | `concept-skill`, `no-mode-question`, `page-built`, `built-by-script`, `no-hand-written-page`, `decision-panel`, `no-clipboard-handoff`, `no-browser-tool` (graders.js) | the skill's first-round contract: mode question skipped when pinned, page built by `concept-build.js`, decision panel present, no clipboard hand-off, no preview/browser tool |

Command (both batches):
`node plugins/devops/evals/ab-run.js --case plugins/devops/evals/skills/auto-concept/decision-page --a-ref origin/main --runs 2 --timeout-min 15`

## Per-grader results

| Batch | Grader | A | B |
|---|---|---|---|
| 1 | concept-skill | 2/2 | 2/2 |
| 1 | no-mode-question | 2/2 | 2/2 |
| 1 | page-built | 2/2 | 2/2 |
| 1 | built-by-script | 2/2 | 2/2 |
| 1 | no-hand-written-page | 2/2 | 2/2 |
| 1 | decision-panel | 2/2 | 2/2 |
| 1 | no-clipboard-handoff | 2/2 | 2/2 |
| 1 | no-browser-tool | 2/2 | 2/2 |
| 2 | all eight graders | 1/1 each (1 n/a) | 1/1 each (1 n/a) |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A (batch 1) | 16/16 | 8,684,217 | $10.53 | 591 s | 0 |
| B (batch 1) | 16/16 | 7,627,269 | $9.44 | 488 s | 0 |
| A (batch 2) | 8/8 | 4,179,546 | $5.94 | 377 s (valid run) | 1 (session limit) |
| B (batch 2) | 8/8 | 4,053,358 | $4.59 | 462 s (valid run) | 1 (session limit) |

## Verdict

`keep` — no grader point lost in either batch. Batch 1 (the `SKILL.md`
cuts): 16/16 → 16/16, B 12 % fewer tokens and $1.09 cheaper over two runs.
Batch 2 (cumulative, adds the deep-knowledge cuts): 8/8 → 8/8 on the one
valid run per variant; run 2 of both variants ended after 12–65 s with
"You've hit your session limit" and is n/a, not a failure. The case covers
only the first round (bridge denied), so cuts 4 and 7–17 are
not exercised by it — they remove rationale only, every rule sentence and
every test-pinned guard stays, and the auto-concept / evals / concept-gate
/ session-start suites pass. A follow-up should re-run batch 2 with
`--runs 2` once the limit resets, and a case that reaches Step 5 (submit →
next round) would cover the later cuts.
