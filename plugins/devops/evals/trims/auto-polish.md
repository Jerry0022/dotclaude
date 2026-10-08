# Skill trim record — `auto-polish`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-polish` (`plugins/devops/skills/auto-polish/`) |
| Files | `SKILL.md` + `deep-knowledge/{fix-phases,retest-and-output,rules-only-path}.md` |
| Issue | #651 (umbrella #644) |
| Words before (A) | 3361 (`wc -w` at `origin/main` e728fbbb) |
| Words after (B) | 3122 (−7 %) |
| Variant A | `origin/main` (sha `e728fbbb`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/651-trim-small-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A/ab-*`, `<scratchpad>/results-B/ab-*` (not committed) |

## Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | Invocation Context #3 repeating the rules-only path ("no test plan, no qa/redteam agents, no browser, no fixes, no completion card") | duplicate of § Rules-only path and rules-only-path.md | `rules-only-report::no-edit` 2/2 → 3/3, `::no-role-agent` |
| 2 | Invocation Context #4 "only the named scope changes; wider findings are reported, never fixed. The ship path is report-only anyway" | duplicate of Step 1 `--strict` and Rules | not covered |
| 3 | "Skips ALL `AskUserQuestion` calls. Structural changes are STILL not auto-applied … Autonomous is mute mode, not yolo mode." | CAPS + slogan; same rule in one plain sentence | not covered |
| 4 | Step 3 "In parallel — do NOT block" + verbatim qa Agent(...) prompt block | the model writes agent prompts itself; kept the report list and the skip rule | not covered (rules-only path skips Step 3) |
| 5 | § Rules-only path "Empty scope or no UI profile → { applicable: false, reason }" | duplicate of rules-only-path.md item 1 | `rules-only-report::tooltip-finding` 2/2 → 3/3 |
| 6 | Rules "Structural changes ALWAYS need approval" / "Tokens are intent; dominance is accident." | CAPS / slogan | not covered |
| 7 | rules-only-path.md "Runs instead of Steps 3 and 5–12 …" opening | duplicate of SKILL.md | `rules-only-report::no-edit` 2/2 → 3/3 |
| 8 | fix-phases.md "Apply ALL … (they're invisible …)", "No prompt needed; this is mechanical", "No prompt." | repeated emphasis | not covered |
| 9 | fix-phases.md verbatim designer Agent(...) prompt; "beautiful backend refactor" paragraph; "These NEVER auto-apply" | prompt scaffolding / repeated emphasis; content kept in one sentence each | not covered |
| 10 | retest-and-output.md verbatim redteam Agent(...) prompt | prompt scaffolding; the risk list is kept | not covered |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Invocation Context / Execution / Step 1 wording incl. `/auto-agents` (layer 5) never calls it, `--mode=background` under `--autonomous`, **ignore `ship`**, Inline shortcut, `--strict` narrows, never widens | pinned by `skills/auto-harden/skill-text.test.js` (contract prose) |
| 2 | Step 2 scope question (header `Scope`) | AskUserQuestion header/options |
| 3 | Fix-phase table and score tiers; findings-scan.md R0–R7 spec | policy content, not hand-holding |
| 4 | Completion-card variant table + VERBATIM LAST | stop-hook card contract |
| 5 | Never commit automatically | safety |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-polish/rules-only-report` | `polish-ship-path`, `no-edit`, `tooltip-finding`, `no-role-agent` (graders.js) | the cheap, deterministic path: findings reported, file untouched, no agents (a full pass needs a browser and agents — too slow/costly for --runs 2) |

Commands (A before the trim, B after; same cases, separate plugin dirs so
the B edits could not leak into the A runs):
`node plugins/devops/evals/ab-run.js --case 'skills/auto-polish/rules-only-report' --b <origin/main worktree>/plugins/devops --runs 2`
and the same with `--b <trimmed snapshot>/plugins/devops`.

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/auto-polish/rules-only-report` | polish-ship-path | 2/2 | 3/3 |
| `skills/auto-polish/rules-only-report` | no-edit | 2/2 | 3/3 |
| `skills/auto-polish/rules-only-report` | tooltip-finding | 2/2 | 3/3 |
| `skills/auto-polish/rules-only-report` | no-role-agent | 2/2 | 3/3 |
| `skills/auto-polish/rules-only-report` | file-intact | 2/2 | 2/2 |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 10/10 | 1,015,664 | $2.27 | 293 s | 0 |
| B | 14/14 | 1,940,725 | $4.46 | 354 s | 0 |

## Verdict

`ship` — 10/10 → 14/14 decided graders (B: 3 runs incl. the rerun). The first B run failed
`no-edit` on a grader false positive (a completion-card JSON written to
`.polish-card.json` named `Toolbar.jsx` in its content; the source file was
never touched). The grader now matches the edited `file_path`, the file check
became its own `file-intact` grader (undecided for that run — its workdir was
gone), and the rerun of B passed all five graders. The full pass (Steps 3,
5–11) has no case: it needs a browser and agents; its cuts are prompt
scaffolding and repeated emphasis with the content kept.

