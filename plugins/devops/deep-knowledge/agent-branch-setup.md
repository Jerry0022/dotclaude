# Agent Branch Setup

The first step of every implementing agent (`core`, `frontend`, `ai`,
`designer`, `feature`). One procedure, referenced from each agent file, so the
copies cannot drift apart. The orchestrator side (push or name the
integration branch, pass `Parent branch:` and the exact sub-branch name,
merge back in wave order) is in
[agent-collaboration.md](agent-collaboration.md) § Branch Inheritance Protocol.

## The one question first: am I isolated?

An isolated agent runs in a worktree of its own. A non-isolated agent runs in
the **session's own checkout** — its branch, its uncommitted work. Any branch
switch there moves the user's work out from under them. Isolation is
**proven, never inferred**:

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || echo "no repo"
git rev-parse --show-toplevel                      # where am I?
git branch --show-current                          # on which branch?
git status --porcelain --untracked-files=no        # tracked changes?
```

Isolated means one of:
- the toplevel lies under `.claude/worktrees/agent-` or the branch starts with
  `worktree-agent-` (Claude Code's `isolation: "worktree"`), or
- the prompt names `Worktree: <path>` and that path is the toplevel (a
  worktree the orchestrator created for you).

| Finding | Do |
|---|---|
| No repo | File-only project. Skip all git steps, edit files directly, report `branch: none (file-only)`. |
| Not proven isolated | **Work in place.** No branch switch, no reset. You are on the session's branch: checkpoint commits are allowed there unless it is `main`, `master` or the default branch while the session works on a feature branch — stage your files by name, never `git add -A`. Report `branch: <current> (in-place)`. |
| Isolated, tracked changes present | **Stop.** Someone's work lives here: report `Blocked by: uncommitted tracked changes at <path>`. Untracked files alone (e.g. a seeded `.claude/`) are no reason to stop — mention them. |
| Isolated, clean | Run the sync below. |

## Sync (isolated, clean tracked tree only)

1. **Your branch name** — the one the prompt names (`Your branch: …`). Only
   when it names none: `<parent_branch>-<role>`, **dash-joined** (git cannot
   create `<parent_branch>/<role>` while `<parent_branch>` exists). Two
   agents of the same role in one wave each get their own name from the
   orchestrator — never pick a name another agent may pick too.
2. **Continuing an existing branch** (a resumed or cut-off task names it):
   `git checkout <your-branch>` — never `-B`, which would reset it and leave
   the earlier checkpoints only in the reflog.
3. **Starting a new branch** from the parent tip. The local parent ref is
   current in a worktree (worktrees share refs) — prefer it:
   - `git rev-parse --verify <parent_branch>` succeeds →
     `git checkout -b <your-branch> <parent_branch>`
   - only the remote has it → `git fetch origin && git checkout -b <your-branch> origin/<parent_branch>`
   - the branch already exists although you were told to start fresh → stop
     and report it; never overwrite it.
4. Never `git reset --hard`. The checks above are what make the switch safe.
5. Checkpoint commits on your branch as the agent file says
   (`commit-conventions.md` § Checkpoint commits). Finish with a conventional
   commit; push your branch when an origin exists.
6. Report the branch name in your handoff. The orchestrator merges it back and
   ships the integration branch once via `/do-ship` — never `gh pr create`,
   never ship a sub-branch yourself.
