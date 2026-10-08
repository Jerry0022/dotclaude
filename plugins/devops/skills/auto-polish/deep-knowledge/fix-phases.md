# Polish Fix Phases (Steps 5–10)

How each fix phase of a full `/auto-polish` pass applies the Step 4 findings (`findings-scan.md`). `SKILL.md` keeps which phase handles which finding and the approval rule.

## Step 5 — State-Visuals + Auto-Consistency Phase

Apply without prompting (invisible visual hygiene):

1. **State-visuals** — auto-add missing `:hover`, `:focus-visible`,
   `:disabled`, `:active`, aria-labels, loading/error/empty UI states
   using existing patterns from the codebase. Reduce-motion respect for
   long animations.

2. **Token migrations** — every hardcoded value with a clean token
   equivalent → replace.

3. **Single-outlier consistency snaps** — if a value appears once and
   the surrounding pattern has ≥70% dominance for a different value
   in the same category, snap to dominant.

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

3. **Escalate to a `devops:designer` agent when stuck** — neither pattern
   matches a token, distributions are split, recency doesn't help. Give it
   the category, both values with their counts and the scope; ask for a
   recommended value plus a 2–3 sentence rationale, no file changes.
   Apply the recommendation. If `$AUTONOMOUS=0` and the change
   affects >10 files: confirm via `AskUserQuestion` with a short summary
   + designer's rationale.

4. When `$AUTONOMOUS=1` AND no confident decision can be made: skip and
   flag in the final report under "Pattern conflicts deferred".

## Step 7 — UI-Functionality Fixes

For Step 4 (#4) findings — apply the confidence-score from
`{PLUGIN_ROOT}/deep-knowledge/harden-polish-shared.md` § 1 (with Hard-Floor check § 2):

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

3. **Never expand beyond UI-causation** — a backend improvement that does
   not actively hurt the UI in `$SCOPE_FILES` is flagged as
   "Harden-candidate" in the report, not applied.

## Step 9 — Frontend Architecture Phase

For Step 4 (#7) findings:

1. **Confidence-score** per `{PLUGIN_ROOT}/deep-knowledge/harden-polish-shared.md` § 1.
2. **Hard-Floor check** per § 2 (component library swap is also
   blocked here per polish-specific § 2 "Hard-Never-Even-With-Approval").
3. Apply per tier:
   - **Score ≥ 80**: auto (extract one component, dedupe one effect).
   - **Score 50–79**: plan + confirm (`$AUTONOMOUS=0`) — e.g. hook
     extraction across 3+ components, component split, prop-drilling
     resolution via context. Skip + flag when `$AUTONOMOUS=1`.
   - **Score < 50 OR hard-floor**: skip + flag.

## Step 10 — Structural UI Proposals (Step 4 #6 findings)

Proposals only, never auto-applied.

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
`{PLUGIN_ROOT}/deep-knowledge/harden-polish-shared.md` § 2:
- Theme overhaul (dark/light system rewrite, brand color swap)
- Routing changes
- Component library swap
