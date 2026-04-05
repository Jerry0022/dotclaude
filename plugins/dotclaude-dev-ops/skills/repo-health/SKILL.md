---
name: repo-health
version: 0.1.0
description: >-
  Analyze repository branch hygiene: find unmerged branches, stale local branches
  with deleted remotes, orphaned worktrees, and verify all work landed in main.
  Use when the user wants a health check of their repo state. Triggers on:
  "repo health", "branch cleanup", "branch check", "was liegt noch rum",
  "unmerged branches", "git aufraumen", "branch hygiene", "repo audit".
  Do NOT trigger automatically — only on explicit user request.
argument-hint: "[optional: focus area — branches, worktrees, PRs]"
allowed-tools: Bash(git *), Bash(gh *), Read, Glob, Grep, AskUserQuestion
---

# Repo Health Check

Analyze the repository for branch hygiene, unmerged work, and cleanup opportunities.

## SAFETY: Worktree Branch Protection

**HARD RULE — no exceptions:**
Branches attached to active worktrees are UNTOUCHABLE. You MUST NOT:
- Delete them locally (`git branch -D`)
- Delete them remotely (`git push origin --delete`)
- Checkout/switch away from them in their worktree
- Recommend them for deletion
- Include them in any cleanup batch

These branches represent active Claude Code sessions. Deleting them breaks
the worktree and causes data loss.

**Detection:** `git worktree list --porcelain` → every line starting with
`branch refs/heads/` is a protected branch. Build this set FIRST and check
it before EVERY delete operation.

## Step 1 — Fetch & Sync

Run in parallel:

1. `git fetch --all --prune` — sync with remote and remove stale tracking refs
2. `git worktree list --porcelain` — list active worktrees, extract protected branches
3. `git branch -a --no-color` — list all local and remote branches

Build the **protected branch set** from worktree output. Every branch in this set
is excluded from ALL subsequent steps — classification, recommendations, AND cleanup.

## Step 2 — Branch Classification

For each local branch (excluding worktree branches):

1. **Check merge status against `origin/main`:**
   - `git merge-base --is-ancestor <branch> origin/main` → MERGED (git ancestor)
   - If not ancestor: check if the branch has a corresponding **merged PR** on GitHub
     (`gh pr list --state merged --head <branch> --json number,mergedAt --limit 1`)
   - If merged PR found → SQUASH-MERGED (content in main via squash, but git doesn't know)
   - If neither → UNMERGED

2. **Check remote tracking status:**
   - `git branch -vv` → look for `[origin/...: gone]` markers
   - gone = remote branch was deleted (typically after PR merge)

3. **Compute diff against main (excluding CHANGELOG.md):**
   - `git diff --stat origin/main...<branch> -- . ':(exclude)CHANGELOG.md'`
   - This shows whether the branch has substantive changes beyond changelog entries

Classify each branch into one of:

| Status | Meaning | Action |
|--------|---------|--------|
| `MERGED` | Git ancestor of main | Safe to delete |
| `SQUASH-MERGED` | PR merged, content in main | Safe to delete |
| `UNMERGED` | No PR or PR not merged | Investigate — potential lost work |
| `ACTIVE-WORKTREE` | Attached to a worktree | Skip (active session) |

## Step 3 — Remote Branch Audit

After `fetch --prune`, check for remaining remote branches that are NOT `origin/main`:

- For each: check if merged into `origin/main` or has a merged PR
- Flag any remote branches that linger after their PR was merged (cleanup missed)

## Step 4 — PR Cross-Reference

Fetch recent PRs to validate branch status:

```
gh pr list --state all --limit 30 --json number,title,state,mergedAt,headRefName
```

Cross-reference with local branches:
- Every MERGED PR should have its branch cleaned up (locally and remotely)
- Every local branch should map to a PR (open, merged, or closed)
- Flag orphan branches with no PR (work that was never shipped)

## Step 5 — Local vs Remote Main Sync

```
git log --oneline main -1
git log --oneline origin/main -1
```

Verify local `main` is up to date with `origin/main`. Flag if behind.

## Step 6 — Report

Present a structured report in the **user's language** (German if configured):

### Section 1: Summary
- Total local branches (excl. worktrees)
- Merged / Squash-merged / Unmerged count
- Remote branches remaining
- Main sync status

### Section 2: Safe to Delete
Table of branches that are merged/squash-merged and can be safely removed:

| Branch | PR | Merged via | Remote | Recommendation |
|--------|----|----|--------|-----|

### Section 3: Needs Investigation
Table of unmerged branches with their diff stats — potential lost work:

| Branch | Commits ahead | Files changed | Last commit | PR status |
|--------|------|------|------|-----|

### Section 4: Active Worktrees (info only)
List worktree branches — no action needed.

### Section 5: Recommendations
Concrete actions the user can take:
- Which branches to delete (with commands)
- Whether to run `/ship` on any unmerged work
- Whether local main needs a pull

## Step 7 — Optional Cleanup

If the user confirms, execute cleanup:

1. **Re-check worktree branches** before any deletion — the set may have changed
   since Step 1. Run `git worktree list --porcelain` again and rebuild the protected set.
2. For each branch to delete: **verify it is NOT in the protected set**. If it is, skip
   with a warning — never delete it.
3. Delete safe-to-delete local branches: `git branch -D <branch>`
4. Delete corresponding remote branches if they still exist: `git push origin --delete <branch>`
5. Prune worktrees: `git worktree prune`
6. Prune remotes: `git remote prune origin`
7. Sync local main: `git checkout main && git pull origin main`

**Safety invariants:**
- **Never delete without user confirmation.** Present the report first, let the user decide.
- **Never delete a worktree-attached branch** — even if the user explicitly asks.
  Respond: "Branch X is attached to an active worktree. Remove the worktree first."
- **Never push --delete a remote branch** that is attached to a local worktree.
