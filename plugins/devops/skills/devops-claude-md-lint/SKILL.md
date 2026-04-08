---
name: devops-claude-md-lint
version: 0.1.0
description: >-
  Audit CLAUDE.md files for size, structure, and token efficiency. Checks both
  project-level and global CLAUDE.md. Warns when files exceed 25 lines (the
  recommended maximum for index-style CLAUDE.md). Suggests creating one if
  missing. Triggers on: "lint claude md", "claude md check", "check claude md",
  "CLAUDE.md zu lang", "audit claude md", "claude md audit".
  Do NOT trigger for editing CLAUDE.md content or for /devops-project-setup.
argument-hint: "[--fix]"
allowed-tools: Read, Glob, Bash, Write, Edit
---

# CLAUDE.md Lint

Audit CLAUDE.md files for token efficiency.

## Step 0 — Load Extensions

Silently check for optional overrides (do not surface "not found" in output):

1. Global skill extension: `~/.claude/skills/claude-md-lint/SKILL.md` + `reference.md`
2. Project skill extension: `{project}/.claude/skills/claude-md-lint/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Locate CLAUDE.md files

Find all CLAUDE.md files:

1. **Project**: `{git-root}/CLAUDE.md`
2. **Global**: `~/.claude/CLAUDE.md`

For each file: record whether it exists, and if so, count its lines.

## Step 2 — Audit each file

For each existing CLAUDE.md:

### 2.1 — Line count check

| Lines | Severity | Message |
|-------|----------|---------|
| ≤25 | **OK** | Size is within budget |
| 26–50 | **WARNING** | Over budget (X lines, max 25). Consider extracting details. |
| >50 | **CRITICAL** | Severely over budget (X lines, max 25). Must refactor. |

### 2.2 — Content analysis

Scan for content that should be extracted:

- **Long code blocks** (>5 lines): Move to `deep-knowledge/` or `reference.md`
- **Detailed step-by-step instructions**: Move to a skill or `deep-knowledge/`
- **Architecture descriptions**: Move to `deep-knowledge/architecture.md`
- **API docs or endpoint lists**: Move to `deep-knowledge/api.md`
- **Environment setup guides**: Move to `deep-knowledge/setup.md`

Count how many lines could be extracted. Report per category.

### 2.3 — Structure check

A good CLAUDE.md is an **index** — it should:

- Point to where detailed information lives (file paths, URLs)
- Contain short rules and conventions (1-2 lines each)
- List build/test/lint commands (1 line each)
- NOT contain full documentation

## Step 3 — Missing file handling

If a CLAUDE.md does **not** exist:

- **Project CLAUDE.md missing**: Suggest creating one. Offer a scaffold template:

```markdown
# {project-name}

## Stack
{detected from package.json / Cargo.toml / etc.}

## Commands
- Build: `{detected or "TODO"}`
- Test: `{detected or "TODO"}`
- Lint: `{detected or "TODO"}`

## Conventions
- {1-2 key rules}

## References
- Project map: see `.claude/project-map.md`
- Architecture: see `deep-knowledge/architecture.md`
```

- **Global CLAUDE.md missing**: Inform the user that `~/.claude/CLAUDE.md` can hold
  personal cross-project preferences (response style, language, conventions).

## Step 4 — Fix mode (`--fix`)

If `--fix` is passed and file is over budget:

1. Identify extractable sections (from Step 2.2)
2. For each section, propose where to move it (e.g., `deep-knowledge/{topic}.md`)
3. Create the target files with the extracted content
4. Replace the original section in CLAUDE.md with a one-line pointer:
   `- {Topic}: see deep-knowledge/{topic}.md`
5. Regenerate `deep-knowledge/INDEX.md` by running the plugin's index generator:
   `node {plugin-root}/scripts/gen-dk-index.js {project-root}/deep-knowledge`
   This ensures the index stays current after every extraction.
6. Verify final CLAUDE.md is ≤25 lines

Do NOT auto-fix without `--fix` — only report.

## Step 5 — Output report

```
## CLAUDE.md Audit

### Project: {path}
- [OK/WARNING/CRITICAL] {line count} lines (max 25)
- Extractable: {N} lines across {categories}
- Structure: {index-style / content-heavy / mixed}

### Global: ~/.claude/CLAUDE.md
- [OK/WARNING/CRITICAL/MISSING] {details}

### Recommendation
{specific actionable suggestions}
```
