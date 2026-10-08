# Skill trim record — `auto-harden`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-harden` (`plugins/devops/skills/auto-harden/SKILL.md`) |
| Issue | #652 (umbrella #644) |
| Words before (A) | 3214 (`wc -w` at `origin/main` 499cdd2f) |
| Words after (B) | 3047 (−5 %) |
| Variant A | `origin/main` (sha `499cdd2f`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/652-trim-medium-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A-auto-issue_auto-harden/ab-*`, `<scratchpad>/results-B-harden/ab-*` (not committed) |

## Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | Invocation Context #4 restating the strict rule ("stay inside the named scope; everything wider is reported …") | duplicate of Step 1 `--strict` and Rules; the report-only ship meaning stays | `ship-path-json::debugger-removed` (non-strict) |
| 2 | Step 1 "Skips ALL `AskUserQuestion` calls" | CAPS; same rule in plain words | not covered |
| 3 | Ship path intro "(approved concept item …) … without the full pass's cost (scout/qa/redteam agents, test plan, coverage writing)" | history / rationale; the spec items 1–6 are untouched | `ship-path-json::*` |
| 4 | Step 3 "do NOT block on either" + verbatim qa `Agent(...)` prompt block | prompt scaffolding; the report contents and the skip rule are kept in one sentence | not covered (full pass needs agents) |
| 5 | Step 5 verbatim code-simplifier `Agent(...)` prompt; "NEVER auto-apply regardless of score", "DO NOT auto-fix" | prompt scaffolding / CAPS | not covered |
| 6 | Step 6 "DO NOT scaffold one", Step 7 repeated hard-floor list, Step 8 "Do NOT do a repo-wide migration sweep" | CAPS / duplicate of Step 5's hard-floor list | not covered |
| 7 | Step 9 verbatim redteam `Agent(...)` prompt | prompt scaffolding; the risk list is kept | not covered |
| 8 | Rules "No new features. Ever. Even tiny ones." + separate "No structural UI changes" line, "Pre-mortem inline" (duplicate of Step 5.4), "mute mode, not yolo mode" slogan | emphasis / duplicates / slogan; merged into plain rules | not covered |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Invocation Context / Execution / Step 1 / Ship path wording (`/auto-agents` (layer 5) never calls it, **ignore `ship`**, Inline shortcut, `--cwd` scoping, H1–H7 table, "No completion card, no AskUserQuestion", **Never blocks.**) | pinned by `skills/auto-harden/skill-text.test.js`; ship path mirrors `scripts/ship-harden.js` |
| 2 | Step 2 scope question (header `Scope`) | AskUserQuestion header/options |
| 3 | Step 4 scan list, Step 5 score tiers, Step 8 math and "Hard never" list | policy content, not hand-holding |
| 4 | Completion card variant table + VERBATIM LAST | stop-hook card contract |
| 5 | Never commit automatically | safety |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-harden/ship-path-json` | `harden-ship-path`, `script-run`, `json-shape`, `todo-reported`, `debugger-removed`, `no-role-agent`, `no-question-in-skill` (graders.js) | the deterministic path: script output returned, mechanical fixes applied, no agents (a full pass needs agents and a test plan — too slow/costly for --runs 2) |

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/auto-harden/ship-path-json` | harden-ship-path | 2/2 | 2/2 |
| `skills/auto-harden/ship-path-json` | script-run | 2/2 | 2/2 |
| `skills/auto-harden/ship-path-json` | json-shape | 2/2 | 2/2 |
| `skills/auto-harden/ship-path-json` | todo-reported | 2/2 | 2/2 |
| `skills/auto-harden/ship-path-json` | debugger-removed | 2/2 | 2/2 |
| `skills/auto-harden/ship-path-json` | no-role-agent | 2/2 | 2/2 |
| `skills/auto-harden/ship-path-json` | no-question-in-skill | 2/2 | 2/2 |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 14/14 | 1,788,569 | $2.93 | 216 s | 0 |
| B | 14/14 | 1,340,860 | $3.30 | 143 s | 0 |

## Verdict

`ship` — 14/14 → 14/14 decided graders. The first grading had a
`no-question` check that failed both B runs: after the skill had returned its
JSON, the Stop hook's offline card renderer answered with a local-ship
directive and the model asked what to do with the uncommitted fixes (A hit
the same directive and declined in prose). That is the card flow, not the
skill — the ship path is unchanged apart from its intro — so the grader now
checks that no question comes before the JSON (`no-question-in-skill`) and
both variants were regraded from their streams. The full pass (Steps 2–10)
has no case; its cuts are verbatim agent prompts, CAPS and duplicates with
the content kept.
