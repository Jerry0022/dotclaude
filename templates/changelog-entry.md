---
name: changelog-entry
description: Template for CHANGELOG.md entries. User-facing, written for end users.
version: 0.1.0
---

# Changelog Entry Template

CHANGELOG.md is user-facing. Written for people who use the project, not developers.

## Format

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- <new feature described from user perspective>

### Changed
- <modified behavior described from user perspective>

### Fixed
- <bug fix described from user perspective>

### Removed
- <removed feature or deprecated functionality>
```

## Section rules

| Section | When to include | Tone |
|---|---|---|
| **Added** | New features, new capabilities | "You can now..." |
| **Changed** | Modified behavior, UI updates | "X now does Y instead of Z" |
| **Fixed** | Bug fixes | "Fixed: X no longer crashes when..." |
| **Removed** | Removed features, deprecations | "Removed: X is no longer available" |

- Only include sections that have entries. No empty sections.
- Newest version at top (reverse chronological).
- Each entry is **one sentence**, user perspective, no jargon.
- Link to PR or issue when relevant: `([#42](link))`

## What belongs in CHANGELOG vs. BUILDLOG

| | CHANGELOG | BUILDLOG |
|---|---|---|
| **Audience** | End users | Developers |
| **Tone** | "You can now..." | "Add filter component" |
| **Includes** | User-visible changes only | All changes incl. internal |
| **Excludes** | Refactors, internal fixes | Nothing |
| **Links** | In README, visible | Not linked, internal |

## Example

```markdown
# Changelog

## [0.6.0] — 2026-03-27

### Added
- Filter dialog in the Settings panel — configure video filters without leaving settings ([#42](link))

### Fixed
- Settings no longer freeze on startup when config file is missing ([#55](link))

## [0.5.1] — 2026-03-25

### Fixed
- App no longer crashes when opening Settings on first launch ([#38](link))
```

## Rules

- Skip CHANGELOG entry if version bump is "none" (internal-only change)
- Every version bump (patch, minor, major) MUST have a CHANGELOG entry
- CHANGELOG is checked by the pre-flight verification grep
