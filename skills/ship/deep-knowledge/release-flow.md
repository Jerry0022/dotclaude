# Release Flow

## Commit + Push

Stage version-bumped files and remaining changes. Commit per `/commit` skill conventions.

```bash
git push -u origin <branch>
```

## Create PR

```bash
gh pr create --title "<type>(scope): subject" --body "$(cat <<'EOF'
Closes #NNN

## Summary
- ...

## Test plan
- [ ] ...
EOF
)"
```

- Title: under 70 chars
- Body MUST start with `Closes #NNN` / `Fixes #NNN` for every resolved issue
- Base branch: `main`

## Merge PR

```bash
gh pr merge --squash --delete-branch
```

- `--delete-branch` removes remote feature branch after merge
- Verify remote branch is gone: `git ls-remote --heads origin <branch>`

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

```bash
gh release create v<X.Y.Z> --title "v<X.Y.Z>" --notes "$(cat <<'EOF'
## What's New

### Added
- <from CHANGELOG Added section> (#PR)

### Fixed
- <from CHANGELOG Fixed section> (#PR)

## Contributors
- @Jerry0022
- Co-Authored-By: Claude Opus 4.6
EOF
)"
```

- **Scope**: Only changes since previous release tag — not cumulative
- **Content**: Mirror CHANGELOG entry for this version (same sections/bullets)
- **Assets**: Attach build artifacts if CI produces them
- **Pre-release**: Use `--prerelease` for `0.x` versions
- **Verification**: `gh release view v<X.Y.Z>` — must show correct version + notes
- If CI auto-creates releases from tag push → verify with `gh release view` instead

## CI tag filter

The release workflow's tag trigger must match **all** semver tags
(`v[0-9]+.[0-9]+.[0-9]+`), not just `.0` tags. A filter like `v*.*.0`
silently skips patches.
