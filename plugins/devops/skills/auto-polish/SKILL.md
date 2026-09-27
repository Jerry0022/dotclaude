---
name: auto-polish
version: 0.5.0
description: >-
  UI refinement pass: visual consistency (spacing, tokens, typography, icons,
  colors), state-visuals, UI-side functionality checks, the standing UI
  rules from {PLUGIN_ROOT}/deep-knowledge/ui-defaults.md (app style, tooltips, dropdowns,
  spacing, hotkeys, scrollbars), and small demonstrably UI-related backend fixes. Structural UI
  changes only with user approval; `--autonomous` skips prompts but keeps
  the "structural changes flagged not applied" rule. `--invoked-by=ship` is
  the narrow rules-only path /do-ship calls: static checks on the diff, no
  agents, no browser, report-only. Triggers on: "polish", "ui polish", "ui
  angleichen", "design konsistenz", "feinschliff", "visuell aufräumen",
  "design pass". Do NOT trigger for: backend-only work, feature
  implementation, theme/style overhaul.
layer: 4
invokes: [auto-agents]
user-invocable: false
triggers:
  en: ["polish", "ui polish", "design pass"]
  de: ["ui angleichen", "design konsistenz", "feinschliff", "visuell aufräumen"]
argument-hint: "[--autonomous] [--strict] [--invoked-by=do-run|ship] [--cwd=<path>] [optional scope: file/dir path]"
allowed-tools: Agent, Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__Claude_in_Chrome__*, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Tune Polish — UI Refinement Pass

Refine the UI: consistency, visual polish, state-visuals, and UI-side
functionality — with user approval for structural changes. Scope: `$ARGUMENTS`.

## Invocation Context

Same callers as `/auto-harden` — the user, `/do-run` and `/do-ship`, all
above this skill in the call graph. `/auto-agents` (layer 5) never calls it;
it is the layer this skill *executes through*.

1. **Direct** — user asks for it (trigger phrase; the skill is hidden from the slash menu).
2. **From `/do-run`** (every run that touched UI files — no longer a
   question) — `--invoked-by=do-run`, a full pass scoped to the run's
   changes, executed through auto-agents (§ Execution); without UI files in
   scope it self-skips (Step 2).
   Under "Autonom" do-run adds `--autonomous` (no prompts; structural changes
   always flagged, never auto-applied); under "Strikt" it adds `--strict`.
   Skip self-spawned qa/redteam when the parent owns those waves. The
   pre-PR-2 values `--invoked-by=agents` and `--invoked-by=autonomous` (the
   latter implies `--autonomous`) are read as `do-run`.
3. **From `/do-ship`** — pass `--invoked-by=ship` plus the diff's UI files as
   scope. This is the **rules-only path**: it runs nothing but the static
   halves of the UI rules (Step 4 #8) over the given files and returns a
   findings list to the caller. No test plan, no qa/redteam agents, no
   browser, no fixes, no completion card. See § Rules-only path (ship).
   /do-ship calls `/auto-harden --invoked-by=ship` at the same step.
4. **Under strict** — `--strict` (do-run "Strikt", /do-ship under strict
   mode, or the `[claude-strict contract]` in context): only the named scope
   changes; wider findings are reported, never fixed. The ship path is
   report-only anyway — /do-ship then applies none of its mechanical fixes.

## Execution — through auto-agents

The changes of a full pass (Steps 5–10) run through `/auto-agents`, the
single execution path: `Skill("auto-agents", "--from=auto-polish --mode=<m> <change list>")`
with `--mode=background` under `--autonomous`, else `--mode=interactive`.
Read its result block (`tier`, `done`, `open`, `needs-decision`, `ship`) and
**ignore `ship`** — this skill never ships. **Inline shortcut:** when your own
tier check lands on Inline (one domain, ≤ ~5 files), apply the changes
yourself without loading auto-agents. Read-only helpers (scout scans, qa,
redteam, designer consults) stay direct `Agent` spawns. The rules-only path
never loads auto-agents.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before
reading. Skip missing files silently.

1. Global: `~/.claude/skills/auto-polish/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/auto-polish/SKILL.md` + `reference.md`
   Fallback (pre-PR-2 name): where `auto-polish/` does not exist, read `~/.claude/skills/tune-polish/` / `{project}/.claude/skills/tune-polish/` instead — an extension written before the rename keeps working.
3. Merge order: project > global > plugin defaults

Project extensions can declare:
- Allowed design tokens (spacing scale, color tokens, typography ramp)
- Brand rules (forbidden hardcoded colors, required icon sizes)
- Layout conventions (button positions, form patterns)
- **`## UI rules`** — overrides for the standing UI rules: disabled rule
  ids, extra tooltip/hotkey/menu detection patterns, extra UI file globs and
  free-form project rules. Format in `{PLUGIN_ROOT}/deep-knowledge/ui-defaults.md`
  § Project override.

4. Standing UI rules: read `{PLUGIN_ROOT}/deep-knowledge/ui-defaults.md` and
   merge the `## UI rules` override on top (project > global). The merged
   set is `$UI_RULES`; a rule disabled by an override stays in the set as
   *disabled* so the output can name it.

## Step 1 — Parse Arguments

Scan `$ARGUMENTS` for:

- `--autonomous` flag → set `$AUTONOMOUS=1`. Skips ALL `AskUserQuestion`
  calls. Structural changes are STILL not auto-applied — they get flagged
  in the final report. Autonomous is mute mode, not yolo mode.
- `--invoked-by=do-run|ship` → set `$PARENT_SKILL`. See "Invocation
  Context". Legacy values: `agents` → `do-run`; `autonomous` → `do-run` +
  `$AUTONOMOUS=1`. `--invoked-by=ship` sets `$RULES_ONLY=1` and jumps to
  § Rules-only path (ship) right after Step 2 — Steps 3 and 5–12 do not run.
- `--strict` → set `$STRICT=1`: nothing outside the named scope changes;
  wider findings go to the report. Also set when the `[claude-strict
  contract]` block is in this turn's context.
- `--cwd=<path>` → the target checkout (a composed /do-ship `--cwd`, e.g.
  from auto-cleanup). It scopes the diff, the files read and every fix the
  caller applies from the findings: git runs as `git -C <path>`, scope paths
  resolve against `<path>` — never this session's own checkout. Absent → the
  session's cwd.
- `--parent-mode=background|interactive` → pre-PR-2 flag, still read:
  background acts like `--autonomous`.
- Any remaining tokens → treat as scope path(s).

## Step 2 — Scope Selection

If `$AUTONOMOUS=1` AND no explicit scope → default to **worktree changes**.

Otherwise ask via `AskUserQuestion`:

```
question: "Was soll poliert werden?" (de) / "What should be polished?" (en)
header: "Scope"
options:
  - "Aktuelle Branch-/Worktree-Änderungen" / "Current branch/worktree changes" (default)
  - "Ganzes Repository (UI-Code)" / "Whole repo (UI code only)"
```

Resolve `$SCOPE_FILES`:
- Worktree mode: `git diff --name-only origin/main...HEAD` filtered to
  UI-relevant extensions (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`,
  `.css`, `.scss`, `.sass`, `.less`, `.styled.*`, component files in
  framework conventions) ∪ uncommitted changes (same filter).
- Repo mode: all tracked UI files.

If `$SCOPE_FILES` empty:
- `--invoked-by=do-run` (or its legacy values) → **self-skip**: no agents,
  no card — return `{ applicable: false, reason: "no UI files in diff" }` to
  the caller and stop. The run touched no UI (same detection as the ship
  path, `{PLUGIN_ROOT}/deep-knowledge/ui-defaults.md` § UI file detection
  plus the override's `files:`), and the run contract owes no Polish then.
- Direct invocation → fall back to the last 10 commits' UI changes and
  inform the user.

## Step 3 — Kick off Test Plan + UI-QA Agent (parallel)

In parallel — do NOT block:

1. **Determine UI test tools per `{PLUGIN_ROOT}/deep-knowledge/test-plan.md`** (browser
   preview, Playwright, snapshot tests, multi-viewport setup). Store as
   `$TEST_PLAN`.
2. **Spawn `qa` agent** in background — SKIP when `$PARENT_SKILL=do-run`
   AND a qa wave is already planned (parent owns qa). Otherwise:
   ```
   Agent(subagent_type="devops:qa", run_in_background=true,
         description="UI test pass for polish",
         prompt="Verify the UI: build, run UI snapshot tests if present,
                 take screenshots of changed routes/components per
                 $TEST_PLAN (phone/tablet/desktop if multi-viewport).
                 Report: build PASS/FAIL, snapshot diffs, visible console
                 errors, layout shifts, accessibility violations from
                 axe-core if available. Do NOT fix — only report.")
   ```

## Step 4 — Findings Scan (parallel research)

Spawn parallel `devops:scout` agents (single message, multiple Agent calls),
one per concern: #1 state-visuals gaps · #2 consistency drift (extended) ·
#3 hardcoded → token candidates · #4 UI functionality gaps · #5 backend
UI-impact issues (the ONLY backend-touchable items) · #6 structural smells
(proposals only, never auto-applied) · #7 component-level architecture ·
#8 standing UI rules R0–R6 (`{PLUGIN_ROOT}/deep-knowledge/ui-defaults.md`). What each scan
looks for: `deep-knowledge/findings-scan.md` (this skill's directory).

## Rules-only path (ship) — `$RULES_ONLY=1`

Runs instead of Steps 3 and 5–12 when `--invoked-by=ship` (Step 4 is reduced
to its item #8, run inline): the **static** halves of the standing UI rules
over the UI files /do-ship passed — no agents, no browser, **never fixes**,
no card. Empty scope or no UI profile → `{ applicable: false, reason }`.
It returns a findings list and the caller decides what to apply. Scope,
checks, return shape: `deep-knowledge/rules-only-path.md`.

## Steps 5–10 — Fix phases

Each phase takes its Step 4 findings; the procedure per phase is in
`deep-knowledge/fix-phases.md`.

| Step | Findings | Rule |
|---|---|---|
| 5 State-Visuals + Auto-Consistency | #1, #3, single outliers of #2 | applied without prompting (invisible hygiene) |
| 6 Pattern Consistency | #2 without a clear-cut distribution | decide when confident, else `designer` agent; >10 files interactive → confirm; autonomous + unsure → defer |
| 7 UI-Functionality Fixes | #4 | confidence score (`harden-polish-shared.md` § 1–2): ≥ 80 auto, 50–79 auto ≤ 80 LoC, else confirm / skip+flag |
| 8 UI-Adjacent Backend Fixes | #5 | only with proven UI causation in scope; anything else → Harden-candidate |
| 9 Frontend Architecture | #7 | same score tiers; component-library swap never |
| 10 Structural UI Proposals | #6 | **never auto-applied**: ≤ 3 → `AskUserQuestion`, > 3 → concept page; autonomous → flagged only |

## Step 11 — Re-test + Pre-Mortem

Runtime halves of the UI rules (when a browser tool exists), then wait for
the qa agent, re-run UI tests per viewport, review visual diffs, and a
`redteam` pass — skipped when `$PARENT_SKILL=do-run` and the parent owns a
redteam wave. Procedure: `deep-knowledge/retest-and-output.md`.

## Step 12 — Output

Count: items applied / items flagged for user (structural) / items skipped.

### Completion Card

`mcp__plugin_devops_dotclaude-completion__render_completion_card`:

| Outcome | Variant |
|---------|---------|
| Polish applied, user-facing testing recommended (it's UI work) | `test` (almost always — include `userTest` steps with viewports) |
| Polish applied, no structural changes pending, no test viewer | `ready` |
| Only findings, nothing applied (all skipped or flagged) | `analysis` |
| Aborted | `aborted` |

Pass: `variant`, `summary` (e.g. "Polish — 24 consistency fixes, 6 state-
visuals, 4 token migrations, 3 structural proposals pending"), `lang`,
`session_id`, `changes` (grouped: state-visuals / tokens / consistency /
ui-fn / backend / architecture / structural-pending), and `state`.

Output the returned markdown VERBATIM as the LAST thing.

### Concept Page (when needed)

When more than 3 structural proposals (Step 10) or more than 5 deferred
items: a concept page per `deep-knowledge/retest-and-output.md` § Concept Page.

## Rules

- **UI-first** — every change is justified by a UI benefit. Backend
  only when UI demonstrably suffers.
- **Structural changes ALWAYS need approval.** `--autonomous` flags
  them, never applies.
- **`--strict` narrows, never widens.** Only the named scope changes; a
  finding outside it is reported, not fixed.
- **Token-first** — when a design token catalog exists, prefer tokens
  over dominant-value-snap. Tokens are intent; dominance is accident.
- **Multi-viewport verify** — for web apps, never declare done without
  phone/tablet/desktop snapshots (per `{PLUGIN_ROOT}/deep-knowledge/responsive-testing.md`).
- **Pre-mortem inline** for every change touching shared components
  (see `{PLUGIN_ROOT}/deep-knowledge/pre-mortem.md`).
- **Surface harden-candidates explicitly** — backend-only findings get
  flagged for `/auto-harden`, not silently dropped.
- **Never commit automatically** — the user decides when to commit.
