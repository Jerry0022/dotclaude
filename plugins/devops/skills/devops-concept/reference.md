# Concept — Extension Reference

What users can override in their global or project-level extensions.

## Extension Paths

- Global: `~/.claude/skills/concept/SKILL.md` + `reference.md`
- Project: `{project}/.claude/skills/concept/SKILL.md` + `reference.md`

## What to Override

### Design Customization

Override default colors, fonts, or branding in a project extension:

```markdown
## Design Overrides

- Brand primary: `#E63946`
- Brand secondary: `#457B9D`
- Font: `'Inter', sans-serif`
- Logo: `assets/logo.svg` (embed as base64 in HTML)
- Default theme: `light` (instead of `dark`)
```

### Default Variant

Set a project-level default variant when most concepts in this project
are the same type:

```markdown
## Defaults

- Default variant: `plan`
- Default language: `en` (override German UI labels)
```

### Output Location

Override where HTML files are written:

```markdown
## Output

- Output directory: `docs/devops-concepts/` (instead of `.claude/devops-concept/`)
- Include in git: true (don't add to .gitignore)
```

### Additional Interactive Elements

Add project-specific decision types:

```markdown
## Custom Elements

- Add "Assignee" dropdown to plan steps (team: Alice, Bob, Carol)
- Add "Sprint" selector to all variants (Sprint 1-5)
- Add "Confidence" slider (0-100%) to analysis findings
```

### Browser Preference

Override browser tool priority or specify a preferred browser:

```markdown
## Browser

- Preferred tool: playwright (instead of auto-detect)
- Browser: msedge (for Playwright to use Edge specifically)
```
