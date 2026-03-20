# Changelog

All notable changes to this project will be documented in this file.

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
