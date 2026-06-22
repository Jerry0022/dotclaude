# Ship Reference — dotclaude (plugin-source repo)

This is the **plugin-source** repo. A ship here changes the devops plugin itself,
so after the merge the locally-installed devops in *this* Claude Code instance must
be brought in sync with what was just shipped — otherwise the running instance keeps
the old version and the next session lands in a stale state ("devops nicht verfügbar").

## Why a post-ship self-update is needed here (and nowhere else)

A normal consumer project shipping its app has nothing to do with the devops plugin
version, so the stock `/devops-ship` never self-updates. This repo is the exception:
the artifact it ships *is* the plugin running the ship.

Without a post-ship sync, the update is left to the next `SessionStart`
(`ss.plugin.update` hook). That path has two failure modes we keep hitting:

1. **Double restart.** When `ss.plugin.update` discovers a *version change* at session
   start, it rebuilds the cache to a new `installPath` and writes
   `~/.claude/plugins/.mcp-stale.json`. The MCP servers were already spawned from the
   old path → `pre.mcp.health` blocks every `ship_*` / completion-card / issues call
   until the user restarts **again**. So: ship → restart → blocked → restart. Two restarts.
2. **Cache/registry drift in worktree/autonomous sessions.** Observed on 2026-06-22:
   marketplace clone pulled to `0.104.1`, but `installed_plugins.json` still pointed at
   `cache\…\devops\0.104.0` (SHA of the previous commit) with **no** stale sentinel — so
   the MCP tools silently ran against the old version. SessionStart did not reconcile it.

Running the sync **at ship time** (in the session that is about to be discarded) moves
the version-change rebuild into that throwaway session. The user's *next* restart then
finds nothing to do (`ss.plugin.update` clears the sentinel when nothing moved) and lands
directly on a clean, upgraded session. **Two restarts collapse into one.**

## Single source of truth

The finalizer delegates to the **same hook** as `/devops-plugin-update`:

```
node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start/ss.plugin.update.js"
```

No update logic is duplicated here. The hook does: `git pull --ff-only` on every
marketplace clone → cache rebuild (`fs.cpSync`, archive-mode for dotfiles) →
`installed_plugins.json` registry update → MCP-stale sentinel on a real version move.
For the detailed verify/report contract, see `skills/devops-plugin-update/SKILL.md`.

## Paths

| What | Path |
|---|---|
| Update hook | `${CLAUDE_PLUGIN_ROOT}/hooks/session-start/ss.plugin.update.js` |
| Marketplace clone | `~/.claude/plugins/marketplaces/dotclaude` |
| Plugin subdir in clone | `plugins/devops/.claude-plugin/plugin.json` |
| Cache root | `~/.claude/plugins/cache/dotclaude/devops/<version>` |
| Registry | `~/.claude/plugins/installed_plugins.json` (`devops@dotclaude`) |
| Stale sentinel | `~/.claude/plugins/.mcp-stale.json` |

## "falls vorhanden" — only when devops is actually installed

If `~/.claude/plugins/marketplaces/dotclaude` does not exist, there is no installed
devops to sync (e.g. running from a bare checkout without the plugin installed). The
hook already no-ops in that case (`if (!existsSync(marketplacesDir)) exit 0`) — the
finalizer just runs it and stays silent.

## deliver / verify

deliver: git+gh
<!-- No remote-deploy surface. The "delivery" of this repo is the plugin update above. -->
