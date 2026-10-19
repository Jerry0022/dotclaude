# Implement brief — auto-concept variant overview (concept 20261019-1535-varianten-uebersicht)

Branch: `feat/concept-variant-overview` (from origin/main 849cb03b). Concept page:
`docs/concepts/20261019-1535-varianten-uebersicht.html`, source `docs/concepts/20261019-1535-varianten-uebersicht/rounds/01–06.html`
(rounds 2–6 are mocks of the target chrome, round 6 the latest). Decisions log:
`docs/concepts/20261019-1535-varianten-uebersicht-decisions.json`.

Target: the auto-concept **engine** (`plugins/devops/skills/auto-concept/deep-knowledge/templates-*.md` — CSS/JS/HTML
blocks copied verbatim by `plugins/devops/scripts/concept-build.js`), its authoring docs (SKILL.md, step1-templates.md,
templates-design*.md, step5-process.md), the gate (`plugins/devops/hooks/lib/concept-gate.js`, `validation-gate.md`)
and tests (`plugins/devops/skills/auto-concept/*.test.js`). Applies to `design` rounds with **≥2 `section[data-design]`**;
a single-design round renders exactly as today.

## Requirements (consolidated from 6 rounds of user feedback — honour all)

### A. Variant overview (engine-generated)
1. A design round with ≥2 designs gets an engine-generated **overview** as its first top-level item ("Übersicht").
2. One card per design: number + icon + name, **motto** (author attribute, 2–5 word slogan), main part = **live mini
   preview** of the design's first screen (scaled clone; click = zoom into that design), subpage chips (jump to a screen),
   **top-3 traits** (author attribute; only genuine differences to the other designs), notes count (💬 N = comments on that
   design incl. its screens/annotations), **☆ Favorit** button.
3. **Favorit** replaces the old "Base"/crown wording: optional, at most one, toggle until submit. Favoured card: raised,
   gold border, `★ FAVORIT` badge, others dimmed. Payload field `favorite: <designId>|null`.
   Semantics (document in step5-process.md / SKILL.md): favourite = starting point of the next round; comments on the other
   designs are still applied; no favourite → Claude decides from the comments (all designs on, or a consolidated one).
4. Authoring attributes on `section[data-design]`: `data-design-motto`, `data-design-traits` (exactly 3), `data-design-icon`
   (inline SVG or a small built-in icon name; Claude picks thematically per concept), optional `data-design-color`.
   Gate: with ≥2 designs, missing motto/traits/icon → warning (do not break existing pages).

### B. Top-left header (replaces the design-round screen indicator)
1. Compact by default: only icon + name, `★` only when the current design IS the favourite (overview: `★ <name>` only when
   a favourite is set — never "Noch keine Base"/"☆ –"), plus the **eye toggle** (annotation layer toggle moves in here).
2. Semi-transparent (≈0.6 opacity), coloured left line kept; fully opaque on hover.
3. On hover it expands **horizontally and vertically as ONE card overlaying the content** (like the FABs) — zero layout shift.
   Collapsed width = only what it needs. Expanded: motto, screen tabs, ☆ Favorit.
4. On a design/view page it starts with a quiet back item "▦ Übersicht" (overview icon + word, **no arrow**).

### C. Top-centre quick nav (replaces the design switcher)
1. Row 1: one segment per design with its icon; icons monochrome in one uniform semi-transparent accent tint, the icon
   background carries the design colour (never the same tint as the icon). ★ on the favourite's segment.
2. Row 2: only when the round has variant-independent `section[data-view]`s — smaller segments with a `?` icon, no colour.
   No "Übersicht ‹ ›" row, no arrows.
3. Unobtrusive (semi-transparent) until hovered.

### D. Hotkeys + tooltips
1. Esc → overview · 1–9 → design N · Tab → next screen of the current design · F → toggle favourite · Alt+1–9 → iteration
   tab · `?` → shortcut sheet · Ctrl+Enter → submit · N → notes dock. Views: pick a non-colliding binding (e.g. Shift+1–9)
   and document it. Never fire while focus is in a text field, the dock or a bubble; Tab only outside form fields.
2. **One tooltip per element, never two**: the app tooltip (`data-tip`, R1 Info tier 1500 ms, instant on keyboard focus)
   carries label + keycap, e.g. "Cockpit [1]" (keycap rendered as an app-styled `<kbd>` inside the tooltip). No separate
   floating keycap badges. Follow `deep-knowledge/ui-defaults.md` R1/R4b.
3. ☰ panel: hotkey keycap appears on row hover (approved as is).

### E. ☰ panel navigation (approved)
Each design is one row: small icon prefix (~16 px) + name; its screens as indented sub-rows below. Nothing else changes.

### F. Ctrl + click user pins (new)
1. While Ctrl is held: hint bar bottom-centre over the content (like the FABs), crosshair cursor; hidden when Ctrl is released.
2. Ctrl + click on the current screen places a **user pin** at that spot: comment field only (no question), Esc discards,
   Enter saves. Persisted like annotation answers (localStorage + bridge draft), frozen in baked rounds, restored on reload.
3. Payload `userPins: [{ id, design, screen, x, y (percent of screen box), target (selector or short text of the element hit),
   text }]`; Step 5a documents that Claude reads them per screen/position.

## Constraints
- Engine code stays in the templates-*.md parts in reading order; namespaced classes; never break P32/P33/P14b etc.
  Update the gate's engine-pattern lists and validation-gate.md for new required ids/functions.
- `concept-build.js` changed on main since the concept started (locale keys, #745) — build on the current version.
- Existing single-design and legacy pages must keep working; all existing tests stay green; add tests for overview
  generation, favourite payload, header no-layout-shift, hotkeys not firing in text fields, user pins persistence/payload.
- Locale: UI strings via the locale table (de + en).
- Do not ship; the concept close-out sheet decides that.
