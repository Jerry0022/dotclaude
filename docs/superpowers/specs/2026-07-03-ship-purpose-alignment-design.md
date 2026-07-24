# Design Spec — Ship Purpose Alignment Gate

**Date:** 2026-07-03
**Status:** Implemented on branch (autonomous, per user request)
**Plugin:** devops (MINOR bump on release)

## Problem

`/ship` handles merges safely at the **code level**: rebase gates,
conflict classification, semantic verification, tests
(`deep-knowledge/merge-safety.md`). What it does not check is the
**purpose level**. Two branches developed in parallel:

- Branch A: "add hotkeys to ALL interactive elements" — ships first.
- Branch B: "add a new export button" — ships second, rebase is
  conflict-free, tests green.

The merged result still violates A's purpose: B's new button has no hotkey,
because B was written before A's convention existed. Conversely B's change
can silently break the *functionality* A delivered without any textual
conflict. Neither defect is visible in the diff; both are visible against
the branches' stated purposes. The same applies to branches merged long ago
whose purposes established standing conventions.

## Goals

- On every ship, gather the purposes of the last N merged branches
  (N = 5 default, ≥ 3 when available, discretionary) from Claude-authored
  PR bodies, merge commits, or CHANGELOG.
- **Propagation audit (bidirectional):** verify the current diff honors
  cross-cutting conventions established by those branches (hotkey example),
  AND retro-apply a convention the current branch introduces to the existing
  artifacts on base — as part of the same ship.
- **Regression audit** (only when a merge/rebase actually happened during
  this ship): verify the merged content still delivers its purposes, in
  both directions (theirs intact under ours, ours intact under theirs).
- Autonomous resolution by default; a single batched AskUserQuestion only
  for high-impact conflicts (contradicting purposes, design decisions,
  large rework).
- Project-tunable via the existing ship extension mechanism
  (`purpose_alignment:` block in reference.md, incl. standing conventions).

## Non-Goals

- No new MCP tool — the gate is judgment work (reading purposes, assessing
  compliance) and lives in the skill layer, not in `ship/tools/`.
- ~~No retro-application of the current branch's new conventions~~ — revised
  2026-07-03 per user decision: retro-application IS in scope (P3 reverse
  propagation). Scope stays bounded via escalation: a retro-migration that
  dwarfs the branch's own diff goes into the batched AskUserQuestion instead
  of landing silently.
- No blocking on low-confidence purposes (title-only sources → the finding
  becomes a `userFinalTest` item, not a gate).
- git-sync cron merges are out of scope (pointer added in merge-safety.md;
  the cron resolves code-level conflicts only).

## Design

### Placement: Step 1d in `/ship`

Runs after the preflight/rebase loop stabilizes (`ready: true`), before
Step 2 (build). Two intensities:

| Trigger | Intensity |
|---|---|
| Every ship (direct + intermediate) | **Light** — gather purposes + propagation audit |
| Rebase/merge happened in 1b, or `ship_release` bounced with `baseAdvancedDuringChecks` | **Full** — light + regression audit |
| `mode: "file-only"`, no sources, diff out of scope for all purposes | **Skip** silently |

The `rebaseRequired`/`baseAdvancedDuringChecks` bounce in Step 4 re-enters
Step 1b and then re-runs Step 1d as **full** — a parallel ship just landed,
which is exactly the A/B scenario.

Intermediate ships use sibling sub-branch PRs merged into the feature
branch as sources (parallel role agents propagate conventions to each
other).

### Protocol (deep-knowledge/purpose-alignment.md)

- **P1 Gather** — `gh pr list --base <base> --state merged` (bodies
  truncated, ~3K token cap); exclusions: own PRs, reverts, mechanical
  bumps. Fallbacks: merge commits → squash log grouped by `(#NNN)` →
  silent skip.
- **P2 Distill** — per source one purpose record; separate **local
  purposes** (regression-relevant only) from **cross-cutting conventions**
  (propagation-relevant); confidence tier by source quality.
- **P3 Propagation audit (bidirectional)** — forward: does the current diff
  introduce artifacts inside a merged convention's scope? Reverse: does a
  convention introduced on this branch obligate existing artifacts on base
  (retro-application, ships with the PR)? Violations recorded with fix size.
- **P4 Regression audit** (full only) — intersect diff with each record's
  surfaces; no overlap → intact, done; overlap → tests or targeted semantic
  read (merge-safety Step 5 patterns), both directions.
- **P5 Resolve & escalate** — mechanical fixes and merge-caused regressions
  fixed autonomously (committed into the ship); contradictions, design
  decisions, high-impact rework → ONE batched AskUserQuestion.
- **P6 Report** — fixes → card `changes`; open items → `userFinalTest`;
  silent when clean.

### Internal references

- `merge-safety.md` Step 5 gains a purpose-level pointer (code-semantic
  verification ≠ purpose verification).
- `data-flow.md` diagrams show the Claude-side gate between preflight and
  build.
- Ship `reference.md` documents the `purpose_alignment:` extension block.

## Deliverables

1. `plugins/devops/skills/ship/deep-knowledge/purpose-alignment.md` (new)
2. `plugins/devops/skills/ship/SKILL.md` — new Step 1d, Step 4
   bounce-back note, Step 6 reporting note, version 0.5.0 → 0.6.0
3. `plugins/devops/deep-knowledge/merge-safety.md` — Step 5 pointer
4. `plugins/devops/skills/ship/deep-knowledge/data-flow.md` — gate in
   both flow diagrams
5. `plugins/devops/skills/ship/reference.md` — `purpose_alignment:`
   extension example
6. This spec.

## Error Handling Summary

| Situation | Behavior |
|---|---|
| No gh / no remote | Fallback to merge commits / CHANGELOG; else silent skip |
| < 3 merged branches exist | Use what exists (no fabrication) |
| Purpose only derivable from title | Low confidence → never blocks, `userFinalTest` at most |
| Contradicting purposes | Batched AskUserQuestion |
| Fix requires design decision / large rework | Batched AskUserQuestion |
| Gate finds nothing | Silent — no card noise |

## Testing

- `npm test` (vitest) — frontmatter YAML guard covers the SKILL.md edit.
- `node plugins/devops/scripts/gen-readme-sections.js --check` — roster
  markers unaffected (no new skill/agent).
- Behavioral: next real ship on this repo exercises the light path; a
  parallel-ship rebase exercises the full path.
