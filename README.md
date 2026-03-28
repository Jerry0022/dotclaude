# dotclaude-dev-ops

**Version: 0.7.0**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

Complete DevOps automation plugin for Claude Code. Hooks, skills, agents, and templates that make shipping faster, safer, and smarter.

## Features

- **13 Hooks** — automated guards and triggers across the full session lifecycle
- **9 Skills** — ship, commit, debug, research, explain, issues, project setup, readme, usage tracking
- **9 Agents** — QA, Feature Worker, Research, PO, Frontend, Core, Windows, AI, Gamer
- **Completion Flow** — mandatory card after every task (7 variants), visual verification, ship recommendation
- **Ship Enforcement** — intent detection, PR command blocking, automatic /ship skill routing
- **3-Layer Extension Model** — customize any skill or agent per-project without forking

## Installation

Tell Claude:

> "Install the dotclaude-dev-ops plugin from `Jerry0022/dotclaude-dev-ops`."

Claude reads [`INSTALL.md`](INSTALL.md) from this repo and handles everything — registers the marketplace globally, enables the plugin, verifies the result.

## Updates

Plugin updates are managed by the Claude Code marketplace. Enable auto-update via `/plugin` → Marketplaces, or update manually:

```bash
claude plugin update dotclaude-dev-ops@Jerry0022
```

The plugin uses semantic versioning. Breaking changes only in major versions.

## What it does

### Hooks (automatic, no user action needed)

<details>
<summary><strong>By session lifecycle</strong> — when does it fire?</summary>

> **SessionStart** `-->` **PreToolUse** `-->` **PostToolUse** `-->` **UserPromptSubmit** `-->` **Stop**

**SessionStart** — runs once when a session begins

| Category | Action | Description | Hook |
|---|---|---|---|
| tokens | scan | Scan project for expensive files | `ss.tokens.scan` |
| git | check | Check for uncommitted/unpushed changes | `ss.git.check` |
| tasks | register | Auto-register scheduled tasks | `ss.tasks.register` |

**PreToolUse** — runs before each tool call

| Category | Action | Description | Hook |
|---|---|---|---|
| tokens | guard | Block operations exceeding token budget | `pre.tokens.guard` |
| ship | guard | Block manual PR commands + git push with dirty state | `pre.ship.guard` |

**PostToolUse** — runs after each tool call

| Category | Action | Description | Hook |
|---|---|---|---|
| flow | track | Track code edits for completion flow | `post.flow.completion` |
| debug | trigger | Recommend debug after repeated failures | `post.debug.trigger` |

**UserPromptSubmit** — runs when the user sends a message

| Category | Action | Description | Hook |
|---|---|---|---|
| git | sync | Periodic pull/merge main (every 15 min) | `prompt.git.sync` |
| issues | detect | Track GitHub issues automatically | `prompt.issue.detect` |
| ship | detect | Detect ship intent, enforce /ship skill | `prompt.ship.detect` |
| flow | detect | Detect app start intent, enforce completion card | `prompt.start.detect` |

**Stop** — runs when the agent finishes

| Category | Action | Description | Hook |
|---|---|---|---|
| ship | guard | Warn about uncommitted changes | `stop.ship.guard` |

</details>

<details>
<summary><strong>By category</strong> — what does it guard?</summary>

#### :shield: tokens — prevent context window waste

| Action | Trigger | Description | Hook |
|---|---|---|---|
| scan | SessionStart | Scan project for expensive files | `ss.tokens.scan` |
| guard | PreToolUse | Block operations exceeding token budget | `pre.tokens.guard` |

#### :anchor: git — keep the working tree in sync

| Action | Trigger | Description | Hook |
|---|---|---|---|
| check | SessionStart | Check for uncommitted/unpushed changes | `ss.git.check` |
| sync | UserPromptSubmit | Periodic pull/merge main (every 15 min) | `prompt.git.sync` |

#### :ship: ship — enforce the shipping pipeline

| Action | Trigger | Description | Hook |
|---|---|---|---|
| guard | PreToolUse | Block manual PR commands + git push with dirty state | `pre.ship.guard` |
| detect | UserPromptSubmit | Detect ship intent, enforce /ship skill | `prompt.ship.detect` |
| guard | Stop | Warn about uncommitted changes | `stop.ship.guard` |

#### :arrows_counterclockwise: flow — track progress toward completion

| Action | Trigger | Description | Hook |
|---|---|---|---|
| track | PostToolUse | Track code edits for completion flow | `post.flow.completion` |
| detect | UserPromptSubmit | Detect app start intent, enforce completion card | `prompt.start.detect` |

#### :beetle: debug — surface failures early

| Action | Trigger | Description | Hook |
|---|---|---|---|
| trigger | PostToolUse | Recommend debug after repeated failures | `post.debug.trigger` |

#### :clipboard: tasks — manage scheduled automation

| Action | Trigger | Description | Hook |
|---|---|---|---|
| register | SessionStart | Auto-register scheduled tasks | `ss.tasks.register` |

#### :mag: issues — automatic issue tracking

| Action | Trigger | Description | Hook |
|---|---|---|---|
| detect | UserPromptSubmit | Track GitHub issues automatically | `prompt.issue.detect` |

</details>

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
├── hooks/                         ← 13 hook scripts (JS)
├── skills/                        ← 9 skill definitions (SKILL.md)
├── agents/                        ← 9 agent templates (AGENT.md)
├── deep-knowledge/                ← Cross-cutting reference docs
├── templates/                     ← Output format templates
└── scripts/                       ← Utility scripts (build-id, usage)
```

## License

MIT
