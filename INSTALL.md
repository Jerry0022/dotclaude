# Installation

**Quickest way:** paste this one sentence into Claude Code:

```
Install the devops plugin by following https://github.com/Jerry0022/dotclaude/blob/main/INSTALL.md
```

## Instructions for Claude (agent install)

You are Claude, asked to install this plugin for the user. Do these steps in order, and tell the user each result in one short line.

1. **Prerequisites.** Run `git --version` and `node --version`. If git is missing or Node is older than 18.18, stop and tell the user what to install.
2. **Find out where you run.** Read the environment variable `CLAUDE_CODE_ENTRYPOINT`.
3. **Desktop App** (`claude-desktop`): Desktop plugins come from the user's claude.ai account. You cannot add them from a session, and a CLI install will not appear there. Walk the user through these clicks one step at a time, and wait for each confirmation:
   1. Sidebar → **Customize** → **+** next to *Personal Plugins*
   2. Add the marketplace `Jerry0022/dotclaude`. If that fails, retry once, then try `https://github.com/Jerry0022/dotclaude`.
   3. Install / enable **devops**.
4. **CLI / IDE** (any other value): run
   ```bash
   claude plugin marketplace add Jerry0022/dotclaude
   claude plugin install devops@dotclaude
   ```
   then check `claude plugin list` for `devops@dotclaude`.
5. **Last step:** ask the user to start a new session (Desktop: open a new session; CLI: quit and run `claude` again), because hooks and MCP servers only load at session start. Tell them to type `/do-ship` there; if it shows up in the slash menu, the plugin is active. Done.

## Add the plugin

Claude Code Desktop and the `claude` CLI keep **separate plugin stores**: Desktop
loads plugins from your claude.ai account, the CLI from `~/.claude/plugins/`. A
plugin installed through one does not appear in the other, so install it where
you work (or in both).

**Desktop App:**

1. Sidebar → **Customize** → **+** next to *Personal Plugins*
2. Add the marketplace `Jerry0022/dotclaude` (or `https://github.com/Jerry0022/dotclaude`)
3. Install / enable the plugin **devops**

**CLI (terminal):**

```bash
claude plugin marketplace add Jerry0022/dotclaude
claude plugin install devops@dotclaude
```

Or inside an interactive `claude` session: `/plugin marketplace add Jerry0022/dotclaude`,
then `/plugin install devops@dotclaude`.

Requires **git** and **Node.js 18.18+** (the plugin's MCP server runs on Node).

Start a new session for hooks to take effect. Skills are available immediately: type `/do-ship` (or just "ship it"), or say what you need — "funktioniert nicht" / "this is broken" reaches the debugging skill, "concept page" / "ein concept für …" the interactive concept page.

## Update

Updates are managed by the Claude Code marketplace:

```bash
claude plugin update devops@dotclaude
```

Or enable auto-update for the marketplace (Desktop: **Customize**; CLI: `/plugin` → **Marketplaces**).

Alternatively, ask Claude to run the built-in plugin-update skill (it is hidden from the slash menu — this phrase is its trigger):

```
devops update
```

## Project-specific extensions (optional)

Every skill and agent supports per-project customization. Create extension files in your project:

```
your-project/.claude/skills/{skill-name}/
├── SKILL.md        ← override or add steps
└── reference.md    ← project-specific context
```

Say "extend skill" (or "customize skill") to interactively scaffold an extension for a specific skill. The plugin keeps Claude and plugin runtime files out of git with one managed block in `.gitignore` (`# >>> claude (managed) >>>`); for a one-time repo setup (.gitignore for your stack, LICENSE) say "set up this project".

## Optional: Codex Integration

The devops plugin works standalone, but can be combined with
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
| `/codex:rescue` | Delegate investigation, review, or fix tasks to Codex |
| `/codex:setup` | Check Codex CLI readiness and configure review gate |

### How it works with devops

Both plugins coexist as independent skill providers in the same session.
No extra configuration needed — install both and all skills are available.

Typical combined workflows:

- **Ship with review:** `/codex:rescue` for pre-ship code review → `/do-ship`
- **Delegate investigation:** `/codex:rescue` for parallel research and investigation

### Troubleshooting

| Problem | Solution |
|---|---|
| `/codex:setup` not found | Plugin not installed — check **Settings** → **Plugins** |
| Authentication fails | Run `codex auth` in terminal to re-authenticate |
| Codex binary not found | `npm install -g @openai/codex` and restart session |

## Troubleshooting

### Desktop App: plugin not visible after a CLI install

The Desktop App does not read `~/.claude/plugins/`. A `claude plugin install` (also one Claude ran for you)
succeeds there but stays invisible in Desktop — add the marketplace via **Customize → Personal Plugins**
as described above.

### Desktop App: adding the marketplace fails

Retry once — a first attempt can fail while the marketplace is fetched. Also try the full URL
`https://github.com/Jerry0022/dotclaude`. In a Team/Enterprise organization, adding marketplaces may be
restricted to admins.

### Hooks not running

Start a new session. Hooks only activate on session start, not mid-session.

### Skills not found

Verify the plugin is enabled — Desktop: **Customize → Personal Plugins**; CLI: `claude plugin list` or `enabledPlugins` in `~/.claude/settings.json`.

## Uninstall

```bash
claude plugin uninstall devops@dotclaude
```

Desktop App: remove it under **Customize → Personal Plugins**.
