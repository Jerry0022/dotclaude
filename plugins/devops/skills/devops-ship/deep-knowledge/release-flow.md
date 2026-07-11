# Release Flow

## Commit + Push

Stage version-bumped files and remaining changes. Commit per `/devops-commit` skill conventions.

```bash
git push -u origin <branch>
```

## Create PR

Create a pull request via the GitHub API:

- Title: `<type>(scope): subject` — under 70 chars
- Body MUST start with `Closes #NNN` / `Fixes #NNN` for every resolved issue
- Base branch: `main`
- Include a `## Summary` and `## Test plan` section in the body

## Pre-Merge CI Checks Gate

Between PR creation and merge, `ship_release` waits for `gh pr checks --watch`
to finish (default 10-min timeout). See `quality-gates.md → Pre-Merge CI Checks Gate`.

- **green** → continue to merge
- **failed / timeout** → return success: false, do NOT merge, render `ship-blocked` card
- **no checks configured** → silent skip
- **bypass**: `skipChecks: true` or `DEVOPS_SHIP_SKIP_CHECKS=1` (hot-fix only)

This prevents the historical failure mode where lokal grün + merge → CI rot auf
`main` without anyone noticing.

## Merge PR

Merge the PR via the GitHub API:

- Strategy: squash merge
- Pass `--delete-branch` to request remote branch deletion
- Verify remote branch is gone: `git ls-remote --heads origin <branch>`
- If branch persists (API hiccup), cleanup step 3 handles it as a fallback

## Tag — alpha channel (ring model)

After merge, `ship_release` creates the ANNOTATED alpha tag on main:

```bash
git tag -a alpha/v<X.Y.Z> origin/main -m '{"channel":"alpha","version":"<X.Y.Z>"}'
git push origin alpha/v<X.Y.Z>
```

- Tag on the **squash-merge commit on main** — not on the feature branch
- Format: `alpha/vX.Y.Z` — every ship publishes to the earliest channel;
  `beta/vX.Y.Z`, `stable/vX.Y.Z` and the bare `vX.Y.Z` alias are created by
  `/devops-release` (promotion, same SHA)
- Annotated, never lightweight — promotion time/actor must be derivable from
  the tag object (all channel tags share one commit)
- Skip if version bump was "none"
- Verify tag exists: `git ls-remote --tags origin | grep "alpha/v<X.Y.Z>"`
- Published tags are immutable — never move or delete them

## GitHub Release — at PROMOTION, not at ship

Ship creates NO GitHub Release (alpha ships on every merge — a Release per
alpha is noise). Releases are owned by the promotion flow:

- **beta**: tags-only at launch (no Release; deferred until an external beta
  audience exists — spec §11)
- **stable**: the bare `v<X.Y.Z>` tag push triggers `.github/workflows/release.yml`
  (notes from CHANGELOG); `ship_promote` polls for the Release and creates it
  via `gh` as an idempotent fallback. Range computation must exclude channel
  tags: `git describe --tags --match 'v[0-9]*' --abbrev=0 HEAD~1`.

Format per `templates/github-release.md`: title/tag `v<X.Y.Z>`, body mirrors
the CHANGELOG entry (Added/Changed/Fixed + Contributors), scope = changes
since the previous STABLE release only, verification via GitHub API.

## CI tag filter

The release workflow's tag trigger must match **all** semver tags
(`v[0-9]+.[0-9]+.[0-9]+`), not just `.0` tags. A filter like `v*.*.0`
silently skips patches.
