# Ship — Repo modes

Referenced by `/do-ship` Step 1a-ii. The mode table and the fork decision
stay in SKILL.md; this is the execution detail of the `file-only` mode.

## file-only

**`file-only` is NOT "skip the ship".** A ship is worth running in a repo-less
project for everything it does besides git: the build, the test suite, the
doc-freshness check, the quality gates, the worktree/merge sanity questions,
and the honest report at the end. Only the git actions are meaningless there.

Concretely, in `file-only`:

- **Run** Step 2 (build + tests) and Step 3 (version bump) exactly as normal —
  `ship_build` and `ship_version_bump` already handle the mode.
- **Run** the documentation and quality checks you would otherwise run; a
  repo-less project benefits from them just as much.
- **Skip** Step 1b entirely (there is nothing to rebase onto) and Step 4b (no
  merge to watch).
- **Call** `ship_release` anyway — it returns
  `{ success: true, skipped: true, reason: "file-only-mode", delivered: "none" }`
  without touching git.
- **Call** `ship_cleanup` anyway — it clears the ship sentinel and refuses every
  destructive git call.
- **Render** the `ready-files` completion card, not `ship-successful`, and pass
  `state: { mode: "file-only", filesModified: <n>, delivered: "none" }`. Never
  claim a commit, branch, PR or merge.

Report the outcome in plain terms: what was built, what the tests said, what
changed on disk — and that there is no repo, so nothing was pushed.
