# Post-Ship Cleanup

Runs ONLY after confirmed PR merge. If any prior step failed → skip entirely.

## Guard

Before cleanup, verify merge succeeded:

```bash
git log main --oneline -1
```

The squash-merge commit must be visible. If not → preserve everything.

## Steps

### 1. Exit worktree (if session is inside one)

**MUST happen before any git cleanup.** On Windows, the session holds a CWD lock
on the worktree directory — `git worktree remove` will fail if the CWD is still inside it.

Call `ExitWorktree` with `action: "remove"` to:
- Release the CWD lock
- Return the session to the main repo directory
- Clean up the worktree directory and branch

If `ExitWorktree` reports uncommitted changes and refuses to remove, use
`discard_changes: true` — the work is already merged at this point.

If `ExitWorktree` is not applicable (no worktree session active), skip to step 2.

### 2. Sync local main

```bash
git checkout main
git pull origin main
```

If a worktree was active, the main repo may already be on the correct branch
after ExitWorktree — verify with `git branch --show-current` before checkout.

### 3. Delete shipped branch (local only)

```bash
git branch -D <shipped-branch>
```

Remote branch was already deleted by `--delete-branch` in the merge step.

### 4. Prune

```bash
git worktree prune
git remote prune origin
```

## Scope

- **Only own branch/worktree.** Never delete other branches or worktrees.
- **Only after confirmed merge.** No cleanup if ship failed at any step.
- **Traceability lives on GitHub.** The merged PR preserves the full diff and discussion. Local branches are ephemeral.
