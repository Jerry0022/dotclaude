#!/bin/bash
# Hook: On session start, pull main and merge into current branch if in a worktree.
# Runs silently — only outputs on errors.

set -e

# Ensure we're in a git repo
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
MAIN_BRANCH="main"

# Detect if a remote exists
REMOTE=$(git remote 2>/dev/null | head -1)
[ -z "$REMOTE" ] && exit 0

# Fetch latest from remote
git fetch "$REMOTE" "$MAIN_BRANCH" --quiet 2>/dev/null || exit 0

if [ "$CURRENT_BRANCH" = "$MAIN_BRANCH" ]; then
  # On main — just pull
  git merge "$REMOTE/$MAIN_BRANCH" --ff-only --quiet 2>/dev/null || true
else
  # In a worktree/branch — update local main ref, then merge into current branch
  git fetch "$REMOTE" "$MAIN_BRANCH:$MAIN_BRANCH" --quiet 2>/dev/null || true
  git merge "$MAIN_BRANCH" --no-edit --quiet 2>/dev/null || {
    echo "⚠ Merge-Konflikt beim Mergen von main in $CURRENT_BRANCH. Bitte manuell lösen."
    git merge --abort 2>/dev/null || true
  }
fi
