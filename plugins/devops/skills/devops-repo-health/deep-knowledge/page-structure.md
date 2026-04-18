# Repo-Health Concept Page — Structure & Tooltips

## Page Structure

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
```

## Tooltip Explanations

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
