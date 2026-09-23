# Git Hygiene

Cross-cutting git rules referenced by `/ship`, the role agents, and hooks.
Commit message format and granularity: [commit-conventions.md](commit-conventions.md).

## Main-branch protection (hard rule)

- **HEAD must never be `main`/`master` while editing or committing.** New work always
  starts from a branch derived from `origin/main`:
  `git fetch origin && git switch -c <feat/topic> origin/main`.
- **Never commit, merge, push, rebase, cherry-pick, reset --hard, revert, apply or
  am on main/master directly.** The only path back to `main` is `/ship`.
- **Never create PRs manually** (`gh pr create` / `gh pr merge`). Always via
  `/ship` so build-ID, version bump, tag and completion card stay consistent.
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
- The background `git-sync` detects conflicts and defers resolution to Claude.
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

## Session-worktree hygiene

Enforced by the parallel-agent guard introduced in #193. See also
[merge-safety.md § Worktree Path Discipline](merge-safety.md#worktree-path-discipline).

### Work and commit inside the session worktree

- **Always work inside the session worktree** — cwd is `.claude/worktrees/<name>/`,
  branch is `claude/<name>`.
- **Never run git-mutating commands from the main repo root** while a session
  worktree is active. Mutating commands: `commit`, `checkout -b`, `merge`,
  `rebase`, `cherry-pick`, `reset --hard`, `apply`, `am`.
- **Why:** commits issued from the main repo root land on the main repo's
  current branch, not on the session branch. The session worktree is left dirty
  (untracked / modified files not staged to any branch). That split state is
  silent — no error is raised.

### Ship-end invariant: tracked-or-gitignored

- At ship completion, every file created during the session must be either:
  - **(a) tracked → committed → pushed → merged**, or
  - **(b) explicitly gitignored**.
- **Never leave a session worktree in a "limbo" state** — partially committed,
  untracked, or staged but not pushed — when a ship reports success.
- A ship pipeline must **not** declare success while the session worktree is
  dirty. Dirty = any `git status` output other than "nothing to commit."

### Why it matters

- A success path that strands uncommitted work in the session worktree triggers
  an "archive N uncommitted changes?" prompt on the next session start.
- This undermines trust in the ship pipeline as a no-data-loss guarantee and
  forces the user to manually rescue or discard work.

### Enforcement points

- **`ship_preflight`** — when the working directory is the main repo root,
  hard-blocks if a dirty session worktree is on the shipped branch (or base) —
  i.e. this ship's own worktree. Other dirty session worktrees (unrelated
  concurrent sessions) are surfaced as non-blocking warnings, never a block.
- **`ship_cleanup`** — warns when the session worktree still has uncommitted
  changes after merge.
- **Pre-tool-use guard** — warns when a git-mutating command is issued from the
  main repo root while a worktree for the current session is active.

### Protection scope covers every operation class

A "protected" or "live session" set protects the **subject**, not one verb. Once
a repo, worktree, branch, or path is in that set, it is off-limits to *every*
destructive operation class in the sweep:

| Class | Examples |
|-------|----------|
| Ref mutation | `branch -D`, `push --delete`, `checkout`, `reset --hard` |
| Worktree mutation | `worktree remove`, `worktree prune`, directory deletion |
| File mutation | writing `.gitignore`, committing, staging |
| Process mutation | killing a process whose cwd or argv points into the path |

- **Never enumerate the covered verbs.** A rule written as a list of forbidden
  commands silently permits every command absent from the list — which is how a
  guard that correctly refused to delete a branch still removed the worktree
  holding it. State the scope by subject and treat the list as examples.
- **Re-check immediately before each destructive action, not once at
  classification time.** A sweep across many repos runs for minutes; sessions
  start, stop, and switch branches inside that window, so a set built at the
  start is already stale by the time the last repo is reached.
- **Derive liveness from the running system**, not from a hand-maintained
  constant: registered worktrees (`git worktree list --porcelain`), session
  metadata, and live process cwd/argv. A hard-coded path list drifts the moment
  a session moves.
- **A partial guard is worse than none** — it reads as coverage. If a sweep
  cannot protect a subject across all four classes, it must skip that subject
  entirely and report it, not protect it in some classes only.

### Deletion candidates come from the truth source, and are audited twice

A branch may only be *offered* for deletion, and only *deleted*, when an
unambiguous source confirms it exists under exactly that name and location:

| Ort | Truth source | Never |
|-----|--------------|-------|
| lokal | `git for-each-ref refs/heads --format=%(refname)` | `git branch` output, `%(refname:short)` |
| nur-remote / remote half | `git ls-remote --heads origin` (the server's answer) | `refs/remotes/*` — it also holds `origin/HEAD` |

- **Why:** `%(refname:short)` shortens `refs/remotes/origin/HEAD` to the name
  `origin`. A sweep that listed `refs/remotes/origin` that way filtered out
  `HEAD` and put a "remote branch" called `origin` — the pointer to main — on
  a repo-health page as löschbar, pre-checked, in four repos at once
  (2026-09-17). Nothing was deleted, but only because the user read the list.
- **Hard negative list in classification AND execution:** `main`, `master`,
  `HEAD`, `origin`, the repo's default branch, and any name ending in
  `/main`, `/master` or `/HEAD` never become candidates — filtered when the
  list is built and re-checked per name right before `branch -D` /
  `push --delete`, whatever the submitted payload says.
- **Audit pass, run twice:** `scripts/repo-health-audit.js <repo> <candidates.json>`
  verifies every candidate (exists as an exact ref, Ort matches both sources,
  not protected, not a worktree branch) — once before the page renders, once
  again before each destructive batch. A finding drops the entry and is shown
  as a warning; the page header states the result ("N Refs geprüft, 0
  Befunde"). A candidate set that has not passed the audit is not rendered.
- **Same rule for every other subject class:** a worktree entry must be in
  `git worktree list --porcelain`, a "verwaister Ordner" must *not* be, and
  both must still be on disk — `/setup-cleanup` Step 10 re-reads both before
  acting, exactly like the branch audit.

### A half-done worktree removal is Claude's to finish

`git worktree remove` on a checkout with a big `node_modules/` can take many
minutes on Windows. A synchronous call with a short timeout (120 s) kills git
mid-delete. The registration is gone after the next `worktree prune`, and a
directory is left on disk with no `.git` file and tens of thousands of files
(observed 2026-09-23: three SC-Web worktrees, ~40k files each).

- **Run the removal so it can finish:** in the background or with a timeout of
  at least 15 min, never under a 120 s ceiling.
- **Finish an orphan left anyway, don't hand it to the user.** It qualifies
  when **all** of these hold:
  - not in `git worktree list --porcelain`, and has no `.git` file;
  - no process names the path in its cwd or argv;
  - every top-level entry is in `origin/<default>` (`git cat-file -e
    origin/main:<entry>`) or a gitignored build artifact (`node_modules`,
    `dist`, `graphify-out`, …).

  Then delete the directory yourself (`rm -rf`) and report it as done. The
  content is in main, and the removal was already decided; handing "delete
  manually" to the user leaves the cleanup half done. Any entry outside that
  list (an untracked file, a local note) → keep the folder and name that
  entry. Uncommitted work is never deleted.
