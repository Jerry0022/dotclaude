# dotclaude

**Version: 0.1.0**

Global [Claude Code](https://docs.anthropic.com/en/docs/claude-code) configuration — portable instructions, hooks, skills, and scripts.

## What's included

| Category | Files | Purpose |
|---|---|---|
| **Instructions** | `CLAUDE.md` | Global rules: autonomy, git hygiene, sprint workflow, token awareness, versioning, response style |
| **Skills** | `skills/*/SKILL.md` | commit, debug, deep-research, explain, youtube-transcript, ship-dotclaude |
| **Commands** | `commands/*.md` | refresh-usage (scrape live rate limits from claude.ai) |
| **Scripts** | `scripts/*.js` | startup-summary (SessionStart dashboard), precheck-cost (cost guard), check-dotclaude-sync (drift detection), scrape-usage (reference) |
| **Templates** | `templates/` | settings.template.json, config.template.json, plugins-manifest.json |
| **Plugins** | `plugins/blocklist.json` | Blocked plugin list |

## Quick start

### Fresh setup

```bash
git clone https://github.com/Jerry0022/dotclaude.git
cd dotclaude

# Unix / Git Bash
bash setup.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

The setup script:
1. Copies all tracked files to `~/.claude/`
2. Deploys `settings.json` from the template (backs up existing)
3. Installs Node dependencies for hook scripts
4. Stores the repo path for sync-check

### After setup

1. **Add MCP server permissions** to `~/.claude/settings.json` for your connected services (Google Calendar, Gmail, etc.). See `templates/plugins-manifest.json` for the permission patterns.
2. **Install plugins** if not already installed (see plugins-manifest.json for the list).
3. **Start a Claude Code session** — the startup hook will show the usage dashboard.

## Sync workflow

When global config files are modified during any project session, the **SessionStart hook** detects drift and suggests running `/ship-dotclaude`.

The `/ship-dotclaude` skill:
1. Compares `~/.claude/` files against this repo
2. Copies changed files back
3. Bumps the version
4. Commits and pushes

## File classification

### Tracked (portable, version-controlled)
- `CLAUDE.md`, skills, commands, scripts (`.js`), plugin blocklist
- Templates for machine-specific files

### Ignored (machine-specific, generated at runtime)
- `scripts/config.json` (regenerated on each startup with expensive-files list)
- `scripts/session-history.json`, `scripts/usage-live.json`
- `plugins/cache/`, `plugins/data/`, `plugins/installed_plugins.json`
- `projects/`, `session-env/`, `plans/`, `backups/`, `telemetry/`
- `node_modules/`

### Templated (require per-machine adaptation)
- `settings.json` — hooks use `$HOME` for portability; MCP server UUIDs are machine-specific
- `config.json` — default limits are templated; `expensiveFiles` is populated at runtime

## License

MIT
