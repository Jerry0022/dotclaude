---
name: commit
description: >-
  Create a conventional commit for staged/changed files — enforces type, scope,
  and co-author footer. Use when the user wants to commit work, save changes,
  or check in code. Triggers on: "commit", "commit this", "save my changes",
  "check this in", "speicher das", "committe das", "einchecken". Also triggers
  when the user says "amend", "update the last commit", or "fix last commit" —
  in that case, use the amend flow. Do NOT trigger for push, PR, or ship
  operations (those are separate skills).
disable-model-invocation: true
allowed-tools: Bash(git *), AskUserQuestion
---

# Commit

Create a well-formed conventional commit.

## Step 0 — Detect intent

Before anything else, determine what the user wants:

- **Amend**: If the user says "amend", "update last commit", "fix last commit", or "add to last commit" → use the amend flow (Step 9b below). Only amend if the user explicitly asks — never amend by default.
- **Normal commit**: Everything else → standard flow below.

## Step 1 — Survey changes

Run `git status --short` — identify staged and unstaged changes.

## Step 2 — Read staged changes

Run `git diff --cached` — read ALL staged changes carefully.

## Step 3 — Smart staging

If nothing is staged, assess the situation:

- **≤5 changed files**: Run `git diff` to see what changed, then stage all relevant files with `git add <specific files>` (never `git add -A` or `git add .`).
- **>5 changed files**: Use `AskUserQuestion` to present file groups and let the user choose which subset to commit. Group by directory or logical change (e.g., "Feature files", "Test files", "Config changes"). This prevents accidental mega-commits.

## Step 4 — Determine type

Pick the type from the changes:

| Type | When to use |
|------|-------------|
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `refactor` | Internal restructure, no behavior change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `chore` | Tooling, deps, CI, config |
| `style` | Formatting, whitespace |

## Step 5 — Determine scope

The module, component, or subsystem most affected (e.g., `core`, `overlay`, `desktop`, `ai`, `keybinder`, `config`, `skills`).

## Step 6 — Write subject line

≤72 chars, imperative mood, no period. Say what it does, not what changed. Bad: "Updated X". Good: "add dark mode toggle to settings".

## Step 7 — Write body (optional but recommended)

Explain the *why*, not the *what*. Wrap at 72 chars.

## Step 8 — Determine co-author

The co-author footer must reflect the **actual model powering this session**. Check the system prompt for the model identifier and map it:

| Model ID contains | Co-Author line |
|-------------------|----------------|
| `opus` | `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` |
| `sonnet` | `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` |
| `haiku` | `Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>` |

Never hardcode a specific model — always detect dynamically.

## Step 9a — Commit (normal)

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject>

<body>

<Co-Author line from Step 8>
EOF
)"
```

## Step 9b — Commit (amend)

Only when the user explicitly requested an amend:

```bash
git commit --amend -m "$(cat <<'EOF'
<type>(<scope>): <updated subject>

<updated body>

<Co-Author line from Step 8>
EOF
)"
```

## Step 10 — Report

Print the commit hash and title.

## Rules

- Never use `--no-verify` unless the user explicitly requests it.
- Never use `git add -A` or `git add .`.
- If a pre-commit hook fails, fix the issue and create a **new** commit — never `--amend` unless the user asks.
- Do not commit files that may contain secrets (`.env`, credentials, keys).
- If merge commits are needed, do not use this skill — handle merge commits manually.
