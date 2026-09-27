# Post-Ship Cleanup

Runs ONLY after confirmed PR merge. If any prior step failed → skip entirely.

## Guard

Before cleanup, verify merge succeeded:

```bash
git log main --oneline -1
```

The squash-merge commit must be visible. If not → preserve everything.

## Steps

### 1. Exit worktree (if session is inside one)

**MUST happen before any git cleanup.** On Windows, the session holds a CWD lock
on the worktree directory — `git worktree remove` will fail if the CWD is still inside it.

Call `ExitWorktree` with `action: "remove"` to:
- Release the CWD lock
- Return the session to the main repo directory
- Clean up the worktree directory and branch

If `ExitWorktree` reports uncommitted changes and refuses to remove, use
`discard_changes: true` — the work is already merged at this point.

If `ExitWorktree` is not applicable (no worktree session active), skip to step 2.

### 2. Sync local main — hard invariant

**A ship to `main` is not complete until local `main` == `origin/main` == the
shipped commits.** Side branches and worktrees are working vehicles — the
*terminal* state of every ship to `main` is `main` updated **both remote and
local**. The PR merge runs remote-side, so `origin/main` advances on its own;
**the local `main` ref does not move.** A ship that leaves local `main` behind
has NOT finished, even though the GitHub merge succeeded.

Do **not** rely on a bare `git checkout main && git pull`. It fails outright
when `main` is already checked out in another worktree (the normal case during
a worktree ship — Git forbids a second checkout), and it does nothing for the
main repo when that repo sits on an unrelated branch. In both cases the merge
reports success while local `main` silently stays stale.

Robust sequence (works regardless of worktree layout):

```bash
git fetch origin main                  # advance the remote-tracking ref
git worktree list --porcelain          # find any tree with "branch refs/heads/main"
```

- **No working tree holds `main`** → move the ref directly, no checkout needed.
  Use a fetch refspec (fast-forward-only — it refuses a non-ff update rather
  than force-moving the ref, unlike `git update-ref`, so a diverged local `main`
  is never silently rewound):
  ```bash
  git fetch origin main:main
  ```
- **A working tree holds `main`** → fast-forward that one in place:
  ```bash
  git -C <that-worktree> merge --ff-only origin/main
  ```

Then assert the post-condition (not optional):

```bash
[ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] || echo "✗ local main stale — ship NOT done"
```

If the refs differ, resolve before reporting success. See
[git-hygiene.md § Session-worktree hygiene](../../../deep-knowledge/git-hygiene.md#session-worktree-hygiene).

### 3. Verify remote branch is gone

Outside a worktree the merge step uses `--delete-branch`; inside one `ship_release`
deletes the remote head itself right after the merge (`remoteBranchDeleted`, #442) —
consumer repos generally do NOT have `delete_branch_on_merge` enabled (34 stale
`claude/*` heads accumulated on one before #442), so nothing else deletes it. Neither
path is guaranteed (API hiccups, manual merges). Always verify:

```bash
git ls-remote --heads origin <shipped-branch>
```

If the branch still exists on the remote, delete it explicitly:

```bash
git push origin --delete <shipped-branch>
```

Re-verify after deletion — an empty result confirms success.

### 4. Delete shipped branch (local)

```bash
git branch -D <shipped-branch>
```

### 5. Prune

```bash
git worktree prune
git remote prune origin
```

## Scope

- **Only own branch/worktree.** Never delete other branches or worktrees.
- **Only after confirmed merge.** No cleanup if ship failed at any step.
- **Traceability lives on GitHub.** The merged PR preserves the full diff and discussion. Local branches are ephemeral.

## Re-open session-opened files (Step 5b Substep 3)

After `ship_cleanup` completes, every file:// URL the session opened from
inside `$WORKTREE_PATH` is now dead (the worktree directory has been
pruned). The merged HTML still lives at the equivalent path inside the
main repo, so re-open every tracked file from there so the user's browser
tab silently picks up the live version.

Skip this step entirely when `$WORKTREE_PATH` was empty in Substep 1 (the ship
ran directly from the main checkout, no path rewrite needed).

```bash
node "{PLUGIN_ROOT}/scripts/session-open-tracker.js" reopen-main \
  --worktree="$WORKTREE_PATH"
```

The script:
- Reads `<main-repo>/.claude/session-opened-files.json` (the tracking
  file is anchored at the main repo root so it survives worktree
  cleanup — see `scripts/session-open-tracker.js` for the storage
  contract).
- Filters tracked entries to those that were under `$WORKTREE_PATH`.
- Maps each filtered entry to the main-repo equivalent (`relative
  path within worktree` → `<main-repo>/<relative>`).
- Opens every still-existing file in Edge via the standard
  `start "" msedge "file:///…"` pattern.
- Prints a JSON summary `{ reopened: [...], missing: [...], consumed }`.

Treat the summary as informational. Any entries listed under `missing`
mean the file did not survive the merge (likely deleted during the
session) — that is expected and not a ship failure.

**Background — issue #160.** Without this step, `/do-ship` silently
invalidates every browser tab that was pointing into the worktree. The
user sees a 404 / blank tab and reasonably concludes the concept page
itself is broken, when in reality the content is fine at the main path.

## Keep-mode: the remote branch (Step 5c)

The remote branch is gone either way — deleted by the GitHub merge (`--delete-branch`)
outside a worktree, by `ship_release` itself inside one (`remoteBranchDeleted: true`; it
also drops the stale remote-tracking ref so the next lease-pinned push is not rejected).
The next commit + push in this worktree re-creates it via
`git push --set-upstream origin <branch>` automatically. A `remoteBranchWarning` in the
release result means the delete failed: surface it as one `open` item on the card
("Remote-Branch `<branch>` konnte nicht gelöscht werden — »branches aufräumen« öffnet die Aufräum-Seite"), nothing else.
