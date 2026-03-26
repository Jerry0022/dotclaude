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

## Guard rule

Step 5 (Cleanup) MUST NOT execute unless Step 4 (PR merge) completed
successfully. If any step fails → no cleanup, preserve all branches/worktrees.
