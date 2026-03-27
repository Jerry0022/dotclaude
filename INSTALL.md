# Plugin Installation Guide (for Claude)

This file is a machine-readable installation procedure. When a user asks Claude to install the `dotclaude-dev-ops` plugin, Claude should read this file and follow the steps below.

## Prerequisites

- Claude Code installed and running
- `gh` CLI authenticated (`gh auth login`) — required for auto-updates

## Step 1: Ask the user

Ask the user ONE question with these options:

| Option | Description |
|---|---|
| **Global** (recommended) | Install for all projects. Writes to `~/.claude/settings.json`. Best for solo devs. |
| **Project: {cwd}** | Install for this project only. Writes to `{cwd}/.claude/settings.json`. Best for team baselines. |

Use the project's actual working directory path in the option label.

## Step 2: Determine the settings file path

Based on the user's choice:

- **Global:** `~/.claude/settings.json`
- **Project:** `{project_root}/.claude/settings.json`

Read the existing file if it exists. If it doesn't exist, start with `{}`.

## Step 3: Merge the plugin configuration

Merge the following three blocks into the existing settings JSON. Do NOT overwrite existing keys — merge them.

### 3a. Marketplace source

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

### 3b. Enable plugin

```json
{
  "enabledPlugins": {
    "dotclaude-dev-ops@Jerry0022": true
  }
}
```

### 3c. Register hooks (CRITICAL)

Claude Code does NOT auto-register hooks from plugin manifests. Without this block, skills and agents work but hooks won't fire.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node hooks/session-start/ss.plugin.update.js" },
          { "type": "command", "command": "node hooks/session-start/ss.tokens.scan.js" },
          { "type": "command", "command": "node hooks/session-start/ss.tasks.register.js" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Bash|Glob|Grep",
        "hooks": [
          { "type": "command", "command": "node hooks/pre-tool-use/pre.tokens.guard.js" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node hooks/pre-tool-use/pre.ship.guard.js" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node hooks/post-tool-use/post.flow.completion.js" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node hooks/post-tool-use/post.debug.trigger.js" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node hooks/user-prompt-submit/prompt.git.sync.js" },
          { "type": "command", "command": "node hooks/user-prompt-submit/prompt.issue.detect.js" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node hooks/stop/stop.ship.guard.js" },
          { "type": "command", "command": "node hooks/stop/stop.flow.completion.js" }
        ]
      }
    ]
  }
}
```

### Merge rules

When the target `settings.json` already has content:

- **`extraKnownMarketplaces`**: Add the `Jerry0022` key. Keep existing marketplace entries.
- **`enabledPlugins`**: Add the `dotclaude-dev-ops@Jerry0022` key. Keep existing plugin entries.
- **`hooks`**: For each lifecycle event (`SessionStart`, `PreToolUse`, etc.):
  - If the event already has hook entries, **append** the new entries to the existing array.
  - If the event does not exist, create it with the entries above.
  - Never remove or overwrite existing hook entries from other plugins.

Write the merged result back to the settings file.

## Step 4: Verify installation

Run these checks and report results:

1. **Settings file exists** — confirm the file was written successfully
2. **All three blocks present** — `extraKnownMarketplaces`, `enabledPlugins`, `hooks`
3. **Hook count** — count registered hooks across all lifecycle events (expected: 11 hook commands)
4. **Parse check** — confirm the JSON is valid (no syntax errors)

### Expected output

Report to the user:

```
Plugin installiert:
  Ziel:    {global | project path}
  Marketplace: Jerry0022 registriert
  Plugin:  dotclaude-dev-ops@Jerry0022 aktiviert
  Hooks:   {n}/11 registriert
  Status:  OK

Starte eine neue Session, damit die Hooks aktiv werden.
```

If any check fails, report the specific issue and offer to fix it.

## Step 5: Project configuration scan (project-level install only)

**Skip this step if the user chose global installation.**

When installed for a specific project, ask the user:

> "Soll ich die bestehende `.claude/`-Konfiguration des Projekts prüfen und passende Extensions für das Plugin einrichten?"

Options:
| Option | Description |
|---|---|
| **Ja, scannen und einrichten** | Scan the project's `.claude/` directory and create extension files |
| **Nein, später** | Skip — the user can run `/project-setup --init` at any time |

### If the user says yes:

1. **Scan existing project configuration:**
   - Read `{project}/CLAUDE.md` if it exists — extract build commands, test commands, deploy targets, scopes, conventions
   - Read `{project}/.claude/settings.json` for existing hooks or tool config
   - Read `{project}/package.json`, `Makefile`, `Cargo.toml`, `pom.xml`, `build.gradle`, etc. — detect build system
   - Read `.github/workflows/` — detect CI commands and deploy targets

2. **Generate extension files** based on what was found:

   For each relevant skill, create `{project}/.claude/skills/{name}/reference.md` with project-specific context:

   | Detected | Extension created | Content |
   |---|---|---|
   | Build command (`npm run build`, `cargo build`, etc.) | `skills/ship/reference.md` | Quality gates, build commands |
   | Test command | `skills/ship/reference.md` | Test commands to run before PR |
   | Deploy target / CI config | `skills/ship/reference.md` | Deploy instructions |
   | Version files (`package.json`, `Cargo.toml`, etc.) | `skills/ship/reference.md` | Version file locations and formats |
   | Commit scopes or conventions in CLAUDE.md | `skills/commit/reference.md` | Scope rules |
   | Log paths or debug info | `skills/debug/reference.md` | Log locations |
   | GitHub project board config | `skills/new-issue/reference.md` | Board IDs, label rules |

3. **Show the user what was created** — list each file and a one-line summary of its content.

4. **Explain** that these extensions are automatically picked up by the plugin's skills (Layer 3 of the 3-layer extension model) and can be edited at any time.

## Step 6: Post-install notes

Tell the user:
- Restart Claude Code or start a new session for hooks to take effect
- Skills (`/ship`, `/commit`, etc.) are available immediately after restart
- The plugin auto-updates at each session start via `ss.plugin.update`
- Run `/project-setup` in any project to scaffold or update extension templates later
