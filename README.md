# dotclaude-dev-ops

**Version: 0.10.0**

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

13 hooks fire automatically across the session lifecycle — no user action needed.

<details>
<summary><strong>By session lifecycle</strong> — when does it fire?</summary>

```
SessionStart  ──>  PreToolUse  ──>  PostToolUse  ──>  UserPromptSubmit  ──>  Stop
```

#### SessionStart — runs once when a session begins

- `ss.tokens.scan` — Scan project for expensive files
- `ss.git.check` — Check for uncommitted/unpushed changes
- `ss.tasks.register` — Auto-register scheduled tasks

#### PreToolUse — runs before each tool call

- `pre.tokens.guard` — Block operations exceeding token budget
- `pre.ship.guard` — Block manual PR commands + git push with dirty state

#### PostToolUse — runs after each tool call

- `post.flow.completion` — Track code edits for completion flow
- `post.flow.debug` — Recommend /flow after repeated failures

#### UserPromptSubmit — runs when the user sends a message

- `prompt.git.sync` — Periodic pull/merge main (every 15 min)
- `prompt.issue.detect` — Track GitHub issues automatically
- `prompt.ship.detect` — Detect ship intent, enforce /ship skill
- `prompt.flow.appstart` — Detect app start intent, enforce completion card

#### Stop — runs when the agent finishes

- `stop.ship.guard` — Warn about uncommitted changes

</details>

<details>
<summary><strong>By category</strong> — what does it guard?</summary>

#### tokens — prevent context window waste

- `ss.tokens.scan` — Scan project for expensive files *(SessionStart)*
- `pre.tokens.guard` — Block operations exceeding token budget *(PreToolUse)*

#### git — keep the working tree in sync

- `ss.git.check` — Check for uncommitted/unpushed changes *(SessionStart)*
- `prompt.git.sync` — Periodic pull/merge main, every 15 min *(UserPromptSubmit)*

#### ship — enforce the shipping pipeline

- `pre.ship.guard` — Block manual PR commands + git push with dirty state *(PreToolUse)*
- `prompt.ship.detect` — Detect ship intent, enforce /ship skill *(UserPromptSubmit)*
- `stop.ship.guard` — Warn about uncommitted changes *(Stop)*

#### flow — track progress toward completion

- `post.flow.completion` — Track code edits for completion flow *(PostToolUse)*
- `post.flow.debug` — Recommend /flow after repeated failures *(PostToolUse)*
- `prompt.flow.appstart` — Detect app start intent, enforce completion card *(UserPromptSubmit)*

#### tasks — manage scheduled automation

- `ss.tasks.register` — Auto-register scheduled tasks *(SessionStart)*

#### issues — automatic issue tracking

- `prompt.issue.detect` — Track GitHub issues automatically *(UserPromptSubmit)*

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
| `/extend-skill` | Scaffold or adapt project-level skill extensions |

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

To extend any plugin skill for your project, create a directory matching the
skill's name under `.claude/skills/` in your project:

```
your-project/.claude/skills/{skill-name}/
├── SKILL.md        ← override or add steps
└── reference.md    ← project-specific context
```

The plugin reads your extensions before executing and merges them. Your rules win on conflict.
Both files are optional — create only what you need.

**Example** — extending `/ship` with project-specific quality gates and deploy targets:

```
your-project/.claude/skills/ship/
├── SKILL.md        ← "Before PR: run ng build --prod"
└── reference.md    ← "Deploy via SSH to 192.168.178.32"
```

Run `/extend-skill` to interactively scaffold an extension for any plugin skill.
It detects existing extensions and lets you adapt them.

For the full extension guide with examples per skill, see `deep-knowledge/skill-extension-guide.md`.

## Project Structure

```
dotclaude-dev-ops/
├── .claude-plugin/plugin.json     ← Plugin manifest
├── CONVENTIONS.md                 ← Naming, versioning, extension rules
├── hooks/                         ← 13 hook scripts (JS)
├── skills/                        ← 10 skill definitions (SKILL.md)
├── agents/                        ← 9 agent templates (AGENT.md)
├── deep-knowledge/                ← Cross-cutting reference docs
├── templates/                     ← Output format templates
└── scripts/                       ← Utility scripts (build-id, usage)
```

## Token Overhead

This plugin runs hooks, injects guard prompts, and periodically self-calibrates. That costs tokens. Here's what you're signing up for — and what you get back.

### Weekly plugin overhead (estimated)

| Source | Tokens/week | Notes |
|---|---|---|
| Startup hooks (3x per session) | ~8K | Git check, token scan, task registration |
| Prompt guards (per message) | ~150K–250K | Ship detection, issue tracking, git sync — most exit silently |
| Tool guards (per tool call) | ~100K–200K | Token budget + ship enforcement — early-exit when clean |
| Self-calibration (every 30 min) | ~200K–400K | Deep-knowledge rotation, skill internalization |
| Skill invocations (~15–25/week) | ~15K–30K | Only when you call /ship, /commit, etc. |
| **Total** | **~500K–900K** | **~0.7M tokens/week on average** |

### What percentage of your plan is that?

Based on ~0.7M tokens/week plugin overhead:

| Plan | Model | Weekly budget (approx.) | Plugin overhead |
|---|---|---|---|
| Pro ($20) | Sonnet | ~10M | **~7%** |
| Pro ($20) | Opus | ~3M | **~23%** |
| Max 5x ($100) | Sonnet | ~55M | **~1.3%** |
| Max 5x ($100) | Opus | ~18M | **~3.9%** |
| Max 20x ($200) | Sonnet | ~225M | **~0.3%** |
| Max 20x ($200) | Opus | ~75M | **~0.9%** |

*Budgets are rough estimates and vary by usage pattern. Anthropic adjusts limits dynamically.*

### What you get back

| Without plugin | With plugin |
|---|---|
| "Wait, did I push that?" | Git state checked on every session start |
| `git push --force` to main at 2 AM | Blocked before it happens |
| Forgetting to bump the version | /ship handles version, PR, merge, cleanup |
| "Why is my context window gone?" | Token guard kills expensive reads before they land |
| Debugging the same error 4 times | /flow kicks in after the second failure |
| Writing commit messages by hand | Conventional commits, auto-staged, one command |

**Net calculation:** ~0.7M tokens/week buys you roughly 2–4 hours of not fighting git, not forgetting steps, and not explaining to your future self why the build broke. Per hour saved, that's about 200K tokens — or roughly the cost of Claude reading this README seventeen times.

**Token guard payoff:** The token guard blocks any single operation above 2% of your session window (~20K tokens). In a typical session, Claude attempts 5–15 broad searches or large-file reads that would each burn 20–80K tokens — that's 100–400K tokens/session evaporating into context you never asked for. Across ~10 sessions/week, the guard saves roughly **1–4M tokens/week** in prevented waste. The plugin's own overhead (~0.7M tokens/week for hooks, startup checks, and skill prompts) pays for itself 1.5–6x over just by keeping Claude from reading files it doesn't need.

Your mileage may vary. Your sanity will not.

## License

MIT
