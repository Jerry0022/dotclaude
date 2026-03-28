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

Merge the following two blocks into the existing settings JSON. Do NOT overwrite existing keys — merge them.

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

**No hook registration needed.** Hooks are auto-loaded from the plugin's `hooks.json` by the Claude Code plugin system. The plugin-guard module ensures hooks only fire for projects where the plugin is enabled (project or global).

### Merge rules

When the target `settings.json` already has content:

- **`extraKnownMarketplaces`**: Add the `Jerry0022` key. Keep existing marketplace entries.
- **`enabledPlugins`**: Add the `dotclaude-dev-ops@Jerry0022` key. Keep existing plugin entries.

Write the merged result back to the settings file.

## Step 4: Verify installation

Run these checks and report results:

1. **Settings file exists** — confirm the file was written successfully
2. **Both blocks present** — `extraKnownMarketplaces` and `enabledPlugins`
3. **Parse check** — confirm the JSON is valid (no syntax errors)
4. **Marketplace check** — confirm `~/.claude/plugins/marketplaces/jerry0022-dotclaude-dev-ops/` exists
5. **Hooks check** — confirm `hooks/hooks.json` exists in the marketplace directory

### Expected output

Report to the user:

```
Plugin installiert:
  Ziel:    {global | project path}
  Marketplace: Jerry0022 registriert
  Plugin:  dotclaude-dev-ops@Jerry0022 aktiviert
  Hooks:   via hooks.json (13 hooks, marketplace-direct)
  Guard:   projekt-isoliert (nur aktiv wo enabledPlugins gesetzt)
  Status:  OK

Starte eine neue Session, damit die Hooks aktiv werden.
```

If any check fails, report the specific issue and offer to fix it.

## Step 5: Project configuration scan (project-level install only)

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

## Step 6: Post-install notes

Tell the user:
- Restart Claude Code or start a new session for hooks to take effect
- Skills (`/ship`, `/commit`, etc.) are available immediately after restart
- The plugin auto-updates at each session start via `ss.plugin.update`
- Run `/project-setup` in any project to scaffold or update extension templates later
