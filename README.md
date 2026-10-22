# dotclaude

**Version: 0.298.1**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

Complete DevOps automation plugin for Claude Code. Hooks, skills, agents, and templates that make shipping faster, safer, and smarter.

> ⚠ **AI runs commands on your machine.** Hooks, skills, and agents execute shell commands, edit files, push to remotes, and launch apps autonomously. Built-in safeguards reduce risk but do not replace your review.
>
> Work in a versioned tree. Keep backups. Read what Claude proposes before approving. **Use at your own risk.**

**Token math — costs and payoff:**
- **Costs:** ~0.7M tokens/week — hooks, prompt guards, always-on context
- **Plan share:** 1–4% on Max plans · up to ~23% on Pro + Opus
- **Saves (context):** ~1–4M tokens/week — token guard blocks expensive reads before they land
- **Saves (time):** 2–4 hours/week — auto git state, ship pipeline, root-cause debug
- **Net:** plugin pays itself back 1.5–6× via prevented context waste

<details>
<summary><strong>Detailed token math</strong> — weekly breakdown, plan %, what you get back</summary>

### Weekly plugin overhead (estimated)

| Source | Tokens/week | Notes |
|---|---|---|
| SessionStart hooks (once per session) | ~8K | Update check, git check, token scan, MCP deps |
| Prompt guards (per message) | ~150K–250K | Ship detection, issue tracking, git sync — most exit silently |
| Tool guards (per tool call) | ~100K–200K | Token budget, ship and branch enforcement, agent cards — early-exit when clean |
| Always-on context (per session) | ~200K–400K | Delegation policy, deep-knowledge index and card reminders, re-sent with every call (mostly as cache reads) |
| Skill invocations (~15–25/week) | ~15K–30K | Only when you call /do-ship, /do-run, /auto-fix, etc. |
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

**Token guard payoff:** The token guard blocks any single operation above your plan's per-operation share of the ~200K context window — **5% (~10K tokens) on Pro, 8% (~16K) on Max 5×, 10% (~20K) on Max 20×**. Calls from a sub-agent get their own, higher threshold (4× the plan's share, capped at 50 %; `subagentConfirmThresholdPct` and a per-agent `subagentTypeThresholdPct` map override it): a sub-agent's fresh context exists to read broadly and return only the conclusion. In a typical session, Claude attempts 5–15 broad searches or large-file reads that would each burn 20–80K tokens — that's 100–400K tokens/session evaporating into context you never asked for. Across ~10 sessions/week, the guard saves roughly **1–4M tokens/week** in prevented waste. The plugin's own overhead (~0.7M tokens/week for hooks, startup checks, and skill prompts) pays for itself 1.5–6x over just by keeping Claude from reading files it doesn't need.

Your mileage may vary. Your sanity will not.

</details>

## Table of Contents

**Setup**
- [Installation](#installation)
- [Updates](#updates)
- [Supported Stacks](#supported-stacks)
- [Integrations](#integrations)
- [Customization](#customization)
- [Local Claude Code setup](#local-claude-code-setup)

**Use**
- [Features](#features)
- [What it does](#what-it-does)
- [Completion Cards](#completion-cards)

**Details**
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)

## Installation

**Let Claude do it:** paste this into Claude Code (Desktop or CLI):

```
Install the devops plugin by following https://github.com/Jerry0022/dotclaude/blob/main/INSTALL.md
```

**By hand:**

**Desktop App:** Sidebar → **Customize** → **+** next to *Personal Plugins* → add `Jerry0022/dotclaude` → enable **devops**.

**CLI:**

```bash
claude plugin marketplace add Jerry0022/dotclaude
claude plugin install devops@dotclaude
```

Desktop and CLI keep separate plugin stores — a CLI install (also one Claude runs for you) does not show up in the Desktop App. Requires git and Node.js 18.18+.

Start a new session for hooks to take effect. See [`INSTALL.md`](INSTALL.md) for details, extensions, and uninstall.

## Updates

```bash
claude plugin update devops@dotclaude
```

Or enable auto-update for the marketplace (Desktop: **Customize**; CLI: `/plugin` → **Marketplaces**), or say **"devops update"** in any session. Semantic versioning — breaking changes only in major versions.

**Release channels.** Every ship lands on `alpha`; a promotion re-tags the
same commit on `beta`, then `stable` — never a rebuild. A fresh install
follows `stable`. Pin another channel in `~/.claude/plugins/.channels.json`
(`{ "dotclaude": "alpha" }`) to get every ship the moment it lands.

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

### Claude API credits (optional, opt-in)

Claude Max and Team plans include monthly Claude API credits ($100 on Max 5x,
$200 on Max 20x, up to $500 pooled on Team) that expire every billing cycle.
They do **not** cover Claude Code itself, so your session, its subagents and
the plugin's hooks always stay on the plan. When you switch this on, the plugin
runs its **read-only side work on the credit first** and falls back to the plan
when the credit is empty or unavailable:

| Work | Runs on |
|---|---|
| Codebase sweeps, research, second-opinion reviews (`scripts/claude-api-agent.js`, a lean read-only agent on the Messages API) | credit first, then an in-session agent |
| Codex second opinion when Codex is skipped (`scripts/claude-api-safe.js`) | credit |
| Month-end code audit (`scripts/api-credit-audit.js`, report in `~/.claude/devops-audits/`) | credit |
| Evals (`evals/ab-run.js`) started from your own terminal | credit |
| Code-writing and test-running agents | always the plan |

Same price per token as the plan path, but far less context per agent (about
2k tokens of setup instead of 30k+), and none of it counts against your plan's
5-hour window or week. Measured on 2026-10-19: plain API calls draw the
promotional credit; a `claude -p` child started from the desktop app draws
*purchased* credit, so the plugin never does that.

Two switches, both off by default:

| Setting | Effect |
|---|---|
| `apiCredit.enabled` | Turns on the credit-first routes above. Off: no network call, no change. |
| `apiCredit.webGuide` | If no API key is stored yet, Claude offers once to walk you through the Claude Console in your browser: create a `devops` workspace, set a spend limit, create a key. The key goes to `~/.claude/devops-api.env`. |

Turn them on by saying **"nutze mein API-Guthaben"** (or "API credits for
devops"). Claude asks both questions once, then stores the answers globally.
Check them with `node plugins/devops/scripts/claude-api-safe.js --status`, see what the
credit was spent on this month with `--usage`, and
turn them off with "API-Guthaben nicht mehr nutzen".

Notes:
- The key is read only as `DEVOPS_ANTHROPIC_API_KEY`. Never set `ANTHROPIC_API_KEY`
  for this: doing so would switch Claude Code itself to API billing, which the
  credit rejects.
- Purchased credits can't be excluded. Anthropic spends the included credit
  first. The workspace spend limit is the guardrail.

Runbook (billing matrix, token economics, flags, exit codes): [`plugins/devops/deep-knowledge/api-credits.md`](plugins/devops/deep-knowledge/api-credits.md).

### Claude home backup (optional, opt-in)

Your settings, `CLAUDE.md`, agents, your own skills and commands, project
memory and helper scripts live only in `~/.claude` on one disk. The home backup
pushes that part to a **private** GitHub repo once a day, so a new machine is one
`git clone` away. It is off by default.

Say **"richte Home-Backup ein"** (or "set up home backup"). Claude runs one
setup command: it creates the private repo (default `<you>/claude-home`),
initialises git in `~/.claude` with a deny-by-default `.gitignore` (`/*`, then
an allowlist), and registers a daily job (Windows Task Scheduler, crontab on
Linux/macOS). Never included: `.credentials.json`, any `*token*` / `*secret*` /
`*credential*` / `.env` file, transcripts (`*.jsonl`), caches, `plugins/`,
`file-history/`, browser profiles, logs and backups.

Before every commit each staged file is scanned for **secrets** (private keys,
`sk-` / `ghp_` / `github_pat_` / `xox*` / `AKIA` tokens, JWTs, long
`password=` / `token=` / `api_key=` values) and **private data** (e-mail
addresses, phone numbers, IBANs, Luhn-valid card numbers). On any hit nothing is
committed or pushed: you get a desktop notification and
`~/.claude/home-backup-report.txt` with file, line and rule — never the value.
Remove the data, or allow that one finding on purpose in `~/.claude/.backupallow`.
Commits use a fixed local identity, not your e-mail address. The scans are
pattern rules: they catch keys, tokens and structured personal data, not
free-text private details — what you write into memory files stays your call.

**Token cost: 0.** The daily run is a plain node script — no `claude` call, no
Claude Code cron, no cloud routine. Only the one-time setup conversation costs
tokens, well under 0.1 % of a Pro plan's weekly usage.

Turn it off with "Home-Backup aus" (removes the job; the repo and `~/.claude/.git`
stay). **Restore** on a new machine: install Claude Code, move the fresh
`~/.claude` aside, `git clone https://github.com/<you>/claude-home ~/.claude`,
let `claude plugin update` reinstall the plugins from the restored marketplaces,
then `/login` — credentials are never part of the backup.
Runbook: [`plugins/devops/deep-knowledge/home-backup.md`](plugins/devops/deep-knowledge/home-backup.md).

### WIP watch (optional, opt-in)

Un-landed branches, forgotten stashes and dirty or broken worktrees pile up
across projects, and the work in them exists nowhere else. The WIP watch looks
for them once a week and tells you only when something needs a decision. It is
off by default.

Say **"WIP-Wächter an"**. Claude registers a weekly job (default Sunday) that
scans every git repo under your roots (default `~/IdeaProjects`) against the
existing `origin/<default>` ref — no fetch. A branch counts as landed when its
content is in main: ancestor, the head of a merged PR, or every changed file
identical / re-applying it is a no-op — so squash merges are recognised. Each
finding gets a rule-based suggestion: delete (already in main), push + PR (ahead,
rebases cleanly), reimplement on current main (far behind or conflicts), commit
or discard (dirty worktree, by age), secure or drop (stash older than 30 days),
`git worktree prune` (worktree folder gone). The result is
`~/.claude/wip-watch/report.json`.

You get one desktop notification, only when a NEW finding appears — never an
"all ok". It carries the prompt to paste into Claude: **`WIP-Report aufräumen`**.
That opens the cleanup page with all repos grouped, each suggestion
pre-selected, and nothing executed before the dry-run confirmation.

**Token cost: 0.** The weekly job is a plain node script, never starts Claude
and never deletes anything; only opening the cleanup page costs tokens. Turn it
off with "WIP-Wächter aus". Runbook:
[`plugins/devops/deep-knowledge/wip-watch.md`](plugins/devops/deep-knowledge/wip-watch.md).

## Customization

Every skill and agent supports **three-layer extensions**:

```
Layer 1: Plugin (this plugin)         ← defaults
Layer 2: User global (~/.claude/)     ← your personal overrides
Layer 3: Project ({project}/.claude/) ← project-specific rules
```

To extend any plugin skill for your project, create a `reference.md` in a
directory matching the skill's name under `.claude/skills/` in your project:

```
your-project/.claude/skills/{skill-name}/
└── reference.md    ← project-specific context, rules and step directives
```

When the skill starts, one override loader injects your global and project
`reference.md` (project wins on conflict). Directive headings become explicit
orders: `## Add after Step 4`, `## Skip Step 3`, `## Replace Step 2`; any
other text is an additional rule. The completion card shows which override
applied (`🧩 Override aktiv: Projekt do-ship (Step 3 übersprungen)`). Never
name the file `SKILL.md` — Claude Code would load it as a skill of its own.

**Example** — extending `/do-ship` with project-specific quality gates and deploy targets:

```
your-project/.claude/skills/do-ship/
└── reference.md    ← "## Add after Step 1 — run ng build --prod" · "Deploy via SSH to 192.168.178.32"
```

Say "extend skill" (the hidden `auto-extend` skill) to interactively scaffold an extension for any plugin skill.
It detects existing extensions and lets you adapt them.

For the full extension guide with examples per skill, see `deep-knowledge/skill-extension-guide.md`.

### `.claude` in git — one managed ignore block

What of `.claude/` is shared and what stays on your machine is one policy, kept
in ONE marked block of the project's `.gitignore`:

```gitignore
# >>> claude (managed) >>>
**/.claude/settings.local.json
**/.claude/launch.json
**/.claude/worktrees/
…every runtime file Claude Code and the plugin write…
# <<< claude (managed) <<<
```

Versioned: `CLAUDE.md`, `.claude/settings.json`, `.claude/skills/`, `commands/`,
`hooks/`, `agents/`, `deep-knowledge/`, `.claude/project-map.md`,
`.claude/launch.example.json`, `docs/concepts/`. Local: `settings.local.json`,
`launch.json`, `worktrees/` and all plugin runtime state. A new repository gets
the block on its own. An existing one keeps its `.gitignore` untouched until you
move it over; until then each clone gets the block in `.git/info/exclude` at
session start, so a fresh clone is covered from the first session. Move it with
`node plugins/devops/scripts/claude-ignore.js migrate` — idempotent, it folds
hand-grown Claude lines into the block and removes the plugin's lines (and the
fallback copy) from `.git/info/exclude`. Files the block ignores that are
already committed (e.g. an old `.claude/launch.json`) are reported with the
`git rm --cached` command; nothing is untracked for you. `/do-ship` checks the
block only when a ship touches `.gitignore` or `.claude/`, and then hands you
the fix instead of blocking. `claude-ignore.js env-example` writes
a `.env.example` with key names only (never values) for your secrets files.

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

## Local Claude Code setup

Recommendations for the machine Claude Code runs on — independent of this
plugin, but they decide how far your usage goes and what survives an OS
reinstall.

### Recommended settings

| Setting (`~/.claude/settings.json`) | Why |
|---|---|
| `"promptCacheTtl": "1h"` | On a subscription the main conversation already uses the 1-hour prompt cache — but in overage (usage credits) Claude Code silently drops to 5 minutes, so every short break re-writes the whole context. Pinning `1h` keeps it. Needs Claude Code ≥ 2.1.242; check with `/usage` → `Prompt cache (main)`. |
| `"outputStyle": "Quiet"` | See [Quiet output style](#quiet-output-style-recommended). |

**Check first, then set — let Claude do it.** Paste this into any Claude Code
session; it measures what the 1-hour TTL would have saved on your own last
sessions (reads local transcripts only, no extra model calls) and sets it only
when the effect is significant:

```text
Analyse my prompt-cache pauses, then decide on promptCacheTtl:
1. Read the newest (up to 100) main-session transcripts under
   ~/.claude/projects/*/*.jsonl plus their */subagents/*.jsonl, with a small
   Node script (stream line by line, never load them into context). Dedupe
   assistant entries by requestId; take usage.input_tokens,
   cache_creation.ephemeral_5m_input_tokens / ephemeral_1h_input_tokens,
   cache_read_input_tokens, output_tokens and the timestamp.
2. Total volume in input-price units: input x1 + 5m-write x1.25 +
   1h-write x2 + read x0.1 (x0.05 on Opus 5.5, x0.025 on Fable) + output x5.
3. For every main-session gap between two calls of 5-60 min, count the
   context of the earlier call x1.25 as the re-write a 5-minute TTL would cost.
   Separately sum the gaps over 60 min whose next call was a real miss
   (cache write > 50 % of its context): that is what even 1h does not save.
4. Report: sessions/days covered, total units, share of the 5-60 min
   re-writes (= what promptCacheTtl "1h" protects in overage), share of the
   >60 min misses, and which TTL the transcripts show today.
5. If the 5-60 min share is >= 3 % of the volume, set "promptCacheTtl": "1h"
   in ~/.claude/settings.json (keep the file valid JSON, change nothing else)
   and tell me to check /usage -> "Prompt cache (main)" in a new session.
   Below 3 %, recommend leaving it and say why. Never delete or print
   transcript content.
```

How the cache works, in short: every API call (each tool call, not just each
message) re-sends the full context; an unchanged prefix is read from the cache
at ~0.1× the input price (0.05× on Opus 5.5), new content is written once at
2× (1h TTL). A pause longer than the TTL, a model switch, or a change in the
tool list (MCP server or plugin toggled mid-session) re-writes everything.
Keep one topic per session, run big reads in subagents, and `/compact` or
write a hand-off *before* a long break while the cache is still warm.

### Before reinstalling Windows (or moving to a new machine)

Claude Code keeps everything local in two places under your user profile.
Back these up; everything else is either regenerated or lives in your account.

| Path | What it holds | Back up? |
|---|---|---|
| `%USERPROFILE%\.claude\settings.json`, `settings.local.json`, `keybindings.json` | Permissions, hooks, enabled plugins, marketplaces, output style, cache TTL | **Yes** |
| `%USERPROFILE%\.claude\CLAUDE.md` | Your global instructions | **Yes** |
| `%USERPROFILE%\.claude\output-styles\`, `agents\`, `skills\`, `commands\` | Personal styles, agents, skills, slash commands | **Yes** |
| `%USERPROFILE%\.claude\projects\<project>\memory\` | Auto-memory per project | **Yes** |
| `%USERPROFILE%\.claude\scheduled-tasks\`, `scripts\`, statusline script | Desktop scheduled tasks and your own helper scripts | **Yes** |
| `%USERPROFILE%\.claude\plugins\installed_plugins.json`, `known_marketplaces.json` | Which plugins and marketplaces are installed | Yes (small) |
| devops state in `%USERPROFILE%\.claude\` (`delegation.json`, `devops-*.json`, `token-config.json`) | Plugin preferences | Yes (small) |
| `%USERPROFILE%\.claude.json` | User-scoped MCP servers (`claude mcp add -s user`), per-project trust and state | **Yes** |
| `%APPDATA%\Claude\claude_desktop_config.json`, `config.json` | Desktop app settings and its MCP servers | **Yes** |
| `%USERPROFILE%\.claude\projects\*.jsonl`, `history.jsonl` | Session transcripts and prompt history (can be GBs) | Optional — only for `--resume` of old sessions |
| `%USERPROFILE%\.claude\plugins\cache\`, `cache\`, `debug\`, `shell-snapshots\`, `telemetry\`, `file-history\` | Caches and logs | No — regenerated |
| `%USERPROFILE%\.claude\.credentials.json` | Login token | **No** — never copy or sync it; run `/login` after the reinstall |
| `%APPDATA%\Claude\` (everything else) | Browser caches of the desktop app | No |

Not on disk, nothing to back up: claude.ai connectors, published artifacts,
cloud sessions and routines — they belong to your account.

**Your code is the bigger risk.** Unpushed commits and uncommitted work in
worktrees (`<repo>\.claude\worktrees\…`) are gone with the disk. Before
reinstalling, ship or at least push every branch: `git log --branches --not --remotes`
lists what only exists locally.

**Make it a habit, not an emergency.** Keep the "Yes" rows in a private git
repo (dotfiles) and restore them with a copy after reinstalling Claude Code —
exclude `.credentials.json`, transcripts and caches. The opt-in
[Claude home backup](#claude-home-backup-optional-opt-in) does exactly this
for `~/.claude` every day, with a secret and private-data scan. After restoring:
install Claude Code, `/login`, then `claude plugin update` pulls every plugin
from the restored marketplaces.

## Features

- **<!--devops:count:hooks-->87<!--/devops:count:hooks--> Hooks** — automated guards and triggers across the full session lifecycle
- **<!--devops:count:skills-->14<!--/devops:count:skills--> Skills** — doors do-ship (incl. promote mode), do-run (backlog, autonomous, burn, rethink, audit modes), do-learn, do-batch; hidden workers auto-cleanup, auto-fix, auto-concept, auto-guide, auto-extend, auto-update, auto-harden, auto-polish, auto-agents, auto-issue. README standards, graphify, usage data, strict mode and project setup are knowledge + hooks, not skills
- **<!--devops:count:agents-->12<!--/devops:count:agents--> Agents** — AI, Core, Designer, Feature, Frontend, PO, QA, Redteam, Research, Rethinker, Scout, Concept-Author
- **Completion Card** — mandatory card after every task (11 variants plus pending, concept and batch overrides): three result lines, evidence, one decision — on the Desktop app a widget with buttons
- **V&V Gate** — every code change states how each requirement was verified; an unverified finish is stamped on the card
- **Ship Pipeline** — intent detection, PR command blocking, `/do-ship` builds, bumps, merges and releases to `alpha`; promotions re-tag the same commit on `beta` / `stable`
- **Delegation Policy** — always-on tiers decide when a task gets background agents, with a budget class from your live plan usage
- **3-Layer Extension Model** — customize any skill or agent per-project without forking

## What it does

### Hooks (automatic, no user action needed)

<!--devops:count:hooks-->87<!--/devops:count:hooks--> hooks fire automatically across the session lifecycle — no user action needed.

<details>
<summary><strong>By session lifecycle</strong> — when does it fire?</summary>

```
SessionStart  ──>  UserPromptSubmit  ──>  PreToolUse  ──>  PostToolUse  ──>  Stop
                                           (SubagentStart / SubagentStop around each spawned agent)
```

<!--devops:block:hook-lifecycle-->
#### SessionStart — runs once when a session begins

- `ss.plugin.update` — Auto-update plugin marketplace clones, rebuild cache, and update registry.
- `ss.permissions.ensure` — Ensure required plugin permissions exist so devops skills that write ephemeral review…
- `ss.statusline.ensure` — Enables the native usage source.
- `ss.thinking.display` — Keeps chat text verbatim on progress-update models.
- `ss.knowledge.index` — Inject the always-on policy docs in full (ALWAYS_ON below) plus a compact deep-knowle…
- `ss.mcp.deps` — Auto-install MCP server dependencies into CLAUDE_PLUGIN_DATA, and self-heal partial i…
- `ss.mcp.envcheck` — Detect enabled plugins whose .mcp.json references env vars that are not set.
- `ss.mcp.verify` — Verify every MCP server declared in this plugin's .mcp.json has its entry file presen…
- `ss.mcp.failcache` — Clear the plugin's entries from Claude Code's machine-wide MCP failure cache, so one…
- `ss.mcp.reap` — Reclaim orphaned Claude Desktop MCP server processes leaked by previously-closed sess…
- `ss.watchdog.reap` — Removes expired ClaudeAutonomousWatchdog-* scheduled tasks left behind by earlier aut…
- `ss.tmp.sweep` — Removes the plugin's own dotclaude-* temp markers older than 48 h from the OS temp di…
- `ss.tokens.scan` — Scan project for expensive files and update config for the pre.tokens.guard hook.
- `ss.project.setup` — The automatic part of project setup (the former /setup-project skill; its interactive…
- `ss.git.check` — Check for stale changes AND workspace setup issues at session start.
- `ss.git.sync` — Starts ONE detached background git sync for this worktree.
- `ss.orphan.nudge` — One-line nudge when the current repo has unlanded work or worktrees with uncommitted…
- `ss.graphify` — graphify enforcement — install-check + auto-build wiring for the graphify integration…
- `ss.ship.verify` — Surface results from the post-merge watcher (post-ship CI + optional deploy verify).
- `ss.ship.resume` — Keep a running /do-ship stable across a compaction or a resume.
- `ss.run.task` — Keep a running do-run's task verbatim across a compaction or a resume.
- `ss.concept.resume` — Recover an open concept session after a Claude restart.
- `ss.team.changelog` — Show a summary of changes made by other contributors on remote main since the last ti…
- `ss.governor.attach` — Registers the session with the Claude load governor and starts its watcher detached (…

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
- `prompt.skill.overrides` — Two jobs of the override loader (lib/skill-overrides.js) on a user prompt: - a skill…
- `prompt.strict.enforce` — Arms and enforces strict mode — literal scope, discretionary parameters.
- `prompt.ship.detect` — Detect ship intent in user prompts and inject Skill('devops:do-ship') instruction.
- `prompt.flow.appstart` — Detect app start intent in user prompts.
- `prompt.burn.resume` — After a usage limit stopped a burn: ask on a manual nudge, apply the chosen policy on…
- `prompt.worktree.branch-guard` — Prevents working without a dedicated branch inside a linked worktree.
- `prompt.governor.resume` — Tells the session when deferred heavy commands can run again.

#### PreToolUse — runs before each tool call

- `pre.tokens.guard` — Block Read/Bash/Glob/Grep operations that would consume a significant percentage of t…
- `pre.ship.guard` — Block manual PR creation/merging via Bash.
- `pre.main.guard` — Prevent accidental writes on local main/master.
- `pre.worktree.split-guard` — WARN (never block) on git-mutating work driven from the main repo root while an agent…
- `pre.issue.guard` — Block raw GitHub issue writes (gh issue, gh api, MCP) unless auto-issue ran this turn.
- `pre.crawl.guard` — Block recursive scans of a filesystem root, a drive root or the whole home directory.
- `pre.cleanup.gate` — While /auto-cleanup is armed in this session (post.cleanup.gate), refuses every branc…
- `pre.plugin.scope` — Block hand-edits of installed devops plugin artifacts from a consumer project.
- `pre.edit.branch` — Prevent Edit/Write tool calls while HEAD is on local main/master.
- `pre.readme.standards` — Once per session, before the first substantial write to a README file, points Claude…
- `pre.mcp.health` — Detects dead or stale MCP servers before tool calls fail cryptically.
- `pre.session.archive` — Only the post-ship hand-over archives this session (#632).
- `pre.strict.agent-gate` — While strict mode is active, refuse an Agent spawn whose prompt does not start with t…
- `pre.agent.model` — Refuses an Agent spawn once when it would silently inherit the session model — no `mo…
- `pre.agent.announce` — Makes every Agent spawn visible to the user: resolves the agent's effective model and…
- `pre.ship.delegate` — Keeps the ship-delegation threshold where the model starts a ship itself.
- `pre.agent.relay` — Holds back the first tool call after an agent launch whose card (pre.agent.announce)…
- `pre.run.contract` — Refuse (exit 2) the tool call that would walk past an open obligation of the do-run R…
- `pre.governor.gate` — Admission gate of the Claude load governor.

#### SubagentStart — runs when a subagent is spawned

- `sub.plugin.root` — Give every subagent the literal devops plugin root.

#### SubagentStop — runs when a subagent finishes

- `substop.agent.wip` — A finished agent that ran in an isolated worktree (.claude/worktrees/agent-*) and lef…

#### PostToolUse — runs after each tool call

- `post.flow.completion` — Keeps the completion-card contract in Claude's context: on the FIRST tool call of eve…
- `post.flow.debug` — After 2+ consecutive shell failures: MANDATE the devops `auto-fix` skill before the n…
- `post.graphify.query` — When Claude runs `graphify query ...`, record a per-session flag (`markQueryDone` — k…
- `post.graphify.search` — Telemetry only: record every Grep/Glob that actually RAN (`search_ran`) with its resu…
- `post.concept.gate` — Deterministic backstop for concept pages.
- `post.claude.budget` — Deterministic context-budget gate for Claude configuration files — CLAUDE.md, SKILL.m…
- `post.agent.nudge` — AUD-024: outside a do-run run, a single turn can change many files without ever spawn…
- `post.design.remind` — Once per context, when a UI file is written or edited, reminds Claude of the standing…
- `post.run.contract` — Record what happened for the do-run RUN CONTRACT (spec A events, B arming, E batch ma…
- `post.ask.answers` — Answer-check (run-contract spec F): an AskUserQuestion answer token that equals the O…
- `post.cleanup.gate` — Arms and feeds the /auto-cleanup deletion gate (lib/cleanup-gate.js).
- `post.skill.marker` — Record a loaded skill in the caller's per-turn marker (lib/skill-turn-marker) — the "…
- `post.skill.overrides` — The override loader for a skill started through the Skill tool: resolves the skill's…
- `post.flow.title-mode` — Hands Claude the exact session title a skill's mode step needs, so the skill no longe…
- `post.project.setup` — Runs `ss.project.setup`'s logic right after a mid-session `git init` instead of waiti…
- `post.governor.clear` — Clears the foreground marker pre.governor.gate recorded for this tool call: Claude no…
- `post.worktree.enter` — Carries this session's live do-run contract along when the session moves from the rep…

#### Stop — runs when Claude finishes responding

- `stop.git.sync` — Throttled background git sync at turn end.
- `stop.flow.browsertest` — Light-verification enforcement gate (the "V" of the V&V gate).
- `stop.agent.relay` — Blocks the turn end once when an agent launch of this turn never showed its card (lib…
- `stop.flow.guard` — Per-turn completion card + validation enforcement (the validation half of the V&V gate).
- `stop.guide.handoff` — Offer the auto-guide skill when Claude's own answer hands the user a manual click-thr…
- `stop.strict.release` — Settles the lifetime of an inline strict mode at the end of the turn that armed it.
- `stop.mcp.reap` — Periodic background reclaim of orphaned Claude Desktop MCP server processes — the "ru…
- `stop.session.autosave` — Safety net for session worktrees: a turn that ends with uncommitted work or unpushed…
<!--/devops:block:hook-lifecycle-->

</details>

<details>
<summary><strong>By category</strong> — what does it guard?</summary>

<!--devops:block:hook-categories-->
#### tokens & load — keep the context window and the machine free

- `ss.tokens.scan` *(SessionStart)*
- `ss.governor.attach` *(SessionStart)*
- `prompt.governor.resume` *(UserPromptSubmit)*
- `pre.tokens.guard` *(PreToolUse)*
- `pre.crawl.guard` *(PreToolUse)*
- `pre.governor.gate` *(PreToolUse)*
- `post.claude.budget` *(PostToolUse)*
- `post.governor.clear` *(PostToolUse)*

#### git & branches — keep work in sync and off main

- `ss.git.check` *(SessionStart)*
- `ss.git.sync` *(SessionStart)*
- `ss.orphan.nudge` *(SessionStart)*
- `prompt.git.sync` *(UserPromptSubmit)*
- `prompt.worktree.branch-guard` *(UserPromptSubmit)*
- `pre.main.guard` *(PreToolUse)*
- `pre.worktree.split-guard` *(PreToolUse)*
- `pre.cleanup.gate` *(PreToolUse)*
- `pre.edit.branch` *(PreToolUse)*
- `pre.session.archive` *(PreToolUse)*
- `post.cleanup.gate` *(PostToolUse)*
- `post.worktree.enter` *(PostToolUse)*
- `stop.git.sync` *(Stop)*
- `stop.session.autosave` *(Stop)*

#### ship — the release pipeline

- `ss.ship.verify` *(SessionStart)*
- `ss.ship.resume` *(SessionStart)*
- `prompt.ship.detect` *(UserPromptSubmit)*
- `pre.ship.guard` *(PreToolUse)*
- `pre.ship.delegate` *(PreToolUse)*

#### flow — completion card, verification, session title

- `prompt.flow.open-url` *(UserPromptSubmit)*
- `prompt.batch.collect` *(UserPromptSubmit)*
- `prompt.flow.silent-turn` *(UserPromptSubmit)*
- `prompt.flow.title-work` *(UserPromptSubmit)*
- `prompt.flow.appstart` *(UserPromptSubmit)*
- `post.flow.completion` *(PostToolUse)*
- `post.flow.debug` *(PostToolUse)*
- `post.ask.answers` *(PostToolUse)*
- `post.flow.title-mode` *(PostToolUse)*
- `stop.flow.browsertest` *(Stop)*
- `stop.flow.guard` *(Stop)*
- `stop.guide.handoff` *(Stop)*

#### agents & runs — delegation, do-run contract, burn

- `ss.run.task` *(SessionStart)*
- `prompt.run.contract` *(UserPromptSubmit)*
- `prompt.burn.resume` *(UserPromptSubmit)*
- `pre.agent.model` *(PreToolUse)*
- `pre.agent.announce` *(PreToolUse)*
- `pre.agent.relay` *(PreToolUse)*
- `pre.run.contract` *(PreToolUse)*
- `substop.agent.wip` *(SubagentStop)*
- `post.agent.nudge` *(PostToolUse)*
- `post.run.contract` *(PostToolUse)*
- `stop.agent.relay` *(Stop)*

#### skills & knowledge — routing, overrides, injected docs

- `ss.knowledge.index` *(SessionStart)*
- `ss.concept.resume` *(SessionStart)*
- `prompt.knowledge.dispatch` *(UserPromptSubmit)*
- `prompt.skill.enforce` *(UserPromptSubmit)*
- `prompt.skill.overrides` *(UserPromptSubmit)*
- `prompt.strict.enforce` *(UserPromptSubmit)*
- `pre.readme.standards` *(PreToolUse)*
- `pre.strict.agent-gate` *(PreToolUse)*
- `post.concept.gate` *(PostToolUse)*
- `post.design.remind` *(PostToolUse)*
- `post.skill.marker` *(PostToolUse)*
- `post.skill.overrides` *(PostToolUse)*
- `stop.strict.release` *(Stop)*

#### plugin & MCP — updates, dependencies, server health

- `ss.plugin.update` *(SessionStart)*
- `ss.permissions.ensure` *(SessionStart)*
- `ss.statusline.ensure` *(SessionStart)*
- `ss.thinking.display` *(SessionStart)*
- `ss.mcp.deps` *(SessionStart)*
- `ss.mcp.envcheck` *(SessionStart)*
- `ss.mcp.verify` *(SessionStart)*
- `ss.mcp.failcache` *(SessionStart)*
- `ss.mcp.reap` *(SessionStart)*
- `ss.watchdog.reap` *(SessionStart)*
- `ss.tmp.sweep` *(SessionStart)*
- `ss.project.setup` *(SessionStart)*
- `prompt.plugin.scope` *(UserPromptSubmit)*
- `pre.plugin.scope` *(PreToolUse)*
- `pre.mcp.health` *(PreToolUse)*
- `sub.plugin.root` *(SubagentStart)*
- `post.project.setup` *(PostToolUse)*
- `stop.mcp.reap` *(Stop)*

#### issues, team & graph

- `ss.graphify` *(SessionStart)*
- `ss.team.changelog` *(SessionStart)*
- `prompt.issue.detect` *(UserPromptSubmit)*
- `pre.issue.guard` *(PreToolUse)*
- `post.graphify.query` *(PostToolUse)*
- `post.graphify.search` *(PostToolUse)*
<!--/devops:block:hook-categories-->

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
| `/auto-agents` | Hidden · Skills | The execution path for everything that implements (do-run, auto-fix, auto-harden, auto-polish, a concept's implement step): applies the delegation tiers, shows one agent card, runs the waves; full ceremony (plan → confirm → waves) only on a yes |
| `/do-run autonomous` | Explicit | Fully autonomous agent orchestration while user is AFK |
| `/do-run burn` | Explicit | Turns budget that would expire this week into landed work: depth per task first, lanes only to fill time; a limit stop is asked about, never burned through |
| `/do-run backlog` | Explicit | Milestone-centric backlog runner: refine, implement, test/QA, and ship selected milestones/issues unsupervised |
| `/do-learn` | Explicit | Capture long-term learnings and route to project-specific instructions |
| `/auto-harden` | Hidden · Router | Stabilization pass: full test suite, autonomous bug fixes, regression + consistency |
| `/auto-polish` | Hidden · Router + `/do-ship` | UI refinement: visual consistency, state-visuals, UI-side functionality checks |
| `/do-run rethink` | Explicit | Strategic reset for stuck development: code-blind fresh approaches, autonomous decision (concept page only for a real fork), autonomous implementation |
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

**Strict mode** — the deliverable is exactly what the prompt names, complete
with the tests, docs and callers of the changed thing; unnamed attributes are chosen and reported; it propagates to agents, skills and concept
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
something**, reach for `/do-run`. Without a mode it asks one short question
set (what · how · scope · passes) and implements your prompt through
`auto-agents`, the multi-agent execution path, while you stay present. There
are two ways in:

- **`/do-run backlog` — Claude picks the topics itself.** It pulls the planned
  backlog (open milestones, else loose issues), then refines → implements → tests →
  **ships** each item unsupervised. An optional **budget mode** (asked at the gate,
  default *no*) adds burn depth per issue. Under the hood it composes the other
  runs, so you don't invoke them separately.
- **You pick the topic** with the other modes:
  - **`/do-run autonomous`** — one ad-hoc task, fully AFK; it ships at the end
    only when you chose that at the start (default: you ship by hand).
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
  stuck development, decided autonomously (a concept page only for a real
  fork), then implemented — no questions asked.
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
session) / `sonnet-only`. An explicit `/do-run` is never asked or downgraded.
Switch it off per project or machine: `.claude/delegation.json` (or
`~/.claude/delegation.json`) with `{"mode":"off"}` — no proactive agents, no
offers — or `{"mode":"ask"}` — every agent tier is offered first and runs only on
a yes. An explicit `/do-run` and "with agents" in a prompt always still spawn.
Every spawn shows an agent card (agent · task · model · effort) in the chat.

| Agent | Role |
|---|---|
| **ai** | AI/ML integration |
| **core** | Business logic, APIs and platform code (Windows: `deep-knowledge/windows-platform.md`) |
| **designer** | UX/UI design, tokens, and specs |
| **feature** | One feature end to end: elaborate (po lenses → synthesis) when unrefined, build, verify |
| **frontend** | UI components and styling |
| **po** | Product judgment: one lens (customer · tech · business) or the synthesis/review that weighs them |
| **qa** | Test, verify, screenshot |
| **redteam** | Adversarial review: failure modes, blind spots, hidden risks |
| **research** | Deep-dive investigations |
| **scout** | Read-only locator (haiku · medium): "where/how is X?" sweeps, answer + `path:line` evidence |
| **rethinker** | Code-blind fresh-approach ideation through one lens |
| **concept-author** | Writes one follow-up concept round from a brief and builds the page (opus · high), so long concepts keep the session context small |

## Completion Cards

Every task ends with a completion card — one page, three result lines that
answer the prompt, one decision. It is always the last thing in the response.
Full spec: [completion-card-design.md](plugins/devops/deep-knowledge/completion-card-design.md).

**ship-successful** in a channel (ring) project — rendered by the real card
renderer, the way a terminal shows it:

<!--devops:block:card-example-->
````
---

### **✨✨✨ Filter dialog moved to settings ✨✨✨**
› Settings now has a Filter tab with drag & drop, replacing the old dialog
› The old dialog route still works and redirects to the new tab
✓ 3/3 Requirements  ✓ 47 tests green
✓ commit → ✓ push → ✓ PR #42 → ✓ merge   main · Build a3f9b21
alpha **v0.8.3** › beta v0.8.1 (−2) › stable v0.7.9 (−4 · 9 d)

## 🟩 🚀 Released Alpha — v0.8.3 — promote to beta?

---
````
<!--/devops:block:card-example-->

Two blocks, nothing between them. Block 1 ("what happened"): the title, up to
three `›` result lines naming an effect for the user (never a file or hook),
the evidence row (requirements · tests · live check, deviations first), the
pipeline line (commit → push → PR → merge · branch · build), the channel
ladder in ring projects, and — once a usage window is worth a look — the
budget line `5h ▰▰▰▰▰▰▰│▱▱▱▱▱▱ 3 h 12 m   Wk ▰▰│▱▱▱▱▱▱ 5 d 3 h` (bar =
elapsed time, `│` = usage). Block 2 ("what to decide"): a heading that leads
with the same status and activity icons as the session title and asks one
question, an optional context line, and at most three numbered points.

On the Claude Desktop app the whole card is one widget instead of markdown:
the same content plus the buttons for the variant's verbs (`Ship` / `Ändern`,
`Fix` / `Skip`, `Promote beta`, `Nachbessern` with a prepared answer,
`App starten`, `Web-Guide starten`), each with a tooltip. The terminal shows
the question heading alone.

<details>
<summary><strong>All variants</strong> — the decision heading each one ends with</summary>

<!--devops:block:card-variants-->
| Variant / state | Decision heading | When |
|---|---|---|
| `ready` | 👉 📦 Ready — Ship? | Code or doc changes, nothing open, no app to start |
| `ready + open point` | 👉 ❓ Question — Also retry on HTTP 503? | A decision is still the user's (`open`) — Ship is not offered until it is answered |
| `ready + red tests` | 👉 ⚠️ Red tests — Ship anyway with 2 red tests? | Tests are red or a requirement is unmet — line 1 says what was not achieved |
| `test` | 👉 🧪 Test — Test first, then ship? | Code changed and the app can be started — the user tests first |
| `test-minimal` | 🟩 ✨ Started — have fun | The user only asked to start the app, nothing was edited |
| `ship-blocked` | 👉 🚧 Blocked — Bypass tsc error and ship anyway? | The ship pipeline ran but did not merge |
| `ship-successful (plain)` | 🟩 🚀 Released Alpha — v1.4.0 → main. | Merged to main in a project without release channels |
| `ship-successful (ring)` | 🟩 🚀 Released Alpha — v1.4.0 — promote to beta? | Merged and released to alpha in a channel (ring) project |
| `released → beta` | 🟩 🎊 Beta — v1.4.0 — to stable? | A promotion re-tagged the same commit on beta |
| `released → stable` | 🟩 🎊 Stable — v1.4.0 — done. | A promotion reached stable — nothing left to decide |
| `ready-files` | 👉 📦 Files — Done on disk — anything else? | Files changed outside any git repository |
| `analysis` | 🟩 📊 Analysis — read through — questions? | An answer or investigation — nothing changed anywhere |
| `aborted` | 🟥 📦 Aborted — aborted because of no write access — try differently? | The task was stopped, infeasible or hit a limit |
| `fallback` | 🟩 🖥️ System — done — anything else? | Work done outside the repo with no repo diff (a setting, a deploy, a DB operation) |
| `paused` | 🟦 🔌 Restart — restart Claude Code | The user pauses, or the next step is a restart, a reboot or a usage-limit reset |
| `pending (override)` | ⏳ 🤖 Team — not done yet — agent `qa` is working | Background agents still run — replaces the decision of any variant |
<!--/devops:block:card-variants-->

Headings follow the user's language; this table is the English rendering.
The session title in the Desktop sidebar carries the same status and
activity icons (`👉` your move · `⏳` Claude works · `🟩` done · `🟥`
aborted · `🟦` paused).

</details>

## Project Structure

```
plugins/
├── devops/                        ← the core plugin
│   ├── .claude-plugin/plugin.json ← Plugin manifest (SemVer, tags v0.x.y)
│   ├── .mcp.json                  ← MCP servers: completion card, ship, issues
│   ├── CONVENTIONS.md             ← Naming, versioning, extension rules
│   ├── hooks/                     ← <!--devops:count:hooks-->87<!--/devops:count:hooks--> hooks (JS) registered in hooks.json
│   ├── skills/                    ← <!--devops:count:skills-->14<!--/devops:count:skills--> skill definitions (SKILL.md)
│   ├── agents/                    ← <!--devops:count:agents-->12<!--/devops:count:agents--> agent definitions
│   ├── mcp-server/                ← Card renderer + Desktop widget, ship tools, issue matching
│   ├── deep-knowledge/            ← Cross-cutting reference docs (<!--devops:count:dk-->56<!--/devops:count:dk--> topics)
│   ├── scheduled-tasks/           ← Runbooks for opt-in background jobs
│   ├── evals/                     ← Behavioral evals and skill A/B runs (ab-run.js)
│   ├── templates/                 ← Output style, changelog and release templates
│   ├── scripts/                   ← CLI helpers (README generator, burn plan, API credit, …)
│   └── docs/                      ← Architecture page and design notes
└── local-llm/                     ← Optional token saver backed by AnythingLLM
```

## Troubleshooting

### Plugin update not showing

Claude Code caches plugin marketplace data globally. If `claude plugin update` reports no update available despite a new version being published, clear the global marketplace cache:

```bash
# Git Bash on Windows, WSL, macOS, Linux
rm -rf ~/.claude/plugins/cache/dotclaude
rm -rf ~/.claude/plugins/marketplaces/dotclaude
rm -f ~/.claude/plugins/install-counts-cache.json
```

Then add the marketplace and install again (see [Installation](#installation)). Start a new session for changes to take effect.

### Update installed but the session still runs the old version

A session keeps the MCP servers it started with. When the card shows
`ℹ Session server v<old> — restarting the session loads v<new>.`, start a new
session. On a `stable` pin a fresh ship does not reach you until it is
promoted — see [Updates](#updates).
