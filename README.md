# dotclaude

**Version: 0.324.0**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

DevOps automation plugin for Claude Code: you say what you want, Claude builds,
tests, ships and reports back on one card. Hooks, skills, agents and MCP tools
keep git clean, block risky moves and stop context waste.

> ⚠ **AI runs commands on your machine** — shell commands, file edits, pushes,
> app launches. Safeguards reduce the risk but do not replace your review. Work
> in a versioned tree, keep backups. **Use at your own risk.**

**Contents:** [Install](#install) · [Update](#update) · [Everyday use](#everyday-use) ·
[Completion card](#completion-card) · [Recommended setup](#recommended-setup) ·
[Optional features](#optional-features) · [Customize](#customize) ·
[Reference](#reference) · [Troubleshooting](#troubleshooting)

## What you get

- **Ship in one sentence** — "ship it" builds, bumps the version, opens and merges the PR, tags `alpha`; promotions re-tag the same commit on `beta` / `stable`
- **One card per task** — three result lines, the evidence (requirements · tests · live check) and one decision; on the Desktop app with buttons
- **Guard rails** — no writes on `main`, no force-push, no manual PRs past the pipeline, no oversized reads that burn your context
- **Agents when they pay off** — background agents for research, sweeps, tests and reviews, scaled to your live plan usage
- **Runs while you are away** — `/do-run` works off a backlog, a task or the leftover weekly budget, and ships each item
- **Per-project tuning** — extend any skill with a `reference.md`, no fork

<!--devops:count:hooks-->91<!--/devops:count:hooks--> hooks ·
<!--devops:count:skills-->14<!--/devops:count:skills--> skills ·
<!--devops:count:agents-->12<!--/devops:count:agents--> agents ·
~0.7M tokens/week overhead (1–4 % of a Max plan), paid back 1.5–6× by the
token guard alone — see [Token math](#token-math).

## Install

Needs **git** and **Node.js 18.18+**. Desktop and CLI keep separate plugin
stores — install where you work.

1. **Claude Code** — paste into any session (Desktop or CLI):
   ```
   Install the devops plugin by following https://github.com/Jerry0022/dotclaude/blob/main/INSTALL.md
   ```
2. **CLI:**
   ```bash
   claude plugin marketplace add Jerry0022/dotclaude
   ```
   ```bash
   claude plugin install devops@dotclaude
   ```
3. **Manually (Desktop app):** Sidebar → **Customize** → **+** next to *Personal Plugins* → add `Jerry0022/dotclaude` → enable **devops**.

Then start a new session — hooks and MCP servers load at session start.
Details, uninstall and Codex setup: [`INSTALL.md`](INSTALL.md).

## Update

1. **Claude Code:** say **"devops update"**
2. **CLI:** `claude plugin update devops@dotclaude`
3. **Manually:** turn on auto-update for the marketplace (Desktop: **Customize**; CLI: `/plugin` → **Marketplaces**)

<details>
<summary><strong>Release channels</strong> — alpha, beta, stable</summary>

Every ship lands on `alpha`; a promotion re-tags the same commit on `beta`,
then `stable` — never a rebuild. A fresh install follows `stable`. Pin another
channel in `~/.claude/plugins/.channels.json` (`{ "dotclaude": "alpha" }`) to
get every ship the moment it lands. Semantic versioning — breaking changes
only in major versions.

</details>

## Everyday use

Plain words are enough; the slash doors (`/do-*`) are in the menu, the rest is
picked from what you say.

| Say | What happens |
|---|---|
| "ship it" · `/do-ship` | Build, test, version bump, PR, merge, tag `alpha`, cleanup — then the card |
| "promote to stable" | Re-tag the shipped commit on `beta` / `stable` (no rebuild) |
| `/auto-fix` (on request) | Root-cause analysis first, then the fix |
| "concept page for …" | Interactive HTML page with options to pick; your choices flow back |
| `/do-run` | Bigger work: implement a prompt with agents, work off the backlog, run AFK, burn leftover budget, rethink a stuck area, full audit |
| "harden" · "polish" | Stabilize (tests, bugs, consistency) · refine the UI |
| "devops learn …" · `/do-learn` | Turn a correction into a lasting project rule |
| `/do-batch` | Collect prompts first, run them later as one plan |
| "strict on" · "strict: <task>" | Deliver exactly what was named, nothing extra |

<details>
<summary><strong>All skills</strong> — doors, hidden workers, former skills</summary>

Doors (`do-*`) are in the slash menu. Workers (`auto-*`) are hidden from it:
Claude starts them from your words, the trigger router or a hook. Old names
(`/ship`, `/fix`, `/concept`, `/run-backlog`, `/promote`, …) still map to the
new skill, and project extensions under an old name keep loading.

| Skill | Invocation | Purpose |
|---|---|---|
| `/do-ship` | Explicit + Hook | Full shipping pipeline: build, version, PR, merge, cleanup |
| `/do-ship promote` | Explicit | Channel promotion (alpha→beta→stable): re-tag the same SHA, no rebuild |
| `/do-run` | Explicit + Router | Door for every run: picks the mode below or implements the prompt through `auto-agents` |
| `/do-run backlog` | Explicit | Refine, implement, test and ship planned milestones/issues unsupervised |
| `/do-run autonomous` | Explicit | One task fully AFK; ships at the end only when chosen at the start |
| `/do-run burn` | Explicit | Turns budget that would expire this week into landed work; asks at a limit stop, never burns through |
| `/do-run rethink` | Explicit | Code-blind fresh approaches for stuck development, decided and implemented autonomously |
| `/do-run audit` | Explicit | Full-spectrum audit (functional, visual, a11y, logging, performance, …), then fixes or a concept page |
| `/do-learn` | Explicit | Capture long-term learnings and route them to project-specific instructions |
| `/do-batch` | Explicit + Hook | Collect prompts into `.claude/batch.md`, then merge them into one feasibility-checked plan |
| `/auto-agents` | Hidden · Skills | Execution path for everything that implements: delegation tiers, one agent card, waves; full ceremony only on a yes |
| `/auto-fix` (on request only) | Hidden · Hook | Root-cause analysis, diagnostics, fix cycle |
| `/auto-concept` | Hidden · Router | Interactive HTML page for analysis, plans, concepts, prototypes |
| `/auto-harden` | Hidden · Router | Full test suite, autonomous bug fixes, regression + consistency |
| `/auto-polish` | Hidden · Router + `/do-ship` | UI refinement and the standing UI rules (`deep-knowledge/ui-defaults.md`) |
| `/auto-cleanup` (trigger: "branch cleanup") | Hidden · Card hint + Router | Branch/worktree/PR hygiene page; open PRs land one after another via `/do-ship` |
| `/auto-issue` | Hidden · Hook | GitHub issue creation and refinement — the single owner of every issue write |
| `/auto-guide` | Hidden · Hook | Live step-by-step overlay in your browser for logins, API keys and settings Claude cannot do itself |
| `/auto-extend` | Hidden | Scaffold or adapt project-level skill extensions |
| `/auto-update` | Hidden | Update the plugin ("devops update") |

**Former skills, now knowledge + hooks:** `/setup-readme` → `readme-standards.md`,
`/auto-usage` → `usage.md` (the card fetches
usage itself), `/claude-strict` → `strict.md`. A prompt naming one gets a
pointer to the doc.

**Strict mode** — the deliverable is exactly what the prompt names, with the
tests, docs and callers of the changed thing; it carries over to agents and
skills. `strict on` / `strikt an` (this worktree + branch) · `strict off` ·
`strict status` · `strict: <task>` or "nur das ändern" (one task). A bare
"strict" arms nothing.

</details>

## Completion card

Every task ends with one card — always the last thing in the response. This
example is rendered by the real renderer, as a terminal shows it:

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

Top block: what happened — result lines, evidence, where the change lies
(commit → push → PR → merge, channel ladder), and the usage bars once a window
is worth a look. Bottom block: one decision. On the Desktop app the card is a
widget with buttons (`Ship`, `Ändern`, `Fix`, `Promote beta`, `Nachbessern`
with a prepared answer, `App starten`, …), each with a tooltip.

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

Headings follow your language; this is the English rendering. The Desktop
session title carries the same icons (`👉` your move · `⏳` Claude works ·
`🟩` done · `🟥` aborted · `🟦` paused). Full spec:
[completion-card-design.md](plugins/devops/deep-knowledge/completion-card-design.md).

</details>

## Recommended setup

### Quiet output style

Claude narrates a lot. With this plugin decisions arrive as dialogs, analyses
as concept pages and results as the card — the narration is noise. The Quiet
style keeps answers, drops narration, and relays only what the plugin marks
for you, in your language.

1. **Claude Code** — paste into a session with the plugin installed:
   ```text
   Set up the Quiet output style: copy the newest
   ~/.claude/plugins/cache/dotclaude/devops/*/templates/output-style-quiet.md
   to ~/.claude/output-styles/quiet.md (create the directory if needed), set
   "outputStyle": "Quiet" in ~/.claude/settings.json, then tell me to start a
   new session. Do not change anything else.
   ```
2. **CLI:** copy the file as above, then `/output-style Quiet` in a session
3. **Manually:** copy [`templates/output-style-quiet.md`](plugins/devops/templates/output-style-quiet.md) to `~/.claude/output-styles/quiet.md` and set `"outputStyle": "Quiet"` in `~/.claude/settings.json`

Start a new session afterwards.

<details>
<summary><strong>More about the style</strong></summary>

It is a personal setting, not a plugin rule, and sits in the system prompt, so
it does not fade over a long session. Every user-facing hook and tool block
opens with `Show the user this … verbatim` — the card, the workspace check,
the update notice — and only those reach you; instructions addressed to
Claude stay silent. Explicit questions still get a full answer. If the
Desktop app's "New output style" dialog asks you to sign in again, the CLI
token behind it expired: the file route needs no generator, and `claude` +
`/login` in a terminal repairs the dialog.

</details>

### Prompt cache TTL

> **Only matters in overage (usage credits).** Within your Pro/Max plan the
> main chat already caches for 1 hour; this setting changes nothing there.

- **Set `"promptCacheTtl": "1h"` in `~/.claude/settings.json`** (Claude Code
  ≥ 2.1.242). Why: in overage Claude Code silently drops the main chat to
  5 minutes, so every break of 5–60 min re-writes the whole context. Measured
  on 87k main-chat requests (Sept–Oct 2026): 1 h is 25–57 % cheaper than 5 min.
- **Leave subagents on 5 minutes** — do not set `subagentPromptCacheTtl`.
  Why: subagents write much and pause rarely; 1 h would make them 4–11 % more
  expensive (same data, 72k subagent requests).
- **Check it** with `/usage` → `Prompt cache (main)` in a new session — the
  TTL is read at start-up, a running session keeps its value.

<details>
<summary><strong>Measure first, then set</strong> — prompt for Claude, how the cache works</summary>

Paste into any session; it measures what the 1-hour TTL would have saved on
your own last sessions (local transcripts only, no extra model calls) and sets
it only when the effect is significant:

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

Keep the cache warm — each rule avoids a full re-write of the context:

- **One topic per session.** A model switch or an MCP server/plugin toggled
  mid-session re-writes everything.
- **Big reads in subagents.** Their tokens stay out of the main chat's prefix.
- **`/compact` or a hand-off *before* a break longer than 1 h**, while the
  cache is still warm.

How it is priced: every tool call re-sends the full context; an unchanged
prefix is read at ~0.1× the input price (0.05× on Opus 5.5), new content is
written once at 1.25× (5 min) or 2× (1 h).

</details>

## Optional features

All off by default. Turn each on by saying the phrase in a session.

| Feature | What it does | Turn on | Token cost |
|---|---|---|---|
| [Codex review](#codex) | Second-AI code review before each ship | install [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) | on the OpenAI side |
| [API credits](#claude-api-credits) | Read-only side work runs on your plan's monthly API credit first | "nutze mein API-Guthaben" | moves work off the plan |
| [Home backup](#claude-home-backup) | Daily push of `~/.claude` to a private GitHub repo, secret-scanned | "richte Home-Backup ein" | 0 after setup |
| [WIP watch](#wip-watch) | Weekly scan for un-landed branches, stashes, broken worktrees | "WIP-Wächter an" | 0 |

<a name="codex"></a>
<details>
<summary><strong>Codex</strong></summary>

Install [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) and the
`codex` CLI next to this plugin; no configuration needed. The ship pipeline
then runs a Codex review of the diff before the PR, `/auto-fix` hands an
unclear root cause to Codex, and QA/research agents use it for risky changes.
Every call has a hard timeout and a stored usage limit, so Codex never blocks a
ship. Setup: [INSTALL.md](INSTALL.md#optional-codex-integration).

</details>

<a name="claude-api-credits"></a>
<details>
<summary><strong>Claude API credits</strong></summary>

Max and Team plans include monthly API credits ($100 on Max 5x, $200 on Max
20x, up to $500 pooled on Team) that expire every cycle and do **not** cover
Claude Code itself. Switched on, the plugin runs its read-only side work there
first and falls back to the plan:

| Work | Runs on |
|---|---|
| Codebase sweeps, research, second-opinion reviews (`claude-api-agent.js`) | credit first, then an in-session agent |
| Codex second opinion when Codex is skipped (`claude-api-safe.js`) | credit |
| Month-end code audit (`api-credit-audit.js`, report in `~/.claude/devops-audits/`) | credit |
| Evals started from your own terminal | credit |
| Code-writing and test-running agents | always the plan |

Same price per token, far less context per agent (~2k instead of 30k+), and
none of it counts against the 5-hour window or the week.

1. **Claude Code:** say "nutze mein API-Guthaben" (or "API credits for devops") — Claude asks two questions once and can walk you through the Claude Console to create a key. Off: "API-Guthaben nicht mehr nutzen".
2. **CLI:** `node plugins/devops/scripts/claude-api-safe.js --status` (switches) · `--usage` (what the credit was spent on)

The key is read only as `DEVOPS_ANTHROPIC_API_KEY` from `~/.claude/devops-api.env`.
Never set `ANTHROPIC_API_KEY` for it — that switches Claude Code itself to API
billing. Purchased credits cannot be excluded; the workspace spend limit is the
guardrail. Runbook: [`api-credits.md`](plugins/devops/deep-knowledge/api-credits.md).

</details>

<a name="claude-home-backup"></a>
<details>
<summary><strong>Claude home backup</strong></summary>

Settings, `CLAUDE.md`, agents, your skills and commands, project memory and
helper scripts live only in `~/.claude`. The backup pushes them to a
**private** GitHub repo (default `<you>/claude-home`) once a day via Task
Scheduler / crontab — a plain node script, no Claude call.

- **Never included:** `.credentials.json`, `*token*` / `*secret*` / `*credential*` / `.env` files, transcripts, caches, `plugins/`, browser profiles, logs.
- **Before every commit** each file is scanned for secrets (private keys, `sk-` / `ghp_` / `AKIA` tokens, JWTs, `password=` values) and private data (e-mail, phone, IBAN, card numbers). A hit commits nothing and leaves `~/.claude/home-backup-report.txt` (file, line, rule — never the value); allow a finding on purpose in `~/.claude/.backupallow`.
- **On:** "richte Home-Backup ein" · **off:** "Home-Backup aus" (the repo stays).
- **Restore:** install Claude Code, move the fresh `~/.claude` aside, `git clone https://github.com/<you>/claude-home ~/.claude`, `claude plugin update`, then `/login`.

Runbook: [`home-backup.md`](plugins/devops/deep-knowledge/home-backup.md).

</details>

<a name="wip-watch"></a>
<details>
<summary><strong>WIP watch</strong></summary>

Once a week (default Sunday) a plain node script scans every git repo under
your roots (default `~/IdeaProjects`) against the existing `origin/<default>`
— no fetch, nothing deleted. Squash merges count as landed. Each finding gets
a suggestion: delete (in main), push + PR, reimplement on current main, commit
or discard a dirty worktree, secure or drop an old stash, `git worktree prune`.

You get one desktop notification only when a new finding appears. Its prompt
**`WIP-Report aufräumen`** opens the cleanup page with every suggestion
pre-selected; nothing runs before the dry-run confirmation. On: "WIP-Wächter
an" · off: "WIP-Wächter aus". Runbook: [`wip-watch.md`](plugins/devops/deep-knowledge/wip-watch.md).

</details>

## Customize

Every skill reads two extension layers on top of the plugin: your global
`~/.claude/skills/<skill>/reference.md` and the project's
`.claude/skills/<skill>/reference.md` (project wins).

1. **Claude Code:** say **"extend skill"** — Claude scaffolds or adapts the extension
2. **Manually:** create `your-project/.claude/skills/<skill>/reference.md`

Directive headings become orders — `## Add after Step 4`, `## Skip Step 3`,
`## Replace Step 2`; other text is an extra rule. The card names the override
it applied. Never name the file `SKILL.md` — Claude Code would load it as a
skill of its own. Example: `.claude/skills/do-ship/reference.md` with
"## Add after Step 1 — run ng build --prod". Full guide:
[`skill-extension-guide.md`](plugins/devops/deep-knowledge/skill-extension-guide.md).

<details>
<summary><strong><code>.claude</code> in git</strong> — one managed ignore block</summary>

What of `.claude/` is shared and what stays local is one policy, kept in ONE
marked block of `.gitignore` (`# >>> claude (managed) >>>`). Versioned:
`CLAUDE.md`, `.claude/settings.json`, `.claude/skills/`, `commands/`, `hooks/`,
`agents/`, `deep-knowledge/`, `.claude/project-map.md`,
`.claude/launch.example.json`, `docs/concepts/`. Local: `settings.local.json`,
`launch.json`, `worktrees/` and all plugin runtime state.

A new repository gets the block on its own; an existing one gets it in
`.git/info/exclude` until you move it over:

1. **Claude Code:** say "move this repo's .gitignore to the managed claude block"
2. **CLI:** `node plugins/devops/scripts/claude-ignore.js migrate` (idempotent; already-committed files are reported with their `git rm --cached` command, never untracked for you)

`claude-ignore.js env-example` writes a `.env.example` with key names only.

</details>

<details>
<summary><strong>Agents and delegation</strong> — when Claude spawns agents, how to switch it off</summary>

An always-on policy decides per task: inline for small work, one background
agent when the result is a conclusion (research, test runs, redteam), 2–3
parallel agents for two analysis lenses, a full multi-agent ceremony only
offered, never auto-started. A budget class from your live plan usage
(`free` / `ask-before-parallel` / `sonnet-only`) keeps it honest on small
plans; an explicit `/do-run` is never downgraded. Every spawn shows an agent
card (agent · task · model · effort).

Switch it per project or machine in `.claude/delegation.json` (or
`~/.claude/delegation.json`): `{"mode":"off"}` — no proactive agents —
or `{"mode":"ask"}` — every agent tier is offered first.

| Agent | Role |
|---|---|
| **ai** | AI/ML integration |
| **core** | Business logic, APIs and platform code |
| **designer** | UX/UI design, tokens, specs |
| **feature** | One feature end to end: elaborate, build, verify |
| **frontend** | UI components and styling |
| **po** | Product judgment: one lens (customer · tech · business) or the synthesis |
| **qa** | Test, verify, screenshot |
| **redteam** | Adversarial review: failure modes, blind spots |
| **research** | Deep-dive investigations |
| **scout** | Read-only locator (haiku): "where/how is X?" with `path:line` evidence |
| **rethinker** | Code-blind fresh-approach ideation through one lens |
| **concept-author** | Writes one follow-up concept round so long concepts keep the session small |

</details>

## Reference

<a name="token-math"></a>
<details>
<summary><strong>Token math</strong> — overhead, plan share, payoff</summary>

| Source | Tokens/week | Notes |
|---|---|---|
| SessionStart hooks (once per session) | ~8K | Update check, git check, token scan, MCP deps |
| Prompt guards (per message) | ~150K–250K | Ship detection, issue tracking, git sync — most exit silently |
| Tool guards (per tool call) | ~100K–200K | Token budget, ship and branch enforcement, agent cards |
| Always-on context (per session) | ~200K–400K | Delegation policy, knowledge index, card reminders — mostly cache reads |
| Skill invocations (~15–25/week) | ~15K–30K | Only when you call `/do-ship`, `/do-run`, … |
| **Total** | **~500K–900K** | **~0.7M tokens/week** |

| Plan | Model | Weekly budget (approx.) | Plugin overhead |
|---|---|---|---|
| Pro ($20) | Sonnet / Opus | ~10M / ~3M | **~7 % / ~23 %** |
| Max 5x ($100) | Sonnet / Opus | ~55M / ~18M | **~1.3 % / ~3.9 %** |
| Max 20x ($200) | Sonnet / Opus | ~225M / ~75M | **~0.3 % / ~0.9 %** |

*Rough estimates; Anthropic adjusts limits dynamically.*

**Payoff.** The token guard blocks any single operation above your plan's
share of the ~200K context window — **5 % (~10K) on Pro, 8 % (~16K) on Max 5×,
10 % (~20K) on Max 20×**; sub-agents get 4× that, capped at 50 %
(`subagentConfirmThresholdPct`, per agent `subagentTypeThresholdPct`). A
typical session attempts 5–15 reads of 20–80K tokens each; across ~10
sessions/week the guard saves **~1–4M tokens/week** — 1.5–6× the plugin's own
overhead. Plus 2–4 hours/week from git checks, the ship pipeline and
root-cause debugging.

</details>

<details>
<summary><strong>Supported stacks</strong> — what is tested, what degrades</summary>

| Area | Supported | Outside |
|---|---|---|
| **OS** | Windows, macOS, Linux | Core git / skill flows still run via Node + git |
| **Shell** | bash (Git-Bash on Windows), zsh | PowerShell / cmd untested |
| **Git hosting** | GitHub (`gh` CLI) | GitLab, Gitea, Bitbucket: issues, PRs and ship release fail; local / push-only flows work |
| **Default branch** | Auto-detected from `origin/HEAD` | Falls back to `main` |
| **Build system** | `npm` — `build`, `lint`, `test` scripts | No `package.json`: steps skipped; pnpm, yarn, pytest, cargo, … are not invoked |
| **Local LLM** | AnythingLLM Desktop | `local_generate` unavailable, everything else unchanged |
| **Node runtime** | Node.js 18.18+ | MCP server and hooks may fail to start |

A different stack: extend the skills per project — see [Customize](#customize).

</details>

<details>
<summary><strong>Hooks</strong> — <!--devops:count:hooks-->91<!--/devops:count:hooks--> hooks by lifecycle and by category</summary>

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
- `ss.orphan.nudge` — One-line nudge when the current repo has unlanded work, worktrees with uncommitted ch…
- `ss.ship.verify` — Surface results from the post-merge watcher (post-ship CI + optional deploy verify).
- `ss.ship.resume` — Keep a running /do-ship stable across a compaction or a resume.
- `ss.run.task` — Keep a running do-run's task verbatim across a compaction or a resume.
- `ss.concept.resume` — Recover an open concept session after a Claude restart.
- `ss.title.sweep` — Fixes sidebar titles a crash or an app quit left on ⏳.
- `ss.team.changelog` — Show a summary of changes made by other contributors on remote main since the last ti…
- `ss.governor.attach` — Registers the session with the Claude load governor and starts its watcher detached (…

#### UserPromptSubmit — runs when the user sends a message

- `prompt.flow.open-url` — Opens a local page in the default browser when the prompt is the card widget's open p…
- `prompt.batch.collect` — Collect mode for `/do-batch`: while active, blocks the user prompt (JSON `decision: "…
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
- `pre.redirect.scope` — Warn when a command redirects output (`> x.log`, `>> x`, `&> x`) to a path outside th…
- `pre.cleanup.gate` — While /auto-cleanup is armed in this session (post.cleanup.gate), refuses every branc…
- `pre.plugin.scope` — Block hand-edits of installed devops plugin artifacts from a consumer project.
- `pre.edit.branch` — Prevent Edit/Write tool calls while HEAD is on local main/master.
- `pre.readme.standards` — Once per session, before the first substantial write to a README file, points Claude…
- `pre.mcp.health` — Detects dead or stale MCP servers before tool calls fail cryptically.
- `pre.session.archive` — Only the post-ship hand-over archives this session (#632).
- `pre.ask.title` — Puts `👉 ➜ ❓ Question ┃ ` on the session title BEFORE a call blocks on the user (a qu…
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
- `substop.approval.clear` — A background agent ended: every permission wait it left in lib/approval-wait.js goes…

#### PermissionRequest — runs when a tool call waits for the user's permission

- `perm.approval.flag` — A background agent stopped at a tool permission dialog: puts the 👉 in the title's st…
- `perm.approval.watch` — The second half of perm.approval.flag: stays in the background (`asyncRewake`) until…

#### PostToolUse — runs after each tool call

- `post.flow.completion` — Keeps the completion-card contract in Claude's context: on the FIRST tool call of eve…
- `post.approval.clear` — A background agent's tool call finished: drops its permission wait (and every one the…
- `post.concept.gate` — Deterministic backstop for concept pages.
- `post.claude.budget` — Deterministic context-budget gate for Claude configuration files — CLAUDE.md, SKILL.m…
- `post.agent.nudge` — AUD-024: outside a do-run run, a single turn can change many files without ever spawn…
- `post.design.remind` — Once per context, when a UI file is written or edited, reminds Claude of the standing…
- `post.run.contract` — Record what happened for the do-run RUN CONTRACT (spec A events, B arming, E batch ma…
- `post.ask.answers` — Answer-check (run-contract spec F): an AskUserQuestion answer token that equals the O…
- `post.ask.title` — The user answered (a question, a plan approval, a start_session approval), so Claude…
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

**By category:**

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

- `ss.title.sweep` *(SessionStart)*
- `prompt.flow.open-url` *(UserPromptSubmit)*
- `prompt.batch.collect` *(UserPromptSubmit)*
- `prompt.flow.silent-turn` *(UserPromptSubmit)*
- `prompt.flow.title-work` *(UserPromptSubmit)*
- `prompt.flow.appstart` *(UserPromptSubmit)*
- `pre.ask.title` *(PreToolUse)*
- `substop.approval.clear` *(SubagentStop)*
- `perm.approval.flag` *(PermissionRequest)*
- `perm.approval.watch` *(PermissionRequest)*
- `post.flow.completion` *(PostToolUse)*
- `post.approval.clear` *(PostToolUse)*
- `post.ask.answers` *(PostToolUse)*
- `post.ask.title` *(PostToolUse)*
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

#### issues & team

- `ss.team.changelog` *(SessionStart)*
- `prompt.issue.detect` *(UserPromptSubmit)*
- `pre.issue.guard` *(PreToolUse)*

#### other

- `pre.redirect.scope` *(PreToolUse)*
<!--/devops:block:hook-categories-->

</details>

<details>
<summary><strong>Before reinstalling Windows</strong> — what to back up from Claude Code</summary>

| Path | What it holds | Back up? |
|---|---|---|
| `%USERPROFILE%\.claude\settings.json`, `settings.local.json`, `keybindings.json` | Permissions, hooks, plugins, marketplaces, output style | **Yes** |
| `%USERPROFILE%\.claude\CLAUDE.md`, `output-styles\`, `agents\`, `skills\`, `commands\` | Your instructions, styles, agents, skills, commands | **Yes** |
| `%USERPROFILE%\.claude\projects\<project>\memory\` | Auto-memory per project | **Yes** |
| `%USERPROFILE%\.claude\scheduled-tasks\`, `scripts\` | Scheduled tasks, your helper scripts | **Yes** |
| `%USERPROFILE%\.claude.json` | User-scoped MCP servers, per-project trust | **Yes** |
| `%APPDATA%\Claude\claude_desktop_config.json`, `config.json` | Desktop app settings and its MCP servers | **Yes** |
| `%USERPROFILE%\.claude\plugins\installed_plugins.json`, `known_marketplaces.json`, devops `*.json` state | Installed plugins, plugin preferences | Yes (small) |
| `%USERPROFILE%\.claude\projects\*.jsonl`, `history.jsonl` | Transcripts (can be GBs) | Only for `--resume` |
| `%USERPROFILE%\.claude\.credentials.json` | Login token | **Never** — `/login` afterwards |
| caches, `debug\`, `telemetry\`, `file-history\`, the rest of `%APPDATA%\Claude\` | Caches and logs | No |

Connectors, artifacts, cloud sessions and routines live in your account. The
bigger risk is your code: `git log --branches --not --remotes` lists commits
that exist only locally — ship or push them first. The
[home backup](#claude-home-backup) keeps the "Yes" rows current every day.

</details>

<details>
<summary><strong>Project structure</strong></summary>

```
plugins/
├── devops/                        ← the core plugin
│   ├── .claude-plugin/plugin.json ← Plugin manifest (SemVer, tags v0.x.y)
│   ├── .mcp.json                  ← MCP servers: completion card, ship, issues
│   ├── CONVENTIONS.md             ← Naming, versioning, extension rules
│   ├── hooks/                     ← <!--devops:count:hooks-->91<!--/devops:count:hooks--> hooks (JS) registered in hooks/dispatch/manifest.json
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

</details>

## Troubleshooting

**Update not showing** — the marketplace cache is stale.

1. **Claude Code:** say "devops update"
2. **CLI:** clear the cache, then install again (see [Install](#install)):
   ```bash
   rm -rf ~/.claude/plugins/cache/dotclaude ~/.claude/plugins/marketplaces/dotclaude ~/.claude/plugins/install-counts-cache.json
   ```

**Card says `ℹ Session server v<old> — restarting the session loads v<new>.`**
— a session keeps the MCP servers it started with; start a new session. On a
`stable` pin a fresh ship reaches you only after it is promoted.

**Hooks or skills missing** — start a new session; check the plugin is enabled
(CLI: `claude plugin list`; Desktop: **Customize → Personal Plugins**). More in
[`INSTALL.md`](INSTALL.md#troubleshooting).
