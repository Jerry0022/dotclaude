# Skill trim record — `do-run`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:do-run` (`plugins/devops/skills/do-run/`) |
| Files | tested: `SKILL.md` + `deep-knowledge/questions.md`; shipped: `deep-knowledge/questions.md` only (SKILL.md cuts reverted, see Verdict) |
| Issue | #719 (umbrella #665) |
| Words before (A) | 22189 (`wc -w` SKILL.md + `modes/*.md` + `deep-knowledge/*.md` at `origin/main` cdc332a0); SKILL.md 2640, questions.md 2040 |
| Words after (B) | tested: SKILL.md 2518 (−4.6 %), questions.md 1855 (−9.1 %); shipped: 22004 (−0.8 %), SKILL.md byte-identical to `origin/main` |
| Variant A | `--a-ref origin/main` (sha `cdc332a0`) |
| Variant B | working tree of `refactor/719-do-run-trim` at `2f5a15c2` |
| Runs per variant | 4 |
| Results dir | `evals/results/ab-2026-10-16T14-44-17-696Z/` (not committed) |

## Removed instructions

| # | File · section | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|---|
| 1 | SKILL.md · intro | "This file is the router … Each mode file is the verbatim body of a former skill; where the router already answered one of its questions, the mode file says so and reads the answer." | history; condensed to one sentence | **reverted** — `task-verbatim` 1/3 → 0/3 (B run 2 excluded, see below); not separable from rows 2–3 in one run |
| 2 | SKILL.md · Step 7 "Gated." | "`do-ship` is what runs the diff passes and the Codex review, and the gate cannot see a ship it never ran." | rationale; the rule "Ship through `Skill("devops:do-ship")` only, never the `ship_*` MCP tools directly" kept | **reverted** — `harden-pass` 3/3 → 2/3 (B run 1 went from `auto-agents` straight to the card) |
| 3 | SKILL.md · Rules | bullets "One base call, at most one follow-up …", "Option order is fixed …", "Budget verbrennen is never recommended and only visible when …" | duplicates of Step 3/4 and `questions.md` § Rules; the burn-stop sentence kept | **reverted** — same run as row 2; no clean attribution |
| 4 | questions.md · intro | the decision-vs-detail paragraph and the `Spec: docs/superpowers/specs/…` pointer; "Rules for every question this router asks (spec § …)" | meta / history; one sentence kept that the rules cover base call, resume and follow-ups | not covered (no run read `questions.md`) |
| 5 | questions.md · Conditions | "(The old rule, `weekly.pct > 80`, showed it exactly where little is left …)" | history | not covered |
| 6 | questions.md · Reading Q4 | "(the 48 h session scan of 2026-09-27: the passes were picked in 10 of 13 runs …)"; "and without it the only way to say "nothing" was an empty Other" | history / rationale; the `#635` reason and the rule kept | not covered |
| 7 | questions.md · F6 note | "The symbols carry the state at a glance: 🟢/🔴 … ➕/➖ …" | the labels carry it themselves | not covered |
| 8 | questions.md · closing | "F6 folds the autonomous shutdown and auto-resume questions into one … holds by construction" | condensed to one sentence; HARD GATE reference (`$SHUTDOWN=yes` ⇒ `$AUTO_RESUME=no`) kept | not covered |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Step 1 "The task stays verbatim" block | graded (`task-verbatim`, `task-before-edit`); hooks (`ss.run.task`) read the file |
| 2 | Every `AskUserQuestion` header and label (Q1–Q4, F1–F8, "Fortsetzen", "Milestones 2" …) | the run contract and `post.ask.answers` match them verbatim |
| 3 | Every `Skill("devops:…")` call shape, `--from=do-run`, `--invoked-by=…` | run-contract obligations name these calls |
| 4 | `modes/*.md` (16.4k words) and `deep-knowledge/execution.md` | not trimmed — no case reaches them under `claude -p` (see Verdict) |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/do-run/router-defaults` (new) | `run-skill`, `task-verbatim`, `task-before-edit`, `auto-agents-path`, `click-through-defaults`, `harden-pass`, `readme-untouched`, `no-direct-ship-tools` (graders.js) | "Use the devops:do-run skill: fix the typo in greet.js, do not touch README.md" in a scaffold repo without a remote; Edit, Agent, gh, do-ship and the ship CLI denied |

Under `claude -p` the model never called `AskUserQuestion` (0/8 runs, a first
draft that graded the base call's headers scored nothing in either variant);
it takes the click-through defaults (Prompt umsetzen · Interaktiv · Ship
manuell · Flexibel), so the case grades the router path around the question
set. No run read `questions.md` or `execution.md`.

Command: `node plugins/devops/evals/ab-run.js --case 'skills/do-run/router-defaults' --a-ref origin/main --runs 4 --timeout-min 8`

## Per-grader results

| Case | Grader | A | B (as tested) |
|---|---|---|---|
| `skills/do-run/router-defaults` | run-skill | 3/3 (1 n/a) | 3/4 |
| `skills/do-run/router-defaults` | task-verbatim | 1/3 | 0/4 |
| `skills/do-run/router-defaults` | task-before-edit | 0/3 | 0/4 |
| `skills/do-run/router-defaults` | auto-agents-path | 3/3 | 3/4 |
| `skills/do-run/router-defaults` | click-through-defaults | 3/3 | 3/4 |
| `skills/do-run/router-defaults` | harden-pass | 3/3 | 2/4 |
| `skills/do-run/router-defaults` | readme-untouched | 3/3 | 4/4 |
| `skills/do-run/router-defaults` | no-direct-ship-tools | 3/3 | 4/4 |

A run 4 timed out (8 min, mid card render) and grades `n/a`. B run 2 never
invoked the skill — it judged the one-character fix below do-run's "bigger
than one edit" description and fixed it inline; the frontmatter is identical
in A and B and the body loads only after the Skill call, so that run's
misses on `run-skill`, `auto-agents-path`, `click-through-defaults` and
`harden-pass` are routing noise, not the trim. Without it B is 3/3 on those
except `harden-pass` 2/3. `task-before-edit` 0 in both: the model writes
`run-task.md` (when at all) after the fix.

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 19/24 | 6,628,931 | $8.81 | 397 s | 1 (timeout) |
| B | 22/32 | 5,533,141 | $8.08 | 257 s | 0 |

## Verdict

`ship with kept rows above` — the shipped text is B minus rows 1–3:
`SKILL.md` is byte-identical to `origin/main`. B lost one run on
`harden-pass` (row 2 sits next to the Harden step) and one on
`task-verbatim`; one combined run cannot attribute either loss to a single
SKILL.md cut, so all three SKILL.md cuts are reverted under "B worse on any
grader → revert". The `questions.md` cuts (rows 4–8, −185 words) are
history and rationale only; every header, label, gate and order rule stays
verbatim (`do-run-questions.test.js` green), and no run loaded the file, so
they ship as "not covered", as `trims/do-ship.md` did with its uncovered
cuts.

Shortfall against the issue: `modes/` (16.4k words) and
`deep-knowledge/execution.md` are untrimmed. Under `claude -p` the router
never asks, so no case reaches a mode file or the follow-up questions; a
trim there needs a case that presets a mode (e.g. `/do-run audit` or a
`RUN_BACKLOG_AUTOSTART:` machine prompt) and runs that are each ~4–8 min.

## Follow-up #734 — audit mode case and trim

New case `skills/do-run/mode-audit` (graders.js): "Use the devops:do-run
skill in audit mode: audit this project (scope: all, result as a concept
page, change nothing). Analyze only." on a three-file scaffold repo. Edit,
Agent, gh, commit/push, do-ship, `auto-concept` and the whole concept
bridge (python, `concept-*`, browser, crons, kill) are denied — a first
draft without those denies ran the real bridge, opened the browser and hit
the 12-minute timeout (2 baseline runs, 1 timeout, 1 killed). Denying the
`auto-concept` call ends the run at the audit's own hand-off; a denied call
still counts as attempted. Graders: `run-skill`, `mode-file-read`
(`modes/audit.md`), `requirements-persisted`, `findings-persisted`
(`.claude/audit/**`), `concept-branch` (`auto-concept` attempted),
`source-untouched`, `no-direct-ship-tools`. A `dimensions.md` grader was
dropped: the model never read it under `-p` (0/1), so it carried no signal.

| Field | Value |
|---|---|
| Files | `modes/audit.md`, `deep-knowledge/execution.md` |
| Words before (A) | audit.md 2243, execution.md 1103 (3346) |
| Words after (B) | measured: audit.md 2099, execution.md 1032 (3131, −6.4 %); shipped after the review restorations below: audit.md 2115 (−5.7 %), execution.md 1054 (−4.4 %) (3169, −5.3 %) |
| Variant A / B | `--a-ref origin/main` / working tree |
| Runs per variant | 2 (`evals/results/ab2/`, not committed) |
| Command | `node plugins/devops/evals/ab-run.js --case plugins/devops/evals/skills/do-run/mode-audit --a-ref origin/main --runs 2 --timeout-min 10` |

| # | File · section | Removed text | Reason | A/B result |
|---|---|---|---|---|
| 1 | audit.md · header | the `<!-- … moved verbatim in PR 2 … -->` comment; "Why this skill exists" paragraph | history / rationale; one line keeps the pointer to `../SKILL.md` | no grader lost |
| 2 | audit.md · Step 0 | "Project extensions typically add: …" example list | shortened to one sentence | no grader lost |
| 3 | audit.md · Step 2 | "so the run contract reads a standalone answer the same way as the router's"; "they are the contract strings `questions.md` defines, not prose to translate" | rationale; headers, labels, order, German-labels rule kept | no grader lost |
| 4 | audit.md · Rules | bullets "Evidence or it didn't happen", "Honest coverage" merged into one bullet | **reverted in part** after the ship review: the two rules (unproven claims are open questions; the scorecard never implies a check that did not run) are not duplicated elsewhere | no grader lost |
| 5 | execution.md · intro | decision-vs-detail paragraph | rationale | not covered |
| 6 | execution.md · Run contract | — | **reverted** after the ship review: "prints the header" is CLI behaviour, the copied-`.claude/` rule is a guarantee the model relies on | — |
| 7 | execution.md · Autonom ship lockout | `readLockout` / `stale:true` explanation | implementation detail; the 6 h rule kept, with its `do-run` owner qualifier (restored after the ship review) | not covered |

The ship review (Claude API) flagged rows 4, 6 and 7 as dropping behaviour
rather than rationale, and the `concept-branch` grader's `concept-build.js`
alternative as a bypass path; both were fixed before the ship. The restored
text is variant A's own wording, so the shipped files sit between A and B:
both scored 14/14 below, and the token saving shrinks to the shipped word
count.

Per-grader results (all 7 graders, 2 runs each): A 14/14, B 14/14. Tokens
A 1,713,481 → B 1,674,257 (−2.3 %); cost $2.98 → $2.81; mean duration 294 s
→ 298 s. Noise-level at n=2: the cuts neither help nor hurt the path, and
the saving is the ~177 words fewer loaded per audit run. Every run-contract
string (F1/F2 headers and labels, `Skill("devops:auto-concept")`, step and
`modes/…` paths, `--scope`/`--mode`/`--autonomous`) is verbatim. Verdict:
`ship all rows`. Follow-ups: autonomous, backlog, burn and rethink mode
cases.
