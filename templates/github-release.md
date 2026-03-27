---
name: github-release
description: Template for GitHub Release notes created via the GitHub API.
version: 0.2.0
---

# GitHub Release Template

Created automatically after git tag push in the ship flow.

## How to create

Create a GitHub Release via the API for the tag `v<X.Y.Z>` with:

- **Title**: `v<X.Y.Z>`
- **Tag**: the tag that was just pushed
- **Body**: release notes content (see format below)
- **Pre-release**: mark as pre-release for `0.x` or `-beta`/`-rc` versions
- **Draft**: use draft mode if the release needs review before publishing

## Content scope

Release notes cover **only changes since the last release tag**.
Not the full project history — only the delta.

```bash
# Generate commit list since last tag
git log $(git describe --tags --abbrev=0 HEAD~1)..HEAD --oneline
```

## Format

```markdown
## What's New

### Added
- <feature 1> (#PR)
- <feature 2> (#PR)

### Changed
- <change 1> (#PR)

### Fixed
- <fix 1> (#PR)

## Upgrade Notes

<only if breaking changes or migration steps needed>

## Contributors

- @Jerry0022
- Co-Authored-By: Claude Opus 4.6
```

## Section rules

| Section | When | Content |
|---|---|---|
| **What's New** | Always | Same sections as CHANGELOG (Added/Changed/Fixed/Removed) |
| **Upgrade Notes** | Major bumps only | Migration steps, breaking changes, deprecations |
| **Contributors** | Always | Git authors + co-authors from commits |

## Rules

- **Scope**: Only changes since the previous release tag — not cumulative
- **Tone**: Same as CHANGELOG (user-facing, no jargon)
- **PRs**: Link every change to its PR number
- **Assets**: Attach build artifacts if CI produces them (installers, binaries)
- **Draft**: Use draft mode if the release needs review before publishing
- **Pre-release**: Mark as pre-release for `0.x` or `-beta`/`-rc` versions
- Release is created **after** tag push, **before** cleanup
- If CI auto-creates releases from tags, verify the release exists via the API instead of creating one

## When to create

| Scenario | Create release? |
|---|---|
| Version bump (patch/minor/major) | **Yes** — always |
| Version bump "none" (internal) | **No** — no tag, no release |
| Hotfix direct push | **Yes** — after tag |

## Verification

After creating the release, verify via the GitHub API that it exists with the correct version and notes.
