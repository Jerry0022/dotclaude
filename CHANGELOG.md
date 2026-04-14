# Changelog

## [0.41.3] — 2026-04-14

### Fixed

- **usage** — Edge restart uses graceful shutdown before force-kill, preserving user tabs via `--restore-last-session`
- **usage** — weekly reset duration fallback now takes first match after "Alle Modelle" instead of last, preventing Sonnet-specific reset time from being reported as the weekly value

## [0.41.2] — 2026-04-14

### Fixed

- **ship** — preflight: `base-ahead`, `file-overlap`, `config-conflictstyle` are now warnings (not hard errors), returns `needsRebase` flag for autonomous resolution
- **ship** — SKILL.md: Step 1 is now a preflight → resolve → re-check loop instead of linear Step 1 → Step 1.5; only truly ambiguous conflicts trigger AskUserQuestion
- **ship** — `git-sync.js` v0.3.0: trivial conflict auto-resolver (one-side-unchanged, identical changes, whitespace-only) — only ambiguous conflicts warn the user
- **deep-knowledge** — `merge-safety.md` updated to reflect tiered conflict resolution behavior

## [0.41.1] — 2026-04-14

### Added

- **hooks** — MCP server health check: detects dead servers after hard PC shutdowns via PID heartbeat files, blocks with clear message instead of cryptic MCP errors
- **mcp-server** — heartbeat module: each server registers its PID on startup, cleans up on graceful exit

## [0.40.9] — 2026-04-14

### Changed

- **completion** — state line elements (commit, branch, PR, merge target) now render as clickable GitHub links
- **completion** — merge target changed from `main` to `origin/main` for clarity (state line + CTA)

## [0.41.0] — 2026-04-14

### Added

- **ship** — merge safety system to prevent silent overwrites in parallel development:
  - `git-sync.js` v0.2.0: conflicts abort + warn instead of auto-resolving with `--ours`
  - `preflight.js`: file overlap detection (branch vs base), `merge.conflictstyle` config check
  - `release.js`: mandatory rebase-gate before merge, configurable merge strategy (squash/merge/rebase)
  - `github.js`: PR mergeability re-check on reuse, strategy parameter for `mergePR()`
  - `SKILL.md` Step 1.5: AI-driven rebase, conflict resolution, and post-rebase test run
- **deep-knowledge** — `merge-safety.md`: reference doc covering diff3, Mergiraf, branch protection, squash ancestry problem

### Fixed

- **version** — align marketplace.json to 0.40.8

## [0.40.8] — 2026-04-13

### Changed

- **deep-knowledge** — new `agent-orchestration.md`: shared orchestration logic (agent selection, wave execution, QA testing protocol, prompt template, single-agent shortcut) extracted from `devops-agents` and `devops-autonomous` skills
- **skills** — `devops-agents` and `devops-autonomous` now reference `agent-orchestration.md` as single source of truth instead of duplicating orchestration logic

### Fixed

- **version** — align marketplace.json to 0.40.7

## [0.40.7] — 2026-04-13

### Fixed

- **skills** — `devops-repo-health` v0.3.0: separate worktree section from branch list to eliminate overlapping info, add tooltip explanations for all action options, analyze worktree content (modified/untracked files, commits ahead), enforce no-discard rule for worktrees with changes
- **version** — sync marketplace.json to 0.40.6

## [0.40.6] — 2026-04-13

### Added

- **skills** — QA Testing Protocol in `devops-agents`: unit tests, build check, browser-based visual verification via waterfall (Chrome MCP → Playwright → Preview); computer-use requires explicit user opt-in
- **skills** — `devops-autonomous` Live Testing now references agents' QA protocol as single source of truth instead of duplicating testing logic

### Fixed

- **version** — sync marketplace.json to 0.40.5 (was left at 0.40.4 in prior release)

## [0.40.5] — 2026-04-13

### Added

- **deep-knowledge** — tab group deduplication rule in `browser-tool-strategy.md`: prevents duplicate Edge tab groups on Chrome MCP reconnect, scoped to Chrome MCP only, with concurrent-agent race condition documented as known limitation

### Fixed

- **version** — sync marketplace.json to 0.40.4 (was left at 0.40.3 in prior release)

## [0.40.4] — 2026-04-13

### Fixed

- **codex** — replace phantom skill references (`/codex:review`, `/codex:adversarial-review`, `/codex:cancel`) with actual available skills (`/codex:rescue`, `/codex:setup`) across ship SKILL, QA agent, codex-integration deep-knowledge, INSTALL, README, and architecture diagram
- **version** — align marketplace.json with current release version

## [0.40.3] — 2026-04-13

### Fixed

- **skills** — restore trigger phrases in ship, repo-health, refresh-usage, and flow skill descriptions that were accidentally removed during header trim (6fd39b0); removes ambiguous triggers ("fertig", "something's off") per Codex review

## [0.40.2] — 2026-04-12

### Added

- **hooks** — `ss.knowledge.index.js`: SessionStart hook injects deep-knowledge INDEX.md into context (~500 tokens) so Claude knows all reference docs before message #1
- **hooks** — `prompt.knowledge.dispatch.js`: UserPromptSubmit hook matches prompt keywords against topic map and injects relevant deep-knowledge files on-demand (once per session per topic, 8KB byte budget, specificity-sorted)
- **hooks** — post-update notice in `ss.plugin.update.js` signals when deep-knowledge index may have changed

## [0.40.1] — 2026-04-12

### Fixed

- **codex-integration** — skills (ship, flow, deep-research) and agents (QA, research) now load `codex-integration.md` at startup instead of relying on buried mid-flow references that were silently skipped

## [0.40.0] — 2026-04-12

### Added

- **hooks/ss.git.sync** — session-start hook registers a CronCreate job (every 10 min) to fetch remote main and merge parent chain into the current branch; keeps worktrees in sync even without user prompts
- **scripts/git-sync** — extracted standalone sync logic (fetch, parent-chain merge, auto-resolve with `--ours`) shared by cron and prompt hook

### Changed

- **hooks/prompt.git.sync** — delegates to shared `scripts/git-sync.js` instead of inlining the sync logic; throttle (15 min) preserved as overlap guard

### Fixed

- **versioning** — aligned marketplace.json to 0.39.9 (was lagging at 0.39.8)

## [0.39.9] — 2026-04-12

### Fixed

- **devops-agents** — removed automatic `/devops-ship` from agent orchestration; agents now only commit and push, shipping is the user's explicit decision

## [0.39.8] — 2026-04-12

### Fixed

- **mcp/completion** — fixed timeout mismatch in CDP usage scraper: MCP gave 30s but scraper needs up to 47s for Edge restart + page polling (30s→60s for escalation, 30s→45s for final scrape)
- **mcp/completion** — stepwise CDP escalation: auto-start failure now falls through to activate-cdp instead of giving up
- **mcp/completion** — added retry after scrape failure (3s delay, one retry) for Edge needing extra startup time
- **mcp/completion** — stopped premature deletion of `usage-live.json` before scrape attempt; file now preserved as last-resort fallback
- **mcp/completion** — specific error reasons in usage data response (not logged in, parse error, Edge restart failed, etc.) instead of generic "unavailable"
- **mcp/completion** — stale data indicator in completion card meter when showing cached usage data
- **versioning** — aligned marketplace.json to 0.39.7 (was lagging behind plugin.json/README/CHANGELOG)

## [0.39.7] — 2026-04-12

### Changed

- **devops-concept** — state persistence upgraded from `sessionStorage` to `localStorage` with 24h TTL (survives tab close, browser restart, accidental reloads)
- **devops-concept** — submit button stays enabled when Claude is disconnected (warning banner is sufficient)
- **devops-concept** — removed 5-minute monitoring timeout and 20-poll limit; concept pages now run indefinitely until user ends session

### Added

- **devops-concept** — offline submit queue: decisions cached in `localStorage` when bridge server is unreachable, auto-delivered on reconnect via `retryPendingSubmission()`

## [0.39.6] — 2026-04-12

### Changed

- **skills** — trimmed 6 hook-coupled skill description headers (~150-200 tokens saved): ship, commit, flow, repo-health, refresh-usage, self-update
- **skills** — removed redundant trigger phrase lists and verbose wording; guards and determinism preserved

### Added

- **project** — added project-level `CLAUDE.md` (22 lines) for dotclaude repo development context

### Fixed

- **versioning** — aligned marketplace.json to 0.39.5 (was lagging behind plugin.json/README/CHANGELOG)

## [0.39.5] — 2026-04-12

### Changed

- **devops-concept** — concept files now saved to `docs/concepts/` (git-tracked) instead of `.claude/devops-concept/`
- **devops-concept** — fixed naming pattern: `{timestamp}-{slug}-v{version}.html` with auto-versioning
- **devops-concept** — clear versioning vs. in-place update rules (feedback loop = same file, new session = version bump)
- **devops-concept** — tab redirect via `meta http-equiv="refresh"` on version bump
- **devops-concept** — removed direct Chrome MCP references, uses global browser-tool-strategy waterfall

### Fixed

- **devops-concept** — heartbeat flicker: `HEARTBEAT_STALE_MS` raised from 45s to 90s (safely covers 60s cron interval)
- **devops-concept** — corrected heartbeat docs: cron fires every 60s, not 10s

## [0.39.4] — 2026-04-12

### Added

- **devops-concept** — decision panel doubles as navigation TOC with anchor links to variant sections
- **devops-concept** — fullscreen + overlay layout mode for visual-heavy content (mockups, previews)
- **devops-concept** — new deep-knowledge `interactive-components.md` with tested star rating, slider, toggle, and expandable section implementations
- **devops-concept** — decision panel is now extensible with topic-specific controls between nav and submit

### Fixed

- **devops-concept** — tri-state labels: only "Exakt diese" shows "Claude setzt um", "Verwerfen" and "Miteinbeziehen" are both feedback
- **devops-concept** — star rating: banned CSS-only `direction: rtl` hack, enforced JS-based left-to-right fill with hover preview and re-selection

## [0.39.3] — 2026-04-12

### Added

- **browser-tool-strategy** — Edge Credo: 5 hard rules for browser interaction (Edge only, Claude extension first, user profile context, tab reuse, identical rules in background mode)
- **browser-tool-strategy** — computer-use for browser allowed only on explicit desktop takeover request

### Changed

- **devops-concept** — Step 3 references Edge Credo for browser opening
- **devops-autonomous** — Step 3b and background mode section reference Edge Credo
- **devops-burn** — Burn-Guidance includes Edge Credo section
- **devops-repo-health** — Step 8 references Edge Credo for browser interaction
- **desktop-testing** — replaced "Google Chrome" with Edge-only reference

## [0.39.2] — 2026-04-11

### Changed

- **self-calibration** — replaced cron-based trigger with Stop hook: calibration now runs only after real user interaction, never during idle sessions
- **self-calibration** — cooldown is worktree-specific (MD5 of cwd), so parallel worktrees have independent 10-minute cooldowns
- **self-calibration** — deprecated `prompt.flow.selfcalibration.js` (cron registration) and `prompt.flow.useractivity.js` (flag file mechanism), both are now no-ops

## [0.39.1] — 2026-04-11

### Changed

- **completion-card** — visual layout redesign: new block order Title → Content → State → Usage → Footer → CTA
- **completion-card** — title line no longer contains build ID (moved to new 📌 footer line)
- **completion-card** — footer line: 📌 with version bump info (if available) + build ID in backticks
- **completion-card** — CTA: removed version info, shipped shows merge target instead ("merged → main")
- **completion-card** — usage health line moved inside code block as first line, icon removed
- **completion-card** — delta markers (! / !!) removed, tighter column padding for alignment
- **completion-card** — shipped CTA: "Alles ERLEDIGT" (DE) / "All DONE" (EN)
- **completion-card** — test-minimal: no separator between title and footer (compact)

## [0.39.0] — 2026-04-11

### Added

- **concept** — HTTP bridge server (`concept-server.py`) for heartbeat and decision exchange, bypassing Chrome MCP JS injection limitation entirely
- **concept** — page heartbeat now polls `GET /heartbeat` via fetch instead of requiring `document.body.dataset.claudeHeartbeat` injection
- **concept** — submit handler POSTs decisions to `/decisions` endpoint, Claude reads via `GET /decisions`
- **concept** — `POST /reset` endpoint for clearing decisions between rounds

### Changed

- **concept** — SKILL.md Step 3 uses bridge server instead of `python -m http.server`
- **concept** — SKILL.md Step 4 uses HTTP polling + CronCreate heartbeat instead of JS eval monitoring
- **concept** — monitoring.md rewritten for HTTP-based protocol (JS eval only needed for optional page updates)
- **concept** — validation gate: `claudeHeartbeat` pattern replaced with `pollHeartbeat`

## [0.38.6] — 2026-04-11

### Fixed

- **refresh-usage** — SKILL.md referenced non-existent `devops-refresh-usage-headless.js` (actual: `refresh-usage-headless.js`), causing every manual refresh to fail silently with MODULE_NOT_FOUND
- **refresh-usage** — SKILL.md write path was `scripts/usage-live.json` but scraper writes to `~/.claude/usage-live.json`, causing path desync and permanent "unavailable" state
- **marketplace** — sync marketplace.json version to 0.38.5

## [0.38.5] — 2026-04-11

### Fixed

- **concept** — split-capability detection: Chrome MCP can be partially functional (tab management works, JS eval fails with "Cannot access chrome-extension://" error). Added `$EVAL_TOOL` validation step after waterfall probe with independent eval fallback chain
- **browser-tool-strategy** — documented split-capability detection as known failure mode with Chrome MCP

## [0.38.4] — 2026-04-11

### Fixed

- **autonomous** — post-confirmation lockout: zero user interaction after Step 4 (no inline questions, no permission prompts while user is AFK)
- **autonomous** — late permission handling: save progress to `AUTONOMOUS-RESUME.json`, execute shutdown if requested, resume on next boot
- **autonomous** — resume detection (Step 0.5): detect interrupted session, re-prime permissions, ask report vs shutdown preference
- **marketplace** — sync marketplace.json version to 0.38.3

## [0.38.3] — 2026-04-11

### Improved

- **concept** — variant evaluation tri-state (Verwerfen/Miteinbeziehen/Exakt diese) now clearly labels each option as `Feedback` or `⚠️ Claude setzt um` so users know before clicking whether it's passive input or triggers action
- **marketplace** — sync marketplace.json version to 0.38.2

## [0.38.2] — 2026-04-11

### Added

- **concept** — post-generation validation gate: 9-pattern grep checklist blocks opening pages without heartbeat, connection warning, panel states, or sessionStorage
- **concept** — localhost HTTP serving for concept pages (Chrome MCP cannot handle file:// URLs)

### Fixed

- **concept** — heartbeat initial grace period: 2s → 30s (Claude needs time for browser tool waterfall before first heartbeat)
- **concept** — document file:// URL limitation and MCP tab group isolation in monitoring.md
- **marketplace** — sync marketplace.json version 0.38.0 → 0.38.1

## [0.38.1] — 2026-04-11

### Fixed

- **merge** — restore devops-explain removal lost during v0.38.0 merge conflict (--ours overwrote PR #55 changes)

## [0.38.0] — 2026-04-11

### Changed

- **completion-card** — variant refactoring: renamed shipped/blocked/minimal-start to ship-successful/ship-blocked/test-minimal; removed legacy research alias; ship variants now ONLY triggered via /devops-ship pipeline
- **completion-card** — reversed state line order: most important first (merge/PR/push/commit/branch)
- **completion-card** — fallback icon changed from clipboard to wrench; test-minimal icon changed from beaker to play button
- **completion-card** — broadened test variant detection: applies to ANY project type (web, CLI, API, desktop, game), not just UI projects
- **completion-card** — ready variant threshold lowered to >=1 code edit

### Fixed

- **completion-card** — critical: card-rendered flag key mismatch (latest vs unknown) causing false carry-over reminders
- **completion-card** — template spec aligned with code: bar width 14, usage line format, inline elapsed markers, delta staleness threshold
- **completion-card** — extracted magic numbers (BAR_WIDTH, WINDOW_5H_MIN, etc.) as named constants
- **completion-card** — ship-blocked added to tests variant table

### Removed

- **explain** — remove unused devops-explain skill; Claude handles code explanations natively without a dedicated skill

## [0.37.2] — 2026-04-11

### Changed

- **repo-health** — integrate devops-concept for interactive results: replace markdown report with dashboard concept page featuring repo context header, category filters (safe-delete/investigate/worktree/remote), batch action checkboxes, and decision panel sidebar; user filters, selects branches, and submits cleanup decisions directly from the browser

## [0.37.1] — 2026-04-11

### Added

- **concept** — reload-resilient monitoring: page reload (F5) no longer kills the monitoring loop; eval failure + tab alive = wait & retry (up to 3x with 3s gaps), never stops monitoring for transient page unavailability
- **concept** — sessionStorage persistence: user selections (toggles, radios, textareas, sliders, selects, theme) survive page reloads via sessionStorage keyed by page slug
- **concept** — Claude heartbeat mechanism: monitoring poll injects `data-claude-heartbeat` timestamp; page checks freshness every 5s; stale heartbeat (>45s) disables submit button + shows warning banner
- **concept** — connection-aware decision panel: three visual states (Ready / Disconnected / Submitted); disconnected state shows yellow warning + disabled button; submitted state shows success indicator + "switch to Claude chat" hint + waiting dots animation
- **concept** — panel state reset: Claude resets panel from "submitted" back to "ready" after processing decisions, enabling the next feedback round

### Fixed

- **ship** — sync marketplace.json version to 0.37.0 (was 0.36.8)

## [0.37.0] — 2026-04-11

### Added

- **concept** — collapsible decision panel: toggle button to collapse/expand the sidebar (default: expanded), collapsed state shrinks to 48px narrow strip with re-expand button
- **concept** — live panel navigation: clickable section index in the decision panel that smooth-scrolls to the corresponding content area; scroll-spy highlights the active section; green dot for sections with completed decisions

### Fixed

- **concept** — harden browser monitoring with tab-alive detection and type safety: add tabId type invariant (must be number), mid-session reconnection protocol for extension disconnects, per-poll tab-alive check to prevent silent monitoring death, prohibit `get_page_text` for structured data (causes "page too large" errors), comprehensive error recovery matrix (8 error types)
- **ship** — sync marketplace.json version to 0.36.8 (was 0.36.7 while other files had 0.36.8)
- **ship** — align marketplace.json version (was stuck at 0.36.4 while other files had 0.36.7)

## [0.36.7] — 2026-04-11

### Fixed

- **ship** — resolve build-id script path dynamically: after mid-session plugin cache rebuild, `__dirname` pointed to deleted old cache version causing `build-id.js` ENOENT; replaced static import-time resolution with lazy `pluginRoot()` fallback chain (env var → static path → cache parent scan)

## [0.36.6] — 2026-04-11

### Fixed

- **ship** — require `cwd` on all 5 ship MCP tools: the MCP server runs in the plugin directory, not the target repo; silent `process.cwd()` fallback caused `gh pr create` to operate on the wrong repository when invoked from worktrees or other projects; schema now enforces required `cwd`, handler throws hard error if missing, SKILL.md examples updated

## [0.36.5] — 2026-04-11

### Fixed

- **hooks** — eliminate self-calibration over-execution: disable SessionStart hook (no-op), add 60s debounce to useractivity flag, add 8-minute cooldown guard in cron prompt, unify runOnce key — reduces idle-session calibration from up to 6x/hour to maximum 1x

## [0.36.4] — 2026-04-11

### Added

- **deep-knowledge** — centralized browser tool strategy: Edge Claude-in-Chrome extension as primary tool, silent waterfall fallback (Chrome MCP → Playwright → Preview), hard error block with fix instructions when no tool available, computer-use explicitly banned for browser interaction (read-only tier)
- **deep-knowledge** — "Erstmal in Ruhe durchlesen" rule: when AskUserQuestion follows substantial inline results, the first option must offer a read-first escape with subtext clarifying nothing will change until the user continues; re-presents questions without that option after selection
- **agents** — execution mode selection: users choose between background (autonomous) and interactive (inline Q&A) agent work before orchestration begins

### Changed

- **autonomous** — browser priming (Step 3b) now references central strategy with `$BROWSER_TOOL` variable instead of inline waterfall
- **concept** — monitoring and polling use central browser tool strategy instead of duplicated priority lists
- **desktop-testing** — added warning to prefer browser tool strategy over computer-use for web UI

### Fixed

- **hooks** — completion card hooks now call `render_completion_card` MCP tool directly instead of via ToolSearch; ToolSearch only searches deferred tools, causing silent resolution failures when the tool is already loaded
- **hooks** — aligned `marketplace.json` version (was stuck at 0.36.1 while other files had 0.36.2)

## [0.36.2] — 2026-04-10

### Added

- **hooks** — worktree branch guard: prevents working on main/master inside linked worktrees; outputs BLOCKING instruction to create a new branch first; silent when not in a worktree

## [0.36.1] — 2026-04-10

### Fixed

- **completion-card** — removed delta marker suffixes (! / !!) from usage meter; delta is now a clean (+N%) without trailing noise

## [0.36.0] — 2026-04-10

### Changed

- **autonomous** — report is now a self-contained interactive HTML file (dark theme, collapsible sections, embedded completion card data) instead of an unread markdown file; auto-opens in Edge on completion

## [0.35.15] — 2026-04-10

### Fixed

- **autonomous** — stable option order in AskUserQuestion prompts with "(empfohlen)" markers on recommended choices

## [0.35.14] — 2026-04-09

### Added

- **autonomous** — allow Claude-in-Chrome (Edge) browser control in background mode; DOM-based tab interaction without desktop takeover

### Fixed

- **marketplace** — aligned `marketplace.json` version to v0.35.13 (missed in prior release)

## [0.35.13] — 2026-04-09

### Fixed

- **usage** — session reset timer showed "0h 0m left" when less than 1 hour remained; regex now handles minutes-only format
- **usage** — `formatResetShort` null guard returns "—" instead of coercing null to "0h 0m"
- **usage** — null-safe elapsed percentage calculation for progress bar

## [0.35.12] — 2026-04-09

### Fixed

- **i18n** — replace all remaining ASCII umlaut digraphs (ae/oe/ue) with proper German umlauts across skills, deep-knowledge, hooks, templates, and MCP server strings

## [0.35.11] — 2026-04-09

### Added

- **hooks** — idle guard for self-calibration cron: skip cycle when no user prompt occurred since the last run, preventing token waste in idle sessions (#28)
- **hooks** — new `prompt.flow.useractivity` hook touches a session-scoped flag on every user prompt for cross-session isolation

## [0.35.10] — 2026-04-09

### Fixed

- **i18n** — replace ASCII umlaut substitutes in completion card CTAs (`AENDERN` → `ÄNDERN`, `zurueck` → `zurück`)

## [0.35.9] — 2026-04-09

### Changed

- **skills** — rename `devops-livebrief` to `devops-concept` (directory, SKILL.md, reference, deep-knowledge, README, .gitignore)
- **chore** — untrack `.claude/project-map.md` (already in .gitignore)

## [0.35.8] — 2026-04-09

### Added

- **deep-knowledge** — project-map awareness: teach Claude to consult `.claude/project-map.md` before running full-repo Grep/Glob searches
- **hooks** — token guard now shows "Hint: Read .claude/project-map.md" when blocking broad Grep/Glob operations

### Fixed

- **mcp** — add cache fallback for usage fetch: when CDP scrape chain fails, use cached `usage-live.json` data (if within 5h reset window) instead of showing "Usage data unavailable"
- **mcp** — catch CDP escalation errors (`--activate-cdp`, `--auto-start`) separately so the final scrape attempt still runs even if escalation fails

## [0.35.7] — 2026-04-08

### Fixed

- **hooks** — replace Glob-based SKILL.md discovery with direct Read path for immediate execution and directory listing for cron; fixes Windows wildcard matching failure in deep cache paths

## [0.35.6] — 2026-04-08

### Changed

- **gitignore** — ignore `.claude/project-map.md` (auto-generated, not distributable)

## [0.35.5] — 2026-04-08

### Changed

- **skills** — renamed `/devops-orchestrate` to `/devops-agents` for clarity; updated all references, triggers, and extension paths

## [0.35.4] — 2026-04-08

### Fixed

- **ship** — replace passive Codex review step with enforced review gate: MUST-run when codex-plugin-cc is installed, auto-fixes trivial issues, pauses for user judgment only on design/logic/security concerns
- **deep-knowledge** — aligned `codex-integration.md` with new review gate behavior

## [0.35.3] — 2026-04-08

### Fixed

- **hooks** — `ss.git.check` v0.3.0: add `git fetch --quiet` before unpushed detection to prevent false positives when commits are already merged via GitHub PRs but local remote-tracking refs are stale
- **hooks** — `ss.flow.selfcalibration` + `prompt.flow.selfcalibration` v0.6.0: emit version-agnostic glob pattern in cron prompt instead of baking the versioned cache path from `__dirname`; prevents broken SKILL.md paths when `ss.plugin.update` rebuilds the cache mid-session
- **marketplace** — aligned `marketplace.json` version to v0.35.2 (missed in PR #21)

## [0.35.2] — 2026-04-08

### Added

- **hooks** — `ss.plugin.update` v0.5.0: desktop notification (tray/toast) when a real plugin version upgrade is detected at session start; cross-platform (Windows BalloonTip, macOS osascript, Linux notify-send); cache-only repairs remain silent

### Fixed

- **marketplace** — aligned `marketplace.json` version to v0.35.1 (was stuck at v0.35.0 from previous release)

## [0.35.1] — 2026-04-08

### Fixed

- **ship** — `mergePR()` now skips `--delete-branch` flag when running inside a git worktree, preventing `gh` from failing on local branch switch; branch cleanup deferred to `ship_cleanup` as designed
- **marketplace** — synced `marketplace.json` version to v0.35.0 (was stuck at v0.34.1)

## [0.35.0] — 2026-04-08

### Added

- **skills** — new `devops-burn` skill: explicit-only high-throughput mode that collects tasks from multiple sources (GitHub Issues, TODOs, lint errors, coverage gaps, open PRs), prioritizes them (P0–P5), then launches autonomous mode with aggressive parallelization guidance; includes mandatory confirmation gate and anti-trigger safeguards

## [0.34.1] — 2026-04-08

### Fixed

- **hooks** — `ss.plugin.update` v0.4.0: `copyDir` fallback condition was dead code (`!result && result !== ''` always false); now verifies copy by checking file existence instead of trusting `run()` return value
- **hooks** — `ss.plugin.update`: `rebuildCache` no longer updates registry when file copy fails; aborts early with error
- **hooks** — `ss.plugin.update`: new cache-staleness guard detects stale content via version + SHA mismatch, triggering rebuild even when cache directory exists with correct name

## [0.34.0] — 2026-04-08

### Changed

- **autonomous** — added execution mode question: "analyze only" vs "analyze, implement & test"; analyze mode is read-only, implement mode always starts with analysis phase
- **autonomous** — all permission priming (computer-use `request_access`, browser, shell, MCP tools) now completes before final "Ja, los!" confirmation — no more late permission prompts
- **autonomous** — auto-start fallback reduced from 5 to 3 minutes
- **autonomous** — added analyze-mode report template (findings, recommendations, visual verification)

## [0.33.2] — 2026-04-08

### Fixed

- **skills** — Step 0 extension loading now uses Glob to check file existence before Read, preventing "File does not exist" errors on machines without global skill extensions (all 13 skills)
- **skills/docs** — all bare `scripts/build-id.js` references replaced with `{PLUGIN_ROOT}/scripts/build-id.js` across deep-knowledge, templates, and skill docs (6 files); prevents Claude from generating wrong `~/.claude/scripts/` paths in project skills
- **skills** — `{plugin-root}` placeholder normalized to `{PLUGIN_ROOT}` in project-setup and claude-md-lint skills for consistency with CONVENTIONS.md
- **ship** — `ship_release` no longer runs `git checkout <base>` after merge; uses `git fetch` instead, fixing `fatal: 'main' is already used by worktree` in worktree setups
- **ship** — tags now created on `origin/<base>` (the merge commit) instead of local HEAD, which pointed at the deleted feature branch
- **hooks** — `pre.ship.guard` now only intercepts Bash tool calls; no longer blocks MCP tool fallback retries (e.g. when Claude retries a failed `ship_release` via Bash)
- **conventions** — added explicit path rule: scripts must be referenced via `{PLUGIN_ROOT}/scripts/`, never `~/.claude/scripts/`

## [0.33.1] — 2026-04-08

### Fixed

- **ship** — `detectProjectType` now validates `package.json` has a `version` field before claiming npm type; falls through to marketplace.json detection for repos with versionless package.json (fixes `ship_version_bump` returning "No version file found")
- **ship** — `gh pr create` no longer uses unsupported `--json` flag; parses PR URL from stdout instead (v0.32.1)
- **hooks** — `ss.plugin.update` v0.3.0: recovers from dirty marketplace clones (reset + retry pull) and rebuilds cache when registry points to missing path (v0.32.1)

## [0.33.0] — 2026-04-08

### Added

- **hooks** — `ss.team.changelog`: session-start hook that shows a summary of changes by other contributors on remote `main` since the user's last commit; auto-detects identity via `git config` and GitHub noreply cross-matching; silent when no foreign commits

## [0.32.2] — 2026-04-08

### Changed

- **skills** — rename `autonomous-mode` → `devops-autonomous` for consistent `devops-` prefix across all skills

## [0.32.1] — 2026-04-08

### Fixed

- **hooks** — `ss.plugin.update` v0.3.0: recover from dirty marketplace clone (reset + retry pull) and rebuild cache when registry points to missing path (`[cache repair]`)

## [0.32.0] — 2026-04-07

### Added

- **hooks** — `pre.ship.guard`: PreToolUse hook that blocks `gh pr create`, `gh pr merge`, and `gh api .../pulls/.../merge` via Bash, enforcing all shipping through `/devops-ship`

## [0.31.1] — 2026-04-07

### Fixed

- **completion-card** — opening `---` separator now always rendered before the usage meter; previously the card started without a top delimiter when usage data was available, leaving the usage section visually unframed

## [0.31.0] — 2026-04-07

### Added

- **skills** — `devops-self-update`: manual plugin update trigger with changelog and verification report
- **hooks** — `ss.plugin.update` v0.2.0: unified cache-rebuild + registry update (not just cache invalidation)

### Changed

- **BREAKING** — plugin key renamed from `dotclaude-dev-ops@dotclaude-dev-ops` to `devops@dotclaude`; legacy keys preserved as fallback
- **plugin** — directory renamed `plugins/dotclaude-dev-ops/` → `plugins/devops/`
- **marketplace** — marketplace name `dotclaude-dev-ops` → `dotclaude`
- **hooks** — all MCP tool references updated (`mcp__plugin_devops_*`)
- **skills** — `devops-self-update` v0.3.0: delegates to hook instead of duplicating logic

## [0.30.5] — 2026-04-07

### Added

- **agents** — "Issue Creation as Team Refinement" pattern added to `agent-collaboration.md`: creating an issue is a structured refinement session across all relevant roles (po → domain roles → UX/user role → qa)

## [0.30.4] — 2026-04-07

### Fixed

- **readme** — skill count corrected from 15 to 16, added missing `/devops-self-update` to skills table and feature list
- **github** — updated `Jerry0022/dotclaude` repo About description (was still referencing old plugin name)

## [0.30.3] — 2026-04-07

### Fixed

- **usage** — weekly reset timer matched wrong section (per-model instead of weekly) when reset was < 24h away; now collects all duration-style resets and takes the last one (weekly section)
- **usage** — weekly reset < 1h showed stale value because minutes-only format ("2 Min.") was not supported

## [0.30.2] — 2026-04-07

### Fixed

- **agents** — designer agent now enforces existing design systems and style guides as binding by default; deviations require explicit user approval

## [0.30.1] — 2026-04-07

### Fixed

- **completion** — `render_completion_card` now accepts optional `buildId` parameter, fixing `0000000` fallback when worktree state changes between `ship_build` and card render (post-merge)

## [0.30.0] — 2026-04-07

### Added

- **hooks** — `prompt.git.sync` now supports full branch hierarchy: for `feat/auth/login`, merges `main` → `feat` → `feat/auth` into the current branch instead of only `main`
- **hooks** — `prompt.git.sync` auto-resolves merge conflicts with `--ours` (keeps local changes) before aborting — only aborts when resolution fails

## [0.29.2] — 2026-04-07

### Fixed

- **ship** — all MCP ship tools (preflight, release, cleanup, version-bump) now accept `cwd` parameter for correct worktree operation; previously used MCP server's `process.cwd()` which pointed to the main repo, not the active worktree
- **ship** — `resolve-root.js` uses per-cwd cache instead of global singleton that returned stale paths in worktree context
- **hooks** — session-start git check (`ss.git.check.js`) now detects linked worktrees: only checks current branch's unpushed commits (not all `--branches`) and skips repo-global stashes

## [0.29.1] — 2026-04-07

### Fixed

- **usage** — weekly reset time showed "0h 0m left" when reset was < 24h away (claude.ai switches from day+time to duration format near reset)

## [0.29.0] — 2026-04-07

### Added

- **skills** — new `/devops-autonomous` skill: fully autonomous agent orchestration while user is AFK — task intake, permission priming, desktop/background test mode, safety guardrails (no push/ship), structured report with completion card, optional PC shutdown

## [0.28.1] — 2026-04-06

### Improved
- **concept** — decision panel is now a fixed 20% sidebar (not overlay), always visible while scrolling
- **concept** — tri-state variant evaluation: Verwerfen / Miteinbeziehen (default) / Exakt diese Variante — with exclusive-select logic
- **concept** — iterative live feedback loop: Claude processes submissions, updates the page in-browser, user can act again (replaces one-shot model)
- **concept** — wider text fields (`width: 100%`, `min-height: 80px`) for better usability

## [0.28.0] — 2026-04-05

### BREAKING

- **skills** — all 13 skills renamed with `devops-` prefix for namespace clarity: `/ship` → `/devops-ship`, `/commit` → `/devops-commit`, `/flow` → `/devops-flow`, `/deep-research` → `/devops-deep-research`, `/explain` → `/devops-explain`, `/new-issue` → `/devops-new-issue`, `/project-setup` → `/devops-project-setup`, `/readme` → `/devops-readme`, `/refresh-usage` → `/devops-refresh-usage`, `/extend-skill` → `/devops-extend-skill`, `/repo-health` → `/devops-repo-health`, `/claude-md-lint` → `/devops-claude-md-lint`, `/concept` → `/devops-concept`
- **extensions** — user extension directories must be renamed to match (e.g. `.claude/skills/ship/` → `.claude/skills/devops-ship/`)
- **hooks** — `prompt.ship.detect` now emits `Skill("devops-ship")` and `Skill("devops-commit")`

### Added

- **skills** — new `/devops-agents` skill (formerly `/devops-orchestrate`): explicitly evaluate which agents are useful for a task and orchestrate their parallel or sequential execution with wave-based planning

## [0.27.0] — 2026-04-05

### Added
- **skills** — new `/concept` skill: generates interactive self-contained HTML pages for analysis, plans, concepts, comparisons, prototypes, dashboards, and creative work; opens in Edge as new tab; monitors user decisions (toggles, selections, comments) via browser tools and feeds them back into Claude's workflow
- **concept** — 7 recommended variant templates (analysis, plan, concept, comparison, prototype, dashboard, creative) with design system, decision JSON schema, and submit-button feedback mechanism
- **concept** — browser monitoring spec with 4-level fallback: Claude in Chrome/Edge → Playwright → Preview → manual
- **concept** — extension reference for project-level customization (design overrides, default variant, output location, custom elements, browser preference)

## [0.26.1] — 2026-04-05

### Fixed
- **safety** — `ship_cleanup` now detects branches attached to active worktrees and refuses to delete them; previously a cleanup could break a parallel worktree session by deleting its branch
- **safety** — `repo-health` skill hardened with explicit worktree branch protection: hard rule against deleting, recommending, or touching worktree-attached branches — even on user request
- **git lib** — new `getWorktreeBranches()` helper parses `git worktree list --porcelain` to build a protected branch set

## [0.26.0] — 2026-04-05

### Added
- **testing** — automated desktop testing via Computer Use: at 5+ code edits on UI/web projects, Claude asks the user for desktop takeover consent before running visual tests automatically; includes mandatory warning about desktop interruption
- **hooks** — `post.flow.completion` now injects desktop-testing prompt at 5+ edits, ensuring the consent question is in context when Claude builds the completion card
- **deep-knowledge** — `desktop-testing.md` with full rules: trigger conditions, user consent flow, Computer Use test steps, safety constraints (2-min timeout, no sensitive data, user abort)

## [0.25.5] — 2026-04-05

### Fixed
- **completion card** — verbatim relay protection: explicit instructions across all card output paths (MCP tool description, response blocks, hooks, plugin-behavior.md) to prevent system emoji-avoidance from stripping pre-rendered card content
- **completion card** — separate instruction/content blocks in `render_completion_card` MCP response so the relay reminder is read by Claude but not displayed to the user
- **self-calibration** — persist cycle index to `$TMPDIR/dotclaude-devops-calibration-cycle.json` for cross-session deep-knowledge batch rotation; previously every session restarted at batch 0

## [0.25.4] — 2026-04-05

### Fixed
- **build-id** — include untracked files (`--cached --others --exclude-standard`) in hash computation; previously new code/assets without `git add` were invisible to the build-ID

## [0.25.3] — 2026-04-05

### Changed
- **build-id** — prefer worktree name (e.g. `magical-napier`) over content hash when running inside a git worktree; falls back to 7-char hash outside worktrees

## [0.25.2] — 2026-04-05

### Fixed
- **build-id** — `render_completion_card` and `ship_build` now accept optional `cwd` parameter for worktree-aware build-ID computation; previously both resolved against the MCP server's process.cwd(), causing identical build IDs across different worktrees

## [0.25.1] — 2026-04-05

### Fixed
- **hooks** — selfcalibration hooks now emit explicit `Plugin root` path so SKILL.md resolves `deep-knowledge/` against the correct cache version (was guessing wrong version number)
- **scheduled-tasks** — SKILL.md deep-knowledge paths use `{PLUGIN_ROOT}` placeholder anchored to hook-provided root

## [0.25.0] — 2026-04-05

### Added
- **deep-knowledge** — `agent-proactivity.md` behavioral rule for proactive agent orchestration without explicit user request; triggers on multi-domain tasks, repeated bug fixes (2+ passes), and polishing iterations

### Changed
- **self-calibration** — interval reduced from 30 minutes to 10 minutes for tighter feedback loops (SKILL.md + hook)

## [0.24.4] — 2026-04-05

### Fixed
- **hooks** — self-calibration task instruction now emits absolute `skillPath` instead of bare relative path, fixing SKILL.md not-found on session start

## [0.24.3] — 2026-04-04

### Fixed
- **hooks** — self-calibration moved from SessionStart to UserPromptSubmit for higher priority execution at session start
- **hooks** — completion card instructions now explicitly tell Claude to output card markdown as direct text (MCP tool results are hidden in Desktop App collapsed UI)
- **docs** — `plugin-behavior.md` updated with new hook architecture and Desktop App visibility rule

## [0.24.2] — 2026-04-03

### Fixed
- **usage-meter** — `renderBar` elapsed marker now correctly distinguishes heavy/light region (was always thin `╏`, now `╇`/`╏` conditional)
- **mcp-server** — removed stale "canonical source" comments referencing deleted files (`scripts/render-card.js`, `scripts/lib/usage-meter.js`)
- **hooks** — extracted duplicated `PLAN_DEFAULTS` to shared `hooks/lib/plan-defaults.js` (was identical in `ss.tokens.scan` + `pre.tokens.guard`)
- **hooks** — aligned `CONFIG_PATH` pattern in `pre.tokens.guard` with `ss.tokens.scan` (consistent `cwd`/`CONFIG_DIR` usage)

### Removed
- **scripts** — deleted `scripts/lib/usage-meter.js` (MCP server `index.js` is now the single source of truth)

## [0.24.1] — 2026-04-03

### Fixed
- **docs** — Desktop App marketplace UI doesn't list third-party plugins; CLI now recommended as primary install method
- **docs** — added troubleshooting section to INSTALL.md with manual registration steps for Desktop App users
- **hooks** — completion card hooks now emit fully qualified `select:` ToolSearch path for `render_completion_card`, fixing silent resolution failures caused by keyword matching on long MCP prefixes

## [0.24.0] — 2026-04-03

### Added
- **indexing** — `gen-dk-index.js` auto-generates `deep-knowledge/INDEX.md` topic map from all `.md` files (plugin + project)
- **indexing** — `gen-project-map.js` auto-generates `.claude/project-map.md` with full codebase structure via `git ls-files`
- **ship** — `ship_build` regenerates both indexes (deep-knowledge + project map) before every build
- **skills** — `project-setup --init` generates project map; `claude-md-lint --fix` regenerates deep-knowledge index after extraction

### Changed
- **conventions** — deep-knowledge lookup rule: read INDEX.md first before individual files

## [0.23.0] — 2026-04-03

### Added
- **quality** — Vitest test suite with 56 unit tests covering version bumping, git operations, fuzzy issue matching, session file I/O, and execution guards
- **quality** — ESLint flat config with CJS/ESM-aware linting for hooks and MCP servers
- **quality** — extracted `matching.js` from issues MCP server for testability

### Fixed
- **lint** — removed unused imports/requires across 4 hooks and 2 MCP server tools
- **lint** — fixed unnecessary regex escapes in token guard and matching module

## [0.22.2] — 2026-04-03

### Fixed
- **version** — `updateReadme()` now uses generic `**Version: X.Y.Z**` pattern instead of exact oldVersion match, preventing silent drift when README is already out of sync
- **version** — `updateJson()` force-sets newVersion regardless of current value, fixing silent drift in satellite JSON files
- **version** — marketplace.json `plugins[*].version` now updated and verified alongside `metadata.version`
- **version** — repo-root sweep: when MCP server CWD ≠ git root (plugin-dev scenario), version files at repo root (README.md, marketplace.json) are now also updated and verified
- **version** — new `resolve-root.js` module with cached `git rev-parse --show-toplevel` for repo-root detection

## [0.22.1] — 2026-04-03

### Changed
- **codex-integration** — Codex steps now run automatically when plugin is installed (previously only offered/suggested); silently skipped when not installed

## [0.22.0] — 2026-04-03

### Added
- **ship** — hierarchical merge: sub-branch → feature branch → main with auto-detection via `detectParentBranch()`
- **ship** — base branch existence check in preflight (hard gate)
- **ship** — merge-conflict pre-check: blocks ship when base is ahead of HEAD
- **ship** — duplicate PR detection: reuses existing open PR instead of failing
- **ship** — merge verification retry (3 attempts, 2s backoff) for transient network errors
- **ship** — squash-merge traceability convention: final PR body must list intermediate PR numbers
- **skill** — new `/repo-health` skill: branch hygiene audit, stale branch detection, PR cross-reference

### Fixed
- **ship** — unpushed commits now hard-block preflight (was advisory-only)
- **ship** — `commitMessage=null` with staged changes now aborts instead of silently losing them
- **ship** — `git add -A` replaced with targeted staging (only tracked modified + CHANGELOG) to prevent accidental sensitive file commits
- **ship** — tag failure no longer blocks cleanup (merge already landed)
- **ship** — `commitsAhead()` now uses `origin/` ref after fetch (was stale local ref)
- **ship** — `readVersion()` triple-call eliminated (cached result)
- **ship** — cleanup restores original branch after checkout (avoids disrupting parallel work)
- **ship** — cleanup accepts `cwd` parameter for accurate worktree detection
- **ship** — push timeout increased from 15s to 60s for large repos
- **ship** — error truncation increased from 500 to 1000 chars
- **ship** — ExitWorktree failure now stops pipeline (was undocumented)

### Changed
- **agents** — feature agent must push integration branch before spawning sub-agents
- **agents** — sub-branch shipping must be sequential within a wave (prevents merge conflicts)

## [0.21.1] — 2026-04-03

### Changed
- **guard** — token threshold now based on real 200K context window instead of fictional 1M session limit
- **guard** — threshold scales by Claude plan: pro 10K (5%), max_5 16K (8%), max_20 20K (10%)
- **guard** — auto-migrates old v0.1 configs (1M/2%) to plan-aware values at runtime

### Added
- **scanner** — detects Claude plan from env var, token-config, or settings.json
- **scanner** — writes plan-specific `estimatedLimitTokens` and `confirmThresholdPct` to config

## [0.21.0] — 2026-04-03

### Added
- **completion-card** — context health advisory line: shows tool-call count and recommends `/compact` (>40) or `/clear` (>80)
- **skill** — new `/claude-md-lint` skill: audits CLAUDE.md files for size (max 25 lines), structure, and token efficiency; suggests creation if missing
- **hooks** — cache-timeout detection in `prompt.ship.detect`: warns when >5 min pause expires prompt cache
- **hooks** — verbose command guard in `pre.tokens.guard`: blocks unbounded `git log`, `npm ls`, `find`, `docker logs` and suggests limited alternatives
- **hooks** — tool-call counter + last-activity timestamp in `post.flow.completion` for session health tracking
- **hooks** — stale temp file cleanup (>24h) in `ss.git.check` SessionStart hook
- **agents** — model selection guidance in feature agent: haiku for search/summarize, sonnet for code, opus for architecture

### Changed
- **skill** — `/project-setup` now calls `/claude-md-lint` as sub-step

## [0.20.1] — 2026-04-03

### Fixed
- **self-calibration** — completion flow elevated to mandatory Step 0 (runs first every cycle, not a subsection)
- **session-start hook** — CRITICAL hint added so immediate first run internalizes completion flow before any user task
- **issue-detection** — implicit (branch-name) issues no longer persisted before user confirmation; uses separate "asked" marker to prevent re-prompting
- **session-id** — glob fallback now filters files older than 2h, preventing cross-session state bleeding in concurrent sessions
- **completion-card** — removed duplicate standalone `render-card.js`; MCP server is now the single canonical renderer
- **completion-card** — added `analysis` variant to MCP server (was only in removed standalone script); `research` remains as legacy alias
- **completion-hook** — language for completion card now dynamic based on user language instead of hardcoded German
- **usage-scraper** — Edge executable path now detected dynamically via common install paths + registry fallback instead of hardcoded path
- **ship/github** — `gh()` helper converted from `execSync` string interpolation to `execFileSync` with argument array, eliminating shell injection risk

## [0.20.0] — 2026-04-03

### Changed
- **marketplace** — restructured repository to official plugin subdirectory pattern (`plugins/dotclaude-dev-ops/`)
- **marketplace** — `marketplace.json` source changed from `"./"` to `"./plugins/dotclaude-dev-ops"` for proper cache isolation
- **marketplace** — split `.claude-plugin/`: marketplace.json stays at root, plugin.json moves into plugin subdirectory
- Matches pattern used by `claude-plugins-official` and `openai-codex` — enables Manage button in Desktop App

### Added
- **plugin** — `userConfig` with `claude_plan` field for Desktop app plugin configuration

### Includes all changes from v0.19.4–v0.19.8
- **marketplace** — aligned manifest with official Anthropic format
- **mcp-server** — stale usage data outside 5h reset window discarded
- **completion-card** — git hash prefix and build-ID cwd fixes
- **ship/github** — execFileSync + stdin for shell safety
- **hooks** — atomic writeSessionFile across all hooks
- **skills** — MCP tool patterns in allowed-tools
- **usage-meter** — elapsed marker fix

## [0.19.3] — 2026-04-01

### Fixed
- **docs** — hook count 10→12 in README and project structure comment
- **docs** — added missing `ss.mcp.deps` and `stop.flow.guard` hooks to README lifecycle/category sections
- **docs** — added Stop lifecycle stage to README hook documentation
- **docs** — replaced stale `pre.ship.guard.js` with complete 12-hook directory structure in CONVENTIONS.md
- **docs** — replaced removed `pre.ship.guard` hook reference with `ship_preflight` MCP tool in versioning.md
- **docs** — fixed "Feature Worker" → "Feature" agent name inconsistency in README

## [0.19.2] — 2026-04-01

### Fixed
- **usage-meter** — redesigned usage display: `━─╏` line-style bar with inline elapsed marker replaces broken arrow alignment
- **usage-meter** — delta now displays correctly (was missing in both `get_usage` and `render_completion_card`)
- **usage-meter** — compact 2-line layout (was 4-5 lines with separate arrow rows)
- **mcp-server** — `get_usage` now passes deltas to `renderUsageMeter`; `renderUsageMeterForCard` uses shared `renderUsageLine`

## [0.19.1] — 2026-04-01

### Fixed
- **mcp-server** — MCP dependencies now auto-installed via SessionStart hook into `CLAUDE_PLUGIN_DATA` (fixes servers failing in plugin cache where `node_modules` are absent)
- **mcp-server** — ESM-compatible symlink strategy replaces non-functional `NODE_PATH` approach for package resolution
- **mcp-server** — consolidated shared `package.json` for all MCP server dependencies; ship server references parent deps
- **hooks** — added `ss.mcp.deps.js` as first SessionStart hook (runs before all others to ensure MCP servers can start)

## [0.19.0] — 2026-04-01

### Added
- **mcp-server/issues** — new MCP server (`dotclaude-issues`) that caches open GitHub issues in background (60s refresh) and exposes a `match_issues` tool for fuzzy matching user prompts against issue titles and labels
- **issue detection hook** — v0.3.0: on the first prompt of a session with no explicit issue number, instructs Claude to call `match_issues` for heuristic issue matching; subsequent prompts skip the heuristic (token-efficient ~200 tokens/session)

## [0.18.3] — 2026-04-01

### Fixed
- **mcp-server** — added `.mcp.json` for reliable MCP server registration (workaround for inline `mcpServers` bug in `plugin.json`, see claude-code#16143)
- **mcp-server** — installed missing npm dependencies for both `dotclaude-completion` and `dotclaude-ship` servers
- **global CLAUDE.md** — removed plugin-specific `render-card.js` reference that broke other projects

## [0.18.2] — 2026-04-01

### Fixed
- **completion-card** — renamed `research` variant to `analysis` (covers audit/plan/review/explain); `research` kept as legacy alias for backward compat
- **render-card.js** — updated VARIANTS + CTA tables; `renderState` + `renderCTA` handle legacy `research` alias
- **completion-card.md** — Variant Selection Rules extended: `plan`, `audit`, `analysis` explicitly route to `analysis (6)`; added Key Rule clarifying `ready` vs `analysis` based on whether files were changed

## [0.18.1] — 2026-04-01

### Fixed
- **ship/lib/github.js** — `mergePR()` now verifies PR state is MERGED before proceeding; fetches origin/main for accurate merge commit sha
- **ship/tools/release.js** — replaced shell-interpolated `execSync` with `execFileSync` for commit messages, preventing shell injection
- **ship/SKILL.md** — added `success: false` error check for version bump step; added cleanup error handling guidance
- **render-card.js** + **mcp-server/index.js** — flag write failures now logged to stderr instead of silent catch
- **deep-research/SKILL.md** — removed invalid `agent: Explore` reference (no such agent exists)
- **INSTALL.md** — corrected Codex plugin installation steps to match actual Claude Code Desktop UI (Customize → + → Browse Plugins)

### Removed
- **pre.ship.guard.js** — orphaned hook file deleted (was already removed from hooks.json in v0.18.0 but file remained on disk)
- **plugin-guard.js** — removed unused `isEnabledIn()` function (dead code since `isEnabledInAny()` replaced it)
- **github.js** — removed unused `repoName()` export

### Changed
- **README.md** — corrected agent count to 10 (added Designer), corrected hook count to 10 (removed pre.ship.guard references), alphabetized agent table

## [0.18.0] — 2026-04-01

### Added
- **MCP server** `dotclaude-ship` v0.1.0 — new MCP server with 5 granular ship pipeline tools: `ship_preflight`, `ship_build`, `ship_version_bump`, `ship_release`, `ship_cleanup`
- **ship/lib/git.js** — shared git CLI wrappers (dirtyState, commitsAhead, unpushedCommits, isWorktree, etc.)
- **ship/lib/github.js** — shared gh CLI wrappers (createPR, mergePR, createRelease)
- **ship/lib/version.js** — version file detection, bumping, updating, and verification across plugin/npm project types

### Changed
- **ship/SKILL.md** v0.2.0 — rewritten to orchestrate MCP tools instead of raw Bash commands; deterministic structured JSON data flow between steps
- **plugin.json** — registered `dotclaude-ship` MCP server alongside existing `dotclaude-completion`

### Removed
- **pre.ship.guard** hook — dirty-tree and version-consistency checks now handled by `ship_preflight` MCP tool; hook entry removed from hooks.json

## [0.17.2] — 2026-04-01

### Fixed
- **ship/cleanup** — added explicit remote branch verification + fallback deletion; prevents stale branches when `--delete-branch` silently fails
- **ship/release-flow** — clarified `--delete-branch` is a request, not a guarantee; cleanup step 3 is the safety net
- **repo setting** — enabled `deleteBranchOnMerge` as additional safety net for all future merges
- **housekeeping** — deleted 3 stale remote branches from prior squash-merged PRs (#58, #59, #60)

## [0.17.1] — 2026-04-01

### Added
- **plugin.json** — `optionalPlugins` metadata field referencing `codex-plugin-cc` for AI-powered code review and task delegation via OpenAI Codex (informational, not enforced by Claude Code)
- **deep-knowledge/codex-integration.md** — cross-cutting reference for all Codex integration points (detection, token costs, troubleshooting)
- **INSTALL.md** — "Optional: Codex Integration" section with Desktop-first setup guide, skill reference table, combined workflow examples, and troubleshooting
- **README.md** — "Integrations" section linking to Codex setup
- **ship/SKILL.md** — optional Codex review gate after build+tests (Step 2): `/codex:review` for patch/minor, `/codex:adversarial-review` for major bumps
- **flow/SKILL.md** — `/codex:rescue` as option when root cause is unclear (Step 6 decision matrix)
- **post.flow.debug** v0.4.0 — mentions `/codex:rescue` as alternative to `/flow` after repeated failures
- **agents/qa** — suggests `/codex:adversarial-review` for complex changes; `codex_review` field in QA_RESULT
- **agents/research** — delegates sub-questions to `/codex:rescue` for parallel investigation

### Changed
- **MCP server** renamed `dotclaude-usage` → `dotclaude-completion` v0.3.0; now exposes two tools
- **New tool** `render_completion_card` — single MCP call replaces the previous 4-step flow (get_usage → variant → JSON → Bash pipe); internally fetches usage, computes build-ID, renders card, writes flag
- **post.flow.completion** v0.13.0 — hook output reduced from ~25 lines to ~10 lines; instructs Claude to call `render_completion_card` instead of multi-step Bash pipe
- **stop.flow.guard** — carry-over message updated to reference `render_completion_card`
- **plugin.json** — MCP server key renamed to `dotclaude-completion`; bumped to v0.17.0

### Why
Completion cards were frequently ignored because the hook injected ~70 lines of text instructions requiring 4-5 manual steps. A native MCP tool call is Claude's natural interface — one structured call instead of parsing text and piping JSON through Bash.

## [0.16.0] — 2026-04-01

### Added
- **agents/designer** — full-stack UX/UI designer agent: Figma + Code bridge, design tokens, component specs, wireframes-to-pixel-perfect pipeline
- **Wave 0 (Analysis)** — PO + Gamer agents now run before implementation to set requirements and UX expectations
- **Wave 5 (Review)** — PO + Gamer agents validate the built result against Wave 0 expectations

### Changed
- **agents/po** — rewritten from requirements engineer to product CEO: holistic ownership (business, user, tech, operations), critical challenge duty, strategic analysis, accountability review
- **agents/gamer** — dual role with structured output for expectations (Wave 0) and validation (Wave 5)
- **agents/feature** — 6-wave orchestration (Wave 0–5) with explicit parallelism and dependency documentation
- **agents/frontend** — collaboration updated to receive from designer agent

## [0.15.1] — 2026-03-31

### Fixed
- **pre.ship.guard** — remove dead `checkHookRegistry()` code that never matched (plugin.json#hooks is a path string, not an array; hooks.json entries have no `name` fields)
- **pre.tokens.guard** — fix UX message: "retry the same operation" instead of misleading "reply: yes, proceed"
- **refresh-usage-headless** — add platform guard: exit early with code 5 on non-Windows systems instead of crashing on missing Edge/tasklist
- **README** — correct `/debug` skill entry to `/flow (alias: /debug)` matching the actual skill name

## [0.15.0] — 2026-03-31

### Changed
- **mcp-server** — remove cache layer: every `get_usage` call now triggers a fresh CDP scrape (no 5-min cache skip)
- **mcp-server** — remove `forceRefresh` parameter, `source`, and `cacheAgeMinutes` from response
- **mcp-server** — delta computed against previous `usage-live.json` (cross-session); `null` when no previous data exists

## [0.14.1] — 2026-03-31

### Fixed
- **ship/cleanup** — call `ExitWorktree` before git worktree removal to release Windows CWD lock; prevents `git worktree remove` failure when session is still inside the worktree
- **ship/SKILL.md** — added `ExitWorktree` to `allowed-tools`; rewrote Step 5 to exit worktree first

## [0.14.0] — 2026-03-31

### Added
- **MCP server** `dotclaude-usage` v0.1.0 — first MCP server in the plugin; exposes `get_usage` tool via stdio transport; CDP scrape with full fallback chain (auto-start, activate-cdp, cache); returns structured usage data + pre-rendered ASCII meter as a first-class tool result
- **scripts/lib/usage-meter.js** v0.1.0 — shared module for usage meter rendering (renderUsageMeter, readUsageData, renderBar, formatDelta, formatResetShort)

### Changed
- **render-card.js** — refactored to use shared `scripts/lib/usage-meter.js` instead of inline functions (-89 lines)
- **post.flow.completion** — completion flow now instructs Claude to call `get_usage` MCP tool instead of `/refresh-usage` skill; tool result is a first-class context entry that Claude cannot skip
- **plugin.json** — added `mcpServers.dotclaude-usage` registration; bumped to v0.14.0

## [0.13.1] — 2026-03-28

### Changed
- **ss.flow.selfcalibration** v0.4.0 — replaced file-based `ONBOARD_FLAG` with CronList-based logic: task not in CronList → register + execute immediately; task already in CronList → skip entirely (no duplicate registration, no extra run)

## [0.13.0] — 2026-03-28

### Added
- **stop.flow.guard** v0.1.0 — new Stop hook; per-turn completion card enforcement; writes carry-over reminder to next turn if work happened but no card was rendered; resets per-turn flags (work-happened, card-rendered) at each turn boundary
- **ss.flow.selfcalibration**: first-install onboarding detection via persistent `~/.claude/dotclaude-devops-onboarded` flag; triggers immediate self-calibration on first session after install instead of waiting 30 minutes

### Changed
- **Completion flow** is now a generic response-complete pattern — fires for any completed task regardless of tool used, file location, or type of work (code, config, research, app start); no "discretionary skip" valid
- **post.flow.completion** v0.12.0 — writes per-turn `work-happened` flag; injects `session_id` into render-card Bash instruction
- **render-card.js** v0.2.0 — writes `card-rendered` session flag after successful render for Stop hook detection
- **self-calibration/SKILL.md** v0.2.0 — Step 1 rewritten with explicit completion flow rules; discretionary skip documented as violation
- **plugin-behavior.md** — Completion Flow section updated to reflect generic pattern and hook architecture

### Fixed
- **render-card**: Omit usage delta parenthetical `(+N%)` when no previous usage snapshot exists or it is older than 8 hours — prevents misleading `(+0%)` display on first run

## [0.12.8] — 2026-03-28

### Fixed
- **plugin.json**: Hooks path corrected from `../hooks/hooks.json` to `./hooks/hooks.json` — paths must be relative to plugin root per spec, not relative to `.claude-plugin/`; wrong path broke Marketplace hook display and caused commit-hash cache keys instead of version-based ones

## [0.12.7] — 2026-03-28

### Fixed
- **plugin.json**: Explicit `"hooks": "../hooks/hooks.json"` reference — Claude Code does not reliably auto-discover non-SessionStart hooks from plugin `hooks/hooks.json`; explicit reference ensures PostToolUse, PreToolUse, and UserPromptSubmit hooks are registered

## [0.12.6] — 2026-03-28

### Changed
- **ss.tasks.register** renamed to **ss.flow.selfcalibration** — once-per-session guard via new `run-once` lib; no redundant CronCreate output on repeated SessionStart triggers
- **ss.tokens.scan**: 10-minute cooldown guard — skips file-system scan if `token-config.json` was updated less than 10 min ago

### Added
- **hooks/lib/run-once.js** v0.1.0 — shared session-scoped execution guard with optional cooldown for SessionStart hooks

## [0.12.5] — 2026-03-28

### Changed
- **render-card.js**: Opening `---` separator moved from above usage meter to below it — usage code block is visually self-contained; `---` now separates usage from title
- **completion-card.md**: Template updated to reflect new separator position

## [0.12.4] — 2026-03-28

### Fixed
- **ship SKILL.md**: Step 2 blocked variant reference updated; Step 3 version gate split into plugin vs npm with correct 3-match minimum
- **versioning.md**: Plugin vs npm project type detection added; `marketplace.json` and `.plugin-version` removed from mandatory checklist (marketplace.json has no version field)
- **pre-flight.md**: Version consistency check now reads from `plugin.json` for plugin projects; post-ship 6c check uses correct source of truth per project type

## [0.12.3] — 2026-03-28

### Fixed
- **post.flow.completion** v0.11.0: restore all JSON schema details in hook instruction — max-3, omit-if-none, omit-for-minimal-start, only-for-test comments were lost in v0.12.2

## [0.12.2] — 2026-03-28

### Changed
- **post.flow.completion** v0.10.0: hook instruction compressed from 36 to 20 lines — variant rules preserved, JSON schema and steps condensed

## [0.12.1] — 2026-03-28

### Fixed
- **post.flow.completion** v0.9.0: `/refresh-usage` now mandatory Step 1 in completion flow — battery data was potentially stale without it
- **ship skill Step 6**: removed redundant manual instructions — completion flow is fully handled by the hook

## [0.12.0] — 2026-03-28

### Added
- **render-card.js**: Deterministic completion card renderer — Node script replaces LLM-based card rendering, eliminates template drift
- All 8 variants (shipped, ready, blocked, test, minimal-start, research, aborted, fallback) rendered by script with exact column alignment

### Changed
- **post.flow.completion** v0.8.0: Hook no longer injects 190-line template — instead instructs Claude to pipe JSON to `render-card.js` and output result verbatim
- Template `completion-card.md` remains as documentation/source of truth but is no longer injected into context at runtime

## [0.11.2] — 2026-03-28

### Fixed
- **README**: Hook count corrected (13 → 11), skill count and list updated (9 → 10, debug → flow, added extend-skill), agent template label corrected
- **INSTALL.md**: Removed stale `Edit|Write` matcher from PostToolUse completion hook (now fires on all tools), hook count corrected (12 → 11)
- **CONVENTIONS.md**: Removed deleted `stop/stop.ship.guard.js` from directory structure, updated template file listing to match actual files

## [0.11.1] — 2026-03-28

### Removed
- **Stop hook**: Removed `stop.ship.guard` — redundant with Ship Pre-Flight (Step 1) and caused noisy warnings after every Claude response

## [0.11.0] — 2026-03-28

### Added
- **Completion card v0.7.0**: Complete redesign — 8 variants (was 7) with fallback, 3-block layout (What/State/CTA)
- **Title**: Sparkle emoji framing (`✨✨✨`), summary-first, build-ID always included
- **Usage meter**: ASCII bars with elapsed-time arrow (`↑`), pace comparison vs. elapsed time, delta markers (`!`/`!!`)
- **State one-liner**: All git fields always present (branch, commit, push, PR, merge, remote/main)
- **CTAs**: 8 variants with emoji + UPPERCASE status + info + action verb, EN master with on-the-fly translation
- **New variants**: `research` (no repo changes) and `fallback` (catch-all)
- **README**: Shipped + test examples prominent, all 8 variants in collapsible details

### Fixed
- **Hook coverage**: PostToolUse completion hook now fires on ALL tools, not just Edit/Write — fixes 5 coverage gaps (research, docs/config, bash-only, Read-only, template missing)
- **Extension filter removed**: `.md`/`.json`/`.yml` edits now trigger completion flow

### Changed
- **Variants consolidated**: shipped-pr + shipped-direct → `shipped`, test-running + test-manual → `test` (difference shown in state line)
- **Block order**: Usage meter moved directly under title for immediate visibility

## [0.10.0] — 2026-03-28

### Changed
- **Hook rename**: `prompt.start.detect` → `prompt.flow.appstart` — consistent `flow` domain naming
- **Hook recategorize**: `post.flow.debug` moved from "debug" to "flow" category in README (was already in `flow` domain)
- Updated all references in hooks.json, INSTALL.md, README.md, CHANGELOG.md

## [0.9.0] — 2026-03-28

### Added
- **Ship skill**: Session Activity Guard (Pre-Step) — checks for running background agents, bash commands, and incomplete tasks before shipping; offers wait/proceed/cancel options

## [0.8.2] — 2026-03-28

### Changed
- **Skill rename**: `debug` → `flow` — clearer intent as a diagnostic flow skill
- **Hook rename**: `post.debug.trigger` → `post.flow.debug` — aligns with flow skill naming convention
- Updated all references in hooks.json, INSTALL.md, README.md, token-config.json

## [0.8.1] — 2026-03-28

### Changed
- **All skills**: Step 0 extension loading now uses "Silently check" wording to prevent Claude from surfacing "not found" tool calls in output
- **CONVENTIONS.md**: Updated Step 0 template so new skills inherit the silent-check pattern

## [0.8.0] — 2026-03-28

### Added
- **extend-skill** skill: interactive scaffolding for project-level skill extensions — lists available skills, detects existing extensions, creates or adapts SKILL.md + reference.md

### Changed
- **README** customization section: generic extension pattern with `/ship` as example instead of ship-only documentation
- **project-setup** Step 6: delegates to `/extend-skill` instead of hardcoded ship scaffold
- **skill-extension-guide**: scaffolding section references `/extend-skill`

## [0.7.0] — 2026-03-28

### Added
- **post.flow.completion** v0.6.0: issue status check in completion flow — reads tracked issues, evaluates acceptance criteria, sets "Done" or resets to "Todo" with status comment
- **prompt.issue.detect** v0.2.0: migrated from `process.ppid` to `sessionFile()` for cross-hook session state sharing

## [0.6.2] — 2026-03-28

### Changed
- **ss.branches.check** renamed to **ss.git.check** — consistent naming (`ss.<domain>.<action>`)
- **pre.ship.guard**: removed manual PR blocking and ship-flow flag mechanism (simplified to push guard only)
- **prompt.ship.detect**: removed flag file writes, soft guidance only

### Fixed
- Hook references updated across hooks.json, README.md, INSTALL.md

## [0.6.1] — 2026-03-28

### Removed
- **ss.plugin.update**: removed custom self-update hook — plugin updates are now handled natively by the Claude Code marketplace

### Fixed
- **ss.branches.check**: filter active worktree branches from unpushed-commits check (eliminates false positives)

### Changed
- **ss.branches.check**: structured output with specific call-to-action per issue type (`/ship` for uncommitted/unpushed, `git stash` commands for stashes)
- **INSTALL.md / README.md**: updated documentation to reference marketplace-based updates instead of custom hook

## [0.6.0] — 2026-03-28

### Changed
- **Plugin format**: migrated to official plugin-dev format (auto-discovery for skills, agents, hooks)
- **plugin.json**: removed explicit `skills[]`, `hooks[]`, `tags[]` arrays; `author` as object; `keywords` replaces `tags`
- **marketplace.json**: simplified to minimal format (name, owner, plugins)
- **Agents**: moved from subdirectories (`agents/<name>/AGENT.md`) to flat files (`agents/<name>.md`)
- **Agent frontmatter**: added `model`, `color`, `tools` (array), `<example>` tags; removed `subagent_type`, `version`

### Fixed
- **plugin-guard**: supports both old (`@Jerry0022`) and new (`@dotclaude-dev-ops`) plugin keys
- **refresh-usage**: aggressive 6-step fallback chain — CDP → auto-start Edge → activate CDP → Playwright → cache → [no data]
- **Star-Citizen-Companion**: removed stale hook registrations from `settings.json` and `settings.local.json`

## [0.5.0] — 2026-03-28

### Changed
- **Installation model**: global-only — plugin installs to `~/.claude/settings.json`, no per-project registration needed
- **INSTALL.md**: rewritten for global-only installation, removed project-scope option
- **hooks.json**: fixed marketplace directory name (`jerry0022-dotclaude-dev-ops` → `dotclaude-dev-ops`)

### Removed
- Project-level `.claude/hooks/` directory (hooks now run exclusively from marketplace cache)
- Project-level `settings.json` hook overrides (hooks come from plugin's `hooks.json`)
- Per-project `extraKnownMarketplaces` and `enabledPlugins` entries

### Note
Project-specific skill extensions (`.claude/skills/{name}/reference.md`) remain fully supported.

## [0.4.0] — 2026-03-28

### Changed
- **Hook architecture**: hooks.json now uses absolute paths to marketplace plugin directory — eliminates bootstrap/sync step entirely
- **Project isolation**: new `plugin-guard.js` module ensures hooks only fire for projects where `enabledPlugins` is set
- **ss.plugin.update**: simplified to target marketplace directory directly, removed `getInstallTarget()` and `healHookPaths()` functions
- **INSTALL.md**: removed Step 3c (hook registration in settings.json) and Step 4 (bootstrap sync) — installation now only requires marketplace + enabledPlugins

### Fixed
- `stop.flow.completion` removed from plugin.json hook list (script was deleted in v0.3.3 but reference remained)
- `ss.branches.check` added to README hook table (was missing since v0.3.4)

## [0.3.4] — 2026-03-27

### Added
- Branch Inheritance Protocol: isolated agents now rebase onto the caller's branch instead of main
- All isolated agent definitions (feature, core, frontend, ai, windows) include mandatory Branch Setup as first step
- Feature agent enforces `Parent branch:` in every sub-agent delegation prompt
- Agent collaboration docs updated with full protocol, branch naming, and merge order

## [0.3.3] — 2026-03-27

### Fixed
- `post.flow.completion` v0.5.0: moved completion enforcement from Stop to PostToolUse hook — counts edits and emits card reminder at the right time
- Removed `stop.flow.completion.js` (redundant, fired too late)
- Cleaned up `hooks.json` and `.claude/settings.json`
- Version files now consistent (README, CHANGELOG, .plugin-version were out of sync)

### Improved
- Ship skill: added mandatory version verification gate — hard stop if any version file is out of sync after bump

## [0.3.2] — 2026-03-27

### Fixed
- `INSTALL.md`: install flow now uses `AskUserQuestion` tool instead of inline markdown options — eliminates question text duplication and shows native UI buttons

## [0.3.1] — 2026-03-27

### Fixed
- `refresh-usage`: `usage-live.json` was written to `{cwd}/.claude/` — broken in worktrees where that path doesn't exist. Now always writes to `~/.claude/` (account-scoped data, not project-specific)

## [0.3.0] — 2026-03-27

### Changed
- `ss.plugin.update`: detect install type (project vs global) automatically; sync to `{cwd}/.claude/` for project installs, `~/.claude/` for global
- `ss.plugin.update`: `healHookPaths` now converts paths in both directions based on install type
- `ss.plugin.update`: updates `installed_plugins.json` metadata after each successful update
- `INSTALL.md`: documents both global and project-level hook path variants; bootstrap step uses dynamic sync target
- `.gitignore`: plugin-managed runtime dirs (`.claude/hooks/`, `.claude/skills/`, etc.) excluded from version control

## [0.2.5] — 2026-03-27

### Changed
- Version bump (patch)

## [0.2.4] — 2026-03-27

### Fixed
- `self-calibration`: audit now checks full completion flow execution (verify → issue status → card → ship recommendation), not just whether a card was directly rendered

## [0.2.3] — 2026-03-27

### Changed
- `stale-changes-check`: converted from daily cron to `SessionStart` hook (`ss.branches.check.js`) — runs at every session start, silent when clean, brief inline warning only when issues are found

## [0.2.2] — 2026-03-27

### Fixed
- `refresh-usage`: autonomous CDP activation on exit 5 — Edge restart happens automatically instead of silent [no data] fallback; clear German instruction shown if restart fails

## [0.2.1] — 2026-03-27

### Fixed
- Self-heal relative hook paths on session start — prevents MODULE_NOT_FOUND errors in consumer projects with old installations

## [0.2.0] — 2026-03-27

### Added
- `prompt.ship.detect` hook: detect ship intent in user prompts, enforce Skill("ship")
- `prompt.flow.appstart` hook: detect app start intent, enforce completion card
- Ship enforcement via three layers: prompt detection, PR command blocking, completion flow

### Changed
- `pre.ship.guard` v0.3.0: now blocks manual PR commands, redirects to /ship
- `stop.flow.completion` v0.4.0: injects full completion template with all 7 variants
- README updated: 13 hooks, features section reflects ship enforcement and completion flow

## [0.1.3] — 2026-03-27

### Added
- `pre.ship.guard` now blocks push when hooks in `hooks.json` are missing from `plugin.json`

## [0.1.2] — 2026-03-27

### Fixed
- PostToolUse and Stop hooks now share state correctly via Claude Code's `session_id`
- `stop.flow.completion` now reads stdin (was missing, breaking session_id access)
- Added `stop.flow.completion` to hooks registry in `plugin.json` and `hooks.json`

## [0.1.1] — 2026-03-27

### Fixed
- Version references now stay consistent across all plugin files

### Added
- Ship guard hook now enforces version consistency before push

## [0.1.0] — 2026-03-27

### Added
- Initial release: hooks, skills, agents, templates, and deep-knowledge
- Pre-tool-use guards for token budget and ship safety
- Skills: ship, commit, debug, deep-research, explain, new-issue, project-setup, readme, refresh-usage
- Scheduled tasks: stale-changes-check, self-calibration
- Three-layer extension model for all skills and agents
