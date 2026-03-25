# Build Log

## e2c8bfa — 2026-03-25
Version: 0.28.1
Branch: main
Commit: 4a4b454
Changes:
- Expanded preview skip rule to cover build/installer assets (ICO, PNG, C# installer code) and CI/CD files

## d662f47 — 2026-03-25
Version: 0.28.0
Branch: main
Commit: faa3db9
Changes:
- CLAUDE.md: config-only changes skip /test preview — no UI to verify for pure config/docs/scripts
- README.md: skill table and architecture section updated with all current skills and diagrams

## 1e0acb2 — 2026-03-25
Version: 0.27.0
Branch: main
Commit: 44b293b
Changes:
- CLAUDE.md: raw refresh-usage output must never leak into visible responses
- Project-setup skill: .claude/ directory structure convention with canonical layout
- precheck-cost.js: add cd to noTokenCostPattern allowlist (bug fix)

## e8d120b — 2026-03-25
Version: 0.26.0
Branch: main
Commit: 50d3e70
Changes:
- Ship skill rebuilt with agent-delegated execution for context isolation
- CLAUDE.md §Completion Flow documents agent delegation architecture

## 975537d — 2026-03-25
Version: 0.25.0
Branch: main
Commit: 47097dd
Changes:
- Extract agent collaboration protocol to global (finding-to-task, structured issue comments, review enforcement)
- Extract user-facing test plan template to global (format, scaling, concrete steps)

## d6d5c5a — 2026-03-25
Version: 0.24.0
Branch: main
Commit: 57d6308
Changes:
- Add ship prompt timing rule — prompt exactly once after verification, never mid-task
- Add Step 8.5 to /ship skill — git tag + release pipeline after PR merge

## cec73b0 — 2026-03-25
Version: 0.23.2
Branch: main
Commit: ffd1e7b
Changes:
- Deduplicate sync-dotclaude SessionStart hook via process.ppid lock file

## 7b1efd4 — 2026-03-25
Version: 0.23.1
Branch: main
Commit: 6a0f432
Changes:
- Improve sync-dotclaude.js hook to report status in all cases (up-to-date, pulled, diverged)

## 5b17ab6 — 2026-03-25
Version: 0.23.0
Branch: main
Commit: 9a142c7
Changes:
- Add project-level .claude/settings.json with sync-dotclaude hook for cloned repos
- Track .claude/settings.json in git while keeping other .claude/ contents ignored
- Scope root settings.json ignore patterns with / prefix

## 1b81fa3 — 2026-03-25
Version: 0.22.0
Branch: main
Commit: 689740a
Changes:
- Add sync-dotclaude.js SessionStart hook for auto-pulling latest global config
- Remove package-lock.json from tracking

## f1808b6 — 2026-03-25
Version: 0.21.1
Branch: main
Commit: 651abe8
Changes:
- Show (+0%) instead of (—) for missing usage delta in completion card

## c7f052d — 2026-03-25
Version: 0.21.0
Branch: main
Commit: 904d15a
Changes:
- Add /test skill for visual verification (screenshots, simulated CLI output, formatted examples)

## fb0061d — 2026-03-25
Version: 0.20.0
Branch: main
Commit: 2cef6dc
Changes:
- Move usage display from session start to completion card with live refresh and delta tracking
- Remove 10-minute caching from refresh-usage skill
- Version bump to 0.20.0

## db4eb74 — 2026-03-25
Version: 0.19.0
Branch: chore/cost-hook-improvements
PR: #5
Commit: c0e0208
Changes:
- Fix cost hook blocking git push/fetch/add/commit and similar non-token-consuming commands
- Add file size and token estimate details to block warning output
- Sync pending global config changes (CLAUDE.md, blocklist, refresh-usage skill)

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
