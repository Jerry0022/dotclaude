# Ship Reference — dotclaude (plugin-source repo)

This is the **plugin-source** repo. A ship here changes the devops plugin itself,
so after the merge the locally-installed devops in *this* Claude Code instance must
be brought in sync with what was just shipped — otherwise the running instance keeps
the old version and the next session lands in a stale state ("devops nicht verfügbar").

> **Channel caveat (ring model).** "In sync with what was just shipped" only holds
> when the local install's channel pin (`~/.claude/plugins/.channels.json`, default
> `stable`) actually receives the shipped version. A plain `/devops-ship` publishes to
> **alpha** only, so on the default stable pin the local install correctly STAYS on the
> previous stable version until `/devops-release` promotes it — the Step 8 finalizer is
> then a cache-repair no-op, not a failure. Do not "fix" the detached-HEAD marketplace
> clone by forcing it onto `main`; the pin resets it by design. See the memory
> `project_ring_model_local_stays_stable` for the full symptom/diagnosis note.

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

## Path resolution — why Step 8 must not trust `${CLAUDE_PLUGIN_ROOT}`

`${CLAUDE_PLUGIN_ROOT}` resolves to the **version-pinned** cache dir of the plugin
the session was *started* with. A ship bumps the version, and any cache rebuild in
between (parallel session's `ss.plugin.update`, or this repo's own finalizer) deletes
the old version dir — the pinned path then points into the void (`MODULE_NOT_FOUND`,
observed 2026-07-03 after shipping 0.107.0, where the cache had already moved
0.106.0 → 0.107.0 mid-session). Step 8 therefore globs
`~/.claude/plugins/cache/dotclaude/devops/*/…` fresh and falls back to the
marketplace clone. Sync-already-done signature (another session raced ahead —
nothing left to do): registry `installed_plugins.json`, marketplace
`plugin.json`, and the cache dir all report the shipped version AND no
`.mcp-stale.json` sentinel exists.

## "falls vorhanden" — only when devops is actually installed

If `~/.claude/plugins/marketplaces/dotclaude` does not exist, there is no installed
devops to sync (e.g. running from a bare checkout without the plugin installed). The
hook already no-ops in that case (`if (!existsSync(marketplacesDir)) exit 0`) — the
finalizer just runs it and stays silent.

## deliver / verify

deliver: git+gh
<!-- No remote-deploy surface. The "delivery" of this repo is the plugin update above. -->
