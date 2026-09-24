# Concept panel — compact Kompass, rounds chip, accordion close-out — design

**Date:** 2026-09-13 · **Skill:** `plugins/devops/skills/concept` · **Source:** concept page `2026-09-13-concept-panel-layout-icons` (3 rounds, implement on round 3) · **Baseline:** Kompass panel (2026-09-06, #345/#359)

## Problem

The Kompass panel already pins the head, the status line and the CTA foot and scrolls only the tree — but on the final report the close-out sheet (4 blocks + plan + hand-offs) outgrows the ≤120 px foot and scrolls inside it; the tree spends most of its height on rounds and a flat TOC; nothing has icons or tooltips. The user's complaint ("viel Scrollen, viel Platz für wenig Interaktion") was raised against a 0.149 page, but the close-out part holds for the current sheet too. Separately, the split-button caret (▾ → "Mit Feedback implementieren") could not be clicked on a live page.

## Decisions (from the concept rounds)

### Head line (`.panel-here`)
- Reads `Iteration N (Variante)` — the parenthesis only when the reading line is inside a section that carries a variant bi-state (`eval-*`), never in general/context sections; no "aktiv" suffix.
- A **🕘 rounds chip** with the count of previous rounds sits at the right end of the head line. Clicking it unfolds the previous rounds directly under the head line (inside the pinned head), each with its summary ("14 Einträge · 3 verworfen") and an **"archiviert"** marker, dimmed; clicking a round opens it read-only (veil + frozen bar as today). Closed by default. This replaces the vertical chip list and the `<details class="iteration-archive">` fold inside the scroll box — the tree below holds only the live round's TOC. The final-report and reality-check chips keep their glyph labels inside the unfolded list.
- On the final report the second head line ("› TOC entry under the reading line") is dropped — the accordion shows the selection.

### TOC (`#section-nav`)
- Grouped around the **selected variant**: the variant node is open and lists its sub-sections (nested `section[id][data-nav-label]` inside the variant section) — general/context sections stay flat above/below; the other variants collapse into one accordion row "Weitere Varianten · N · k verworfen" (open on click; the scroll spy may open it, never close it). With no variant selected yet (all Miteinbeziehen), the previous flat list applies.
- **"+N weitere"** appears only when the list would otherwise overflow the scroll box; clicking it expands (and the box scrolls). Never a fixed cut-off.
- Keep: one-open tree, summary lines, zero-rect guard, `data-nav-group` override, grouping only when ≥2 kinds AND >12 entries (the accordion row counts as one entry).

### Close-out sheet → accordion (`#closeout-sheet`)
- Each block is **one row when collapsed**: `○/✓` answered marker · icon (📌 Offene Punkte, 🚀 Jetzt shippen?, 🗂 Diese Seite, ⚠ Danach von Hand) · label · current answer (short). Exactly one row is open; opening one closes the others. Short labels are allowed here (the one place icons carry visible words); every icon also carries a native `title` tooltip.
- **Every row must be answered** before execute: unanswered rows are not ticked; pre-selected defaults may stay — "answered" means the row was opened and confirmed, not necessarily changed. The status line counts "n von 4 beantwortet".
- **One button at a fixed place** (`#closeout-execute`, same spot as the implement button): while rows are unanswered it reads "Weiter ›" and confirms the open row (keeping its current answer) and opens the next unanswered one; once all rows are answered it transforms into the warning-coloured "⚠ Ausführen" that submits `finalize`. No second button, no "Alles ausführen" wording, no `.submit-gap`.
- **The plan/summary sits below the button** ("Gewählt: 2 × Issue · nicht releasen · Seite löschen · 2 Handgriffe danach"), re-rendered on every change.
- Blocks/payload/ids unchanged: `followups` (three routes per point + origin tag), `ship` (no default → must be answered), `files`, `handoffs` (read-only row; "answered" = opened once), `plan` (moved below). Done state (`data-closed`): only the hand-offs block stays, no controls, no "back to start" link.

### Tooltips / labels
- Native `title` + `aria-label` on every icon/action (browser default delay); no custom tooltip engine, no first-use label mode. Visible short labels only on the close-out rows and the primary action.
- > Superseded 2026-09-24: concept pages now use the app tooltip engine (`data-tip`, templates.md § App Tooltips) with the Info/Label delay tiers of `ui-defaults.md` R0/R1 — a native `title` no longer counts as a tooltip.

### Feedback dock (design template)
- Order top → bottom: **screen → design (≥2 designs) → general**; with a view active: **view → general**.
- Compact size shows all three textareas plus their attach bars on a ~1080 px viewport without scrolling/expanding; spacing and attach button aligned with the textarea. Widths (420/560) and both FABs unchanged.

### Split-button caret bug
- Root cause + fix per the regression test in this PR (the foot's `overflow-y: auto` clip vs. the absolutely positioned `#submit-menu`, or whatever the investigation confirms). The menu must open and be clickable in every template and panel state.

### Explicitly rejected
Icon toolbar (B), icon rail + drawer (C), rail inside the panel, horizontal round chips, wizard with Weiter/Zurück screens, custom 2 s tooltips, first-use labels, "back to start" link in the done state.

## Verification
- vitest: section-nav / panel-anatomy / closeout-sheet-behaviour / final-report-closeout / panel-chrome / fab-labels updated; new regression test for the caret.
- Fixture page (`scripts/build-concept-fixture.js`) opened in a real browser: head line + rounds chip, TOC grouping, accordion close-out (Weiter → Ausführen transform, plan below), done state, dock order and compact fit, caret menu clickable.
- Validation gate entries updated and count consistent.
