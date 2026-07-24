# Documentation Maintenance

Keep project docs in their target state as behavior, flows, and architecture change.

Cross-cutting rule for every implementation agent and for `/ship`. It covers
the **content** layer of documentation — prose, flows, folder structure, curated
descriptions — which no generator maintains. The mechanical roster layer (counts,
hook lifecycle, skill/agent table rows) is handled separately by
`gen-readme-sections.js` and friends; see `CONVENTIONS.md` §
Auto-Maintained Documentation. The two are complementary: generators keep *facts*
in sync, this keeps *meaning* in sync.

## Scope

Applies to **project documentation only**: `docs/`, README prose, architecture and
design docs, in-repo usage guides, and flow/workflow docs.

- **Not code comments.** `code-defaults.md` ("don't add docstrings/comments to code
  you didn't change") still governs source files — that rule is untouched.
- **Not the auto-generated roster markers.** Never hand-edit text between
  `<!--devops:…-->` markers; the generators own those.

## Definition of "target state"

Proportional, not exhaustive. After a change lands, the docs are in target state
when both hold:

1. **Nothing misleads.** No living doc still describes behavior, a flow, or a
   structure that the change removed or altered.
2. **New capability is discoverable.** A materially new user-visible feature or
   flow can be found from the place a reader would look (README feature list, the
   relevant `docs/` guide, or a linked design spec).

"Target state" is *not-misleading + discoverable*, not "document every line." Most
small changes need nothing.

## Living vs. point-in-time docs

| Class | Examples | On change |
|-------|----------|-----------|
| **Living** — update in place | README prose, architecture overviews, usage/how-to guides, flow docs, folder-structure docs, API/contract references | Edit to match reality |
| **Point-in-time** — append-only | dated design specs (`docs/**/specs/*`), dated concept pages (`docs/concepts/*`), CHANGELOG entries, ADRs | **Never retro-edit.** Supersede with a new dated doc + a one-line "superseded by" pointer |

The distinction is the safety rail: a superseded decision stays on record as
history; only living docs get rewritten.

## Trigger matrix (proportional)

| Change kind | Doc action |
|-------------|------------|
| Typo, internal refactor, dependency/version bump | none |
| Bugfix restoring documented behavior | none (unless a doc described the buggy behavior) |
| New user-visible feature | make it discoverable (README feature list / `docs/` guide); add a dated design spec if the design is non-trivial |
| Changed flow / workflow / UX path | update the affected flow doc or guide in place |
| Architecture change (new subsystem, moved boundary, changed contract) | update the architecture doc + every affected reference |
| New subsystem / module / top-level folder | extend or add the `docs/` section; restructure `docs/` if the current layout no longer fits |
| Removed / renamed feature | remove or redirect the stale living doc; leave dated records intact |

## Folder-structure changes

Restructuring `docs/` is in scope — but bounded:

- **Trigger only on real drift.** Restructure when the architecture changed enough
  that the current layout misleads or scatters related docs. Not for tidiness.
- **Additive-first.** Prefer adding a section or subfolder over moving many files.
- **Mirror the code.** A reader should find a doc where they'd expect the
  corresponding code to live.
- **Fix links on move.** When you move a file, update every in-repo link to it.
- **HARD RULE — never delete history.** Dated specs, dated concepts, and CHANGELOG
  entries are the historical record. Never delete or rewrite them; supersede with a
  new dated doc and a "superseded by" pointer.

## When this runs

- **Implementation agents** — as part of the *same* change that alters behavior,
  a flow, or architecture; never a deferred pass. Proportional per the matrix
  above (most changes need nothing).
- **`/ship` Step 2.6 (Docs-Sync)** — a reconciliation gate against the
  frozen shipped diff, before the version bump. It is the safety net that catches
  living-doc drift the implementer missed, and its edits land in the version-bump
  commit. Non-blocking: a ship never aborts over docs; unavoidable doc debt is
  recorded in the CHANGELOG entry instead.

For sizing and the "reference over duplicate" rule, follow `content-conventions.md`
— reference existing docs by name rather than paraphrasing them here.
