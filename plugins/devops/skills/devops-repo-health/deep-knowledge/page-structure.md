# Repo-Health Concept Page — Structure & Tooltips

## Conceptual Model

Every entry is a **git branch** (a ref). A worktree is NOT a separate entity —
it is a branch WITH a checked-out directory.

**Typ** (type attribute per entry):
- **Aktive Session** — a branch WITH a checked-out worktree directory
  (a running or paused Claude session)
- **Git-Session** — a plain branch WITHOUT a worktree

**Ort** (location attribute per entry):
- `lokal` — exists only locally
- `nur-remote` — exists only on the remote
- `lokal+remote` — exists in both

## Typ × Zustand Matrix

Status is derived into exactly **two categories** that **partition** all entries
and **sum** to the total. Every entry belongs to exactly one.

| | merged / clean | unmerged / has-changes |
|---|---|---|
| **Git-Session** | 🟢 **Löschbar** — delete branch | 🟡 **Untersuchen** — investigate; no destructive action |
| **Aktive Session** | 🟢 **Löschbar** — remove worktree ONLY (branch stays); NOT pre-checked by default | 🟡 **Untersuchen** — has changes; inline detail only; NEVER destructive |

Notes on cells:
- "Aktive Session + merged/clean → Löschbar" means: worktree removal is offered, but
  the branch itself is NOT automatically queued for deletion. The branch may still be
  needed (it is protected). After worktree removal, the branch transitions to a plain
  Git-Session and can be cleaned in a subsequent run.
- "has-changes → never destructive": no delete checkbox, no remove option; only the
  read-only „?" inline detail toggle is rendered.

## Page Structure

```
[Header]
  Repo name (large)
  Local path | Remote URL | Current branch | Default branch
  Last fetch timestamp

[Summary KPI — one total partitioned into two]
  ┌─────────────────────────────────────────────────────────────┐
  │  Gesamt: 9      🟢 Löschbar: 6          🟡 Untersuchen: 3  │
  │                    ├ Git-Sessions: 4        ├ Git-Sessions: 3 │
  │                    │   lokal: 2             │   lokal: 2      │
  │                    │   nur-remote: 1        │   nur-remote: 1 │
  │                    │   lokal+remote: 1      │   lokal+remote: 0│
  │                    └ Aktive Sessions: 2     └ Aktive Sessions: 0│
  │                        lokal: 2                              │
  └─────────────────────────────────────────────────────────────┘
  Main sync status (separate line): up to date / X commits behind

[Aktive Sessions Section — DEDICATED, separate from Git-Session list]
  Only shown if Aktive Sessions (worktrees) exist.
  Header: "Aktive Sessions (N)"  — expandable block
  Sub-labels behind header: "mit Aenderungen: X / sauber: Y"

  Per Aktive Session card:
    Branch name (monospace) + worktree path (smaller, muted)
    Typ badge: "Aktive Session" (blue)
    Ort badge: "lokal" (gray)
    Status badge:
      - "Mit Aenderungen" (amber) if has-changes
      - "Sauber" (gray) if clean
    Merge status: merged / unmerged (last known state; note a session may
      have multiple PRs/merges — show the most recent)
    If has-changes:
      File summary: "X geaendert, Y ungetrackt" (compact inline)
      Commits ahead: "Z Commits vor main" (if any)
      HARD RULE: NO delete checkbox, no discard, no reset, no cleanup options.
      Action controls (read-only detail only):
        [?] inline detail toggle (expands commit log + file list + recommendation)
        No comment field, no submit-affecting controls.
    If clean:
      "Keine lokalen Aenderungen"
      Action controls:
        [ ] Entfernen (checkbox, UNCHECKED by default — must consciously opt in)
        [?] inline detail toggle
        Tooltip on checkbox — see Tooltip section below
  Card styling: subtle border, lower visual weight than Git-Session cards,
  distinct background tint (blue-gray) to avoid confusion with Git-Sessions

[Filter Bar]
  Category toggles: [Löschbar] [Untersuchen] [nur-remote]
  (NO Aktive-Session toggle — Aktive Sessions have their own section above)
  Select all / Deselect all buttons (apply to visible items only)
  When a filter is active and select-all is clicked:
    Banner: "Alle N gefilterten markieren (vs. M sichtbar)" — must confirm
    before bulk-acting on rows outside the current view.

[Git-Session List — filterable, excludes Aktive Session branches]

  [Löschbar Group — expandable, OPEN by default]
  Header: "🟢 Löschbar (N)" with sub-labels "merged X / not-merged Y"
  "Alles aufklappen" button for this section

  Per Git-Session card in Löschbar:
    Branch name (monospace, prominent)
    Typ badge: "Git-Session" (neutral)
    Ort badge: lokal / nur-remote / lokal+remote
    Kategorie badge: "Löschbar" (green)
    Merge status: merged / squash-merged
    PR reference (if exists): #123 — title
    Last commit: hash + message + relative date
    Diff stats: X files changed (excluding CHANGELOG)
    Remote status: exists / gone / n/a
    Action controls:
      [x] Löschen  (checkbox, PRE-CHECKED for safe-delete Git-Sessions)
      [?] inline detail toggle (expands commit-log + diff + recommendation)
      Optional comment field (collapsed by default, expandable)

  [Untersuchen Group — expandable, COLLAPSED by default]
  Header: "🟡 Untersuchen (N)" with sub-labels "merged X / not-merged Y"
  "Alles aufklappen" button for this section

  Per Git-Session card in Untersuchen:
    Branch name (monospace, prominent)
    Typ badge: "Git-Session" (neutral)
    Ort badge: lokal / nur-remote / lokal+remote
    Kategorie badge: "Untersuchen" (amber)
    Merge status: unmerged / open PR
    PR reference (if exists): #123 — title — state
    Last commit: hash + message + relative date
    Diff stats: X files changed (excluding CHANGELOG)
    Remote status: exists / gone / n/a
    Action controls:
      [ ] Löschen  (checkbox, UNCHECKED by default — user opts in consciously)
      [?] inline detail toggle (expands commit-log + diff + recommendation)
      Optional comment field (collapsed by default, expandable)

  [Inline Detail Panel — per card, triggered by „?" toggle]
    Rendered inside the card below the action controls, hidden by default.
    No round-trip to Claude — all data is embedded at first render.
    Content:
      Section heading: "Detail"
      Recommendation badge: ship-needed / safe-delete / rebase-needed /
        wip-keep / pr-open / commit-and-ship / wip-continue / stale-investigate
        (color-coded, see investigation.md)
      Short recommendation label (e.g. "3 ungeschippte Commits — ship empfohlen")
      Full commit log (scrollable, monospace, latest first)
      Diff summary by file (path + +X/-Y)
      Branch age: "Erster Commit vor 14 Tagen, letzter vor 2 Tagen"
      Open PRs (if any): #N — title — state
      Rationale text (1-2 sentences explaining the recommendation)
    Implemented as a `<details><summary>[?] Details</summary>...</details>` element.

[Main Sync Section]
  Current status: up to date / X commits behind
  Checkbox: "Main synchronisieren" (pre-checked if behind)

[Apply-Manifest Sidebar]
  A complete list of everything that will happen, live-updated as user
  toggles checkboxes. Acts as a preview / manifest before submission.

  Content:
    "Folgende Aktionen:"
    Lokal löschen (N): branch-a, branch-b, ...
    Remote löschen (M): branch-a (origin), ...
    Worktrees entfernen (K): claude/old-session (/path)
    Main synchronisieren: ja / nein
    Remote prunen: ja / nein

  Checkbox: "Remote-Branches auch loeschen" (default: checked) + tooltip
  Checkbox: "Worktrees prunen" (default: checked) + tooltip
  Submit button label: "Aufraeumen starten"

  On Submit: show Dry-Run-Confirm before executing anything:
    "Löscht N lokal, M remote, entfernt K Worktrees.
    Lokales Löschen und remote Löschen ist NICHT rückgängig zu machen.
    Fortfahren?" [Ja] [Abbrechen]
```

## Tooltip Explanations

Every action control and global option MUST have an explanatory tooltip
(HTML `title` attribute) so the user understands the effect before acting.

| Element | Tooltip text |
|---------|-------------|
| Löschen checkbox (Löschbar Git-Session) | "Branch lokal loeschen. Arbeit ist bereits in main (merged/squash-merged)." |
| Löschen checkbox (Untersuchen Git-Session) | "Branch lokal loeschen. ACHTUNG: Aenderungen sind moeglicherweise NICHT in main!" |
| Entfernen checkbox (clean Aktive Session) | "Nur den Worktree entfernen. Der Branch bleibt erhalten und kann spaeter separat geloescht werden." |
| „?" inline detail toggle | "Commit-Log, Diff-Statistik und Empfehlung anzeigen — keine Aktion wird ausgeloest." |
| "Remote-Branches auch loeschen" | "Loescht die Branches auch auf GitHub/origin. Betrifft nur die oben ausgewaehlten Branches." |
| "Worktrees prunen" | "Entfernt verwaiste Worktree-Referenzen (bereits geloeschte Verzeichnisse). Aktive Sessions werden NICHT beruehrt." |
| "Main synchronisieren" | "Holt die neuesten Aenderungen von origin/main und aktualisiert den lokalen main-Branch." |
| "Select all" button | "Alle sichtbaren Git-Sessions zum Loeschen markieren." |
| "Deselect all" button | "Alle sichtbaren Git-Sessions auf Behalten setzen." |

Implement tooltips as `title` attributes on the label/checkbox wrapper.
Keep text concise — one sentence max, no jargon.

## Action Control Notes

- Each Git-Session card has exactly **one checkbox** (delete / keep — two states only).
  There is no radio group, no third "Untersuchen" action state.
- has-changes Aktive Sessions expose NO submit-affecting controls — only the „?"
  inline detail toggle (read-only). The inline detail may include a recommendation
  (e.g. "commit + ship"), but it is advisory; no button triggers any git action.
- clean Aktive Sessions expose one checkbox (Entfernen, unchecked by default).
  The associated branch is NOT included in the deletion — only the worktree directory
  is removed via `git worktree remove`.
- "Select all" sets all visible Git-Session checkboxes to checked (delete).
  "Deselect all" sets them to unchecked (keep). Aktive Session checkboxes are
  never affected by bulk select.
- Comment fields are per-card, collapsed by default; their content is included in
  the submit payload for logging purposes only.
