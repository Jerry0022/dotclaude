---
name: devops-self-update
version: 0.2.0
description: >-
  Update the devops plugin to the latest version from GitHub.
  Pulls from origin/main, rebuilds cache, updates installed_plugins.json,
  and verifies the result. Also triggered by the ss.plugin.update hook
  on session start (automatic pull + cache rebuild).
  Manual triggers: "update plugin", "plugin updaten", "self update",
  "devops update", "plugin aktualisieren", "neue version installieren".
  Do NOT trigger automatically — only on explicit user request.
allowed-tools: Bash(git *), Bash(cp *), Bash(mkdir *), Bash(rm *), Bash(node *), Read, Write, Edit, Glob
---

# Self-Update Plugin

Update devops plugin to the latest version from GitHub.

## Architecture

Two entry points share the same cache-rebuild logic:

| Entry | When | What |
|---|---|---|
| `ss.plugin.update` hook | Automatic, session start | `git pull` + cache rebuild (silent) |
| `/devops-self-update` skill | Manual, user request | `git pull` + cache rebuild + report |

The hook calls the same cache-rebuild steps (2-4) defined here.
This skill adds pre-flight reporting, changelog, and user-facing output.

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

## Step 2 — Rebuild cache

**CRITICAL:** The Desktop App does not rebuild plugin caches after git pull
(anthropics/claude-code#14061). We must do it ourselves. Incomplete or
mismatched caches cause skills to not load while hooks/MCP still work
(they load from MARKETPLACE_DIR directly via CLAUDE_PLUGIN_ROOT).

### 2a — Clean old caches

Remove ALL version directories under `CACHE_BASE/` (not just the old version).
Old cache dirs with wrong version numbers confuse the Desktop App.

```bash
rm -rf CACHE_BASE/*/
```

### 2b — Create new cache

```bash
mkdir -p CACHE_BASE/{new_version}
```

### 2c — Copy ALL plugin files

**Use `cp -a` (archive mode) instead of `cp -r *`.**
The `*` glob misses dotfiles and can skip newly added directories.

```bash
cp -a MARKETPLACE_DIR/PLUGIN_SUBDIR/. CACHE_BASE/{new_version}/
```

This copies everything including `.claude-plugin/`, `.mcp.json`, and any
new skill directories that were added in the update.

**Fallback (if `cp -a` not available):**
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
   - `gitCommitSha`: `{new_sha}` (short, 7 chars)
   - Keep `scope`, `installedAt` unchanged
3. If `PLUGIN_KEY` does not exist yet (fresh install), create it:
   ```json
   "devops@dotclaude": [{
     "scope": "user",
     "installPath": "...",
     "version": "...",
     "installedAt": "<now ISO>",
     "lastUpdated": "<now ISO>",
     "gitCommitSha": "..."
   }]
   ```
4. Write updated JSON back to `REGISTRY_FILE`

## Step 4 — Verify (MANDATORY)

**Every update must be verified.** Do not skip this step.

### 4a — Version alignment

Read version from THREE sources and confirm they match:

| Source | Path |
|---|---|
| plugin.json (marketplace) | `MARKETPLACE_DIR/PLUGIN_SUBDIR/.claude-plugin/plugin.json` |
| plugin.json (cache) | `CACHE_BASE/{new_version}/.claude-plugin/plugin.json` |
| installed_plugins.json | `REGISTRY_FILE` → `PLUGIN_KEY` → `version` |

All three must show the same version. If not → report mismatch and fix.

### 4b — Cache completeness

Verify these critical paths exist in the cache:

```
CACHE_BASE/{new_version}/.claude-plugin/plugin.json
CACHE_BASE/{new_version}/.mcp.json
CACHE_BASE/{new_version}/skills/  (directory exists, non-empty)
CACHE_BASE/{new_version}/hooks/   (directory exists, non-empty)
```

If any are missing → re-copy from marketplace and report.

### 4c — Skill count check

Count skill directories in marketplace vs cache:

```bash
ls -d MARKETPLACE_DIR/PLUGIN_SUBDIR/skills/*/ | wc -l
ls -d CACHE_BASE/{new_version}/skills/*/ | wc -l
```

Both counts must match. If cache has fewer → re-copy and report.

## Step 5 — Cleanup & Report

1. If stash was applied in Step 1: pop it back with `git -C MARKETPLACE_DIR stash pop`
2. Report:
   ```
   Plugin updated: v{old_version} → v{new_version}
   Commits: {count} new commits
   {changelog}

   Verified: ✓ version aligned, ✓ cache complete, ✓ {skill_count} skills
   Restart the session for hooks and MCP tools to take effect.
   Skills are available immediately.
   ```

## Known Issues

- **Desktop App does not auto-rebuild cache** (anthropics/claude-code#14061):
  After `git pull`, the marketplace clone has new files but the cache is stale.
  The `ss.plugin.update` hook and this skill both work around this by
  rebuilding the cache manually.

- **`cp -r *` misses dotfiles and new directories**: Always use `cp -a src/. dst/`
  (archive mode with trailing dot) to ensure complete copies.

- **Cache deleted on restart**: If `installed_plugins.json` points to a cache
  directory that doesn't exist, the Desktop App may silently skip the plugin.
  Step 4 catches this by verifying cache completeness after every update.

- **Plugin key naming**: The marketplace name and plugin name must differ
  (e.g., `devops@dotclaude`, not `devops@devops`). Identical names cause the
  Desktop App to not display the plugin in the Customize UI.
