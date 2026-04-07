# Changelog

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

- **skills** — new `/autonomous-mode` skill: fully autonomous agent orchestration while user is AFK — task intake, permission priming, desktop/background test mode, safety guardrails (no push/ship), structured report with completion card, optional PC shutdown

## [0.28.1] — 2026-04-06

### Improved
- **livebrief** — decision panel is now a fixed 20% sidebar (not overlay), always visible while scrolling
- **livebrief** — tri-state variant evaluation: Verwerfen / Miteinbeziehen (default) / Exakt diese Variante — with exclusive-select logic
- **livebrief** — iterative live feedback loop: Claude processes submissions, updates the page in-browser, user can act again (replaces one-shot model)
- **livebrief** — wider text fields (`width: 100%`, `min-height: 80px`) for better usability

## [0.28.0] — 2026-04-05

### BREAKING

- **skills** — all 13 skills renamed with `devops-` prefix for namespace clarity: `/ship` → `/devops-ship`, `/commit` → `/devops-commit`, `/flow` → `/devops-flow`, `/deep-research` → `/devops-deep-research`, `/explain` → `/devops-explain`, `/new-issue` → `/devops-new-issue`, `/project-setup` → `/devops-project-setup`, `/readme` → `/devops-readme`, `/refresh-usage` → `/devops-refresh-usage`, `/extend-skill` → `/devops-extend-skill`, `/repo-health` → `/devops-repo-health`, `/claude-md-lint` → `/devops-claude-md-lint`, `/livebrief` → `/devops-livebrief`
- **extensions** — user extension directories must be renamed to match (e.g. `.claude/skills/ship/` → `.claude/skills/devops-ship/`)
- **hooks** — `prompt.ship.detect` now emits `Skill("devops-ship")` and `Skill("devops-commit")`

### Added

- **skills** — new `/devops-orchestrate` skill: explicitly evaluate which agents are useful for a task and orchestrate their parallel or sequential execution with wave-based planning

## [0.27.0] — 2026-04-05

### Added
- **skills** — new `/livebrief` skill: generates interactive self-contained HTML pages for analysis, plans, concepts, comparisons, prototypes, dashboards, and creative work; opens in Edge as new tab; monitors user decisions (toggles, selections, comments) via browser tools and feeds them back into Claude's workflow
- **livebrief** — 7 recommended variant templates (analysis, plan, concept, comparison, prototype, dashboard, creative) with design system, decision JSON schema, and submit-button feedback mechanism
- **livebrief** — browser monitoring spec with 4-level fallback: Claude in Chrome/Edge → Playwright → Preview → manual
- **livebrief** — extension reference for project-level customization (design overrides, default variant, output location, custom elements, browser preference)

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
