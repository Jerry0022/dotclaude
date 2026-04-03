# Installation

## Add the plugin

**CLI (recommended):**

```bash
claude plugin add dotclaude-dev-ops@Jerry0022
```

**Desktop App UI:**

1. Open **Settings** → **Plugins** → **Marketplaces**
2. Add marketplace: `Jerry0022/dotclaude-dev-ops`
3. Enable the plugin `dotclaude-dev-ops`

> **Note:** The Desktop App marketplace UI may not list third-party plugins for installation. If the plugin tab appears empty, use the CLI command above or see [Troubleshooting](#troubleshooting) below.

Start a new session for hooks to take effect. Skills (`/ship`, `/commit`, `/flow`, etc.) are available immediately.

## Update

Updates are managed by the Claude Code marketplace:

```bash
claude plugin update dotclaude-dev-ops@Jerry0022
```

Or enable auto-update via **Settings** → **Plugins** → **Marketplaces**.

## Project-specific extensions (optional)

Every skill and agent supports per-project customization. Create extension files in your project:

```
your-project/.claude/skills/{skill-name}/
├── SKILL.md        ← override or add steps
└── reference.md    ← project-specific context
```

Run `/project-setup` in any project to auto-scaffold extensions based on the project's build system, CI config, and conventions. Run `/extend-skill` to interactively scaffold an extension for a specific skill.

## Optional: Codex Integration

dotclaude-dev-ops works standalone, but can be combined with
[codex-plugin-cc](https://github.com/openai/codex-plugin-cc) for AI-powered
code review and task delegation via OpenAI Codex.

### Prerequisites

- **Node.js 18.18+**
- **ChatGPT subscription** (Free tier works) or an **OpenAI API key**

### Install Codex CLI

```bash
npm install -g @openai/codex
```

### Add the plugin

In Claude Code Desktop:

1. Click **Customize** (sidebar) → **+** next to *Personal Plugins*
2. Select **Browse Plugins**
3. Search for `codex` and install **codex-plugin-cc**

Then start a new session and run `/codex:setup` to configure authentication.

### Available Codex skills

| Skill | Purpose |
|---|---|
| `/codex:review` | Read-only code review against diffs |
| `/codex:adversarial-review` | Devil's advocate review — challenges design trade-offs |
| `/codex:rescue` | Delegate investigation or fix tasks to Codex |
| `/codex:status` | Monitor running Codex jobs |
| `/codex:result` | Retrieve completed job output |
| `/codex:cancel` | Cancel active Codex tasks |

### How it works with dotclaude-dev-ops

Both plugins coexist as independent skill providers in the same session.
No extra configuration needed — install both and all skills are available.

Typical combined workflows:

- **Ship with review:** `/codex:review` → check feedback → `/ship`
- **Delegate investigation:** `/codex:rescue` as alternative to `/deep-research`
- **Adversarial QA:** `/codex:adversarial-review` alongside the QA agent

### Troubleshooting

| Problem | Solution |
|---|---|
| `/codex:setup` not found | Plugin not installed — check **Settings** → **Plugins** |
| Authentication fails | Run `codex auth` in terminal to re-authenticate |
| Codex binary not found | `npm install -g @openai/codex` and restart session |

## Troubleshooting

### Desktop App: plugin not visible in marketplace

The Desktop App marketplace UI recognizes third-party marketplace tabs but may not list their plugins for one-click installation. The marketplace tab appears empty with "No plugins found".

**Fix — use CLI:**

```bash
claude plugin add dotclaude-dev-ops@Jerry0022
```

**Alternative — manual registration:**

If the CLI command is not available, register the plugin manually:

1. Add the marketplace (Settings → Plugins → Marketplaces → `Jerry0022/dotclaude-dev-ops`)
2. Copy the plugin files into the cache:
   ```bash
   mkdir -p ~/.claude/plugins/cache/dotclaude-dev-ops/dotclaude-dev-ops/0.24.0
   cp -r ~/.claude/plugins/marketplaces/dotclaude-dev-ops/plugins/dotclaude-dev-ops/* \
         ~/.claude/plugins/cache/dotclaude-dev-ops/dotclaude-dev-ops/0.24.0/
   cp -r ~/.claude/plugins/marketplaces/dotclaude-dev-ops/plugins/dotclaude-dev-ops/.claude-plugin \
         ~/.claude/plugins/cache/dotclaude-dev-ops/dotclaude-dev-ops/0.24.0/
   cp    ~/.claude/plugins/marketplaces/dotclaude-dev-ops/plugins/dotclaude-dev-ops/.mcp.json \
         ~/.claude/plugins/cache/dotclaude-dev-ops/dotclaude-dev-ops/0.24.0/
   ```
3. Add to `~/.claude/plugins/installed_plugins.json` → `plugins` object:
   ```json
   "dotclaude-dev-ops@dotclaude-dev-ops": [{
     "scope": "user",
     "installPath": "<home>/.claude/plugins/cache/dotclaude-dev-ops/dotclaude-dev-ops/0.24.0",
     "version": "0.24.0",
     "installedAt": "<now ISO>",
     "lastUpdated": "<now ISO>",
     "gitCommitSha": "<git rev-parse HEAD from marketplace clone>"
   }]
   ```
4. Add to `~/.claude/settings.json` → `enabledPlugins`:
   ```json
   "dotclaude-dev-ops@dotclaude-dev-ops": true
   ```
5. Restart the Desktop App.

### Hooks not running

Start a new session. Hooks only activate on session start, not mid-session.

### Skills not found

Verify the plugin is enabled: check `enabledPlugins` in `~/.claude/settings.json`.

## Uninstall

```bash
claude plugin remove dotclaude-dev-ops@Jerry0022
```

Or remove manually via **Settings** → **Plugins**.
