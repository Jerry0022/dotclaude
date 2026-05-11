# Repo-Health Concept Page — Structure & Tooltips

## Page Structure

```
[Header]
  Repo name (large)
  Local path | Remote URL | Current branch | Default branch
  Last fetch timestamp
  Iteration badge: "Iteration 1" (or "Iteration 2 — Deep Dive" on follow-up)

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
      Visual: info icon, clearly labeled read-only by default
      HARD RULE: NO delete, discard, reset, or cleanup options whatsoever
      Action controls (limited):
        Checkbox: "Untersuchen" (UNCHECKED by default)
        Tooltip on checkbox — see Tooltip section below
        Optional comment field (collapsed by default, expandable)
    If clean:
      "Keine lokalen Aenderungen"
      Action controls (radio group, default "Behalten"):
        ( ) Entfernen
        ( ) Untersuchen
        (*) Behalten
        Tooltips on each — see Tooltip section below
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

    [Action controls — radio group, only for safe-delete and investigate categories]:
      ( ) Loeschen      — default for safe-delete category
      ( ) Untersuchen
      ( ) Behalten      — default for investigate category
      Tooltips on each — see Tooltip section below
      Optional comment field (collapsed by default, expandable)

  [Iteration ≥ 2 — Deep-Dive Panel per investigated branch]
    Rendered inline inside the branch card, below the action controls:
      Section heading: "Detail-Analyse"
      Recommendation badge: ship-needed / safe-delete / rebase-needed /
        wip-keep / pr-open (color-coded, see investigation.md)
      Full commit log (scrollable, monospace, latest first)
      Diff summary by file (path + +X/-Y)
      Branch age: "Erster Commit vor 14 Tagen, letzter vor 2 Tagen"
      Open PRs (if any): #N — title — state
      Rationale text (1-2 sentences explaining the recommendation)
    The action radio defaults flip to match the recommendation:
      ship-needed   -> default "Behalten" (user should ship before deleting)
      pr-open       -> default "Behalten"
      safe-delete   -> default "Loeschen"
      rebase-needed -> default "Behalten"
      wip-keep      -> default "Behalten"

  [Iteration ≥ 2 — Tombstone card (item disappeared)]
    Replaces the normal card when SKILL.md Step 9b revalidation finds the
    branch / worktree no longer present in fresh git state:
      Visual: gray-out, strikethrough on the branch name
      Header: "Nicht mehr vorhanden" badge + reason label
        (branch-missing / worktree-path-missing / branch-attached-to-worktree)
      Body: lastKnownStatus + detectedAt timestamp, no deepDive data
      Single button: "Bestaetigen" — drops the item from the next submit
      NO radio group, NO Untersuchen, NO destructive actions

  [Iteration ≥ 2 — Convergence-suppressed card]
    When SKILL.md Step 9b detects an identical deepDive digest vs. the
    previous iteration for an investigate item, render the deepDive
    normally BUT remove the "Untersuchen" radio option (only Loeschen /
    Behalten for branches, only Entfernen / Behalten for clean worktrees,
    only Behalten for has-changes worktrees). Show a small info chip:
    "Keine neuen Erkenntnisse — bitte entscheiden."

  [Iteration 5 banner]
    Render at the top of the branch + worktree sections on iteration 5:
    "Letzte Iteration — bitte abschliessend entscheiden. Untersuchen ist
    deaktiviert." Untersuchen is suppressed across ALL cards regardless
    of digest stability.

[Main Sync Section]
  Current status: up to date / X commits behind
  Checkbox: "Main synchronisieren" (pre-checked if behind)

[Decision Panel Sidebar]
  Summary lines (live counters):
    "X Branches zum Loeschen ausgewaehlt"
    "Y Items zur Detail-Analyse markiert" (only shown if > 0)
  Grouped summary: Z local + W remote branches
  Checkbox: "Remote-Branches auch loeschen" (default: checked) + tooltip
  Checkbox: "Worktrees prunen" (default: checked) + tooltip
  Submit button label adapts:
    - Any item marked Untersuchen: "Details pruefen + Aufraeumen"
    - Otherwise: "Aufraeumen starten"
```

## Tooltip Explanations

Every action control and global option MUST have an explanatory tooltip
(HTML `title` attribute) so the user understands the effect before acting.

| Element | Tooltip text |
|---------|-------------|
| "Loeschen" radio (safe-delete) | "Branch lokal loeschen. Arbeit ist bereits in main (merged/squash-merged)." |
| "Loeschen" radio (investigate) | "Branch lokal loeschen. ACHTUNG: Aenderungen sind moeglicherweise NICHT in main!" |
| "Untersuchen" radio (branch) | "Branch NICHT loeschen. Claude analysiert Commits, Diff und Alter und schlaegt in einer zweiten Iteration eine konkrete Aktion vor (shippen / loeschen / rebasen)." |
| "Behalten" radio (branch) | "Branch unveraendert lassen — keine Aktion in dieser Iteration." |
| "Entfernen" radio (clean worktree) | "Worktree und zugehoerigen Branch entfernen. Nur moeglich ohne lokale Aenderungen." |
| "Untersuchen" checkbox/radio (worktree) | "Worktree NICHT anfassen. Claude prueft geaenderte Dateien, Commits und letztes Aktivitaetsdatum und empfiehlt in der naechsten Iteration: shippen, weiterarbeiten oder verwerfen." |
| "Behalten" radio (worktree) | "Worktree unveraendert lassen." |
| "Remote-Branches auch loeschen" | "Loescht die Branches auch auf GitHub/origin. Betrifft nur die oben ausgewaehlten Branches." |
| "Worktrees prunen" | "Entfernt verwaiste Worktree-Referenzen (bereits geloeschte Verzeichnisse). Aktive Worktrees werden NICHT beruehrt." |
| "Main synchronisieren" | "Holt die neuesten Aenderungen von origin/main und aktualisiert den lokalen main-Branch." |
| "Select all" button | "Alle sichtbaren Branches zum Loeschen markieren." |
| "Deselect all" button | "Alle sichtbaren Branches auf Behalten setzen." |

Implement tooltips as `title` attributes on the label/radio wrapper.
Keep text concise — one sentence max, no jargon.

## Action Control Notes

- Radio groups are exclusive: exactly one of Loeschen / Untersuchen / Behalten
  is selected per branch at any time. Same for clean worktrees with
  Entfernen / Untersuchen / Behalten.
- has-changes worktrees keep a single "Untersuchen" checkbox (no radio) —
  the only allowed user action; defaulting to unchecked = Behalten.
- "Select all" sets visible items to "Loeschen". "Deselect all" sets them
  to "Behalten". Untersuchen is never set in bulk — it is an explicit
  per-item opt-in.
