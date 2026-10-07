# Repo-Health — Executing the Decisions (Step 10a–10c)

Read by `SKILL.md` Step 10 after the decisions are partitioned, re-checked
and validated (Step 10, items 1–4). Everything below runs only after that.

## Step 10a — Apply-Manifest + Dry-Run-Confirm

Before executing any action, generate the **Apply-Manifest**: a complete list
of everything that will happen, shown to the user for confirmation.

**Apply-Manifest format:**

```
Folgende Aktionen werden ausgeführt:

Shippen (P) — nacheinander, je ein voller /ship-Lauf:
  1. #412 fix(ship): timed-out probe …  (claude/ship-probe → main, Session „🔧 Ship probe")
  2. #409 feat(card): …                 (claude/card-cta → main, nur-remote)

Lokal löschen (N):
  - branch-a
  - branch-b

Remote löschen (M):
  - branch-a (origin)

Worktrees entfernen (K):
  - claude/old-session (/path/to/worktree)

Main synchronisieren: ja / nein
Remote prunen: ja / nein
```

Then show a **Dry-Run-Confirm** prompt before executing:

> Shippt P PRs (jeder via /do-ship: Rebase, Build, Tests, CI-Gate, Merge),
> löscht N lokal, M remote, entfernt K Worktrees.
> Merges und Löschungen sind NICHT rückgängig zu machen.
> Fortfahren?  [Ja] [Abbrechen]

Only proceed after explicit confirmation.

## Step 10b — Ship Queue (before any cleanup)

Land the selected PRs **one after another**, each through the complete
`/do-ship` pipeline — exactly what would happen if the user sat in P sessions
and typed `/do-ship` in each, minus the tab-switching. Never `gh pr merge`
directly: the guard hook blocks it and it would skip rebase, build, tests,
version bump and the CI gate.

**Order:** oldest PR first (`createdAt`), so a later PR rebases onto the
earlier one's merge instead of the other way round.

**Arm the queue marker once, before the first ship:**

```bash
node -e "require('fs').mkdirSync('.claude',{recursive:true});require('fs').writeFileSync('.claude/.ship-queue',JSON.stringify({owner:'auto-cleanup',since:new Date().toISOString()}))"
```

Project ship extensions read this marker and defer their post-ship
finalizers to the end of the queue (the dotclaude plugin-source repo's
extension would otherwise mark the MCP servers stale after PR 1 and block
every later `ship_*` call — the same trap `/do-run backlog` guards against with
its lockout owner). The marker is NOT an autonomous lockout: the user is
present, every `/do-ship` gate stays interactive.

**Per PR:**

1. **Resolve the working directory** the ship runs in:
   - `quelle: session` (clean worktree) → that worktree path. Re-check
     `git -C <path> status --porcelain` immediately before; any output → SKIP
     this PR with „Worktree hat inzwischen Änderungen".
   - `quelle: lokal` → `git worktree add .claude/worktrees/cleanup-pr-<n> <branch>`
   - `quelle: nur-remote` → `git fetch origin <branch>:<branch>` then the same
     `worktree add`.
   Record `tempWorktree: true` for the two created cases.
2. **Invoke the pipeline:** `Skill("devops:do-ship", args: "--cwd=<path> --keep --queued")`.
   `--cwd` makes every `ship_*` call and every git/gh command target that
   directory instead of this session's own worktree (see `/do-ship` → *Composed
   ships*). `--keep` because the branch/worktree teardown is this step's job,
   not the ship's — `/do-ship` must never `ExitWorktree` on a directory that is
   not its session's own. `--queued` is informational (card wording).
3. **Read the outcome** from the ship's `ship_release` result / card variant:
   - `ship-successful` → record `merged: true, mergeSha, version`.
   - `ship-blocked` → record the reason; **continue with the next PR**. One
     blocked PR never halts the queue (COMPLETED > INTERRUPTED > BLOCKED, as
     in `/do-run backlog`).
4. **Tear down** (merged PRs only):
   - `tempWorktree: true` → `git worktree remove <path>` (no `--force`), then
     `git branch -d <branch>` (lowercase `-d`: refuses if not merged — a
     second safety net), then `git push origin --delete <branch>` when
     `options.delete_remote` is set and the remote ref still exists.
   - `quelle: session` → leave the worktree in place; it now classifies as a
     clean, squash-merged Aktive Session. The owning session keeps working or
     gets removed in a later run — never yank a directory from under a session.
   - Blocked PRs keep their worktree so the user can resume there; list the
     path in the summary.
5. **Re-sync** before the next PR: `git fetch origin main` so the next ship's
   preflight sees the merge that just landed.

**After the last PR:**

1. Run the project ship-extension finalizer exactly once if ≥1 PR merged —
   read `{project}/.claude/skills/do-ship/SKILL.md` (pre-PR-2 fallback: `ship/`) for the step the extension
   deferred while `.claude/.ship-queue` existed, run it, capture its output.
2. Delete `.claude/.ship-queue`.
3. Update the concept page via browser eval: ✅ per merged PR (with merge
   SHA + version), ⏸ per blocked PR (with reason), then continue with
   Step 10c — the cleanup set was fixed at submit time and is not widened by
   the merges.

## Step 10c — Cleanup Execution

Execute in order after Dry-Run-Confirm and after the ship queue (10b):
   a. Delete selected local branches: `git branch -D <branch>`
   b. If `delete_remote` is true: `git push origin --delete <branch>` for
      each selected branch that has a remote
   c. Remove selected clean worktrees: `git worktree remove <path>` (no --force)
      - Re-check `git -C <path> status --porcelain` immediately before each removal.
        If ANY output → SKIP with warning: "Worktree hat inzwischen Aenderungen —
        Entfernung abgebrochen."
   d. If `prune_worktrees` is true: `git worktree prune`
   e. `git remote prune origin`
   f. If `sync_main` is true: `git checkout main && git pull origin main`,
      then return to original branch

Update the concept page via browser eval:
   - Mark completed deletions with a green checkmark
   - Mark skipped items with a warning icon + reason
   - Show summary: "X Branches geloescht, Y uebersprungen"

Persist results to `~/.claude/devops-concepts/{date}-repo-health-decisions.json`.

## Safety Invariants

- **Never delete a worktree-attached branch** — even if checked by the user.
  Show a warning on the page: "Branch X ist an einen aktiven Worktree gebunden.
  Entferne zuerst den Worktree."
- **Re-validate before every delete** — the state may have changed since
  the page was generated.
- **Never push --delete a remote branch** that is attached to a local worktree.
- **Log every action** with branch name and result (deleted / skipped / error).
- **Delete by full refname only** — `git branch -D <name>` with a name taken
  from `refs/heads/`, `git push origin --delete refs/heads/<name>` with a name
  confirmed by `ls-remote`. Never a name derived from `%(refname:short)`.

## Worktree Removal Safety

Worktree removal (action `remove: true` in the decisions JSON) is only allowed
for Aktive Sessions classified as `clean` in Step 2. Enforce these rules:

1. **Re-check before removal:** Run `git -C <worktree_path> status --porcelain`
   again immediately before acting. If ANY output → SKIP with warning:
   "Worktree hat inzwischen Aenderungen — Entfernung abgebrochen."
2. **Never force-remove:** Use `git worktree remove <path>` (without `--force`).
   If it fails, report the error — do NOT retry with `--force`. Run it in the
   background (a big `node_modules` outlasts a 120 s call), and finish a
   half-removed orphan yourself: `{PLUGIN_ROOT}/deep-knowledge/git-hygiene.md` § *A
   half-done worktree removal is Claude's to finish*.
3. **Never discard changes:** If a worktree (Aktive Session) has `status: has-changes`,
   the UI must NOT render any DESTRUCTIVE action controls — no delete checkbox,
   no "discard", no "reset", no implicit-cleanup option. The ONLY allowed
   interactive element is the read-only „?" inline detail toggle (no destructive
   action can be triggered from it). Even when the inline detail recommends
   `discard`, the action stays advisory: the user must commit or checkout
   manually. This is enforced in the HTML generation, not just in execution.
4. **Branch cleanup after removal:** After successfully removing a clean
   worktree, the associated branch is NOT automatically deleted. The branch
   can be scheduled for deletion via the normal Löschbar flow, but it must
   be checked independently (check that it is not the current branch in the
   main repo first).
