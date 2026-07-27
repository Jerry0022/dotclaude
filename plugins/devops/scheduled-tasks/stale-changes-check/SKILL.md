---
name: stale-changes-check
description: Session-start hook that checks for uncommitted/unpushed changes and warns the user only when issues exist.
version: 0.3.0
trigger: SessionStart (hook ss.git.check.js)
---

# Stale Changes Check

Runs automatically at every session start via `hooks/session-start/ss.git.check.js`.
Silent when everything is clean. Only surfaces a brief warning when issues are found.

## What the hook checks

1. `git status --porcelain` — uncommitted changes
2. `git log --branches --not --remotes --oneline` — unpushed commits
3. `git stash list` — stash entries

Always checks the current working directory. Optionally checks additional repos
defined in `~/.claude/scheduled-tasks/stale-changes-check/reference.md`:

```markdown
## Repos to monitor
- ~/IdeaProjects/my-app
- ~/IdeaProjects/my-other-app
```

## Output behaviour

- **Clean** → hook exits silently, nothing shown to user.
- **Issues found** → hook writes a structured summary to stdout; Claude relays a
  brief inline warning to the user (no full report, no table).

Findings are **never coupled to a question**. The hook always emits them and
instructs the assistant to restate them in its final message, before any
completion card. When a workspace issue is also present, the AskUserQuestion
block is layered on top — so an interactive session asks, while a scheduled,
cron or headless session (which cannot answer a modal) still reports what was
found instead of dropping it with the skipped question. See
`hooks/lib/git-check-output.js`.

## Constraints

- Read-only — hook never makes any git changes
- No cron registration — this is a direct SessionStart hook, not a scheduled task
