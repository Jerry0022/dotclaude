# Repo-Health Decision Schema

Submit payload shape collected by the concept page and POSTed back via
the bridge server. Claude reads this in Step 9 to execute the user's
cleanup decisions.

```json
{
  "submitted": true,
  "repo": {
    "name": "dotclaude",
    "path": "/path/to/repo",
    "remote": "git@github.com:user/repo.git"
  },
  "filters": {
    "safe-delete": true,
    "investigate": true,
    "worktree": false,
    "remote": true
  },
  "decisions": [
    {
      "id": "branch-feature-xyz",
      "branch": "feature/xyz",
      "category": "safe-delete",
      "action": "delete",
      "scope": "local+remote"
    },
    {
      "id": "branch-old-experiment",
      "branch": "old-experiment",
      "category": "investigate",
      "action": "skip"
    }
  ],
  "worktrees": [
    {
      "branch": "claude/brave-pike",
      "path": "/repo/.claude/worktrees/brave-pike",
      "status": "has-changes",
      "modified": 3,
      "untracked": 1,
      "commits_ahead": 2,
      "action": "keep"
    },
    {
      "branch": "claude/old-session",
      "path": "/repo/.claude/worktrees/old-session",
      "status": "clean",
      "modified": 0,
      "untracked": 0,
      "commits_ahead": 0,
      "action": "remove"
    }
  ],
  "options": {
    "delete_remote": true,
    "prune_worktrees": true,
    "sync_main": true
  },
  "comments": [
    { "id": "branch-old-experiment", "text": "Might need this later" }
  ]
}
```

**Notes:**
- `action` for branches: `"delete"` or `"skip"`.
- `action` for worktrees: `"keep"` or `"remove"` (only for `status: clean`).
- `scope`: `"local"` or `"local+remote"` — combined with global
  `options.delete_remote` to decide the final scope.
- `filters` preserves the user's category selection at submit time so
  Claude knows what was visible when the user clicked.
