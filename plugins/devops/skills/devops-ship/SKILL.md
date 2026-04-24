---
name: devops-ship
version: 0.4.0
description: >-
  Full end-to-end shipping pipeline using MCP tools: ship_preflight, ship_build,
  ship_version_bump, ship_release, ship_cleanup, render_completion_card,
  then silent memory consolidation.
  Supports hierarchical merges (sub-branch → feature → main).
  Use when work is ready to land. Triggers on: "ship it", "push and merge".
  Do NOT trigger during coding/debugging or for commits without shipping.
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

4. Codex context: Read `{PLUGIN_ROOT}/deep-knowledge/codex-integration.md` — this skill has a **mandatory** Codex review gate (§1 in that doc), which MUST be called via `{PLUGIN_ROOT}/scripts/codex-safe.sh` (5-min hard timeout, see "Hard Timeout & Failure-Tolerance" section), NEVER via the `/codex:rescue` Agent tool. Detect Codex availability now so Step 2 can act on it.

## Step 0.5 — Load Deferred MCP Schemas

Ship tools from the `dotclaude-ship` MCP server are often **deferred** in large-tool-inventory sessions (their names appear in the SessionStart deferred-tools list, but their schemas are NOT loaded yet). Calling them directly before the schema is loaded fails with `InputValidationError`.

See `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md` for the full pattern.

**Before Step 1**, load all ship tool schemas in ONE `ToolSearch` call:

```
ToolSearch({
  query: "select:mcp__plugin_devops_dotclaude-ship__ship_preflight,mcp__plugin_devops_dotclaude-ship__ship_build,mcp__plugin_devops_dotclaude-ship__ship_version_bump,mcp__plugin_devops_dotclaude-ship__ship_release,mcp__plugin_devops_dotclaude-ship__ship_cleanup",
  max_results: 5
})
```

If the `ToolSearch` result contains all five `<function>` entries, proceed. If ANY are missing from the returned block, the server is genuinely not registered — STOP and report to the user (do NOT fall back to `gh pr create`; the guard hook will block it).

Do NOT skip this step even if you "think" the tools are available. `analysis` / `ready` / `test` cards have no ship-tool dependency and won't hit this — only the full pipeline does.

## Step 1 — Pre-Flight & Rebase Loop

Run preflight, resolve any merge-safety issues autonomously, and re-check — repeat until the branch is clean.

### 1a. Run preflight

Call `ship_preflight` MCP tool (dotclaude-ship server).
**CRITICAL:** Always pass `cwd` — the MCP server runs in the plugin directory, not the target repo.
Omit `base` to let the tool auto-detect it.
```
ship_preflight({ cwd: "<current working directory>" })
```

The tool **auto-detects** the correct base branch:
- If on a sub-branch like `feat/42-video-filters/core`, it detects `feat/42-video-filters` as the parent and uses it as base.
- Otherwise it uses the repository's default branch (resolves `origin/HEAD` — typically `main`, but `master` or any other name works too). Falls back to `main` if `origin/HEAD` is not set.
- You can override by passing an explicit base: `ship_preflight({ base: "feat/42", cwd: "<cwd>" })`.

Check the result:
- `autoDetectedBase` — non-null if a parent branch was detected (confirms intermediate merge).
- `intermediate` — `true` if merging into a feature branch instead of main.
- `ready: false` → report errors and **STOP**. Do not proceed.
- `needsRebase: true` → continue to 1b (do NOT stop).

The tool checks: clean tree, commits ahead, all pushed, version consistency (skipped for intermediate), worktree detection.
Merge-safety issues (`base-ahead`, `file-overlap`, `config-conflictstyle`) are **warnings, not errors** — they are resolved autonomously below.

### 1b. Resolve merge-safety warnings

**Only runs when `needsRebase: true`.** Otherwise skip to Step 2.

1. **Set diff3** (if `config-conflictstyle` warning): `git config merge.conflictstyle diff3`

2. **Rebase onto base**:
   ```bash
   git fetch origin <base>
   git rebase origin/<base>
   ```

3. **If rebase succeeds** (no conflicts): push and re-check (go to 1c).

4. **If rebase has conflicts** — resolve them autonomously (do NOT ask user):
   a. `git diff --name-only --diff-filter=U` to list conflicting files.
   b. For each conflicting file:
      - Read the file (contains `<<<<<<<`/`|||||||`/`=======`/`>>>>>>>` markers with diff3 base section)
      - Analyze **both sides semantically**: what did our branch change vs. what did base change?
      - Check **chronological context**: which change is newer? Do they contradict or complement each other?
      - Produce a merged version that preserves **both** intents
      - Write the resolved file, then `git add <file>`
   c. `git rebase --continue`
   d. If more conflicts appear (multi-commit rebase), repeat (b)–(c)
   e. **Truly ambiguous conflicts** (both sides change the same logic in contradictory ways and the correct resolution is not determinable from code context): abort the rebase (`git rebase --abort`) and ask the user via AskUserQuestion with a clear, developer-readable explanation:
      - Show the conflicting snippet (both sides + base)
      - Explain what each side intended
      - Ask which intent should win, or whether both need manual reconciliation

5. **Push**: `git push --force-with-lease` to update the remote branch.

6. **Verification test**: Run the full test suite to confirm nothing broke. If tests fail, diagnose and fix before proceeding.

### 1c. Re-run preflight

After rebase + push + tests pass, **re-run `ship_preflight`** with the same parameters.
- `needsRebase: false` and `ready: true` → proceed to Step 2.
- `needsRebase: true` → someone pushed to base during our rebase. Go back to 1b.
- `ready: false` (hard errors) → report errors and **STOP**.

This loop naturally terminates — each iteration brings the branch closer to base.

### Merge strategy decision

Based on the `file-overlap` check from the **final** preflight run:
- **No overlap** → use `mergeStrategy: "squash"` (default, clean history)
- **Overlap detected** → use `mergeStrategy: "merge"` (preserves ancestry chain for future three-way merges)

Pass the chosen strategy to `ship_release`.

## Step 2 — Build + Quality Gates

Call `ship_build` MCP tool (always pass `cwd`):
```
ship_build({ buildCmd: "npm run build", lintCmd: "npm run lint", cwd: "<cwd>" })
```

Pass project-specific commands from extensions if available.

If `success: false` → call `render_completion_card` with variant `ship-blocked`. Do not continue.

### Codex Review Gate (after build passes)

**MUST run** if codex-plugin-cc is installed — not optional, not suggested.

1. Invoke Codex via Bash with hard timeout: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-safe.sh" "<review prompt containing git diff>"`. Do NOT use the `/codex:rescue` Agent tool.
2. Evaluate by exit code (see `deep-knowledge/codex-integration.md` "Hard Timeout & Failure-Tolerance"):
   - **rc=0, no findings / clean** → continue to Step 3
   - **rc=0, auto-fixable** (typos, missing imports, style) → fix inline, continue
   - **rc=0, judgment required** (design concerns, logic flaws, security) →
     AskUserQuestion with findings + options: "Fixen", "Ignorieren", "Abbrechen"
   - **rc=124** (timeout, 5 min) → log "Codex review timed out — proceeding without review" in the ship log, continue to Step 3. Do NOT retry, do NOT block the ship.
   - **rc=126** (`DEVOPS_DISABLE_CODEX=1`) or **rc=127** (codex CLI missing) → skip silently
   - **other non-zero** → surface first line of stderr, continue to Step 3
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

See `deep-knowledge/call-examples.md` for the three reference payloads
(final ship to main, intermediate ship, overlap-with-merge-commit).
For intermediate merges: no tag, no release notes, no version commit —
the tool automatically skips tag/release creation when `base` is not `main`.

The tool handles: commit (optional), rebase verification, push (force-with-lease after rebase), PR create (or reuse with mergeability check), merge (squash or merge commit), tag (main only), GitHub release (main only).

Returns: `{ branch, commit, rebased, pushed, pr: {number, url}, merged, mergeStrategy, intermediate, tag, tagVerified, release }`.

**If `rebaseRequired: true`**: the branch is not rebased onto base. Go back to Step 1b and rebase before retrying.

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

Call `render_completion_card` MCP tool (dotclaude-completion server) with data from previous steps.

**CRITICAL — `cwd` is required for clickable links.** Without `cwd`, `getRepoUrl` falls back to the MCP server's own working directory (plugin dir, not your target repo) and the card renders PR/commit/branch as plain text. Always pass the same `cwd` you used for the ship tools.

```
render_completion_card({
  variant: "ship-successful",
  summary: "<~10 words, user's language>",
  lang: "de",
  cwd: "<current working directory — same as ship_release>",
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

## Data Flow & Hierarchical Merges

- **Data flow** (preflight → build → version-bump → release → cleanup →
  completion card): see `deep-knowledge/data-flow.md` for the direct-ship
  and intermediate-ship diagrams.
- **Hierarchical merges** (sub-branch → feature branch → main, automatic
  parent detection via `<parent>/<role>` naming): see
  `deep-knowledge/hierarchical-merge.md`.
