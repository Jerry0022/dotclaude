# Ship Skill — Extension Guide

## How to extend

Create project-specific ship rules in your project:

```
{project}/.claude/skills/ship/
├── SKILL.md        ← Override or add steps
└── reference.md    ← Project-specific context
```

## What to customize

- **Quality gate commands**: Replace `npm run build` with your project's build
- **Deploy target**: SSH, GitHub Pages, Vercel, Docker, etc.
- **Additional version files**: `version.ts`, `config.json`, etc.
- **Pre-ship checks**: Custom validation, API contract tests
- **Post-ship actions**: Deploy, notify, update external systems

## Example extension (SKILL.md)

```markdown
## Additional quality gates
- Run `dotnet publish` before PR
- Verify installer builds: `npm run build:installer`

## Deploy target
- SSH deploy to 192.168.178.32 after merge

## Version files
- `src/version.ts` contains `export const VERSION = 'X.Y.Z'`
```

This pattern applies to ALL plugin skills, not just ship.
