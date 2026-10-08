# Skill trim record — `do-ship`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:do-ship` (`plugins/devops/skills/do-ship/`) |
| Files | `SKILL.md` only — `modes/` and `deep-knowledge/` unchanged (read on demand, see Verdict) |
| Issue | #653 (umbrella #644) |
| Words before (A) | 10603 (`wc -w SKILL.md` at `origin/main` 2abde25c); 73449 bytes, Step 0 at byte 19224 |
| Words after (B) | tested: 10007 (−5.6 %); shipped after the reverts below: 10097 (−4.8 %) |
| Variant A | `origin/main` (sha `2abde25c`), detached worktree in the scratchpad |
| Variant B | snapshot worktree of `refactor/653-trim-gate-critical-skills` at the trim commit |
| Runs per variant | 2 + 2 (rerun of the undecided graders) |
| Results dir | `<scratchpad>/res653-{A2,A3}/ab-*`, `<scratchpad>/res653-{B,B3}/ab-*` (not committed) |

## Gate contract (new regression tests)

`plugins/devops/skills/do-ship/gate-contract.test.js` was written against the
untrimmed text (green on `origin/main`), then the trim was applied; it stays
green. It pins: every `##`/`###` heading verbatim and in order (no step merged,
renamed or renumbered — project extensions hook into "Step 6"/"Step 8"), the
run-map rows and calls, `cwd` on every `ship_*` call example and in each step,
`--cwd` routing without `ExitWorktree`, the six-tool `ToolSearch` select and
"do NOT improvise a ship with `gh pr create`", the lockout marker / re-derive /
clear rule and the BLOCK / RECORD & CONTINUE row for every interactive gate
(plus each gate's in-place lockout branch), `ship-blocked` → `ship_cleanup({
keep: true })` first, every hard stop → `ship-blocked`, the release-result
reading order (never retry a landed merge, `success` alone is no merge,
validation gaps, git-probe-timeout, rebaseRequired → Step 1b + Step 1d full
check), merge strategy by overlap, no plain force-push in any do-ship file,
Codex only via `codex-safe.sh` with the rc table, cleanup only own branch /
only after a confirmed merge / STOP on `ExitWorktree` failure, keep-mode and
harness-worktree semantics, `--queued` skipping `ship_hygiene`, the queue
marker deferring install-mutating extension steps, promotion never
autonomous, the variant rule (merged ⇒ `ship-successful`, never `ready`), and
the card-last rule (verbatim, nothing after it, extension steps between the
render and `show_widget`).

## Removed instructions

All cuts are inside steps; no step was merged, renamed or renumbered.

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | "**CRITICAL —** … Omitting `cwd` will cause the tool to operate on the wrong repository." (4 lines) | stacked emphasis; rule kept in 3 lines ("Every `ship_*` tool call MUST include `cwd`") | `ship-it-denied::preflight-attempt` 0/4 → 0/4 (tools absent in both) |
| 2 | Run map "Every step keeps its full rules further down — this table never replaces them." | condensed to one clause; the compaction/`--resume` paragraph stays verbatim | not covered |
| 3 | "promote is no longer a separate skill (spec `docs/superpowers/specs/…`)" | history | not covered |
| 4 | Composed-ships intro (auto-cleanup Step 10b / backlog explanation, "Three arguments and one marker make that safe") | rationale; the signal table stays verbatim | not covered |
| 5 | Pre-Step 0 "has the details for the case where something goes wrong. The user types nothing extra." and the "fresh context would cost more than it saves" / "delegating would save nothing" reasons | rationale; every rule (no `ship_*` in the parent, below threshold stays, promotion-only never delegated) kept | not covered (context below threshold) |
| 6 | Pre-Step A "no `AskUserQuestion` can ever be answered" CAPS framing; closing paragraph on what the "actual failure" would be and "every gate behaves exactly as written elsewhere — unchanged" | stacked emphasis / rationale; lockout table, marker and BLOCK shapes verbatim | **reverted** — `ship-it-denied::lockout-check-first` 4/4 → 3/4 |
| 7 | Pre-Step B numbered check list + "**STOP. Do not proceed with shipping.**" blockquote | hand-holding; same three checks and the three verbatim options in one paragraph | not covered (no pending activity) |
| 8 | Pre-Step C "A ship takes minutes … looks like any other idle session" | rationale; the four steps stay | not covered (no Desktop tools in `-p`) |
| 9 | Step 0 "Use **Glob** … Do NOT call Read on files that may not exist — skip missing files silently (no output)." | condensed; Codex line keeps "mandatory", `codex-safe.sh`, "never via the `/codex:rescue` Agent tool" | not covered |
| 10 | Step 0.5 deferred-tools explanation paragraph; "Do NOT skip this step even if you "think" … `analysis` / `ready` / `test` cards …" | condensed to one sentence each ("Run this step even when the tools look available.") | **reverted** — `ship-it-denied::schemas-load-attempt` 3/4 → 2/4 |
| 11 | Step 1a "The tool checks: clean tree, commits ahead, …" | spec of `ship_preflight` (`pre-flight.md`); base auto-detect sentence merged with its override example | not covered |
| 12 | Step 1a-ii "ignoring it is how a ship in a repo-less project marched into rebase/push/PR …" | story shortened to a one-clause why ("ignoring it once reported a merge that never happened") | not covered |
| 13 | Step 1c "This loop naturally terminates — each iteration brings the branch closer to base." | model infers it | not covered |
| 14 | Step 1e "(spec call graph …)", "so the ship never loads the whole auto-harden skill for seven regexes", "Without it the passes would diff and fix this session's own checkout …", strict-mode "reporting costs nothing …" / "A drive-by line change is exactly what strict forbids." | rationale; both pass commands, `--cwd`, `--strict`, finding routing verbatim | not covered (scripts denied) |
| 15 | Codex gate "**MUST run** … not optional, not suggested."; lockout "A design/logic/security concern must not merge unreviewed unattended …" | stacked emphasis / duplicate of the Pre-Step A table; **mandate restored after the redteam review** ("**MUST run** … mandatory, never skipped for time or context", pinned in `gate-contract.test.js`) | not covered (no Codex in the case) |
| 16 | Step 2.6 "ship-time counterpart to the docs upkeep implementation agents already do" | rationale | not covered |
| 17 | Step 3 "A breaking change is a deliberate call, never an unsupervised one; the caller parks the issue."; CHANGELOG "under `$SHIP_LOCKOUT` a surprise block would stall the pipeline" | duplicate of Pre-Step A / rationale | not covered |
| 18 | Step 4 "The merge is the one irreversible step, so …"; "exist and must not be mistaken for the one above" | condensed; every field rule kept — the "never mistake them for the shape above" clause restored after the redteam review | not covered (release never reached) |
| 19 | Step 4b: two skip paragraphs ("Skip this step for intermediate merges", "Also skip it whenever `merged` is absent …") restated in the later skip list | duplicate; folded into the one skip list (each condition kept), spawn rule after it | not covered |
| 20 | Step 4c "**A green pipeline ≠ a release users can see.**" | slogan; the rule sentence stays | not covered |
| 21 | Step 5e "a memory pass after it left Read/Write rows under the card and a closing line …" | story; "Runs **before** the completion card — the card is the last action" kept | not covered |
| 22 | Step 6 "**CRITICAL —** … `getRepoUrl` falls back to the MCP server's own working directory …" | stacked emphasis / implementation detail; rule kept | `ship-it-denied::card-attempt` 4/4 → 4/4 |
| 23 | "Deliberate promotion has no heartbeat without a forcing function."; "Undeployed infra is the ONE thing that must not hide behind a green card." | rationale | not covered |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | Every step heading and number | project extensions (`.claude/skills/do-ship` Step 6.5 / Step 8), hooks and tests reference them; pinned by `gate-contract.test.js` |
| 2 | The "observed" / issue-numbered one-liners (#398, #442, #567, #632, #210, #243) | each guards a real incident; only the story around them was cut |
| 3 | Lockout table, BLOCK / RECORD & CONTINUE shapes, each in-place lockout branch | gate determinism under `/do-run backlog` |
| 4 | Sentinel-hygiene block, card-last rule, "No recap before the card", "No side topics" | stop-hook / card contract and main-branch protection |
| 5 | Step 1d purpose-alignment examples (hotkey convention in both directions) | the subtle part of the gate; examples carry the meaning |
| 6 | `modes/` and `deep-knowledge/` | read only when a step sends the model there — no always-on context cost; several are pinned section-by-section by `ship-flow.test.js` / `reference-graph.test.js`; left for a follow-up with its own A/B |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/do-ship/ship-it-denied` (new) | `ship-skill`, `lockout-check-first`, `schemas-load-attempt`, `preflight-attempt`, `no-gh-pr`, `no-plain-force-push`, `card-attempt` (graders.js) | "ship it" in a scaffold repo with one committed change and a local bare origin; push, gh, node, Codex, Write/Edit and the ship MCP server denied |

Under `claude -p --plugin-dir` the plugin's MCP servers did not connect in
either variant (the inline plugin's shared `node_modules` was incomplete), so
both variants met the "ship tools absent" route of Step 0.5; the graders are
written to hold on that route as well as on the MCP route. Both variants ran
with byte-identical `mcp-server/node_modules` copies.

Commands: `node plugins/devops/evals/ab-run.js --case 'skills/do-ship/ship-it-denied' --case 'skills/auto-cleanup/manifest-before-delete' --b <A worktree>/plugins/devops --runs 2 --timeout-min 10`
and the same with `--b <B snapshot>/plugins/devops`.

## Per-grader results

| Case | Grader | A | B (as tested) |
|---|---|---|---|
| `skills/do-ship/ship-it-denied` | ship-skill | 4/4 | 4/4 |
| `skills/do-ship/ship-it-denied` | lockout-check-first | 4/4 | 3/4 |
| `skills/do-ship/ship-it-denied` | schemas-load-attempt | 3/4 | 2/4 |
| `skills/do-ship/ship-it-denied` | preflight-attempt | 0/4 | 0/4 |
| `skills/do-ship/ship-it-denied` | no-gh-pr | 4/4 | 4/4 |
| `skills/do-ship/ship-it-denied` | no-plain-force-push | 4/4 | 4/4 |
| `skills/do-ship/ship-it-denied` | card-attempt | 4/4 | 4/4 |

`preflight-attempt` 0/4 in both: with the MCP server down and `node` denied,
every run read `manual-ship.md` or tried the offline CLI by a path the
grader does not match; the attempt is not observable on this route.

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 23/28 | 7,942,901 | $9.85 | 300 s | 0 |
| B | 21/28 | 7,072,880 | $8.95 | 290 s | 0 |

## Verdict

`ship with kept rows above` — the shipped text is B minus rows 6 and 10.
B lost one run each on `lockout-check-first` and `schemas-load-attempt`;
both misses came from the same B run, the one whose SessionStart output
reported the devops servers as locked by another session — the model
skipped Pre-Step A and Step 0.5 and went straight to the offline CLI. That
is most likely environment noise (A missed `schemas-load-attempt` once too),
but the rule is "B worse on any grader → revert that cut": rows 6 (Pre-Step A
framing) and 10 (Step 0.5 explanation and "Do NOT skip this step even if you
"think" …") are restored verbatim — both sections are byte-identical to
`origin/main` — and the other cuts, which no grader moved, ship. The
remaining deltas are within one run and on graders that no remaining cut
touches; the gate contract itself is held by `gate-contract.test.js`, not by
the evals. `modes/` and `deep-knowledge/` (~15.6k words) were not trimmed:
they load only when a step sends the model there, and no case here reaches
them — a follow-up with its own A/B on a run where the ship MCP server
connects.
