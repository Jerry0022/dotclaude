# Claude Directory Structure Convention

All Claude Code configuration belongs inside `.claude/`. Nothing Claude-specific
should live at root level (except `CLAUDE.md` and `.claudeignore`).

## Canonical layout

```
{project}/
├── CLAUDE.md                    ← Root (required by Claude Code)
├── .claudeignore                ← Root (required by Claude Code)
└── .claude/
    ├── commands/                ← Slash commands (tracked)
    ├── skills/                  ← Project skills + plugin extensions (tracked)
    ├── deep-knowledge/          ← Project reference docs (tracked, optional)
    ├── hooks/                   ← Hook scripts (tracked)
    ├── scripts/                 ← Claude-specific helpers (tracked)
    ├── agents/                  ← Agent definitions (tracked)
    ├── agents.json              ← Orchestrator config (tracked)
    ├── settings.json            ← Project-level settings (tracked)
    ├── settings.local.json      ← Local overrides (ignored)
    ├── launch.json              ← Dev server configs (tracked)
    ├── worktrees/               ← Session worktrees (ignored)
    ├── todos/                   ← Session todos (ignored)
    ├── plans/                   ← Session plans (ignored)
    └── ...session state         ← All other artifacts (ignored)
```

## Root-level rules

- `skills/` at root → **WRONG** — must be `.claude/skills/`
- Agent docs (AGENTS.md) → `docs/`, not root
- Claude scripts → `.claude/scripts/`, not root `scripts/`
- Project scripts (build, CI) → root `scripts/`

## Plugin skill extensions

Users extend plugin skills by creating files in their project:

```
{project}/.claude/skills/{plugin-skill-name}/
├── SKILL.md        ← Override/extend specific steps
└── reference.md    ← Additional context, rules, deploy targets
```

These are read by the plugin skill's Step 0 (Load Extensions).

## Project-level deep-knowledge

Projects may keep reference docs at `{project}/.claude/deep-knowledge/<topic>.md`
— mirrors the plugin's `plugins/devops/deep-knowledge/` layout. Used for
architecture notes, data-flow diagrams, conventions, and anything else that
exceeds the CLAUDE.md ~20-line budget. Referenced from `CLAUDE.md` via a
one-line pointer. The `/devops-claude-learn` skill writes here for project-specific
reference content (see `content-conventions.md`).
