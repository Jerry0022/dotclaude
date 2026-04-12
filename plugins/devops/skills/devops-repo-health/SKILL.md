---
name: devops-repo-health
version: 0.2.0
description: >-
  Analyze repository branch hygiene: find unmerged branches, stale local branches
  with deleted remotes, orphaned worktrees, and verify all work landed in main.
  Results are presented as an interactive concept page with filters and batch actions.
  Use when the user wants a health check of their repo state. Triggers on:
  "repo health", "branch cleanup", "branch check", "was liegt noch rum",
  "unmerged branches", "git aufraumen", "branch hygiene", "repo audit".
  Do NOT trigger automatically — only on explicit user request.
argument-hint: "[optional: focus area — branches, worktrees, PRs]"
allowed-tools: Bash(git *), Bash(gh *), Bash(start *), Bash(cmd *), Read, Write, Glob, Grep, AskUserQuestion, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__Claude_in_Chrome__*
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
  Total branches | Safe to delete | Needs investigation | Active worktrees | Main sync status

[Filter Bar]
  Category toggles: [Sicher loeschbar] [Untersuchen] [Worktrees] [Remote]
  Select all / Deselect all buttons (apply to visible items only)

[Branch List — filterable]
  Per branch card:
    Branch name (monospace, prominent)
    Category badge (color-coded: green=safe, yellow=investigate, blue=worktree)
    PR reference (if exists): #123 — title
    Merge status: merged / squash-merged / unmerged / no PR
    Last commit: hash + message + relative date
    Diff stats: X files changed (excluding CHANGELOG)
    Remote status: exists / gone / n/a

    [Action controls — only for safe-delete and investigate categories]:
      Checkbox: "Loeschen" (pre-checked for safe-delete, unchecked for investigate)
      Optional comment field (collapsed by default, expandable)

    [Worktree cards — info only]:
      Worktree path shown
      No action controls
      Visual distinction (muted, no checkbox)

[Main Sync Section]
  Current status: up to date / X commits behind
  Checkbox: "Main synchronisieren" (pre-checked if behind)

[Decision Panel Sidebar]
  Summary: "X Branches zum Loeschen ausgewaehlt"
  Live counter updates as checkboxes change
  Grouped summary: Y local + Z remote branches
  Checkbox: "Remote-Branches auch loeschen" (default: checked)
  Checkbox: "Worktrees prunen" (default: checked)
  Submit button: "Aufraeumen starten"
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
- Worktree cards are visually muted (lower opacity, no checkbox, info icon)
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
start "" msedge "{filepath}"
```

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

## Rules

- Concept page is the primary output — do NOT also dump a markdown report
- Repo context (name, path, remote) is always visible in the page header
- German UI labels unless project overrides
- Self-contained HTML, no external dependencies
- Keep file size reasonable (< 500KB)
