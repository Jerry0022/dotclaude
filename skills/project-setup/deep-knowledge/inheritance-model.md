# Inheritance Model — Global ↔ Project Configuration

## Principles
- **Global = default**: Every rule in `~/.claude/CLAUDE.md` applies automatically in every project session.
- **Project = delta only**: Only additions, overrides, or project-specific details.
- Project-level skills with the same name **extend** the global skill — describe only the delta.
- Hooks follow the same principle: extend, not replace (unless marked as **Override**).

## Project CLAUDE.md Syntax
- `**Override (global §SectionName):**` — replaces the global rule for this project.
- `**Extends (global §SectionName):**` — adds to the global rule.

## Conflict Resolution Priority
1. Explicit project **Override** → wins over global.
2. Project **Extends** → global applies, project additions layered on top.
3. No annotation → global applies (project duplicate should be cleaned up).

## New Project Setup
1. Do **not** copy any global rules into the project file.
2. Start with `<!-- Inherits from ~/.claude/CLAUDE.md — do not duplicate global rules here -->`.
3. Add `<!-- global-sync: YYYY-MM-DD -->` to track last sync date.
4. Use **Extends** or **Override** syntax for project-specific parameters.

## Drift Detection
At session start, compare global CLAUDE.md against the project's `<!-- global-sync: YYYY-MM-DD -->` comment. If the global file changed since that date:
1. Identify affected sections.
2. Check for redundancy/conflicts with project rules.
3. Ask user (AskUserQuestion) to adopt/keep/merge.
4. Update the sync date.

## The dotclaude Repository
`~/.claude/` **is** the dotclaude git repo (`Jerry0022/dotclaude`). `settings.json` (root) and session state are in `.gitignore`. The `.claude/` subdirectory holds project-level Claude settings (also gitignored). Since `~/.claude/` is both global config dir and project root, Claude Code loads CLAUDE.md twice — ignore the project copy.
