---
name: ship
version: 0.1.0
description: >-
  Full end-to-end shipping pipeline: build, quality gates, version bump, commit,
  push, create PR, merge, tag, sync main, cleanup, and completion card. Use when
  work is complete and ready to land on main. Triggers on: "ship it", "fertig",
  "merge it", "ab damit", "mach nen PR", "push and merge", "das kann rein".
  Do NOT trigger when: user is still coding/debugging, mid-sprint, or just
  committing without shipping.
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(node *), Read, Glob, Grep, AskUserQuestion
---

# Ship

Ship completed work to main via PR.

## Pre-Step — Session Activity Guard

Before anything else, check whether this session still has work in progress.

1. Check for **background agents** still running (Agent tool results pending)
2. Check for **background Bash commands** still executing
3. Check for **TodoWrite tasks** that are not yet marked `completed` or `cancelled`

If ANY of the above are active:

> **STOP. Do not proceed with shipping.**
>
> Inform the user which activities are still in progress (agent names, task descriptions, or command summaries).
> Ask via AskUserQuestion:
> - "Warten bis alles fertig ist" — pause and resume /ship automatically when all activity completes
> - "Trotzdem shippen" — user accepts the risk, continue with Step 0
> - "Abbrechen" — cancel /ship entirely

This guard only applies to the **current chat session**, not external CI or other terminals.

## Step 0 — Load Extensions

Silently check for optional overrides (do not surface "not found" in output):

1. Global skill extension: `~/.claude/skills/ship/SKILL.md` + `reference.md`
2. Project skill extension: `{project}/.claude/skills/ship/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

Project extensions define: quality gate commands, deploy targets, version files, CI specifics.

## Step 1 — Pre-Flight Safety Gate

Run all checks. If any fails → **STOP and report**. Do not proceed.

See `deep-knowledge/pre-flight.md` for the full checklist:
- No uncommitted/untracked files
- Commits ahead of main (something to ship)
- All commits pushed to remote
- Build artifacts gitignored

## Step 2 — Build + Quality Gates

Build the project and run quality checks. See `deep-knowledge/quality-gates.md`.

1. Build: `npm run build` (or project-specific command from extension)
2. Lint: `npm run lint` (if available)
3. Tests: run task-specific tests (full suite only if not deduplicated by build-ID)
4. Generate build-ID: `node scripts/build-id.js`

If build fails → Completion Card Variant 4 (Blocked). Do not continue.

## Step 3 — Version Bump

Determine bump type and update all version files. See `deep-knowledge/versioning.md`.

- **patch/minor**: decide autonomously based on changes
- **major**: always ask user via AskUserQuestion
- **none**: internal-only changes (no user-visible impact)

### Mandatory Version Verification Gate

After bumping, grep ALL version files and verify they match the new version.
This is a **hard gate** — if ANY file is out of sync, STOP and fix before continuing.

```
Files to verify (all must show the new version):
- .claude-plugin/plugin.json         → "version": "X.Y.Z"
- .claude-plugin/marketplace.json    → "version": "X.Y.Z"
- README.md                          → **Version: X.Y.Z**
- CHANGELOG.md                       → ## [X.Y.Z] — <date> (must exist as newest entry)
- .claude/.plugin-version            → X.Y.Z (plain text, single line)
```

Run: `grep -rn "X.Y.Z" README.md CHANGELOG.md .claude-plugin/plugin.json .claude-plugin/marketplace.json .claude/.plugin-version`

Expected: **5 matches minimum** (one per file). If fewer → a file was missed. Fix it before proceeding.

If bump type is "none", skip this gate entirely.

## Step 4 — Commit, Push, PR, Merge

Execute the release pipeline. See `deep-knowledge/release-flow.md`.

1. Commit version-bumped files (conventional commit format, per /commit rules)
2. Push to feature branch: `git push -u origin <branch>`
3. Create PR via GitHub API (title <70 chars, body starts with `Closes #N`)
4. Merge PR via GitHub API (squash, delete branch)
5. Tag on main: `git tag v<X.Y.Z>` + push tag (skip if bump = none)

## Step 5 — Sync + Cleanup

Update local state and clean up. See `deep-knowledge/cleanup.md`.

1. Checkout main + pull
2. If worktree: also update main repo's main branch
3. Delete shipped feature branch (local)
4. Remove worktree if applicable
5. Prune: `git worktree prune`, `git remote prune origin`

**Only own branch/worktree.** Never clean up other branches or worktrees.
**Only after confirmed merge.** If Step 4 failed, preserve everything.

## Step 6 — Completion Card

Handled automatically by the `post.flow.completion` hook.
The hook instructs Claude to run `/refresh-usage`, select the correct variant, and pipe JSON to `scripts/render-card.js`.
No manual steps needed here — the card renders itself.
