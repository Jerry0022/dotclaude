---
name: ship
version: 0.2.0
description: >-
  Full end-to-end shipping pipeline using MCP tools: ship_preflight, ship_build,
  ship_version_bump, ship_release, ship_cleanup, then render_completion_card.
  Use when work is complete and ready to land on main. Triggers on: "ship it",
  "fertig", "merge it", "ab damit", "mach nen PR", "push and merge", "das kann rein".
  Do NOT trigger when: user is still coding/debugging, mid-sprint, or just
  committing without shipping.
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(node *), Read, Glob, Grep, AskUserQuestion, ExitWorktree
---

# Ship

Ship completed work to main via PR using the `dotclaude-ship` MCP server tools.

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

Call `ship_preflight` MCP tool (dotclaude-ship server):
```
ship_preflight({ base: "main" })
```

If `ready: false` → report errors and **STOP**. Do not proceed.

The tool checks: clean tree, commits ahead, all pushed, version consistency, worktree detection.

## Step 2 — Build + Quality Gates

Call `ship_build` MCP tool:
```
ship_build({ buildCmd: "npm run build", lintCmd: "npm run lint" })
```

Pass project-specific commands from extensions if available.

If `success: false` → call `render_completion_card` with variant `blocked`. Do not continue.

### Codex Review (optional, if codex-plugin-cc installed)

After build + tests pass, run a Codex code review for a second opinion.
See `deep-knowledge/codex-integration.md` for details.

1. **patch/minor changes** → `/codex:review` (read-only diff review)
2. **major bump** → `/codex:adversarial-review` (challenges design trade-offs)
3. Present findings to user before proceeding
4. User decides: address findings, ignore and continue, or abort ship

If codex-plugin-cc is not installed → skip silently.
This step is non-blocking — Codex findings are advisory, not a hard gate.

## Step 3 — Version Bump

Determine bump type based on changes:
- **patch/minor**: decide autonomously
- **major**: always ask user via AskUserQuestion
- **none**: internal-only changes (no user-visible impact)

**Before calling ship_version_bump**, update CHANGELOG.md with the new version entry.
The MCP tool updates JSON files and README — CHANGELOG is editorial and must be done by Claude.

Then call `ship_version_bump` MCP tool:
```
ship_version_bump({ bump: "minor" })
```

Returns: `{ success, vOld, vNew, filesUpdated, verified, mismatches }`.

If `success: false` → no version file found. Report error and render completion card with variant `blocked`. Do not continue.
If `verified: false` → fix mismatches manually, then retry.

## Step 4 — Release

Call `ship_release` MCP tool:
```
ship_release({
  base: "main",
  title: "feat(ship): add MCP server for ship pipeline",
  body: "## Summary\n...\n\nCloses #N",
  commitMessage: "chore(release): v0.18.0",
  tag: "v0.18.0",
  releaseNotes: "...",
  prerelease: false
})
```

The tool handles: commit, push, PR create, squash-merge, tag, GitHub release — all deterministically.

Returns: `{ branch, commit, pushed, pr: {number, url}, merged, tag, tagVerified, release }`.

If `success: false` → do NOT proceed to cleanup. Report error and render completion card with variant `blocked`.

## Step 5 — Cleanup

**If in a worktree**: call `ExitWorktree(action: "remove")` FIRST to release the CWD lock.
Then call `ship_cleanup` MCP tool:
```
ship_cleanup({ branch: "claude/feature-branch", base: "main" })
```

The tool will refuse to run if still inside a worktree — it returns an error reminding you to call ExitWorktree first.

**Only own branch/worktree.** Never clean up other branches or worktrees.
**Only after confirmed merge.** If Step 4 failed, preserve everything.

If `success: false` → log warning but continue to Step 6. Cleanup failures are non-fatal — the merge already landed.

## Step 6 — Completion Card

Call `render_completion_card` MCP tool (dotclaude-completion server) with data from previous steps:

```
render_completion_card({
  variant: "shipped",
  summary: "<~10 words, user's language>",
  lang: "de",
  changes: [<from ship_build/ship_version_bump results>],
  tests: [<from ship_build results>],
  state: {
    branch: "main",
    commit: <from ship_release.commit>,
    pushed: true,
    pr: { number: <from ship_release.pr.number>, title: <PR title> },
    merged: "main"
  },
  cta: {
    vOld: <from ship_version_bump.vOld>,
    vNew: <from ship_version_bump.vNew>,
    bump: <bump type>
  }
})
```

Output the card markdown VERBATIM — card LAST, nothing after closing `---`.

## Data Flow Summary

```
ship_preflight → { ready, branch, ahead, inWorktree }
      ↓
ship_build → { success, buildId, steps }
      ↓
ship_version_bump → { vOld, vNew, filesUpdated, verified }
      ↓
ship_release → { commit, pushed, pr, merged, tag }
      ↓
[ExitWorktree if needed]
      ↓
ship_cleanup → { cleaned }
      ↓
render_completion_card → card markdown (VERBATIM)
```

Each tool produces structured JSON that feeds directly into the next step or the completion card.
No Bash parsing, no regex extraction — deterministic data flow.
