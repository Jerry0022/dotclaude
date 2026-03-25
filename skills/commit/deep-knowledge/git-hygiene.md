# Git Hygiene

## Before Every Commit
- Run `git status --short` — verify **zero `??` (untracked)** entries.
- Every new file must be either: staged for commit OR added to `.gitignore`.
- Previously tracked files that should be ignored: `git rm --cached <file>` first.

## Staging Rules
- Never use `git add -A` or `git add .` — always stage specific files.
- For >5 changed files, use `AskUserQuestion` to let the user choose which subset to commit.
