# Repo-Health Inline Detail Investigation

Data gathered **up-front** (SKILL.md Step 7) for every entry in the concept page.
All data is embedded in the HTML at first render, hidden behind a `<details>` „?"
toggle per card. There is no separate iteration loop, no round-trip to Claude.

## Git-Session Branch — Data Gathering

For each Git-Session branch (both Löschbar and Untersuchen), gather:

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

5. **Squash-merge cross-check** — only for Untersuchen branches with no detected PR.
   For each commit on the branch, check whether its diff content already exists in
   `origin/main`:
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

| Recommendation | When | Label shown in inline detail |
|----------------|------|------------------------------|
| `safe-delete` | Squash-merge cross-check ≥ 80% match, OR all commits empty (`git diff` clean against main) | "Bereits in main — sicher löschbar" |
| `pr-open` | An open PR points to this branch | "Offener PR — nicht löschen" |
| `ship-needed` | Has substantive diff (≥ 5 lines changed outside CHANGELOG), no open PR, last commit ≤ 30 days old | "N ungeschippte Commits — ship empfohlen" |
| `rebase-needed` | Last commit > 90 days old, AND ≥ 30 commits between branch base and current `origin/main` | "Veraltet — rebase empfohlen" |
| `wip-keep` | WIP heuristic > 50%, last commit ≤ 14 days old | "WIP — Arbeit laeuft noch" |
| `stale-investigate` | Fallback when nothing else matches | "Unklar — bitte pruefen" |

Always attach a 1-2 sentence rationale referencing the concrete evidence
(commit count, file count, dates, PR number).

## Aktive Session (Worktree) — Data Gathering

For each Aktive Session, gather:

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

| Recommendation | When | Label shown in inline detail |
|----------------|------|------------------------------|
| `commit-and-ship` | Substantive changes (≥ 20 lines or ≥ 3 files), last activity ≤ 7 days, no open PR yet | "N Dateien — commit + ship empfohlen" |
| `wip-continue` | Last activity ≤ 3 days, has any uncommitted changes | "Aktiv — Arbeit laeuft noch" |
| `discard` | Only mechanical changes (whitespace, generated files, lock files), OR < 5 lines across < 2 files | "Nur Kleinaenderungen — verwerfen moeglich" |
| `commit-only` | Branch already has commits ahead of main but no open PR, no recent uncommitted activity | "Commits vorhanden — PR erstellen empfohlen" |
| `stale-investigate` | Fallback | "Unklar — bitte pruefen" |

**Hard rule:** Even `discard` recommendation MUST NOT trigger automatic discard.
The user must commit or `git checkout` manually. The inline detail panel is
read-only — no button in it triggers any git action for has-changes Aktive Sessions.

## Output Shape

Data is embedded in the concept page HTML at first render time as a `<details>`
block per card. Example branch inline detail data structure (rendered as HTML, not
sent back as JSON):

```json
{
  "id": "branch-old-experiment",
  "branch": "old-experiment",
  "kategorie": "untersuchen",
  "inlineDetail": {
    "recommendation": "ship-needed",
    "label": "12 ungeschippte Commits — ship empfohlen",
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

Aktive Session inline detail data structure:

```json
{
  "branch": "claude/old-session",
  "typ": "Aktive Session",
  "status": "clean",
  "inlineDetail": {
    "recommendation": "commit-and-ship",
    "label": "3 Dateien (~85 Zeilen) — commit + ship empfohlen",
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

The page renders `inlineDetail` inside a `<details><summary>[?] Details</summary>...</details>`
element inside the corresponding card (see `page-structure.md` § Inline Detail Panel).
