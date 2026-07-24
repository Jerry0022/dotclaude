# Documentation Maintenance — Design

**Date:** 2026-07-13
**Status:** Implemented (local, unshipped)
**Scope:** devops plugin — implementation agents, `/ship`, deep-knowledge

## Problem

Most consumer projects have a `docs/` folder, but it is routinely ignored:

- During **implementation**, agents change behavior, flows, and architecture
  without ever touching the docs that describe them.
- During **ship**, nothing reconciles docs against what was actually shipped — new
  features go undocumented, changed flows go stale, and the folder structure never
  adapts when the architecture moves.

Goal: after every ship the docs are in their *target state* — no doc misleads, and
materially new capabilities are discoverable — even when features are added or
architecture changes.

## Current state (before this change)

The plugin already had a **mechanical roster-freshness system**, and only that:

- `gen-readme-sections.js` / `gen-dk-index.js` / `gen-project-map.js` regenerate
  counts, the hook-lifecycle roster, skill/agent table rows, the deep-knowledge
  index, and the project map.
- `ship_build` runs the generators; `ship_preflight` warns (advisory, never blocks)
  on stale markers or missing table rows; `ss.git.check` nudges once per 8h.

Gaps: this covers **machine facts only**. There was no upkeep for prose, flows, or
folder structure; no implementation-agent directive to touch docs (in fact
`code-defaults.md` says "don't add comments to code you didn't change"); and no
ship step that reconciles content-level docs against the shipped diff.

## Design

A **proportional** content-docs layer on top of the existing mechanical layer.
Proportional is the key constraint: "target state" means *not-misleading +
discoverable*, not "regenerate everything on every ship" (which would bloat docs
and slow every ship).

Three touchpoints, one shared source of truth:

1. **`deep-knowledge/documentation-maintenance.md`** — the single source of truth:
   scope (project docs, not code comments, not roster markers), the definition of
   target state, the living-vs-point-in-time classification, the proportional
   trigger matrix, and the folder-restructure rules.

2. **Implementation-agent directive** — one `## Rules` bullet in each of the six
   implementation agents (`core`, `frontend`, `feature`, `ai`, `designer`,
   `windows`), referencing the deep-knowledge file. Agents update affected project
   docs as part of the *same* change. Explicitly scoped to project docs, not code
   comments, so it does not contradict `code-defaults.md`.

3. **`/ship` Step 2.6 (Docs-Sync)** — a reconciliation gate inserted between
   Build (Step 2) and Version Bump (Step 3). It diffs the shipped change against
   living docs, applies proportional updates, and commits them into the
   version-bump commit. Non-blocking by design: a ship never aborts over docs.

`CONVENTIONS.md` § Auto-Maintained Documentation gained a "Living documentation"
subsection delineating the two layers (mechanical roster vs. content) so future
contributors don't confuse them.

## Key decisions & rationale

- **Ship step placement — between Build and Version Bump.** By then the diff is
  frozen (rebase + build + Codex gate done) and Step 3 is already the editorial
  step (CHANGELOG). Doc edits land in the same version commit — no stray extra
  commit after the PR is building.
- **Shared deep-knowledge file + one-line agent bullets** (not inline prose in six
  places), mirroring the existing `pre-mortem.md` / `local-llm-delegation.md`
  pattern. DRY; tune wording centrally. `gen-dk-index.js` picks up the new file
  automatically.
- **Restructuring is bounded and additive-first**, and dated specs/concepts are
  never deleted — they are the historical record. This protects the repo's
  established "dated specs are immutable" convention.
- **Non-blocking.** Docs debt is recorded in the CHANGELOG, never a ship blocker —
  keeps the proportional promise and avoids turning docs into a release gate.

## Alternatives considered

- **Preflight heuristic** ("diff adds a new skill/dir but no docs changed → warn").
  Rejected: detecting "new feature" from a diff heuristically is noisy; the
  judgment belongs to the Claude-driven Step 2.6, not a script. Preflight stays
  roster-only.
- **Standalone `/devops-docs` skill** (on-demand audit + sync). Deferred as a
  follow-up: the three touchpoints above cover the stated need (docs maintained
  during implementation and ship). A new skill is a larger surface (frontmatter,
  README row, tests) and would expand scope beyond the request.

## Files changed

- `plugins/devops/deep-knowledge/documentation-maintenance.md` (new)
- `plugins/devops/agents/{core,frontend,feature,ai,designer,windows}.md` (Rules bullet)
- `plugins/devops/skills/ship/SKILL.md` (Step 2.6)
- `plugins/devops/CONVENTIONS.md` (Living documentation subsection)
- regenerated: `deep-knowledge/INDEX.md`, `.claude/project-map.md`, README/architecture markers
