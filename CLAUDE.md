# dotclaude — DevOps Plugin for Claude Code

Directory structure: `.claude/project-map.md` — not auto-loaded; the token guard regenerates and injects it before the first repo-wide Grep/Glob of a session.

## Build & Test
- `npm test` — run vitest suite
- `npm run lint` — eslint check
- `npm run lint:fix` — eslint autofix
- `cd plugins/devops && claude plugin eval . --runs 1 --ablation none --trust-plugin --no-publish --scaffold --allow-tools Write,Edit,WebSearch,WebFetch` — behavioral evals (real model runs, costs usage); see `plugins/devops/evals/README.md`

## Architecture
- Monorepo: `plugins/devops/` (core) + `plugins/local-llm/` (token saver)
- Skills, hooks, agents, MCP server, templates, deep-knowledge, scheduled-tasks
- Versioning: SemVer in `.claude-plugin/plugin.json`, tags `v0.x.y`
- Conventions: `plugins/devops/CONVENTIONS.md` (hook naming, skill structure, etc.)

## Context: This is the plugin SOURCE repo
- Changes here affect the plugin itself — not a consumer project
- Test changes by asking Claude "devops update" in a consumer project (auto-update is hidden from the slash menu; that phrase is the trigger the router still routes)
- The `.claude/plugins/cache/` on a consumer machine is the installed copy

## Release
- Use `/do-ship` for the full release pipeline
- CHANGELOG.md is auto-maintained per release
