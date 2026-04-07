---
name: devops-self-update
version: 0.1.0
description: >-
  Update the devops plugin to the latest version from GitHub.
  Pulls from origin/main, syncs the cache, and updates installed_plugins.json.
  Use when the Desktop App update mechanism doesn't work correctly.
  Triggers on: "update plugin", "plugin updaten", "self update",
  "devops update", "plugin aktualisieren", "neue version installieren".
  Do NOT trigger automatically — only on explicit user request.
allowed-tools: Bash(git *), Bash(cp *), Bash(mkdir *), Bash(rm *), Bash(node *), Read, Write, Edit, Glob
---

# Self-Update Plugin

Update devops to the latest version from GitHub.

## Constants

```
MARKETPLACE_DIR = ~/.claude/plugins/marketplaces/dotclaude
PLUGIN_SUBDIR   = plugins/devops
CACHE_BASE      = ~/.claude/plugins/cache/dotclaude/devops
REGISTRY_FILE   = ~/.claude/plugins/installed_plugins.json
PLUGIN_KEY      = devops@dotclaude
```

## Step 0 — Pre-flight

1. Verify `MARKETPLACE_DIR` exists and is a git repo
2. Read current version from `MARKETPLACE_DIR/PLUGIN_SUBDIR/.claude-plugin/plugin.json`
3. Read current git SHA: `git -C MARKETPLACE_DIR rev-parse --short HEAD`
4. Report: `Currently installed: v{version} ({sha})`

## Step 1 — Pull latest

1. Check for local changes in `MARKETPLACE_DIR`:
   ```bash
   git -C MARKETPLACE_DIR status --porcelain
   ```
2. If dirty: stash changes with `git -C MARKETPLACE_DIR stash push -m "devops-self-update auto-stash"`
3. Pull latest:
   ```bash
   git -C MARKETPLACE_DIR pull --ff-only origin main
   ```
4. If pull fails (diverged history): abort, pop stash if needed, report error
5. Read NEW version from `MARKETPLACE_DIR/PLUGIN_SUBDIR/.claude-plugin/plugin.json`
6. Read NEW git SHA: `git -C MARKETPLACE_DIR rev-parse --short HEAD`
7. If version unchanged AND SHA unchanged: report "Already up to date", pop stash, stop
8. Show changelog: `git -C MARKETPLACE_DIR log --oneline {old_sha}..{new_sha}`

## Step 2 — Sync cache

1. Create cache directory: `mkdir -p CACHE_BASE/{new_version}`
2. Remove old cache contents if target dir exists:
   ```bash
   rm -rf CACHE_BASE/{new_version}/*
   ```
3. Copy plugin files to cache:
   ```bash
   cp -r MARKETPLACE_DIR/PLUGIN_SUBDIR/* CACHE_BASE/{new_version}/
   cp -r MARKETPLACE_DIR/PLUGIN_SUBDIR/.claude-plugin CACHE_BASE/{new_version}/
   cp    MARKETPLACE_DIR/PLUGIN_SUBDIR/.mcp.json CACHE_BASE/{new_version}/ 2>/dev/null || true
   ```

## Step 3 — Update registry

1. Read `REGISTRY_FILE`
2. Update the `PLUGIN_KEY` entry:
   - `installPath`: `CACHE_BASE/{new_version}` (use OS-native path separators)
   - `version`: `{new_version}`
   - `lastUpdated`: current ISO timestamp
   - `gitCommitSha`: `{new_sha}`
   - Keep `scope`, `installedAt` unchanged
3. Write updated JSON back to `REGISTRY_FILE`

## Step 4 — Cleanup & Report

1. If stash was applied in Step 1: pop it back with `git -C MARKETPLACE_DIR stash pop`
2. Report:
   ```
   Plugin updated: v{old_version} -> v{new_version}
   Commits: {count} new commits
   {changelog}

   Restart the session for hooks and MCP tools to take effect.
   Skills are available immediately.
   ```
