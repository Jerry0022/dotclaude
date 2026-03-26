---
name: project-setup
version: 0.1.0
description: >-
  Audit or initialize a project's repository hygiene: .gitignore, LICENSE,
  README, .editorconfig, .gitattributes, and AI tooling config. Also scaffolds
  plugin skill extensions for the project. Triggers on: "set up this project",
  "init repo", "audit gitignore", "add license", "fix gitignore", "repo hygiene",
  "Projekt einrichten", "Repo aufsetzen". Do NOT trigger for README generation
  (/readme), CLAUDE.md edits, or source code changes.
argument-hint: "[--audit | --init] [--fix]"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Write, Edit, WebFetch
---

# Project Setup & Repo Hygiene

Audit or initialize a project's repository structure.

## Step 0 — Load Extensions

1. Read `~/.claude/skills/project-setup/SKILL.md` + `reference.md` if exists → global overrides
2. Read `{project}/.claude/skills/project-setup/SKILL.md` + `reference.md` if exists → project overrides
3. Merge: project > global > plugin defaults

## Arguments

- `--audit`: Check existing repo and report issues (default for existing repos)
- `--init`: Full initialization — create missing files, set up ignores, scaffold extensions
- `--fix`: Auto-fix issues found during audit

No argument: detect if repo is new (no commits) → `--init`, otherwise → `--audit`.

## Step 1 — Analyze the project

1. `git status` — is this a git repo?
2. Detect tech stack from manifest files (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `*.csproj`)
3. Read existing `.gitignore`
4. Check `LICENSE`, `README.md`, `.claude/` directory
5. Detect monorepo structure (`packages/`, `apps/`, `workspaces`)

## Step 2 — .gitignore

### 2.1 — Language/Framework ignores (dynamic)

Instead of shipping static templates, fetch the appropriate rules:

1. Detect the project's language/framework from Step 1
2. Fetch from `gitignore.io` API: `https://www.toptal.com/developers/gitignore/api/{stack}`
   - Example: `node`, `python`, `rust`, `go`, `csharp`, `java`
3. For IDEs, also fetch: `visualstudiocode`, `intellij`, `vim`, etc.
4. Merge fetched rules with the mandatory sections below

If the API is unavailable, fall back to basic rules from Claude's knowledge.

### 2.2 — Claude / AI tooling ignores (mandatory, always included)

See `deep-knowledge/claude-directory-structure.md` for the canonical `.claude/` layout.

**MUST be tracked (never ignore):**
- `CLAUDE.md`, `.claudeignore` (root level, required by Claude Code)
- `.claude/commands/`, `.claude/skills/`, `.claude/hooks/`
- `.claude/settings.json`, `.claude/agents/`, `.claude/agents.json`, `.claude/launch.json`

**MUST be ignored:**
```gitignore
# AI tooling — session state (never track)
.claude/worktrees/
.claude/todos/
.claude/plans/
.claude/projects/
.claude/session-env/
.claude/shell-snapshots/
.claude/backups/
.claude/telemetry/
.claude/token-cache/
.claude/.cache/
.claude/*.log
```

### 2.3 — Secrets (mandatory, always included)

```gitignore
# Secrets — NEVER commit
.env
.env.*
!.env.example
*.pem
*.key
*.p12
credentials.json
service-account*.json
```

### 2.4 — Section ordering

1. Dependencies → 2. Build output → 3. Runtime/cache → 4. Environment/secrets →
5. Test coverage → 6. AI tooling → 7. OS/editor → 8. Project-specific

### 2.5 — Audit severity

| Severity | Meaning | `--fix` action |
|----------|---------|----------------|
| **CRITICAL** | Secrets could be committed | Auto-fix |
| **CRITICAL** | Shared AI config is being ignored | Auto-fix |
| **WARNING** | Required ignore rule missing | Auto-fix |
| **INFO** | Redundant rules, wrong order | Report only |

## Step 3 — LICENSE

If missing: ask user via AskUserQuestion (MIT, Apache 2.0, GPL 3.0, ISC, Proprietary).
Generate with current year and user name from git config.

## Step 4 — README check

Do NOT generate — inform user to run `/readme` if missing.

## Step 5 — Additional files

Check and report on: `.editorconfig`, `.gitattributes`, `CHANGELOG.md`.
Do NOT auto-create — only report status and recommend.

## Step 6 — Scaffold plugin skill extensions

**This is the key onboarding step.** Create an exemplary extension for the
`/ship` skill to show users how plugin customization works:

```
{project}/.claude/skills/ship/
├── SKILL.md        ← Project-specific ship overrides
└── reference.md    ← Project-specific context
```

**SKILL.md content (scaffold):**
```markdown
---
name: ship
description: Project-specific ship extensions for {project-name}
---

# Ship Extensions

## Additional quality gates
<!-- Add project-specific build/test commands here -->
<!-- Example: npm run lint && npm run test:unit -->

## Deploy target
<!-- Define where this project deploys -->
<!-- Example: SSH to 192.168.178.32, GitHub Pages, Vercel -->

## Version files
<!-- List additional files that contain the version string -->
<!-- Example: src/version.ts, config/app.json -->
```

**reference.md content (scaffold):**
```markdown
# Ship Reference — {project-name}

## Project context
<!-- Describe project-specific shipping requirements -->

## CI/CD
<!-- Link to GitHub Actions workflows, describe release process -->
```

After scaffolding, explain to the user:
> "Ich habe eine exemplarische Ship-Extension erstellt unter `.claude/skills/ship/`.
> Dort kannst du projekt-spezifische Build-Befehle, Deploy-Targets und Version-Dateien
> definieren. Das Plugin liest diese Dateien automatisch vor jedem Ship.
> Das gleiche Pattern gilt für **alle** Plugin-Skills — erstelle einfach
> `.claude/skills/{skill-name}/SKILL.md` oder `reference.md` in deinem Projekt.
> Mehr dazu: siehe Plugin README."

## Step 7 — Output report

```
## Repo Hygiene Report

### .gitignore
- [CRITICAL/WARNING/OK/INFO] ...

### LICENSE
- [OK/WARNING] ...

### README
- [OK/WARNING] ...

### Additional files
- [INFO] ...

### Plugin Extensions
- [OK] Ship extension scaffolded at .claude/skills/ship/
```
