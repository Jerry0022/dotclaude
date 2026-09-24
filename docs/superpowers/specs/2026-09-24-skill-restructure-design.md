# Skill restructure — doors, auto-skills, layers

Status: approved in the concept session `docs/concepts/2026-09-23-skill-neuschnitt.html`
(three rounds, implement submitted 2026-09-24). This document is the single
source for the three PRs that land it.

## Why

The devops plugin exposes 24 equal-rank skills in the slash menu. Usage data
(1 138 sessions, 14.08.–23.09.2026, 711 skill calls):

- `ship` + `promote` = 59 % of all calls; the user types *words* ("ship",
  "ship!", "promote stable"), almost never the slash command.
- `tune-polish` and `setup-issue` are building blocks: 10/11 polish calls came
  from ship, 11/11 issue calls from other skills or hooks.
- `fix` was invoked 0 times for ~10 real bug reports in the last 200 sessions;
  the model debugged freely instead (37–137 tool calls each).
- `web-guide` was invoked 0 times in 1 128 sessions although Claude handed web
  steps to the user repeatedly (Upstash setup, Discord bot authorisation,
  Supabase MCP login). The signal is in Claude's *own* answer, not the prompt.
- `auto-graph`, `setup-readme`, `tune-audit`, `web-guide` appear in the session
  skill listing without a description — the listing budget is exhausted, so the
  model cannot pick them situationally.

## Target

### Units

| Unit | Kind | Slash menu | Model may invoke | Layer |
|---|---|---|---|---|
| `do-batch` | door | yes | yes | 0 |
| `setup-cleanup` | tool | yes | never (`disable-model-invocation`) | 0 |
| `setup-project` | tool | yes | never | 0 |
| `do-run` | door (router) | yes | yes | 1 |
| `do-learn` | door | yes | yes | 1 |
| `auto-concept` | worker | no (`user-invocable: false`) | yes | 2 |
| `auto-fix` | worker | no | yes | 2 |
| `auto-guide` | worker | no | yes | 2 |
| `auto-extend` | worker | no | yes | 2 |
| `auto-update` | worker | no | yes | 2 |
| `do-ship` | door | yes | yes | 3 |
| `auto-harden` | pass | no | yes | 4 |
| `auto-polish` | pass | no | yes | 4 |
| `auto-agents` | hands | no | yes | 5 |
| `auto-issue` | hands | no | yes | 5 |

No longer skills: `setup-readme` → README hook + `deep-knowledge/readme-standards.md`;
`auto-graph` → the existing graphify hooks + `deep-knowledge/graphify.md`;
`auto-usage` → MCP `get_usage` + `deep-knowledge/usage.md`;
`claude-strict` → do-run question + the three strict hooks + `deep-knowledge/strict.md`.
Folded: `promote` → do-ship mode; `run-backlog`, `run-autonomous`, `run-burn`,
`tune-rethink`, `tune-audit` → do-run modes/passes (bodies move verbatim to
`skills/do-run/modes/*.md`).

Consumer extensions (`{project}/.claude/skills/<name>/`) keep working: the
extension loader falls back from the new name to the old one.

### Call graph

Calls go strictly to a lower layer, so a cycle is impossible by construction.
The graph covers skill→skill calls only; hooks and the router are triggers, not
edges. `auto-agents` sits at the bottom because it invokes no skill — it only
spawns role agents — yet every implementing skill executes through it.

```
do-batch      → do-run, auto-concept
setup-cleanup → auto-concept, do-ship
do-run        → auto-concept, do-ship, auto-harden, auto-polish, auto-agents, auto-issue
do-learn      → auto-issue
auto-concept  → do-ship, auto-agents, auto-issue
auto-fix      → auto-agents
do-ship       → auto-harden, auto-polish          (both --invoked-by=ship, diff-scoped)
auto-harden   → auto-agents
auto-polish   → auto-agents
```

### do-run questions

One `AskUserQuestion` call with four questions (the tool maximum), then at most
one follow-up call carrying only what the answers leave open. Rules for every
question the plugin asks:

- **Fixed option order**, the agnostic recommendation always first — even when
  the prompt or the user's last choice pre-selects another option.
- **Click-through**: accepting every default must be a valid run.
- **Parallel labels**: short, same grammatical shape, verb in the same place,
  never "Ja"/"Nein" (e.g. "Ship automatisch" / "Ship nicht automatisch").

| # | Question | Options (first = recommended) | Notes |
|---|---|---|---|
| 1 | Was? | Prompt umsetzen · Audit · Backlog | Backlog only when open issues exist; skipped when started from do-batch. Audit → follow-up "Audit umsetzen / Audit als Concept". |
| 2 | Ablauf? | Dabei · Ship manuell · Dabei · Ship automatisch · Weg · Ship automatisch · Weg · Ship manuell | Presence and ship combined because the tool allows only four questions. "Weg" → follow-up: desktop, shutdown, auto-resume (hard gate unchanged). |
| 3 | Umfang? | Mit Umfeld · Nur das | Default = the user's last choice in this chat, else "Mit Umfeld". "Nur das" = strict. |
| 4 | Durchgänge? (multi-select) | Harden danach · Polish danach · Rethink vorher · Budget verbrennen | Harden + Polish recommended. Rethink recommended only when the prompt reads stuck. "Budget verbrennen" last, never pre-selected, shown only when weekly usage > 80 %. |

Questions of the folded skills: run-agents "mode", run-burn "confirm",
run-backlog "budget mode" and "ship mandate", run-autonomous "analyse vs
implement" are answered by the table above and removed. Kept as follow-ups:
milestone selection (Backlog), audit scope + output (Audit), desktop /
shutdown / auto-resume (Weg). Resume of an interrupted autonomous or burn run
is asked before the base call, only when a resume state exists.

Decided while implementing (phase B1): the `(Recommended)` marker of a
single-select question always sits on the first, agnostic option — it marks
what click-through picks. The user's last Q3 answer in this chat shows as the
description suffix "zuletzt gewählt" on that option; it moves neither marker
nor order. An empty Q4 submit means the recommended set (Harden + Polish,
plus Rethink when marked); "keine" in the free-text field means no passes.
Shutdown and auto-resume fold into one follow-up question ("PC an · mit
Resume" · "PC an · ohne Resume" · "PC aus · ohne Resume"), so the
autonomous HARD GATE holds without a second call. The contract is pinned by
`plugins/devops/skills/do-run/do-run-questions.test.js`.

### auto-agents

The single execution path for everything that implements (do-run,
auto-concept implement, auto-fix, auto-harden, auto-polish). It applies the
always-on delegation policy (inline · 1 agent · parallel · full ceremony —
`deep-knowledge/agent-proactivity.md`, nudged per prompt by
`prompt.knowledge.dispatch`), reads plan and usage through `get_usage`, and
invokes no skill. The policy hook keeps applying to prompts that use no skill.
On start it shows a card-style mini table without a CTA:
wave · task · model (resolved at runtime to the newest release, never
hard-coded) · effort.

### Triggers — how hidden skills still run

Every `auto-` skill needs at least one deterministic path besides the model's
own choice:

1. **Event hooks** (language-independent): `post.flow.debug` → auto-fix
   (mandatory wording, on `PostToolUseFailure` — where a failed Bash call
   actually lands — keyed per agent; only a real non-zero `Exit code N`
   counts, timeouts and denials are neutral); new `pre.issue.guard` blocks
   raw issue writes — `gh issue create/edit` (Bash and PowerShell, line
   continuations joined), a writing `gh api …/issues` call, and the GitHub
   MCP issue-write tool — and routes to auto-issue. A write passes only when
   it carries the skill's own marker comment AND auto-issue/setup-issue was
   invoked in the same turn (Skill tool or slash command); the deny text
   never names the marker. New
   `stop.guide.handoff` catches Claude handing a web step to the user →
   auto-guide offer (blocks only when the turn has no completion card yet;
   in a card turn it leaves a one-shot, non-mandatory hint for the next
   prompt; it scans every assistant entry of the turn, card region
   stripped, not just the last one); README hook; graphify hooks.
2. **Router** — deterministic, so deliberately narrow: `prompt.skill.enforce`
   turns only unambiguous signals into a mandatory invoke:
   - **multi-word phrases** from `triggers:` (minus a small denylist of
     phrases that are everyday speech, e.g. "prüf alles", "neue version",
     or generic in a consumer project: "update plugin", "plugin updaten",
     "self update", "update the readme", "visualize this", "guide me
     through" — `PHRASE_DENYLIST` in `hooks/lib/skill-trigger-router.js`
     is the full list),
   - **slash forms** — typed `/name` of a real skill, the pre-PR-2 names
     as aliases (`/fix` → auto-fix, `/claude-learn` → do-learn,
     `/run-backlog` → do-run mode `backlog`, `/promote` → do-ship mode
     `promote`; the 1:1 aliases `/ship` and `/claude-batch` stay with their
     dedicated hooks, which accept old and new names), and `triggers:`
     slash forms that are not a skill name (`/devops-learn`). One table,
     `hooks/lib/skill-names.js`, drives the aliases, the "already invoked"
     check (a session that ran `devops:ship` counts as having run
     `do-ship`) and the extension fallback.
     **Reach of an alias (checked 2026-09-24 with the claude-code-guide
     agent against code.claude.com/docs):** the docs state that a
     `UserPromptSubmit` hook receives the raw prompt text, and that
     `user-invocable: false` means "only Claude can invoke the skill". They
     do NOT say whether a typed `/unknown-name` at the start of a prompt, or
     a typed `/name` of a `user-invocable: false` skill, is rejected by the
     harness before any hook runs, and no local check was possible (the
     standalone CLI is not authenticated in Desktop sessions). So the
     router only promises what it can see: an old name mentioned inside a
     prompt ("mach das mit /fix", "und dann /run-backlog") reaches the hook
     and is routed; a prompt that STARTS with a removed slash name may never
     reach it. Typed words ("ship", "promote to stable", "arbeite den
     backlog ab") are plain prompts and unaffected. Texts that tell the
     USER what to type therefore name the trigger words of a hidden skill
     ("ask for a polish pass", "extend skill"), not `/auto-…`.
   - a **curated single-word allowlist** (festgefahren, unstuck,
     auditiere/auditieren, Qualitätsaudit, stabilisieren, härten,
     feinschliff). A bare "concept" is NOT on it — only verb-object phrases
     route to concept ("ein concept", "concept für", "concept dazu", "als
     concept", "concept page", "concept-seite", …), so "concept A passt" or
     "der concept skill …" stay silent,
   - **error patterns** that do not depend on language → auto-fix: a stack
     frame or `Traceback` anywhere (also inside a code fence); a bare
     `…Error:` only in prose outside fences; an HTTP 4xx/5xx only in prose,
     next to an HTTP word, an error word AND a bug phrase. Not when the
     user's own prose is a question without a bug phrase.
   **Soft matches:** a trigger-phrase match becomes a non-mandatory hint
   instead of a mandate when the session runs in the plugin source repo
   (there, "der backlog runner parkt zu früh" talks about the component) or
   when a meta word (skill, hook, runner, guard, hint, trigger, router,
   extension, agent) stands within three tokens of the phrase.
   Generic single words ("error", "debug", "audit", "polish", "stuck",
   "strict") are left to the model, which reads the full description
   including its "Do NOT trigger" negations. Code, quotes and machine
   prompts (cron, autonomous loop, AFK resume, scheduled task, task
   notification) never trigger. The router stays silent while batch mode is
   on or being switched on and during an AFK lockout; it drops a skill that
   already ran this session (Skill tool or slash command), concept while a
   valid, non-stale concept page is open,
   polish/harden under strict mode, and fix when a consumer project talks
   about the plugin itself (that routes to an upstream issue).
3. **Descriptions** stay in the model listing and are shortened only when the
   trigger evals prove no loss. Every trigger phrase of today's description is
   kept verbatim in `triggers:`.
4. **Evals** per trigger path in the top 10 languages (en, zh, hi, es, fr, ar,
   bn, pt, ru, ja) plus German; the ~10 real bug prompts and the four real web
   hand-offs from the scan are cases.

### Frontmatter contract

```yaml
layer: 3                     # 0–5, see Units
invokes: [tune-polish]       # devops skills this skill may call; lower layers only
triggers:                    # every description trigger phrase, per language (router: see Triggers)
  de: ["ship", "und dann ship"]
  en: ["ship it", "push and merge"]
```

`layer` / `invokes` govern devops→devops calls only. They do not restrict
consumer skills or extensions, and the harness ignores them at runtime — the
graph test in this repo is the enforcement. A runtime stack only suppresses a
hook or the router re-nudging a skill that is already running.

### Measuring (dotclaude repo only)

The usage scan (per-skill invocation counts, trigger-to-invoke rate) lives as a
project extension under `.claude/skill-usage/` in this repo — checked in, so it
survives a machine loss — and is not shipped to plugin consumers.

## Delivery

| PR | Scope |
|---|---|
| 1 | Frontmatter `layer` / `invokes` / `triggers` on all current skills (layers of today's graph), `hooks/lib/skill-meta.js`, graph + trigger-preservation tests, router over `triggers:`, auto-fix trigger paths, `stop.guide.handoff`, `pre.issue.guard`, trigger evals (11 languages), measuring extension. No renames. |
| 2 | Renames + visibility flags + aliases + extension fallback; do-run router with the question design above; promote into do-ship; harden at ship; do-batch → auto-concept / do-run; auto-agents as the single execution path with the start table; target layers. |
| 3 | setup-readme, auto-graph, auto-usage, claude-strict out of `skills/`; README hook; descriptions shortened where the evals allow. |
