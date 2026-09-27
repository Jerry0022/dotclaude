# Polish Findings Scan (Step 4)

The eight parallel scans of a full `/auto-polish` pass. `SKILL.md` Step 4 decides that they run; this file is what each one looks for. Item numbers (#1–#8) are what later steps refer to.

Spawn parallel `devops:scout` agents (single message, multiple Agent calls):

1. **State-visuals gaps** — same as `/auto-harden` Step 4 #3:
   interactive elements missing :hover, :focus, :focus-visible, :disabled,
   :active, aria-label; forms missing loading/error/empty states;
   animations not respecting `prefers-reduced-motion`.

2. **Consistency drift — extended** — extract spacing, padding, margin,
   gap, font-size, font-weight, line-height, color, background, border-color,
   border-radius, box-shadow, icon-size, z-index, letter-spacing. Apply
   the ordinal-vs-categorical math from
   `{PLUGIN_ROOT}/deep-knowledge/harden-polish-shared.md` § 3:
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

8. **Standing UI rules (`$UI_RULES`)** — R0–R6, each with a static and a
   runtime half. `{PLUGIN_ROOT}/deep-knowledge/ui-defaults.md` (loaded in Step 0) is the
   single source for what each half checks — work from it, not from memory:
   R0 app style · R1 tooltips (app-styled, Info/Label delay tiers) · R2a
   dropdowns styled · R2b uniform menu items · R3 spacing · R4 hotkeys ·
   R5 scrollbars · R6 platform matrix (Windows / Linux desktop, Android /
   iOS tablet, Android / iOS phone — design, UX and function on each).
   **R0 is part of every rule**, project rules included.
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
