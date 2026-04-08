---
name: buildlog-entry
description: Template for a single BUILDLOG.md entry. Developer-facing, not user-facing.
version: 0.1.0
---

# Build Log Entry Template

Each shipped build gets one entry. Newest at top (reverse chronological).

## Format

```markdown
## <build-hash> — YYYY-MM-DD
Version: <x.y.z>
Branch: <branch-name>
PR: #<number>
Commit: <git-short-hash-on-main>
Changes:
- <change 1 — mirrors PR summary bullets>
- <change 2>
```

## Rules

- `<build-hash>` = content hash from `{PLUGIN_ROOT}/scripts/build-id.js` (7 chars)
- `Commit` = the squash-merge commit on main (git-referenceable)
- `Changes` = same bullets as PR description (keep concise, 1 line each)
- BUILDLOG.md is NOT user-facing — not linked in README, not in CHANGELOG
- Created retroactively if the file doesn't exist yet
- Skip entry if version bump was "none" (internal-only, no tag)

## Example

```markdown
# Build Log

## a3f9b21 — 2026-03-27
Version: 0.6.0
Branch: feat/42-video-filters
PR: #42
Commit: e8f2a1c
Changes:
- Add filter dialog to settings panel
- Remove legacy filter component

## k7d2e44 — 2026-03-25
Version: 0.5.1
Branch: fix/55-startup-crash
PR: #38
Commit: b1c4d22
Changes:
- Fix settings freeze on startup
```
