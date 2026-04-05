# Pre-Flight Safety Gate

Run before ANY other ship step. If any check fails → STOP.

## Checks

```bash
# 1. No uncommitted/untracked files
git status --porcelain
```
If non-empty → ABORT. List files, ask user: stage+commit or discard.

```bash
# 2. Commits ahead of main
git rev-list --count main..HEAD
```
If 0 → ABORT. Nothing to ship.

```bash
# 3. All commits pushed to remote
git rev-list --count @{upstream}..HEAD 2>/dev/null
```
If >0 → push before proceeding.

```bash
# 4. Build artifacts not tracked
git ls-files --others --exclude-standard --directory | grep -E '(dist/|\.angular/|\.tmp/)' | head -5
```
If hits → fix `.gitignore` first.

## Version Consistency Check (MANDATORY)

Before proceeding to build/version-bump, verify that existing version
references are consistent. This catches cases where a prior ship forgot
to update a file.

Detect project type first:

```bash
# Plugin project?
[ -f ".claude-plugin/plugin.json" ] && IS_PLUGIN=true
# npm project?
[ -f "package.json" ] && IS_NPM=true
```

```bash
# 5. Extract current version from source of truth
# Plugin project:
VERSION=$(node -p "require('./.claude-plugin/plugin.json').version" 2>/dev/null)
# npm project (fallback):
VERSION=${VERSION:-$(node -p "require('./package.json').version" 2>/dev/null)}
```

If VERSION is available, check:

```bash
# 5a. README version badge matches
grep -q "Version: $VERSION" README.md
```
If no match → WARN: "README version badge is stale. Will update in Step 3."

```bash
# 5b. CHANGELOG has an entry for this version
grep -q "\[$VERSION\]" CHANGELOG.md
```
If no match → WARN: "CHANGELOG missing entry for $VERSION. Will add in Step 3."

```bash
# 5c. Check for project-specific version files from extension
# Read extension reference.md for additional version file paths
```

These warnings don't block the ship — they ensure Step 3 (Version Bump)
knows what needs updating. But they MUST be reported before proceeding.

## Post-Ship Verification (MANDATORY)

After Step 4 (Commit/Push/PR/Merge), before Step 5 (Cleanup), verify:

```bash
# 6a. Git tag exists on remote
git ls-remote --tags origin | grep "v$NEW_VERSION"
```
If no tag → CREATE it now. This is the most commonly missed step.

```
# 6b. GitHub release exists (if CI creates one)
Check via GitHub API whether a release for v$NEW_VERSION exists.
```
If no release but tag exists → OK (CI may create it async).
If no release and no tag → ABORT cleanup, tag first.

```bash
# 6c. Merged commit on main has correct version
# Plugin project:
git show main:.claude-plugin/plugin.json | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version" 2>/dev/null
# npm project:
git show main:package.json | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version" 2>/dev/null
```
If version on main doesn't match new version → something went wrong.

## Guard rule

Step 5 (Cleanup) MUST NOT execute unless Step 4 (PR merge) completed
successfully AND Post-Ship Verification passed. If any step fails →
no cleanup, preserve all branches/worktrees.
