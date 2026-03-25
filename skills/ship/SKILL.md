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
allowed-tools: Bash(git *), Bash(gh *), Bash(npm run *), Bash(node *), Bash(grep *), Read, Glob, Grep, Agent, AskUserQuestion
---

# Ship — Global Completion Flow (Agent-Delegated)

**Architecture:** This skill delegates the entire ship flow to a **subagent** to avoid consuming main-context tokens. The main context only collects metadata and spawns the agent — the agent executes all 12 steps independently.

**Why:** The ship flow runs at the end of a task when the context window is fullest. Running it inline risks mid-flow context compression (which triggers SessionStart hooks and can confuse the user). Delegating to an agent isolates the ship flow in its own context.

**Goal:** After shipping, only two artifacts remain: (1) the merged PR on GitHub (traceability), and (2) local `main` branch up to date. Everything else is deleted.

---

## Orchestration (runs in main context)

### Phase 1: Collect metadata

Before spawning the agent, gather:

1. **Current branch**: `git branch --show-current`
2. **Changed files summary**: `git diff main --stat` (just the stat, not full diff)
3. **Issue numbers**: Extract from branch name (e.g., `feat/42-*` → `#42`) or from recent commits
4. **Sub-branches**: `git branch --list "<current-branch>/*"` — check if multi-branch workflow
5. **Working directory**: `pwd` (the agent needs the exact path)
6. **Is worktree?**: Check if running in a worktree (`git rev-parse --show-toplevel`)
7. **Project-level ship overrides**: Check if a project-level `/ship` skill exists with custom commands

### Phase 2: Version bump decision (if major)

If the changes clearly warrant a **major** version bump (new feature area, breaking changes), ask the user via `AskUserQuestion` **before** spawning the agent. Pass the decision to the agent. For patch/minor bumps, the agent decides autonomously.

### Phase 3: Spawn ship agent

Launch a **single Agent** with `subagent_type: "general-purpose"`. Pass ALL collected metadata and the full step-by-step instructions in the prompt. The agent must return a structured result.

**Agent description format:** `[Agent] Ship flow — <branch>`

**Agent prompt must include:**
- The working directory path
- The branch name and issue numbers
- Whether it's a worktree session
- Sub-branch list (if any)
- Version bump decision (if pre-decided)
- The complete 12-step flow (see below)
- Instructions to return a structured result

### Phase 4: Process agent result (MANDATORY — never skip)

The agent returns a `SHIP_RESULT:` block. This is NOT the final output — it is raw data. You MUST now:

1. Run `/refresh-usage` to get live usage data
2. Map the `SHIP_RESULT:` fields to the completion card format from deep-knowledge `completion-card.md`
3. Render the **full completion card** as the last thing in the response

**Never** substitute an ad-hoc summary, table, or bullet list for the completion card. The completion card is the only acceptable final output after a ship.

---

## Ship Flow Steps (executed by the agent)

The agent executes these steps sequentially. All steps run in the working directory passed via the prompt.

### Step 0: Pre-Flight Safety Gate (MANDATORY — never skip)

Before ANY other step, run these checks. If any check fails, **STOP and report** — do not proceed to Step 1.

```bash
# 0a. Untracked files — nothing may be left uncommitted
git status --porcelain
```
If output is non-empty: **ABORT.** List the untracked/modified files and ask the user whether to stage+commit them or discard. Never proceed with uncommitted work.

```bash
# 0b. Stale worktree branches — check for OTHER worktrees with uncommitted changes
git worktree list --porcelain
```
For each worktree (other than the current one), run `git -C <path> status --porcelain`. If any has uncommitted changes, **WARN** the user: "Worktree `<name>` has uncommitted changes that will NOT be included in this ship."

```bash
# 0c. Verify current branch has commits ahead of main
git rev-list --count main..HEAD
```
If count is 0: **ABORT.** Nothing to ship.

```bash
# 0d. Verify all commits are pushed to remote
git rev-list --count @{upstream}..HEAD 2>/dev/null
```
If count > 0: commits exist locally that aren't pushed. Push them before proceeding.

```bash
# 0e. Verify .gitignore covers build artifacts
git ls-files --others --exclude-standard --directory | grep -E '(dist/|\.angular/|\.scc-build-hash|\.tmp/)' | head -5
```
If any build artifacts are untracked and not gitignored, fix `.gitignore` first.

**Rule:** Step 11 (cleanup) MUST NOT execute unless Step 8 (PR merge) completed successfully. If the ship flow fails at any step, no cleanup occurs — branches, worktrees, and local state are preserved intact.

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

**Test deduplication:** If the prompt includes a tree hash from a previous successful test run, compare with `git write-tree`. If identical, skip tests and log: `Tests skipped — already passed on tree <hash>`.

**Default commands** (override in project-level skill if different):
- `npm run lint` (or project-specific lint commands)
- `npm run test:unit` (skip if deduplicated — see above)
- `git status` — ensure no untracked files in ambiguous state

### Step 5: Version Bump

Evaluate changes, determine bump type (patch/minor/major/none), update `package.json`, `README.md`, `CHANGELOG.md`, and any other files referencing the old version. If the main context pre-decided a major bump, use that decision.

### Step 6: Commit & Push

Stage version-bumped files and any remaining changes. Commit with conventional commit format. Push to the feature branch:
```bash
git push -u origin <branch>
```

Commit style: `type(scope): subject` with `Co-Authored-By:` trailer.

### Step 7: Create PR

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

```bash
gh pr merge --squash --delete-branch
```

- `--delete-branch` deletes the remote integration branch after merge
- If merge checks fail, diagnose and fix before retrying
- Verify remote branch is gone: `git ls-remote --heads origin <branch>`

### Step 8.5: Git Tag & Release Pipeline

After the PR is merged, create a version tag on `main` and push it. This triggers the GitHub Actions release pipeline.

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
- Do NOT wait for the workflow to complete — it runs asynchronously.

### Step 9: Update Local Main

```bash
git checkout main
git pull origin main
```

If running in a worktree, also update the main repo's main branch:
```bash
git -C <main-repo-path> checkout main
git -C <main-repo-path> pull origin main
```

### Step 10: Build Log Entry

Write a new entry to `BUILDLOG.md`. Generate the build hash via `git write-tree | cut -c1-7`. Format per §Build Log in CLAUDE.md.

### Step 11: Aggressive Local Cleanup (ONLY after successful merge)

**Guard:** This step MUST NOT run unless Step 8 (PR merge) returned success AND `git log main --oneline -1` shows the squash-merge commit. If any prior step failed, SKIP this entire step and preserve all branches/worktrees.

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

### Step 12: Return Structured Result

Do NOT render a completion card. Instead, return a structured text block:

```
SHIP_RESULT:
  status: success|failed
  pr_url: <url>
  pr_number: <number>
  version_old: <x.y.z>
  version_new: <x.y.z>
  version_bump: patch|minor|major|none
  build_hash: <7-char hash>
  tag: v<x.y.z> | none
  main_sha: <short sha>
  branch_deleted: <branch-name>
  worktree_removed: true|false
  issues_closed: #N, #M
  errors: <any errors or "none">
  warnings: <any warnings or "none">
```

---

## Intermediate States

This `/ship` skill is for **final delivery** of completed work. For intermediate scenarios:
- **Agent finished but others still working**: commit + push sub-branch, remove worktree. Sub-branch stays on remote until consolidation.
- **Session ending before ship**: commit + push all current state (even WIP). Branch persists on remote.
- **Resuming parked work**: `git worktree add .claude/worktrees/<name> <remote-branch>`
