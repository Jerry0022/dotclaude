# Ship — Ship server down or not connected (Step 0.5)

Referenced by `/do-ship` Step 0.5. The schema load, the "do NOT improvise"
rule and the switch to the manual checklist stay in SKILL.md.

## Server failed to connect

When the session reminder shows the server as **failed to connect** (`Connection closed`), run the cache diagnosis in `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md → When the server is genuinely down` first: a cache that lost its `*.js` files is the usual cause and is repairable in-session.

## Offline ship CLI

**Server installed but not connected → the offline ship CLI.** When the reminder says `Skipping connection (recent failure cached …)` or `CONNECT_TIMEOUT` for `dotclaude-ship` and `{PLUGIN_ROOT}/mcp-server/ship/cli.js` exists, run the same pipeline through it — Steps 1–5 unchanged, every `ship_*` call becomes `node "{PLUGIN_ROOT}/mcp-server/ship/cli.js" <tool> <params.json>` (params = the exact tool arguments as a JSON file, result JSON on stdout; exit 2 = invalid params, 1 = the handler threw). Same handlers, same gates, same checkpoint — this is the pipeline, not a manual ship, and needs no restart. Announce it in one line. Details: `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md` § When the connect is skipped.
