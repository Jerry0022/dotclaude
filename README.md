# dotclaude-dev-ops

**Version: 0.27.0**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

Complete DevOps automation plugin for Claude Code. Hooks, skills, agents, and templates that make shipping faster, safer, and smarter.

## Features

- **12 Hooks** — automated guards and triggers across the full session lifecycle
- **10 Skills** — ship, commit, flow, research, explain, issues, project setup, readme, usage tracking, extend-skill
- **10 Agents** — AI, Core, Designer, Feature, Frontend, Gamer, PO, QA, Research, Windows
- **Completion Flow** — mandatory card after every task (8 variants), visual verification, ship recommendation
- **Ship Enforcement** — intent detection, PR command blocking, automatic /ship skill routing
- **3-Layer Extension Model** — customize any skill or agent per-project without forking

## Installation

Add the plugin via CLI (recommended):

```bash
claude plugin add dotclaude-dev-ops@Jerry0022
```

> **Desktop App:** The marketplace UI shows the marketplace tab but may not list plugins for installation. Use the CLI command above, or see [`INSTALL.md`](INSTALL.md) for manual registration steps.

Start a new session for hooks to take effect. See [`INSTALL.md`](INSTALL.md) for details, extensions, and uninstall.

## Updates

```bash
claude plugin update dotclaude-dev-ops@Jerry0022
```

Or enable auto-update via **Settings** → **Plugins** → **Marketplaces**. Semantic versioning — breaking changes only in major versions.

## What it does

### Hooks (automatic, no user action needed)

12 hooks fire automatically across the session lifecycle — no user action needed.

<details>
<summary><strong>By session lifecycle</strong> — when does it fire?</summary>

```
SessionStart  ──>  PreToolUse  ──>  PostToolUse  ──>  UserPromptSubmit  ──>  Stop
```

#### SessionStart — runs once when a session begins

- `ss.tokens.scan` — Scan project for expensive files
- `ss.git.check` — Check for uncommitted/unpushed changes
- `ss.mcp.deps` — Auto-install MCP server dependencies
- `ss.flow.selfcalibration` — Register self-calibration cron (once per session)

#### PreToolUse — runs before each tool call

- `pre.tokens.guard` — Block operations exceeding token budget

#### PostToolUse — runs after each tool call

- `post.flow.completion` — Track code edits for completion flow
- `post.flow.debug` — Recommend /flow after repeated failures

#### UserPromptSubmit — runs when the user sends a message

- `prompt.git.sync` — Periodic pull/merge main (every 15 min)
- `prompt.issue.detect` — Track GitHub issues automatically
- `prompt.ship.detect` — Detect ship intent, enforce /ship skill
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

- `prompt.ship.detect` — Detect ship intent, enforce /ship skill *(UserPromptSubmit)*

#### flow — track progress toward completion

- `post.flow.completion` — Track code edits for completion flow *(PostToolUse)*
- `post.flow.debug` — Recommend /flow after repeated failures *(PostToolUse)*
- `prompt.flow.appstart` — Detect app start intent, enforce completion card *(UserPromptSubmit)*

#### flow — self-calibration

- `ss.flow.selfcalibration` — Register self-calibration cron, once per session *(SessionStart)*
- `stop.flow.guard` — Enforce completion flow before response ends *(Stop)*

#### mcp — dependency management

- `ss.mcp.deps` — Auto-install MCP server dependencies *(SessionStart)*

#### issues — automatic issue tracking

- `prompt.issue.detect` — Track GitHub issues automatically *(UserPromptSubmit)*

</details>

### Skills (invoked explicitly or by hooks)

| Skill | Invocation | Purpose |
|---|---|---|
| `/ship` | Explicit + Hook | Full shipping pipeline: build, version, PR, merge, cleanup |
| `/commit` | Explicit | Conventional commits with smart staging |
| `/flow` (alias: `/debug`) | Explicit + Hook | Root-cause analysis, diagnostics, and fix cycle |
| `/deep-research` | Explicit | Multi-angle research with structured output |
| `/explain` | Explicit | Code explanation with diagrams |
| `/new-issue` | Explicit | GitHub issue creation with labels and milestones |
| `/project-setup` | Explicit | Repo hygiene audit and initialization |
| `/readme` | Explicit | Modern README generation |
| `/refresh-usage` | Explicit + Hook | Token usage tracking (CLI + CDP) |
| `/extend-skill` | Explicit | Scaffold or adapt project-level skill extensions |

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

**Example** — extending `/ship` with project-specific quality gates and deploy targets:

```
your-project/.claude/skills/ship/
├── SKILL.md        ← "Before PR: run ng build --prod"
└── reference.md    ← "Deploy via SSH to 192.168.178.32"
```

Run `/extend-skill` to interactively scaffold an extension for any plugin skill.
It detects existing extensions and lets you adapt them.

For the full extension guide with examples per skill, see `deep-knowledge/skill-extension-guide.md`.

## Integrations

### Codex (optional)

Install [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) alongside
this plugin for AI-powered code review and task delegation via OpenAI Codex.
Both plugins coexist as independent skill providers — no configuration needed.

Combined workflows: `/codex:review` before `/ship`, `/codex:rescue` as
alternative to `/deep-research`, `/codex:adversarial-review` alongside QA.

See [INSTALL.md](INSTALL.md#optional-codex-integration) for setup instructions.

## Project Structure

```
dotclaude-dev-ops/
├── .claude-plugin/plugin.json     ← Plugin manifest
├── CONVENTIONS.md                 ← Naming, versioning, extension rules
├── hooks/                         ← 12 hook scripts (JS)
├── skills/                        ← 10 skill definitions (SKILL.md)
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

## Completion Cards

Every task ends with a completion card — a structured signal showing what happened, the repo state, and what comes next. The card is always the last thing in the response.

**Shipped example** — after a successful PR merge:

```
---

5h  ▓▓▓▓░░░░░░░░   33% (+2% ! )  · Reset 3h 12m
        ↑

Wk  ▓▓░░░░░░░░░░   18% (+2% ! )  · Reset 5d 3h
             ↑

## ✨✨✨ Filter dialog moved to settings · a3f9b21 ✨✨✨

**Changes**
* Settings → Filter tab as new section with drag & drop
* Dialog → FilterDialog removed, route redirected to Settings
* Tests → 3 unit tests added for new settings section

**Tests**
* Build: npm run build successful
* Unit: 47/47 passed, 3 new tests
* Preview: Filter tab rendered correctly, drag & drop functional

✅ feat/filter-settings · a3f9b21 · pushed · PR #42 "Filter dialog to settings" · merged → remote/main

## 🚀 SHIPPED. v0.8.2 → v0.8.3 (patch) — RELAX, all done

---
```

**Test example** — app running, user must verify:

```
---

5h  ▓▓▓▓▓▓░░░░░░   50% (+3% ! )  · Reset 2h 30m
         ↑

Wk  ▓▓▓░░░░░░░░░   27% (+3% ! )  · Reset 4d 16h
              ↑

## ✨✨✨ Live search in contact book · e82a0f7 ✨✨✨

**Changes**
* ContactBook → Debounced live search with 300ms delay
* API → New /contacts/search endpoint with fuzzy match
* UI → Search field with clear button and loading spinner

**Tests**
* Build: successful
* Unit: 38/38 passed

🟢 feat/contact-search · e82a0f7 · not pushed · no PR · not merged · app running

**Please test**
1. Open contact book, type "Mue" in search field
2. Verify: results filter after ~300ms, spinner visible
3. Click clear button, verify list resets

## 🧪 DONE. Live search ready — SHIP after your TEST?

---
```

<details>
<summary><strong>All 8 variants</strong></summary>

### shipped (direct push, no version bump)

```
---

5h  ▓▓░░░░░░░░░░   12% (+1%   )  · Reset 4h 31m
  ↑

Wk  ▓▓░░░░░░░░░░   15% (+1%   )  · Reset 4d 22h
          ↑

## ✨✨✨ Typo in error handler fixed · b7e2c44 ✨✨✨

**Changes**
* ErrorHandler → "Unerwareter" corrected to "Unerwarteter"

✅ main · b7e2c44 · pushed · no PR · remote/main

## 🚀 SHIPPED. v0.8.3 — RELAX, all done

---
```

### ready

```
---

5h  ▓▓▓▓▓▓▓░░░░░   58% (+4% ! )  · Reset 2h 5m
          ↑

Wk  ▓▓▓░░░░░░░░░   22% (+4% ! )  · Reset 5d 1h
             ↑

## ✨✨✨ Dark mode for dashboard implemented · c91d3e8 ✨✨✨

**Changes**
* Theme → Dark mode palette as CSS custom properties
* Dashboard → All panels switched to theme variables
* Settings → Dark mode toggle with localStorage persistence

**Tests**
* Build: successful
* Unit: 52/52 passed

🔀 feat/dark-mode · c91d3e8 · not pushed · no PR · not merged

## 📦 READY. Code complete — SHIP or CHANGE?

---
```

### blocked

```
---

5h  ▓▓▓▓▓░░░░░░░   42% (+3% ! )  · Reset 2h 48m
        ↑

Wk  ▓▓▓░░░░░░░░░   24% (+3% ! )  · Reset 4d 19h
            ↑

## ✨✨✨ API rate limiting added · d44f1a2 ✨✨✨

**Changes**
* Middleware → RateLimiter with token bucket algorithm
* Config → Rate limits configurable per endpoint
* Tests → Integration tests for throttling behavior

**Tests**
* Build: successful
* Unit: 3/5 FAILED — testBurstLimit and testConcurrentRequests timeout

🔀 feat/rate-limiting · d44f1a2 · not pushed · no PR · not merged

## ⛔ BLOCKED. 2 tests failed — FIX or SKIP?

---
```

### test (app needs start)

```
---

5h  ▓▓▓▓▓▓▓▓░░░░   67% (+5% ! )  · Reset 1h 40m
       ↑

Wk  ▓▓▓▓░░░░░░░░   30% (+5% ! )  · Reset 4d 9h
             ↑

## ✨✨✨ Push notifications for mobile · f1b3d99 ✨✨✨

**Changes**
* Mobile → Firebase Cloud Messaging integration
* Backend → Notification service with device token management
* Settings → Push notification opt-in/opt-out toggle

**Tests**
* Build: successful
* Unit: 29/29 passed

🟡 feat/push-notifications · f1b3d99 · not pushed · no PR · not merged · app not started

**Please test**
1. Start app on phone, grant push permission
2. Send a test message from another device
3. Verify: push appears, tap opens correct view

## 🧪 DONE. Push notifications ready — SHIP after your TEST?

---
```

### minimal-start

```
---

## ✨✨✨ Dev server started · a3f9b21 ✨✨✨

## 🧪 STARTED. Website opens in Edge — HAVE FUN

---
```

### research

```
---

5h  ▓▓▓░░░░░░░░░   25% (+2% ! )  · Reset 3h 45m
       ↑

Wk  ▓▓░░░░░░░░░░   19% (+2% ! )  · Reset 5d 6h
              ↑

## ✨✨✨ Hook lifecycle analyzed · a3f9b21 ✨✨✨

**Changes**
* Analysis → PostToolUse hooks fire only on Edit/Write, not Read
* Analysis → Session state shared via temp files, not env vars
* Analysis → prompt.ship.detect recognizes "ja"/"go" as ship intent

➖ No changes to repo

## 📋 DONE. Hook lifecycle documented — READ through

---
```

### aborted

```
---

5h  ▓▓▓▓▓▓▓▓▓░░░   75% (+6% !!)  · Reset 1h 15m
      ↑

Wk  ▓▓▓▓░░░░░░░░   35% (+6% !!)  · Reset 4d 2h  ⚠ Sonnet or new session
            ↑

## ✨✨✨ WebSocket migration aborted · a3f9b21 ✨✨✨

**Changes**
* Analysis → existing REST polling architecture incompatible with WS
* Spike → prototype shows migration requires new session management

🔀 spike/websocket · abc1234 · not pushed · no PR · not merged

## 🚫 ABORTED. Architecture incompatibility — What should I TRY?

---
```

### fallback

```
---

5h  ▓▓░░░░░░░░░░   15% (+1%   )  · Reset 4h 10m
    ↑

Wk  ▓▓░░░░░░░░░░   16% (+1%   )  · Reset 5d 0h
           ↑

## ✨✨✨ Configuration verified · a3f9b21 ✨✨✨

**Changes**
* .editorconfig → settings match team standard
* .gitattributes → LF normalization correctly configured

➖ No changes to repo

## 📋 DONE — Anything ELSE?

---
```

</details>

8 variants total. The card always fires — see [completion-card.md](templates/completion-card.md) for the full template spec.

## Troubleshooting

### Plugin update not showing

Claude Code caches plugin marketplace data globally. If `claude plugin update` reports no update available despite a new version being published, clear the global marketplace cache:

```bash
# Windows (Git Bash / WSL)
rm -rf ~/.claude/plugins/cache/dotclaude-dev-ops
rm -rf ~/.claude/plugins/marketplaces/dotclaude-dev-ops
rm -f ~/.claude/plugins/install-counts-cache.json

# macOS / Linux
rm -rf ~/.claude/plugins/cache/dotclaude-dev-ops
rm -rf ~/.claude/plugins/marketplaces/dotclaude-dev-ops
rm -f ~/.claude/plugins/install-counts-cache.json
```

Then run `claude plugin update dotclaude-dev-ops@Jerry0022` again. Start a new session for changes to take effect.

## License

MIT
