# Post-Ship Cleanup

Runs ONLY after confirmed PR merge. If any prior step failed → skip entirely.

## Guard

Before cleanup, verify merge succeeded:

```bash
git log main --oneline -1
```

The squash-merge commit must be visible. If not → preserve everything.

## Steps

### 1. Sync local main

```bash
git checkout main
git pull origin main
```

If in a worktree, also update the main repo:
```bash
git -C <main-repo-path> checkout main
git -C <main-repo-path> pull origin main
```

### 2. Delete shipped branch (local only)

```bash
git branch -D <shipped-branch>
```

Remote branch was already deleted by `--delete-branch` in the merge step.

### 3. Remove worktree (if applicable)

```bash
git checkout --detach
git worktree remove <path> --force
```

Fallback if file-locked:
```bash
git worktree prune && rm -rf <path>
```

### 4. Prune

```bash
git worktree prune
git remote prune origin
```

## Scope

- **Only own branch/worktree.** Never delete other branches or worktrees.
- **Only after confirmed merge.** No cleanup if ship failed at any step.
- **Traceability lives on GitHub.** The merged PR preserves the full diff and discussion. Local branches are ephemeral.
