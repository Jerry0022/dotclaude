---
name: daily-stale-changes-check
description: Check all ~/.claude worktrees and branches for uncommitted or unpushed changes from archived sessions.
---

Check for uncommitted or unpushed changes in the ~/.claude dotclaude repository that may have been left behind by archived Claude Code sessions.

## Steps

1. **List all worktrees:** Run `git -C ~/.claude worktree list` to find all active worktrees (main repo + any under `~/.claude/.claude/worktrees/`).

2. **Check each worktree for dirty state:**
   - For each worktree path, run `git -C <path> status --porcelain`.
   - If output is non-empty, record the worktree name and a summary of changed files.

3. **Check for unpushed branches:**
   - Run `git -C ~/.claude branch -vv` to see all local branches and their tracking status.
   - Identify branches that are ahead of their remote (contain `[origin/...: ahead N]`) or have no remote tracking branch at all (excluding `main`).
   - For branches without a remote, check if they have commits not on main: `git -C ~/.claude log main..<branch> --oneline`.

4. **Check for orphaned worktree directories:**
   - List directories in `~/.claude/.claude/worktrees/` and compare against `git worktree list` output.
   - Flag any directories that exist on disk but aren't registered as worktrees.

5. **Report findings:**
   - If everything is clean: Reply with a short "Alles sauber — keine offenen Änderungen gefunden."
   - If issues found: Reply in German with a structured list:
     - Worktrees with uncommitted changes (file count + worktree name)
     - Unpushed branches (branch name + how many commits ahead)
     - Orphaned worktree directories
   - End with a suggested action for each finding (e.g., "commit & push", "branch löschen", "worktree aufräumen").

## Constraints
- All output in German.
- Do not make any changes — this is a read-only audit.
- Use dedicated tools (Bash for git commands, Glob for directory listing) rather than guessing.