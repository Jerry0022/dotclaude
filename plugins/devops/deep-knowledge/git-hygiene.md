# Git Hygiene

Cross-cutting git rules referenced by `/devops-commit`, `/devops-ship`, and hooks.

## Main-branch protection (hard rule)

- **HEAD must never be `main`/`master` while editing or committing.** New work always
  starts from a branch derived from `origin/main`:
  `git fetch origin && git switch -c <feat/topic> origin/main`.
- **Never commit, merge, push, rebase, cherry-pick, reset --hard, revert, apply or
  am on main/master directly.** The only path back to `main` is `/devops-ship`.
- **Never create PRs manually** (`gh pr create` / `gh pr merge`). Always via
  `/devops-ship` so build-ID, version bump, tag and completion card stay consistent.
- Enforcement: `pre.main.guard` (Bash) and `pre.edit.branch` (Edit/Write/NotebookEdit)
  block these actions unless a sentinel file `.claude/.ship-in-progress` is present
  (written by `ship_preflight`, cleared by `ship_cleanup`) or `DEVOPS_ALLOW_MAIN=1`
  is set for an explicit one-shot bypass.
- These rules only apply inside a git working tree. Outside a repo, the guards are
  no-ops.

## Before every commit

- Run `git status --short` — verify **zero `??` (untracked)** entries.
- Every new file must be either: staged for commit OR added to `.gitignore`.
- Previously tracked files that should be ignored: `git rm --cached <file>` first.

## Staging rules

- Never use `git add -A` or `git add .` — always stage specific files.
- For >5 changed files, use `AskUserQuestion` to let the user choose which subset to commit.

## Merge safety

- **Never** use `--ours`, `--theirs`, or any strategy that silently picks one side.
- Conflict resolution follows `deep-knowledge/merge-safety.md`.
- The `git-sync` cron detects conflicts and defers resolution to Claude.
- Complementary changes (both additions, non-overlapping edits) → AI resolves automatically.
- Mutually exclusive design decisions (user-facing choices) → user decides via `AskUserQuestion`.
- After resolving conflicts, verify the merged code is semantically correct (not just textually).

## Branch hygiene

- Feature branches are short-lived — ship and delete promptly.
- Never force-push to `main`/`master` without explicit user confirmation.
- After merge: local branch is deleted, remote branch is deleted by `--delete-branch`.
- Stale branches (upstream gone, no worktree) are cleaned up by the ship flow.
- After ship, `main` is checked out locally as a side-effect of cleanup. The next
  unit of work must start with a fresh branch (`git switch -c ... origin/main`)
  before any edits — see "Main-branch protection" above.

## Parallel development safety

See [merge-safety.md](merge-safety.md) for full details on preventing silent overwrites.

- **Rebase before merge** — mandatory when base has diverged (enforced by `ship_release`)
- **diff3 conflict style** — required for all developers (`git config merge.conflictstyle diff3`)
- **No auto-resolve** — `git-sync.js` never uses `--ours`; conflicts abort and warn
