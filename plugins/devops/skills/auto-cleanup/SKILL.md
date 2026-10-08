---
name: auto-cleanup
version: 0.8.0
description: >-
  Repository branch hygiene of the current project on an interactive concept
  page: unmerged branches, stale locals with deleted remotes, active sessions
  (worktrees), open PRs that still need to land, verify work landed in main.
  Filters, 2-state delete controls, a ship queue for open PRs (each landed via
  do-ship, one after another, as if shipped from its own session), inline
  detail expand, and an Apply-Manifest + Dry-Run-Confirm before executing
  anything. Offered by the completion card after a successful ship or promote
  when too many branches/worktrees pile up (ship_hygiene); old leftovers that
  provably landed are removed by ship_hygiene without this page.
  Triggers on: "repo health", "branch cleanup", "branch hygiene", "branches
  aufräumen", "worktrees aufräumen", "offene PRs landen", "open PRs shippen",
  or a yes to the card's cleanup hint. Do NOT trigger for: code cleanup or
  refactoring, project setup (.gitignore, LICENSE), or the branch the current
  ship removes anyway.
layer: 0
invokes: [auto-concept, do-ship]
user-invocable: false
triggers:
  en: ["repo health", "branch cleanup", "branch hygiene"]
  de: ["branches aufräumen", "worktrees aufräumen", "offene PRs landen", "open PRs shippen"]
argument-hint: "[optional: focus area — branches, sessions, PRs]"
allowed-tools: Bash(git *), Bash(gh *), Bash(node *), Bash(start *), Bash(cmd *), Read, Write, Glob, Grep, AskUserQuestion, Skill, mcp__Claude_Browser__*, mcp__claude-in-chrome__*, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__Claude_in_Chrome__*, mcp__plugin_devops_dotclaude-completion__render_completion_card, mcp__plugin_devops_dotclaude-ship__*, mcp__ccd_session_mgmt__list_sessions, mcp__ccd_session_mgmt__get_session
---

# Auto-Cleanup — Repo Health

Analyze the current project's repository for branch hygiene, unmerged work, and
cleanup opportunities. Present results as an interactive concept page with
filters and decision controls.

## Where this skill sits

The cleanup has an automatic half and this interactive half:

| Part | Runs | Removes |
|---|---|---|
| `ship_hygiene` auto-clean (`mcp-server/ship/lib/hygiene.js`) | after every successful ship: age (a removable leftover older than 30 days), count (more than 20 removable) or disk (kept session worktrees above 10 GB) | whatever provably landed: older than 30 days, beyond the newest 20, or — disk — the oldest worktree checkouts (branch kept) (clean session worktrees, their branches, plain branches) — no page, no question; the card's **Geprüft** line reports it |
| `ship_hygiene` nudge | after every successful ship or promote, when more than 50 leftovers lie around, at most weekly | nothing — the card gets an ⚠ OFFEN item pointing here |
| **this skill** | on a yes to that item, or a trigger phrase | whatever the user ticks on the page, recent items included |

The numbers are user settings (`{PLUGIN_ROOT}/deep-knowledge/devops-config.md`,
section `cleanup`). Scope is always the current project — there is no
cross-repo mode.

On this page a session worktree only goes when the user ticks it (HARD RULE
below).

## Step 0 — Repo-mode check

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
enumerates forbidden commands permits every command it forgot to name. Scope
rules and the four operation classes a guard must cover:
`{PLUGIN_ROOT}/deep-knowledge/git-hygiene.md` § Protection scope covers every
operation class.

**Re-check before every destructive action.** Sessions start, stop and switch
branches during a run: rebuild the protected set immediately before each
delete/remove/kill, never once at classification time.

**Detection:** `git worktree list --porcelain` -> every line starting with
`branch refs/heads/` is a protected branch, and every `worktree ` line is a
protected **path** — including the detached ones, which have no `branch` line
at all and would otherwise look unprotected.

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
`String.includes`): branch names form suffix chains (`feat/x-abc123`,
`feat/x-abc123-def456`), and a substring test silently hides the shorter
independent branch from every list.

## Deletion gate — no answer is a no

**Never run a delete before the Dry-Run-Confirm is answered.** That holds for
every local branch, remote branch and worktree, and also when there is no page:
no browser, or a repo so small the page looks like overkill, is no exception.
Without the page, print the Apply-Manifest (`deep-knowledge/execution.md`
§ Step 10a) as text and ask the confirm right away.

- **Dry-Run-Confirm** = one `AskUserQuestion`, header `Dry-Run`, the question
  names every branch and worktree to delete by full name, options
  `Ja, ausführen` / `Abbrechen`.
- **Unmerged branch** (Untersuchen — content not in the default branch) =
  additionally its own yes: one question per branch, header `Unmerged`, the
  question names the branch, options `Ja, löschen` / `Behalten`.
- **No answer is a no.** An error (`Answer questions?` under `claude -p`), a
  denied or unavailable tool, `Abbrechen`, `Behalten`, an Other or free-text
  reply: nothing is deleted. Do not ask "how else", do not retry another way —
  end the run with the `analysis` card, the manifest listed as open.

`pre.cleanup.gate` enforces this: armed when this skill loads, it refuses every
`git branch -d/-D`, `git push --delete`, `git worktree remove` that no yes
covers. A refusal is final for this run.

## Step 1 — Repo Context

Gather repository identity for the page's header card:

1. **Repo name:** `basename $(git rev-parse --show-toplevel)`
2. **Local path:** `git rev-parse --show-toplevel`
3. **Remote URL:** `git remote get-url origin`
4. **Current branch:** `git branch --show-current`
5. **Default branch:** typically `main` or `master`

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
     (`deep-knowledge/decision-schema.md`): on a squash-merge workflow every
     worktree whose PR landed stays ahead forever (the merge-base predates the
     squash).
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
vs. the union), and surface the same warning on the concept page header.

**Truth-source audit (mandatory, after classification and again in Step 10):**
write every candidate as `[{ "branch", "ort" }]` and run

```bash
node "{PLUGIN_ROOT}/scripts/repo-health-audit.js" <repo> candidates.json --default <default-branch>
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
classification; **every** open PR is its own entry on the page — work that
still has to land.

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
| `yes` | own PR, not draft, `mergeable != CONFLICTING`, head is `lokal` / `nur-remote` / clean `session` | „bereit — via /do-ship landen" |
| `session-dirty` | head worktree has uncommitted changes | „in Session <title> shippen — uncommittete Änderungen" |
| `conflict` | `mergeable == CONFLICTING` | „Konflikt — /do-ship rebased, Konflikte ggf. manuell" (still selectable; `/do-ship` Step 1b resolves what it can and blocks the rest) |
| `draft` | `isDraft` | „Draft — erst fertigstellen" |
| `checks-red` | `statusCheckRollup` has a failed required check | „CI rot — /do-ship wartet nicht auf rot" (selectable, expected to block) |
| `fremd` | not the viewer's PR | „fremder PR — nicht von hier shippen" (never selectable) |

Pre-check on the page only `shippable: yes` AND `mergeStateStatus` in
`CLEAN` / `BEHIND` / `UNSTABLE`(no required failure) — the user opts into the
rest consciously. A PR is never both a delete candidate and a ship candidate:
a head branch with an open PR is `pr-open` in Untersuchen (unchecked) and
appears in the ship queue; if the user ships it, `/do-ship` removes the branch
itself, so the delete checkbox for that branch is disabled on the page with
tooltip „wird beim Shippen entfernt".

## Step 6 — Local vs Remote Main Sync

```
git log --oneline main -1
git log --oneline origin/main -1
```

Verify local `main` is up to date with `origin/main`. Flag if behind.

## Step 7 — Gather Inline Detail Data

For EVERY entry (both Löschbar and Untersuchen, and every Aktive Session),
gather up-front the data the inline „?" detail panel shows — commit log, diff
by file, age, PR status, squash cross-check, WIP heuristic and a one-line
recommendation label. Commands and recommendation rules:
`deep-knowledge/investigation.md`. All data is embedded in the HTML at first
render behind a `<details>` expand; no round-trip to Claude to view it.

## Step 8 — Generate Concept Page

Build a **self-contained HTML concept page** using the `dashboard` variant.
Follow the design system and full HTML/CSS/JS scaffold in
`skills/auto-concept/deep-knowledge/templates.md` (referenced by name, not by
concept's step numbers).

### Page Structure & Tooltips

The full ASCII mockup of the page (header, KPI summary, Aktive-Sessions section,
filter bar, branch list grouped into Löschbar / Untersuchen, Apply-Manifest
sidebar, main-sync section) and the mandatory tooltip table for every action
control live in `deep-knowledge/page-structure.md`.

### Decision Schema

The submit payload shape (repo metadata, filter state, per-branch decisions,
Aktive-Session actions, global options, comments) is documented in
`deep-knowledge/decision-schema.md`. The schema uses 2-state controls:
delete (checked) or keep (unchecked). The inline „?" detail is read-only and
does NOT add a third action state.

### File Location

Write to: `~/.claude/devops-concepts/{date}-repo-health.html`
(resolves to `$USERPROFILE/.claude/devops-concepts/` on Windows, `$HOME/.claude/devops-concepts/` on Unix).
The `ss.permissions.ensure.js` SessionStart hook pre-approves writes to this path so no permission prompt fires.
Create the directory if missing: `mkdir -p ~/.claude/devops-concepts` (Unix) or `mkdir "%USERPROFILE%\.claude\devops-concepts" 2>nul` (Windows).

### Filter Behavior and Design Details

The filter behavior (select-all banner, filter state in the decisions JSON,
the cross-category counter) and every design detail of the page (badges,
the single delete checkbox, Aktive-Session and Offene-PR sections, defaults
per group) live in `deep-knowledge/page-structure.md` § Filter Behavior and
§ Important Design Details. Read that file before writing the HTML — the
page is built from it, not from memory.

## Step 9 — Open & Monitor

Open the page in the browser and monitor for the submit signal.
Follow the open + monitor bridge in
`skills/auto-concept/deep-knowledge/bridge-server.md` (server launch,
Edge-open, heartbeat + decision polling), respecting the
**Edge Credo** (`{PLUGIN_ROOT}/deep-knowledge/browser-tool-strategy.md` § Edge Credo):
new tab in running Edge, user's profile context, Claude extension for interaction.

```bash
start "" msedge "file:///$(cygpath -m "{filepath}")"

# Track the opened report so /do-ship can re-open it from the main-repo
# path after a future worktree cleanup (issue #160).
node "{PLUGIN_ROOT}/scripts/session-open-tracker.js" track \
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
> vorausgewaehlt — jeder wird einzeln via /do-ship gelandet. Klick „?" fuer
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
     is dropped from the delete set with a note — `/do-ship` removes it.
3. **Re-check worktree branches** — run `git worktree list --porcelain` again
   and rebuild the protected set. NEVER trust cached data for deletion.
4. **Validate** every branch marked for deletion:
   - Is it in the protected set? -> SKIP with warning, update page
   - Does it still exist? -> Skip silently if already gone
   - Re-run `scripts/repo-health-audit.js` on the exact set about to be
     deleted (Step 3 audit, second pass). Any finding -> SKIP that entry with
     its reason. `main`/`master`/`HEAD`/`origin`/default branch are refused
     here by name, regardless of what the payload says.

### Steps 10a–10c — Manifest, Ship Queue, Cleanup (read before any action)

Read `deep-knowledge/execution.md` now and follow it in order — no ship, no
delete and no worktree removal before it is in context:

- **10a** Apply-Manifest + Dry-Run-Confirm — nothing runs without the
  user's explicit yes.
- **10b** Ship Queue — every `ship: true` PR through the full `/do-ship`
  pipeline, oldest first, `.claude/.ship-queue` armed once; never `gh pr merge`.
- **10c** Cleanup Execution — branches, remotes, clean worktrees, prune, sync.
- **Safety Invariants** and **Worktree Removal Safety** — binding for every
  step of 10b and 10c.

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
happened. Each `/do-ship` in the queue rendered its own card already; this final
card is the aggregate. Output the markdown VERBATIM as the LAST thing in the
response.

## Rules

- Concept page is the primary output — do NOT also dump a markdown report
- Repo context (name, path, remote) is always visible in the page header
- German UI labels unless project overrides
- Self-contained HTML, no external dependencies
- Keep file size reasonable (< 500KB)
