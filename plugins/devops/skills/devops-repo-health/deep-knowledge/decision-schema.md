# Repo-Health Decision Schema

Submit payload shape collected by the concept page and POSTed back via
the bridge server. Claude reads this in Step 9 to execute the user's
cleanup decisions.

```json
{
  "submitted": true,
  "iteration": 1,
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
      "action": "investigate"
    },
    {
      "id": "branch-stale-wip",
      "branch": "stale-wip",
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
      "action": "investigate"
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
    { "id": "branch-old-experiment", "text": "Might still need this — please dig deeper" }
  ]
}
```

**Notes:**
- `iteration` — counter starting at `1`. Incremented when Claude regenerates
  the page after an `investigate` round so the user can distinguish initial
  vs. follow-up analysis. Iteration ≥ 2 pages contain a `deepDive` block per
  investigated item (see `investigation.md`).
- `action` for branches: `"delete"`, `"skip"`, or `"investigate"`.
- `action` for worktrees: `"keep"`, `"remove"`, or `"investigate"`. `"remove"`
  is only valid for `status: clean` worktrees.
- `scope`: `"local"` or `"local+remote"` — combined with global
  `options.delete_remote` to decide the final scope.
- `filters` preserves the user's category selection at submit time so
  Claude knows what was visible when the user clicked.
- An item with `action: "investigate"` is **deferred** — it is NOT deleted,
  removed, or otherwise modified in this iteration. Claude gathers deep-dive
  data on it and regenerates the page as iteration 2 with enriched info and
  a recommended reclassification.
