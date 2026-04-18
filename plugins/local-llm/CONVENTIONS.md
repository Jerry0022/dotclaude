# local-llm Plugin Conventions

## Purpose
Token-saving plugin that delegates mechanical coding tasks to a local AnythingLLM Desktop workspace.
Claude does the reasoning; the local LLM does the typing.

## Dependency
Requires the **devops** plugin to be installed and enabled (shared heartbeat, MCP health check patterns).
Requires **AnythingLLM Desktop** to be installed and configured by the user — the plugin does not
bundle or manage any model itself.

## Config Resolution
Plugin defaults `scripts/config.json` → Project `.claude/local-llm/config.json` → User `~/.claude/local-llm/config.json`
(later layers override earlier layers).

**API key is ONLY read from the user layer** to prevent accidental commits. Project-level keys are ignored.

## Naming
- Hook files: `{prefix}.llm.{action}.js` (e.g., `ss.llm.health.js`)
- Shared library: `hooks/lib/anythingllm-*.js` (CJS, consumed by both hooks and the MCP server via `createRequire`)
- MCP server name: `dotclaude-local-llm`
- MCP tool prefix: `local_` (e.g., `local_generate`, `local_status`)
- Deep-knowledge files: kebab-case, topic-focused

## Backend Lifecycle
- The plugin does NOT spawn or kill any process. AnythingLLM Desktop is owned by the user.
- SessionStart hook may launch AnythingLLM detached if installed but not running (`autoLaunch: true`).
- The hook NEVER blocks the prompt: workspace creation, first-time launches, and model loading
  all run async. The session continues and picks up the new state on the next SessionStart.

## Phase States
The SessionStart hook and `local_status` tool report one of:
`ready | needs_api_key | not_installed | not_running | starting | network_blocked | auth_failed | configuring`.
See `deep-knowledge/model-config.md` for the meaning of each.

## Security
- API key lives at `~/.claude/local-llm/config.json` (user-global, outside any repo).
- Consumer projects that keep a project-level config MUST add `.claude/local-llm/config.json`
  to their `.gitignore`. The plugin itself never writes a project-level config.

## Delegation Philosophy
Claude ALWAYS reviews local LLM output before using it. The local LLM is a code generation accelerator, not an autonomous agent. See `deep-knowledge/delegation-rules.md` for the full decision matrix.
