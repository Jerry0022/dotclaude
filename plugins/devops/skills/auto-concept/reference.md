# Concept — Extension Reference

What users can override in their global or project-level extensions.

## Extension Paths

- Global: `~/.claude/skills/auto-concept/reference.md`
- Project: `{project}/.claude/skills/auto-concept/reference.md`

The override loader injects both as one `[skill-overrides]` block when the
skill starts. A legacy `SKILL.md` there is still read but deprecated (Claude
Code loads it as a skill of its own) — rename it to `reference.md`.

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

### Try-it sign-in

Tell the final report how to sign in when its "▶ Selbst ausprobieren" link
points at a login-gated route (#933). Without it Claude falls back to the
Local Test User convention and the project's auth config:

```markdown
## Try-it sign-in

- Origin: `http://localhost:4200` (OAuth redirect allowlist covers only this)
- Login path: `/login`
- Account: test account in `docs/test-accounts.md` (email + password)
```

### Output Location

Override where HTML files are written:

```markdown
## Output

- Output directory: `docs/devops-concepts/` (instead of `.claude/concept/`)
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
