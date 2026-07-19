---
name: devops-tune-harden
version: 0.2.0
description: >-
  Stabilization pass: run the full test suite, fix bugs autonomously, identify
  architecture smells, write regression + missing-coverage tests, apply
  consistency fixes (spacing, tokens, typography, icons, colors, state-visuals)
  across the codebase. Does NOT introduce new UI elements, new buttons,
  re-arrangements, or substantial position changes — those belong to
  /devops-tune-polish. Triggers on: "harden", "stabilize", "härten",
  "stabilisieren", "bug pass", "consistency pass", "lint und fix".
  Skips all confirmations when invoked with --autonomous.
  Do NOT trigger for: feature work, new UI structure, theme changes.
argument-hint: "[--autonomous] [--invoked-by=agents|autonomous] [optional scope: file/dir path]"
allowed-tools: Agent, Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Tune Harden — Stabilization Pass

Harden the codebase: tests, bugs, architecture, and consistency — without
restructuring the UI. Scope: `$ARGUMENTS`.

## Invocation Context

This skill can be invoked in three ways:

1. **Direct** — user types `/devops-tune-harden` or trigger phrase. Full skill
   runs as documented below. Asks questions when `$AUTONOMOUS=0`.
2. **From `/devops-run-agents`** — orchestrator detected a harden-style request.
   Per `deep-knowledge/agent-orchestration.md` § Single-Agent Shortcut,
   the orchestrator delegates directly to this skill (no wave model, no
   sub-branching). Pass `--invoked-by=agents`.
3. **From `/devops-run-autonomous`** — autonomous skill primed permissions,
   confirmed the user, and now delegates a harden task. Pass
   `--invoked-by=autonomous` (which implies `--autonomous`).

When `--invoked-by` is set, the skill adjusts:
- **No qa-agent re-spawn** if the parent already runs a qa wave/agent.
  Rely on the parent's qa result, request a focused re-test only after fixes.
- **No redteam re-spawn** if the parent has a redteam wave planned.
  Skip Step 9 redteam, flag for parent's wave instead.
- **No permission priming** assumed — parent handled it.
- **AskUserQuestion suppressed** (autonomous implied) when parent is
  `autonomous`; when parent is `agents`, respect the parent's
  interactive/background mode.

The parent passes its mode via an additional flag when needed:
`--parent-mode=background` or `--parent-mode=interactive`.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before
reading. Skip missing files silently.

1. Global: `~/.claude/skills/devops-tune-harden/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/devops-tune-harden/SKILL.md` + `reference.md`
3. Merge order: project > global > plugin defaults

Project extensions can add framework-specific consistency rules (e.g. design
token catalog, allowed spacing values, brand colors).

## Step 1 — Parse Arguments

Scan `$ARGUMENTS` for:

- `--autonomous` flag → set `$AUTONOMOUS=1`. Skips ALL `AskUserQuestion` calls
  for the rest of the run.
- `--invoked-by=agents|autonomous` → set `$PARENT_SKILL`. Adjusts behavior
  per "Invocation Context" above (skip parent-owned phases, no permission
  priming assumed). `--invoked-by=autonomous` implicitly sets `$AUTONOMOUS=1`.
- `--parent-mode=background|interactive` → only relevant with
  `--invoked-by=agents`. Background acts like `--autonomous`; interactive
  keeps prompts (parent expects user engagement).
- Any remaining tokens → treat as scope path(s). If present, restrict the
  entire run to those paths.

## Step 2 — Scope Selection

If `$AUTONOMOUS=1` AND no explicit scope was passed → default to **worktree
changes** (don't ask, don't go repo-wide).

Otherwise ask via `AskUserQuestion`:

```
question: "Was soll gehärtet werden?" (de) / "What should be hardened?" (en)
header: "Scope"
options:
  - "Aktuelle Branch-/Worktree-Änderungen" / "Current branch/worktree changes"
    (default — git diff vs. main)
  - "Ganzes Repository" / "Whole repository"
    (full scan — slower, broader)
```

Resolve `$SCOPE_FILES`:
- Worktree mode: `git diff --name-only origin/main...HEAD` ∪ `git status --porcelain` (modified + untracked tracked files)
- Repo mode: all tracked source files (exclude generated/vendor/node_modules)

If `$SCOPE_FILES` is empty (clean branch, no changes vs. main) and the user
chose worktree mode → fall back to "files touched in the last 10 commits"
and inform the user.

## Step 3 — Kick off Test Plan + QA Agent (parallel)

Two things happen in parallel — do NOT block on either:

1. **Invoke `/devops-test-plan`** (via the `Skill` tool) to get the deterministic
   tool-chain for this project. Store result as `$TEST_PLAN`.
2. **Spawn `qa` agent** in background — SKIP this when `$PARENT_SKILL=agents`
   AND a qa wave is already planned/running (the orchestrator owns qa).
   When skipped, defer to parent's qa output and request a focused re-test
   after fixes (Step 9 step 2).

   Otherwise:
   ```
   Agent(subagent_type="devops:qa", run_in_background=true,
         description="Test pass for harden",
         prompt="Run the full test plan for this project: build, unit tests,
                 integration tests, E2E if available. Report PASS/FAIL counts
                 + every failure with file:line + error message. Do NOT
                 attempt fixes — only report. Scope: <SCOPE_FILES summary>.")
   ```
   The qa agent reports back when done. Continue with Step 4 immediately.

## Step 4 — Findings Scan (parallel research)

While qa runs in background, scan `$SCOPE_FILES` for actionable issues.
Spawn ONE `Explore` agent per concern (parallel — single message, multiple
Agent calls):

1. **Bug-hunt scan** — search for: TODO/FIXME/XXX/HACK comments referencing
   real issues, swallowed exceptions (`catch {}`), null/undefined hot-paths
   without guards, off-by-one patterns, race-condition smells (await-in-loop
   without sequential intent), forgotten cleanup (timers, listeners,
   subscriptions).
2. **Architecture smells** — duplicated code blocks (>10 lines repeated ≥2x),
   dead exports (declared, never imported), god-functions (>80 LoC),
   circular imports, feature-envy patterns, missing error paths on
   external I/O.
3. **State-visual gaps (UI)** — interactive elements missing :hover, :focus,
   :focus-visible, :disabled, :active states; buttons without aria-labels;
   forms without loading/error/empty states; animations >300ms without
   `prefers-reduced-motion` respect.
4. **Consistency drift** — extract all spacing/padding/margin/font-size/
   color/border-radius/box-shadow values used in `$SCOPE_FILES`; build
   frequency histograms; flag outliers (used <20% as often as the
   dominant value in the same category). Cross-reference with any design
   token file found via Glob (`**/tokens.*`, `**/theme.*`, `**/_variables.*`).
5. **Coverage gaps** — for every public function/class/route in
   `$SCOPE_FILES`, check whether it's referenced by ANY test file. Flag
   uncovered functions whose static complexity > trivial.

Each Explore agent returns a short findings list (file:line + 1-line
description + suggested action category).

## Step 5 — Bug-Fix Phase

For every concrete bug from Step 4 (#1) AND any failure reported by the
background qa agent:

1. **Confidence-score the fix** per `deep-knowledge/harden-polish-shared.md`
   § 1 (Confidence Score 0–100, thresholds 80/50). Inputs: tests cover
   path, reversibility, blast radius, contract impact.
2. **Hard-Floor check** per `harden-polish-shared.md` § 2: if the fix
   touches database schema, force-pushes, secrets, dependency versions,
   build/CI config, or public API exports → NEVER auto-apply regardless
   of score. Route through Step 7 (Architecture) instead.
3. Apply per tier:
   - **Score ≥ 80**: auto-fix.
   - **Score 50–79**: auto-fix when `$AUTONOMOUS=1` or diff ≤ 80 LoC.
     Otherwise plan + confirm. Always include score breakdown in report.
   - **Score < 50**: DO NOT auto-fix. Route through Step 7.
4. For each auto-fix:
   - Run the inline pre-mortem from `deep-knowledge/pre-mortem.md`
     focused on: "Which other callers rely on this behavior?"
   - Apply the fix with the smallest possible diff.
   - Write a **regression test** that fails without the fix and passes
     with it — colocated with existing tests. If the project has no
     test setup at all for this layer, skip the regression test and
     flag it for Step 6.
5. After the bug batch, spawn `code-simplifier` agent over the touched
   files:
   ```
   Agent(subagent_type="code-simplifier:code-simplifier",
         description="Simplify post-fix",
         prompt="Review the recently modified files in <list>. Look for:
                 dead code introduced by the fixes, duplicated patterns
                 across fixes that could share a helper, over-eager error
                 handling. Apply minimal cleanups only. Report what changed.")
   ```

## Step 6 — Coverage Phase: Tests for Critical Paths

From Step 4 (#5), pick the top N uncovered functions/paths by criticality
per `deep-knowledge/harden-polish-shared.md` § 4:
- **Primary**: name/role heuristic (`fetch*`, `save*`, `auth*`, `pay*`,
  `migrat*`, `*Handler`, `*Resolver`, etc.).
- **Secondary**: cognitive complexity (preferred — SonarSource 2017+).
  Fallback to cyclomatic complexity > 4.
- **Tertiary**: call-graph centrality (when tooling allows; otherwise skip).
- N = min(10, count(critical_uncovered)) for worktree scope; min(25, ...)
  for repo scope.

For each, write a focused unit test:
- Happy path + at least 2 edge cases (empty/null/boundary).
- Use the project's existing test framework (from `$TEST_PLAN`).
- Place next to existing tests for the same module (mirror convention).
- If the project has no test setup → DO NOT scaffold one. Report
  "Coverage gap, no test framework configured" and skip.

## Step 7 — Architecture Phase

For every Step 4 (#2) finding + every Score < 50 OR Hard-Floor item from Step 5:

1. **Confidence-score** per `deep-knowledge/harden-polish-shared.md` § 1.
2. **Hard-Floor check** per § 2 — DB schema, force-push, secrets, deps,
   build/CI, public API → never auto, always plan+confirm or skip+flag.
3. Decide per tier:
   - **Score ≥ 80** AND no hard-floor: apply the refactor. One-line
     rationale in report.
   - **Score 50–79**: plan + confirm via `AskUserQuestion` with options
     `Apply` / `Skip` / `Defer to issue`. When `$AUTONOMOUS=1`, default
     to skip + flag.
   - **Score < 50** OR hard-floor: skip + flag under "Manual review
     required" with score breakdown.

4. For "Defer to issue" answers → call
   `mcp__plugin_devops_dotclaude-issues__match_issues` to check for an
   existing issue; if none, suggest creating one via `/devops-setup-issue`.

## Step 8 — Consistency Phase

From Step 4 (#3 state-visuals) and (#4 consistency drift):

1. **State-visuals** — auto-fix every gap (add `:hover`, `:focus-visible`,
   `:disabled`, `aria-label`, missing loading/error/empty UI states using
   existing patterns from the codebase). These are functional UI fixes,
   never structural.

2. **Consistency drift** — apply the math from
   `deep-knowledge/harden-polish-shared.md` § 3 (Ordinal vs. Categorical):
   - **Ordinal** (spacing/padding/margin/gap/font-size/line-height/radius):
     median + IQR. Outlier = `|value − median| > 1.5 × IQR`. Snap to
     nearest token (if catalog) or to the median.
   - **Categorical** (color/background/font-family/font-weight names/
     shadow tokens): mode (most-frequent). Snap to token (if catalog)
     or to mode. Tie-breaker (within 10%): flag for manual review.
   - **Auto-snap** when: token-anchored AND clean resolution, OR no
     catalog AND (categorical: ≥ 70% dominance, ordinal: outlier
     count ≤ 3). Otherwise plan + confirm (unless `$AUTONOMOUS=1`,
     then skip + flag).

3. **Hardcoded → token migration** (when a token catalog exists):
   Replace literal values that have a matching token, drive-by while
   editing other consistency fixes in the same file. Do NOT do a
   repo-wide migration sweep — that's a polish-level decision.

**Hard never (this skill):**
- Add a new button, input, link, or other interactive element.
- Move an interactive element to a different parent/section.
- Reorder visible elements (rows, columns, list order in the DOM).
- Change overall layout structure (sidebar → top, grid → list, etc.).
- Apply a different theme or color scheme.
- Add tooltips/help-text/onboarding where none existed.

If a finding requires any of the above → flag it as "Polish-candidate"
in the final report. Do not act.

## Step 9 — Re-test + Pre-Mortem

1. **Wait** for the background qa agent (Step 3) to finish if it hasn't yet.
   Capture its result.
2. **Re-run tests** on the touched scope (use `$TEST_PLAN` — fastest
   tier first, e.g. unit before E2E). If anything regressed: open the
   regression as a high-priority finding, attempt fix (back to Step 5
   for that one file). Cap at 2 retry loops per file.
3. **Red-team pass** — SKIP when `$PARENT_SKILL=agents` AND a redteam wave
   is planned (parent owns it; flag findings for parent's wave instead).
   Otherwise spawn `redteam` agent on the cumulative diff:
   ```
   Agent(subagent_type="devops:redteam",
         description="Red-team harden diff",
         prompt="Review the diff of this harden pass: <changed files>.
                 Find: regressions in untouched callers, partial-failure
                 modes introduced by new error handling, race conditions
                 added by async refactors, consistency fixes that change
                 perceived behavior (e.g. a button now has hover where
                 users may have relied on its lack). Report concrete risks
                 with file:line. Do NOT fix.")
   ```
4. For every redteam finding → run the Step 5 risk-classifier. Apply
   low-risk follow-ups inline. Add medium/high to the report.

## Step 10 — Output

Count actionable items resolved + outstanding.

- If **outstanding ≤ 5** OR `$AUTONOMOUS=1` → completion-card only.
- If **outstanding > 5** AND `$AUTONOMOUS=0` → completion-card + concept page.

### Completion Card

Call `mcp__plugin_devops_dotclaude-completion__render_completion_card`:

| Outcome | Variant |
|---------|---------|
| Things changed, tests green, no high-risk open items | `ready` |
| Things changed, but user-facing testing recommended | `test` (include `userTest` steps) |
| No fixes applied, only findings reported | `analysis` |
| Aborted early (e.g. tests catastrophically broken before fixes) | `aborted` |

Pass: `variant`, `summary` (one line, e.g. "Harden — 8 bugs fixed, 12
consistency fixes, 3 tests added, 2 polish-candidates flagged"), `lang`,
`session_id`, `changes` (file:line entries grouped by category), and
`state` when files changed.

Output the returned markdown VERBATIM as the LAST thing in the response —
nothing after the closing `---`.

### Optional Concept Page (>5 outstanding)

If outstanding items > 5 AND interactive mode: generate a concept page
following the concept scaffold in
`skills/devops-concept/deep-knowledge/templates.md` (design system, panel,
cards — the authoritative source, referenced by name not by concept's step
numbers), with three filter sections:
- **"Polish-candidates"** — flagged in Step 8
- **"Manual review (architecture)"** — Step 7 high-risk skips
- **"Coverage gaps without test framework"** — Step 6 skips

Each card: file:line, what was found, what's blocked, suggested next
step (e.g. "Run /devops-tune-polish for this", "Open issue", "Add test setup").

No follow-up loop — this page is read-only output; the user acts on it
or dismisses it.

## Rules

- **No new features.** Ever. Even tiny ones. If it isn't a fix, a test,
  a consistency snap, a state-visual addition, or a non-structural refactor
  → it doesn't belong in `/devops-tune-harden`.
- **No structural UI changes.** See "Hard never" in Step 8.
- **Tests first, then refactor** — never restructure code that has zero
  test coverage on its current behavior without writing the missing tests
  first (or routing to plan-approval).
- **Pre-mortem inline** for every non-trivial fix (see `deep-knowledge/pre-mortem.md`).
- **`--autonomous` is mute mode**, not yolo mode. High-risk items are still
  skipped + flagged — autonomous never escalates risk tolerance.
- **Surface polish-candidates explicitly** so the user can run `/devops-tune-polish`
  as a natural follow-up.
- **Never commit automatically** — this skill modifies files; the user
  commits via `/devops-commit` or `/devops-ship`.
