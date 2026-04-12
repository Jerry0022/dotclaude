# dotclaude — DevOps Plugin for Claude Code

See @.claude/project-map.md for directory structure.

## Build & Test
- `npm test` — run vitest suite
- `npm run lint` — eslint check
- `npm run lint:fix` — eslint autofix

## Architecture
- Monorepo: single plugin under `plugins/devops/`
- Skills, hooks, agents, MCP server, templates, deep-knowledge, scheduled-tasks
- Versioning: SemVer in `.claude-plugin/plugin.json`, tags `v0.x.y`
- Conventions: `plugins/devops/CONVENTIONS.md` (hook naming, skill structure, etc.)

## Context: This is the plugin SOURCE repo
- Changes here affect the plugin itself — not a consumer project
- Test changes by running `/devops-self-update` from a consumer project
- The `.claude/plugins/cache/` on a consumer machine is the installed copy

## Release
- Use `/devops-ship` for the full release pipeline
- CHANGELOG.md is auto-maintained per release
