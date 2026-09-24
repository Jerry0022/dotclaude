---
name: auto-polish
version: 0.5.0
description: >-
  UI refinement pass: visual consistency (spacing, tokens, typography, icons,
  colors), state-visuals, UI-side functionality checks, the standing UI
  rules from deep-knowledge/ui-defaults.md (app style, tooltips, dropdowns,
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
2. **From `/do-run`** ("Polish danach") — `--invoked-by=do-run`, a full pass
   scoped to the run's changes, executed through auto-agents (§ Execution).
   Under "Autonom" do-run adds `--autonomous` (no prompts; structural changes
   always flagged, never auto-applied); under "Nur das" it adds `--strict`.
   Skip self-spawned qa/redteam when the parent owns those waves. The
   pre-PR-2 values `--invoked-by=agents` and `--invoked-by=autonomous` (the
   latter implies `--autonomous`) are read as `do-run`.
3. **From `/do-ship`** — pass `--invoked-by=ship` plus the diff's UI files as
   scope. This is the **rules-only path**: it runs nothing but the static
   halves of the UI rules (Step 4 #8) over the given files and returns a
   findings list to the caller. No test plan, no qa/redteam agents, no
   browser, no fixes, no completion card. See § Rules-only path (ship).
   /do-ship calls `/auto-harden --invoked-by=ship` at the same step.
4. **Under strict** — `--strict` (do-run "Nur das", /do-ship under strict
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
yourself without loading auto-agents. Read-only helpers (Explore scans, qa,
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
  from /setup-cleanup). It scopes the diff, the files read and every fix the
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

If `$SCOPE_FILES` empty → fall back to the last 10 commits' UI changes
and inform the user.

## Step 3 — Kick off Test Plan + UI-QA Agent (parallel)

In parallel — do NOT block:

1. **Determine UI test tools per `deep-knowledge/test-plan.md`** (browser
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

Spawn parallel Explore agents (single message, multiple Agent calls):

1. **State-visuals gaps** — same as `/auto-harden` Step 4 #3:
   interactive elements missing :hover, :focus, :focus-visible, :disabled,
   :active, aria-label; forms missing loading/error/empty states;
   animations not respecting `prefers-reduced-motion`.

2. **Consistency drift — extended** — extract spacing, padding, margin,
   gap, font-size, font-weight, line-height, color, background, border-color,
   border-radius, box-shadow, icon-size, z-index, letter-spacing. Apply
   the ordinal-vs-categorical math from
   `deep-knowledge/harden-polish-shared.md` § 3:
   - **Ordinal** (size-like, has natural order): median + IQR detection.
   - **Categorical** (palette-like, no order): mode detection.
   Cross-ref with design token catalog (Glob: `**/tokens.*`, `**/theme.*`,
   `**/_variables.*`, `**/design-system/**`, `tailwind.config.*`).
   Token-anchoring always beats raw-stat fallbacks.

3. **Hardcoded → token candidates** — every literal color (`#`, `rgb`,
   `hsl`), every literal spacing (`Npx`, `Nrem` where N matches a token),
   every literal font-size that has a token equivalent.

4. **UI functionality gaps (UI perspective)** — buttons without
   click-handlers (or with empty handlers); forms without validation
   feedback; long-running actions without loading indicators; error
   states without user-visible feedback; routes without empty/loading/
   error UI components when data-fetching is present.

5. **Backend UI-impact issues** — search for backend code paths where
   the UI consumer is in `$SCOPE_FILES` and the backend has: visible
   lag patterns (N+1 queries called from a render loop, blocking I/O in
   request paths, missing pagination on lists that grow), missing fields
   the UI uses (referenced but not in response shape), broken contract
   (UI expects `updatedAt`, API returns `updated_at`). Flag these — they
   are the ONLY backend-touchable items in this skill.

6. **Structural smells (for user approval)** — buttons that visually look
   primary but sit below secondary buttons; destructive actions adjacent
   to confirm actions without separation; long forms without sectioning;
   primary CTAs not in the conventional position for the framework's
   patterns. These NEVER auto-apply — they're proposals only.

7. **Component-level architecture (frontend)** — prop-drilling >3 levels,
   duplicated component logic across siblings, components >300 LoC with
   no internal seams, hook-reuse opportunities (same effect logic in
   3+ components).

8. **Standing UI rules (`$UI_RULES`)** — R0–R5, each with a static and a
   runtime half. `deep-knowledge/ui-defaults.md` (loaded in Step 0) is the
   single source for what each half checks — work from it, not from memory:
   R0 app style · R1 tooltips (app-styled, Info/Label delay tiers) · R2a
   dropdowns styled · R2b uniform menu items · R3 spacing · R4 hotkeys ·
   R5 scrollbars. **R0 is part of every rule**, project rules included.
   Detection uses the allowlist from `ui-defaults.md` merged with the
   override. A rule whose mechanism class has zero matches in the whole
   project (e.g. no hotkey mechanism anywhere) is reported once as *not
   applicable*, never as a batch of failures — except where R0 turns the
   absence itself into the one project-level finding (no app-styled tooltip
   component, no scrollbar style). Only **new or changed**
   elements in scope are findings on the ship path; the full pass may also
   list pre-existing violations, marked as such. R0, R1, R4 and R5 are
   **report-only** (R0: only a literal → token swap is mechanical; R1: a fix
   may only reuse an existing label's text, through the app's tooltip
   component; R4: the key choice is design; R5: thumb/track colours are
   design). A more recent project convention from merged
   PRs beats a generic rule — say so in the finding instead of reporting it.

## Rules-only path (ship) — `$RULES_ONLY=1`

Runs instead of Steps 3 and 5–12 when `--invoked-by=ship` (Step 4 is reduced
to its item #8, run inline). It exists so /do-ship can
measure the standing UI rules on every UI ship without paying for a full
polish pass (agents, browser, viewports).

1. **Scope** = the files /do-ship passed (its diff filtered to UI files),
   resolved against `--cwd` when given (else the session's cwd). Empty
   scope → return `{ applicable: false, reason: "no UI files in diff" }` and
   stop. No UI profile (`test-autonomy.md` profiles `cli-node`, `lib`,
   `generic`) → same, reason `"no UI profile"` — unless a `files:` glob of
   the override names a scope file: that explicit opt-in counts as a UI
   profile for the files it names (how a CLI or plugin repo checks its own UI
   sources).
2. **Check** only the **static** halves of Step 4 #8 (R0, R1, R2a, R2b, R3, R4, R5),
   inline — no Explore agents, no browser, no screenshots. Runtime halves
   are never attempted here; they are listed once as
   `skipped: runtime rules (full /auto-polish)`.
3. **Never fix.** Return a findings list, one entry per finding:
   `{ rule, file, line, element, detail, mechanical: true|false,
   fix?: "<one-line change when mechanical>" }`. `mechanical: true` only when
   the fix needs no invented content (a spacing or colour token swap, an
   existing label reused as tooltip text through the app's tooltip
   component). The caller decides what to apply.
4. **Name the overrides**: `disabled: [ids]` from the project override,
   `notApplicable: [ids]` for mechanism classes absent from the project.
5. **No completion card, no AskUserQuestion, no session-title change** — the
   caller (/do-ship) owns the turn. Hand back the structure and return.

## Step 5 — State-Visuals + Auto-Consistency Phase

Apply ALL of these without prompting (they're invisible visual hygiene):

1. **State-visuals** — auto-add missing `:hover`, `:focus-visible`,
   `:disabled`, `:active`, aria-labels, loading/error/empty UI states
   using existing patterns from the codebase. Reduce-motion respect for
   long animations.

2. **Token migrations** — every hardcoded value with a clean token
   equivalent → replace. No prompt needed; this is mechanical.

3. **Single-outlier consistency snaps** — if a value appears once and
   the surrounding pattern has ≥70% dominance for a different value
   in the same category, snap to dominant. No prompt.

## Step 6 — Pattern Consistency Phase (decisive analysis)

For each category in Step 4 (#2) where the distribution is NOT clear-cut
(bimodal, multi-modal, or no dominant value):

1. **Deeper analysis** — gather context:
   - Component types affected (buttons vs cards vs inputs vs containers)
   - Semantic grouping (is the "outlier" actually a different role?)
   - Design token alignment (does the dominant value match a token?
     Does the minority match a different token?)
   - Recency (is the minority value in newer code, suggesting a deliberate shift?)

2. **Decide autonomously when confident:**
   - Dominant value matches a token AND minority doesn't → snap to dominant.
   - Both match different tokens AND they represent different roles
     (e.g. card-padding vs section-padding) → keep both, document the
     pattern in `$SCOPE_FILES`-local comments only if non-obvious.
   - Minority is in newer code AND is more consistent with the design
     system → migrate dominant TO minority (call this out explicitly
     in the report).

3. **Escalate to `designer` agent when stuck** — when neither pattern
   matches a token, distributions are split, and recency doesn't help:
   ```
   Agent(subagent_type="devops:designer",
         description="Resolve UI consistency conflict",
         prompt="In $SCOPE_FILES, we found conflicting spacing/typo/color
                 patterns: <category> uses <value-A> in N places and
                 <value-B> in M places. No design token catalog covers
                 these. Analyze: which represents the better visual
                 system for this codebase? Look at semantics, hierarchy,
                 brand alignment. Output: recommended value + 2-3 sentence
                 rationale. Do NOT change files.")
   ```
   Apply designer's recommendation. If `$AUTONOMOUS=0` and the change
   affects >10 files: confirm via `AskUserQuestion` with a short summary
   + designer's rationale.

4. When `$AUTONOMOUS=1` AND no confident decision can be made: skip and
   flag in the final report under "Pattern conflicts deferred".

## Step 7 — UI-Functionality Fixes

For Step 4 (#4) findings — apply the confidence-score from
`deep-knowledge/harden-polish-shared.md` § 1 (with Hard-Floor check § 2):

- **Score ≥ 80**: auto-apply (e.g. missing loading indicator using
  existing pattern, error toast via existing toast system, empty state
  copy).
- **Score 50–79**: auto-apply when diff ≤ 80 LoC; otherwise plan + confirm.
  Mention with score breakdown in report.
- **Score < 50 OR hard-floor** (form-submission semantics change, routing
  change, optimistic updates): plan + confirm (`$AUTONOMOUS=0`) or
  skip+flag (`$AUTONOMOUS=1`).

## Step 8 — UI-Adjacent Backend Fixes

For Step 4 (#5) findings ONLY (UI-impact backend):

1. **Confirm UI causation** — for each backend finding, verify it
   actually affects a component in `$SCOPE_FILES`. If the UI consumer
   is outside scope, defer (`/auto-harden` territory).

2. Apply the risk-classifier. Same boundaries: low auto, medium auto +
   mention, high plan+confirm or skip+flag.

3. **Never expand beyond UI-causation** — even if Step 4 (#5) reveals
   a beautiful backend refactor opportunity, if it's not actively
   hurting the UI in `$SCOPE_FILES`, flag it as "Harden-candidate" for
   the final report and stop.

## Step 9 — Frontend Architecture Phase

For Step 4 (#7) findings:

1. **Confidence-score** per `deep-knowledge/harden-polish-shared.md` § 1.
2. **Hard-Floor check** per § 2 (component library swap is also
   blocked here per polish-specific § 2 "Hard-Never-Even-With-Approval").
3. Apply per tier:
   - **Score ≥ 80**: auto (extract one component, dedupe one effect).
   - **Score 50–79**: plan + confirm (`$AUTONOMOUS=0`) — e.g. hook
     extraction across 3+ components, component split, prop-drilling
     resolution via context. Skip + flag when `$AUTONOMOUS=1`.
   - **Score < 50 OR hard-floor**: skip + flag.

## Step 10 — Structural UI Proposals (Step 4 #6 findings)

These NEVER auto-apply. They are proposals for the user.

When `$AUTONOMOUS=0`:
- For ≤3 proposals: ask via `AskUserQuestion`, one decision per proposal,
  with options `Apply` / `Skip` / `Defer to issue`. Include a short
  diff preview in the description (≤2 lines).
- For >3 proposals: build a concept page (see Step 12) with toggles
  per proposal, defer execution to user submit.

When `$AUTONOMOUS=1`:
- Skip all. Add to "Structural changes — manual review" in the final
  report with the proposed change + rationale per item.

**Always allowed only with approval:**
- New buttons / interactive elements
- Repositioning interactive elements (move primary CTA, swap action
  order)
- Re-arrangement (sidebar → top, list → grid, etc.)
- New tooltips / helper text / onboarding hints
- New empty-state copy that goes beyond "no items" → suggests next steps
  (cross-promotion territory)

**Never, even with approval (out of scope)** — see
`deep-knowledge/harden-polish-shared.md` § 2:
- Theme overhaul (dark/light system rewrite, brand color swap)
- Routing changes
- Component library swap

## Step 11 — Re-test + Pre-Mortem

Before the re-test, when a browser tool is available, run the **runtime
halves** of the standing UI rules (Step 4 #8) over the scope: time an Info
and a Label tooltip against their tiers (plus the 300 ms skip delay and
focus-open), open each changed tooltip, menu and scroll container and
compare it to a card/dialog of the app in every theme (R0/R5), measure touch
targets on the phone viewport, and tab-walk every changed view (focus order,
Escape/Enter/arrows, focus ring). Findings follow the same score/approval
rules as every other polish item; R0/R1/R4/R5 stay report-only (R0 token
swaps excepted). Without a browser tool: list them once as skipped in
Step 12.

1. **Wait** for the background qa agent. Capture screenshots/snapshot
   diffs.
2. **Re-run UI tests** — focus on viewports per `$TEST_PLAN`. If
   responsive testing applies (`deep-knowledge/responsive-testing.md`):
   verify at phone/tablet/desktop.
3. **Visual diff review** — if snapshot tests produced diffs, walk
   through each: expected (consistency fix) or regression? Apply Step 7
   classifier to regressions.
4. **Red-team pass** — spawn `redteam`:
   ```
   Agent(subagent_type="devops:redteam",
         description="Red-team polish diff",
         prompt="Review the diff of this polish pass: <changed files>.
                 Find: visual regressions (a 'consistency snap' that
                 hides a real signal — e.g. error states now look like
                 normal states), state-visual fixes that change perceived
                 affordances (button that lacked hover now suggests it's
                 clickable but its handler is no-op), token migrations
                 that resolve to wrong values in dark mode, layout shifts
                 introduced by spacing changes. Report concrete risks
                 with file:line.")
   ```
5. Apply Step 7 to redteam findings.

**Skip self-spawned redteam** when `$PARENT_SKILL=do-run` and parent owns
a redteam wave — flag findings for parent's wave instead.

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

Build a concept page following the concept scaffold in
`skills/auto-concept/deep-knowledge/templates.md` (with the submit/monitor
bridge from `skills/auto-concept/deep-knowledge/bridge-server.md` — reference
both by name, not by concept's step numbers) when:
- More than 3 structural proposals (Step 10), OR
- More than 5 items flagged across all "deferred" categories

Sections:
- **Structural proposals** — toggle per item with diff preview
- **Pattern conflicts (deferred)** — Step 6 unresolved items
- **Harden-candidates** — UI-irrelevant backend findings discovered
- **High-risk skips** — frontend architecture items the skill skipped

User decisions: `Apply` / `Skip` / `Defer-issue` per item. Submit
applies the chosen items.

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
  phone/tablet/desktop snapshots (per `deep-knowledge/responsive-testing.md`).
- **Pre-mortem inline** for every change touching shared components
  (see `deep-knowledge/pre-mortem.md`).
- **Surface harden-candidates explicitly** — backend-only findings get
  flagged for `/auto-harden`, not silently dropped.
- **Never commit automatically** — the user decides when to commit.
