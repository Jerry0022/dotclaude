# Plugin Installation Guide (for Claude)

This file is a machine-readable installation procedure. When a user asks Claude to install the `dotclaude-dev-ops` plugin, Claude should read this file and follow the steps below.

## Prerequisites

- Claude Code installed and running (Desktop or CLI)

## Installation Model

This plugin is installed **globally** — it runs in all projects. No per-project configuration is needed.

## Step 1: Register marketplace and enable plugin

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
  },
  "enabledPlugins": {
    "dotclaude-dev-ops@Jerry0022": true
  }
}
```

## Step 2: Register hooks

Claude Code Desktop does **not** auto-load hooks from plugin `hooks.json` files. Hooks must be registered explicitly in the `hooks` field of `~/.claude/settings.json`.

Merge the following `hooks` block into `~/.claude/settings.json`. If a `hooks` field already exists, merge each event array (do not overwrite existing hooks from other sources).

The path prefix `$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops` points to the marketplace cache directory. Claude Code resolves `$HOME` automatically.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/session-start/ss.tokens.scan.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/session-start/ss.git.check.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/session-start/ss.tasks.register.js\"" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Bash|Glob|Grep",
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/pre-tool-use/pre.tokens.guard.js\"" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/pre-tool-use/pre.ship.guard.js\"" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/post-tool-use/post.flow.completion.js\"" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/post-tool-use/post.flow.debug.js\"" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/user-prompt-submit/prompt.git.sync.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/user-prompt-submit/prompt.issue.detect.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/user-prompt-submit/prompt.ship.detect.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/dotclaude-dev-ops/hooks/user-prompt-submit/prompt.flow.appstart.js\"" }
        ]
      }
    ]
  }
}
```

### Merge rules

- **`extraKnownMarketplaces`**: Add the `Jerry0022` key. Keep existing entries.
- **`enabledPlugins`**: Add the `dotclaude-dev-ops@Jerry0022` key. Keep existing entries.
- **`hooks`**: For each event type (`SessionStart`, `PreToolUse`, etc.), append the hook entries to the existing array. Keep existing hooks from other sources.

## Step 3: Verify installation

Run these checks and report results:

1. **Settings file written** — confirm `~/.claude/settings.json` contains all three blocks
2. **Parse check** — confirm the JSON is valid
3. **Marketplace cloned** — confirm `~/.claude/plugins/marketplaces/dotclaude-dev-ops/` exists (Claude Code clones it automatically on next session start)
4. **Hook scripts exist** — confirm `hooks/session-start/ss.tokens.scan.js` exists in the marketplace directory

### Expected output

```
Plugin installiert:
  Scope:       global (~/.claude/settings.json)
  Marketplace: Jerry0022 registriert
  Plugin:      dotclaude-dev-ops@Jerry0022 aktiviert
  Hooks:       12 hooks in settings.json (absolute paths to marketplace cache)
  Auto-Update: managed by Claude Code marketplace (enable via /plugin)
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
- Plugin updates are handled by the Claude Code marketplace. Enable auto-update via `/plugin` → Marketplaces, or run `claude plugin update dotclaude-dev-ops@Jerry0022` manually
- Run `/project-setup` in any project to scaffold skill extensions

## Uninstall

To remove the plugin:

1. Remove `"Jerry0022"` from `extraKnownMarketplaces` in `~/.claude/settings.json`
2. Remove `"dotclaude-dev-ops@Jerry0022"` from `enabledPlugins` in `~/.claude/settings.json`
3. Remove all hook entries containing `dotclaude-dev-ops` from `hooks` in `~/.claude/settings.json`
4. Delete `~/.claude/plugins/marketplaces/dotclaude-dev-ops/`
5. Remove entry from `~/.claude/plugins/known_marketplaces.json` if present
