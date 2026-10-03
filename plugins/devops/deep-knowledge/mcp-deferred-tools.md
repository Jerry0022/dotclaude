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
mcp__plugin_devops_dotclaude-ship__ship_hygiene
mcp__plugin_devops_dotclaude-issues__match_issues
```

Presence in that list = registered + available. Absence = the MCP server genuinely failed to start (check `/mcp` status or server stderr).

## How to load a schema

Use `ToolSearch` with the `select:` prefix. Load ALL tools needed for the current pipeline in ONE call — not one per round-trip:

```
ToolSearch({
  query: "select:mcp__plugin_devops_dotclaude-ship__ship_preflight,mcp__plugin_devops_dotclaude-ship__ship_build,mcp__plugin_devops_dotclaude-ship__ship_version_bump,mcp__plugin_devops_dotclaude-ship__ship_release,mcp__plugin_devops_dotclaude-ship__ship_cleanup,mcp__plugin_devops_dotclaude-ship__ship_hygiene",
  max_results: 6
})
```

The result contains a `<functions>` block with one `<function>{...}</function>` line per loaded tool. After that block appears, the tools are callable exactly like any other tool.

## When to do this

- `/do-ship` skill: mandatory, see `SKILL.md` Step 0.5.
- Any skill that calls MCP tools from a non-completion server: load schemas upfront in the Step 0 / setup phase.
- Guard-hook recovery: if `pre.ship.guard.js` fires and you cannot see ship tools, ToolSearch first — do NOT retry the blocked Bash command.

## When the server is genuinely down: `Connection closed`

The deferred-list rule above has one real exception. When the SessionStart
reminder says a devops server **failed to connect** — `CONNECTION_CLOSED` or
`"Connection closed"` — the schema is not lazy, the process died at boot.
ToolSearch returns nothing and a `reconnect_session_connector` only re-runs
the same dead command. (`Skipping connection (recent failure cached …)` is a
different case — next section.)

**Diagnose before reporting** — the cause is almost always the installed cache,
not the plugin code. Run the server's own command from the cache root and read
its first stderr lines:

```bash
cd ~/.claude/plugins/cache/dotclaude/devops/<version> && \
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  | node mcp-server/ship/index.js
```

`Cannot find module …/mcp-server/ship/index.js` means the cache lost its
source files (2026-09-17: every `*.js` outside `node_modules` vanished from
the cache dirs; `.md`/`.json` survived). The self-heal in `ss.plugin.update` →
`cacheBroken()` cannot fire in that state — the healer is one of the missing
`.js` files — so nothing repairs it across sessions. Heal it by hand:

1. Marketplace clone first — it can be damaged the same way:
   `cd ~/.claude/plugins/marketplaces/dotclaude && git status --short`;
   any `M`/`D` under `plugins/devops/**/*.js` → `git checkout -- .`.
2. Rebuild the cache from the restored clone — never copy files in by hand,
   the rebuild also re-links `node_modules` and re-asserts `MCP_CRITICAL_FILES`:
   ```bash
   cd ~/.claude/plugins/marketplaces/dotclaude/plugins/devops && node -e '
   const {rebuildCache}=require("./hooks/lib/cache-rebuild.js"),os=require("os"),p=require("path");
   console.log(JSON.stringify(rebuildCache({marketplace:"dotclaude",pluginName:"devops",pluginDir:process.cwd(),
     version:"<version>",sha:"<short sha>",channel:"alpha",
     cacheDir:p.join(os.homedir(),".claude","plugins","cache"),
     registryFile:p.join(os.homedir(),".claude","plugins","installed_plugins.json")})))'
   ```
3. Re-run the initialize probe above until it answers `Server started on stdio`,
   then reconnect the servers (`reconnect_session_connector`, or restart the
   session). Only after this does `/do-ship` Step 0.5 have anything to find.

Do NOT hand-edit files into `~/.claude/plugins/cache/**` and do NOT fall back to
`gh pr create` — the guard still blocks it, and the repaired server is minutes
away.

## When the connect is skipped: `recent failure cached`

`Skipping connection (recent failure cached retries automatically in 15 min …)`
means this session **never tried**. Claude Code keeps one failure cache for
the whole machine, `~/.claude/mcp-needs-auth-cache.json`, keyed by server name
(`"plugin:devops:dotclaude-ship": { timestamp, id }`), with a 15-min window.
One session's `CONNECT_TIMEOUT` therefore skips the server in **every** session
that starts inside the window, and each new failure elsewhere renews it.
Observed 2026-10-01: many sessions started at once after an app restart, the
ship server (normally ~0.6 s to boot) hit the 30 s timeout in two other
sessions, and this session came up without ship/completion/issues.

Signs: the own project's `mcp-logs-plugin-devops-dotclaude-*` folder under
`%LOCALAPPDATA%/claude-cli-nodejs/Cache/<project>/` has **no log for this
session's start** — the failing session is another one. Search all projects'
folders for `CONNECT_TIMEOUT` to find it. The cache dir and the
initialize probe above are healthy then — do not rebuild anything.

There is **no in-session reconnect**: the CLI connects only at session start,
touching the plugin's `.mcp.json` does not trigger a retry, and the "retries
automatically in 15 min" in the message does not happen inside a running
session (observed 2026-10-03: still skipped 2.5 h later). The **tools** stay
usable without the connection — both servers have an offline entry point that
runs the same handlers:

- Completion card: `node "{PLUGIN_ROOT}/mcp-server/index.js" --render-card <payload.json>`
- Ship pipeline: `node "{PLUGIN_ROOT}/mcp-server/ship/cli.js" <tool> <params.json>`
  (`ship_preflight`, `ship_build`, `ship_version_bump`, `ship_release`,
  `ship_promote`, `ship_cleanup`, `ship_hygiene`; params = the tool's arguments
  as JSON, `-` reads stdin; result JSON on stdout; exit 2 invalid params,
  1 handler threw). Same zod schema, same checkpoint, and the run-contract
  release gate treats `cli.js ship_release` like the MCP tool. This is the
  pipeline, not a manual ship — do-ship runs its Steps 1–5 through it.

Say it when the session starts: the SessionStart hook reports the skip; tell
the user right then (one line) that ship/card run offline this session, not
hours later when the ship is due.

To get the servers back for later sessions:

1. The `plugin:devops:*` keys leave `~/.claude/mcp-needs-auth-cache.json`
   (stdio servers never need auth; the other entries stay). The SessionStart
   hook `ss.mcp.failcache` does this at every start — it runs concurrently with
   the MCP boot, so it rescues the *next* start, and says so when an entry was
   still blocking. Without the hook (older install): remove the keys by hand.
2. The user restarts the session.

A restart is optional — the offline entry points above cover card, ship and
promote. **Never** ship or promote by hand (`gh pr create`, `gh pr merge`, a
hand-made tag): the CLI is the only substitute for the tools.

## Anti-patterns

- **Do NOT** conclude "server missing" from a deferred list entry. Deferred = lazy-loaded schema, not absent.
- **Do NOT** fall back to manual `gh pr create` / `gh pr merge` when ship tools appear unavailable — the guard hook blocks it intentionally.
- **Do NOT** load tools one at a time. One ToolSearch call can load the whole pipeline in a single round-trip.
- **Do NOT** re-load a tool whose schema is already visible in the conversation. Once loaded, it persists for the session.

## Related

- `pre.ship.guard.js` — block message explicitly points here.
- `skills/do-ship/SKILL.md` Step 0.5 — enforces this pattern for the ship pipeline.
- `plugin-behavior.md` — general MCP-server expectations.
