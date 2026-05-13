---
name: devops-repo-health
version: 0.4.0
description: >-
  Analyze repository branch hygiene: unmerged branches, stale locals with deleted
  remotes, orphaned worktrees, verify work landed in main. Results: interactive
  concept page with filters, batch actions, and an "Untersuchen" follow-up loop
  for deeper per-item analysis. Triggers on: "repo health", "branch cleanup",
  "branch hygiene". Explicit user request only.
argument-hint: "[optional: focus area — branches, worktrees, PRs]"
allowed-tools: Bash(git *), Bash(gh *), Bash(start *), Bash(cmd *), Read, Write, Glob, Grep, AskUserQuestion, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__Claude_in_Chrome__*, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Repo Health Check

Analyze the repository for branch hygiene, unmerged work, and cleanup opportunities.
Present results as an interactive concept page with filters and decision controls.

## Step 0 — Repo-mode check

Before any git command, verify this directory is a git repository:

```bash
git rev-parse --is-inside-work-tree
```

If this fails (exit != 0), abort:

> Repo health analysiert git-Branches/PRs/Worktrees — in einer Nicht-Git-Dir gibt es nichts zu pruefen. Aborting.

Do NOT proceed. End the skill.

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

| Category | Meaning | Default action (iteration 1) |
|----------|---------|-------------------------------|
| `safe-delete` | MERGED or SQUASH-MERGED | Radio default: `delete` |
| `investigate` | UNMERGED, no PR or open PR | Radio default: `skip` (Behalten); user can opt into `investigate` for deep-dive |
| `worktree` | Attached to a worktree | Info only; clean worktrees expose `remove`/`investigate`/`keep` radio (default `keep`); has-changes worktrees expose only an opt-in `investigate` checkbox |

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

### Page Structure & Tooltips

The full ASCII mockup of the page (header, KPI cards, worktree section,
filter bar, branch list, main-sync section, decision panel sidebar) and
the mandatory tooltip table for every action control live in
`deep-knowledge/page-structure.md`.

### Filter Behavior

- Filters toggle visibility of branch cards by category
- "Select all / Deselect all" buttons only affect **currently visible** cards
- Filter state is preserved in the decisions JSON so Claude knows what the
  user was looking at when they submitted
- Counter in decision panel updates based on checked items across ALL
  categories (not just visible ones)

### Decision Schema

The submit payload shape (repo metadata, filter state, per-branch decisions,
worktree actions, global options, comments, iteration counter) is documented in
`deep-knowledge/decision-schema.md`. The schema supports a third action —
`"investigate"` — which defers the item to a deep-dive iteration; see Step 9b
and `deep-knowledge/investigation.md` for what data Claude gathers and how
reclassification recommendations are computed.

### File Location

Write to: `~/.claude/devops-concepts/{date}-repo-health.html`
(resolves to `$USERPROFILE/.claude/devops-concepts/` on Windows, `$HOME/.claude/devops-concepts/` on Unix).
User-global, not project-scoped — reports are ephemeral review artifacts, not repo content.
The `ss.permissions.ensure.js` SessionStart hook pre-approves writes to this path so no permission prompt fires.
Create the directory if missing: `mkdir -p ~/.claude/devops-concepts` (Unix) or `mkdir "%USERPROFILE%\.claude\devops-concepts" 2>nul` (Windows).

### Important Design Details

- Branch names in monospace font, visually prominent
- Category badges with distinct colors: green (safe), amber (investigate),
  blue (worktree), purple (remote-only)
- Branch action controls are a radio group (Loeschen / Untersuchen / Behalten);
  default = Loeschen for safe-delete category, Behalten for investigate category
- Worktree section is visually distinct from branch list (different background
  tint, dedicated header, never mixed into the branch cards)
- Worktrees with changes: amber badge, file summary, NO destructive controls.
  The only allowed interactive element is an opt-in "Untersuchen" checkbox
  (unchecked by default) for requesting a deep-dive iteration
- Worktrees without changes: gray badge, radio group (Entfernen / Untersuchen
  / Behalten) defaulting to Behalten
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

Inform the user (iteration 1):

> Repo-Health geoeffnet. Filtere nach Kategorien, waehle pro Branch /
> Worktree zwischen Loeschen, Untersuchen oder Behalten und klick den
> Submit-Button — bei Untersuchen-Markierungen mache ich eine zweite
> Iteration mit Detail-Analyse, sonst raeume ich direkt auf.

On iteration ≥ 2 (after a deep-dive round), inform the user:

> Iteration {N}: Detail-Analyse fertig. Jede untersuchte Position hat
> jetzt eine Empfehlung (Commit-Log, Diff, Branch-Alter). Entscheide
> erneut — du kannst auch nochmal "Untersuchen" anklicken fuer eine
> tiefere Runde.

## Step 9 — Execute Decisions

When the user submits via the concept page:

1. **Read decisions** from `#concept-decisions` JSON, including the
   `iteration` counter.
2. **Partition items by action:**
   - Branches with `action: "delete"` -> Step 9a (cleanup)
   - Worktrees with `action: "remove"` -> Step 9a (cleanup)
   - Anything with `action: "investigate"` -> Step 9b (deep-dive)
   - `action: "skip"` / `"keep"` -> no-op
3. **Re-check worktree branches** — run `git worktree list --porcelain` again
   and rebuild the protected set. NEVER trust cached data for deletion.
4. **Validate** every branch marked for deletion:
   - Is it in the protected set? -> SKIP with warning, update page
   - Does it still exist? -> Skip silently if already gone

### Step 9a — Cleanup (delete / remove items)

Execute in order:
   a. Delete selected local branches: `git branch -D <branch>`
   b. If `delete_remote` is true: `git push origin --delete <branch>` for
      each selected branch that has a remote
   c. If `prune_worktrees` is true: `git worktree prune`
   d. `git remote prune origin`
   e. If `sync_main` is true: `git checkout main && git pull origin main`,
      then return to original branch

Update the concept page via browser eval:
   - Mark completed deletions with a green checkmark
   - Mark skipped items with a warning icon + reason
   - Show summary: "X Branches geloescht, Y uebersprungen"

Persist results to `~/.claude/devops-concepts/{date}-repo-health-decisions.json`.

### Step 9b — Deep-Dive (investigate items)

Triggered when at least one branch or worktree has `action: "investigate"`.

**Ordering vs. Step 9a:** 9b runs **AFTER** 9a finishes. Sequential, not
parallel. Reason: 9b must build iteration N+1 from the post-cleanup git
state — otherwise just-deleted branches can be rendered again, or a
`delete` that hit the worktree-protection validation skip silently carries
a stale "delete" preselection into the next round. Cleanup typically takes
seconds; the wait does not meaningfully delay the user.

1. **Re-fetch git state:** `git fetch --all --prune`,
   `git worktree list --porcelain`, `git branch -a --no-color`. Build the
   fresh protected branch set and the fresh existing-branch set. Treat
   these as ground truth for what is now in the repo.
2. **Revalidate every investigate target against fresh state:**
   - **Branch missing** (not in `git branch -a` anymore — e.g. deleted in
     another terminal between iterations): render an "Already removed"
     tombstone card in iteration N+1 with a single "Bestaetigen" button
     to drop it from the next submit. No deepDive data is gathered.
   - **Branch newly attached to a worktree** (race condition): move it to
     the worktree section as a `has-changes`/`clean` card, with
     "Untersuchen" preserved if appropriate. Drop any `investigate` flag
     from the branch list rendering.
   - **Worktree path missing** (`git -C <path> status` fails): tombstone,
     same as above.
   - **Target still valid** → continue to step 3.
3. **Reconcile Step 9a results into the iteration model:**
   - Items that 9a actually deleted/removed: drop from iteration N+1 entirely.
   - Items that 9a SKIPPED (validation failures): re-include them with a
     warning banner and default action = `Behalten`. Never carry forward a
     failed `delete` as the new default.
   - Items with `action: "skip"` / `"keep"` from iteration N: only carry
     forward if still present in the fresh git state.
4. **Gather per-item deep-dive data** for revalidated investigate targets
   as documented in `deep-knowledge/investigation.md` — full commit log,
   diff stats by file, branch age, PR cross-reference, squash-merge
   cross-check (branches only), modified/untracked file lists (worktrees
   only).
5. **Apply recommendation rules** from `investigation.md` to attach a
   `deepDive` block per item (`recommendation`, `rationale`, raw data).
6. **Convergence check** — for each investigate item already carrying a
   `deepDive` from iteration N−1: compute a stable digest over
   `recommendation` + `commits[].hash` + `files[].path+added+deleted` (for
   branches) or `modifiedFiles[].path+added+deleted` +
   `commitsAhead[].hash` (for worktrees). If digest is **identical** to
   the previous iteration's digest, the page has produced no new
   information for that item. In iteration N+1: render the deepDive as
   usual but **suppress the "Untersuchen" radio option** for that card —
   only `Loeschen` / `Behalten` (branches) or `Behalten` / `Entfernen`
   (clean worktrees) / `Behalten` (has-changes worktrees) remain. Force a
   terminal decision.
7. **Regenerate the concept page** as iteration N+1:
   - Increment `iteration` in the embedded JSON
   - Header badge: "Iteration 2 — Deep Dive" (or higher counter)
   - Render `deepDive` blocks inline inside cards for investigated items
     (see `page-structure.md` § Iteration ≥ 2)
   - Render tombstone cards for items detected as missing in step 2
   - Flip the action radio default to the recommended action
   - Honor the convergence suppression from step 6
8. **Reload the page** through the bridge `/reload` endpoint (same protocol
   `/devops-concept` uses). The user now sees enriched info and a fresh
   submit cycle.
9. **No deletion** happens for investigated items in this iteration. Their
   fate is decided in iteration N+1 (where the user can choose
   `delete` / `keep` / again `investigate` for a deeper loop — unless
   suppressed by convergence).

**Hard cap:** iterations are capped at **5 rounds**. On iteration 5, the
"Untersuchen" radio option is suppressed for ALL items regardless of
digest stability. Render a banner: "Letzte Iteration — bitte abschliessend
entscheiden." If iteration N+1 would be > 5, refuse to regenerate and
proceed to Step 10 instead. This is a guard against the spec being used
as an infinite parking lot rather than a deep-dive tool.

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
   must NOT render any DESTRUCTIVE action controls — no Entfernen, no
   "discard", no "reset", no implicit-cleanup option. The ONLY allowed
   interactive element is an opt-in "Untersuchen" checkbox (read-only
   deep-dive request, see Step 9b). Even when iteration 2 recommends
   `discard`, the action stays advisory: the user must commit or checkout
   manually. This is enforced in the HTML generation, not just in execution.
4. **Branch cleanup after removal:** After successfully removing a clean
   worktree, the associated branch can be deleted locally. But check that
   the branch is not the current branch in the main repo first.

## Step 10 — Completion Card

Trigger this step only when the run is **done** — i.e. the user closed the
monitor or the most recent submit produced no `investigate` items. If
Step 9b regenerated the page for another iteration, SKIP the completion
card and continue monitoring (Step 8). The card fires once per repo-health
run, not once per iteration.

When triggered, call `mcp__plugin_devops_dotclaude-completion__render_completion_card`:

| Situation | Variant |
|-----------|---------|
| Branches / remotes / worktrees deleted across any iteration | `ready` |
| User reviewed (possibly multiple iterations) but didn't delete anything | `analysis` |
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
