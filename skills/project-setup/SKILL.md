---
name: project-setup
description: >-
  Audit or initialize a project's repository hygiene: .gitignore rules, LICENSE
  file, README presence, .gitattributes, .editorconfig, and AI tooling config
  tracking (.claude/ skills, agents, hooks tracked vs. caches/worktrees ignored).
  Use this skill whenever: creating a new project or repo, onboarding an existing
  repo, auditing or modifying .gitignore / .gitattributes / .editorconfig / LICENSE,
  checking what should or shouldn't be tracked in git, or ensuring AI config files
  are correctly committed vs. ignored. Also triggers when the user edits or asks
  about any repo-structure file (.gitignore, .gitattributes, LICENSE, .editorconfig)
  — even a single-line change like "add node_modules to gitignore". Trigger phrases
  include: "set up this project", "init repo", "audit gitignore", "add license",
  "what should be tracked", "fix gitignore", "repo hygiene", "project scaffolding",
  "Projekt einrichten", "Repo aufsetzen". Do NOT trigger for README generation
  (/readme handles that), CLAUDE.md edits (/claude-md-improver handles that),
  or source code changes unrelated to repo structure.
argument-hint: "[--audit | --init] [--fix]"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Write, Edit
---

# Project Setup & Repo Hygiene

Audit or initialize a project's repository structure, ensuring correct .gitignore rules, LICENSE, README, and AI config tracking.

## Arguments

- `--audit`: Check existing repo hygiene and report issues (default if repo already exists)
- `--init`: Full initialization — create missing files, set up .gitignore, add LICENSE
- `--fix`: Auto-fix issues found during audit (without this flag, audit only reports)

If no argument is given: detect whether the repo is new (no commits) → `--init`, otherwise → `--audit`.

## Step 1 — Analyze the project

Gather context:

1. `git status` — is this a git repo? Any existing commits?
2. `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `*.csproj` — detect tech stack and language
3. Existing `.gitignore` — read and parse current rules
4. Existing `LICENSE` or `LICENSE.md`
5. Existing `README.md`
6. `.claude/` directory — check what AI config exists
7. `.github/` directory — check for workflows, templates
8. Directory structure via `Glob` — identify build output dirs, dependency dirs

Determine:
- **Language/stack**: Node.js, Python, Rust, Go, C#, Java, multi-language, etc.
- **Package manager**: npm, yarn, pnpm, pip, cargo, etc.
- **Build output dirs**: dist, build, out, target, bin, etc.
- **AI tooling present**: Claude, Cursor, Copilot, etc.
- **Monorepo detection**: Does `packages/`, `apps/`, `libs/`, or `workspaces` in package.json exist?

## Step 2 — .gitignore audit & generation

### 2.1 — Stack-specific ignores

Generate or verify ignore rules based on the detected stack. These are the **minimum required** sections:

#### Universal (all projects)
```gitignore
# OS artifacts
.DS_Store
Thumbs.db
Desktop.ini
*.swp
*.swo
*~

# Editor / IDE state
.idea/
.vscode/settings.json
.vscode/launch.json
*.sublime-workspace
*.code-workspace
```

Note: `.vscode/extensions.json` and `.vscode/tasks.json` are often shared — do NOT ignore them by default. Only ignore `.vscode/settings.json` and `.vscode/launch.json` (personal preferences).

#### Node.js / JavaScript / TypeScript
```gitignore
# Dependencies
node_modules/

# Build output
dist/
build/
out/
.next/
.nuxt/
.output/

# Package manager
*.tgz
.npm/
.yarn/cache/
.yarn/unplugged/
.yarn/install-state.gz
.pnp.*

# Runtime / cache
*.log
.cache/
.parcel-cache/
.turbo/

# Environment
.env
.env.local
.env.*.local

# Test coverage
coverage/
.nyc_output/
```

#### Python
```gitignore
# Virtual environments
venv/
.venv/
env/
__pycache__/
*.py[cod]
*.pyo
*.egg-info/
dist/
build/
*.egg

# Environment
.env

# Test / coverage
.pytest_cache/
.coverage
htmlcov/
.tox/
.mypy_cache/
```

#### Rust
```gitignore
target/
Cargo.lock  # only for libraries, NOT binaries
```

#### Go
```gitignore
# Binaries
*.exe
*.exe~
*.dll
*.so
*.dylib

# Build
/bin/
/vendor/
```

#### C# / .NET
```gitignore
bin/
obj/
*.user
*.suo
.vs/
packages/
```

### 2.1b — Monorepo additions

If a monorepo structure is detected:

```gitignore
# Monorepo — per-package build artifacts
packages/*/dist/
packages/*/build/
packages/*/node_modules/
apps/*/dist/
apps/*/.next/
```

Also check if individual packages have their own .gitignore files — flag if they contain rules that should be at root level.

### 2.2 — AI tooling ignores & directory structure (CRITICAL)

This section is mandatory for ALL projects, regardless of stack.

#### Claude directory structure convention

All Claude Code configuration belongs inside `.claude/`. Nothing Claude-specific should live at root level (except `CLAUDE.md` and `.claudeignore` — Claude Code requires these at root).

**Canonical `.claude/` layout:**
```
.claude/
├── commands/          # Slash commands (tracked)
├── skills/            # Project skills (tracked)
├── hooks/             # Hook scripts (tracked)
├── scripts/           # Claude-specific scripts — diagram rendering, helpers (tracked)
├── agents/            # Agent definitions (tracked)
├── agents.json        # Orchestrator config (tracked)
├── settings.json      # Project-level settings (tracked)
├── settings.local.json # Local overrides (ignored)
├── launch.json        # Dev server configs (tracked)
├── worktrees/         # Session worktrees (ignored)
├── todos/             # Session todos (ignored)
├── plans/             # Session plans (ignored)
└── ...session state   # All other session artifacts (ignored)
```

**Root-level rules:**
- `CLAUDE.md` → root (required by Claude Code)
- `.claudeignore` → root (required by Claude Code)
- `skills/` at root → **WRONG** — must be `.claude/skills/`
- Agent/team documentation (e.g. `AGENTS.md`) → `docs/`, not root
- Claude-specific scripts → `.claude/scripts/`, not root `scripts/`
- Project scripts (build, dev, CI) → root `scripts/` (these are NOT Claude-specific)

**MUST be tracked (never ignore):**
```
# AI tooling — shared config tracked, session state excluded
# DO NOT ignore these:
# CLAUDE.md
# .claude/commands/
# .claude/skills/
# .claude/hooks/
# .claude/settings.json          (project-level settings)
# .claude/agents/                 (agent definitions)
# .claude/agents.json             (orchestrator config)
# .cursor/rules
# .cursor/prompts/
# .github/copilot-instructions.md
# codex.md
```

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

### 2.3 — Secrets & credentials (CRITICAL)

Always ignore — never track:
```gitignore
# Secrets — NEVER commit
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.pfx
credentials.json
service-account*.json
```

### 2.4 — Section ordering

The .gitignore must follow this section order:
1. Dependencies
2. Build output
3. Runtime / cache
4. Environment / secrets
5. Test coverage
6. AI tooling — shared config tracked, session state excluded
7. OS / editor artifacts
8. Project-specific (if any)

Each section gets a comment header (`# Section name`). Blank line between sections.

### 2.5 — Audit rules with severity levels

When auditing an existing .gitignore, classify each finding:

| Severity | Meaning | Action with `--fix` |
|----------|---------|---------------------|
| **CRITICAL** | Secrets or credentials could be committed | Auto-fix immediately |
| **CRITICAL** | Shared AI config (.claude/skills/) is being ignored | Auto-fix immediately |
| **CRITICAL** | Claude files at root level instead of `.claude/` (e.g., root `skills/`) | Move to `.claude/` and update refs |
| **WARNING** | Required ignore rule is missing (e.g., node_modules/) | Auto-fix |
| **WARNING** | .env variants not ignored | Auto-fix |
| **INFO** | Redundant rules, wrong section order | Report only (suggest fix) |
| **INFO** | Missing optional files (.editorconfig, .gitattributes) | Report only |

With `--fix`: auto-fix CRITICAL and WARNING. Report INFO for manual review.
Without `--fix`: report all findings.

## Step 3 — LICENSE

### Audit
- Check if `LICENSE` or `LICENSE.md` exists
- Verify it contains a valid license text (not empty or placeholder)
- Check if `package.json` (or equivalent) has a matching `license` field

### Init
If no license exists, ask the user via `AskUserQuestion`:

| Option | When to suggest |
|--------|----------------|
| MIT | Default for open-source projects (Recommended) |
| Apache 2.0 | When patent protection matters |
| GPL 3.0 | When copyleft is desired |
| ISC | Simpler alternative to MIT |
| Proprietary | For closed-source / private repos |

After selection, generate the LICENSE file with the current year and the user's name/org (from git config or package.json author field).

## Step 4 — README check

Do NOT generate the README here — that's the `/readme` skill's job.

Instead, check:
- Does `README.md` exist?
- Does it have a version badge (`**Version: x.y.z**`)?
- Is it non-empty and non-placeholder?

If missing or insufficient, inform the user and suggest running `/readme`.

## Step 5 — Additional repo files check

Check for and report on:
- `.editorconfig` — recommend if missing (consistent formatting across editors)
- `.gitattributes` — recommend if missing (line ending normalization: `* text=auto`)
- `CHANGELOG.md` — note if missing (required per global versioning rules for versioned projects)
- `CONTRIBUTING.md` — note if missing (optional, but good for open-source)
- `.github/ISSUE_TEMPLATE/` — note if missing (optional)
- `.github/PULL_REQUEST_TEMPLATE.md` — note if missing (optional)

Do NOT auto-create these — only report their status and recommend.

## Step 5b — CI awareness

If `.github/workflows/` exists:
- Check if build artifacts produced by CI are correctly ignored (e.g., coverage reports, build outputs)
- Check if CI-specific cache directories are ignored
- Flag if CI generates files that might accidentally get committed

## Step 6 — Output

### Audit mode (default)
Present a structured report:

```
## Repo Hygiene Report

### .gitignore
- [CRITICAL] .env.local not ignored — secrets at risk
- [CRITICAL] .claude/skills/ is ignored but should be tracked
- [CRITICAL] skills/ at root level — must be .claude/skills/
- [WARNING] AI session state not ignored (.claude/worktrees/)
- [OK] Dependencies ignored
- [INFO] Rules in wrong section order

### LICENSE
- [OK] MIT license present, matches package.json

### README
- [WARNING] No version badge found
- Suggestion: Run /readme to regenerate

### Additional files
- [INFO] .editorconfig — recommended
- [INFO] .gitattributes — recommended
- [OK] CHANGELOG.md present

### CI Integration
- [OK] Coverage output ignored
- [WARNING] Build artifacts not in .gitignore
```

If `--fix` is passed: auto-fix all CRITICAL and WARNING issues. Ask before creating new files (LICENSE, .editorconfig).

### Init mode
Create all files sequentially:
1. `.gitignore` (full, stack-appropriate, including monorepo rules if applicable)
2. `.gitattributes` (`* text=auto` + language-specific rules)
3. `LICENSE` (after user selects type)
4. Inform user to run `/readme` for README generation
5. `.editorconfig` (basic: utf-8, lf, 2-space indent for web / 4-space for Python/Java)

## Style rules

- All generated files use English content
- .gitignore uses `#` comments, not inline explanations
- LICENSE uses the exact standard text for the chosen license type
- .editorconfig follows the standard format
- .gitattributes uses standard Git LFS / line ending patterns
