---
name: ship
description: >-
  Full end-to-end shipping pipeline: consolidate branches, rebase, quality gates,
  version bump, commit, push, create PR, merge, sync main, cleanup, and verify.
  Use when the user's work is complete and ready to land on main. Triggers on:
  "ship it", "fertig", "merge it", "ab damit", "let's finalize", "mach nen PR",
  "push and merge", "das kann rein", or any variation indicating the current
  task/feature/fix is done and should go to main. Also triggers when you've
  finished implementing a feature or fix and the logical next step is to ship,
  even if the user hasn't explicitly asked — the global Completion Flow requires
  it. Do NOT trigger when: user is still coding/debugging, mid-sprint with
  unfinished issues, user asks for PR-only without merge, or just committing
  without shipping.
allowed-tools: Bash(git *), Bash(gh *), Bash(npm run *), Bash(node *), Bash(grep *), Read, Glob, Grep, AskUserQuestion
---

# Ship — Global Completion Flow

**Extends `/ship-dotclaude`** — this skill inherits the base shipping logic (version bump, changelog, commit, push, build log, verify) from `/ship-dotclaude` and adds PR-based workflow, branch consolidation, quality gates, and aggressive cleanup for project repositories.

**Goal:** After shipping, only two artifacts remain: (1) the merged PR on GitHub (traceability), and (2) local `main` branch up to date. Everything else is deleted.

---

## Differences from `/ship-dotclaude`

| Aspect | `/ship-dotclaude` (base) | This skill (project override) |
|--------|--------------------------|-------------------------------|
| **Branching** | Direct push on main | Sub-branch consolidation → PR → squash merge |
| **File sync** | Diff `~/.claude/` → repo | Not needed — changes are already in the repo |
| **Quality gates** | None (config repo) | Run project lint + tests before shipping |
| **PR workflow** | No PR — direct push + tag | Always create PR, merge via `gh pr merge --squash` |
| **Git tags / Release** | Tag + push triggers release pipeline | Tag `vX.Y.Z` on squash-merge commit → triggers release pipeline (Step 8.5) |
| **Cleanup** | Minimal (single branch) | Aggressive — delete all feature branches, worktrees, prune refs |

---

## Additional steps before base flow

### Step 1: Consolidate Sub-Branches (if multi-branch workflow)

Check for sub-branches of the current integration branch. If they exist, merge each into the integration branch in wave order (per the project's agent team definition). Resolve conflicts at each merge — do not defer.

After merging each sub-branch:
- Delete the local sub-branch: `git branch -D <sub-branch>`
- Delete the remote sub-branch: `git push origin --delete <sub-branch>`
- Remove any associated worktree: `git worktree remove <path> --force`

Skip if no sub-branches exist (single-branch workflow).

### Step 2: Sync Main

```bash
git fetch origin main
git checkout main
git pull origin main
git checkout <integration-branch>
```

### Step 3: Rebase Integration Branch onto Main

```bash
git rebase main
```

Resolve any conflicts inline. Do not leave them for the user.

### Step 4: Quality Gates

Run the project's lint, contract checks, and tests. If anything fails, fix and re-run.

**Test deduplication:** If tests were already run on the **same code state** earlier in this session (same `git write-tree` hash — no code changes since the last successful test run), skip the test commands and log: `Tests skipped — already passed on tree <hash>`. This avoids redundant runs when shipping immediately after a test pass. The rebase in Step 3 changes the tree hash only if main had new commits that alter the merge result — in that case, tests must re-run.

**Default commands** (override in project-level skill if different):
- `npm run lint` (or project-specific lint commands)
- `npm run test:unit` (skip if deduplicated — see above)
- `git status` — ensure no untracked files in ambiguous state

---

## Base flow steps (inherited from `/ship-dotclaude`)

### Step 5: Version Bump

Same as `/ship-dotclaude` steps 9–10. Evaluate changes, determine bump type (patch/minor/major/none), update `package.json`, `README.md`, `CHANGELOG.md`, and any other files referencing the old version.

### Step 6: Commit & Push

Same as `/ship-dotclaude` steps 8–12, except push to the **feature branch** (not main):
```bash
git push -u origin <branch>
```

---

## Overridden steps (replace base flow)

### Step 7: Create PR

**Replaces** `/ship-dotclaude` direct push — projects always go through PRs.

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
Closes #NNN

## Summary
- ...

## Test plan
- [ ] ...
EOF
)"
```

- Title: under 70 chars
- Body MUST start with `Closes #NNN` / `Fixes #NNN` for every resolved issue
- Base branch: `main`

### Step 8: Merge PR

**Replaces** `/ship-dotclaude` tag + release pipeline.

```bash
gh pr merge --squash --delete-branch
```

- `--delete-branch` deletes the remote integration branch after merge
- If merge checks fail, diagnose and fix before retrying
- Verify remote branch is gone: `git ls-remote --heads origin <branch>`

### Step 8.5: Git Tag & Release Pipeline

After the PR is merged, create a version tag on `main` and push it. This triggers the GitHub Actions release pipeline (per global §Release Flow).

```bash
git checkout main
git pull origin main
git tag v<X.Y.Z>
git push origin v<X.Y.Z>
```

- The tag is created on the **squash-merge commit on main** — not on the feature branch.
- Tag format: `vX.Y.Z` (matches the version bumped in Step 5).
- If the version bump in Step 5 was "none" (internal-only change), **skip this step** — no tag, no release.
- After pushing the tag, verify the GitHub Actions release workflow was triggered: `gh run list --workflow=release --limit 1`.
- Do NOT wait for the workflow to complete — it runs asynchronously. Proceed to Step 9.

### Step 9: Update Local Main

```bash
git checkout main
git pull origin main
```

If running in a worktree, also update the main repo's main branch.

### Step 10: Build Log Entry

Write a new entry to `BUILDLOG.md` (see `~/.claude/CLAUDE.md §Build Log`). Generate the build hash via `git write-tree | cut -c1-7`.

### Step 11: Aggressive Local Cleanup

Delete ALL local branches related to the shipped feature:
```bash
git branch -D <shipped-branch>
git branch --list "<prefix>/*" | xargs -r git branch -D
```

If running in a worktree:
1. Detach HEAD: `git checkout --detach`
2. Remove worktree: `git worktree remove <path> --force`
3. Fallback if file-locked: `git worktree prune && rm -rf <path>`

Full sweep (always):
- Delete stale worktree directories not in `git worktree list`
- `git worktree prune`
- `git remote prune origin`
- Delete gone branches: `git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -D`

### Step 12: Verify Changes Are Live

Start/restart the app or dev server so the user can see and test the changes immediately.

Report checklist:
- [ ] PR merged (link)
- [ ] Version bumped (old → new, or: no bump — reason)
- [ ] Build log entry written
- [ ] Remote branches deleted
- [ ] Local branches deleted
- [ ] Worktrees removed
- [ ] Local main up to date (commit SHA)
- [ ] App running

---

## Intermediate States

This `/ship` skill is for **final delivery** of completed work. For intermediate scenarios:
- **Agent finished but others still working**: commit + push sub-branch, remove worktree. Sub-branch stays on remote until consolidation.
- **Session ending before ship**: commit + push all current state (even WIP). Branch persists on remote.
- **Resuming parked work**: `git worktree add .claude/worktrees/<name> <remote-branch>`
