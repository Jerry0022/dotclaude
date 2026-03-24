# Changelog

All notable changes to this project will be documented in this file.

## [0.21.0] - 2026-03-25

### Added
- New `/test` skill — visual verification after code changes: preview screenshots for UI, simulated CLI output for terminal formatting, rendered examples for markdown/structured text

## [0.20.0] - 2026-03-25

### Changed
- Usage display moved from session start to completion card — live refresh with delta tracking
- Removed session-start usage display and background refresh
- refresh-usage skill: removed 10-minute caching, always scrapes fresh data

## [0.19.0] - 2026-03-25

### Added
- Issue status tracking on project board — auto-detect matching issues at session start and topic switches, set In Progress/Done via GraphQL

## [0.18.2] - 2026-03-25

### Added
- Dotclaude repo exception in §Inheritance Model — project CLAUDE.md is intentionally a full copy, Claude uses only the global version to avoid ~11k token duplication per request

### Changed
- §Completion Flow: replaced duplicated cleanup and WIP rules with references to §Local Cleanup and §Branch Lifecycle

## [0.18.1] - 2026-03-25

### Changed
- Completion card title now shows build ID instead of "Aufgabe abgeschlossen" — format: `✨ <build-id> · <summary>`
- Tasks without a build ID use `✨ Erledigt · <summary>` as fallback

## [0.18.0] - 2026-03-24

### Changed
- Usage scraper uses raw WebSocket CDP with `Target.createTarget({ background: true })` — Edge no longer steals focus
- Removed Playwright dependency from scraping (kept only for `--activate-cdp`)
- Usage display moved from collapsed SessionStart hook output to visible Claude chat output
- startup-summary.js reduced to expensive-files scanner only (no more usage display)
- Added `--summary` flag to refresh-usage-headless.js for formatted usage box output

### Fixed
- Edge browser window no longer comes to foreground during background usage scraping

## [0.17.1] - 2026-03-24

### Changed
- Ship quality gates now skip tests when the same code state was already tested in the session (tree hash deduplication)
- Added "Test deduplication at ship time" section to CLAUDE.md test execution strategy

## [0.17.0] - 2026-03-24

### Added
- New `/refresh-usage` skill — manages Edge CDP lifecycle with user consent for browser restart
- `--check-only` and `--activate-cdp` flags for refresh-usage-headless.js

### Changed
- Simplified startup-summary.js from 535 to 120 lines — compact 4-line usage dashboard, no ASCII box
- Removed local .jsonl fallback, session history tracking, expensive prompts display, and pace calculation from startup summary
- startup-summary.js now only reads cached usage data — never triggers a refresh or blocks session start
- refresh-usage-headless.js no longer auto-kills Edge — requires explicit user consent via AskUserQuestion
- Updated §Session Startup in CLAUDE.md to reflect new 10-minute cache and consent-based CDP activation

## [0.16.2] - 2026-03-24

### Changed
- Restructured "Milestone Regression Testing" into "Test Execution Strategy" with three tiers: task-specific tests (run inline), full regression suite (deferred to ship time), milestone regression (before closing milestones)
- Reduces token consumption by avoiding full test suite output in conversation context during iterative development

## [0.16.1] - 2026-03-24

### Changed
- Remove priority:* labels from GitHub Issues required parameters (4 → 3)
- priority:* label family deprecated — milestones handle prioritization implicitly

## [0.16.0] - 2026-03-24

### Changed
- Replace sprint concept with milestone system — thematic, level-based milestones ([New], [Evolve], [Overhaul], [Fix]) with auto-assignment logic
- §Milestone naming convention added with format rules, level prefix table, and living title re-evaluation
- sprint:N labels deprecated in favor of GitHub milestone field
- §GitHub Issues required parameters reduced from 5 to 4 (sprint label removed)
- All sprint references updated to milestone terminology across CLAUDE.md

## [0.15.0] - 2026-03-24

### Added
- BUILDLOG.md — retroactive build log with 10 historical entries (v0.10.0–v0.14.1)
- Build log step (step 13) in /ship-dotclaude skill

### Changed
- /ship skill refactored to extend /ship-dotclaude as base — contains only delta (PR workflow, branch consolidation, quality gates, aggressive cleanup)
- /ship-dotclaude steps renumbered (13→14 tag, 14→15 pipeline wait, 15→16 pull, 16→17 refresh)

## [0.14.1] - 2026-03-23

### Changed
- CLAUDE.md §Tool Selection: added "Priority: functionality > aesthetics" rule — Bash is always preferred over broken workflows, console windows should only be avoided when genuinely unnecessary

## [0.14.0] - 2026-03-23

### Added
- New global `/ship` skill — canonical implementation of the Completion Flow shipping pipeline (consolidate, rebase, quality gates, version bump, PR, merge, cleanup, verify)

### Changed
- CLAUDE.md §Completion Flow: replaced inline 10-step list with reference to `/ship` skill + compact summary line
- Project-level `/ship` skills now extend the global skill instead of duplicating the full flow

## [0.13.0] - 2026-03-23

### Added
- Automatic version bump decision as explicit step 5 in Completion Flow (§Ship & Verify)
- Version bump decision table in §Versioning: patch (user-visible bugs), minor (UI features), major (redesigns, requires confirmation), none (internal-only)
- "Multiple changes in one ship" rule: highest applicable bump wins

### Changed
- Completion Flow steps renumbered (5→Version bump, 6→PR, 7→Merge, 8→Pull, 9→Cleanup, 10→Verify)
- Replaced one-line "Increment rules" with structured decision table and automation rules

## [0.12.0] - 2026-03-23

### Added
- All 8 custom skills upgraded with improved trigger descriptions, decision logic, and new features
- `/commit`: dynamic co-author detection (Opus/Sonnet/Haiku), smart staging dialog for >5 files, amend flow, German triggers
- `/deep-research`: budget awareness (checks 5h window), depth check to skip unnecessary agent spawns, adaptive output formats (report/comparison/state-of-art)
- `/ship-dotclaude`: `--dry-run` parameter, conflict resolution flow, automatic MCP UUID filtering, fixed step numbering
- `/debug`: automatic log discovery via Glob, decision tree (trivial→auto-fix, unclear→propose), git-recent-changes as first check, triage step with AskUserQuestion
- `/explain`: adaptive depth (inline for single lines, full template for modules, +Mermaid for architecture), user memory integration
- `/youtube-transcript`: `--at MM:SS` timestamp support, robust 4-step fallback chain, interactive follow-up, language-adaptive output
- `/readme`: `--update` mode for incremental edits, auto-preview for large projects, "What's New" section from CHANGELOG
- `/project-setup`: monorepo detection with per-package ignores, severity levels (CRITICAL/WARNING/INFO), CI awareness check

## [0.11.3] - 2026-03-23

### Fixed
- Sweep hook now cleans up stale `claude/*` branches whose worktree was archived and have no commits ahead of main

## [0.11.2] - 2026-03-22

### Added
- New CLAUDE.md rule: "Tool Selection — Minimize Terminal Windows (Windows)" — prefer dedicated tools over Bash to reduce disruptive CMD window popups

## [0.11.1] - 2026-03-22

### Changed
- Release Flow now applies to all version bumps (major, minor, and patch) — no more patch exception

## [0.11.0] - 2026-03-22

### Added
- New `/project-setup` skill — audit or initialize repo hygiene (.gitignore, LICENSE, .gitattributes, .editorconfig, AI tooling config tracking)

## [0.10.0] - 2026-03-22

### Added
- Task Completion Signal — consistent status card at end of every task (sparkles icon, plain-text details, backslash-break spacing)
- Ship behavior rules — auto-ship for project repos, prompt-only for dotclaude
- Release pipeline integration in `/ship-dotclaude` skill (CHANGELOG, git tag, GitHub Release)

### Fixed
- `/ship-dotclaude` was missing CHANGELOG update, git tag creation, and GitHub Release steps
- GitHub Release aligned from v0.3.0 to match code version
- README version badge synced with package.json

## [0.9.0] - 2026-03-22

### Added
- Bidirectional dotclaude sync — `check-dotclaude-sync.js` now auto-updates local `~/.claude/` from repo when remote is ahead
- Session-start branch & worktree sweep hook (`sweep-branches.js`) — automatic cleanup of orphaned worktrees and gone branches
- Branching strategy documentation in CLAUDE.md (branch lifecycle, sub-branches, zero-leftover policy)
- Proactive sync prompt for dotclaude repo owner (full sync vs session-only vs skip)
- Taskbar shortcut with `--dangerously-skip-permissions` in setup scripts

### Fixed
- Sweep hook now protects active session worktrees from cleanup

## [0.8.0] - 2026-03-21

### Added
- Pre-approved tool permissions in settings template — all standard tools (Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch, NotebookEdit, Agent, TodoWrite, Skill, mcp__*) now bypass permission prompts on startup
- Global Config Sync rule in CLAUDE.md — changes to `~/.claude/` files must always be shipped to the dotclaude repo via `/ship-dotclaude`

## [0.5.0] - 2026-03-20

### Added
- Plan-based setup: Free / Pro / Max tiers with different token footprints
- `CLAUDE-lite.md` — token-optimized instructions for Free plan (~1,200 tokens vs ~4,300)
- Plan-specific settings templates: `settings.free.json`, `settings.pro.json`
- `plan-config.json` — central configuration for skills, hooks, and instructions per plan tier
- Setup scripts now prompt for plan selection and deploy accordingly
- `dotclaude-plan` file to persist selected plan

### Changed
- Setup scripts (setup.sh, setup.ps1) rewritten with plan selection flow
- Skills are now deployed selectively based on plan tier
- README updated with plan comparison table

## [0.4.1] - 2026-03-20

### Changed
- Reduced live usage data max-age from 60 to 10 minutes for fresher dashboard data
- Auto-refresh threshold reduced from 30 to 5 minutes at session start
- Added forced usage refresh after ship-dotclaude (step 14)
- Clarified refresh-usage timing: session start (cached OK) and post-ship (forced) only

## [0.4.0] - 2026-03-20

### Added
- New `readme` skill — generates polished, modern READMEs with badges, emoji sections, Mermaid diagrams, and media handling
- README rewritten with modern design (shields.io badges, architecture diagram, ToC)

### Changed
- Simplified permissions: removed explicit `allow` list in favor of pure `bypassPermissions` mode
- Updated settings template to match new permission model

## [0.3.0] - 2026-03-20

### Added
- Inheritance Model section in `CLAUDE.md` — global rules as baseline, project CLAUDE.md files only extend/override
- Override and Extends syntax conventions for project-level rule customization
- New Project Setup guidelines (no duplication, comment header, delta-only approach)
- Skill & Hook Inheritance rules (project skills reference global versions, describe only deltas)
- Drift Detection protocol (detect global changes in project sessions, check redundancy/conflicts, ask user)
- Conflict Resolution Priority (Override > Extends > Global default)
- Global sync tracking via `<!-- global-sync: YYYY-MM-DD -->` comments in project CLAUDE.md files

## [0.2.0] - 2026-03-20

### Added
- Interactive question rules (AskUserQuestion preferences) in `CLAUDE.md`
- Visual diagram rules (Mermaid rendering pipeline) in `CLAUDE.md`
- Language rules (German conversation / English artifacts) in `CLAUDE.md`
- `render-diagram.js` — Mermaid-to-HTML rendering script with dark theme and styled template
- `diagrams/template.html` — diagram HTML template (Patrick Hand font, SVG postprocessing)

### Fixed
- `check-dotclaude-sync.js` — handle MSYS/Git Bash path mangling and CRLF line ending differences

## [0.1.0] - 2026-03-20

### Added
- Initial release: global Claude Code configuration as a portable repository
- `CLAUDE.md` — global instructions (autonomy, git hygiene, sprint workflow, token awareness, etc.)
- 6 custom skills: commit, debug, deep-research, explain, youtube-transcript, ship-dotclaude
- 1 custom command: refresh-usage
- Token management scripts: startup-summary.js (SessionStart dashboard), precheck-cost.js (cost guard hook)
- Usage scraping support: scrape-usage.js + refresh-usage command
- Sync detection: check-dotclaude-sync.js (SessionStart hook detects config drift)
- Setup scripts: setup.sh (Unix) and setup.ps1 (Windows PowerShell)
- Templates: settings.template.json, config.template.json, plugins-manifest.json
- Plugin blocklist
