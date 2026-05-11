# Repo-Health Deep Investigation

When the user marks a branch or worktree with `action: "investigate"` on
the iteration 1 page, Claude does NOT delete or modify it. Instead it
runs a per-item deep-dive, attaches the enriched data to the regenerated
concept page (iteration 2), and recommends a concrete reclassification.

## Branch Deep-Dive

For each branch with `action: "investigate"`, gather:

1. **Full commit log** against `origin/main`:
   ```bash
   git log --format='%h|%s|%cr|%an' origin/main..<branch>
   ```
   Parse into structured entries: `hash`, `subject`, `relative_date`, `author`.

2. **Diff summary by file** (exclude CHANGELOG.md):
   ```bash
   git diff --numstat origin/main...<branch> -- . ':(exclude)CHANGELOG.md'
   ```
   Yields `+added`, `-deleted`, `path` per file.

3. **Branch age and activity:**
   ```bash
   git log --reverse --format='%ct' origin/main..<branch> | head -1   # first commit ts
   git log -1 --format='%ct' <branch>                                  # last commit ts
   ```
   Convert to relative ("Erster Commit vor 14 Tagen, letzter vor 2 Tagen").

4. **PR status (open or recently closed):**
   ```bash
   gh pr list --head <branch> --state all --limit 5 \
     --json number,title,state,mergedAt,createdAt,url
   ```

5. **Squash-merge cross-check** — only do this if the branch is classified
   `investigate` AND has no detected PR. For each commit on the branch,
   check whether its diff content already exists in `origin/main`:
   ```bash
   git log --format='%H' origin/main..<branch> | while read c; do
     patch_id=$(git show "$c" | git patch-id --stable | awk '{print $1}')
     main_match=$(git log --format='%H' -p origin/main \
       | git patch-id --stable | awk -v id="$patch_id" '$1==id {print $2}')
     # if main_match non-empty, the patch already landed
   done
   ```
   If ≥ 80% of commits are already in main → strong `safe-delete` signal.

6. **WIP heuristic** on commit subjects:
   - Subjects matching `/^(wip|tmp|temp|test|debug|fixup|squash!)\b/i`
   - Subjects shorter than 10 chars
   - Multiple consecutive commits touching the same file with similar messages
   Count occurrences. > 50% WIP commits → `wip-keep` signal.

### Recommendation Logic

Apply rules in order, first match wins:

| Recommendation | When | Default action in iteration 2 |
|----------------|------|-------------------------------|
| `safe-delete` | Squash-merge cross-check ≥ 80% match, OR all commits empty (`git diff` clean against main) | "Loeschen" |
| `pr-open` | An open PR points to this branch | "Behalten" |
| `ship-needed` | Has substantive diff (≥ 5 lines changed outside CHANGELOG), no open PR, last commit ≤ 30 days old | "Behalten" |
| `rebase-needed` | Last commit > 90 days old, AND ≥ 30 commits between branch base and current `origin/main` | "Behalten" |
| `wip-keep` | WIP heuristic > 50%, last commit ≤ 14 days old | "Behalten" |
| `stale-investigate` | Fallback when nothing else matches | "Behalten" |

Always attach a 1-2 sentence rationale referencing the concrete evidence
(commit count, file count, dates, PR number).

## Worktree Deep-Dive

For each worktree with `action: "investigate"`, gather:

1. **Modified file list with line counts:**
   ```bash
   git -C <worktree_path> diff --numstat
   git -C <worktree_path> diff --cached --numstat   # staged
   ```

2. **Untracked file list (capped at 50):**
   ```bash
   git -C <worktree_path> ls-files --others --exclude-standard | head -50
   ```

3. **Commits ahead of main with full messages:**
   ```bash
   git -C <worktree_path> log --format='%h|%s|%cr' origin/main..HEAD
   ```

4. **Last activity timestamp** — newest of:
   - Last commit on branch
   - Latest mtime among modified+untracked files (capped scan: 200 files)

5. **Branch identity check:**
   - Is this branch attached to a PR? `gh pr list --head <branch> --state all`
   - Is the worktree's branch name semantically meaningful (e.g. `feature/*`,
     `fix/*`) vs. a Claude session branch (`claude/*`)?

### Recommendation Logic

| Recommendation | When | Default action in iteration 2 |
|----------------|------|-------------------------------|
| `commit-and-ship` | Substantive changes (≥ 20 lines or ≥ 3 files), last activity ≤ 7 days, no open PR yet | "Behalten" (user should commit + ship manually) |
| `wip-continue` | Last activity ≤ 3 days, has any uncommitted changes | "Behalten" |
| `discard` | Only mechanical changes (whitespace, generated files, lock files), OR < 5 lines across < 2 files | "Behalten" (recommendation in rationale, but actual discard requires explicit user action — never auto-discard) |
| `commit-only` | Branch already has commits ahead of main but no open PR, no recent uncommitted activity | "Behalten" |
| `stale-investigate` | Fallback | "Behalten" |

**Hard rule:** Even `discard` recommendation MUST NOT trigger automatic
discard. The user must commit or `git checkout` manually. The page only
surfaces the recommendation; the action radio for has-changes worktrees
remains "Untersuchen / Behalten" only — no destructive option.

## Output Shape

Per investigated item, attach a `deepDive` block to the iteration 2
concept page payload. Branch example:

```json
{
  "id": "branch-old-experiment",
  "branch": "old-experiment",
  "category": "investigate",
  "deepDive": {
    "recommendation": "ship-needed",
    "rationale": "12 commits, 8 files (~340 lines) changed outside CHANGELOG. Last commit 4 days ago, no PR. Looks shippable.",
    "commits": [
      { "hash": "a1b2c3d", "subject": "feat: add foo", "relativeDate": "vor 4 Tagen", "author": "Jerry" }
    ],
    "files": [
      { "path": "src/foo.ts", "added": 120, "deleted": 5 }
    ],
    "firstCommit": "vor 18 Tagen",
    "lastCommit": "vor 4 Tagen",
    "prs": [],
    "wipRatio": 0.08,
    "squashMatchRatio": 0.0
  }
}
```

Worktree example:

```json
{
  "branch": "claude/old-session",
  "deepDive": {
    "recommendation": "commit-and-ship",
    "rationale": "3 modified files (~85 lines), letzte Aktivitaet vor 2 Tagen. Sieht nach abgeschlossener Feature-Arbeit aus — commit + ship empfohlen.",
    "modifiedFiles": [
      { "path": "src/bar.ts", "added": 45, "deleted": 10 }
    ],
    "untrackedFiles": ["TODO.md"],
    "commitsAhead": [
      { "hash": "d4e5f6a", "subject": "wip: bar refactor", "relativeDate": "vor 5 Tagen" }
    ],
    "lastActivity": "vor 2 Tagen"
  }
}
```

The iteration 2 page renders `deepDive` inline inside the corresponding
card (see `page-structure.md` § Iteration ≥ 2 — Deep-Dive Panel).

## Tombstone Shape (item disappeared between iterations)

When SKILL.md Step 9b revalidation finds an investigate target no longer
present in the fresh git state (branch deleted in another terminal,
worktree path removed, etc.), the item is rendered as a tombstone instead
of a deepDive panel:

```json
{
  "id": "branch-old-experiment",
  "branch": "old-experiment",
  "category": "investigate",
  "tombstone": {
    "reason": "branch-missing",
    "detectedAt": "2026-05-11T13:35:00+02:00",
    "lastKnownStatus": "investigate"
  }
}
```

`reason` values: `"branch-missing"`, `"worktree-path-missing"`,
`"branch-attached-to-worktree"` (race: moved to worktree section instead).
Tombstone cards show a single "Bestaetigen" button that drops the item
from the next submit payload — no further action is available.

## Convergence Digest

Step 9b's convergence check (terminate vs. allow another deep-dive round)
hashes a stable subset of the `deepDive` payload. The digest is recomputed
each iteration; if it matches the previous iteration's digest verbatim,
the "Untersuchen" radio is suppressed for that item — no new evidence
exists, so another round would be pure noise.

**Branch digest input** (in order, JSON-stringify with sorted keys, then SHA-1):
```
{
  "recommendation": "<value>",
  "commits": [<sorted by hash ascending, hash field only>],
  "files": [<sorted by path ascending, {path, added, deleted}>]
}
```

**Worktree digest input:**
```
{
  "recommendation": "<value>",
  "modifiedFiles": [<sorted by path, {path, added, deleted}>],
  "commitsAhead": [<sorted by hash ascending, hash field only>]
}
```

Excluded from the digest on purpose: relative-date strings ("vor 4 Tagen"
changes every render but does not represent new information), the
free-form `rationale` text, and PR metadata (PR state can flip while
nothing about the branch content has changed — track that via a separate
"PR-Status changed" badge if needed in future iterations, not by gating
convergence on it).
