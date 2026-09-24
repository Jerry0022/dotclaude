# Project Setup — Repo Hygiene

How to audit or initialize a project's repository structure: .gitignore, LICENSE, README, .editorconfig, .gitattributes, CLAUDE.md, AI tooling config. Former `setup-project` skill (retired 2026-09-24).

## When this applies

- **A new repository.** `ss.project.setup` notices a repo without a commit or
  without a root `.gitignore` and tells Claude to offer this setup once per
  clone. Run it only when the user agrees.
- **A prompt about it** — "set up this project", "init repo", "audit
  gitignore", "add license", "fix gitignore", "repo hygiene", "Projekt
  einrichten", "Repo aufsetzen", or the old `/setup-project`:
  `prompt.knowledge.dispatch` points here. Do only what was asked: "add
  license" is Step 4 alone, "fix gitignore" is Step 2 alone, not the whole
  audit.

## What runs on its own now

| Former step | Now |
|---|---|
| Plugin runtime files in `.gitignore` (the marked block) | `ss.project.setup` writes `hooks/lib/runtime-ignores.js` into the clone's `.git/info/exclude` at every session start — no repo diff, every worktree covered. A marked `# >>> devops-plugin runtime state` block left in `.gitignore` by an earlier setup is harmless; remove it only when the user asks. |
| Project map | `ship_build` regenerates `.claude/project-map.md` on every ship. |
| CLAUDE.md budget | `post.claude.budget` measures every Claude context file at write time. |
| README | `pre.readme.standards` + `readme-standards.md`. |

## Project overrides (former skill extension)

`{project}/.claude/skills/setup-project/SKILL.md` + `reference.md` (and the same
under `~/.claude/skills/setup-project/`) still apply — the dispatch pointer
names them when they exist. Merge: project > global > this document.

## Modes

- **audit** — check an existing repo and report issues (default when the repo
  has commits).
- **init** — create what is missing (repo without commits).
- **fix** — apply the audit's auto-fixable findings (only when the user asked
  for fixes).

## Step 1 — Analyze the project

1. `git status` — is this a git repo?
2. Detect the tech stack from manifest files (`package.json`, `Cargo.toml`,
   `pyproject.toml`, `go.mod`, `*.csproj`).
3. Read the existing `.gitignore`.
4. Check `LICENSE`, `README.md`, `.claude/`.
5. Detect a monorepo structure (`packages/`, `apps/`, `workspaces`).

## Step 2 — .gitignore

### Language/framework ignores

1. Detect the language/framework from Step 1.
2. Fetch from the gitignore.io API:
   `https://www.toptal.com/developers/gitignore/api/{stack}` (e.g. `node`,
   `python`, `rust`, `go`, `csharp`, `java`); for IDEs also `visualstudiocode`,
   `intellij`, `vim`, …
3. Merge the fetched rules with the sections below. API unavailable → basic
   rules from knowledge.

### Claude / AI tooling

See `claude-directory-structure.md` for the canonical `.claude/` layout. The
line to hold: **plugin _configuration_ is tracked, plugin _runtime state_ is
ignored.**

**MUST be tracked (never ignore):** `CLAUDE.md`, `.claudeignore`,
`.claude/commands/`, `.claude/skills/`, `.claude/hooks/`,
`.claude/settings.json`, `.claude/agents/`, `.claude/agents.json`,
`.claude/launch.json`, `.claude/graphify.json` (the graph opt-out record — a
project decision; ignoring it silently re-enables the graph for everyone who
clones the repo), `.claude/deep-knowledge/`, `.claude/project-map.md`.

**Runtime state** needs no `.gitignore` entry for the plugin's own files — they
are excluded per clone (table above). For collaborators who use Claude Code
without the plugin, a shared `.gitignore` may still list Claude Code's own
session state:

```gitignore
# AI tooling — session state (never track)
.claude/worktrees/
.claude/todos/
.claude/plans/
.claude/settings.local.json
.claude/*.log
```

### Secrets (always)

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

### Section order

1. Dependencies → 2. Build output → 3. Runtime/cache → 4. Environment/secrets →
5. Test coverage → 6. AI tooling → 7. OS/editor → 8. Project-specific

### Audit severity

| Severity | Meaning | fix mode |
|----------|---------|----------|
| **CRITICAL** | Secrets could be committed | fix |
| **CRITICAL** | Shared AI config is being ignored | fix |
| **WARNING** | Required ignore rule missing | fix |
| **INFO** | Redundant rules, wrong order | report only |

### Build-time injected files

Files holding values injected at build or dev-start time (build hashes, build
IDs, timestamps) that change on every run should be gitignored — they cause
dirty worktrees and noisy diffs:

```gitignore
# Build-time injected (changes every dev-start / build)
**/build-id.*
**/build-hash.*
```

A tracked file whose only recent changes are such values
(`git log -5 --oneline -- <file>`) is a **WARNING**: recommend splitting the
volatile value into a separate gitignored file.

## Step 3 — CLAUDE.md audit

Check the project `CLAUDE.md` and the global `~/.claude/CLAUDE.md`: exists,
line count. Budgets, what to extract and where, the extraction procedure and
the scaffold for a missing file live in `content-conventions.md`. Report per
file `[OK|WARNING|CRITICAL|MISSING]`, the line count against its budget, and
whether it reads as an index or as documentation. Extract only in fix mode.

## Step 4 — LICENSE

Missing → ask with `AskUserQuestion` (MIT, Apache 2.0, GPL 3.0, ISC,
Proprietary). Generate it with the current year and the user name from git
config.

## Step 5 — README

Do not generate one here — report a missing README; when the user asks for
one, `readme-standards.md` applies.

## Step 6 — Project map

A repo without `.claude/project-map.md`:
`node {PLUGIN_ROOT}/scripts/gen-project-map.mjs {project-root}` — report file
and directory counts. It is regenerated on every ship afterwards.

## Step 7 — Platform audit (Windows only)

Skip on other platforms.

1. `%APPDATA%\Claude\claude_desktop_config.json` missing → `[INFO] Desktop App
   not detected`.
2. Otherwise grep the last 200 lines of `%APPDATA%\Claude\logs\main.log` for
   `bypassPermissionsModeEnabled pref is off`.
3. Match → `[WARNING] Desktop App master switch off — every session runs as
   acceptEdits.` In fix mode, print how to enable **Settings → Bypass
   permissions mode** in the Desktop App — never patch the JSON
   (`claude-desktop-app-setup.md`). No match → `[OK]`.

## Step 8 — Additional files and extensions

- `.editorconfig`, `.gitattributes`, `CHANGELOG.md`: report status and
  recommend — never auto-create.
- `.claude/skills/`: list existing plugin skill extensions. One under a
  pre-restructure skill name (`ship/`, `fix/`, `run-backlog/`, … —
  `hooks/lib/skill-names.js`) still loads as a fallback: report it as "old
  name, still works — rename when convenient". Point to "extend skill"
  (auto-extend) for scaffolding one.

## Step 9 — Report and card

```
## Repo Hygiene Report

### .gitignore
- [CRITICAL/WARNING/OK/INFO] ...

### LICENSE / README / Additional files
- [OK/WARNING/INFO] ...

### CLAUDE.md
- [OK/WARNING/CRITICAL/MISSING] ...

### Platform Audit
- [WARNING/OK/INFO] ...
```

Then `render_completion_card`: `ready` when files were written (pass `changes`
per file and `state`), `analysis` for an audit that wrote nothing.
