# local-llm Plugin Conventions

## Purpose
Token-saving plugin that delegates mechanical coding tasks to a local Gemma 4 E4B model.
Claude does the reasoning; the local LLM does the typing.

## Dependency
Requires the **devops** plugin to be installed and enabled (shared heartbeat, MCP health check patterns).

## Config Resolution
Project `.claude/local-llm/config.json` > Global `~/.claude/local-llm/config.json` > Plugin defaults `scripts/config.json`.

## Naming
- Hook files: `{prefix}.llm.{action}.js` (e.g., `ss.llm.health.js`)
- MCP server name: `dotclaude-local-llm`
- MCP tool prefix: `local_` (e.g., `local_generate`, `local_status`)
- Deep-knowledge files: kebab-case, topic-focused

## Backend Lifecycle
- llama-server is started lazily on first `local_generate` call
- Auto-shutdown after configurable idle timeout (default 10 min)
- PID tracked via heartbeat pattern (same as devops MCP servers)

## Delegation Philosophy
Claude ALWAYS reviews local LLM output before using it. The local LLM is a code generation accelerator, not an autonomous agent. See `deep-knowledge/delegation-rules.md` for the full decision matrix.
