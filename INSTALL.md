# Installation

## Add the plugin

In Claude Code (Desktop or CLI), add the marketplace and enable the plugin:

1. Open **Settings** → **Plugins** → **Marketplaces**
2. Add marketplace: `Jerry0022/dotclaude-dev-ops`
3. Enable the plugin `dotclaude-dev-ops`

Or via CLI:

```bash
claude plugin add dotclaude-dev-ops@Jerry0022
```

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

1. Open **Settings** → **Plugins** → **Marketplaces**
2. Add marketplace: `openai/codex-plugin-cc`
3. Enable the plugin `codex-plugin-cc`

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

## Uninstall

```bash
claude plugin remove dotclaude-dev-ops@Jerry0022
```

Or remove manually via **Settings** → **Plugins**.
