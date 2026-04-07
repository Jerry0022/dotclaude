# Skill Extension Guide — For Plugin Integrators

How to customize devops skills and agents for your project.

## The 3-Layer Extension Model

Every skill and agent supports three layers of customization:

```
Layer 1: Plugin defaults        ← devops (immutable)
Layer 2: User global overrides  ← ~/.claude/skills/{name}/
Layer 3: Project overrides      ← {project}/.claude/skills/{name}/
```

**Priority:** Project > Global > Plugin. The most specific layer wins on conflict.

## What you can create

In each layer, you can create two files:

| File | Purpose | Example |
|---|---|---|
| `SKILL.md` | Override or add steps to the skill | Add a deploy step to /devops-ship |
| `reference.md` | Add context the skill reads before executing | List version files, deploy targets |

Both are optional. Create only what you need.

## Layer 2: User Global Extensions

Lives in `~/.claude/skills/{skill-name}/`. Applies to ALL your projects.

```
~/.claude/
└── skills/
    └── commit/
        └── reference.md    ← "Always use scope 'app' for this user"
```

**Use for:** Personal conventions that apply everywhere (commit style, preferred
tools, default configurations).

## Layer 3: Project Extensions

Lives in `{project}/.claude/skills/{skill-name}/`. Applies only to this project.

```
my-angular-app/
└── .claude/
    └── skills/
        ├── ship/
        │   ├── SKILL.md        ← "Before PR: run ng build --prod"
        │   └── reference.md    ← "Deploy via SSH to 192.168.178.32"
        ├── commit/
        │   └── reference.md    ← "Scope must be one of: core, ui, api"
        └── debug/
            └── reference.md    ← "Logs at %APPDATA%/MyApp/logs/"
```

**Use for:** Project-specific build commands, deploy targets, version files,
log paths, test commands, CI integration.

## How extensions are loaded

Every plugin skill starts with Step 0:

```
1. Read ~/.claude/skills/{name}/SKILL.md + reference.md      → global
2. Read {project}/.claude/skills/{name}/SKILL.md + reference.md → project
3. Merge all layers: project rules > global rules > plugin defaults
4. Proceed with merged ruleset
```

## Extension examples by skill

### /devops-ship
```markdown
# reference.md
## Quality gates
- Run `npm run lint && npm run test:unit` before PR
- Run `dotnet publish` for .NET projects

## Deploy target
- SSH deploy: scp dist/ user@192.168.178.32:/var/www/

## Version files
- src/environments/version.ts → `export const VERSION = 'X.Y.Z'`
- electron-builder.json → `"version": "X.Y.Z"`
```

### /devops-commit
```markdown
# reference.md
## Scope rules
- Valid scopes: core, ui, api, auth, config
- Always use module name as scope, not file name
```

### /debug
```markdown
# reference.md
## Log locations
- Electron main: %APPDATA%/MyApp/logs/main.log
- Electron renderer: DevTools console
- Angular dev server: terminal output
```

### /devops-new-issue
```markdown
# reference.md
## Project board
- Owner: MyOrg
- Project ID: 5
- Status field ID: PVTF_abc123
- "In Progress" option ID: 98765

## Required labels
- role:frontend, role:backend, role:qa
- module:auth, module:dashboard, module:api
```

## Agent extensions

Same pattern applies to agents:

```
{project}/.claude/agents/{agent-name}/AGENT.md
```

Override responsibilities, tools, or collaboration rules per project.

## Scaffolding

Run `/devops-extend-skill` to interactively scaffold an extension for any plugin skill.
It lists all available skills, checks whether an extension already exists in your
project, and either scaffolds new files or opens the existing ones for editing.

## Rules

- Never edit plugin files directly — always extend via Layer 2 or 3
- Extensions are additive by default — they add to the plugin behavior
- To override a specific step, redefine it in your SKILL.md
- To add context, use reference.md (no step redefinition needed)
- Plugin updates (via Claude Code marketplace) never overwrite your extensions
