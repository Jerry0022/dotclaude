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
  sub.     = SubagentStart (additionalContext reaches the subagent; SessionStart context does not)
  stop.    = Stop
  substop. = SubagentStop
  perm.    = PermissionRequest

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
 * @event {SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|PostToolUseFailure|SubagentStart|SubagentStop|PermissionRequest|Stop}
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
The authoritative list of hooks, their matchers and timeouts is
`hooks/dispatch/manifest.json` — read that file for the current roster.

### Dispatcher (one process per event)

`hooks/hooks.json` is **generated** and registers one command per event:
`node hooks/dispatch/dispatch.js <Event>`. The dispatcher reads the manifest,
applies each hook's own matcher (Claude Code's matcher rules, ported in
`dispatch/matcher.js`), runs every matching hook in its own worker thread and
merges their replies the way Claude Code merges separate hooks
(`dispatch/merge.js` has the table: any exit 2 blocks, deny > defer > ask >
allow, every additionalContext / systemMessage is kept). A Bash call starts
2 node processes instead of ~17. Full rationale: the header of
`dispatch/dispatch.js`.

Add or change a hook:

1. Write the hook file as before (`hooks/{event}/…`, header, stdin
   tolerance) — it must still work when run as `node <file>`.
2. Register it in `hooks/dispatch/manifest.json` (same shape hooks.json had:
   event → groups with `matcher` → hooks with `command`, `timeout`).
3. Run `node plugins/devops/hooks/dispatch/build-hooks-json.js` — it rewrites
   `hooks/hooks.json` (dispatcher entry: union matcher, largest module
   timeout + 5 s headroom) and `dispatch/lanes.json`.
   `dispatch/manifest.test.js` fails when either is stale.

Rules inside the dispatcher:

- **Isolation.** A worker gives the hook a fresh module registry, its own
  `process.exit` / `process.exitCode`, env copy and captured stdout/stderr;
  stdin, `fs.readFileSync(0)` and `fs.writeSync(1|2)` are shimmed. A hook
  that cannot run in a worker gets `"isolate": "process"` (child process) or
  `"dispatch": false` (its own hooks.json entry) in the manifest.
- **Lanes.** Worker threads share one pid. A lib that names a temp file by
  the pid alone (`` `${file}.${process.pid}.tmp` ``) forces every hook that
  reaches it into one sequential lane (`dispatch/lanes.js`). Add a random
  part to new temp names (`${process.pid}.${Math.random()…}`) and the hooks
  keep running in parallel.
- **Budgets.** A hook's `timeout` is its budget from its own start; the
  event's budget is the largest timeout. A hook over budget is terminated, one
  without budget left is skipped — both fail open, exactly like a timed-out
  hook process (Claude Code ignores `onFailure`; it is plugin metadata).
- **Telemetry.** Each hook keeps its start/end records in
  `devops-hook-telemetry.jsonl`; the dispatcher adds `dispatch:<Event>` and
  `outcome: "timeout" | "skipped"` end records.
- **Opt-out.** `DEVOPS_HOOK_DISPATCH=0` runs every hook as its own child
  process again (all in parallel), merged by the same rules — for debugging.

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
`runHook(main, { event })` from the same file does both: it reads stdin, hands
the payload to `main(hook)` and turns its reply into the output — `{ block }`
→ stderr + exit 2, `{ context }` → the `additionalContext` envelope for
`event`, a string → stdout as is, anything else or a throw → exit 0.

Every git subprocess carries a timeout: use `gitOut` / `gitLines` / `gitRun`
from `hooks/lib/git-timeout.js` (`GIT_TIMEOUT_MS` per call, or a shared
`gitBudget()` for a chain of calls) instead of a hand-rolled `execFileSync('git', …)`.

A failed Bash/PowerShell call does not reach PostToolUse: the harness fires
**PostToolUseFailure** with `error` (starts with `Exit code N`) and
`is_interrupt`; PostToolUse only sees successes (`tool_response` without an exit code).
Normalize any `tool_response` with `normalizeToolResponse()` from
`hooks/lib/browsertest-guard.js`.
A call the harness runs in the background (`run_in_background`, or moved there
at its timeout) returns only a launch report carrying `backgroundTaskId`, never
the command's output. Its result arrives later as a task notification; read it
with `taskEnds()` from `hooks/lib/pending-tasks.js`.

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
window (#324). A session that loses `dotclaude` cannot ship at all.

- **SessionStart hooks do no heavy work in the connect window.** Network
  (`git fetch`, `gh`, `npm install`), bulk file copies, recursive scans and
  process sweeps run behind a cooldown gate or are deferred to a later event —
  never unconditionally at every start. Every manifest entry and every
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
- `auto-*` — workers, passes and hands Claude invokes itself
  (`user-invocable: false`): hidden from the slash menu, reached through the
  model, the trigger router (`prompt.skill.enforce`) or a hook.

The former `setup-*` prefix (tools only the user starts) is gone:
`setup-cleanup` became `auto-cleanup` and `setup-project` was retired into
`deep-knowledge/project-setup.md` + `ss.project.setup` (spec § Addendum).

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

### Question Blocks

Every `AskUserQuestion` a skill defines (in `SKILL.md`, its `deep-knowledge/`
or a mode file) follows `deep-knowledge/decision-format.md` § Option order:
fixed option order across calls, only the `(Recommended)` marker moves, and
the common-case recommendation stands first.

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

**Length limits:** `description` ≤ 1,024 characters (Agent Skills spec), and
`description` + `when_to_use` ≤ 1,536 — Claude Code cuts the skill listing
there, so the key use case goes first. A long trigger list moves to a folded
`when_to_use:` block (do-run); its quoted phrases count for the `triggers:`
check like the description's. Guarded by `scripts/skill-graph.test.js`.

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

Every plugin skill supports a **three-layer extension model**, loaded by ONE
override loader — no skill reads its extensions itself:

```
Layer 1: Plugin SKILL.md              ← Core logic (this plugin, immutable)
Layer 2: User global override         ← ~/.claude/skills/{name}/reference.md
Layer 3: Project override             ← {project}/.claude/skills/{name}/reference.md
```

**Merge priority:** Project > Global > Plugin (most specific wins).

The override file is `reference.md`. A legacy `SKILL.md` there is still read
as a deprecated fallback — Claude Code loads any `SKILL.md` under
`.claude/skills/` as a skill of its own, so it is never scaffolded.

**The loader** (`hooks/lib/skill-overrides.js`; hooks `post.skill.overrides`
on the Skill tool, `prompt.skill.overrides` for a typed `/skill`) resolves
both layers — new skill name first, the pre-PR-2 name as fallback
(`resolveExtensionFile()` in `hooks/lib/skill-names.js`), a folded mode's old
dir in addition — parses the directive headings (`## Add after|before Step N`,
`## Skip Step N`, `## Replace Step N`, `## Step N — …` = extend, rest = rules)
and injects one `[skill-overrides]` block with explicit orders and the file
bodies (inline up to 6000 chars, beyond that the file is named for a Read).
It records the active overrides per session; the completion card shows them as
one `🧩 Override aktiv: …` line. No file → no output.

**Step 0 in every skill** is the one line:

```markdown
## Step 0 — Load Extensions

Injected by the override loader (`[skill-overrides]` block); none shown → none exist.
```

Skill-specific notes on what an extension typically declares may follow it.
JS that reads an extension file itself (e.g. `post.design.remind`) uses
`resolveExtensionFile()`.

**Example: A user extends `/do-ship` for their own project:**

```
my-project/
└── .claude/
    └── skills/
        └── do-ship/
            └── reference.md    ← "## Add after Step 1 — run npm test && npm run lint" · "Deploy via SSH to <internal-host>"
```

**Eat-your-own-dogfood:** This plugin's own repo (`devops/`) uses
the same mechanism. Project-specific ship rules live in `.claude/skills/do-ship/`
within this repo — no separate `/ship-dotclaude` skill needed.

## Script Conventions

### Naming

Utility scripts use descriptive kebab-case: `build-id.js`, `render-diagram.js`.
Scripts are NOT hooks — they are helpers invoked by hooks or skills.

**Path rule**: Scripts live inside the plugin at `{PLUGIN_ROOT}/scripts/`. Reference them
as `node {PLUGIN_ROOT}/scripts/{name}.js`. Never use
`~/.claude/scripts/` — that path is not managed by the plugin installer and may not exist.

**`{PLUGIN_ROOT}`** is plugin prose, never substituted by Claude Code. The model gets its
literal value from `lib/plugin-root.js`: `ss.knowledge.index` (main session) and
`sub.plugin.root` (every subagent) inject `{PLUGIN_ROOT} = <abs path>`. `$CLAUDE_PLUGIN_ROOT`
exists only in hook and MCP processes — in the Bash tool it is empty, so `$CLAUDE_PLUGIN_ROOT/…`
expands to `/…`. A hook message that names a plugin file prints the absolute path
(`deepKnowledgePath()`), never a bare `deep-knowledge/x.md`: a model that cannot resolve a
plugin path searches the disk, and `find /` in Git Bash walks every mounted drive
(`pre.crawl.guard` now blocks that).

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

- **Generator:** `scripts/gen-readme-sections.mjs` reads `hooks/dispatch/manifest.json`,
  `skills/*/SKILL.md`, `agents/*.md`, `deep-knowledge/*.md` and rewrites every
  marker. Counts, the lifecycle roster and the category roster
  (`hook-categories`, domain = middle segment of the hook id, `CATEGORIES` in
  the generator) can therefore never go stale. The completion-card example and
  the variant-heading table (`card-example`, `card-variants`) are rendered
  through the real renderer (`mcp-server/index.js --render-card`) from
  `scripts/readme-card-examples.json` — a renderer change shows up in the
  README on the next ship; only the `when` column is curated.
  No-ops outside the plugin source repo. Run standalone, or with `--check`
  (exit 1 if any marker is stale — used as a regression test + ship gate).
- **When it runs:** `ship_build` regenerates automatically (alongside
  `gen-dk-index` / `gen-project-map`) with the repo's own copy of the
  generator — never the older one bundled with a session's MCP server; `ship_preflight` warns on stale markers
  **and** on any skill/agent missing its curated README table row;
  `ss.git.check` nudges (once per 8h) when README is older than the roster.
- **What stays manual:** curated prose — token math, and the per-skill /
  per-agent **table descriptions**. The generator never touches those; preflight
  only enforces that every skill/agent *has* a row, not what it says.
- **Doc map for the prose:** `docs/readme-doc-map.json` pairs each curated
  README section with the sources it describes. `ship_preflight` names every
  section whose source the branch changed while README.md stayed untouched
  (`doc-readme-sections`), and Docs-Sync (do-ship Step 2.6) reads exactly
  those. A new README section gets its map entry in the same change.

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
