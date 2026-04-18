---
name: devops-repo-health
version: 0.3.0
description: >-
  Analyze repository branch hygiene: unmerged branches, stale locals with deleted
  remotes, orphaned worktrees, verify work landed in main. Results: interactive
  concept page with filters and batch actions. Triggers on: "repo health",
  "branch cleanup", "was liegt noch rum", "git aufräumen", "branch hygiene".
  Explicit user request only.
argument-hint: "[optional: focus area — branches, worktrees, PRs]"
allowed-tools: Bash(git *), Bash(gh *), Bash(start *), Bash(cmd *), Read, Write, Glob, Grep, AskUserQuestion, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__Claude_in_Chrome__*, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Repo Health Check

Analyze the repository for branch hygiene, unmerged work, and cleanup opportunities.
Present results as an interactive concept page with filters and decision controls.

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

**Detection:** `git worktree list --porcelain` -> every line starting with
`branch refs/heads/` is a protected branch. Build this set FIRST and check
it before EVERY delete operation.

## Step 1 — Repo Context

Gather repository identity info to display prominently on the concept page:

1. **Repo name:** `basename $(git rev-parse --show-toplevel)`
2. **Local path:** `git rev-parse --show-toplevel`
3. **Remote URL:** `git remote get-url origin`
4. **Current branch:** `git branch --show-current`
5. **Default branch:** typically `main` or `master`

This info appears as a header card on the concept page so the user always
knows which repo they're looking at.

## Step 2 — Fetch & Sync

Run in parallel:

1. `git fetch --all --prune` — sync with remote and remove stale tracking refs
2. `git worktree list --porcelain` — list active worktrees, extract protected branches
3. `git branch -a --no-color` — list all local and remote branches

Build the **protected branch set** from worktree output. Every branch in this set
is excluded from ALL subsequent steps — classification, recommendations, AND cleanup.

4. **Analyze each active worktree** for content status:
   - `git -C <worktree_path> status --porcelain` — uncommitted / untracked files
   - `git log --oneline origin/main..<branch>` — commits not yet in main
   - Classify each worktree:
     - `has-changes` — uncommitted files OR untracked files OR commits ahead of main
     - `clean` — no local modifications AND no commits ahead
   - For `has-changes`: collect counts (modified, added, untracked files) and
     commit-ahead count for display

## Step 3 — Branch Classification

For each local branch (excluding worktree branches):

1. **Check merge status against `origin/main`:**
   - `git merge-base --is-ancestor <branch> origin/main` -> MERGED (git ancestor)
   - If not ancestor: check if the branch has a corresponding **merged PR** on GitHub
     (`gh pr list --state merged --head <branch> --json number,mergedAt --limit 1`)
   - If merged PR found -> SQUASH-MERGED (content in main via squash, but git doesn't know)
   - If neither -> UNMERGED

2. **Check remote tracking status:**
   - `git branch -vv` -> look for `[origin/...: gone]` markers
   - gone = remote branch was deleted (typically after PR merge)

3. **Compute diff against main (excluding CHANGELOG.md):**
   - `git diff --stat origin/main...<branch> -- . ':(exclude)CHANGELOG.md'`
   - This shows whether the branch has substantive changes beyond changelog entries

4. **Last commit info:**
   - `git log -1 --format="%h %s (%cr)" <branch>` — hash, message, relative date

Classify each branch into one of:

| Category | Meaning | Default action |
|----------|---------|----------------|
| `safe-delete` | MERGED or SQUASH-MERGED | Pre-checked for deletion |
| `investigate` | UNMERGED, no PR or open PR | Unchecked, needs review |
| `worktree` | Attached to a worktree | Info only, no action controls |

## Step 4 — Remote Branch Audit

After `fetch --prune`, check for remaining remote branches that are NOT `origin/main`:

- For each: check if merged into `origin/main` or has a merged PR
- Classify as `safe-delete` or `investigate`
- Track separately as remote-only branches

## Step 5 — PR Cross-Reference

Fetch recent PRs to validate branch status:

```
gh pr list --state all --limit 30 --json number,title,state,mergedAt,headRefName
```

Cross-reference with local branches:
- Every MERGED PR should have its branch cleaned up (locally and remotely)
- Every local branch should map to a PR (open, merged, or closed)
- Flag orphan branches with no PR (work that was never shipped)

## Step 6 — Local vs Remote Main Sync

```
git log --oneline main -1
git log --oneline origin/main -1
```

Verify local `main` is up to date with `origin/main`. Flag if behind.

## Step 7 — Generate Concept Page

Build a **self-contained HTML concept page** using the `dashboard` variant.
Follow the design system and patterns from `/devops-concept` (see Step 2 of
the concept skill for full HTML/CSS/JS requirements).

### Page Structure

```
[Header]
  Repo name (large)
  Local path | Remote URL | Current branch | Default branch
  Last fetch timestamp

[Summary KPI Cards]
  Total branches | Safe to delete | Needs investigation | Active worktrees (X with changes / Y clean) | Main sync status

[Active Worktrees Section — DEDICATED, separate from branch list]
  Only shown if worktrees exist. NOT part of the branch list below.
  Per worktree card:
    Branch name (monospace) + worktree path (smaller, muted)
    Status badge:
      - "Mit Aenderungen" (amber badge) if has-changes
      - "Sauber" (gray badge) if clean
    If has-changes:
      File summary: "X geaendert, Y ungetrackt" (compact inline)
      Commits ahead: "Z Commits vor main" (if any)
      Visual: info icon, no action controls, clearly labeled read-only
      HARD RULE: NO delete, discard, reset, or cleanup options whatsoever
    If clean:
      "Keine lokalen Aenderungen"
      Optional: "Worktree entfernen" checkbox (UNCHECKED by default)
      Tooltip on checkbox — see Tooltip section below
  Card styling: subtle border, lower visual weight than branch cards,
  distinct background tint (e.g. blue-gray) to avoid confusion with branches

[Filter Bar]
  Category toggles: [Sicher loeschbar] [Untersuchen] [Remote]
  (NO worktree toggle — worktrees have their own section above)
  Select all / Deselect all buttons (apply to visible items only)

[Branch List — filterable, excludes worktree branches]
  Per branch card:
    Branch name (monospace, prominent)
    Category badge (color-coded: green=safe, yellow=investigate)
    PR reference (if exists): #123 — title
    Merge status: merged / squash-merged / unmerged / no PR
    Last commit: hash + message + relative date
    Diff stats: X files changed (excluding CHANGELOG)
    Remote status: exists / gone / n/a

    [Action controls — only for safe-delete and investigate categories]:
      Checkbox: "Loeschen" (pre-checked for safe-delete, unchecked for investigate)
      Tooltip on checkbox — see Tooltip section below
      Optional comment field (collapsed by default, expandable)

[Main Sync Section]
  Current status: up to date / X commits behind
  Checkbox: "Main synchronisieren" (pre-checked if behind)

[Decision Panel Sidebar]
  Summary: "X Branches zum Loeschen ausgewaehlt"
  Live counter updates as checkboxes change
  Grouped summary: Y local + Z remote branches
  Checkbox: "Remote-Branches auch loeschen" (default: checked) + tooltip
  Checkbox: "Worktrees prunen" (default: checked) + tooltip
  Submit button: "Aufraeumen starten"

### Tooltip Explanations

Every action control and global option MUST have an explanatory tooltip
(HTML `title` attribute) so the user understands the effect before acting.

| Element | Tooltip text |
|---------|-------------|
| "Loeschen" checkbox (safe-delete) | "Branch lokal loeschen. Arbeit ist bereits in main (merged/squash-merged)." |
| "Loeschen" checkbox (investigate) | "Branch lokal loeschen. ACHTUNG: Aenderungen sind moeglicherweise NICHT in main!" |
| "Remote-Branches auch loeschen" | "Loescht die Branches auch auf GitHub/origin. Betrifft nur die oben ausgewaehlten Branches." |
| "Worktrees prunen" | "Entfernt verwaiste Worktree-Referenzen (bereits geloeschte Verzeichnisse). Aktive Worktrees werden NICHT beruehrt." |
| "Main synchronisieren" | "Holt die neuesten Aenderungen von origin/main und aktualisiert den lokalen main-Branch." |
| "Worktree entfernen" (clean only) | "Entfernt den Worktree und seinen Branch. Nur moeglich bei Worktrees ohne lokale Aenderungen." |
| "Select all" button | "Alle sichtbaren Branches zum Loeschen markieren." |
| "Deselect all" button | "Alle sichtbaren Branches abwaehlen." |

Implement tooltips as `title` attributes on the label/checkbox wrapper.
Keep text concise — one sentence max, no jargon.
```

### Filter Behavior

- Filters toggle visibility of branch cards by category
- "Select all / Deselect all" buttons only affect **currently visible** cards
- Filter state is preserved in the decisions JSON so Claude knows what the
  user was looking at when they submitted
- Counter in decision panel updates based on checked items across ALL
  categories (not just visible ones)

### Decision Schema

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

### File Location

Write to: `{project}/.claude/devops-concept/{date}-repo-health.html`

### Important Design Details

- Branch names in monospace font, visually prominent
- Category badges with distinct colors: green (safe), amber (investigate),
  blue (worktree), purple (remote-only)
- Pre-check "Loeschen" for safe-delete branches to reduce clicks
- Worktree section is visually distinct from branch list (different background
  tint, dedicated header, never mixed into the branch cards)
- Worktrees with changes: amber badge, file summary, NO action controls at all
- Worktrees without changes: gray badge, optional remove checkbox (unchecked)
- Every action option has a `title` tooltip — see Tooltip Explanations table
- "Remote-Branches auch loeschen" as a global toggle in the decision panel
  (not per-branch) — applies to all selected branches that have a remote
- Smooth expand/collapse for comment fields
- Dark/light mode toggle in header

## Step 8 — Open & Monitor

Open the page in the browser and monitor for the submit signal.
Follow `/devops-concept` Step 3 (Open) and Step 4 (Monitor), respecting the
**Edge Credo** (`deep-knowledge/browser-tool-strategy.md` § Edge Credo):
new tab in running Edge, user's profile context, Claude extension for interaction.

```bash
start "" msedge "file:///$(cygpath -m "{filepath}")"
```

**Windows note:** always run `{filepath}` through `cygpath -m` before
prefixing `file:///` — raw `$(pwd)`-style paths produce a broken
`file:///c/Users/...` URL (missing drive colon → `ERR_FILE_NOT_FOUND`).
See `deep-knowledge/browser-file-urls.md`.

Inform the user:

> Repo-Health geoeffnet. Filtere nach Kategorien, waehle Branches zum
> Loeschen aus und klick "Aufraeumen starten" — ich fuehre es dann aus.

## Step 9 — Execute Decisions

When the user submits via the concept page:

1. **Read decisions** from `#concept-decisions` JSON
2. **Re-check worktree branches** — run `git worktree list --porcelain` again
   and rebuild the protected set. NEVER trust cached data for deletion.
3. **Validate** every branch marked for deletion:
   - Is it in the protected set? -> SKIP with warning, update page
   - Does it still exist? -> Skip silently if already gone
4. **Execute in order:**
   a. Delete selected local branches: `git branch -D <branch>`
   b. If `delete_remote` is true: `git push origin --delete <branch>` for
      each selected branch that has a remote
   c. If `prune_worktrees` is true: `git worktree prune`
   d. `git remote prune origin`
   e. If `sync_main` is true: `git checkout main && git pull origin main`,
      then return to original branch
5. **Update the concept page** via browser eval:
   - Mark completed deletions with a green checkmark
   - Mark skipped items with a warning icon + reason
   - Show summary: "X Branches geloescht, Y uebersprungen"
   - Reset submit state for potential second round

6. **Persist results** to `{project}/.claude/devops-concept/{date}-repo-health-decisions.json`

### Safety Invariants

- **Never delete a worktree-attached branch** — even if checked by the user.
  Show a warning on the page: "Branch X ist an einen aktiven Worktree gebunden.
  Entferne zuerst den Worktree."
- **Re-validate before every delete** — the state may have changed since
  the page was generated.
- **Never push --delete a remote branch** that is attached to a local worktree.
- **Log every action** with branch name and result (deleted / skipped / error).

### Worktree Removal Safety

Worktree removal (action `"remove"` in the decisions JSON) is only allowed
for worktrees classified as `clean` in Step 2. Enforce these rules:

1. **Re-check before removal:** Run `git -C <worktree_path> status --porcelain`
   again immediately before acting. If ANY output → SKIP with warning:
   "Worktree hat inzwischen Aenderungen — Entfernung abgebrochen."
2. **Never force-remove:** Use `git worktree remove <path>` (without `--force`).
   If it fails, report the error — do NOT retry with `--force`.
3. **Never discard changes:** If a worktree has `status: has-changes`, the UI
   must NOT render any action controls (no checkbox, no button, no option).
   This is enforced in the HTML generation, not just in execution.
4. **Branch cleanup after removal:** After successfully removing a clean
   worktree, the associated branch can be deleted locally. But check that
   the branch is not the current branch in the main repo first.

## Step 10 — Completion Card

After Step 9 finishes executing (or the user ends the monitor without any
deletions), call `mcp__plugin_devops_dotclaude-completion__render_completion_card`:

| Situation | Variant |
|-----------|---------|
| Branches / remotes / worktrees deleted | `ready` |
| User reviewed but didn't delete anything | `analysis` |
| User aborted mid-flow | `aborted` |

Pass: `variant`, `summary` (e.g. "Repo hygiene — 4 branches cleaned"), `lang`,
`session_id`, `changes` (counts per action: local/remote/worktrees removed),
and `state` when git operations happened. Output the markdown VERBATIM as the
LAST thing in the response.

## Rules

- Concept page is the primary output — do NOT also dump a markdown report
- Repo context (name, path, remote) is always visible in the page header
- German UI labels unless project overrides
- Self-contained HTML, no external dependencies
- Keep file size reasonable (< 500KB)
