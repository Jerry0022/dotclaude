# Polish Re-test, Pre-Mortem and Concept Page (Steps 11–12)

The verification run and the concept page of a full `/auto-polish` pass. `SKILL.md` keeps the order and the card variants.

## Step 11 — Re-test + Pre-Mortem

Before the re-test, when a browser tool is available, run the **runtime
halves** of the standing UI rules (Step 4 #8) over the scope: time an Info
and a Label tooltip against their tiers (plus the 300 ms skip delay and
focus-open), open each changed tooltip, menu and scroll container and
compare it to a card/dialog of the app in every theme (R0/R5), measure touch
targets on the phone viewport, tab-walk every changed view (focus order,
Escape/Enter/arrows, focus ring), and walk every changed view on each target
of the R6 platform matrix (layout, touch vs. mouse/keyboard interactions,
the flow completing), and read every changed flow once in order for R7
(trigger, dialog, confirmation, toast, error keep one term per concept) — what emulation cannot show goes to `userFinalTest`
with the target named. Findings follow the same score/approval
rules as every other polish item; R0/R1/R4a/R4b/R5/R7 stay report-only (R0 token
swaps excepted). Without a browser tool: list them once as skipped in
Step 12.

1. **Wait** for the background qa agent. Capture screenshots/snapshot
   diffs.
2. **Re-run UI tests** — focus on viewports per `$TEST_PLAN`. If
   responsive testing applies (`{PLUGIN_ROOT}/deep-knowledge/responsive-testing.md`):
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

## Concept Page (Step 12, when needed)

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
