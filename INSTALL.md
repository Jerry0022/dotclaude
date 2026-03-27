# Plugin Installation Guide (for Claude)

This file is a machine-readable installation procedure. When a user asks Claude to install the `dotclaude-dev-ops` plugin, Claude should read this file and follow the steps below.

## Prerequisites

- Claude Code installed and running

## Step 1: Ask the user

Use the `AskUserQuestion` tool — do NOT write question text inline before calling it.

Question: `"Wo soll das Plugin installiert werden?"`

Options:
- `"Global (~/.claude/settings.json)"` — für alle Projekte (empfohlen für Solo-Devs)
- `"Projekt: {cwd}/.claude/settings.json"` — nur für dieses Projekt

Use the project's actual working directory path in the project option label.

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

The hook paths differ based on install type:

- **Global install**: hooks are synced into `~/.claude/hooks/` and referenced via `$HOME/.claude/hooks/`
- **Project install**: hooks are synced into `{project}/.claude/hooks/` and referenced via relative paths `.claude/hooks/`

#### Global install — hook block

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/hooks/session-start/ss.plugin.update.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/hooks/session-start/ss.tokens.scan.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/hooks/session-start/ss.tasks.register.js\"" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Bash|Glob|Grep",
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/hooks/pre-tool-use/pre.tokens.guard.js\"" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/hooks/pre-tool-use/pre.ship.guard.js\"" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/hooks/post-tool-use/post.flow.completion.js\"" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/hooks/post-tool-use/post.debug.trigger.js\"" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/hooks/user-prompt-submit/prompt.git.sync.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/hooks/user-prompt-submit/prompt.issue.detect.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/hooks/user-prompt-submit/prompt.ship.detect.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/hooks/user-prompt-submit/prompt.start.detect.js\"" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$HOME/.claude/hooks/stop/stop.ship.guard.js\"" },
          { "type": "command", "command": "node \"$HOME/.claude/hooks/stop/stop.flow.completion.js\"" }
        ]
      }
    ]
  }
}
```

#### Project install — hook block

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \".claude/hooks/session-start/ss.plugin.update.js\"" },
          { "type": "command", "command": "node \".claude/hooks/session-start/ss.tokens.scan.js\"" },
          { "type": "command", "command": "node \".claude/hooks/session-start/ss.tasks.register.js\"" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Bash|Glob|Grep",
        "hooks": [
          { "type": "command", "command": "node \".claude/hooks/pre-tool-use/pre.tokens.guard.js\"" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \".claude/hooks/pre-tool-use/pre.ship.guard.js\"" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node \".claude/hooks/post-tool-use/post.flow.completion.js\"" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \".claude/hooks/post-tool-use/post.debug.trigger.js\"" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \".claude/hooks/user-prompt-submit/prompt.git.sync.js\"" },
          { "type": "command", "command": "node \".claude/hooks/user-prompt-submit/prompt.issue.detect.js\"" },
          { "type": "command", "command": "node \".claude/hooks/user-prompt-submit/prompt.ship.detect.js\"" },
          { "type": "command", "command": "node \".claude/hooks/user-prompt-submit/prompt.start.detect.js\"" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node \".claude/hooks/stop/stop.ship.guard.js\"" },
          { "type": "command", "command": "node \".claude/hooks/stop/stop.flow.completion.js\"" }
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

## Step 4: Bootstrap — initial hook sync

The SessionStart hooks reference hook files that don't exist yet on first install. Perform the initial sync now.

Determine the **sync target** based on the install type:

- **Global install**: sync target = `~/.claude/`
- **Project install**: sync target = `{project_root}/.claude/`

1. Download the latest release from the plugin repo:
   ```bash
   gh release download --repo Jerry0022/dotclaude-dev-ops --archive tar.gz --dir "$TMPDIR/dotclaude-bootstrap"
   ```

2. Extract the archive:
   ```bash
   tar -xzf "$TMPDIR/dotclaude-bootstrap"/*.tar.gz -C "$TMPDIR/dotclaude-bootstrap/extracted"
   ```

3. Copy each plugin directory (`hooks`, `skills`, `agents`, `deep-knowledge`, `templates`, `scripts`, `scheduled-tasks`) from the extracted archive into the **sync target**. Overwrite existing files.

4. Write the current version to `{sync_target}/.plugin-version` (extract from the release tag).

5. Clean up the temp directory.

After this step, all hooks exist in the sync target and the SessionStart hooks will work on the next session restart. Subsequent updates are handled automatically by `ss.plugin.update`.

## Step 5: Verify installation

Run these checks and report results:

1. **Settings file exists** — confirm the file was written successfully
2. **All three blocks present** — `extraKnownMarketplaces`, `enabledPlugins`, `hooks`
3. **Hook count** — count registered hooks across all lifecycle events (expected: 13 hook commands)
4. **Parse check** — confirm the JSON is valid (no syntax errors)
5. **Bootstrap check** — confirm `{sync_target}/hooks/session-start/ss.plugin.update.js` exists (from Step 4)

### Expected output

Report to the user:

```
Plugin installiert:
  Ziel:    {global | project path}
  Marketplace: Jerry0022 registriert
  Plugin:  dotclaude-dev-ops@Jerry0022 aktiviert
  Hooks:   {n}/13 registriert
  Status:  OK

Starte eine neue Session, damit die Hooks aktiv werden.
```

If any check fails, report the specific issue and offer to fix it.

## Step 6: Project configuration scan (project-level install only)

**Skip this step if the user chose global installation.**

When installed for a specific project, use the `AskUserQuestion` tool — do NOT write question text inline before calling it.

Question: `"Soll ich die bestehende .claude/-Konfiguration prüfen und passende Extensions einrichten?"`

Options:
- `"Ja, scannen und einrichten"` — Scan `.claude/` and create extension files
- `"Nein, später"` — Skip; user can run `/project-setup --init` any time

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

## Step 7: Post-install notes

Tell the user:
- Restart Claude Code or start a new session for hooks to take effect
- Skills (`/ship`, `/commit`, etc.) are available immediately after restart
- The plugin auto-updates at each session start via `ss.plugin.update`
- Run `/project-setup` in any project to scaffold or update extension templates later
