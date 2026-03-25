# Skill Creation & Refinement

## Process
- Always use the Anthropic `skill-creator` skill to refine new skills.
- At minimum: draft the skill, then run description optimizer.
- For skills with verifiable outputs: run eval loop.

## Skill Structure
- `SKILL.md`: frontmatter (name, description, triggers) + step-by-step instructions.
- `deep-knowledge/`: specialized docs loaded on demand by the skill.
- Global skills: `~/.claude/skills/<name>/`
- Project skills: `.claude/skills/<name>/` (extend global skills, describe only delta).
