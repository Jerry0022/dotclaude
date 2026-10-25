---
name: orphan-scan
description: Daily machine-wide scan for unlanded branches, abandoned dirty worktrees, parked work and stashes; writes ~/.claude/orphan-report.json.
version: 0.1.0
trigger: daily (scheduled task) AND ss.orphan.nudge.js (SessionStart, refreshes a report older than 24 h)
scope: machine-wide (every git repo directly under the parent folder of the current main checkout)
---

# Orphan Scan

Post-ship hygiene only checks the repo that was just shipped. This task looks
at every repo under one root and records what would be lost if a folder were
deleted tomorrow.

## What it does

`node scripts/orphan-scan.js` (read-only apart from `git fetch --prune` with a
60 s timeout, offline-tolerant):

1. Finds every repo under the root (default: parent folder of the current main
   checkout, `--root` overrides), deduplicated by git-common-dir.
2. Classifies each repo with `classifyUnits` (`mcp-server/ship/lib/hygiene.js`):
   - **atRisk** — not landed (`unlanded` or `partial`), no open PR, no live
     session, not parked; plus worktrees with real uncommitted changes.
   - **parked** — `parked/<topic>` branches (aliases `wip/`, `backup/`,
     `salvage/`, tip subject "ARCHIVED"); older than 30 days they carry the
     nudge "behalten, integrieren oder verwerfen".
   - **stashes**, **landedLeftovers** (landed, removable by hygiene).
3. Writes `~/.claude/orphan-report.json`.

`ss.orphan.nudge.js` reads that report at session start and shows one line when
the current repo has at-risk items; it also starts this scan detached when the
report is missing or older than 24 h, so the daily run works without an
external scheduler. A Desktop scheduled task running the same command once a
day is equivalent.

## Removing landed leftovers (one-off or recurring)

```
node scripts/orphan-scan.js --clean-landed [--repo <path>]           # dry run
node scripts/orphan-scan.js --clean-landed [--repo <path>] --apply   # delete
```

Uses the existing safe removal, ignoring the age/count gates. Never touches
live-session worktrees, the current worktree, locked or dirty worktrees, or
anything not landed. Worktrees must also have been idle for 24 h. Branches
are spared when they are long-lived (`develop`, `staging`, `production`,
`stable`, `trunk`, `release/*`, `hotfix/*`) or still have an upstream on
origin (a worktree on such a branch is removed, the branch stays). LANDED
parked refs (`parked/*` incl. `parked/autosave/*`, `wip/`, `backup/`,
`salvage/`) are removed too: a landed safety copy holds nothing the default
branch lacks; unlanded ones are never touched. Remote branches are not
deleted here (ship hygiene expires landed origin copies after 14 days). Stale
lock files (>1 h) are cleared before the `fetch --prune`.

## Constraints

- Never deletes unlanded work; the report is the only side effect without `--apply`.
- One broken repo never stops the scan; any failure leaves the previous report.
