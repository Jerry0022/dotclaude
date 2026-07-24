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
tag `alpha/vX.Y.Z` automatically. Promotion (`/promote`) re-tags the
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
  post.    = PostToolUse
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
 * @event {SessionStart|PreToolUse|PostToolUse|Stop}
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
- `console.error()` — Same as stderr, shown in hook output

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
- `skills/ship/deep-knowledge/versioning.md` → only used by `/ship`
- `deep-knowledge/test-strategy.md` → used by hooks AND skills

Hooks reference plugin-level deep-knowledge in their stdout instructions to Claude.

## Skill Conventions

### Naming

Skill directory names use kebab-case: `ship`, `new-issue`, `repo-health`.
Skills are invoked as: `/devops:{skill-name}` (plugin-prefixed).

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

**This pattern is mandatory for every new skill.** When creating skills
(via `/skill-creator` or manually), always include the Step 0 extension
load sequence. Skills that skip this step are non-compliant.

**Example: A user extends `/ship` for their own project:**

```
my-project/
└── .claude/
    └── skills/
        └── ship/
            ├── SKILL.md        ← "Before PR: run npm test && npm run lint"
            └── reference.md    ← "Deploy via SSH to <internal-host>"
```

The plugin's `/ship` reads these before executing and integrates the rules.

**Eat-your-own-dogfood:** This plugin's own repo (`devops/`) uses
the same mechanism. Project-specific ship rules live in `.claude/skills/ship/`
within this repo — no separate `/ship-dotclaude` skill needed.

## Script Conventions

### Naming

Utility scripts use descriptive kebab-case: `build-id.js`, `render-diagram.js`.
Scripts are NOT hooks — they are helpers invoked by hooks or skills.

**Path rule**: Scripts live inside the plugin at `{PLUGIN_ROOT}/scripts/`. Reference them
as `node {PLUGIN_ROOT}/scripts/{name}.js` (or `$CLAUDE_PLUGIN_ROOT` in bash). Never use
`~/.claude/scripts/` — that path is not managed by the plugin installer and may not exist.

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
└── github-release.md
```

## Auto-Maintained Documentation

`README.md` and `docs/architecture.html` carry roster facts (hook/skill/agent
counts, the full hook lifecycle list) that drift the moment someone adds a hook
or skill. These live inside HTML-comment markers and are regenerated from the
canonical source — **never hand-edit the text between markers:**

```
<!--devops:count:hooks-->27<!--/devops:count:hooks-->        ← inline count
<!--devops:block:hook-lifecycle--> … <!--/devops:block:hook-lifecycle-->   ← block
```

- **Generator:** `scripts/gen-readme-sections.js` reads `hooks/hooks.json`,
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
their change, and `/ship` Step 2.6 (Docs-Sync) reconciles living docs
against the shipped diff before the version bump. Proportional (trivial changes
need none), non-blocking, and it never rewrites dated specs/concepts. Rules and
the trigger matrix: `deep-knowledge/documentation-maintenance.md`.

## General Rules

- All code is JavaScript (Node.js), no Bash scripts
- All paths use `os.homedir()` or `process.cwd()` — never hardcoded absolute paths
- All timeouts: 15s for git operations, 10s for file operations
- Non-fatal errors: log and continue, never block session start
- Config files: JSON format, human-readable with 2-space indent
