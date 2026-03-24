# Build Log

## d93241e — 2026-03-25
Version: 0.19.0
Branch: main
Commit: 2e412b3
Changes:
- Added issue status tracking on project board (In Progress on session start, Done on ship)

## a91f638 — 2026-03-25
Version: 0.18.2
Branch: main
Commit: 987ca87
Changes:
- Added dotclaude repo exception to §Inheritance Model (avoids ~11k token duplication)
- Deduplicated cleanup and WIP rules in §Completion Flow (references instead of copies)

## 99368d1 — 2026-03-25
Version: 0.18.1
Branch: main
Commit: 53ccbd4
Changes:
- Completion card title shows build ID instead of "Aufgabe abgeschlossen"
- Fallback "Erledigt" for tasks without build ID

## 18c9d22 — 2026-03-24
Version: 0.18.0
Branch: main
Commit: 7ca3ddb
Changes:
- Usage scraper uses raw WebSocket CDP with background:true — no Edge focus steal
- Usage display moved from collapsed hook output to visible Claude chat output
- startup-summary.js reduced to expensive-files scanner only
- Added --summary flag for formatted usage box output

## 7e1bb41 — 2026-03-24
Version: 0.17.1
Branch: main
Commit: 73f5289
Changes:
- Add test deduplication to ship quality gates (skip tests if same tree hash already passed)
- Add "Test deduplication at ship time" section to CLAUDE.md

## a6145c7 — 2026-03-24
Version: 0.17.0
Branch: main
PR: #4
Commit: dca6d34
Changes:
- Simplify startup-summary.js from 535 to 120 lines — compact 4-line usage dashboard
- Remove local .jsonl fallback, session history, expensive prompts, pace calculation
- Add /refresh-usage skill with Edge CDP consent flow
- Update CLAUDE.md §Session Startup for new architecture

## fd14fa8 — 2026-03-24
Version: 0.16.2
Branch: main
Commit: 57bed17
Changes:
- Restructure test execution strategy: task-specific inline, full regression at ship time
- Reduces token consumption in iterative development sessions

## 913b3e3 — 2026-03-24
Version: 0.16.1
Branch: main
Commit: 02da5dd
Changes:
- Remove priority:* labels from issue required parameters (4 → 3)
- Deprecate priority:* label family

## c54c27b — 2026-03-24
Version: 0.16.0
Branch: main
Commit: 82d2061
Changes:
- Replace sprint concept with milestone system ([New], [Evolve], [Overhaul], [Fix])
- Add milestone naming convention with auto-assignment logic
- Deprecate sprint:N labels in favor of GitHub milestone field
- Reduce issue required parameters from 5 to 4

## cf06ae0 — 2026-03-24
Version: 0.14.1
Branch: main
PR: #2
Commit: cf06ae0
Changes:
- Add commit frequency & granularity guidelines
- Add build number system (content hash, developer-only)
- Add BUILDLOG.md specification and retroactive creation rule

## ecda1ed — 2026-03-23
Version: 0.14.1
Branch: main
PR: #1
Commit: ecda1ed
Changes:
- Add 'review first' option to AskUserQuestion rules
- Prioritize functionality over console window avoidance in tool selection

## 7bf0886 — 2026-03-23
Version: 0.14.0
Branch: main
Commit: 7bf0886
Changes:
- Add global /ship skill — canonical implementation of the Completion Flow
- Refactor Completion Flow in CLAUDE.md to reference /ship skill

## efddb08 — 2026-03-23
Version: 0.13.0
Branch: main
Commit: efddb08
Changes:
- Add automatic version bump decision as step 5 in Completion Flow
- Add version bump decision table (patch/minor/major/none)

## cd948e8 — 2026-03-23
Version: 0.12.0
Branch: main
Commit: cd948e8
Changes:
- Upgrade all 8 custom skills with improved triggers, decision logic, and new features
- Add --dry-run to /ship-dotclaude, --at timestamp to /youtube-transcript, --update to /readme

## 6cbbacd — 2026-03-23
Version: 0.11.3
Branch: main
Commit: 6cbbacd
Changes:
- Fix sweep hook to clean up stale claude/* branches with archived worktrees

## da3ad6f — 2026-03-22
Version: 0.11.2
Branch: main
Commit: da3ad6f
Changes:
- Add tool selection rule to minimize terminal windows on Windows

## 7c475dd — 2026-03-22
Version: 0.11.1
Branch: main
Commit: 7c475dd
Changes:
- Unify release flow for all version types (major, minor, patch)

## e7ba641 — 2026-03-22
Version: 0.11.0
Branch: main
Commit: e7ba641
Changes:
- Add /project-setup skill for repo hygiene audit and initialization

## 23d37eb — 2026-03-22
Version: 0.10.0
Branch: main
Commit: 23d37eb
Changes:
- Add task completion signal (status card at end of every task)
- Add ship behavior rules (auto-ship for projects, prompt-only for dotclaude)
- Add release pipeline integration in /ship-dotclaude
