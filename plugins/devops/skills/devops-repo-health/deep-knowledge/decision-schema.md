# Repo-Health Decision Schema

Submit payload shape collected by the concept page and POSTed back via
the bridge server. Claude reads this in Step 10 to execute the user's
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
    "loeschbar": true,
    "untersuchen": true,
    "nur-remote": true
  },
  "decisions": [
    {
      "id": "branch-feature-xyz",
      "branch": "feature/xyz",
      "typ": "Git-Session",
      "ort": "lokal+remote",
      "kategorie": "loeschbar",
      "delete": true
    },
    {
      "id": "branch-old-experiment",
      "branch": "old-experiment",
      "typ": "Git-Session",
      "ort": "lokal",
      "kategorie": "untersuchen",
      "delete": false
    },
    {
      "id": "branch-stale-wip",
      "branch": "stale-wip",
      "typ": "Git-Session",
      "ort": "lokal+remote",
      "kategorie": "untersuchen",
      "delete": true
    }
  ],
  "aktiveSessions": [
    {
      "branch": "claude/brave-pike",
      "path": "/repo/.claude/worktrees/brave-pike",
      "typ": "Aktive Session",
      "ort": "lokal",
      "status": "has-changes",
      "modified": 3,
      "untracked": 1,
      "commits_ahead": 2,
      "remove": false
    },
    {
      "branch": "claude/old-session",
      "path": "/repo/.claude/worktrees/old-session",
      "typ": "Aktive Session",
      "ort": "lokal",
      "status": "clean",
      "modified": 0,
      "untracked": 0,
      "commits_ahead": 0,
      "remove": true
    }
  ],
  "options": {
    "delete_remote": true,
    "prune_worktrees": true,
    "sync_main": true
  },
  "comments": [
    { "id": "branch-old-experiment", "text": "Might still need this" }
  ]
}
```

**Notes:**

- `decisions[].delete` — boolean, two states only: `true` = löschen, `false` = behalten.
  There is no `"investigate"` action value; investigation is handled inline via the
  „?" detail panel (read-only, no submit action required).

- `decisions[].typ` — `"Git-Session"` or `"Aktive Session"` (user-facing category).

- `decisions[].ort` — `"lokal"`, `"nur-remote"`, or `"lokal+remote"`.

- `decisions[].kategorie` — `"loeschbar"` or `"untersuchen"`. Combined with
  `options.delete_remote` to decide the full scope of the delete.

- `aktiveSessions[].remove` — boolean. `true` only valid for `status: clean`
  Aktive Sessions. Triggers `git worktree remove <path>` (never `--force`).
  The associated branch is NOT deleted as part of this action.

- `aktiveSessions` with `status: has-changes` MUST always have `remove: false`.
  The UI must never render a remove control for them; if this value arrives as
  `true` in the payload, Claude must skip with a warning (safety guard).

- `filters` preserves the user's category selection at submit time so Claude
  knows what was visible when the user clicked. This is for logging and
  Apply-Manifest display — not for scoping the actions.

- `options.delete_remote` — when `true`, also delete the remote tracking branch
  for every `decisions` item with `delete: true` and `ort` of `"lokal+remote"`
  or `"nur-remote"`.

- `options.prune_worktrees` — run `git worktree prune` after removals to clean
  up stale worktree references (does NOT touch active Aktive Sessions).

- `options.sync_main` — pull `origin/main` into local `main` after cleanup.

- `comments` — per-item freeform notes captured from the comment fields.
  Logged to the decisions JSON file; do not affect which actions are taken.
