---
name: auto-update
version: 0.5.0
description: >-
  Manually update the devops plugin to latest from GitHub. Delegates to
  ss.plugin.update hook (pull + cache + registry), then adds changelog and
  verification report. Triggers on: "update plugin", "plugin updaten",
  "self update", "devops update", "neue version". Explicit user request only.
layer: 2
invokes: []
user-invocable: false
triggers:
  en: ["update plugin", "self update", "devops update"]
  de: ["plugin updaten", "neue version"]
allowed-tools: Bash(git *), Bash(node *), Read, Glob
---

# Plugin Update

Manually trigger a plugin update with user-facing reporting. The update logic
lives in `ss.plugin.update.js` (SessionStart hook) — the single source of
truth; this skill captures the state before, runs the hook, and reports.

## Constants

```
PLUGIN_ROOT = {PLUGIN_ROOT} (literal path from the session context; $CLAUDE_PLUGIN_ROOT is empty in the Bash tool)
MARKETPLACE_DIR = ~/.claude/plugins/marketplaces/dotclaude
PLUGIN_SUBDIR = plugins/devops
HOOK_SCRIPT = ${PLUGIN_ROOT}/hooks/session-start/ss.plugin.update.js
```

## Step 0 — Capture current state + channel

1. Current version from `MARKETPLACE_DIR/PLUGIN_SUBDIR/.claude-plugin/plugin.json`
   and SHA from `git -C MARKETPLACE_DIR rev-parse --short HEAD`.
2. Channel pin from `~/.claude/plugins/.channels.json` (key = marketplace
   name, missing/invalid → `stable`). One channel per MARKETPLACE — a single
   clone cannot serve two plugins on different channels.
3. **`--channel <alpha|beta|stable>` flag:** re-pin by writing the sidecar
   (`{"dotclaude": "beta"}` merged into the existing JSON), then continue with
   the update so the new pin takes effect immediately.
4. Drift: latest version visible to the pin vs. latest alpha
   (`git -C MARKETPLACE_DIR ls-remote --tags origin`, numeric compare on
   `alpha/vX.Y.Z` / `beta/vX.Y.Z` / `stable/vX.Y.Z` / bare `vX.Y.Z`).
5. Report: `Currently installed: v{version} ({sha}) — Channel: {channel},
   latest visible: v{N}` and, when alpha is ahead:
   `(alpha has v{M} available)`.

## Step 1 — Run update hook

```bash
node HOOK_SCRIPT --force
```

`--force` is required: at SessionStart the hook is throttled by a 6 h cooldown
(#324) and defers cache repairs to a detached child; `--force` skips both so
the result is complete when this step returns.

The hook does the channel-aware checkout of every marketplace clone, the cache
rebuild, the `installed_plugins.json` update, a silent verification, and the
Quiet output style refresh. Show its stdout.

## Step 2 — Changelog

Read the NEW version and SHA, then `git -C MARKETPLACE_DIR log --oneline
{old_sha}..HEAD`. No changes → report "Already up to date" and stop.

## Step 3 — Verify & Report

1. **Version alignment** — these three must match, else report the mismatch:
   `MARKETPLACE_DIR/PLUGIN_SUBDIR/.claude-plugin/plugin.json`; the cache's
   `.claude-plugin/plugin.json` (`installed_plugins.json` → `installPath`);
   `installed_plugins.json` → `devops@dotclaude` → `version`.
2. **Cache completeness** — under `installPath`: `.claude-plugin/plugin.json`,
   `.mcp.json`, non-empty `skills/` and `hooks/`.
3. **Skill count** — `ls -d <dir>/skills/*/ | wc -l` for marketplace and cache
   must match.
4. **Quiet style** — from the hook output: `**Quiet output style**: synced …`
   → `synced`; a stderr `differs from every shipped Quiet style` note →
   `customized — left as is`; otherwise `current` when
   `~/.claude/output-styles/quiet.md` exists, else `not installed`.

Report:

```
Plugin updated: v{old_version} → v{new_version}
Commits: {count} new commits
{changelog}

Verified: ✓ version aligned, ✓ cache complete, ✓ {skill_count} skills
Quiet style: {synced | current | customized — left as is | not installed}
Restart the session for hooks and MCP tools to take effect.
Skills are available immediately.

⚠ MCP tools (/do-ship, /auto-issue, completion card) will be
blocked by pre.mcp.health until restart — the running MCP processes
point at the now-deleted old installPath.
```

The MCP warning applies only when the version changed: the hook then wipes the
old cache dir and writes `.mcp-stale.json`, which `pre.mcp.health` enforces. A
cache repair at the same version overwrites in place and does not block MCP.

## Known Issues

- **Desktop App does not auto-rebuild the cache** (anthropics/claude-code#14061)
  and may skip a plugin whose `installPath` no longer exists — the hook
  rebuilds it; Step 3 catches the rest.
- **Plugin key naming**: marketplace and plugin name must differ
  (`devops@dotclaude`, not `devops@devops`), or the plugin is hidden from the
  Customize UI.
