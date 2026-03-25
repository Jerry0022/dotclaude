# Branching Strategy

## Branch naming convention

| Branch type | Pattern | Example |
|-------------|---------|---------|
| Feature/issue | `feat/<issue>-<short-desc>` | `feat/42-video-filters` |
| Agent sub-branch | `feat/<issue>/<role>` | `feat/42/core`, `feat/42/frontend` |
| Bugfix | `fix/<issue>-<short-desc>` | `fix/55-startup-crash` |
| Chore/refactor | `chore/<issue>-<short-desc>` | `chore/60-cleanup-imports` |

## When to use sub-branches

| Scope | Strategy |
|-------|----------|
| Simple change (1–2 roles, <5 files) | Single `feat/<issue>` branch — no sub-branches |
| Multi-role change (3+ roles) | Integration branch `feat/<issue>` + sub-branches `feat/<issue>/<role>` per agent |
| Orchestrated agents (`agents:run`) | Each agent gets its own sub-branch and worktree automatically |

## Multi-branch workflow

```
main
 └── feat/42-video-filters          ← integration branch
      ├── feat/42/core               ← agent sub-branch (worktree)
      ├── feat/42/frontend            ← agent sub-branch (worktree)
      └── feat/42/windows             ← agent sub-branch (worktree)
```

1. Create integration branch from `main`: `git checkout -b feat/42-video-filters main`
2. Each agent branches from the integration branch: `git checkout -b feat/42/core feat/42-video-filters`
3. Agents work in parallel — each in its own worktree (via `isolation: "worktree"` or manual `git worktree add`)
4. Merge sub-branches into integration branch in wave order (core → frontend → windows → ai), resolving conflicts at each step
5. Quality gates run on the integration branch
6. PR from integration branch → `main` (squash merge)
7. Cleanup: delete ALL local branches + worktrees (see §Local Cleanup)

## Branch lifecycle & intermediate states

Branches go through distinct phases. Cleanup rules depend on the phase:

| Phase | Branch state | Worktree | Cleanup rule |
|-------|-------------|----------|--------------|
| **Active work** | Has uncommitted or unpushed changes | Exists | Never touch — active session is using it |
| **Pushed (WIP)** | All changes committed + pushed to remote | May exist | Worktree may be removed (work is remote-safe). Branch stays until ship. |
| **Parked** | Committed + pushed, session ended | Should not exist | Branch stays (remote backup). Worktree should be gone. Next session recreates worktree from remote branch if needed. |
| **Consolidated** | Sub-branch merged into integration branch | Must not exist | Branch + worktree deleted immediately after merge into integration branch |
| **Shipped** | Integration branch merged to `main` via PR | Must not exist | Everything deleted — zero leftover policy (see below) |

**Key principle:** A branch's work must be **pushed to remote** before its worktree can be removed. The remote branch is the durable backup; worktrees are cheap, disposable working copies.

**Between sessions:**
- When a session ends mid-work: commit + push current state (even as WIP commit). The worktree will be cleaned up by the next session's sweep, but the branch persists on remote.
- Next session: if work needs to resume, `git worktree add` from the existing remote branch. No work is lost.

**Agent completion (before all agents are done):**
- When one agent finishes its sub-branch: commit, push, then delete the agent's worktree. The sub-branch stays until consolidation.
- Other agents continue working on their own sub-branches independently.

## Local cleanup — zero leftover policy (post-ship)

After a successful merge to remote `main`, **nothing must remain locally** except `main` itself:

- **All feature/sub-branches**: deleted with `git branch -D`
- **All worktrees**: removed with `git worktree remove --force`, then `git worktree prune`
- **Orphaned worktree directories**: `rm -rf` any leftover dirs in `.claude/worktrees/` (Windows file locking may require user intervention)
- **Stale remote refs**: `git remote prune origin`

**Traceability lives on GitHub, not locally.** The merged PR preserves the full diff, commit messages, and discussion. Local branches are ephemeral working state — never kept after merge.

## Session-start sweep (automated via hook)

The `sweep-branches.js` hook runs automatically at every session start (`SessionStart` in `settings.json`). It handles all cleanup:

**Safe to delete (garbage):**
- Worktree directories in `.claude/worktrees/` not listed in `git worktree list` **AND** containing no uncommitted changes
- Local branches whose upstream is gone (remote deleted after PR merge) **AND** not the current session's branch
- Stale remote tracking refs

**Never delete (protected):**
- **The current session's worktree and branch** — always preserved, even if the branch has no remote counterpart or was never pushed. The sweep detects the active session via `git rev-parse --show-toplevel` and `--abbrev-ref HEAD`.
- Local branches that have a remote counterpart (`origin/<branch>` exists) — parked or in-progress
- Worktrees listed in `git worktree list` with a valid branch checkout
- Orphaned worktree directories that contain uncommitted or untracked files (may be work-in-progress from a crashed session)

The hook reports what was cleaned and what was preserved. No manual action needed.
