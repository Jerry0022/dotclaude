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

## Uninstall

```bash
claude plugin remove dotclaude-dev-ops@Jerry0022
```

Or remove manually via **Settings** → **Plugins**.
