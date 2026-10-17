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

# Pass 2 — `validation-gate.md` and `bridge-server.md`

Same method as pass 1. Variant A = `origin/main` (28e93c9a). Variant B = a
snapshot copy of `plugins/devops` at each batch commit (`--b <snapshot>`), so
later edits could not leak into a running B.

| Field | Value |
|---|---|
| Issue | #723 (umbrella #688) |
| Files | `deep-knowledge/validation-gate.md`, `deep-knowledge/bridge-server.md` (`templates-*` are not in #723's scope) |
| Lines / words before (A) | `validation-gate.md` 656 / 13980; `bridge-server.md` 1042 / 9108 |
| Lines / words after (B) | `validation-gate.md` 598 / 12264 (−9 % lines, −12 % words); `bridge-server.md` 900 / 7471 (−14 % lines, −18 % words) |
| Batches | batch 1 = `refactor(auto-concept): trim validation-gate rationale prose` (bbc81783); batch 2 = `refactor(auto-concept): trim bridge-server rationale prose` (05fa4246), cumulative |
| Runs per variant | 2 per batch |
| Results dir | `plugins/devops/evals/results/ab-2026-10-16T23-51-40-279Z` (batch 1), `…/ab-2026-10-17T00-32-04-204Z` (batch 2) — not committed |

## Removed text

Every gate row, pattern literal, `§ heading`, pointer line, exit reason,
endpoint and status code stays. A cut removes the incident story or the
"why" behind a rule. The rule sentence stays. After each cut the auto-concept
and concept-gate suites ran. A test failure reverted the cut (rows R1, R2).

| # | Excerpt (removed text) | Reason | A→B | Verdict |
|---|---|---|---|---|
| V1 | backstop note: "safety net for the 'skill only half-used' regression" | rationale | batch 1: 15/16 → 16/16 | keep |
| V2 | Phase 0 "never copies anything out … only sanctioned mechanism, may never be omitted" | repeats the Phase 0 intro | batch 1: same; `no-clipboard-handoff` 2/2 → 2/2 | keep |
| V3 | Phase 0b intro (story of the carried-over `<style>` line) | incident story, condensed to one clause | batch 1: same | keep |
| V4 | why `--accent-color` is the probed token | rationale | batch 1: same (not exercised: no browser) | keep |
| V5, V7–V20, V22, V23, V23b, V25, V26, V28, V39 | the history and consequence clauses in rows 12b, 28b, 30b, 33, 38, 41, 45, 46, 47, 49, 51, 52, 54, 62, 62b, 64, 65, P13e, P14b, P18, P21b ("used to …", "measured on a real page …", "Round 11 of a design concept …", "Without it, …" chains) | the incident or the consequence of a missing pattern; the pattern, the hard-fail/warning level and the fix stay | batch 1: same; `page-built`, `built-by-script`, `decision-panel` 2/2 → 2/2 | keep |
| V21 | row 57: the story of the first `position: fixed` fix | condensed to the rule "never fixed off a sampled viewport rect" | batch 1: same (not exercised) | keep |
| V31 | Pre-Kompass "no carve-out" rationale | rationale; the rule and "re-sync never edits `section[data-iteration]`" stay | batch 1: same (not exercised: one round) | keep |
| V32 | Engine drift: "user reports 'still 4 attachment bars' …" | anecdote | batch 1: same (not exercised) | keep |
| V33 | why P3/P5 carry alternates | rationale; both id pairs and "accept both, prefer the new ones" stay | batch 1: same | keep |
| V36, V37 | 49–53 "single worst thing this system can do" and why the append is the moment | rationale | batch 1: same (not exercised) | keep |
| V38 | P14–P21 "not a design without opinions …" | rhetoric | batch 1: same (not exercised) | keep |
| V34 | "Common failures this gate catches" list (33 of 34 bullets) | each bullet repeats its row's Purpose column; the test-pinned `data-oq-origin` bullet stays | batch 1: same | keep |
| R1 | entry 44 "The four-literal form of 44 is deliberate …" paragraph | pinned by `design-chrome-overlap.test.js` (`/PASSED it while rendering/`) | — | reverted before A/B |
| R2 | the `data-oq-origin` common-failure bullet | pinned by `open-points-admission.test.js` | — | reverted before A/B |
| B1, B2 | timestamp note: "single most expensive silent failure", why ISO strings | rationale | batch 2: 16/16 → 16/16 | keep (not exercised: bridge denied under `-p`) |
| B3 | step 1 code comment: version-dir history | story; `sort -V` / never `head -1` stays | batch 2: same | keep (not exercised) |
| B4–B9 | step 2: reaped-child detail, Defect B history, `SO_REUSEADDR` double-bind story, old `Stop-Process` guidance, single-threaded failure walk-through, 30 min calibration | incident stories; every MUST (registry pick, `can-claim` gate, exclusive bind, threaded server, `--html`, timeouts) stays | batch 2: same | keep (not exercised) |
| B10–B13 | step 3: per-minute cron cost story, 1128-char prompt story, MODULE_NOT_FOUND story, `Concept bridge, port N —` lead-in example | rationale; both load-bearing prompt phrasings and the CronCreate block (test-pinned) stay | batch 2: same | keep (not exercised) |
| B14, B15 | "Why a script and not a Read per tick", "Why combined" | rationale; the `/pending` reason condensed to one sentence | batch 2: same | keep (not exercised) |
| B16–B22 | 638 s cron gap, single-watcher flaw story, why the watchers need a launch check, the four ways the inline loop broke, 2026-09-20 timing story, shutdown-on-rename story, Sleeping Tab history | incident stories; `sleep 20` (test-pinned), every exit reason, `--grace`/`--timeout`/`--dead-after`/`--confirm` and the duplicate-watcher rules stay | batch 2: same | keep (not exercised) |
| B23–B28 | 4b: why the store refuses to start, why `drafts/` exists, keepalive-quota story, "losing a comment requires losing the disk", why read `/recovery`, "before this, `/pending` answered false" | rationale; layout, endpoints, header rule, "restart on the same port" stay | batch 2: same | keep (not exercised) |
| B29–B33 | 4c: response-shape convenience, why the second disk check is authoritative, old SVG-ban rationale, the `payload.png` attack walk-through, why `index.json` exists | rationale; caps, shapes, error table (test-pinned), magic-byte rule and serving policy stay | batch 2: same | keep (not exercised) |
| B34–B36 | step 5: why a naked POST is not enough, why pre/post, why 3 s | rationale; the script stays | batch 2: same | keep (not exercised) |

## Per-grader results

| Batch | Grader | A | B |
|---|---|---|---|
| 1 | concept-skill | 2/2 | 2/2 |
| 1 | no-mode-question | 1/2 | 2/2 |
| 1 | page-built, built-by-script, no-hand-written-page, decision-panel, no-clipboard-handoff, no-browser-tool | 2/2 each | 2/2 each |
| 2 | all eight graders | 2/2 each | 2/2 each |

## Summary

| Variant | Pass rate | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A (batch 1) | 15/16 | 8,685,473 | $11.65 | 556 s | 0 |
| B (batch 1) | 16/16 | 11,157,793 | $11.58 | 609 s | 0 |
| A (batch 2) | 16/16 | 8,872,507 | $10.40 | 479 s | 0 |
| B (batch 2) | 16/16 | 7,805,916 | $9.02 | 496 s | 0 |

## Verdict

`keep`: neither batch lost a grader point. The batch-1 A miss
(`no-mode-question`, run 2) happened on the untouched `origin/main` text, so
it is run variance, not an effect of the cut. B's higher batch-1 token total
is also variance (cache reads 10.6 M vs 8.0 M, cost even). In batch 2 (both
files cut), B used 12 % fewer tokens and cost $1.38 less over two runs. The
case covers only the first round and denies the bridge, so it does not
exercise the gate's later-round rows or any `bridge-server.md` cut. Those cuts
remove rationale only, and every test-pinned sentence stays. The
auto-concept, concept-gate, session-start and scripts suites pass, except
`concept-build.test.js` (also fails on `origin/main`'s copies of both files)
and `burn-plan.robustness.git.test.js` / `git-sync.conflicts.test.js`, which
read neither file.
