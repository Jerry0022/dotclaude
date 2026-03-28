---
name: commit
version: 0.1.0
description: >-
  Create a conventional commit for staged/changed files — enforces type, scope,
  and co-author footer. Triggers on: "commit", "commit this", "save my changes",
  "check this in", "speicher das", "committe das", "einchecken", "amend",
  "update the last commit", "fix last commit". Do NOT trigger for push, PR,
  or ship operations.
disable-model-invocation: true
allowed-tools: Bash(git *), AskUserQuestion
---

# Commit

Create a well-formed conventional commit.

## Step 0 — Load Extensions

Silently check for optional overrides (do not surface "not found" in output):

1. Global skill extension: `~/.claude/skills/commit/SKILL.md` + `reference.md`
2. Project skill extension: `{project}/.claude/skills/commit/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Detect intent

- **Amend**: user says "amend", "update last commit", "fix last commit" → amend flow in Step 8
- **Normal**: everything else → standard flow

## Step 2 — Survey changes

```bash
git status --short
```

Identify staged, unstaged, and untracked files.

## Step 3 — Smart staging

If nothing is staged:

- **≤5 changed files**: Run `git diff` to see changes, then stage all relevant files with `git add <specific files>`.
- **>5 changed files**: Use `AskUserQuestion` to present file groups and let the user choose. Group by directory or logical change.

**Rules:** Never use `git add -A` or `git add .`. See `deep-knowledge/git-hygiene.md`.

## Step 4 — Read staged diff

```bash
git diff --cached
```

Read all staged changes carefully — this informs type, scope, and message.

## Step 5 — Determine type and scope

**Type:**

| Type | When |
|------|------|
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `refactor` | Internal restructure, no behavior change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `chore` | Tooling, deps, CI, config |
| `style` | Formatting, whitespace |

**Scope:** The module, component, or subsystem most affected. Derive from the file paths and project structure — no hardcoded list.

## Step 6 — Write message

**Subject:** ≤72 chars, imperative mood, no period. Say what it does, not what changed.
- Bad: "Updated the login screen"
- Good: "add dark mode toggle to settings"

**Body** (optional but recommended): Explain the *why*, not the *what*. Wrap at 72 chars.

## Step 7 — Add co-author

Extract the model name from the current session's system prompt and format:

```
Co-Authored-By: Claude {Model} <noreply@anthropic.com>
```

Always detect dynamically — never hardcode a specific model version.

## Step 8 — Execute commit

**Normal:**
```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude <Model> <noreply@anthropic.com>
EOF
)"
```

**Amend** (only when user explicitly requested):
```bash
git commit --amend -m "$(cat <<'EOF'
<type>(<scope>): <updated subject>

<updated body>

Co-Authored-By: Claude <Model> <noreply@anthropic.com>
EOF
)"
```

## Step 9 — Report

Show commit hash, title, and stats:

```bash
git log --oneline -1 && git diff --stat HEAD~1
```

## Rules

- Never use `--no-verify` unless the user explicitly requests it.
- Never use `git add -A` or `git add .`.
- If a pre-commit hook fails, fix the issue and create a **new** commit — never `--amend` unless the user asks.
- Do not commit files that may contain secrets (`.env`, credentials, keys).
- Merge commits are out of scope — handle manually.
