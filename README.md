# dotclaude-dev-ops

**Version: 0.1.0**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

Complete DevOps automation plugin for Claude Code. Hooks, skills, agents, and templates that make shipping faster, safer, and smarter.

## Features

- **8 Hooks** — automated guards and triggers across the full session lifecycle
- **9 Skills** — ship, commit, debug, research, explain, issues, project setup, readme, usage tracking
- **9 Agents** — QA, Feature Worker, Research, PO, Frontend, Core, Windows, AI, Gamer
- **Completion Card** — standardized task completion signal with burn-rate analysis
- **3-Layer Extension Model** — customize any skill or agent per-project without forking

## Installation

### Option 1: Marketplace (recommended)

Add the marketplace, then install:

```bash
/plugin marketplace add Jerry0022/dotclaude-dev-ops
/plugin install dotclaude-dev-ops
```

### Option 2: Direct install

```bash
/plugin install dotclaude-dev-ops@Jerry0022
```

### Option 3: Local development

```bash
claude --plugin-dir /path/to/dotclaude-dev-ops
```

## Updates

### Claude Code CLI

```bash
/plugin marketplace update
```

Or enable auto-updates: `export FORCE_AUTOUPDATE_PLUGINS=true`

### Claude Desktop (auto-update via hook)

The `ss.plugin.update` hook runs at every session start:

1. Checks GitHub for the latest release (~200ms, one API call)
2. If a newer version exists, downloads and installs automatically
3. Reports: `Plugin v0.1.0 → v0.2.0 aktualisiert`
4. If GitHub is unreachable, continues silently with the current version

**Requirement:** `gh` CLI must be authenticated (`gh auth login`).

The plugin uses semantic versioning. Breaking changes only in major versions.

## What it does

### Hooks (automatic, no user action needed)

| Event | Hook | What it does |
|---|---|---|
| SessionStart | `ss.git.sync` | Pull main and merge into current branch |
| SessionStart | `ss.tokens.scan` | Scan project for expensive files |
| PreToolUse | `pre.tokens.guard` | Block operations exceeding token budget |
| PreToolUse | `pre.ship.guard` | Block git push with uncommitted files |
| PostToolUse | `post.flow.completion` | Verify changes + recommend ship |
| PostToolUse | `post.debug.trigger` | Recommend debug after repeated failures |
| UserPromptSubmit | `prompt.git.sync` | Periodic pull/merge main (every 10 min) |
| UserPromptSubmit | `prompt.issue.detect` | Track GitHub issues automatically |
| Stop | `stop.ship.guard` | Warn about uncommitted changes |

### Skills (invoked explicitly or by hooks)

| Skill | Purpose |
|---|---|
| `/ship` | Full shipping pipeline: build, version, PR, merge, cleanup |
| `/commit` | Conventional commits with smart staging |
| `/debug` | Root-cause analysis with decision tree |
| `/deep-research` | Multi-angle research with structured output |
| `/explain` | Code explanation with diagrams |
| `/new-issue` | GitHub issue creation with labels and milestones |
| `/project-setup` | Repo hygiene audit and initialization |
| `/readme` | Modern README generation |
| `/refresh-usage` | Token usage tracking (CLI + CDP) |

### Agents (spawned for parallel work)

| Agent | Role |
|---|---|
| **qa** | Test, verify, screenshot |
| **feature** | Orchestrate feature implementation |
| **research** | Deep-dive investigations |
| **po** | Requirements and validation |
| **frontend** | UI components and styling |
| **core** | Business logic and APIs |
| **windows** | Platform-specific features |
| **ai** | AI/ML integration |
| **gamer** | Player perspective and UX |

## Customization

Every skill and agent supports **three-layer extensions**:

```
Layer 1: Plugin (this plugin)         ← defaults
Layer 2: User global (~/.claude/)     ← your personal overrides
Layer 3: Project ({project}/.claude/) ← project-specific rules
```

To extend a skill for your project, create:

```
your-project/.claude/skills/ship/
├── SKILL.md        ← override or add steps
└── reference.md    ← project-specific context
```

The plugin reads your extensions before executing and merges them. Your rules win on conflict.

Run `/project-setup --init` to scaffold extension templates automatically.

For the full extension guide with examples per skill, see `deep-knowledge/skill-extension-guide.md`.

## Project Structure

```
dotclaude-dev-ops/
├── .claude-plugin/plugin.json     ← Plugin manifest
├── CONVENTIONS.md                 ← Naming, versioning, extension rules
├── hooks/                         ← 8 hook scripts (JS)
├── skills/                        ← 9 skill definitions (SKILL.md)
├── agents/                        ← 9 agent templates (AGENT.md)
├── deep-knowledge/                ← Cross-cutting reference docs
├── templates/                     ← Output format templates
└── scripts/                       ← Utility scripts (build-id, usage)
```

## License

MIT
