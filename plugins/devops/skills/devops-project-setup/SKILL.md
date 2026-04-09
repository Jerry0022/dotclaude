---
name: devops-project-setup
version: 0.1.0
description: >-
  Audit or initialize a project's repository hygiene: .gitignore, LICENSE,
  README, .editorconfig, .gitattributes, and AI tooling config. Also scaffolds
  plugin skill extensions for the project. Triggers on: "set up this project",
  "init repo", "audit gitignore", "add license", "fix gitignore", "repo hygiene",
  "Projekt einrichten", "Repo aufsetzen". Do NOT trigger for README generation
  (/devops-readme), CLAUDE.md edits, or source code changes.
argument-hint: "[--audit | --init] [--fix]"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Write, Edit, WebFetch
---

# Project Setup & Repo Hygiene

Audit or initialize a project's repository structure.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/project-setup/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/project-setup/SKILL.md` + `reference.md`
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
.claude/token-config.json
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

### 2.6 — Build-time injected files

Files containing values injected at build or dev-start time (build hashes, build IDs,
timestamps) that change on every run SHOULD be gitignored. They cause dirty worktrees
and noisy diffs with no value.

Common patterns to check for:
```gitignore
# Build-time injected (changes every dev-start / build)
**/build-id.*
**/build-hash.*
```

**Audit rule:** If a tracked file's only recent changes are build-hash or build-ID
updates (check `git log -5 --oneline -- <file>`), flag as **WARNING** and recommend
splitting the volatile value into a separate gitignored file.

## Step 2b — CLAUDE.md audit

Run `/devops-claude-md-lint` to check CLAUDE.md size and structure.
Report the result in the final output under a `### CLAUDE.md` section.

## Step 3 — LICENSE

If missing: ask user via AskUserQuestion (MIT, Apache 2.0, GPL 3.0, ISC, Proprietary).
Generate with current year and user name from git config.

## Step 4 — README check

Do NOT generate — inform user to run `/devops-readme` if missing.

## Step 5 — Project Map

Generate `.claude/project-map.md` — a compact index of the project's file structure.
Run the plugin's generator script:

```bash
node {PLUGIN_ROOT}/scripts/gen-project-map.js {project-root}
```

This creates a tree overview with directory descriptions and key file highlights.
The map is auto-regenerated by `ship_build` on every ship.
Report the result (file count, dir count) in the final output.

## Step 6 — Additional files

Check and report on: `.editorconfig`, `.gitattributes`, `CHANGELOG.md`.
Do NOT auto-create — only report status and recommend.

## Step 7 — Inform about skill extensions

Check if `.claude/skills/` exists in the project. If any extensions are already
present, list them in the report.

Point the user to `/devops-extend-skill` for interactively scaffolding or adapting
extensions for any plugin skill:

> "Du kannst jedes Plugin-Skill für dieses Projekt anpassen.
> Nutze `/devops-extend-skill`, um interaktiv eine Extension anzulegen oder
> eine bestehende zu bearbeiten. Mehr dazu: siehe Plugin README."

## Step 8 — Output report

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
- [INFO] Run /devops-extend-skill to scaffold extensions for plugin skills
```
