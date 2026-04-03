# Git Hygiene

Cross-cutting git rules referenced by `/commit`, `/ship`, and hooks.

## Before every commit

- Run `git status --short` — verify **zero `??` (untracked)** entries.
- Every new file must be either: staged for commit OR added to `.gitignore`.
- Previously tracked files that should be ignored: `git rm --cached <file>` first.

## Staging rules

- Never use `git add -A` or `git add .` — always stage specific files.
- For >5 changed files, use `AskUserQuestion` to let the user choose which subset to commit.

## Branch hygiene

- Feature branches are short-lived — ship and delete promptly.
- Never force-push to `main`/`master` without explicit user confirmation.
- After merge: local branch is deleted, remote branch is deleted by `--delete-branch`.
- Stale branches (upstream gone, no worktree) are cleaned up by the ship flow.
