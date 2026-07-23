---
name: devops-setup-cleanup
version: 0.5.0
description: >-
  Analyze repository branch hygiene: unmerged branches, stale locals with deleted
  remotes, active sessions (worktrees), verify work landed in main. Results:
  interactive concept page with filters, 2-state delete controls, inline detail
  expand, and an Apply-Manifest + Dry-Run-Confirm before executing cleanup.
  Triggers on: "repo health", "branch cleanup", "branch hygiene".
  Explicit user request only.
argument-hint: "[optional: focus area — branches, sessions, PRs]"
allowed-tools: Bash(git *), Bash(gh *), Bash(start *), Bash(cmd *), Read, Write, Glob, Grep, AskUserQuestion, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__Claude_in_Chrome__*, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Repo Health Check

Analyze the repository for branch hygiene, unmerged work, and cleanup opportunities.
Present results as an interactive concept page with filters and decision controls.

## Step 0 — Scope selection (AskUserQuestion)

Before any git command, ask the user for scope:

```
Welches Repository soll analysiert werden?

  (●) Aktuelles Projekt — <repo-name> (<local-path>)   ← vorausgewählt
  ( ) Alle Projekte — aus ~/.claude/projects/ Registry

"Alle": zeigt zuerst eine Repo-Übersicht (welches Repo hat wie viel
aufzuräumen), dann Drill-down in einzelne Repos — KEIN globales
übergreifendes Bulk-Delete.
```

DEFAULT = current project (pre-selected). "Alle" is the explicit opt-in.
If "Alle" is selected: first generate a repo-overview page showing per-repo
counts, then let the user pick one repo for the standard single-repo flow.
Discovery: read `~/.claude/projects/` registry, dedupe (many entries are
worktree subdirs or dead paths — skip paths where `git rev-parse --show-toplevel`
fails or is a subdirectory of another already-listed root), fetch in parallel,
lazy. NO global cross-repo select-all.

## Step 0b — Repo-mode check

Before any git command, verify this directory is a git repository:

```bash
git rev-parse --is-inside-work-tree
```

If this fails (exit != 0), abort:

> Repo health analysiert git-Branches/Sessions — in einer Nicht-Git-Dir gibt es
> nichts zu pruefen. Aborting.

Do NOT proceed. End the skill.

## SAFETY: Worktree Branch Protection

**HARD RULE — no exceptions:**
Branches attached to active worktrees (Aktive Sessions) are UNTOUCHABLE. You MUST NOT:
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

4. **Analyze each active worktree** (each is an „Aktive Session") for content status:
   - `git -C <worktree_path> status --porcelain` — uncommitted / untracked files
   - `git log --oneline origin/main..<branch>` — commits not yet in main
   - Classify each Aktive Session:
     - `has-changes` — uncommitted files OR untracked files OR commits ahead of main
     - `clean` — no local modifications AND no commits ahead
   - For `has-changes`: collect counts (modified, added, untracked files) and
     commit-ahead count for display
   - **clean Aktive Sessions are placed in the Löschbar group but NOT pre-checked**
     (default = keep); the user must consciously opt in to removing them.

## Step 3 — Branch Classification

Every entry is a **git branch** (a ref). The two attributes per entry are:
- **Typ**: "Aktive Session" (branch WITH a checked-out worktree directory) or
  "Git-Session" (plain branch without a worktree)
- **Ort**: "lokal" / "nur-remote" / "lokal+remote"

For each local branch (excluding worktree/Aktive-Session branches):

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

Classify each branch (Git-Session) into one of two top categories that
**partition** all entries and **sum** to the total:

| Category | Meaning | Default checkbox |
|----------|---------|-----------------|
| 🟢 **Löschbar** | MERGED or SQUASH-MERGED Git-Sessions | Pre-checked (delete) |
| 🟡 **Untersuchen** | UNMERGED Git-Sessions (no PR or open PR) | Unchecked (keep) |

Aktive Sessions (worktree branches) are always placed in their own dedicated
block per c6 — never mixed into the Git-Session list.

## Step 4 — Remote Branch Audit

After `fetch --prune`, check for remaining remote branches that are NOT `origin/main`:

- For each: check if merged into `origin/main` or has a merged PR
- Classify as Löschbar or Untersuchen
- Track separately as remote-only branches (Ort = "nur-remote")

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

## Step 7 — Gather Inline Detail Data

For EVERY entry (both Löschbar and Untersuchen), gather up-front the data
needed for the inline „?" detail panel. This replaces the old multi-iteration
investigate loop — data is collected once, shown on-expand, no second round.

For each Git-Session branch (regardless of category):

1. **Full commit log** against `origin/main`:
   ```bash
   git log --format='%h|%s|%cr|%an' origin/main..<branch>
   ```
2. **Diff summary by file** (exclude CHANGELOG.md):
   ```bash
   git diff --numstat origin/main...<branch> -- . ':(exclude)CHANGELOG.md'
   ```
3. **Branch age and activity:**
   ```bash
   git log --reverse --format='%ct' origin/main..<branch> | head -1
   git log -1 --format='%ct' <branch>
   ```
4. **PR status:** `gh pr list --head <branch> --state all --limit 5 --json number,title,state,mergedAt,createdAt,url`
5. **Squash-merge cross-check** for Untersuchen branches with no PR.
6. **WIP heuristic** on commit subjects.
7. **Inline recommendation** — apply the same rules as in `deep-knowledge/investigation.md`
   and produce a short label (e.g. "3 ungeschippte Commits — ship empfohlen").

For each Aktive Session (worktree):
- Gather modified file list, untracked files, commits-ahead data (same as investigation.md).
- Inline recommendation label (e.g. "85 Zeilen — commit + ship empfohlen").

All data is embedded in the HTML at first render, hidden behind a `<details>`
expand. No round-trip to Claude is needed to view it.

## Step 8 — Generate Concept Page

Build a **self-contained HTML concept page** using the `dashboard` variant.
Follow the design system and full HTML/CSS/JS scaffold in
`skills/devops-concept/deep-knowledge/templates.md` — the authoritative source,
referenced by name (not by concept's step numbers, which drift).

### Page Structure & Tooltips

The full ASCII mockup of the page (header, KPI summary, Aktive-Sessions section,
filter bar, branch list grouped into Löschbar / Untersuchen, Apply-Manifest
sidebar, main-sync section) and the mandatory tooltip table for every action
control live in `deep-knowledge/page-structure.md`.

### Filter Behavior

- Filters toggle visibility of branch cards by category
- When a filter is active and the user clicks select-all, show a Gmail-style
  banner: "Alle N gefilterten markieren (vs. M sichtbar)" — bulk selection must
  never silently act only on rendered rows.
- Filter state is preserved in the decisions JSON so Claude knows what the
  user was looking at when they submitted
- Counter in Apply-Manifest sidebar updates based on checked items across ALL
  categories (not just visible ones)

### Decision Schema

The submit payload shape (repo metadata, filter state, per-branch decisions,
Aktive-Session actions, global options, comments) is documented in
`deep-knowledge/decision-schema.md`. The schema uses 2-state controls:
delete (checked) or keep (unchecked). The inline „?" detail is read-only and
does NOT add a third action state.

### File Location

Write to: `~/.claude/devops-concepts/{date}-repo-health.html`
(resolves to `$USERPROFILE/.claude/devops-concepts/` on Windows, `$HOME/.claude/devops-concepts/` on Unix).
User-global, not project-scoped — reports are ephemeral review artifacts, not repo content.
The `ss.permissions.ensure.js` SessionStart hook pre-approves writes to this path so no permission prompt fires.
Create the directory if missing: `mkdir -p ~/.claude/devops-concepts` (Unix) or `mkdir "%USERPROFILE%\.claude\devops-concepts" 2>nul` (Windows).

### Important Design Details

- Branch names in monospace font, visually prominent
- Category badges with distinct colors: green (Löschbar), amber (Untersuchen),
  blue (Aktive Session)
- Branch action controls are a **single delete checkbox** per row (NOT a radio group):
  - Checked = löschen, unchecked = behalten
  - Löschbar group: safe-delete items pre-checked; clean Aktive Sessions NOT pre-checked
  - Untersuchen group: all items unchecked (user opts in consciously)
- Aktive Sessions section is visually distinct from Git-Session list (different
  background tint, dedicated header, never mixed into the branch cards)
- Aktive Sessions with changes (has-changes): amber badge, file summary, NO
  destructive controls. Only a read-only „?" inline detail toggle is shown.
- Aktive Sessions without changes (clean): gray badge, delete checkbox (unchecked
  by default, i.e. keep); removes the worktree only — the branch is NOT deleted.
- Every action option has a `title` tooltip — see Tooltip Explanations table
- "Remote-Branches auch loeschen" as a global toggle in the Apply-Manifest sidebar
  (not per-branch) — applies to all selected branches that have a remote
- Smooth expand/collapse for „?" inline detail panels
- "Alles aufklappen" button per section to expand all inline details at once
- Dark/light mode toggle in header
- Löschbar group: expandable, **open by default**
- Untersuchen group: expandable, **collapsed by default**

## Step 9 — Open & Monitor

Open the page in the browser and monitor for the submit signal.
Follow the open + monitor bridge in
`skills/devops-concept/deep-knowledge/bridge-server.md` (server launch,
Edge-open, heartbeat + decision polling), respecting the
**Edge Credo** (`deep-knowledge/browser-tool-strategy.md` § Edge Credo):
new tab in running Edge, user's profile context, Claude extension for interaction.

```bash
start "" msedge "file:///$(cygpath -m "{filepath}")"

# Track the opened report so /devops-ship can re-open it from the main-repo
# path after a future worktree cleanup (issue #160).
node "$CLAUDE_PLUGIN_ROOT/scripts/session-open-tracker.js" track \
  "$(cygpath -w "{filepath}")" \
  --context=repo-health
```

**Windows note:** always run `{filepath}` through `cygpath -m` before
prefixing `file:///` — raw `$(pwd)`-style paths produce a broken
`file:///c/Users/...` URL (missing drive colon → `ERR_FILE_NOT_FOUND`).
See `deep-knowledge/browser-file-urls.md`.

Inform the user:

> Repo-Health geoeffnet. Löschbar-Gruppe ist vorausgefuellt — hake ab, was du
> behalten willst. Untersuchen-Gruppe ist eingeklappt — klappe auf und hake an,
> was du loeschen willst. Klick „?" fuer Inline-Details pro Eintrag.
> Submit startet Dry-Run-Vorschau bevor irgendetwas passiert.

## Step 10 — Execute Decisions

When the user submits via the concept page:

1. **Read decisions** from `#concept-decisions` JSON.
2. **Partition items by action:**
   - Branches with `delete: true` -> Step 10a (cleanup)
   - Aktive Sessions (clean) with `remove: true` -> Step 10a (cleanup)
   - Everything else -> no-op (keep)
3. **Re-check worktree branches** — run `git worktree list --porcelain` again
   and rebuild the protected set. NEVER trust cached data for deletion.
4. **Validate** every branch marked for deletion:
   - Is it in the protected set? -> SKIP with warning, update page
   - Does it still exist? -> Skip silently if already gone

### Step 10a — Apply-Manifest + Dry-Run-Confirm

Before executing any action, generate the **Apply-Manifest**: a complete list
of everything that will happen, shown to the user for confirmation.

**Apply-Manifest format:**

```
Folgende Aktionen werden ausgeführt:

Lokal löschen (N):
  - branch-a
  - branch-b

Remote löschen (M):
  - branch-a (origin)

Worktrees entfernen (K):
  - claude/old-session (/path/to/worktree)

Main synchronisieren: ja / nein
Remote prunen: ja / nein
```

Then show a **Dry-Run-Confirm** prompt before executing:

> Löscht N lokal, M remote, entfernt K Worktrees.
> Lokales Löschen und remote Löschen ist NICHT rückgängig zu machen.
> Fortfahren?  [Ja] [Abbrechen]

Only proceed after explicit confirmation.

### Step 10b — Cleanup Execution

Execute in order after Dry-Run-Confirm:
   a. Delete selected local branches: `git branch -D <branch>`
   b. If `delete_remote` is true: `git push origin --delete <branch>` for
      each selected branch that has a remote
   c. Remove selected clean worktrees: `git worktree remove <path>` (no --force)
      - Re-check `git -C <path> status --porcelain` immediately before each removal.
        If ANY output → SKIP with warning: "Worktree hat inzwischen Aenderungen —
        Entfernung abgebrochen."
   d. If `prune_worktrees` is true: `git worktree prune`
   e. `git remote prune origin`
   f. If `sync_main` is true: `git checkout main && git pull origin main`,
      then return to original branch

Update the concept page via browser eval:
   - Mark completed deletions with a green checkmark
   - Mark skipped items with a warning icon + reason
   - Show summary: "X Branches geloescht, Y uebersprungen"

Persist results to `~/.claude/devops-concepts/{date}-repo-health-decisions.json`.

### Safety Invariants

- **Never delete a worktree-attached branch** — even if checked by the user.
  Show a warning on the page: "Branch X ist an einen aktiven Worktree gebunden.
  Entferne zuerst den Worktree."
- **Re-validate before every delete** — the state may have changed since
  the page was generated.
- **Never push --delete a remote branch** that is attached to a local worktree.
- **Log every action** with branch name and result (deleted / skipped / error).

### Worktree Removal Safety

Worktree removal (action `remove: true` in the decisions JSON) is only allowed
for Aktive Sessions classified as `clean` in Step 2. Enforce these rules:

1. **Re-check before removal:** Run `git -C <worktree_path> status --porcelain`
   again immediately before acting. If ANY output → SKIP with warning:
   "Worktree hat inzwischen Aenderungen — Entfernung abgebrochen."
2. **Never force-remove:** Use `git worktree remove <path>` (without `--force`).
   If it fails, report the error — do NOT retry with `--force`.
3. **Never discard changes:** If a worktree (Aktive Session) has `status: has-changes`,
   the UI must NOT render any DESTRUCTIVE action controls — no delete checkbox,
   no "discard", no "reset", no implicit-cleanup option. The ONLY allowed
   interactive element is the read-only „?" inline detail toggle (no destructive
   action can be triggered from it). Even when the inline detail recommends
   `discard`, the action stays advisory: the user must commit or checkout
   manually. This is enforced in the HTML generation, not just in execution.
4. **Branch cleanup after removal:** After successfully removing a clean
   worktree, the associated branch is NOT automatically deleted. The branch
   can be scheduled for deletion via the normal Löschbar flow, but it must
   be checked independently (check that it is not the current branch in the
   main repo first).

## Step 11 — Completion Card

Trigger this step only when the run is **done** — i.e. the user closed the
monitor or the most recent submit was processed.

When triggered, call `mcp__plugin_devops_dotclaude-completion__render_completion_card`:

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
