# dotclaude

**Version: 0.54.0**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

Complete DevOps automation plugin for Claude Code. Hooks, skills, agents, and templates that make shipping faster, safer, and smarter.

> ⚠ **AI runs commands on your machine.** Hooks, skills, and agents execute shell commands, edit files, push to remotes, and launch apps autonomously. Built-in safeguards reduce risk but do not replace your review.
>
> Work in a versioned tree. Keep backups. Read what Claude proposes before approving. **Use at your own risk** — MIT license disclaims all warranty.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Updates](#updates)
- [What it does](#what-it-does)
- [Customization](#customization)
- [Integrations](#integrations)
- [Supported Stacks](#supported-stacks)
- [Project Structure](#project-structure)
- [Token Overhead](#token-overhead)
- [Completion Cards](#completion-cards)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Features

- **13 Hooks** — automated guards and triggers across the full session lifecycle
- **15 Skills** — devops-ship, devops-commit, devops-flow, devops-deep-research, devops-new-issue, devops-project-setup, devops-readme, devops-refresh-usage, devops-extend-skill, devops-repo-health, devops-claude-md-lint, devops-concept, devops-agents, devops-self-update, devops-autonomous
- **10 Agents** — AI, Core, Designer, Feature, Frontend, Gamer, PO, QA, Research, Windows
- **Completion Flow** — mandatory card after every task (8 variants), visual verification, ship recommendation
- **Ship Enforcement** — intent detection, PR command blocking, automatic /devops-ship skill routing
- **3-Layer Extension Model** — customize any skill or agent per-project without forking

## Installation

Add the plugin via CLI (recommended):

```bash
claude plugin add devops@Jerry0022
```

> **Desktop App:** The marketplace UI shows the marketplace tab but may not list plugins for installation. Use the CLI command above, or see [`INSTALL.md`](INSTALL.md) for manual registration steps.

Start a new session for hooks to take effect. See [`INSTALL.md`](INSTALL.md) for details, extensions, and uninstall.

## Updates

```bash
claude plugin update devops@Jerry0022
```

Or enable auto-update via **Settings** → **Plugins** → **Marketplaces**. Semantic versioning — breaking changes only in major versions.

## What it does

### Hooks (automatic, no user action needed)

13 hooks fire automatically across the session lifecycle — no user action needed.

<details>
<summary><strong>By session lifecycle</strong> — when does it fire?</summary>

```
SessionStart  ──>  PreToolUse  ──>  PostToolUse  ──>  UserPromptSubmit  ──>  Stop
```

#### SessionStart — runs once when a session begins

- `ss.plugin.update` — Check for plugin updates
- `ss.mcp.deps` — Auto-install MCP server dependencies
- `ss.tokens.scan` — Scan project for expensive files
- `ss.git.check` — Check for uncommitted/unpushed changes

#### PreToolUse — runs before each tool call

- `pre.tokens.guard` — Block operations exceeding token budget

#### PostToolUse — runs after each tool call

- `post.flow.completion` — Track code edits for completion flow
- `post.flow.debug` — Recommend /devops-flow after repeated failures

#### UserPromptSubmit — runs when the user sends a message

- `prompt.git.sync` — Periodic pull/merge main (every 15 min)
- `prompt.issue.detect` — Track GitHub issues automatically
- `prompt.ship.detect` — Detect ship intent, enforce /devops-ship skill
- `prompt.flow.selfcalibration` — Register self-calibration cron (once per session)
- `prompt.flow.appstart` — Detect app start intent, enforce completion card

#### Stop — runs when Claude finishes responding

- `stop.flow.guard` — Enforce completion flow before response ends

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

- `prompt.ship.detect` — Detect ship intent, enforce /devops-ship skill *(UserPromptSubmit)*

#### flow — track progress toward completion

- `post.flow.completion` — Track code edits for completion flow *(PostToolUse)*
- `post.flow.debug` — Recommend /devops-flow after repeated failures *(PostToolUse)*
- `prompt.flow.appstart` — Detect app start intent, enforce completion card *(UserPromptSubmit)*

#### flow — self-calibration

- `prompt.flow.selfcalibration` — Register self-calibration cron, once per session *(UserPromptSubmit)*
- `stop.flow.guard` — Enforce completion flow before response ends *(Stop)*

#### plugin — updates and dependencies

- `ss.plugin.update` — Check for plugin updates *(SessionStart)*
- `ss.mcp.deps` — Auto-install MCP server dependencies *(SessionStart)*

#### issues — automatic issue tracking

- `prompt.issue.detect` — Track GitHub issues automatically *(UserPromptSubmit)*

</details>

### Skills (invoked explicitly or by hooks)

| Skill | Invocation | Purpose |
|---|---|---|
| `/devops-ship` | Explicit + Hook | Full shipping pipeline: build, version, PR, merge, cleanup |
| `/devops-commit` | Explicit | Conventional commits with smart staging |
| `/devops-flow` (alias: `/debug`) | Explicit + Hook | Root-cause analysis, diagnostics, and fix cycle |
| `/devops-deep-research` | Explicit | Multi-angle research with structured output |
| `/devops-new-issue` | Explicit | GitHub issue creation with labels and milestones |
| `/devops-project-setup` | Explicit | Repo hygiene audit and initialization |
| `/devops-readme` | Explicit | Modern README generation |
| `/devops-refresh-usage` | Explicit + Hook | Token usage tracking (CLI + CDP) |
| `/devops-extend-skill` | Explicit | Scaffold or adapt project-level skill extensions |
| `/devops-repo-health` | Explicit | Repository branch hygiene analysis and cleanup |
| `/devops-self-update` | Explicit | Update the plugin to the latest version from GitHub |
| `/devops-claude-md-lint` | Explicit | Audit CLAUDE.md files for size, structure, and token efficiency |
| `/devops-concept` | Explicit | Interactive HTML page for analysis, plans, concepts, and prototypes |
| `/devops-agents` | Explicit | Evaluate agents and orchestrate parallel execution |
| `/devops-autonomous` | Explicit | Fully autonomous agent orchestration while user is AFK |

### Agents (spawned for parallel work)

| Agent | Role |
|---|---|
| **ai** | AI/ML integration |
| **core** | Business logic and APIs |
| **designer** | UX/UI design, tokens, and specs |
| **feature** | Orchestrate feature implementation |
| **frontend** | UI components and styling |
| **gamer** | Player perspective and UX |
| **po** | Requirements and validation |
| **qa** | Test, verify, screenshot |
| **research** | Deep-dive investigations |
| **windows** | Platform-specific features |

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

**Example** — extending `/devops-ship` with project-specific quality gates and deploy targets:

```
your-project/.claude/skills/devops-ship/
├── SKILL.md        ← "Before PR: run ng build --prod"
└── reference.md    ← "Deploy via SSH to 192.168.178.32"
```

Run `/devops-extend-skill` to interactively scaffold an extension for any plugin skill.
It detects existing extensions and lets you adapt them.

For the full extension guide with examples per skill, see `deep-knowledge/skill-extension-guide.md`.

## Integrations

### Codex (optional)

Install [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) alongside
this plugin for AI-powered code review and task delegation via OpenAI Codex.
Both plugins coexist as independent skill providers — no configuration needed.

Combined workflows: `/codex:rescue` for pre-ship code review, parallel investigation
as alternative to `/devops-deep-research`, and QA-integrated review for complex changes.

See [INSTALL.md](INSTALL.md#optional-codex-integration) for setup instructions.

## Supported Stacks

This plugin is built and actively tested against a specific stack. Outside that stack, hooks and skills may work, degrade gracefully, or not run at all — anything not listed as **supported** is best-effort.

| Area | Supported | Behavior outside |
|---|---|---|
| **OS** | Windows, macOS, Linux | Other platforms: AnythingLLM lifecycle reports `unsupported-platform`; core git / skill flows still run via Node + git |
| **Shell** | bash (Git-Bash on Windows), zsh | PowerShell / cmd are untested — use Git-Bash or WSL on Windows |
| **Git hosting** | GitHub (via `gh` CLI) | GitLab / Gitea / Bitbucket / self-hosted: issue tracking, PR creation, and ship release will fail. Local / push-only flows still work |
| **Default branch** | Auto-detected from `origin/HEAD` (`main`, `master`, or any other name) | Detached HEAD or missing `origin/HEAD`: falls back to `main` |
| **Build system** | `npm` — auto-detects `build`, `lint`, `test` scripts in `package.json` | No `package.json`: build / lint / test steps are **silently skipped**. pnpm, yarn, pytest, cargo, go test, maven, gradle etc. are **not invoked** |
| **Local LLM** | AnythingLLM Desktop (HTTP API) | Feature degrades gracefully — `local_generate` becomes unavailable, all main flows continue normally |
| **Node runtime** | Node.js 20+ | Older Node: MCP server and hooks may fail to start |

If your stack differs, extend the plugin per-project via the 3-layer extension model — see [Customization](#customization).

## Project Structure

```
devops/
├── .claude-plugin/plugin.json     ← Plugin manifest
├── CONVENTIONS.md                 ← Naming, versioning, extension rules
├── hooks/                         ← 13 hook scripts (JS)
├── skills/                        ← 16 skill definitions (SKILL.md)
├── agents/                        ← 10 agent definitions
├── deep-knowledge/                ← Cross-cutting reference docs
├── templates/                     ← Output format templates
└── scripts/                       ← Utility scripts (build-id, usage)
```

## Token Overhead

This plugin runs hooks, injects guard prompts, and periodically self-calibrates. That costs tokens. Here's what you're signing up for — and what you get back.

### Weekly plugin overhead (estimated)

| Source | Tokens/week | Notes |
|---|---|---|
| Startup hooks (4x per session) | ~8K | Update check, git check, token scan, MCP deps |
| Prompt guards (per message) | ~150K–250K | Ship detection, issue tracking, git sync — most exit silently |
| Tool guards (per tool call) | ~100K–200K | Token budget + ship enforcement — early-exit when clean |
| Self-calibration (every 10 min) | ~200K–400K | Deep-knowledge rotation, skill internalization |
| Skill invocations (~15–25/week) | ~15K–30K | Only when you call /devops-ship, /devops-commit, etc. |
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
| Forgetting to bump the version | /devops-ship handles version, PR, merge, cleanup |
| "Why is my context window gone?" | Token guard kills expensive reads before they land |
| Debugging the same error 4 times | /devops-flow kicks in after the second failure |
| Writing commit messages by hand | Conventional commits, auto-staged, one command |

**Net calculation:** ~0.7M tokens/week buys you roughly 2–4 hours of not fighting git, not forgetting steps, and not explaining to your future self why the build broke. Per hour saved, that's about 200K tokens — or roughly the cost of Claude reading this README seventeen times.

**Token guard payoff:** The token guard blocks any single operation above 2% of your session window (~20K tokens). In a typical session, Claude attempts 5–15 broad searches or large-file reads that would each burn 20–80K tokens — that's 100–400K tokens/session evaporating into context you never asked for. Across ~10 sessions/week, the guard saves roughly **1–4M tokens/week** in prevented waste. The plugin's own overhead (~0.7M tokens/week for hooks, startup checks, and skill prompts) pays for itself 1.5–6x over just by keeping Claude from reading files it doesn't need.

Your mileage may vary. Your sanity will not.

## Completion Cards

Every task ends with a completion card — a structured signal showing what happened, the repo state, and what comes next. The card is always the last thing in the response.

**ship-successful** — after a successful PR merge:

````
---

## ✨✨✨ Filter dialog moved to settings ✨✨✨

**Changes**
* Settings → Filter tab as new section with drag & drop
* Dialog → FilterDialog removed, route redirected to Settings
* Tests → 3 unit tests added for new settings section

**Tests**
* Build → npm run build successful
* Unit → 47/47 passed, 3 new tests
* Preview → Filter tab rendered correctly, drag & drop functional

✅ merged → origin/main · PR #42 "Filter dialog to settings" · a3f9b21 · feat/filter-settings

```
5h  ━━━━━╏────────   33% +2%   · 3h 12m left
Wk  ━━━─╏─────────   18% +2%   · 5d 3h left
```

---

📌 0.8.2 → 0.8.3 (patch) · `a3f9b21`

## 🚀 SHIPPED. merged → origin/main — All DONE

---
````

<details>
<summary><strong>See all other variants</strong> — ready, ship-blocked, test, test-minimal, analysis, aborted, fallback, ship-successful (direct push)</summary>

### test — code edits + app running, user must verify

````
---

## ✨✨✨ Live search in contact book ✨✨✨

**Changes**
* ContactBook → Debounced live search with 300ms delay
* API → New /contacts/search endpoint with fuzzy match
* UI → Search field with clear button and loading spinner

**Tests**
* Build → successful
* Unit → 38/38 passed

🟢 not merged · no PR · not pushed · e82a0f7 · feat/contact-search · app running

**Please test**
1. Open contact book, type "Mue" in search field
2. Verify: results filter after ~300ms, spinner visible
3. Click clear button, verify list resets

```
5h  ━━━━━━━╏──────   50% +3%   · 2h 30m left
Wk  ━━━━─╏────────   27% +3%   · 4d 16h left
```

---

📌 `e82a0f7`

## 🧪 DONE — SHIP after your TEST?

---
````

### ready — code complete, awaiting ship decision

````
---

## ✨✨✨ Dark mode for dashboard implemented ✨✨✨

**Changes**
* Theme → Dark mode palette as CSS custom properties
* Dashboard → All panels switched to theme variables
* Settings → Dark mode toggle with localStorage persistence

**Tests**
* Build → successful
* Unit → 52/52 passed

🔀 not merged · no PR · not pushed · c91d3e8 · feat/dark-mode

```
5h  ━━━━━━━━╏─────   58% +4%   · 2h 5m left
Wk  ━━━─╏─────────   22% +4%   · 5d 1h left
```

---

📌 `c91d3e8`

## 📦 READY — SHIP or CHANGE?

---
````

### ship-blocked — ship pipeline failed

````
---

## ✨✨✨ API rate limiting added ✨✨✨

**Changes**
* Middleware → RateLimiter with token bucket algorithm
* Config → Rate limits configurable per endpoint
* Tests → Integration tests for throttling behavior

**Tests**
* Build → successful
* Unit → 3/5 FAILED — testBurstLimit and testConcurrentRequests timeout

🔀 not merged · no PR · not pushed · d44f1a2 · feat/rate-limiting

```
5h  ━━━━━━╏───────   42% +3%   · 2h 48m left
Wk  ━━━─╏─────────   24% +3%   · 4d 19h left
```

---

📌 `d44f1a2`

## ⛔ BLOCKED. 2 tests failed — FIX or SKIP?

---
````

### test — code edits + app not started

````
---

## ✨✨✨ Push notifications for mobile ✨✨✨

**Changes**
* Mobile → Firebase Cloud Messaging integration
* Backend → Notification service with device token management
* Settings → Push notification opt-in/opt-out toggle

**Tests**
* Build → successful
* Unit → 29/29 passed

🟡 not merged · no PR · not pushed · f1b3d99 · feat/push-notifications · app not started

**Please test**
1. Start app on phone, grant push permission
2. Send a test message from another device
3. Verify: push appears, tap opens correct view

```
5h  ━━━━━━━━━╏────   67% +5%   · 1h 40m left
Wk  ━━━━─╏────────   30% +5%   · 4d 9h left
```

---

📌 `f1b3d99`

## 🧪 DONE — SHIP after your TEST?

---
````

### test-minimal — app freshly started via user prompt

````
---

## ✨✨✨ Dev server started ✨✨✨

📌 `a3f9b21`

## ▶️ STARTED. Website opens in Edge — HAVE FUN

---
````

### analysis — read-only outcome (audit, plan, review)

````
---

## ✨✨✨ Hook lifecycle analyzed ✨✨✨

**Changes**
* Analysis → PostToolUse hooks fire only on Edit/Write, not Read
* Analysis → Session state shared via temp files, not env vars
* Analysis → prompt.ship.detect recognizes "ja"/"go" as ship intent

➖ No changes to repo

```
5h  ━━━━╏─────────   25% +2%   · 3h 45m left
Wk  ━━━─╏─────────   19% +2%   · 5d 6h left
```

---

📌 `a3f9b21`

## 📋 DONE — READ through

---
````

### aborted — task infeasible or rate-limited

````
---

## ✨✨✨ WebSocket migration aborted ✨✨✨

**Changes**
* Analysis → existing REST polling architecture incompatible with WS
* Spike → prototype shows migration requires new session management

🔀 not merged · no PR · not pushed · abc1234 · spike/websocket

```
5h  ━━━━━━━━━━━╏──   75% +6%   · 1h 15m left
Wk  ━━━━━─╏───────   35% +6%   · 4d 2h left
```

---

📌 `abc1234`

## 🚫 ABORTED. Architecture incompatibility — What should I TRY?

---
````

### fallback — miscellaneous / default

````
---

## ✨✨✨ Configuration verified ✨✨✨

**Changes**
* .editorconfig → settings match team standard
* .gitattributes → LF normalization correctly configured

➖ No changes to repo

```
5h  ━━╏───────────   15% +1%   · 4h 10m left
Wk  ━━──╏─────────   16% +1%   · 5d 0h left
```

---

📌 `a3f9b21`

## 🔧 DONE — Anything ELSE?

---
````

### ship-successful (direct push, no version bump)

````
---

## ✨✨✨ Typo in error handler fixed ✨✨✨

**Changes**
* ErrorHandler → "Unerwareter" corrected to "Unerwarteter"

✅ merged → origin/main · no PR · b7e2c44

```
5h  ━╇────────────   12% +1%   · 4h 31m left
Wk  ━━──╏─────────   15% +1%   · 4d 22h left
```

---

📌 `b7e2c44`

## 🚀 SHIPPED. merged → origin/main — All DONE

---
````

</details>

8 variants total. The card always fires — see [completion-card.md](plugins/devops/templates/completion-card.md) for the full template spec.

## Troubleshooting

### Plugin update not showing

Claude Code caches plugin marketplace data globally. If `claude plugin update` reports no update available despite a new version being published, clear the global marketplace cache:

```bash
# Windows (Git Bash / WSL)
rm -rf ~/.claude/plugins/cache/dotclaude
rm -rf ~/.claude/plugins/marketplaces/dotclaude
rm -f ~/.claude/plugins/install-counts-cache.json

# macOS / Linux
rm -rf ~/.claude/plugins/cache/dotclaude
rm -rf ~/.claude/plugins/marketplaces/dotclaude
rm -f ~/.claude/plugins/install-counts-cache.json
```

Then run `claude plugin update devops@Jerry0022` again. Start a new session for changes to take effect.

## License

MIT
