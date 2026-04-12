---
name: devops-ship
version: 0.4.0
description: >-
  Full end-to-end shipping pipeline using MCP tools: ship_preflight, ship_build,
  ship_version_bump, ship_release, ship_cleanup, render_completion_card,
  then silent memory consolidation.
  Supports hierarchical merges (sub-branch → feature → main).
  Use when work is ready to land. Do NOT trigger during coding/debugging
  or for commits without shipping.
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(node *), Read, Glob, Grep, AskUserQuestion, ExitWorktree, mcp__plugin_devops_dotclaude-ship__*, mcp__plugin_devops_dotclaude-completion__*, mcp__plugin_devops_dotclaude-issues__*
---

# Ship

Ship completed work via PR using the `dotclaude-ship` MCP server tools.
Supports two modes: **direct** (branch → main) and **intermediate** (sub-branch → feature branch).

> **CRITICAL — `cwd` is required on every MCP tool call.**
> The ship MCP server runs in the plugin directory, NOT the target repo.
> Every `ship_*` tool call MUST include `cwd` set to the current working directory of this Claude session.
> Omitting `cwd` will cause the tool to operate on the wrong repository.

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
> - "Warten bis alles fertig ist" — pause and resume /devops-ship automatically when all activity completes
> - "Trotzdem shippen" — user accepts the risk, continue with Step 0
> - "Abbrechen" — cancel /devops-ship entirely

This guard only applies to the **current chat session**, not external CI or other terminals.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/ship/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/ship/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

Project extensions define: quality gate commands, deploy targets, version files, CI specifics.

4. Codex context: Read `{PLUGIN_ROOT}/deep-knowledge/codex-integration.md` — this skill has a **mandatory** Codex review gate (§1 in that doc). Detect Codex availability now so Step 2 can act on it.

## Step 1 — Pre-Flight Safety Gate

Call `ship_preflight` MCP tool (dotclaude-ship server).
**CRITICAL:** Always pass `cwd` — the MCP server runs in the plugin directory, not the target repo.
Use the current working directory of the Claude session as `cwd`.
```
ship_preflight({ base: "main", cwd: "<current working directory>" })
```

The tool **auto-detects** the correct base branch:
- If on a sub-branch like `feat/42-video-filters/core`, it detects `feat/42-video-filters` as the parent and uses it as base.
- If no parent branch is found, it ships to `main` (default).
- You can override by passing an explicit base: `ship_preflight({ base: "feat/42", cwd: "<cwd>" })`.

Check the result:
- `autoDetectedBase` — non-null if a parent branch was detected (confirms intermediate merge).
- `intermediate` — `true` if merging into a feature branch instead of main.
- `ready: false` → report errors and **STOP**. Do not proceed.

The tool checks: clean tree, commits ahead, all pushed, version consistency (skipped for intermediate), worktree detection.

## Step 2 — Build + Quality Gates

Call `ship_build` MCP tool (always pass `cwd`):
```
ship_build({ buildCmd: "npm run build", lintCmd: "npm run lint", cwd: "<cwd>" })
```

Pass project-specific commands from extensions if available.

If `success: false` → call `render_completion_card` with variant `ship-blocked`. Do not continue.

### Codex Review Gate (after build passes)

**MUST run** if codex-plugin-cc is installed — not optional, not suggested.

1. patch/minor → `/codex:review`; major → `/codex:adversarial-review`
2. Evaluate findings:
   - **No findings / clean** → continue to Step 3
   - **Auto-fixable** (typos, missing imports, style) → fix inline, continue
   - **Judgment required** (design concerns, logic flaws, security) →
     AskUserQuestion with findings + options: "Fixen", "Ignorieren", "Abbrechen"
3. If codex-plugin-cc not installed → skip silently

## Step 3 — Version Bump

**If `intermediate: true` (from Step 1)**: skip this step entirely. Version bumps only happen on final ship to main.

**If shipping to main:**

Determine bump type based on changes:
- **patch/minor**: decide autonomously
- **major**: always ask user via AskUserQuestion
- **none**: internal-only changes (no user-visible impact)

**Before calling ship_version_bump**, update CHANGELOG.md with the new version entry.
The MCP tool updates JSON files and README — CHANGELOG is editorial and must be done by Claude.

Then call `ship_version_bump` MCP tool (always pass `cwd`):
```
ship_version_bump({ bump: "minor", cwd: "<cwd>" })
```

Returns: `{ success, vOld, vNew, filesUpdated, verified, mismatches }`.

If `success: false` → no version file found. Report error and render completion card with variant `ship-blocked`. Do not continue.
If `verified: false` → fix mismatches manually, then retry.

## Step 4 — Release

Call `ship_release` MCP tool. Use the `base` from Step 1 (auto-detected or explicit).

**Final ship to main:**
```
ship_release({
  base: "main",
  title: "feat(ship): add MCP server for ship pipeline",
  body: "## Summary\n...\n\nCloses #N",
  commitMessage: "chore(release): v0.18.0",
  tag: "v0.18.0",
  releaseNotes: "...",
  prerelease: false,
  cwd: "<cwd>"
})
```

**Intermediate ship (sub-branch → feature branch):**
```
ship_release({
  base: "feat/42-video-filters",
  title: "feat(core): add video filter data models",
  body: "## Summary\n...",
  commitMessage: null,
  tag: null,
  releaseNotes: null,
  cwd: "<cwd>"
})
```

For intermediate merges: no tag, no release notes, no version commit. The tool automatically skips tag/release creation when `base` is not `main`.

The tool handles: commit (optional), push, PR create (or reuse existing), squash-merge, tag (main only), GitHub release (main only).

Returns: `{ branch, commit, pushed, pr: {number, url}, merged, intermediate, tag, tagVerified, release }`.

If `success: false` → do NOT proceed to cleanup. Report error and render completion card with variant `ship-blocked`.

### Squash-Merge Traceability Convention

When shipping a **feature branch → main** that was built from intermediate sub-branch merges, the PR body **MUST** include references to all intermediate PRs:

```markdown
## Summary
Feature: Video filters (end-to-end)

## Intermediate PRs
- #47 — feat(core): video filter data models
- #48 — feat(frontend): video filter UI
- #49 — feat(ai): video filter ML pipeline
```

This preserves the audit trail through squash-merges. Without these references, `git log` on main only shows one commit with no link back to the sub-branch work.

## Step 5 — Cleanup

**If in a worktree**: call `ExitWorktree(action: "remove")` FIRST to release the CWD lock.

If `ExitWorktree` **fails** (e.g. directory locked by another process): **STOP**. Do not proceed to cleanup.
Report the error to the user. The merge already landed on GitHub — cleanup can be retried later.

Then call `ship_cleanup` MCP tool with the `base` from Step 1 (always pass `cwd`):
```
ship_cleanup({ branch: "claude/feature-branch", base: "main", cwd: "<cwd>" })
```

For intermediate merges:
```
ship_cleanup({ branch: "feat/42-video-filters/core", base: "feat/42-video-filters", cwd: "<cwd>" })
```

The tool deletes the sub-branch but **preserves the feature branch** for further sub-branch merges or final ship to main.

The tool will refuse to run if still inside a worktree — it returns an error reminding you to call ExitWorktree first.

**Only own branch/worktree.** Never clean up other branches or worktrees.
**Only after confirmed merge.** If Step 4 failed, preserve everything.

If `success: false` → log warning but continue to Step 6. Cleanup failures are non-fatal — the merge already landed.

## Step 6 — Completion Card

Call `render_completion_card` MCP tool (dotclaude-completion server) with data from previous steps:

```
render_completion_card({
  variant: "ship-successful",
  summary: "<~10 words, user's language>",
  lang: "de",
  buildId: <from ship_build.buildId>,
  changes: [<from ship_build/devops-ship_version_bump results>],
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

Output the card markdown VERBATIM — card is the last **visible** output, nothing after closing `---`.

## Step 7 — Memory Dream

Silent memory consolidation after shipping. Runs **after** the completion card so it never delays user-facing output.

**Skip condition:** If no memory files were written or updated during this session → skip silently.

**If memories were touched this session**, run a lightweight dream pass:

1. **Orient** — Read `MEMORY.md` index and list all `memory/*.md` files
2. **Consolidate**:
   - Merge overlapping entries (same topic, different sessions)
   - Convert any relative dates to absolute (`"gestern"` → actual date)
   - Remove entries contradicted by current code/repo state
   - Remove implementation details derivable from code (file paths, line numbers, script commands)
3. **Prune** — Delete memory files that are fully stale (topic resolved, info now in code/docs)
4. **Update Index** — Rewrite `MEMORY.md` to match surviving files. Keep under 200 lines.

**Rules:**
- No user-visible output. This step is silent.
- Max budget: ~5K tokens (reads + minimal writes)
- Never touch `CLAUDE.md` — only `memory/` files
- If consolidation finds nothing to change → done, no writes needed

## Data Flow Summary

### Direct ship (branch → main)

```
ship_preflight → { ready, branch, base: "main", intermediate: false }
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
      ↓
[memory dream — silent, only if memories touched]
```

### Intermediate ship (sub-branch → feature branch)

```
ship_preflight → { ready, branch, base: "feat/42", intermediate: true, autoDetectedBase: "feat/42" }
      ↓
ship_build → { success, buildId, steps }
      ↓
[SKIP version bump]
      ↓
ship_release → { commit, pushed, pr, merged: "feat/42", tag: null }
      ↓
[ExitWorktree if needed]
      ↓
ship_cleanup → { cleaned, intermediate: true }  ← feature branch preserved
      ↓
render_completion_card → card markdown (VERBATIM)
      ↓
[memory dream — silent, only if memories touched]
```

Each tool produces structured JSON that feeds directly into the next step or the completion card.
No Bash parsing, no regex extraction — deterministic data flow.

## Hierarchical Merge Workflow

When multiple agents work on sub-branches of a feature branch:

```
feat/42-video-filters              ← feature branch (integration)
├── feat/42-video-filters/core     ← sub-branch (Core agent)
├── feat/42-video-filters/frontend ← sub-branch (Frontend agent)
└── feat/42-video-filters/ai       ← sub-branch (AI agent)
```

Each sub-agent ships independently via `/devops-ship`. The pipeline auto-detects the parent:

1. **Core finishes** → `/devops-ship` on `feat/42-video-filters/core`
   - Preflight detects base: `feat/42-video-filters`
   - Squash-merges into feature branch, no tag/version
2. **Frontend finishes** → `/devops-ship` on `feat/42-video-filters/frontend`
   - Same: intermediate merge into feature branch
3. **All sub-branches merged** → `/devops-ship` on `feat/42-video-filters`
   - No parent detected → ships to `main`
   - Full release: version bump, tag, GitHub release

This requires no manual `base` parameter — detection is automatic based on branch naming convention (`<parent>/<role>`).
