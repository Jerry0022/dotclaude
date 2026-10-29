# Git Hygiene

Cross-cutting git rules referenced by `/do-ship`, the role agents, and hooks.
Commit message format and granularity: [commit-conventions.md](commit-conventions.md).

## Main-branch protection (hard rule)

- **HEAD must never be `main`/`master` while editing or committing.** New work always
  starts from a branch derived from `origin/main` — how depends on the checkout:
  - **Main checkout** (the repo root, not a linked worktree): several sessions —
    Desktop local and cloud, scheduled tasks, a terminal — may share it, and
    switching its branch moves all of them. The session moves into its own
    worktree instead: `EnterWorktree {"name":"<topic>-<suffix>"}` (branch from
    `origin/<default>`), then works with paths inside it. The shared checkout stays
    on `main`. Changes found there are never moved, stashed or restored on
    Claude's own — they may be another session's; the user decides. A subagent
    blocked on main reports to its parent instead of creating a worktree.
  - **Linked worktree** (the session's own): `git fetch origin && git switch -c <feat/topic> origin/main`.
  - `pre.edit.branch` checks the branch of the work tree the edited file lives in,
    so a moved session that still holds a main-checkout path is blocked too.
  - The do-run contract follows the move (`post.worktree.enter`), and
    `ship_hygiene` keeps a worktree whose session started in the main checkout
    alive while that session's transcript names it.
- **Never commit, merge, push, rebase, cherry-pick, reset --hard, revert, apply or
  am on main/master directly.** The only path back to `main` is `/do-ship`.
- **Never create PRs manually** (`gh pr create` / `gh pr merge`). Always via
  `/do-ship` so build-ID, version bump, tag and completion card stay consistent.
- Enforcement: `pre.main.guard` (Bash) and `pre.edit.branch` (Edit/Write/NotebookEdit)
  block these actions unless a sentinel file `.claude/.ship-in-progress` is present
  (written by `ship_preflight`, cleared by `ship_cleanup`) or `DEVOPS_ALLOW_MAIN=1`
  is set for an explicit one-shot bypass.
- Exception: on main, a Bash command whose only write is a pure remote branch
  delete (`git push <remote> --delete <branch>` or `:<branch>`) passes, unless a
  deleted ref is `main`, `master` or the remote's default branch
  (`refs/remotes/<remote>/HEAD`; unknown → blocked). PowerShell keeps the plain block.
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
  unit of work must start with a fresh branch — in the main checkout via
  `EnterWorktree`, in a linked worktree via `git switch -c ... origin/main` —
  before any edits; see "Main-branch protection" above.

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

- **Why:** `%(refname:short)` shortens `refs/remotes/origin/HEAD` to `origin`,
  which once showed the pointer to main as a pre-checked, deletable "remote branch".
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
  both must still be on disk — auto-cleanup Step 10 re-reads both before
  acting, exactly like the branch audit.

### A half-done worktree removal is Claude's to finish

`git worktree remove` on a checkout with a big `node_modules/` can take many
minutes on Windows. A synchronous call with a short timeout (120 s) kills git
mid-delete. The registration is gone after the next `worktree prune`, and a
directory is left on disk with no `.git` file and tens of thousands of files.

- **Run the removal so it can finish:** in the background or with a timeout of
  at least 15 min, never under a 120 s ceiling.
- **Fast path for many worktrees (#829):** re-check the protected set and
  `git -C <path> status --porcelain` (must be empty), delete the folder
  natively (`cmd /c rmdir /s /q "<path>"` on Windows, `rm -rf "<path>"`
  elsewhere), one worktree per command with a progress line, then ONE
  `git worktree prune` at the end (`git worktree remove` takes ~40 s per
  worktree with `node_modules`). During `/auto-cleanup` the `pre.cleanup.gate` hook
  allows the native delete only for paths the confirmed Dry-Run names.
- **Finish an orphan left anyway, don't hand it to the user.** It qualifies
  when **all** of these hold:
  - not in `git worktree list --porcelain`, and has no `.git` file;
  - no process names the path in its cwd or argv;
  - every top-level entry is in `origin/<default>` (`git cat-file -e
    origin/main:<entry>`) or a gitignored build artifact (`node_modules`,
    `dist`, …).

  Then delete the directory yourself (`rm -rf`) and report it as done. The
  content is in main and the removal was already decided. Any entry outside that
  list (an untracked file, a local note) → keep the folder and name that
  entry. Uncommitted work is never deleted.

## At-risk work and the park register

Post-ship hygiene removes only what is provably landed. Everything else is
kept — and, since the at-risk definition was widened, reported.

**Landing state** (`landingState` in `mcp-server/ship/lib/hygiene.js`):
`landed` (ancestor of the default branch, head of a merged PR, a trial
`merge-tree` that changes nothing, or every touched file's patch reverse-applies
to the base), `partial` (some files' changes are in the base, others are not —
a squash merge plus later edits) or `unlanded`.

**Partial branches by content (#953).** A `partial` branch is removable when at
least 95 % of the lines it added (blank lines ignored) are present in the base's
versions of those files (`residualOf`) — no open PR, no live session, a clean
worktree. Its tip is first tagged `archive/<YYYY-MM-DD>/<branch>` (pushed when
the branch was pushed; a failed tag or tag push keeps the branch), then the
branch goes. Below 95 % it is NEVER deleted automatically: the residual is
classified by content — `outdated` (the base changed or dropped the file since
the fork point) or `new` (unique work the base never touched) — and the card
lists it as a decision item: merge, re-implement, or delete after confirmation.
Age alone never decides.

**At risk** = not landed (`unlanded` or `partial`) AND no open PR AND no live
session AND not parked; plus any worktree (session or agent) with real
uncommitted changes (regenerable output, tooling bookkeeping and `.claude/`
runtime state do not count). The card line carries commits, `n/m files landed`
for partial, `unpushed` and `uncommitted`. Offline (no merged-PR list) the
unlanded half stays silent — a squash-merged branch looks the same.

**Parked** = deliberately set-aside, unlanded work someone wants to keep. One
prefix: `parked/<topic>`. Read-only legacy aliases, still recognized and never
created again: `wip/`, `backup/`, `salvage/`, and any branch whose tip subject
contains `ARCHIVED`. The register is derived from refs
(`hooks/lib/park-register.js`) — no state file; reason and date are the tip
commit's subject and date. A parked entry older than 30 days gets the nudge
"behalten, integrieren oder verwerfen" in the orphan report. Stashes are
listed per repo in the same report.

**Landed proof by PR chain, expiry, temp worktrees.** A branch whose tip is an
ancestor of a merged PR's head counts as landed when that head still holds all
its changes (an integration branch collecting sub-agent branches); commits on
the integration branch after its PR merged keep it unlanded. Origin safety copies
(`backup/*`, `rescue/*`, `salvage/*`, `salvage-land/*`, `parked/*`, `wip/*`)
expire 14 days after their content landed (the auto-clean deletes them, log
trigger `backup-expiry`). Stale ref lock files older than 1 h and a
`maintenance.lock` older than 24 h (a crashed git) are removed before any removal or prune — one leftover
`refs/**.lock` otherwise fails every `fetch --prune` without a word. A registered worktree
under the OS temp dir, idle over 1 h and not locked by a live pid (a dead pid
or a stale "initializing" lock counts as dead), is pruned once clean. Desktop
session archive state is not readable from the CLI: live-session detection
stays transcript based. Own open PRs superseded by main, or older than 5 days
with no worktree on their head, are listed as open items on the ship card —
never closed automatically. After each ship `scripts/orphan-scan.js` refreshes
the orphan report in a detached, low-priority process.

**Shipped or landed branches are never parked.** They are landed leftovers;
hygiene removes them automatically (and `orphan-scan --clean-landed` does it
on demand). The orphan report drops a landed branch from `parked` even when it
carries a `parked/` name.

**Machine-wide view:** `scripts/orphan-scan.js` (daily; refreshed by the
`ss.orphan.nudge` SessionStart hook) scans every repo under the parent folder
of the main checkout and writes `~/.claude/orphan-report.json`; the hook then
shows `⚠ N ungelandete Branches / M Worktrees mit uncommitteter Arbeit / K
Sicherungskopien ohne Entscheidung → /auto-cleanup · Rechner gesamt: X in Y
Repos` for the current repo. A clean repo (or one the scan does not know)
still gets `ℹ Rechner gesamt: X offen in Y Repos → /auto-cleanup` while any
repo on the machine has such work; only a clean machine stays silent. A
branch whose tip subject says `ARCHIVED` counts as decided. A safety copy (autosave snapshot, legacy
`wip/`/`backup/`/`salvage/`/`salvage-land/`/`rescue/` ref) is a crash net,
never a decision: after 3 days it counts until someone ships, parks it with a
reason (`parked/<topic>`) or discards it. The autosave Stop line asks for that
decision on the turn it saves (unless the turn shipped). Dirty files that only
restore an older base state (a stale checkout) are never parked — not by the
autosave, not by a cleanup commit (`hooks/lib/stale-revert.js`,
`scripts/park-check.js`, #877). See
`scheduled-tasks/orphan-scan/SKILL.md`.
