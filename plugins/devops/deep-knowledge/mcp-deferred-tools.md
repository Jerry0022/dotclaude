# MCP Deferred Tools

Cross-cutting rule: in sessions with a large tool inventory (Computer Use, Chrome MCP, many third-party MCPs), Claude Code **defers** most MCP tool schemas. The tools appear in the SessionStart `<system-reminder>` deferred-tools list, but their JSONSchema is NOT loaded — calling them directly fails with `InputValidationError`.

Relevant for devops: all `dotclaude-ship` and `dotclaude-issues` tools land deferred. Only `dotclaude-completion` tools are usually auto-loaded because the completion card hook fires on every Stop.

## The trap

A past session reached this failure mode:

1. Claude saw `gh pr create` blocked by `pre.ship.guard.js`.
2. Claude searched via ToolSearch with wrong queries, got no results, concluded "ship MCP server is missing".
3. Claude reported the plugin as broken — but the server was running correctly; the tool schemas were simply deferred.
4. Deadlock: guard blocks the manual fallback, Claude thinks the proper path is unavailable.

The server was not broken. The tools were one `ToolSearch` call away.

## How to detect deferred tools

The SessionStart `<system-reminder>` lists deferred tool names verbatim. Example for this plugin:

```
mcp__plugin_devops_dotclaude-ship__ship_preflight
mcp__plugin_devops_dotclaude-ship__ship_build
mcp__plugin_devops_dotclaude-ship__ship_version_bump
mcp__plugin_devops_dotclaude-ship__ship_release
mcp__plugin_devops_dotclaude-ship__ship_cleanup
mcp__plugin_devops_dotclaude-issues__match_issues
```

Presence in that list = registered + available. Absence = the MCP server genuinely failed to start (check `/mcp` status or server stderr).

## How to load a schema

Use `ToolSearch` with the `select:` prefix. Load ALL tools needed for the current pipeline in ONE call — not one per round-trip:

```
ToolSearch({
  query: "select:mcp__plugin_devops_dotclaude-ship__ship_preflight,mcp__plugin_devops_dotclaude-ship__ship_build,mcp__plugin_devops_dotclaude-ship__ship_version_bump,mcp__plugin_devops_dotclaude-ship__ship_release,mcp__plugin_devops_dotclaude-ship__ship_cleanup",
  max_results: 5
})
```

The result contains a `<functions>` block with one `<function>{...}</function>` line per loaded tool. After that block appears, the tools are callable exactly like any other tool.

## When to do this

- `/devops-ship` skill: mandatory, see `SKILL.md` Step 0.5.
- Any skill that calls MCP tools from a non-completion server: load schemas upfront in the Step 0 / setup phase.
- Guard-hook recovery: if `pre.ship.guard.js` fires and you cannot see ship tools, ToolSearch first — do NOT retry the blocked Bash command.

## Anti-patterns

- **Do NOT** conclude "server missing" from a deferred list entry. Deferred = lazy-loaded schema, not absent.
- **Do NOT** fall back to manual `gh pr create` / `gh pr merge` when ship tools appear unavailable — the guard hook blocks it intentionally.
- **Do NOT** load tools one at a time. One ToolSearch call can load the whole pipeline in a single round-trip.
- **Do NOT** re-load a tool whose schema is already visible in the conversation. Once loaded, it persists for the session.

## Related

- `pre.ship.guard.js` — block message explicitly points here.
- `skills/devops-ship/SKILL.md` Step 0.5 — enforces this pattern for the ship pipeline.
- `plugin-behavior.md` — general MCP-server expectations.
