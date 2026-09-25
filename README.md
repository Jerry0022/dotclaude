# dotclaude

**Version: 0.204.2**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

Complete DevOps automation plugin for Claude Code. Hooks, skills, agents, and templates that make shipping faster, safer, and smarter.

> ⚠ **AI runs commands on your machine.** Hooks, skills, and agents execute shell commands, edit files, push to remotes, and launch apps autonomously. Built-in safeguards reduce risk but do not replace your review.
>
> Work in a versioned tree. Keep backups. Read what Claude proposes before approving. **Use at your own risk.**

**Token math — costs and payoff:**
- **Costs:** ~0.7M tokens/week — hooks, prompt guards, self-calibration
- **Plan share:** 1–4% on Max plans · up to ~23% on Pro + Opus
- **Saves (context):** ~1–4M tokens/week — token guard blocks expensive reads before they land
- **Saves (time):** 2–4 hours/week — auto git state, ship pipeline, root-cause debug
- **Net:** plugin pays itself back 1.5–6× via prevented context waste

<details>
<summary><strong>Detailed token math</strong> — weekly breakdown, plan %, what you get back</summary>

### Weekly plugin overhead (estimated)

| Source | Tokens/week | Notes |
|---|---|---|
| Startup hooks (4x per session) | ~8K | Update check, git check, token scan, MCP deps |
| Prompt guards (per message) | ~150K–250K | Ship detection, issue tracking, git sync — most exit silently |
| Tool guards (per tool call) | ~100K–200K | Token budget + ship enforcement — early-exit when clean |
| Self-calibration (every 10 min) | ~200K–400K | Deep-knowledge rotation, skill internalization |
| Skill invocations (~15–25/week) | ~15K–30K | Only when you call /do-ship, /auto-fix, etc. |
| **Total** | **~500K–900K** | **~0.7M tokens/week on average** |

### Percentage of your plan

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
| Forgetting to bump the version | /do-ship handles version, PR, merge, cleanup |
| "Why is my context window gone?" | Token guard kills expensive reads before they land |
| Debugging the same error 4 times | /auto-fix kicks in after the second failure |
| Writing commit messages by hand | Conventional commits enforced by shared conventions |

**Token guard payoff:** The token guard blocks any single operation above your plan's per-operation share of the ~200K context window — **5% (~10K tokens) on Pro, 8% (~16K) on Max 5×, 10% (~20K) on Max 20×**. In a typical session, Claude attempts 5–15 broad searches or large-file reads that would each burn 20–80K tokens — that's 100–400K tokens/session evaporating into context you never asked for. Across ~10 sessions/week, the guard saves roughly **1–4M tokens/week** in prevented waste. The plugin's own overhead (~0.7M tokens/week for hooks, startup checks, and skill prompts) pays for itself 1.5–6x over just by keeping Claude from reading files it doesn't need.

Your mileage may vary. Your sanity will not.

</details>

## Table of Contents

**Setup**
- [Installation](#installation)
- [Updates](#updates)
- [Supported Stacks](#supported-stacks)
- [Integrations](#integrations)
- [Customization](#customization)

**Use**
- [Features](#features)
- [What it does](#what-it-does)
- [Completion Cards](#completion-cards)

**Details**
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)

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

## Integrations

### Codex (optional)

Install [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) alongside
this plugin for AI-powered code review and task delegation via OpenAI Codex.
Both plugins coexist as independent skill providers — no configuration needed.

Combined workflows: `/codex:rescue` for pre-ship code review, parallel investigation
for research tasks, and QA-integrated review for complex changes.

See [INSTALL.md](INSTALL.md#optional-codex-integration) for setup instructions.

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

**Example** — extending `/do-ship` with project-specific quality gates and deploy targets:

```
your-project/.claude/skills/do-ship/
├── SKILL.md        ← "Before PR: run ng build --prod"
└── reference.md    ← "Deploy via SSH to 192.168.178.32"
```

Say "extend skill" (the hidden `auto-extend` skill) to interactively scaffold an extension for any plugin skill.
It detects existing extensions and lets you adapt them.

For the full extension guide with examples per skill, see `deep-knowledge/skill-extension-guide.md`.

### Quiet output style (recommended)

Claude narrates a lot — what it is reading, what it is about to do, a recap
at the end. None of that is needed with this plugin: decisions arrive as
`AskUserQuestion` dialogs, long analyses as `/auto-concept` pages, results as the
completion card. The rest is noise that pulls you out of your own work.

The fix is Claude Code's built-in **output style** — a personal setting, not
a plugin rule, so every consumer picks their own level of quiet. It sits in
the system prompt, so it does not fade over a long session the way a skill or
an injected instruction does.

1. Copy [`templates/output-style-quiet.md`](plugins/devops/templates/output-style-quiet.md)
   to `~/.claude/output-styles/quiet.md` (or `.claude/output-styles/` in a project)
2. Activate it with `/output-style Quiet`, or set `"outputStyle": "Quiet"` in
   `~/.claude/settings.json`
3. Start a new session

**Optional — let Claude do it.** Paste this into any Claude Code session
with the plugin installed; it copies the template, activates the style and
tells you to restart:

```text
Set up the Quiet output style: copy the newest
~/.claude/plugins/cache/dotclaude/devops/*/templates/output-style-quiet.md
to ~/.claude/output-styles/quiet.md (create the directory if needed), set
"outputStyle": "Quiet" in ~/.claude/settings.json, then tell me to start a
new session. Do not change anything else.
```

The style relays only what the plugin marks for you. Every user-facing hook
and tool block opens with `Show the user this … verbatim` — the completion
card, the workspace check, the update notice, the team changelog — and the
rest of the tool output (instructions addressed to Claude) stays silent.
Those blocks reach you in the language you write in, every line kept, and so
does every answer: English hook text, skill files and the app's own resume
and nudge messages never switch it. Explicit questions still get a full
answer; the style targets narration, not explanations.

If the desktop app's "New output style" dialog asks you to sign in again, the
headless CLI token behind it has expired — the file route above needs no
generator. `claude` + `/login` in a terminal repairs the dialog.

## Features

- **<!--devops:count:hooks-->62<!--/devops:count:hooks--> Hooks** — automated guards and triggers across the full session lifecycle
- **<!--devops:count:skills-->14<!--/devops:count:skills--> Skills** — doors do-ship (incl. promote mode), do-run (backlog, autonomous, burn, rethink, audit modes), do-learn, do-batch; hidden workers auto-cleanup, auto-fix, auto-concept, auto-guide, auto-extend, auto-update, auto-harden, auto-polish, auto-agents, auto-issue. README standards, graphify, usage data, strict mode and project setup are knowledge + hooks, not skills
- **<!--devops:count:agents-->12<!--/devops:count:agents--> Agents** — AI, Core, Designer, Feature, Frontend, Gamer, PO, QA, Redteam, Research, Windows
- **Completion Flow** — mandatory card after every task (8 variants), visual verification, ship recommendation
- **Ship Enforcement** — intent detection, PR command blocking, automatic /do-ship skill routing
- **3-Layer Extension Model** — customize any skill or agent per-project without forking

## What it does

### Hooks (automatic, no user action needed)

<!--devops:count:hooks-->62<!--/devops:count:hooks--> hooks fire automatically across the session lifecycle — no user action needed.

<details>
<summary><strong>By session lifecycle</strong> — when does it fire?</summary>

```
SessionStart  ──>  UserPromptSubmit  ──>  PreToolUse  ──>  PostToolUse  ──>  Stop
```

<!--devops:block:hook-lifecycle-->
#### SessionStart — runs once when a session begins

- `ss.plugin.update` — Auto-update plugin marketplace clones, rebuild cache, and update registry.
- `ss.permissions.ensure` — Ensure required plugin permissions exist so devops skills that write ephemeral review…
- `ss.statusline.ensure` — Enables the native usage source.
- `ss.knowledge.index` — Inject deep-knowledge INDEX.md into context at session start, plus the always-on poli…
- `ss.mcp.deps` — Auto-install MCP server dependencies into CLAUDE_PLUGIN_DATA, and self-heal partial i…
- `ss.mcp.envcheck` — Detect enabled plugins whose .mcp.json references env vars that are not set.
- `ss.mcp.verify` — Verify every MCP server declared in this plugin's .mcp.json has its entry file presen…
- `ss.mcp.reap` — Reclaim orphaned Claude Desktop MCP server processes leaked by previously-closed sess…
- `ss.tokens.scan` — Scan project for expensive files and update config for the pre.tokens.guard hook.
- `ss.project.setup` — The automatic part of project setup (the former /setup-project skill; its interactive…
- `ss.git.check` — Check for stale changes AND workspace setup issues at session start.
- `ss.git.sync` — Starts ONE detached background git sync for this worktree.
- `ss.graphify` — graphify enforcement — install-check + auto-build wiring for the graphify integration…
- `ss.ship.verify` — Surface results from the post-merge watcher (post-ship CI + optional deploy verify).
- `ss.ship.resume` — Keep a running /do-ship stable across a compaction or a resume.
- `ss.concept.resume` — Recover an open concept session after a Claude restart.
- `ss.team.changelog` — Show a summary of changes made by other contributors on remote main since the last ti…

#### UserPromptSubmit — runs when the user sends a message

- `prompt.flow.open-url` — Opens a local page in the default browser when the prompt is the card widget's open p…
- `prompt.batch.collect` — Collect mode for `/do-batch`: while active, blocks the user prompt (exit 2 — the harn…
- `prompt.run.contract` — Arm, refresh or pre-arm the do-run RUN CONTRACT from the prompt (run-contract spec B,…
- `prompt.flow.silent-turn` — Detects background/cron-injected prompts and marks the turn as "silent" so post.flow.…
- `prompt.flow.title-work` — Marks a session as "being worked on" in the sidebar: on the first real prompt of a se…
- `prompt.knowledge.dispatch` — On-demand deep-knowledge injection based on prompt keywords.
- `prompt.git.sync` — Delivers the result of a background git sync — nothing else.
- `prompt.issue.detect` — Detect issue references in user messages.
- `prompt.plugin.scope` — Inject the scope-routing rule when a consumer project's session starts talking about…
- `prompt.skill.enforce` — Detects inline skill commands (e.g.
- `prompt.strict.enforce` — Arms and enforces strict mode — literal scope, discretionary parameters.
- `prompt.ship.detect` — Detect ship intent in user prompts and inject Skill('devops:do-ship') instruction.
- `prompt.flow.appstart` — Detect app start intent in user prompts.
- `prompt.burn.resume` — After a usage limit stopped a burn: ask on a manual nudge, apply the chosen policy on…
- `prompt.worktree.branch-guard` — Prevents working without a dedicated branch inside a linked worktree.

#### PreToolUse — runs before each tool call

- `pre.tokens.guard` — Block Read/Bash/Glob/Grep operations that would consume a significant percentage of t…
- `pre.ship.guard` — Block manual PR creation/merging via Bash.
- `pre.main.guard` — Prevent accidental writes on local main/master.
- `pre.worktree.split-guard` — WARN (never block) on git-mutating work driven from the main repo root while an agent…
- `pre.issue.guard` — Block raw GitHub issue writes (gh issue, gh api, MCP) unless auto-issue ran this turn.
- `pre.crawl.guard` — Block recursive scans of a filesystem root, a drive root or the whole home directory.
- `pre.plugin.scope` — Block hand-edits of installed devops plugin artifacts from a consumer project.
- `pre.edit.branch` — Prevent Edit/Write tool calls while HEAD is on local main/master.
- `pre.readme.standards` — Once per session, before the first substantial write to a README file, points Claude…
- `pre.mcp.health` — Detects dead or stale MCP servers before tool calls fail cryptically.
- `pre.strict.agent-gate` — While strict mode is active, refuse an Agent spawn whose prompt does not start with t…
- `pre.agent.announce` — Makes every Agent spawn visible to the user: resolves the agent's effective model and…
- `pre.run.contract` — Refuse (exit 2) the tool call that would walk past an open obligation of the do-run R…

#### SubagentStart — runs when a subagent is spawned

- `sub.plugin.root` — Give every subagent the literal devops plugin root.

#### PostToolUse — runs after each tool call

- `post.flow.completion` — After EVERY tool call: inject the completion-card reminder so Claude always has the i…
- `post.flow.debug` — After 2+ consecutive shell failures: MANDATE the devops `auto-fix` skill before the n…
- `post.graphify.query` — When Claude runs `graphify query ...`, record a per-session flag (`markQueryDone` — k…
- `post.graphify.search` — Telemetry only: record every Grep/Glob that actually RAN (`search_ran`) with its resu…
- `post.concept.gate` — Deterministic backstop for concept pages.
- `post.claude.budget` — Deterministic context-budget gate for Claude configuration files — CLAUDE.md, SKILL.m…
- `post.design.remind` — Once per session, when a UI file is written or edited, reminds Claude of the standing…
- `post.run.contract` — Record what happened for the do-run RUN CONTRACT (spec A events, B arming, E batch ma…
- `post.ask.answers` — Answer-check (run-contract spec F): an AskUserQuestion answer token that equals the O…

#### Stop — runs when Claude finishes responding

- `stop.git.sync` — Throttled background git sync at turn end.
- `stop.flow.browsertest` — Light-verification enforcement gate (the "V" of the V&V gate).
- `stop.flow.guard` — Per-turn completion card + validation enforcement (the validation half of the V&V gate).
- `stop.guide.handoff` — Offer the auto-guide skill when Claude's own answer hands the user a manual click-thr…
- `stop.flow.selfcalibration` — Run self-calibration when Claude finishes a response turn.
- `stop.strict.release` — Settles the lifetime of an inline strict mode at the end of the turn that armed it.
- `stop.mcp.reap` — Periodic background reclaim of orphaned Claude Desktop MCP server processes — the "ru…
<!--/devops:block:hook-lifecycle-->

</details>

<details>
<summary><strong>By category</strong> — what does it guard?</summary>

#### tokens — prevent context window waste

- `ss.tokens.scan` — Scan project for expensive files *(SessionStart)*
- `pre.tokens.guard` — Block operations exceeding token budget *(PreToolUse)*

#### git — keep the working tree in sync

- `ss.git.check` — Check for uncommitted/unpushed changes *(SessionStart)*
- `ss.git.sync` — Start one detached background sync per worktree *(SessionStart)*
- `stop.git.sync` — Same, throttled to 30 min, at turn end *(Stop)*
- `prompt.git.sync` — Deliver a background sync's result, if any *(UserPromptSubmit)*

#### ship — enforce the shipping pipeline

- `pre.ship.guard` — Block manual PR/merge via Bash *(PreToolUse)*
- `prompt.ship.detect` — Detect ship intent, enforce /do-ship skill; above `DOTCLAUDE_SHIP_COMPACT_THRESHOLD` (200 k tokens) hands the user a `/compact` command instead *(UserPromptSubmit)*
- `ss.ship.verify` — Surface post-merge watcher results *(SessionStart)*
- `ss.ship.resume` — Re-enter a ship that was mid-pipeline when the context compacted or the session paused: verify git/gh state first, never a second PR or tag *(SessionStart)*

#### flow — track progress toward completion

- `post.flow.completion` — Track code edits, inject completion reminder *(PostToolUse)*
- `post.flow.debug` — Mandate /auto-fix after 2+ consecutive shell failures *(PostToolUse + PostToolUseFailure)*
- `prompt.batch.collect` — Collect prompts instead of executing them, in `/do-batch` mode *(UserPromptSubmit)*
- `prompt.flow.appstart` — Detect app start intent, enforce completion card *(UserPromptSubmit)*
- `prompt.flow.silent-turn` — Mark background/cron-injected turns *(UserPromptSubmit)*
- `prompt.burn.resume` — After a usage limit stopped a burn: ask on a manual nudge, apply the chosen policy on an automatic resume *(UserPromptSubmit)*
- `stop.flow.guard` — Enforce completion card before response ends *(Stop)*
- `stop.flow.selfcalibration` — Run self-calibration at end of turn *(Stop)*

#### branch — protect main and worktrees

- `pre.main.guard` — Prevent accidental writes on local main *(PreToolUse)*
- `pre.edit.branch` — Block Edit/Write while HEAD is on main *(PreToolUse)*
- `prompt.worktree.branch-guard` — Prevent working on main inside a worktree *(UserPromptSubmit)*

#### plugin — updates, dependencies, and health

- `ss.plugin.update` — Check for plugin updates *(SessionStart)*
- `ss.permissions.ensure` — Ensure required plugin permissions *(SessionStart)*
- `ss.mcp.deps` — Auto-install MCP server dependencies *(SessionStart)*
- `ss.mcp.envcheck` — Warn on MCP servers missing env vars *(SessionStart)*
- `pre.mcp.health` — Detect dead/stale MCP servers before calls *(PreToolUse)*

#### knowledge — deep-knowledge injection

- `ss.knowledge.index` — Inject deep-knowledge index into context *(SessionStart)*
- `prompt.knowledge.dispatch` — Inject deep-knowledge by prompt keywords *(UserPromptSubmit)*

#### issues & team — tracking and collaboration

- `prompt.issue.detect` — Track GitHub issues automatically *(UserPromptSubmit)*
- `ss.concept.resume` — Recover an open concept session after restart *(SessionStart)*
- `ss.team.changelog` — Summarize teammates' changes on remote main *(SessionStart)*

</details>

### Skills (invoked explicitly or by hooks)

Doors (`do-*`) are in the slash menu. Workers
(`auto-*`) are hidden from it (`user-invocable: false`): Claude invokes them
from your words, the trigger router or a hook. Old names from before the
restructure (`/ship`, `/fix`, `/concept`, `/run-backlog`, `/promote`, …)
are mapped to the new skill when they appear in a prompt, and project
extensions under an old name (`.claude/skills/ship/`) keep loading.

| Skill | Invocation | Purpose |
|---|---|---|
| `/do-ship` | Explicit + Hook | Full shipping pipeline: build, version, PR, merge, cleanup |
| `/do-ship promote` | Explicit | Channel promotion (alpha→beta→stable): re-tag the same SHA, no rebuild |
| `/do-run` | Explicit + Router | Door for every run: picks the mode (backlog, autonomous, burn, rethink, audit) or implements the prompt through `auto-agents` |
| `/auto-fix` (trigger: "debug") | Hidden · Router + Hook | Root-cause analysis, diagnostics, and fix cycle |
| `/auto-issue` | Hidden · Hook | GitHub issue creation and refinement with labels and milestones — the single owner of every issue write |
| `/auto-extend` | Hidden | Scaffold or adapt project-level skill extensions |
| `/auto-cleanup` (trigger: "branch cleanup") | Hidden · Card hint + Router | Branch/worktree/PR hygiene page; open PRs are landed one after another via `/do-ship`. After each ship, `ship_hygiene` removes old leftovers that provably landed and suggests the page when too much piles up (thresholds: "devops settings") |
| `/auto-update` | Hidden | Update the plugin to the latest version from GitHub |
| `/auto-concept` | Hidden · Router | Interactive HTML page for analysis, plans, concepts, and prototypes |
| `/auto-agents` | Hidden | Full-ceremony orchestration (plan → confirm → waves) for Complex-tier work; everyday delegation runs automatically via the always-on policy |
| `/do-run autonomous` | Explicit | Fully autonomous agent orchestration while user is AFK |
| `/do-run burn` | Explicit | Turns budget that would expire this week into landed work: depth per task first, lanes only to fill time; a limit stop is asked about, never burned through |
| `/do-run backlog` | Explicit | Milestone-centric backlog runner: refine, implement, test/QA, and ship selected milestones/issues unsupervised |
| `/do-learn` | Explicit | Capture long-term learnings and route to project-specific instructions |
| `/auto-harden` | Hidden · Router | Stabilization pass: full test suite, autonomous bug fixes, regression + consistency |
| `/auto-polish` | Hidden · Router + `/do-ship` | UI refinement: visual consistency, state-visuals, UI-side functionality checks |
| `/do-run rethink` | Explicit | Strategic reset for stuck development: code-blind fresh approaches, concept decision, autonomous implementation |
| `/do-run audit` | Explicit | Full-spectrum audit (functional, visual, animation, audio, a11y, logging, performance, …) of this chat's work, the last 48h's requirements, or everything; then fixes or a DevOps concept page |
| `/do-batch` | Explicit + Hook | Collect mode: batch prompts into `.claude/batch.md` instead of executing them, then merge into one feasibility-checked plan |
| `/auto-guide` | Hidden · Hook | Live tutorial in the user's Edge tab: step panel overlay for logins, API keys, and settings Claude cannot do itself |

#### No longer skills — knowledge + hooks

Four former skills are plain knowledge now (`deep-knowledge/`), reached through
hooks instead of the skill listing. Their old slash names are never mapped to a
skill; a prompt that mentions them gets a one-line pointer to the doc.

| Former skill | Now | How it reaches Claude |
|---|---|---|
| `/setup-readme` | `readme-standards.md` | `pre.readme.standards` on the first substantial README write of a session; "create a readme", "README erstellen" in a prompt |
| `/auto-graph` | `graphify.md` | the graphify hooks (auto-install, freshness, search gate); "knowledge graph", "graphify" in a prompt |
| `/auto-usage` | `usage.md` | the `get_usage` MCP tool (the card fetches by itself); "refresh usage", "wie viel hab ich verbraucht" |
| `/claude-strict` | `strict.md` | the strict hooks and do-run's "Strikt" answer |

**Strict mode** — the deliverable is exactly what the prompt names; unnamed
attributes are chosen and reported; it propagates to agents, skills and concept
iterations. Switch it with plain words (the whole prompt):

| Type | Effect |
|---|---|
| `strict on` / `strikt an` | on for this worktree + branch, until `off` or a branch switch |
| `strict off` / `strikt aus` | off |
| `strict status` | status |
| `strict: <task>` / `strikt: <task>` | strict for this one task |
| "genau so und nicht mehr", "nur das ändern", "nichts anderes anfassen" in a prompt | strict for this one task |

`/claude-strict on|off|<task>` still works inside a prompt; a prompt that
*starts* with it may be rejected by Claude Code as an unknown command before
the hook sees it, so prefer the plain words. A bare "strict" arms nothing.

#### `/do-run` — let Claude execute autonomously

When you want Claude to **run autonomously or semi-autonomously to implement
something**, reach for `/do-run`. There are two ways in:

- **`/do-run backlog` — Claude picks the topics itself.** It pulls the planned
  backlog (open milestones, else loose issues), then refines → implements → tests →
  **ships** each item unsupervised. An optional **budget mode** (asked at the gate,
  default *no*) adds burn depth per issue. Under the hood it composes the other
  runs, so you don't invoke them separately.
- **You pick the topic** with the other three:
  - **`/do-run autonomous`** — one ad-hoc task, fully AFK (never ships).
  - **`/auto-agents`** — multi-agent orchestration while you stay present.
  - **`/do-run burn`** — budget-driven: turns budget that would expire this
    week into landed work — stronger models and a redteam pass per task, lanes
    only to fill time, a pause instead of a hard stop at the 5-hour window.
    After a usage limit it asks before it burns on (auto-resume follows your
    answer given up front). Every decision is `scripts/burn-plan.js`; try it
    token-free with `node plugins/devops/scripts/burn-plan.js simulate --all --text`
    (explicit `/do-run burn` only).

Backlog mode uses autonomous mode (implementation) and the same role-agent
orchestration as `auto-agents` in the background — plus burn mode when budget mode
is on — so those are listed once here, not repeated per run.

#### Improve what exists — harden, polish, rethink, audit

The counterpart to building: instead of building new work, these **refine existing
code and UI** — no new features, no fresh scope.

- **`/auto-harden`** — stabilization: full test suite, autonomous bug fixes,
  consistency + regression coverage. Never adds new UI structure.
- **`/auto-polish`** — UI refinement: visual consistency, state-visuals,
  UI-side functionality checks and the standing UI rules from
  `deep-knowledge/ui-defaults.md` (app style as part of every rule, tooltips
  with two delay tiers, dropdowns, spacing, hotkeys, scrollbars — extendable
  per project). Structural UI changes only with approval. `/do-ship`
  runs its rules-only path on every UI diff; the `post.design.remind` hook
  puts the rules in context the moment a UI file is written.
- **`/do-run rethink`** — strategic reset: code-blind fresh approaches for
  stuck development, decided on a concept page, then implemented.
- **`/do-run audit`** — full-spectrum audit: functional requirements traced to
  evidence plus visual, animation, audio, accessibility, logging, performance,
  resilience, security basics, tests and build. Asks the scope (this chat's
  work / functional requirements of the last 48h / everything incl. 48h) and
  the output (audit + implementation, or a DevOps concept page).

Something actually **broken**? That's **`/auto-fix`** (say "debug") —
standalone root-cause analysis and repair, not a refinement pass.

### Agents (spawned for parallel work)

Spawning is governed by the always-on delegation policy
(`deep-knowledge/agent-proactivity.md`, injected at every session start): inline
for single-domain work, one background agent when the deliverable is a conclusion
(research, test runs, redteam), 2–3 parallel agents for independent domains, and
`/auto-agents` only offered — never auto-started — for Complex-tier work.
A budget class (plan × 5h window × week, read from the local usage snapshot)
keeps that honest on small plans: `free` / `ask-before-parallel` (a Pro plan
from 0 % — single agents run on sonnet, a parallel spawn asks one question per
session) / `sonnet-only`. Explicit `/run-*` skills are never asked or downgraded.
Switch it off per project or machine: `.claude/delegation.json` (or
`~/.claude/delegation.json`) with `{"mode":"off"}` — no proactive agents, no
offers — or `{"mode":"ask"}` — every agent tier is offered first and runs only on
a yes. Explicit `/run-*` skills and "with agents" in a prompt always still spawn.

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
| **redteam** | Adversarial review: failure modes, blind spots, hidden risks |
| **research** | Deep-dive investigations |
| **rethinker** | Code-blind fresh-approach ideation through one lens |
| **windows** | Platform-specific features |

## Completion Cards

Every task ends with a completion card — one page, three result lines that
answer the prompt, one decision. The card is always the last thing in the
response. Full spec: [completion-card-design.md](plugins/devops/deep-knowledge/completion-card-design.md).

**ship-successful** (ring project, alpha) — after a successful PR merge:

````
&nbsp;
---
### **✨✨✨ Filter dialog moved to settings ✨✨✨**
› Settings now has a Filter tab with drag & drop, replacing the old dialog
› Old dialog route still works — redirects to the new tab
✓ 3/3 Anforderungen  ✓ 47 Tests grün  ✓ 4 Live-Checks ok
5h ▰▰▰▰▰▰▰│▱▱▱▱▱▱ 3 h 12 m   Wk ▰▰│▱▱▱▱▱▱ 5 d 3 h
✓ commit → ✓ push → ✓ PR #42 → ✓ merge   main → ✓ alpha → ○ beta → ○ stable · v0.8.3 · Build a3f9b21
## 🚀 Released v0.8.3 alpha — promote to beta?
[Promote ↗] [—]
---
````

Two blocks, nothing between them. Block 1 ("what happened"): the title, ≤ 3
`›` result lines naming an effect for the user (never a file or hook), the
evidence row (requirements · tests · live check, deviations first and
bright), the budget line, and the pipeline line. Block 2 ("what to decide"):
a heading phrased as a question, an optional context line, ≤ 3 numbered
points, and — Desktop app only — the `[CARD WIDGET]` buttons for the two
verbs of the variant (`Ship` / `Ändern`, `Fix` / `Skip`, `Promote`, …); the
terminal shows the question heading alone.

<details>
<summary><strong>See all other variants</strong> — ready, ship-blocked, test, test-minimal, analysis, aborted, fallback, released, ready-files, pending, concept, batch, V&V unverified</summary>

| Variant / state | Decision heading | Notes |
|---|---|---|
| `ready` | `📦 Shippen?` / `📦 Shippen trotz {reservation}?` | open + final tests as points |
| `ready` + red/partial | `⚠ Trotzdem shippen mit 2 roten Tests?` | line 1 = `**Nicht erreicht:**` |
| `ship-blocked` | `⛔ {reason} umgehen und trotzdem shippen?` | only variant with `⛔` |
| `ship-successful` (ring) | `🚀 Released v{v} alpha — nach beta promoten?` | context line = distance to beta |
| `ship-successful` (plain) | `🚀 Shipped v{v} → main.` | state, no buttons |
| `released` → beta/stable | `🎊 Promoted v{v} BETA — nach stable?` / `🎊 Released v{v} LIVE — stable.` | evidence = promotion facts |
| `ready-files` | `📂 Fertig auf der Platte — noch etwas?` | pipeline line names the file(s) |
| `test` | `🧪 Erst testen, dann shippen?` | points = user-test steps |
| `test-minimal` | `▶️ Läuft — viel Spaß` | title + one line + heading only, no widget |
| `analysis` | `📋 Analyse gelesen — umsetzen oder Fragen?` | pipeline = `➖ keine Änderungen` |
| `aborted` | `🚫 Abgebrochen wegen {reason} — anders versuchen?` | context line = alternatives |
| `fallback` | `🔧 Erledigt — noch etwas?` | miscellaneous / default |
| pending override | `⏳ Noch nicht fertig — {what}` | replaces the CTA of whichever variant the card carries, so it never asks you to act on a result that has not arrived |
| concept override | `🧭 Concept wartet auf deine Entscheidungen` | context line = the page link |
| batch override | `📥 Batch sammelt — {n} Einträge` | points = how to collect, fire and stop; context line = what happens to the next prompt |
| V&V unverified | `⚠ Ungeprüft shippen?` | `⚠ ungeprüft` leads the evidence row |

English strings mirror these one to one (`Ship anyway despite 2 red tests?`,
`Released v0.179.0 alpha — promote to beta?`, …) — see the design doc § 3 for
the full mapping.

</details>

In the Claude Desktop app the buttons live inside the card's own widget
(`[CARD WIDGET]`, Desktop-only, skipped silently elsewhere): one button per
verb of the variant (Ship / Ändern, Fix / Skip, Promote, …), each with a
tooltip explaining what it triggers. Terminal sessions get the identical
markdown card, minus the buttons.

## Project Structure

```
devops/
├── .claude-plugin/plugin.json     ← Plugin manifest
├── CONVENTIONS.md                 ← Naming, versioning, extension rules
├── hooks/                         ← <!--devops:count:hooks-->62<!--/devops:count:hooks--> hooks (JS) registered in hooks.json
├── skills/                        ← <!--devops:count:skills-->14<!--/devops:count:skills--> skill definitions (SKILL.md)
├── agents/                        ← <!--devops:count:agents-->12<!--/devops:count:agents--> agent definitions
├── deep-knowledge/                ← Cross-cutting reference docs
├── templates/                     ← Output format templates
└── scripts/                       ← Utility scripts (build-id, usage)
```

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
