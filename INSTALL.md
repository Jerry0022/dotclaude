# Plugin Installation Guide (for Claude)

This file is a machine-readable installation procedure. When a user asks Claude to install the `dotclaude-dev-ops` plugin, Claude should read this file and follow the steps below.

## Prerequisites

- Claude Code installed and running

## Installation Model

This plugin is installed **globally** — it runs in all projects. No per-project configuration is needed.

## Step 1: Register the marketplace

Read `~/.claude/settings.json` (create with `{}` if it doesn't exist).

Merge the following into the existing JSON. Do NOT overwrite existing keys — merge them.

```json
{
  "extraKnownMarketplaces": {
    "Jerry0022": {
      "source": {
        "source": "github",
        "repo": "Jerry0022/dotclaude-dev-ops"
      }
    }
  }
}
```

## Step 2: Enable the plugin

Merge into the same `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "dotclaude-dev-ops@Jerry0022": true
  }
}
```

### Merge rules

- **`extraKnownMarketplaces`**: Add the `Jerry0022` key. Keep existing marketplace entries.
- **`enabledPlugins`**: Add the `dotclaude-dev-ops@Jerry0022` key. Keep existing plugin entries.

Write the merged result back to the file.

**No hook registration needed.** Hooks are auto-loaded from the plugin's `hooks/hooks.json` by the Claude Code plugin system.

## Step 3: Verify installation

Run these checks and report results:

1. **Settings file written** — confirm `~/.claude/settings.json` contains both blocks
2. **Parse check** — confirm the JSON is valid
3. **Marketplace cloned** — confirm `~/.claude/plugins/marketplaces/dotclaude-dev-ops/` exists (Claude Code clones it automatically on next session start)
4. **Hooks present** — confirm `hooks/hooks.json` exists in the marketplace directory

### Expected output

```
Plugin installiert:
  Scope:       global (~/.claude/settings.json)
  Marketplace: Jerry0022 registriert
  Plugin:      dotclaude-dev-ops@Jerry0022 aktiviert
  Hooks:       13 hooks via hooks.json (marketplace-direct)
  Auto-Update: ss.plugin.update (every session start)
  Status:      OK

Starte eine neue Session, damit die Hooks aktiv werden.
```

If the marketplace directory doesn't exist yet (first install), tell the user to start a new session — Claude Code will clone it automatically.

## Step 4: Project-specific skill extensions (optional)

The plugin supports per-project customization via skill extension files. These are NOT required but can be added to any project:

```
{project}/.claude/skills/{skill-name}/reference.md
```

Use `/project-setup` in any project to auto-scaffold extension files based on the project's build system, CI config, and conventions.

| Detected | Extension created | Content |
|---|---|---|
| Build command (`npm run build`, etc.) | `skills/ship/reference.md` | Quality gates, build commands |
| Test command | `skills/ship/reference.md` | Test commands to run before PR |
| Commit scopes or conventions | `skills/commit/reference.md` | Scope rules |
| GitHub project board config | `skills/new-issue/reference.md` | Board IDs, label rules |

## Step 5: Post-install notes

Tell the user:
- Start a new Claude Code session for hooks to take effect
- Skills (`/ship`, `/commit`, `/debug`, etc.) are available immediately
- The plugin auto-updates at each session start via `ss.plugin.update`
- Run `/project-setup` in any project to scaffold skill extensions

## Uninstall

To remove the plugin:

1. Remove `"Jerry0022"` from `extraKnownMarketplaces` in `~/.claude/settings.json`
2. Remove `"dotclaude-dev-ops@Jerry0022"` from `enabledPlugins` in `~/.claude/settings.json`
3. Delete `~/.claude/plugins/marketplaces/dotclaude-dev-ops/`
4. Remove entry from `~/.claude/plugins/known_marketplaces.json` if present
