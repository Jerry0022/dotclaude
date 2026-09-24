# devops — Plugin Conventions

## Plugin Versioning

The plugin follows [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH

MAJOR  → Breaking changes (hook behavior change, skill rename, removed feature)
MINOR  → New features (new hook, new skill, new template)
PATCH  → Bug fixes, doc updates, internal improvements
```

Current version is tracked in `.claude-plugin/plugin.json` → `"version"`.

**Release channels (ring model):** every ship to main creates the annotated
tag `alpha/vX.Y.Z` automatically. Promotion (`ship beta` / `ship stable`, or `/do-ship promote`) re-tags the
SAME commit as `beta/vX.Y.Z`, then `stable/vX.Y.Z` + bare `vX.Y.Z` (stable
alias, triggers the Release workflow). Version files never carry a channel;
published tags are never moved or deleted. Consumers pin a channel per
marketplace in `~/.claude/plugins/.channels.json` (default `stable`).
Spec: `docs/superpowers/specs/2026-07-11-tag-channel-system-design.md`.

## Hook Conventions

### Naming

```
{event-prefix}.{domain}.{action}.js

Prefixes:
  ss.      = SessionStart
  pre.     = PreToolUse
  post.    = PostToolUse (a post. hook may also register for PostToolUseFailure)
  prompt.  = UserPromptSubmit
  stop.    = Stop

Examples:
  ss.git.sync.js
  ss.tokens.scan.js
  pre.tokens.guard.js
  pre.ship.guard.js
  post.flow.completion.js
  stop.ship.guard.js
```

### Internal Versioning

Every hook file starts with a JSDoc header:

```javascript
#!/usr/bin/env node
/**
 * @hook {prefix}.{domain}.{action}
 * @version X.Y.Z
 * @event {SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|PostToolUseFailure|Stop}
 * @plugin devops
 * @description One-line description of what this hook does.
 */
```

Hook versions are independent from the plugin version.
A hook version bumps when:
- PATCH: internal logic fix, no behavior change
- MINOR: new detection/feature within the hook
- MAJOR: behavior change (e.g., blocking → warning, new exit codes)

### Directory Structure

Hooks are organized by event under `hooks/{event}/` (e.g. `session-start/`,
`pre-tool-use/`, `post-tool-use/`, `user-prompt-submit/`, `stop/`).
The authoritative list of registered hooks and their matchers is
`hooks/hooks.json` — read that file for the current roster.

### Exit Codes

- `0` — Allow (tool execution proceeds)
- `1` — Error (non-fatal, tool proceeds, error logged)
- `2` — Block (tool execution is prevented, message shown to user)

### Output Channels

- `process.stderr.write()` — Messages shown in hook output (collapsed by default)
- `process.stdout.write()` — Injected into Claude's context as instructions
  (SessionStart, UserPromptSubmit, Stop `decision` JSON). **Not** for
  PostToolUse / PostToolUseFailure: their plain stdout only shows in
  transcript mode. Reach the model there with
  `{"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"…"}}`
  (or exit 2 + stderr to block).
- `console.error()` — Same as stderr, shown in hook output

### Stdin Tolerance

Every hook exits 0 silently when its stdin is unusable — empty, `null`, a
non-object, invalid JSON — and tolerates a UTF-8 BOM and CRLF. Parse with
`parseHookInput()` from `hooks/lib/hook-input.js` and wrap the hook body in a
try/catch that never lets an internal error surface as a hook failure.

A failed Bash/PowerShell call does not reach PostToolUse: the harness fires
**PostToolUseFailure** with `error` (starts with `Exit code N`) and
`is_interrupt`; PostToolUse only sees successes (`tool_response` without an exit code).
Normalize any `tool_response` with `normalizeToolResponse()` from
`hooks/lib/browsertest-guard.js`.

### Project-Rooted State

Hooks receive the session's **current** cwd, which follows every `cd` the
session makes. Any file a hook, script or MCP tool keeps in the project's
`.claude/` is anchored with `projectRoot(cwd)` / `projectClaudeDir(cwd)` from
`hooks/lib/project-root.js` (the git work-tree root — a linked worktree's own
root), never `path.join(cwd, '.claude', …)`. A cwd-rooted writer drops
`<subdir>/.claude/<file>` wherever the session stands: untracked, not covered
by the root-anchored ignore block, fails /do-ship preflight's clean-tree check.
`scripts/check-claude-artifacts.js` fails on a cwd-rooted runtime path; the
only exception is `/auto-concept` state, which is keyed to the session cwd by design.

### User-Relay Marker

Everything a hook or MCP tool writes to stdout is addressed to Claude, not to
the user. A block the user must see is introduced by exactly one phrase:

```
Show the user this <block|summary|notice> verbatim
```

The keyword `verbatim` is the contract (German variants keep it: `… verbatim
zeigen`). No synonyms — no `as-is`, `AS-IS`, `unverändert`, `surface this` —
so a consumer output style (see README → *Quiet output style*) can relay
marked blocks 1:1 and stay silent on everything else. The completion card
uses the same word (`output it VERBATIM`, `templates/completion-card.md`).

### Boot Discipline — SessionStart hooks vs. MCP server boot

Claude Code starts every SessionStart hook **concurrently** with the boot of
every stdio MCP server and gives each server a 30 s connect window. The plugin's
own hooks can starve its own servers: on 2026-09-03 all three plugin servers
(and unrelated third-party ones) hit `CONNECT_TIMEOUT` in several sessions
although each boots in < 2.5 s standalone — a `git fetch` storm, `npm install`,
a 10k-file `cpSync` of `node_modules` into the servers' own `cwd` under
`plugins/cache/`, a recursive repo scan and a process sweep all ran in that
window (#324). A session that loses `dotclaude-ship` cannot ship at all.

- **SessionStart hooks do no heavy work in the connect window.** Network
  (`git fetch`, `gh`, `npm install`), bulk file copies, recursive scans and
  process sweeps run behind a cooldown gate or are deferred to a later event —
  never unconditionally at every start. Every `hooks.json` entry and every
  subprocess carries an explicit timeout.
- **The cache rebuild never rewrites a running server's `cwd` wholesale**:
  exclude `node_modules` from the copy and link it instead.
- **MCP servers do zero work before `server.connect(transport)`** — no
  `execSync`, no network, no large reads at module top level; lazy-load on the
  first tool call. Stdout stays JSON-RPC only; boot logging goes to stderr.
- Stopgap on a slow machine: `MCP_TIMEOUT=60000` in `settings.local.json` `env`
  (startup timeout; a per-server `timeout` in `.mcp.json` only bounds tool calls).

## Plugin-Level Deep-Knowledge

Some knowledge applies across multiple skills and hooks — not owned by any single skill.
These live at the plugin root level:

```
deep-knowledge/
├── INDEX.md                           ← Auto-generated topic map (read this FIRST)
├── test-strategy.md                   ← When/how to test (used by completion flow)
├── visual-verification.md             ← Preview methods: screenshot, simulated, etc.
└── {topic}.md                         ← Any cross-cutting concern
```

**Lookup rule:** Before reading individual deep-knowledge files, read `deep-knowledge/INDEX.md`
to find the right file. This avoids unnecessary reads and saves context tokens.

**vs. skill-level deep-knowledge:**
- `skills/do-ship/deep-knowledge/versioning.md` → only used by `/do-ship`
- `deep-knowledge/test-strategy.md` → used by hooks AND skills

Hooks reference plugin-level deep-knowledge in their stdout instructions to Claude.
`prompt.knowledge.dispatch` injects a doc's body when a `TOPIC_MAP` keyword
matches, or — for the docs in `hooks/lib/knowledge-pointers.js` (the retired
skills' bodies) — a one-line pointer to the file; both once per session.

## Skill Conventions

### Naming

Skill directory names use kebab-case with a role prefix
(docs/superpowers/specs/2026-09-24-skill-restructure-design.md → Units):

- `do-*` — doors the user opens (`do-ship`, `do-run`, `do-learn`, `do-batch`); in the slash menu.
- `setup-*` — tools only the user starts (`disable-model-invocation: true`).
- `auto-*` — workers, passes and hands Claude invokes itself
  (`user-invocable: false`): hidden from the slash menu, reached through the
  model, the trigger router (`prompt.skill.enforce`) or a hook.

Skills are invoked as: `/devops:{skill-name}` (plugin-prefixed).

A skill whose body grew into several flows keeps ONE `SKILL.md` (frontmatter,
mode table) and puts each flow in `modes/<mode>.md` (supporting files under
`modes/<mode>/`); mode files carry no frontmatter — they are not skills.

**Renaming a skill** is a MAJOR change: add the old → new pair to
`hooks/lib/skill-names.js` (`RENAMED`, or `FOLDED` + `FOLDED_TRIGGERS` for a
skill that becomes a mode). That one table drives the router aliases, the
"already invoked" detection, the extension fallback and the usage scan.

**Retiring a skill** (it stops being a skill — its body is knowledge, its
triggers belong to a hook or an MCP tool) is a MAJOR change too, done in PR 3
of the skill restructure for `setup-readme`, `auto-graph`, `auto-usage` and
`claude-strict`:

- move the body verbatim into `deep-knowledge/<topic>.md` (no frontmatter;
  first line after the heading ends with "Former `<name>` skill …");
- add the name to `RETIRED` (+ the frontmatter snapshot to `RETIRED_TRIGGERS`)
  in `hooks/lib/skill-names.js` — never to `RENAMED`: an old slash name must
  map to the new mechanism, not to a Skill;
- give every trigger phrase a home: `hooks/lib/knowledge-pointers.js`
  (one-line dispatch pointer, cheap enough for single words) and/or a
  dedicated hook (`prompt.strict.enforce` owns the strict switch,
  `pre.readme.standards` the first README write);
- `git rm` the skill dir; `scripts/skill-graph.test.js` then checks the doc,
  the pointer match of every snapshot phrase and that the router never
  mandates the old name.

A consumer extension under the old name keeps applying only where the doc
and its pointer say so (`legacyOverrides`); document which in the doc.

### Directory Structure

```
skills/{skill-name}/
├── SKILL.md                    ← Core logic (prompt definition)
├── deep-knowledge/             ← Internal reference docs (plugin-owned)
│   ├── topic-a.md
│   └── topic-b.md
└── reference.md                ← Optional: documents the extension mechanism
```

### Internal Versioning

Every SKILL.md starts with frontmatter including version:

```markdown
---
name: skill-name
description: One-line description
version: X.Y.Z
triggers:
  - trigger phrase 1
  - trigger phrase 2
---
```

**YAML safety:** any frontmatter value with `: ` (colon + space) or a trailing
`:` — usually `description` — MUST be a folded block scalar (`description: >-`,
content indented on the next line) or be quoted. A plain scalar with an inner
`: ` makes YAML parse the block as a broken mapping, so the harness loads the
doc with **empty metadata and no error** — the skill never triggers / the agent
never appears. Applies equally to `agents/*.md`. Guarded by
`scripts/frontmatter-yaml.test.js`.

### Frontmatter — `layer` / `invokes` / `triggers`

Every `SKILL.md` also carries three fields that describe the devops→devops
skill-call graph:

```yaml
layer: 3                     # integer, 0 = top; assigned by the call graph rule below
invokes: [auto-polish]       # devops skills this skill actually calls; [] when none
triggers:                    # every trigger phrase from the description, verbatim, per language
  de: ["ship", "und dann ship"]
  en: ["ship it", "push and merge"]
```

- **`layer`** — an integer. The rule: every real skill→skill call goes
  **strictly to a higher layer number** than the caller (a cycle is therefore
  impossible by construction). Assign the smallest layer consistent with
  every edge; a skill with no incoming or outgoing edges is layer `0`.
- **`invokes`** — the list of devops skills this skill actually calls via the
  `Skill` tool or an equivalent hand-off. A mention ("use `/other-skill`
  instead", "do NOT trigger for `/x`") is NOT an edge — only a real
  invocation counts. Empty list `[]` when the skill calls no other skill.
- **`triggers`** — every phrase from the description's `Triggers on:` /
  `Triggers:` list, copied verbatim, grouped by language (`de` / `en`; a
  slash command or proper noun goes under `en`). `triggers: {}` when the
  description has no phrase list (e.g. explicit-invocation-only skills keep
  only their literal slash form).

**Scope:** these fields govern devops→devops calls only. They do not
restrict consumer skills or extensions, and the harness ignores them at
runtime — `scripts/skill-graph.test.js` (via `hooks/lib/skill-meta.js`) is
the enforcement: every skill declares all three fields, every `invokes`
entry names a real skill, every edge respects the layer rule (with an
explicit cycle check), and every quoted description-trigger phrase survives
in `triggers:` so a later description edit can't silently drop it.

**Router scope:** `triggers:` stays the complete phrase list, but the
deterministic router in `prompt.skill.enforce` (`hooks/lib/skill-trigger-router.js`)
only turns **multi-word phrases**, **slash forms** and the curated
**single-word allowlist** (`SINGLE_WORD_ALLOWLIST`) into a mandatory load.
A new single-word trigger reaches the model through the description only,
until it is added to that allowlist — add a word there only when it names the
skill's job and hardly occurs in ordinary prose. An everyday multi-word phrase
— or one too generic in a consumer project ("update plugin", "guide me
through") — goes on `PHRASE_DENYLIST` instead; the frontmatter keeps it. A word too ambiguous alone but clear as a
request (bare "concept") gets router-only verb-object phrases in
`ROUTER_PHRASES` ("ein concept", "als concept", …) — never the bare word.
A phrase match is only a non-mandatory hint when the session runs in the
plugin source repo or a meta word (skill, hook, runner, guard, hint, …)
stands next to it.

### Extension Mechanism (applies to ALL skills)

Every plugin skill supports a **three-layer extension model**. Before executing
its core logic, a skill MUST load extensions in this order:

```
Layer 1: Plugin SKILL.md              ← Core logic (this plugin, immutable)
Layer 2: User global extensions       ← ~/.claude/skills/{name}/SKILL.md + reference.md
Layer 3: Project extensions           ← {project}/.claude/skills/{name}/SKILL.md + reference.md
```

**Merge priority:** Project > Global > Plugin (most specific wins).

**What users can extend:**
- `SKILL.md` — Override or extend specific steps of the skill
- `reference.md` — Add project-specific context, rules, deploy targets, extra checks

**Load sequence in every skill (Step 0):**

```markdown
## Step 0 — Load Extensions

Silently check for optional overrides (do not surface "not found" in output):

1. Global skill extension: `~/.claude/skills/{skill-name}/SKILL.md` + `reference.md`
2. Project skill extension: `{project}/.claude/skills/{skill-name}/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults
```

A renamed skill adds one line after item 2: where the new directory does not
exist, read the pre-rename one (`{project}/.claude/skills/<old-name>/`) —
consumer extensions written before the rename keep working. JS that reads an
extension file itself uses `resolveExtensionFile()` from
`hooks/lib/skill-names.js` (new name first, old name second).

**This pattern is mandatory for every new skill.** When creating skills
(via `/skill-creator` or manually), always include the Step 0 extension
load sequence. Skills that skip this step are non-compliant.

**Example: A user extends `/do-ship` for their own project:**

```
my-project/
└── .claude/
    └── skills/
        └── ship/
            ├── SKILL.md        ← "Before PR: run npm test && npm run lint"
            └── reference.md    ← "Deploy via SSH to <internal-host>"
```

The plugin's `/do-ship` reads these before executing and integrates the rules.

**Eat-your-own-dogfood:** This plugin's own repo (`devops/`) uses
the same mechanism. Project-specific ship rules live in `.claude/skills/do-ship/`
within this repo — no separate `/ship-dotclaude` skill needed.

## Script Conventions

### Naming

Utility scripts use descriptive kebab-case: `build-id.js`, `render-diagram.js`.
Scripts are NOT hooks — they are helpers invoked by hooks or skills.

**Path rule**: Scripts live inside the plugin at `{PLUGIN_ROOT}/scripts/`. Reference them
as `node {PLUGIN_ROOT}/scripts/{name}.js` (or `$CLAUDE_PLUGIN_ROOT` in bash). Never use
`~/.claude/scripts/` — that path is not managed by the plugin installer and may not exist.

**Version-glob rule**: when a script must be located through the installed cache
(`~/.claude/plugins/cache/dotclaude/devops/<version>/scripts/…`) instead of
`$CLAUDE_PLUGIN_ROOT`, pick the **highest** version: `ls -d … | sort -V | tail -1`.
Several version directories coexist after updates, and `ls … | head -1` returns the
lexically first — i.e. the OLDEST — one, so a session ran a 0.145.1 bridge server while
its hooks were on 0.148.0. Prefer `$CLAUDE_PLUGIN_ROOT` whenever the shell has it.

### Directory Structure

```
scripts/
├── {descriptive-name}.js
├── config.json                 ← Runtime config (generated, not committed)
└── diagrams/
    └── template.html
```

## Template Conventions

Templates use descriptive names with file-type suffix:

```
templates/
├── buildlog-entry.md
├── changelog-entry.md
├── completion-card.md
├── github-release.md
├── output-style-quiet.md          ← consumer copy target (~/.claude/output-styles/)
└── output-style-quiet.shipped.json ← sha256 of every shipped version of it
```

`ss.plugin.update` keeps an existing `~/.claude/output-styles/quiet.md` in step
with the template (`hooks/lib/output-style-sync.js`) — but only when that copy
equals a shipped version; a customized copy is never overwritten, and a missing
one is never created. **Whenever you edit `output-style-quiet.md`, add its new
hash to `output-style-quiet.shipped.json`** (`output-style-sync.test.js` fails
until you do), otherwise every consumer on that version reads as customized.

## Auto-Maintained Documentation

`README.md` and `docs/architecture.html` carry roster facts (hook/skill/agent
counts, the full hook lifecycle list) that drift the moment someone adds a hook
or skill. These live inside HTML-comment markers and are regenerated from the
canonical source — **never hand-edit the text between markers:**

```
<!--devops:count:hooks-->27<!--/devops:count:hooks-->        ← inline count
<!--devops:block:hook-lifecycle--> … <!--/devops:block:hook-lifecycle-->   ← block
```

- **Generator:** `scripts/gen-readme-sections.mjs` reads `hooks/hooks.json`,
  `skills/*/SKILL.md`, `agents/*.md`, `deep-knowledge/*.md` and rewrites every
  marker. Counts and the lifecycle roster can therefore never go stale.
  No-ops outside the plugin source repo. Run standalone, or with `--check`
  (exit 1 if any marker is stale — used as a regression test + ship gate).
- **When it runs:** `ship_build` regenerates automatically (alongside
  `gen-dk-index` / `gen-project-map`); `ship_preflight` warns on stale markers
  **and** on any skill/agent missing its curated README table row;
  `ss.git.check` nudges (once per 8h) when README is older than the roster.
- **What stays manual:** curated prose — token math, and the per-skill /
  per-agent **table descriptions**. The generator never touches those; preflight
  only enforces that every skill/agent *has* a row, not what it says.

Three layers, three failure windows covered: generate (can't drift) →
preflight verify (catches the un-generated tables) → session nudge (catches
"forgot to refresh entirely").

### Living documentation (prose, flows, structure)

The markers above cover **machine facts only**. The **content** layer — prose,
flows, folder structure, curated descriptions — is kept current by people and
agents, not generators: implementation agents update affected docs as part of
their change, and `/do-ship` Step 2.6 (Docs-Sync) reconciles living docs
against the shipped diff before the version bump. Proportional (trivial changes
need none), non-blocking, and it never rewrites dated specs/concepts. Rules and
the trigger matrix: `deep-knowledge/documentation-maintenance.md`.

## General Rules

- All code is JavaScript (Node.js), no Bash scripts
- All paths use `os.homedir()` or `process.cwd()` — never hardcoded absolute paths
- All timeouts: 15s for git operations, 10s for file operations
- Non-fatal errors: log and continue, never block session start
- Config files: JSON format, human-readable with 2-space indent
