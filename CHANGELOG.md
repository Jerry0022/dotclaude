# Changelog

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
- `prompt.start.detect` hook: detect app start intent, enforce completion card
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
