# dotclaude-dev-ops — Plugin Conventions

## Plugin Versioning

The plugin follows [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH

MAJOR  → Breaking changes (hook behavior change, skill rename, removed feature)
MINOR  → New features (new hook, new skill, new template)
PATCH  → Bug fixes, doc updates, internal improvements
```

Current version is tracked in `.claude-plugin/plugin.json` → `"version"`.
Each release gets a git tag: `v0.1.0`, `v0.2.0`, etc.

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
 * @plugin dotclaude-dev-ops
 * @description One-line description of what this hook does.
 */
```

Hook versions are independent from the plugin version.
A hook version bumps when:
- PATCH: internal logic fix, no behavior change
- MINOR: new detection/feature within the hook
- MAJOR: behavior change (e.g., blocking → warning, new exit codes)

### Directory Structure

```
hooks/
├── hooks.json                  ← Registry (declares all hooks + matchers)
├── session-start/
│   ├── ss.git.sync.js
│   └── ss.tokens.scan.js
├── pre-tool-use/
│   ├── pre.tokens.guard.js
│   └── pre.ship.guard.js
├── post-tool-use/
│   └── post.flow.completion.js
└── stop/
    └── stop.ship.guard.js
```

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
deep-knowledge/                        ← Plugin-global reference docs
├── test-strategy.md                   ← When/how to test (used by completion flow)
├── visual-verification.md             ← Preview methods: screenshot, simulated, etc.
└── {topic}.md                         ← Any cross-cutting concern
```

**vs. skill-level deep-knowledge:**
- `skills/ship/deep-knowledge/versioning.md` → only used by `/ship`
- `deep-knowledge/test-strategy.md` → used by hooks AND skills

Hooks reference plugin-level deep-knowledge in their stdout instructions to Claude.

## Skill Conventions

### Naming

Skill directory names use kebab-case: `ship`, `new-issue`, `deep-research`.
Skills are invoked as: `/dotclaude-dev-ops:{skill-name}` (plugin-prefixed).

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
## Step 0: Load User Extensions

1. Read `~/.claude/skills/{skill-name}/SKILL.md` if exists → global user overrides
2. Read `~/.claude/skills/{skill-name}/reference.md` if exists → global user context
3. Read `{project}/.claude/skills/{skill-name}/SKILL.md` if exists → project overrides
4. Read `{project}/.claude/skills/{skill-name}/reference.md` if exists → project context
5. Merge all layers: project rules > global rules > plugin defaults
6. Proceed with merged ruleset
```

**This pattern is mandatory for every new skill.** When creating skills
(via `/skill-creator` or manually), always include the Step 0 extension
load sequence. Skills that skip this step are non-compliant.

**Example: A user extends `/ship` for their HA-Finance project:**

```
ha-finance/
└── .claude/
    └── skills/
        └── ship/
            ├── SKILL.md        ← "Before PR: run npm test && npm run lint"
            └── reference.md    ← "Deploy via SSH to 192.168.178.32"
```

The plugin's `/ship` reads these before executing and integrates the rules.

**Eat-your-own-dogfood:** This plugin's own repo (`dotclaude-dev-ops/`) uses
the same mechanism. Project-specific ship rules live in `.claude/skills/ship/`
within this repo — no separate `/ship-dotclaude` skill needed.

## Script Conventions

### Naming

Utility scripts use descriptive kebab-case: `build-id.js`, `render-diagram.js`.
Scripts are NOT hooks — they are helpers invoked by hooks or skills.

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
├── config.template.json
├── settings.template.json
└── project-claude-md.md
```

## General Rules

- All code is JavaScript (Node.js), no Bash scripts
- All paths use `os.homedir()` or `process.cwd()` — never hardcoded absolute paths
- All timeouts: 15s for git operations, 10s for file operations
- Non-fatal errors: log and continue, never block session start
- Config files: JSON format, human-readable with 2-space indent
