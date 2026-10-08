# Skill trim record — `auto-issue`

Filled from `TRIM-TEMPLATE.md`. Variant A = the skill's text before the trim,
variant B = the trimmed text.

## Skill

| Field | Value |
|---|---|
| Skill | `devops:auto-issue` (`plugins/devops/skills/auto-issue/`) |
| Files | `SKILL.md` + `deep-knowledge/{issue-rules,milestone-rules}.md` |
| Issue | #652 (umbrella #644) |
| Words before (A) | 3046 (`wc -w` at `origin/main` 499cdd2f) |
| Words after (B) | 2674 (−12 %) |
| Variant A | `origin/main` (sha `499cdd2f`), plugin dir from a detached worktree |
| Variant B | working tree of `refactor/652-trim-medium-skills`, snapshot copy of `plugins/devops` |
| Runs per variant | 2 |
| Results dir | `<scratchpad>/results-A2/ab-*`, `<scratchpad>/results-B-issue2/ab-*` (not committed) |

## Removed instructions

| # | Excerpt (removed text) | Reason for removal | A/B result |
|---|---|---|---|
| 1 | "the caller already made the decisions (or runs under a zero-prompt invariant) and a question here is a UX regression" | rationale; the rule ("no AskUserQuestion fires") stays | `bug-with-marker::create-attempted` |
| 2 | Step 0 "Use **Glob** to verify each path exists … Do NOT call Read on files that may not exist" | hand-holding; one clause kept ("skip missing files silently") | not covered |
| 3 | Target repo "**An issue silently created in the wrong repo is worse than none** — it looks successful, returns a valid URL …" | emphasis; one-line why kept | not covered (no target_repo in the case) |
| 4 | Step 1a bullets "Fails the gate → do NOT create it. Bundle …" and "Milestones may aggregate issues …" | duplicates of issue-rules.md (Bundling rule, What remains fine) | `bug-with-marker::user-value-line` |
| 5 | "The body MUST include the user-value line (see …)" | duplicate of Step 1a and the example; kept as one plain sentence | `bug-with-marker::user-value-line` |
| 6 | Step 3 board-guard rationale paragraph (cross-repo items, slug pass-through) | compressed to one sentence each; condition unchanged | not covered |
| 7 | Step 4 item 5 "callers pass through whatever casing their metadata carries — a case-sensitive check would fail a correctly filed issue" | rationale; case-insensitive rule kept | not covered |
| 8 | R3 repeated "same `gh issue edit … # via auto-issue` form" ×3 and the closing marker paragraph | duplicated marker rule; one lead sentence carries it | not covered (refine path) |
| 9 | Rules: user-value gate, refine-only-own-section, `[FIX]`, `Closes #NNN`, milestone re-evaluation | duplicates of Step 1a / R2 / issue-rules.md / milestone-rules.md; `[FIX]` moved into Step 1's Title line | `bug-with-marker::bug-title` |
| 10 | issue-rules.md "Anti-pattern (never)" paragraph and CAPS in the gate heading | duplicate of the bundling rule / emphasis | not covered |

## Kept instructions that looked prescriptive

| # | Excerpt (kept text) | Why kept |
|---|---|---|
| 1 | `# via auto-issue` marker paragraph + "Never pass the body on stdin via a heredoc" | `pre.issue.guard` contract (`issue-guard-match.test.js`); the heredoc rule prevents a known block |
| 2 | Step 0 fallback line (`setup-issue/`) | pinned by `skill-contracts.test.js` (extension paths) |
| 3 | Step 4 "Missing required items = hard error", R3 verify list | gate semantics |
| 4 | Step 5 card + "VERBATIM as the LAST thing"; hand-over returns without a card | stop-hook card contract |
| 5 | Target repo label check incl. `type:*` | `gh issue create` hard-fails on unknown labels |

## Eval cases used

| Case | Graders | Why this case |
|---|---|---|
| `skills/auto-issue/bug-with-marker` | `issue-skill`, `create-attempted`, `via-marker`, `bug-title`, `user-value-line`, `no-stdin-body` (graders.js) | the create path's observable output is the `gh issue create` command; real writes are denied, the command is graded |

## Per-grader results

| Case | Grader | A | B |
|---|---|---|---|
| `skills/auto-issue/bug-with-marker` | issue-skill | 2/2 | 2/2 |
| `skills/auto-issue/bug-with-marker` | create-attempted | 2/2 | 2/2 |
| `skills/auto-issue/bug-with-marker` | via-marker | 2/2 | 2/2 |
| `skills/auto-issue/bug-with-marker` | bug-title | 2/2 | 2/2 |
| `skills/auto-issue/bug-with-marker` | user-value-line | 2/2 | 2/2 |
| `skills/auto-issue/bug-with-marker` | no-stdin-body | 2/2 | 2/2 |

## Summary

Tokens = input + output + cache read/creation, summed over the runs.

| Variant | Pass rate (all graders) | Tokens | Cost | Mean duration | Errors |
|---|---|---|---|---|---|
| A | 12/12 | 2,485,782 | n/a (timeout) | 480 s | 2 timeouts (graded from stream) |
| B | 12/12 | 2,760,637 | n/a (timeout) | 480 s | 2 timeouts (graded from stream) |

## Verdict

`ship` — 12/12 → 12/12, graded from partial streams: all four runs (A and B)
hit the 8-min timeout after the graded `gh issue create` attempt. In
`claude -p --no-session-persistence` there is no transcript, so
`pre.issue.guard` cannot see the skill invocation and blocks the marked
write; the model then debugged the guard until the timeout (identical in
both variants). The runner grades a timeout as `null`, so the runs were
regraded from their saved streams — every grader reads only the command
already sent. The case prompt now says to report a blocked write and stop.
The refine path and `target_repo` have no case; those cuts are rationale
and duplicates, the marker, heredoc and verify rules stay.
