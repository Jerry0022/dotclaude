# dotclaude

**Version: 0.4.0**

![Version](https://img.shields.io/badge/version-0.4.0-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)
![GitHub Package](https://img.shields.io/badge/registry-GitHub%20Packages-181717?style=flat-square&logo=github)

Portable, version-controlled [Claude Code](https://docs.anthropic.com/en/docs/claude-code) configuration — carry your instructions, skills, hooks, and scripts across every machine and project.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Quick Start](#-quick-start)
- [What's Inside](#-whats-inside)
- [Sync Workflow](#-sync-workflow)
- [File Classification](#-file-classification)
- [Architecture](#-architecture)
- [Contributing](#-contributing)
- [License](#-license)

## 💡 Overview

Claude Code stores its configuration in `~/.claude/` — but that directory is local, unversioned, and lost when you switch machines. **dotclaude** solves this by turning your global Claude Code config into a Git repository with setup automation, drift detection, and a one-command sync workflow.

Clone once, run setup, and every Claude Code session starts with the same instructions, skills, and hooks — whether you're on your desktop, laptop, or a fresh CI runner.

## ✨ Features

- 🧠 **Global instructions** — `CLAUDE.md` with rules for autonomy, git hygiene, sprint workflows, token awareness, versioning, and response style
- ⚡ **6 custom skills** — commit, debug, deep-research, explain, youtube-transcript, ship-dotclaude
- 📊 **Token management** — SessionStart dashboard with live rate limit tracking, cost guard hooks, and usage scraping
- 🔄 **Drift detection** — automatically detects when config files change during project sessions and prompts to sync
- 🖥️ **Cross-platform** — setup scripts for Unix (Bash) and Windows (PowerShell), path-portable hooks
- 📐 **Mermaid diagrams** — built-in rendering pipeline with dark theme and styled templates
- 🧩 **Inheritance model** — global rules as baseline, project-level `CLAUDE.md` files only extend or override
- 📦 **CLI installer** — `dotclaude setup` via the bundled CLI

## 🚀 Quick Start

### Fresh setup

```bash
git clone https://github.com/Jerry0022/dotclaude.git
cd dotclaude

# Unix / Git Bash
bash setup.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File setup.ps1

# Or via the CLI
node bin/cli.js setup
```

The setup script:

1. Copies all tracked files to `~/.claude/`
2. Deploys `settings.json` from the template (backs up any existing config)
3. Installs Node dependencies for hook scripts
4. Stores the repo path for sync-check

### After setup

1. **Add MCP server permissions** to `~/.claude/settings.json` for your connected services (Google Calendar, Gmail, etc.) — see `templates/plugins-manifest.json` for permission patterns
2. **Install plugins** if not already present (see `plugins-manifest.json`)
3. **Start a Claude Code session** — the startup hook shows the usage dashboard automatically

## 📦 What's Inside

| Category | Path | Purpose |
|---|---|---|
| **Instructions** | `CLAUDE.md` | Global rules: autonomy, git hygiene, sprint workflow, token awareness, versioning, response style, inheritance model |
| **Skills** | `skills/*/SKILL.md` | commit, debug, deep-research, explain, youtube-transcript, ship-dotclaude |
| **Commands** | `commands/*.md` | refresh-usage (scrape live rate limits from claude.ai) |
| **Scripts** | `scripts/*.js` | startup-summary, precheck-cost, check-dotclaude-sync, render-diagram, diagram-server, scrape-usage |
| **Templates** | `templates/` | settings.template.json, config.template.json, plugins-manifest.json |
| **Plugins** | `plugins/blocklist.json` | Blocked plugin list |
| **CLI** | `bin/cli.js` | Setup automation entry point |

## 🔄 Sync Workflow

When global config files are modified during any project session, the **SessionStart hook** detects drift and suggests running `/ship-dotclaude`.

The `/ship-dotclaude` skill:

1. Compares `~/.claude/` files against this repo
2. Copies changed files back
3. Bumps the version
4. Commits and pushes

This keeps the repo in sync without manual file copying.

## 📂 File Classification

### Tracked (portable, version-controlled)

- `CLAUDE.md`, skills, commands, scripts (`.js`), plugin blocklist
- Templates for machine-specific files

### Ignored (machine-specific, generated at runtime)

- `scripts/config.json` — regenerated on each startup with expensive-files list
- `scripts/session-history.json`, `scripts/usage-live.json`
- `plugins/cache/`, `plugins/data/`, `plugins/installed_plugins.json`
- `projects/`, `session-env/`, `plans/`, `backups/`, `telemetry/`
- `node_modules/`

### Templated (require per-machine adaptation)

- `settings.json` — hooks use `$HOME` for portability; MCP server UUIDs are machine-specific
- `config.json` — default limits are templated; `expensiveFiles` is populated at runtime

## 🏗️ Architecture

```mermaid
flowchart LR
    subgraph Repo["dotclaude repo"]
        CLAUDE[CLAUDE.md]
        Skills[skills/]
        Scripts[scripts/]
        Templates[templates/]
    end

    subgraph Live["~/.claude/ (live config)"]
        LiveClaude[CLAUDE.md]
        LiveSkills[skills/]
        LiveScripts[scripts/]
        LiveSettings[settings.json]
    end

    subgraph Session["Claude Code Session"]
        Startup[SessionStart Hook]
        Dashboard[Usage Dashboard]
        DriftCheck[Drift Detection]
    end

    Repo -->|setup.sh / setup.ps1| Live
    Live --> Session
    Startup --> Dashboard
    Startup --> DriftCheck
    DriftCheck -->|drift detected| ShipSkill[/ship-dotclaude]
    ShipSkill -->|sync back| Repo
```

## 🤝 Contributing

1. Fork this repo
2. Create a feature branch (`git checkout -b feat/my-change`)
3. Follow the commit convention: `type(scope): subject`
4. Open a PR — link related issues with `Closes #NNN`

## 📄 License

[MIT](LICENSE)
