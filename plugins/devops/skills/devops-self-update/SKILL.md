---
name: devops-self-update
version: 0.4.0
description: >-
  Manually update the devops plugin to latest from GitHub. Delegates to
  ss.plugin.update hook (pull + cache + registry), then adds changelog and
  verification report. Triggers on: "update plugin", "plugin updaten",
  "self update", "devops update", "neue version". Explicit user request only.
allowed-tools: Bash(git *), Bash(node *), Read, Glob
---

# Self-Update Plugin

Manually trigger a plugin update with user-facing reporting.

## Architecture

The actual update logic lives in `ss.plugin.update.js` (SessionStart hook).
This skill is a thin wrapper that:

1. Captures the current state (version, SHA)
2. Runs the hook's JS code (pull + cache rebuild + registry update + verify)
3. Reports what changed (changelog, verify status)

**No duplicated logic.** The hook is the single source of truth for the
update mechanism. This skill only adds reporting.

## Constants

```
PLUGIN_ROOT = ${CLAUDE_PLUGIN_ROOT} (from hook environment)
MARKETPLACE_DIR = ~/.claude/plugins/marketplaces/dotclaude
PLUGIN_SUBDIR = plugins/devops
HOOK_SCRIPT = ${PLUGIN_ROOT}/hooks/session-start/ss.plugin.update.js
```

## Step 0 — Capture current state

1. Read current version from `MARKETPLACE_DIR/PLUGIN_SUBDIR/.claude-plugin/plugin.json`
2. Read current git SHA: `git -C MARKETPLACE_DIR rev-parse --short HEAD`
3. Report: `Currently installed: v{version} ({sha})`

## Step 1 — Run update hook

Execute the hook script directly:

```bash
node HOOK_SCRIPT
```

The hook handles:
- `git pull --ff-only` on all marketplace clones
- Cache rebuild with `cp -a` (archive mode for dotfiles)
- `installed_plugins.json` registry update
- Silent verification (version alignment, cache completeness)

Capture and display the hook's stdout (update status lines).

## Step 2 — Changelog

Read NEW version and SHA, then show what changed:

```bash
git -C MARKETPLACE_DIR log --oneline {old_sha}..HEAD
```

If no changes: report "Already up to date" and stop.

## Step 3 — Verify & Report

### 3a — Version alignment

Read version from three sources and confirm they match:

| Source | Path |
|---|---|
| plugin.json (marketplace) | `MARKETPLACE_DIR/PLUGIN_SUBDIR/.claude-plugin/plugin.json` |
| plugin.json (cache) | Read `installed_plugins.json` → `installPath` → `.claude-plugin/plugin.json` |
| installed_plugins.json | `devops@dotclaude` → `version` |

All three must show the same version. If not → report mismatch.

### 3b — Cache completeness

Verify critical paths exist in the cache (path from `installed_plugins.json` → `installPath`):

- `.claude-plugin/plugin.json`
- `.mcp.json`
- `skills/` (non-empty)
- `hooks/` (non-empty)

### 3c — Skill count

Compare skill count between marketplace and cache:

```bash
ls -d MARKETPLACE_DIR/PLUGIN_SUBDIR/skills/*/ | wc -l
ls -d CACHE_PATH/skills/*/ | wc -l
```

### 3d — Report

```
Plugin updated: v{old_version} → v{new_version}
Commits: {count} new commits
{changelog}

Verified: ✓ version aligned, ✓ cache complete, ✓ {skill_count} skills
Restart the session for hooks and MCP tools to take effect.
Skills are available immediately.

⚠ MCP tools (/devops-ship, /devops-new-issue, completion card) will be
blocked by pre.mcp.health until restart — the running MCP processes
point at the now-deleted old installPath.
```

## Known Issues

- **Desktop App does not auto-rebuild cache** (anthropics/claude-code#14061):
  The `ss.plugin.update` hook works around this by rebuilding the cache.

- **Cache deleted on restart**: If `installed_plugins.json` points to a
  non-existent cache directory, the Desktop App may skip the plugin.
  Step 3 catches this.

- **Plugin key naming**: Marketplace and plugin name must differ
  (`devops@dotclaude`, not `devops@devops`). Identical names hide the
  plugin from the Customize UI.

- **MCP stale after upgrade**: When the plugin version changes, the
  marketplace clone's old cache dir is wiped and a new installPath is
  registered. MCP servers spawned earlier in the session still point at
  the deleted path. `ss.plugin.update` writes `.mcp-stale.json` so
  `pre.mcp.health` blocks further MCP calls until the user restarts.
  Cache repairs at the same version overwrite files in place and do NOT
  trigger the sentinel.
