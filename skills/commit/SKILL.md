---
name: commit
description: Create a conventional commit for staged/changed files — enforces type, scope, and co-author footer. Use when the user wants to commit work.
disable-model-invocation: true
allowed-tools: Bash(git *)
---

# Commit

Create a well-formed conventional commit.

## Steps

1. Run `git status --short` — identify staged and unstaged changes.
2. Run `git diff --cached` — read ALL staged changes carefully.
3. If nothing is staged, run `git diff` to see unstaged changes and stage the relevant files with `git add <specific files>` (never `git add -A` or `git add .`).
4. Determine the **type** from the changes:
   - `feat` — new user-facing feature
   - `fix` — bug fix
   - `refactor` — internal restructure, no behavior change
   - `perf` — performance improvement
   - `test` — adding or fixing tests
   - `docs` — documentation only
   - `chore` — tooling, deps, CI, config
   - `style` — formatting, whitespace
5. Determine the **scope**: the module, component, or subsystem most affected (e.g. `core`, `overlay`, `desktop`, `ai`, `keybinder`).
6. Write a short **subject line** (≤72 chars): imperative mood, no period, no "Update X" — say what it does, not what changed.
7. Write a **body** (optional but recommended): explain the *why*, not the *what*. Wrap at 72 chars.
8. Append footer:
   ```
   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   ```
9. Commit with:
   ```bash
   git commit -m "$(cat <<'EOF'
   <type>(<scope>): <subject>

   <body>

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
10. Print the commit hash and title.

## Rules
- Never use `--no-verify` unless the user explicitly requests it.
- Never use `git add -A` or `git add .`.
- If a pre-commit hook fails, fix the issue and create a **new** commit — never `--amend` unless the user asks.
- Do not commit files that may contain secrets (`.env`, credentials, keys).
