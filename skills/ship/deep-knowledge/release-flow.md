# Release Flow

## Commit + Push

Stage version-bumped files and remaining changes. Commit per `/commit` skill conventions.

```bash
git push -u origin <branch>
```

## Create PR

Create a pull request via the GitHub API:

- Title: `<type>(scope): subject` — under 70 chars
- Body MUST start with `Closes #NNN` / `Fixes #NNN` for every resolved issue
- Base branch: `main`
- Include a `## Summary` and `## Test plan` section in the body

## Merge PR

Merge the PR via the GitHub API:

- Strategy: squash merge
- Pass `--delete-branch` to request remote branch deletion
- Verify remote branch is gone: `git ls-remote --heads origin <branch>`
- If branch persists (API hiccup), cleanup step 3 handles it as a fallback

## Tag

After merge, create version tag on main:

```bash
git checkout main
git pull origin main
git tag v<X.Y.Z>
git push origin v<X.Y.Z>
```

- Tag on the **squash-merge commit on main** — not on the feature branch
- Format: `vX.Y.Z`
- Skip if version bump was "none"
- Verify tag exists: `git ls-remote --tags origin | grep "v<X.Y.Z>"`

## GitHub Release (MANDATORY for every tag)

After tag push, create a GitHub Release. Format per `templates/github-release.md`.

```bash
# Generate commit list since last tag for release notes
PREV_TAG=$(git describe --tags --abbrev=0 HEAD~1 2>/dev/null || echo "")
if [ -n "$PREV_TAG" ]; then
  COMMITS=$(git log ${PREV_TAG}..HEAD --oneline)
else
  COMMITS=$(git log --oneline -20)
fi
```

Create a GitHub Release via the API with the following content:

- **Title**: `v<X.Y.Z>`
- **Tag**: `v<X.Y.Z>` (must already exist)
- **Body**: Mirror the CHANGELOG entry for this version (What's New sections: Added/Changed/Fixed + Contributors)
- **Scope**: Only changes since previous release tag — not cumulative
- **Content**: Mirror CHANGELOG entry for this version (same sections/bullets)
- **Assets**: Attach build artifacts if CI produces them
- **Pre-release**: Mark as pre-release for `0.x` versions
- **Verification**: Confirm release exists via GitHub API — must show correct version + notes
- If CI auto-creates releases from tag push, verify the release exists instead of creating one

## CI tag filter

The release workflow's tag trigger must match **all** semver tags
(`v[0-9]+.[0-9]+.[0-9]+`), not just `.0` tags. A filter like `v*.*.0`
silently skips patches.
