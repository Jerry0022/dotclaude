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

## Tag + Release

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
- Verify CI release workflow triggered: `gh run list --workflow=release --limit 1`
- Do NOT wait for CI completion — it runs asynchronously

## CI tag filter

The release workflow's tag trigger must match **all** semver tags
(`v[0-9]+.[0-9]+.[0-9]+`), not just `.0` tags. A filter like `v*.*.0`
silently skips patches.
