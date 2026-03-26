---
name: daily-stale-changes-check
description: Check ~/.claude worktrees AND all git repos under ~/projects for uncommitted or unpushed changes.
---

Check for uncommitted or unpushed changes across two scopes:

**Scope 1 — ~/.claude dotclaude repo:**
1. List all worktrees: `git -C ~/.claude worktree list`
2. Check each worktree for dirty state: `git -C <path> status --porcelain`
3. Check for unpushed branches: `git -C ~/.claude branch -vv` — find branches ahead of remote or without tracking.
4. Check for orphaned worktree directories in `~/.claude/.claude/worktrees/`.

**Scope 2 — User project repos:**
1. Find all git repositories under `C:\Users\Jerem` (max depth 3) by searching for `.git` directories. Exclude `node_modules`, `.claude/worktrees`, `AppData`, and hidden folders.
   Use: `find /c/Users/Jerem -maxdepth 3 -name .git -type d 2>/dev/null | grep -v node_modules | grep -v '.claude/.claude/worktrees' | grep -v AppData`
2. For each found repo, run `git -C <repo-path> status --porcelain` to check for uncommitted changes.
3. For each found repo, run `git -C <repo-path> log --branches --not --remotes --oneline` to find unpushed commits.
4. For each found repo, check for stash entries: `git -C <repo-path> stash list`.

**Report (German):**
- If everything is clean: "Alles sauber — keine offenen Änderungen gefunden."
- If issues found, structured list grouped by repo:
  - Uncommitted changes (file count + repo name)
  - Unpushed commits (branch + count ahead)
  - Stash entries
  - (For ~/.claude scope) Orphaned worktree directories
- End each finding with a suggested action.

**Constraints:**
- All output in German.
- Read-only audit — do not make any changes.
- Use Bash for git commands, Glob for directory listing.