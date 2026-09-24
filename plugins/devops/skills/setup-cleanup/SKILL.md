---
name: setup-cleanup
version: 0.6.1
description: >-
  Analyze repository branch hygiene: unmerged branches, stale locals with deleted
  remotes, active sessions (worktrees), open PRs that still need to land, verify
  work landed in main. Results: interactive concept page with filters, 2-state
  delete controls, a ship queue for open PRs (each landed via /ship, one after
  another, as if shipped from its own session), inline detail expand, and an
  Apply-Manifest + Dry-Run-Confirm before executing anything.
  Triggers on: "repo health", "branch cleanup", "branch hygiene", "offene PRs
  landen", "open PRs shippen".
  Explicit user request only.
layer: 0
invokes: [ship]
triggers:
  en: ["repo health", "branch cleanup", "branch hygiene"]
  de: ["offene PRs landen", "open PRs shippen"]
argument-hint: "[optional: focus area — branches, sessions, PRs]"
allowed-tools: Bash(git *), Bash(gh *), Bash(node *), Bash(start *), Bash(cmd *), Read, Write, Glob, Grep, AskUserQuestion, Skill, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__Claude_in_Chrome__*, mcp__plugin_devops_dotclaude-completion__render_completion_card, mcp__plugin_devops_dotclaude-ship__*, mcp__ccd_session_mgmt__list_sessions, mcp__ccd_session_mgmt__get_session
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
Branches attached to active worktrees (Aktive Sessions) are UNTOUCHABLE, and so
is **everything else belonging to that session** — its worktree directory, the
repo it lives in, and any process running inside it. The examples below are
examples, not the boundary:
- Delete them locally (`git branch -D`)
- Delete them remotely (`git push origin --delete`)
- Checkout/switch away from them in their worktree
- Remove or prune their worktree (`git worktree remove`, directory deletion)
- Kill a process whose cwd or argv points into their worktree
- Write files into them (including `.gitignore` hygiene fixes)
- Recommend them for deletion
- Include them in any cleanup batch

These branches represent active Claude Code sessions. Deleting them breaks
the worktree and causes data loss.

**The protected set is a set of subjects, not a list of verbs.** A guard that
enumerates forbidden commands permits every command it forgot to name — the
failure mode that let a sweep correctly refuse `branch -D` on a live session
and then remove that session's worktree anyway. Scope rules and the four
operation classes a guard must cover:
`{PLUGIN_ROOT}/deep-knowledge/git-hygiene.md` § Protection scope covers every
operation class.

**Re-check before every destructive action.** A sweep over many repos runs long
enough for sessions to start, stop, or switch branches. Rebuild the protected
set immediately before each delete/remove/kill — never once at classification
time and then trust it for the rest of the run.

**Detection:** `git worktree list --porcelain` -> every line starting with
`branch refs/heads/` is a protected branch, and every `worktree ` line is a
protected **path** — including the detached ones, which have no `branch` line
at all and would otherwise look unprotected. Rebuild this set immediately
before each destructive action, not once at the start.

A worktree registration is not the only evidence of a live session. Also treat
as protected: any path a running process names in its cwd or argv, and any
worktree outside `.claude/worktrees/` (`git worktree list` reports those too —
a path-prefix scan of that directory alone misses them).

**Membership test — exact ref equality only.** A candidate is protected when
its **full branch name** is an element of the set, nothing else:

```bash
printf '%s\n' "${PROTECTED[@]}" | grep -qxF -- "$candidate"   # exact line match
```

NEVER test membership by prefix or substring (`grep -q`, `[[ $set == *$name* ]]`,
`String.includes`). Branch names in this repo's workflows form suffix chains
(`feat/x-abc123`, `feat/x-abc123-def456`): a substring test treats the shorter
independent branch as protected too, so it silently vanishes from every list —
nothing is deleted wrongly, but the candidate count is short with no warning.

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
3. Enumerate candidates from the **truth sources only** — local names from
   `git for-each-ref refs/heads --format='%(refname)'`, remote names from
   `git ls-remote --heads origin`. NEVER from `git branch -a`, `refs/remotes/*`
   or `%(refname:short)`: that shortening turns `refs/remotes/origin/HEAD` into
   a "branch" named `origin` (`{PLUGIN_ROOT}/deep-knowledge/git-hygiene.md` § Deletion
   candidates come from the truth source).

Build the **protected branch set** from worktree output. Every branch in this set
is excluded from ALL subsequent steps — classification, recommendations, AND cleanup.

4. **Analyze each active worktree** (each is an „Aktive Session") for content status:
   - `git -C <worktree_path> status --porcelain` — uncommitted / untracked files
   - `git log --oneline origin/main..<branch>` — commits not yet in main
   - Classify each Aktive Session **solely by the working tree**:
     - `has-changes` — `status --porcelain` is non-empty (uncommitted OR untracked files)
     - `clean` — `status --porcelain` is empty
   - **Commits ahead of `origin/main` are NOT a `has-changes` criterion.** They are
     carried as the separate, non-blocking `commits_ahead` attribute
     (`deep-knowledge/decision-schema.md`). On a squash-merge workflow every
     worktree whose PR already landed is *by construction* ahead forever (the
     merge-base predates the squash), so counting it locked 34 of 41 worktrees in
     one real repo as protected work-in-progress while only 2 carried unsaved work.
   - For a `clean` session that is ahead, additionally run the **own-content
     check** Step 3 already prescribes for branches (two-dot diff, status `A`
     files — `deep-knowledge/investigation.md` § Worktrees): `own_content: true`
     when the commits carry files main does not have, else `false` (content is
     fully in main via squash). Display it as an informational badge, never as a lock.
   - For `has-changes`: collect counts (modified, added, untracked files) and
     commit-ahead count for display
   - **clean Aktive Sessions are placed in the Löschbar group but NOT pre-checked**
     (default = keep); the user must consciously opt in to removing them.

## Step 3 — Branch Classification

Every entry is a **git branch** (a ref). The two attributes per entry are:
- **Typ**: "Aktive Session" (branch WITH a checked-out worktree directory) or
  "Git-Session" (plain branch without a worktree)
- **Ort**: "lokal" / "nur-remote" / "lokal+remote"

For each local branch (excluding worktree/Aktive-Session branches — exclusion by
**exact** protected-set membership, see SAFETY above; never by prefix):

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

**Consistency check (mandatory, end of Step 3):** every local branch must land
in exactly one bucket, so

```
|Löschbar| + |Untersuchen| + |protected set| == |git branch --format='%(refname:short)'|
```

If the sums differ, do NOT continue silently: print a warning naming the count
gap and the branches that appear in no bucket (`comm -23` of all local branches
vs. the union), and surface the same warning on the concept page header. A gap
here is exactly how a prefix-based membership test hides a removable branch —
this check turns that silent loss into a visible finding.

**Truth-source audit (mandatory, after classification and again in Step 10):**
write every candidate as `[{ "branch", "ort" }]` and run

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/repo-health-audit.js" <repo> candidates.json --default <default-branch>
```

It confirms each entry exists as an exact ref where the Ort says (`refs/heads`
for lokal, `ls-remote --heads` for remote), and rejects protected names
(`main`, `master`, `HEAD`, `origin`, the default branch) and worktree branches.
Every finding drops the entry from the page and is listed as a warning; the
page header shows "N Refs geprüft, K Befunde". Never render a candidate set
that has not passed this audit.

## Step 4 — Remote Branch Audit

After `fetch --prune`, take the remote branch list from `git ls-remote --heads origin`
(never from `refs/remotes/`), drop the default branch, and for each name not
present in `refs/heads`:

- Check if merged into `origin/main` or has a merged PR
- Classify as Löschbar or Untersuchen
- Track separately as remote-only branches (Ort = "nur-remote")

## Step 5 — PR Cross-Reference + Open-PR Inventory

Two lists, two purposes: recent PRs of *any* state validate the branch
classification; **every** open PR is its own entry on the page, because an
open PR is work that still has to land — cleanup that only deletes branches
and leaves the PRs behind is half a cleanup.

### 5a — Recent PRs (classification cross-check)

```
gh pr list --state all --limit 100 --json number,title,state,mergedAt,headRefName
```

Cross-reference with local branches:
- Every MERGED PR should have its branch cleaned up (locally and remotely)
- Every local branch should map to a PR (open, merged, or closed)
- Flag orphan branches with no PR (work that was never shipped)

### 5b — Open PRs (complete, never truncated)

```
gh pr list --state open --limit 500 \
  --json number,title,headRefName,baseRefName,author,isDraft,url,createdAt,updatedAt
```

Then per PR the landing facts:

```
gh pr view <n> --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,commits
```

Build one entry per open PR and resolve where its head branch lives:

| `quelle` | Meaning | Derived from |
|---|---|---|
| `session` | head branch is checked out in a worktree (an Aktive Session) | worktree list from Step 2, exact ref equality |
| `lokal` | head branch exists in `refs/heads` but has no worktree | Step 2 truth source |
| `nur-remote` | head branch exists only on origin (cloud session, other machine, archived session whose worktree is gone) | `ls-remote --heads` |
| `fremd` | PR author ≠ `gh api user --jq .login` | author field |

For `quelle: session` also record the worktree's status from Step 2
(`clean` / `has-changes`) and — Desktop app only, best-effort — the owning
session: `mcp__ccd_session_mgmt__list_sessions`, match `worktreePath` /
`branch`, keep `sessionId`, `title`, `isArchived`, `isRunning`. Missing tool
or no match → `session: null`, never a failure.

**Shippability** — exactly one label per PR, decided here, not on the page:

| `shippable` | Condition | Page label |
|---|---|---|
| `yes` | own PR, not draft, `mergeable != CONFLICTING`, head is `lokal` / `nur-remote` / clean `session` | „bereit — via /ship landen" |
| `session-dirty` | head worktree has uncommitted changes | „in Session <title> shippen — uncommittete Änderungen" |
| `conflict` | `mergeable == CONFLICTING` | „Konflikt — /ship rebased, Konflikte ggf. manuell" (still selectable; `/ship` Step 1b resolves what it can and blocks the rest) |
| `draft` | `isDraft` | „Draft — erst fertigstellen" |
| `checks-red` | `statusCheckRollup` has a failed required check | „CI rot — /ship wartet nicht auf rot" (selectable, expected to block) |
| `fremd` | not the viewer's PR | „fremder PR — nicht von hier shippen" (never selectable) |

Pre-check on the page only `shippable: yes` AND `mergeStateStatus` in
`CLEAN` / `BEHIND` / `UNSTABLE`(no required failure) — the user opts into the
rest consciously. A PR is never both a delete candidate and a ship candidate:
a head branch with an open PR is `pr-open` in Untersuchen (unchecked) and
appears in the ship queue; if the user ships it, `/ship` removes the branch
itself, so the delete checkbox for that branch is disabled on the page with
tooltip „wird beim Shippen entfernt".

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
`skills/concept/deep-knowledge/templates.md` — the authoritative source,
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
- Clean Aktive Sessions that are ahead of `origin/main` keep the gray badge and
  the checkbox; `commits_ahead` + `own_content` appear as an informational
  secondary badge — "N ahead · Inhalt in main" (`own_content: false`, typical
  squash-merged session) or "N ahead · eigener Inhalt" (`own_content: true`).
  Being ahead never turns a clean session amber or removes its controls.
- **Offene PRs section** (only when open PRs exist): its own block between
  Aktive Sessions and the Git-Session list, blue-tinted, header
  „🔵 Offene PRs (N)" with sub-labels „bereit: X / blockiert: Y / fremd: Z".
  One card per PR: `#N title`, head → base, `quelle` badge (Session / lokal /
  nur-remote / fremd), owning session title as a link when known, CI badge
  (grün / rot / ausstehend), mergeable badge, review decision, age. Action is a
  **single „Shippen" checkbox** — pre-checked per Step 5b, disabled (with the
  reason as tooltip) for `session-dirty`, `draft`, `fremd`. Never a merge
  button that bypasses `/ship`: the queue lands every PR through the full
  pipeline (preflight, rebase, build, tests, version bump, CI gate).
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
`skills/concept/deep-knowledge/bridge-server.md` (server launch,
Edge-open, heartbeat + decision polling), respecting the
**Edge Credo** (`{PLUGIN_ROOT}/deep-knowledge/browser-tool-strategy.md` § Edge Credo):
new tab in running Edge, user's profile context, Claude extension for interaction.

```bash
start "" msedge "file:///$(cygpath -m "{filepath}")"

# Track the opened report so /ship can re-open it from the main-repo
# path after a future worktree cleanup (issue #160).
node "$CLAUDE_PLUGIN_ROOT/scripts/session-open-tracker.js" track \
  "$(cygpath -w "{filepath}")" \
  --context=repo-health
```

**Windows note:** always run `{filepath}` through `cygpath -m` before
prefixing `file:///` — raw `$(pwd)`-style paths produce a broken
`file:///c/Users/...` URL (missing drive colon → `ERR_FILE_NOT_FOUND`).
See `{PLUGIN_ROOT}/deep-knowledge/browser-file-urls.md`.

Inform the user:

> Repo-Health geoeffnet. Löschbar-Gruppe ist vorausgefuellt — hake ab, was du
> behalten willst. Untersuchen-Gruppe ist eingeklappt — klappe auf und hake an,
> was du loeschen willst. Offene PRs: „Shippen" ist bei landebereiten PRs
> vorausgewaehlt — jeder wird einzeln via /ship gelandet. Klick „?" fuer
> Inline-Details pro Eintrag. Submit startet Dry-Run-Vorschau bevor
> irgendetwas passiert.

## Step 10 — Execute Decisions

When the user submits via the concept page:

1. **Read decisions** from `#concept-decisions` JSON.
2. **Partition items by action:**
   - Open PRs with `ship: true` -> Step 10b (ship queue) — runs FIRST
   - Branches with `delete: true` -> Step 10c (cleanup)
   - Aktive Sessions (clean) with `remove: true` -> Step 10c (cleanup)
   - Everything else -> no-op (keep)
   - A branch that is both the head of a `ship: true` PR and `delete: true`
     is dropped from the delete set with a note — `/ship` removes it.
3. **Re-check worktree branches** — run `git worktree list --porcelain` again
   and rebuild the protected set. NEVER trust cached data for deletion.
4. **Validate** every branch marked for deletion:
   - Is it in the protected set? -> SKIP with warning, update page
   - Does it still exist? -> Skip silently if already gone
   - Re-run `scripts/repo-health-audit.js` on the exact set about to be
     deleted (Step 3 audit, second pass). Any finding -> SKIP that entry with
     its reason. `main`/`master`/`HEAD`/`origin`/default branch are refused
     here by name, regardless of what the payload says.

### Step 10a — Apply-Manifest + Dry-Run-Confirm

Before executing any action, generate the **Apply-Manifest**: a complete list
of everything that will happen, shown to the user for confirmation.

**Apply-Manifest format:**

```
Folgende Aktionen werden ausgeführt:

Shippen (P) — nacheinander, je ein voller /ship-Lauf:
  1. #412 fix(ship): timed-out probe …  (claude/ship-probe → main, Session „🔧 Ship probe")
  2. #409 feat(card): …                 (claude/card-cta → main, nur-remote)

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

> Shippt P PRs (jeder via /ship: Rebase, Build, Tests, CI-Gate, Merge),
> löscht N lokal, M remote, entfernt K Worktrees.
> Merges und Löschungen sind NICHT rückgängig zu machen.
> Fortfahren?  [Ja] [Abbrechen]

Only proceed after explicit confirmation.

### Step 10b — Ship Queue (before any cleanup)

Land the selected PRs **one after another**, each through the complete
`/ship` pipeline — exactly what would happen if the user sat in P sessions
and typed `/ship` in each, minus the tab-switching. Never `gh pr merge`
directly: the guard hook blocks it and it would skip rebase, build, tests,
version bump and the CI gate.

**Order:** oldest PR first (`createdAt`), so a later PR rebases onto the
earlier one's merge instead of the other way round.

**Arm the queue marker once, before the first ship:**

```bash
node -e "require('fs').mkdirSync('.claude',{recursive:true});require('fs').writeFileSync('.claude/.ship-queue',JSON.stringify({owner:'setup-cleanup',since:new Date().toISOString()}))"
```

Project ship extensions read this marker and defer their post-ship
finalizers to the end of the queue (the dotclaude plugin-source repo's
extension would otherwise mark the MCP servers stale after PR 1 and block
every later `ship_*` call — the same trap `/run-backlog` guards against with
its lockout owner). The marker is NOT an autonomous lockout: the user is
present, every `/ship` gate stays interactive.

**Per PR:**

1. **Resolve the working directory** the ship runs in:
   - `quelle: session` (clean worktree) → that worktree path. Re-check
     `git -C <path> status --porcelain` immediately before; any output → SKIP
     this PR with „Worktree hat inzwischen Änderungen".
   - `quelle: lokal` → `git worktree add .claude/worktrees/cleanup-pr-<n> <branch>`
   - `quelle: nur-remote` → `git fetch origin <branch>:<branch>` then the same
     `worktree add`.
   Record `tempWorktree: true` for the two created cases.
2. **Invoke the pipeline:** `Skill("devops:ship", args: "--cwd=<path> --keep --queued")`.
   `--cwd` makes every `ship_*` call and every git/gh command target that
   directory instead of this session's own worktree (see `/ship` → *Composed
   ships*). `--keep` because the branch/worktree teardown is this step's job,
   not the ship's — `/ship` must never `ExitWorktree` on a directory that is
   not its session's own. `--queued` is informational (card wording).
3. **Read the outcome** from the ship's `ship_release` result / card variant:
   - `ship-successful` → record `merged: true, mergeSha, version`.
   - `ship-blocked` → record the reason; **continue with the next PR**. One
     blocked PR never halts the queue (COMPLETED > INTERRUPTED > BLOCKED, as
     in `/run-backlog`).
4. **Tear down** (merged PRs only):
   - `tempWorktree: true` → `git worktree remove <path>` (no `--force`), then
     `git branch -d <branch>` (lowercase `-d`: refuses if not merged — a
     second safety net), then `git push origin --delete <branch>` when
     `options.delete_remote` is set and the remote ref still exists.
   - `quelle: session` → leave the worktree in place; it now classifies as a
     clean, squash-merged Aktive Session. The owning session keeps working or
     gets removed in a later run — never yank a directory from under a session.
   - Blocked PRs keep their worktree so the user can resume there; list the
     path in the summary.
5. **Re-sync** before the next PR: `git fetch origin main` so the next ship's
   preflight sees the merge that just landed.

**After the last PR:**

1. Run the project ship-extension finalizer exactly once if ≥1 PR merged —
   read `{project}/.claude/skills/ship/SKILL.md` for the step the extension
   deferred while `.claude/.ship-queue` existed, run it, capture its output.
2. Delete `.claude/.ship-queue`.
3. Update the concept page via browser eval: ✅ per merged PR (with merge
   SHA + version), ⏸ per blocked PR (with reason), then continue with
   Step 10c — the cleanup set was fixed at submit time and is not widened by
   the merges.

### Step 10c — Cleanup Execution

Execute in order after Dry-Run-Confirm and after the ship queue (10b):
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
- **Delete by full refname only** — `git branch -D <name>` with a name taken
  from `refs/heads/`, `git push origin --delete refs/heads/<name>` with a name
  confirmed by `ls-remote`. Never a name derived from `%(refname:short)`.

### Worktree Removal Safety

Worktree removal (action `remove: true` in the decisions JSON) is only allowed
for Aktive Sessions classified as `clean` in Step 2. Enforce these rules:

1. **Re-check before removal:** Run `git -C <worktree_path> status --porcelain`
   again immediately before acting. If ANY output → SKIP with warning:
   "Worktree hat inzwischen Aenderungen — Entfernung abgebrochen."
2. **Never force-remove:** Use `git worktree remove <path>` (without `--force`).
   If it fails, report the error — do NOT retry with `--force`. Run it in the
   background (a big `node_modules` outlasts a 120 s call), and finish a
   half-removed orphan yourself: `{PLUGIN_ROOT}/deep-knowledge/git-hygiene.md` § *A
   half-done worktree removal is Claude's to finish*.
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
| ≥1 PR shipped via the queue and none blocked | `ship-successful` (needs `state.pushed` + `state.merged`; any doubt → `ready`) |
| ≥1 PR blocked in the queue | `ship-blocked` (reasons listed per PR) |
| Branches / remotes / worktrees deleted, no PRs shipped | `ready` |
| User reviewed but didn't delete or ship anything | `analysis` |
| User aborted mid-flow | `aborted` |

Pass: `variant`, `summary` (e.g. "Repo hygiene — 2 PRs shipped, 4 branches
cleaned"), `lang`, `session_id`, `changes` (counts per action: PRs merged /
blocked, local/remote/worktrees removed), and `state` when git operations
happened. Each `/ship` in the queue rendered its own card already; this final
card is the aggregate. Output the markdown VERBATIM as the LAST thing in the
response.

## Rules

- Concept page is the primary output — do NOT also dump a markdown report
- Repo context (name, path, remote) is always visible in the page header
- German UI labels unless project overrides
- Self-contained HTML, no external dependencies
- Keep file size reasonable (< 500KB)
