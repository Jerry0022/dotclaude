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

### Global vs. Project — which one?

| | Global | Project |
|---|---|---|
| **Scope** | All your projects | This repo only |
| **Stored in** | `~/.claude/settings.json` | `{project}/.claude/settings.json` |
| **Shared with team** | No (personal) | No — gitignore recommended |
| **Best for** | Solo devs, personal workflow | Teams that want a shared baseline |

> **Recommendation:** Install **globally** for personal use. For teams, add the snippet below to each dev's `settings.json` and document the setup in your project's `CLAUDE.md` or contributing guide — do **not** commit `.claude/settings.json` to git, as it may contain personal preferences.

---

### settings.json (recommended)

Add these keys to your target `settings.json` (global or project-level, see table above):

```jsonc
{
  // Step 1: Register the marketplace source
  "extraKnownMarketplaces": {
    "Jerry0022": {
      "source": {
        "source": "github",
        "repo": "Jerry0022/dotclaude-dev-ops"
      }
    }
  },
  // Step 2: Enable the plugin
  "enabledPlugins": {
    "dotclaude-dev-ops@Jerry0022": true
  },
  // Step 3: Register the hooks
  // Claude Code does NOT auto-register hooks from plugin manifests.
  // Without this section, skills and agents work but hooks won't fire.
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
          { "type": "command", "command": "node hooks/stop/stop.ship.guard.js" }
        ]
      }
    ]
  }
}
```

Merge these keys into your existing `settings.json` — do not overwrite the entire file.

> **Important:** Step 3 (hooks) is required. Claude Code's plugin system loads skills and agents automatically, but hooks must be explicitly registered in `settings.json`. Without the `hooks` block, the plugin's automated guards (token limits, push safety, git sync) will not fire.

After saving, restart Claude Code or start a new session. The plugin's hooks, skills, and agents become available immediately.

### Local development

```bash
claude --plugin-dir /path/to/dotclaude-dev-ops
```

---

### Ask Claude to install it

Tell Claude in chat:

> "Install the dotclaude-dev-ops plugin from Jerry0022 globally, including hooks."

or for a specific project:

> "Install the dotclaude-dev-ops plugin from Jerry0022 for this project, including hooks."

Claude will edit the appropriate `settings.json` for you. Make sure to mention **"including hooks"** — otherwise Claude may only add the marketplace and plugin keys without registering the hooks.

---

### Verifying installation

After installation, you should see:
- **Skills** available: `/ship`, `/commit`, `/debug`, `/deep-research`, `/explain`, `/new-issue`, `/project-setup`, `/readme`, `/refresh-usage`
- **Hooks firing automatically** — e.g., `pre.tokens.guard` blocking expensive operations, `ss.tokens.scan` running at session start

If skills work but hooks don't fire, the `hooks` block is missing from your `settings.json`. See Step 3 above.

## Updates

### Auto-update via hook

The `ss.plugin.update` hook runs at every session start:

1. Checks GitHub for the latest release (~200ms, one API call)
2. If a newer version exists, downloads and installs automatically
3. Reports: `Plugin v0.1.0 → v0.2.0 aktualisiert`
4. If GitHub is unreachable, continues silently with the current version

**Requirement:** `gh` CLI must be authenticated (`gh auth login`).

### Manual update

Update `settings.json` with the new version reference, or remove and re-add the plugin.

The plugin uses semantic versioning. Breaking changes only in major versions.

## What it does

### Hooks (automatic, no user action needed)

| Event | Hook | What it does |
|---|---|---|
| SessionStart | `ss.tokens.scan` | Scan project for expensive files |
| SessionStart | `ss.tasks.register` | Auto-register scheduled tasks |
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
