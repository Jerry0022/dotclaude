---
name: stale-changes-check
description: Daily audit for uncommitted or unpushed changes across configured repos.
version: 0.1.0
schedule: "0 9 * * *"
---

# Stale Changes Check

Read-only audit for uncommitted, unpushed, or stashed changes.

## Scope

### Scope 1: Current project (always)

Check the current working directory:

1. `git status --porcelain` — uncommitted changes
2. `git log --branches --not --remotes --oneline` — unpushed commits
3. `git stash list` — stash entries
4. `git worktree list` — check each worktree for dirty state

### Scope 2: Additional repos (configurable)

If the user has defined additional repos to monitor, check those too.

**Configuration** via project or global extension:

```
~/.claude/scheduled-tasks/stale-changes-check/reference.md
```

Example reference.md:
```markdown
## Repos to monitor
- ~/IdeaProjects/my-app
- ~/IdeaProjects/my-other-app
- ~/work/client-project
```

If no reference.md exists → only check Scope 1 (cwd).

## Report (in user's language)

If everything clean:
> "Alles sauber — keine offenen Änderungen gefunden."

If issues found, structured report grouped by repo:

```
## Stale Changes Report

### my-app (~/IdeaProjects/my-app)
- 3 uncommitted files
- Branch `feat/dark-mode`: 2 commits ahead of remote
- 1 stash entry
→ Empfehlung: Commit + Push oder Stash auflösen

### my-other-app (~/IdeaProjects/my-other-app)
- Clean ✓
```

**Summary table** at the end, sorted by severity (most issues first).

## Constraints

- Read-only — do not make any changes
- Use Bash for git commands
- All paths use `~` or relative — never hardcoded absolute paths
- Skip repos that don't exist or aren't accessible
