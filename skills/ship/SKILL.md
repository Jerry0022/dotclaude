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

This skill implements the 10-step Completion Flow defined in `~/.claude/CLAUDE.md §Completion Flow — Ship & Verify`. It is the **canonical implementation** — project-level `/ship` skills extend this with project-specific details.

**Goal:** After shipping, only two artifacts remain: (1) the merged PR on GitHub (traceability), and (2) local `main` branch up to date. Everything else is deleted.

---

## Step 1: Consolidate Sub-Branches (if multi-branch workflow)

Check for sub-branches of the current integration branch. If they exist, merge each into the integration branch in wave order (per the project's agent team definition). Resolve conflicts at each merge — do not defer.

After merging each sub-branch:
- Delete the local sub-branch: `git branch -D <sub-branch>`
- Delete the remote sub-branch: `git push origin --delete <sub-branch>`
- Remove any associated worktree: `git worktree remove <path> --force`

Skip this step if no sub-branches exist (single-branch workflow).

---

## Step 2: Sync Main

```bash
git fetch origin main
git checkout main
git pull origin main
git checkout <integration-branch>
```

---

## Step 3: Rebase Integration Branch onto Main

```bash
git rebase main
```

Resolve any conflicts inline. Do not leave them for the user.

---

## Step 4: Quality Gates

Run the project's lint, contract checks, and tests. If anything fails, fix and re-run.

**Default commands** (override in project-level skill if different):
- `npm run lint` (or project-specific lint commands)
- `npm run test:unit`
- `git status` — ensure no untracked files in ambiguous state

---

## Step 5: Version Bump

**This step is mandatory for every ship.** It implements `~/.claude/CLAUDE.md §Versioning → When to bump`.

### 5a. Evaluate changes

Review all changes being shipped (diff from main). Classify using the global bump table:

| Change type | Bump | Confirmation? |
|-------------|------|---------------|
| Bug fix visible to users | **patch** | No |
| Internal-only fix (refactor, tests, dev deps) | **none** | No — skip to Step 6 |
| New UI feature or visible functionality | **minor** | No |
| Complete redesign, new major feature area | **major** | **Always ask** (AskUserQuestion) |

Multiple changes in one ship → use the highest applicable bump.

### 5b. Update version references

If a bump is needed:
1. Read current version from `package.json`
2. Calculate new version
3. **Grep the entire repo** for the old version string to find all files that reference it
4. Update all references in a **single commit**:
   - `package.json` — version field
   - `README.md` — version badge/line (if present)
   - `CHANGELOG.md` — new section with date and changes (if the project maintains one)
   - Any other files found by the grep
5. Commit: `chore: bump version to X.Y.Z`

If no bump is needed (internal-only changes), skip this step entirely.

---

## Step 6: Commit & Push

If there are uncommitted changes (beyond the version bump commit):
1. Stage relevant files (`git add <specific files>` — never `git add -A`)
2. Write conventional commit message with `Co-Authored-By` footer
3. Commit
4. Push with `-u`: `git push -u origin <branch>`

If all changes are already committed (e.g., only the version bump commit was added), just push.

---

## Step 7: Create PR

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

---

## Step 8: Merge PR

```bash
gh pr merge --squash --delete-branch
```

- `--delete-branch` deletes the remote integration branch after merge
- If merge checks fail, diagnose and fix before retrying
- Verify remote branch is gone: `git ls-remote --heads origin <branch>` — delete explicitly if still present

---

## Step 9: Update Local Main

```bash
git checkout main
git pull origin main
```

Confirm the merge landed. If running in a worktree, also update the main repo's main branch.

---

## Step 10: Aggressive Local Cleanup

Delete ALL local branches related to the shipped feature:
```bash
git branch -D <shipped-branch>
# Delete any remaining sub-branches
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
- Report any surviving non-main branches (other in-progress work)

---

## Step 11: Verify Changes Are Live

Start/restart the app or dev server so the user can see and test the changes immediately.

Report checklist:
- [ ] PR merged (link)
- [ ] Version bumped (old → new, or: no bump — reason)
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
