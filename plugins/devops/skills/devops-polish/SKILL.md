---
name: devops-polish
version: 0.1.0
description: >-
  UI refinement pass: visual consistency (spacing, tokens, typography, icons,
  colors), state-visuals (hover/focus/disabled/loading/empty/error), UI-side
  functionality verification (clicks react, forms validate, loading shows),
  and small backend fixes when they are demonstrably UI-related (lag, missing
  field, broken contract). May introduce structural UI changes (new buttons,
  repositions, re-arrangements) but ALWAYS with user approval. Triggers on:
  "polish", "ui polish", "ui angleichen", "design konsistenz", "feinschliff",
  "visuell aufräumen", "design pass". Skips approval prompts when invoked
  with --autonomous (still respects the "structural changes flagged not applied"
  rule). Do NOT trigger for: backend-only work, feature implementation,
  theme/style overhaul.
argument-hint: "[--autonomous] [--invoked-by=agents|autonomous] [optional scope: file/dir path]"
allowed-tools: Agent, Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__Claude_in_Chrome__*, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Polish — UI Refinement Pass

Refine the UI: consistency, visual polish, state-visuals, and UI-side
functionality — with user approval for structural changes. Scope: `$ARGUMENTS`.

## Invocation Context

Same three invocation paths as `/devops-harden`:

1. **Direct** — user types `/devops-polish`.
2. **From `/devops-agents`** — pass `--invoked-by=agents` plus
   `--parent-mode=background|interactive`. Skip self-spawned qa/redteam if
   parent owns those waves. Structural changes (Step 10) STILL require
   approval — when `--parent-mode=background`, structural items are
   skipped + flagged for parent's report.
3. **From `/devops-autonomous`** — pass `--invoked-by=autonomous` (implies
   `--autonomous`). No permission priming, no user prompts. Structural
   changes always flagged for the autonomous report (never auto-applied).

The Single-Agent Shortcut from `deep-knowledge/agent-orchestration.md`
applies: orchestrators delegate directly to this skill instead of building
a wave for polish-tasks (avoids double qa/redteam spawning).

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before
reading. Skip missing files silently.

1. Global: `~/.claude/skills/devops-polish/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/devops-polish/SKILL.md` + `reference.md`
3. Merge order: project > global > plugin defaults

Project extensions can declare:
- Allowed design tokens (spacing scale, color tokens, typography ramp)
- Brand rules (forbidden hardcoded colors, required icon sizes)
- Layout conventions (button positions, form patterns)

## Step 1 — Parse Arguments

Scan `$ARGUMENTS` for:

- `--autonomous` flag → set `$AUTONOMOUS=1`. Skips ALL `AskUserQuestion`
  calls. Structural changes are STILL not auto-applied — they get flagged
  in the final report. Autonomous is mute mode, not yolo mode.
- `--invoked-by=agents|autonomous` → set `$PARENT_SKILL`. See "Invocation
  Context". `--invoked-by=autonomous` implicitly sets `$AUTONOMOUS=1`.
- `--parent-mode=background|interactive` → only with
  `--invoked-by=agents`. Background acts like `--autonomous`.
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

1. **Invoke `/devops-test-plan`** to determine UI test tools (browser
   preview, Playwright, snapshot tests, multi-viewport setup). Store as
   `$TEST_PLAN`.
2. **Spawn `qa` agent** in background — SKIP when `$PARENT_SKILL=agents`
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

1. **State-visuals gaps** — same as `/devops-harden` Step 4 #3:
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
   is outside scope, defer (`/devops-harden` territory).

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

**Skip self-spawned redteam** when `$PARENT_SKILL=agents` and parent owns
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
`skills/devops-concept/deep-knowledge/templates.md` (with the submit/monitor
bridge from `skills/devops-concept/deep-knowledge/bridge-server.md` — reference
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
- **Token-first** — when a design token catalog exists, prefer tokens
  over dominant-value-snap. Tokens are intent; dominance is accident.
- **Multi-viewport verify** — for web apps, never declare done without
  phone/tablet/desktop snapshots (per `deep-knowledge/responsive-testing.md`).
- **Pre-mortem inline** for every change touching shared components
  (see `deep-knowledge/pre-mortem.md`).
- **Surface harden-candidates explicitly** — backend-only findings get
  flagged for `/devops-harden`, not silently dropped.
- **Never commit automatically** — user commits via `/devops-commit`.
