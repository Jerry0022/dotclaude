---
name: ship
version: 0.8.0
description: >-
  Full end-to-end shipping pipeline using MCP tools: ship_preflight, ship_build,
  ship_version_bump, ship_release, ship_cleanup, render_completion_card,
  then silent memory consolidation.
  Supports hierarchical merges (sub-branch → feature → main).
  Use when work is ready to land. Triggers on: "ship it", "push and merge".
  Do NOT trigger during coding/debugging or for commits without shipping.
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(node *), Bash(bash *), Bash(nohup *), Read, Glob, Grep, AskUserQuestion, ExitWorktree, TaskList, TaskCreate, TaskUpdate, mcp__plugin_devops_dotclaude-ship__*, mcp__plugin_devops_dotclaude-completion__*, mcp__plugin_devops_dotclaude-issues__*
---

# Ship

Ship completed work via PR using the `dotclaude-ship` MCP server tools.
Supports two modes: **direct** (branch → main) and **intermediate** (sub-branch → feature branch).

> **CRITICAL — `cwd` is required on every MCP tool call.**
> The ship MCP server runs in the plugin directory, NOT the target repo.
> Every `ship_*` tool call MUST include `cwd` set to the current working directory of this Claude session.
> Omitting `cwd` will cause the tool to operate on the wrong repository.

## Pre-Step A — Autonomous Lockout Detection

`/ship` is composed by unsupervised orchestrators (`run-backlog`
ships every queued issue this way; future AFK runners may too). Those runs are in
a **Post-Confirmation Lockout** — the user is AFK and **no `AskUserQuestion` can
ever be answered**. A modal raised mid-pipeline would hang the entire night run on
a single issue. Detect that state FIRST, before any other step:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/autonomous-lockout.js" check
```

Parse the JSON. If `active: true`, set `$SHIP_LOCKOUT=true` for this whole run
**and persist it durably**: write a `.claude/.ship-lockout` marker in the repo
root (`node -e "require('fs').mkdirSync('.claude',{recursive:true});require('fs').writeFileSync('.claude/.ship-lockout','1')"`).
`$SHIP_LOCKOUT` is consumed at ~5 later gates, across a >5-min CI wait during
which the conversation may compact and drop the variable from memory. At every
interactive gate, re-derive `$SHIP_LOCKOUT=true` when the marker file exists
rather than trusting recall alone — a lost lockout that silently re-enables
`AskUserQuestion` is exactly the AFK-hang this guard exists to prevent. Clear the
marker in Step 5 cleanup (delete `.claude/.ship-lockout`). If the command errors
or the script is absent (older plugin), treat it as **not locked** — a normal
interactive ship — and continue. The guard only ever *adds* non-interactive
safety; it never blocks a normal ship.

**The rule when `$SHIP_LOCKOUT` is set: never call `AskUserQuestion`.** Every gate
that would normally ask takes its documented non-interactive branch instead. The
two shapes are:

- **BLOCK** → stop the pipeline, call `render_completion_card` with variant
  `ship-blocked` (reason stated), and return. The orchestrator treats the item as
  parked and moves on — one blocked issue never halts the queue.
- **RECORD & CONTINUE** → don't ask, don't block; fold the open point into a
  `userFinalTest` item for Step 6 and proceed. Only for genuinely non-fatal points.

| Interactive gate | Normal behavior | `$SHIP_LOCKOUT` behavior |
|---|---|---|
| Pre-Step B — session activity still in progress | ask Warten/Trotzdem/Abbrechen | in-scope activity pending → **BLOCK** ("session activity active"); otherwise proceed |
| Step 1b(e) — truly ambiguous rebase conflict | abort + ask which side wins | `git rebase --abort` → **BLOCK** ("unresolvable merge conflict — needs human decision") |
| Step 1d — high-impact purpose-alignment conflict | ask (batched) | apply mechanical fixes as usual; high-impact items → **RECORD & CONTINUE** |
| Step 2 — Codex judgment-required finding | ask Fixen/Ignorieren/Abbrechen | auto-fixable → fix inline; design/logic/security → **BLOCK** (finding named) |
| Step 3 — major version bump | always ask | **BLOCK** ("needs major-version decision — not shipped unattended") |

A BLOCK under lockout is the safe outcome, not a failure: the caller parks the
issue as a `⏸ Rückfrage` and the queue continues. Shipping an unreviewed
security finding, an ambiguous merge, or an unattended breaking change would be
the actual failure. When `$SHIP_LOCKOUT` is false (a normal interactive ship),
every gate behaves exactly as written elsewhere in this skill — unchanged.

## Pre-Step B — Session Activity Guard

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

**If `$SHIP_LOCKOUT` (Pre-Step A):** do not ask. If genuine in-scope activity is
still pending, **BLOCK** (`ship-blocked`, "session activity active"); otherwise
proceed to Step 0.

This guard only applies to the **current chat session**, not external CI or other terminals.

> **Sentinel hygiene (every exit path).** `ship_preflight` writes a
> ship-in-progress sentinel that makes the main-branch Edit guards
> (`pre.main.guard` / `pre.edit.branch`) stand down for the ship's duration. It is
> cleared by `ship_cleanup` on a *successful* ship — but a **ship-blocked / abort**
> return (any `render_completion_card` variant `ship-blocked` below) skips cleanup
> and would leave the sentinel stranded, silently disarming main-branch protection
> until it ages out. **Rule:** before rendering ANY `ship-blocked` card, first call
> `ship_cleanup({ branch, cwd, keep: true })` — keep-mode deletes no branch/worktree,
> it only clears the sentinel so main-branch protection resumes immediately.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/ship/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/ship/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

Project extensions define: quality gate commands, deploy targets, version files, CI specifics.

Also capture, if present in the merged `reference.md`, for use later in this run:
- `outOfBandDeploy:` — a list of path globs for artifacts a code merge does NOT
  deploy (DB migrations, edge/serverless functions). Pass them to `ship_preflight`
  in Step 1a. Omit when absent — the tool applies stack-agnostic defaults.
- `deploy:` — a deploy handler (e.g. `supabase`) that can actually APPLY those
  artifacts post-merge. Used by Step 4d. When absent, Step 4d raises the deploy
  gate instead of deploying.

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

If Step 0 captured an `outOfBandDeploy:` glob list from the extension, pass it:
`ship_preflight({ cwd: "<cwd>", outOfBandGlobs: ["**/migrations/**", ...] })`.
Otherwise omit it — the tool uses stack-agnostic defaults.

The result carries `outOfBandDeploys: { detected, files, kinds, globs }` — artifacts
this diff touches that a code merge will NOT deploy (#243). **Carry this value
forward to Step 4d.** It is informational, never a hard gate (`ready` is unaffected).

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

      **If `$SHIP_LOCKOUT` (Pre-Step A):** do not ask. After `git rebase --abort`,
      **BLOCK** (`ship-blocked`, "unresolvable merge conflict — needs human
      decision"); the caller parks the issue and the queue continues.

5. **Push**: `git push --force-with-lease` to update the remote branch.

6. **Verification test**: Run the full test suite to confirm nothing broke. If tests fail, diagnose and fix before proceeding.

### 1c. Re-run preflight

After rebase + push + tests pass, **re-run `ship_preflight`** with the same parameters.
- `needsRebase: false` and `ready: true` → proceed to Step 2.
- `needsRebase: true` → someone pushed to base during our rebase. Go back to 1b.
- `ready: false` (hard errors) → report errors and **STOP**.

This loop naturally terminates — each iteration brings the branch closer to base.

### 1d. Purpose Alignment Gate

After the preflight loop stabilizes (`ready: true`), verify the ship against
the **purposes** of recently merged work — not just its code. Full protocol:
`deep-knowledge/purpose-alignment.md`.

- **Light check (every ship, direct + intermediate):** gather the purposes of
  the last 3–5 merged PRs into `<base>` (Claude-authored bodies preferred;
  fallback: merge commits / CHANGELOG), extract cross-cutting conventions, and
  audit **in both directions**: (a) the current diff honors prior conventions —
  e.g. a prior branch's "all elements get hotkeys" must also cover an element
  added on THIS branch, even though the hotkey task never belonged to it; and
  (b) a convention THIS branch introduces is retro-applied to the existing
  artifacts on `<base>` as part of this ship (reverse propagation).
- **Full check (a rebase/merge happened in 1b, or re-entry after
  `baseAdvancedDuringChecks`):** additionally verify the merged content still
  delivers its purposes in **both directions** — their features intact under
  our changes, our features intact under theirs.

Findings: fix autonomously when the fix is mechanical and clearly implied by
the convention (it ships with this PR). Ask via AskUserQuestion ONLY for
high-impact conflicts (contradicting purposes, design decisions, substantial
rework) — all batched into ONE question.

**If `$SHIP_LOCKOUT` (Pre-Step A):** still apply the mechanical fixes; for the
high-impact conflicts do not ask — **RECORD & CONTINUE** (fold each into a
`userFinalTest` item for Step 6). This gate never blocks the ship on its own.

Skip silently when: `mode: "file-only"`, no purpose sources found, or the diff
is clearly out of scope for every gathered purpose.

Feed results into Step 6: fixed violations → `changes`; open/unverifiable
items → `userFinalTest`. Silent when clean.

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
     AskUserQuestion with findings + options: "Fixen", "Ignorieren", "Abbrechen".
     **If `$SHIP_LOCKOUT` (Pre-Step A):** do not ask — **BLOCK** (`ship-blocked`,
     naming the finding). A design/logic/security concern must not merge
     unreviewed unattended; the caller parks the issue for the user.
   - **rc=124** (timeout, 5 min) → log "Codex review timed out — proceeding without review" in the ship log, continue to Step 3. Do NOT retry, do NOT block the ship.
   - **rc=126** (`DEVOPS_DISABLE_CODEX=1`) or **rc=127** (codex CLI missing) → skip silently
   - **other non-zero** → surface first line of stderr, continue to Step 3
3. If codex-plugin-cc not installed → skip silently

## Step 2.6 — Docs-Sync

Reconcile living documentation against the **frozen shipped diff** before the
version bump — so doc edits land in the same version-bump commit. This is the
ship-time counterpart to the docs upkeep implementation agents already do.

1. Determine what this ship actually changes — new feature, changed flow, new
   subsystem, architecture/contract change, or removal. Use the diff since the
   merge-base, not intentions.
2. Apply the **proportional** doc action per
   `${CLAUDE_PLUGIN_ROOT}/deep-knowledge/documentation-maintenance.md` § Trigger Matrix:
   - trivial (typo / refactor / dep or version bump / pure bugfix) → no
     living-doc change; note "no living-docs impact" and continue.
   - new or changed behavior, flow, or architecture → update the affected living
     docs (`docs/`, README prose, architecture/flow docs) in place; restructure
     `docs/` only when the layout no longer fits (additive-first, never delete
     dated specs/concepts).
3. Commit any doc edits on the current branch so they ship with this version.

**Non-blocking:** never abort a ship over docs. Unavoidable doc debt proceeds —
record the gap in the CHANGELOG entry (Step 3). The mechanical roster markers
(counts, rosters) are handled separately by `ship_build` in Step 2.

## Step 3 — Version Bump

**If `intermediate: true` (from Step 1)**: skip this step entirely. Version bumps only happen on final ship to main.

**If shipping to main:**

Determine bump type based on changes:
- **patch/minor**: decide autonomously
- **major**: always ask user via AskUserQuestion. **If `$SHIP_LOCKOUT`
  (Pre-Step A):** do not ask — **BLOCK** (`ship-blocked`, "needs major-version
  decision — not shipped unattended"). A breaking change is a deliberate call,
  never an unsupervised one; the caller parks the issue.
- **none**: internal-only changes (no user-visible impact)

**Before calling ship_version_bump**, update CHANGELOG.md with the new version entry.
The MCP tool updates JSON files and README — CHANGELOG is editorial and must be done by Claude.

> **CHANGELOG is large** — an `Edit` requires a prior `Read`, but the repo's
> `pre.tokens.guard` blocks the first Read of a big CHANGELOG (tens of thousands of
> tokens). Read only the head of the file (`Read` with a small `limit`, e.g. 40 —
> the newest entries are at the top) to satisfy the Edit precondition, or retry the
> blocked Read once (the guard's sanctioned bypass). Never load the whole file. This
> matters most in an AFK / `$SHIP_LOCKOUT` run, where a surprise token-guard block
> would otherwise stall the pipeline with no one to retry it.

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

The tool handles: commit (optional), rebase verification, push (explicit force-with-lease after rebase), PR create (or reuse with mergeability check), **pre-merge CI checks gate (waits for green)**, **pre-merge rebase re-check (closes the checks-window race)**, merge (squash or merge commit), **post-merge tree guard**, **alpha channel tag** (main only), GitHub release deferred to promotion.

Returns: `{ branch, commit, rebased, pushed, pr: {number, url}, checks: {status, passed, failed, pending}, merged, mergeStrategy, intermediate, tag, channel, tagVerified, releaseDeferred, postMergeTreeMatch, postMergeWarning }`.

**Ring model (channels):** the tag is `alpha/vX.Y.Z` — every ship publishes to
the EARLIEST channel autonomously. beta/stable tags and GitHub Releases are
created later by `/promote` (deliberate promotion, same SHA, no rebuild).
Pass the bare `tag: "vX.Y.Z"` as before; the tool prefixes the channel. See
`docs/superpowers/specs/2026-07-11-tag-channel-system-design.md`.

**Pre-merge CI gate** (default ON): after PR create, `ship_release` runs `gh pr checks --watch` (default 600s timeout). If checks fail or timeout → `success: false`, `checksBlocked: true`, PR stays open, branch not deleted. Render `ship-blocked` card with the failing check names + run URLs.

- Hot-fix bypass: pass `skipChecks: true` or set `DEVOPS_SHIP_SKIP_CHECKS=1`. Result records `checks.status: "skipped"` so the card flags it.
- Tune timeout per call: `checksTimeoutSec: <30..3600>`.
- See `deep-knowledge/quality-gates.md → Pre-Merge CI Checks Gate` for the full state matrix.

**If `rebaseRequired: true`**: the branch is not rebased onto base. Go back to Step 1b and rebase before retrying. This also fires as `baseAdvancedDuringChecks: true` when a **parallel ship landed on base while we waited for CI** — the PR is left open and unmerged (no silent overwrite). Same action: rebase + retry, then re-run the **Step 1d full check** before the retry: a parallel ship just landed, and its purpose may impose obligations on this branch (see `deep-knowledge/purpose-alignment.md`). See `deep-knowledge/merge-safety.md → How ship_release Prevents Overwrites`.

**If `postMergeTreeMatch: false`** (merge succeeded but `postMergeWarning` is set): **verify before surfacing** — the guard can fire as a false alarm (a tooling error in the tree lookup or a stale `origin/<base>` ref right after the merge; observed as a permanent Windows false positive before v0.107.1). Run:

```bash
git fetch origin <base>
git show -s --format=%T <branch-HEAD-sha>   # tree of what was built+tested
git show -s --format=%T origin/<base>        # tree of what landed
```

- **Trees equal** → false alarm. Log one line ("post-merge tree guard false alarm — trees verified identical"), NO `userFinalTest` item.
- **Trees differ** → a concurrent ship was three-way merged into base during the merge — its changes are preserved. Surface `postMergeWarning` as a `userFinalTest` item ("Verify main is consistent — a parallel ship merged in concurrently"). Do NOT treat it as a ship failure — the merge landed.
- Comparing `origin/<base>` to the `mergeSha` alone proves nothing (same commit after propagation) — always compare against the **branch HEAD** that was built and tested.

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

### Step 4a — Delivery extension hook

After `ship_release` succeeds, check `{project}/.claude/skills/ship/reference.md` for a
`deliver:` field:

- **Default (`git+gh` or field absent):** existing behavior — PR + merge already done in Step 4.
- **`ssh-rsync`:** rsync build output to the configured `target`. (Future work — currently falls through to `none`.)
- **`ha-rest`:** POST to Home Assistant REST API at `base_url`. (Future work — currently falls through to `none`.)
- **`none`:** skip delivery entirely.

When `deliver` is set, the MCP `ship_release` tool dispatches to the corresponding
handler. Handlers `ssh-rsync` and `ha-rest` are extension points documented for
consumer configuration — not yet implemented in this release (they fall through to
`none` intentionally).

See `deep-knowledge/skill-extension-guide.md -> Delivery targets` for reference.md examples.

## Step 4b — Spawn Post-Merge Watcher (final ship only)

**Skip this step for intermediate merges** — only relevant when shipping to main.

After `ship_release` returns `success: true` and `merged: "main"`, spawn the post-merge
watcher in the background. It waits for the GitHub Actions run triggered by the merge
and (if configured) probes the production URL — all without blocking the ship flow.

```bash
# Background — fire and forget. The watcher anchors its state dir to the MAIN
# repo (resolved via git-common-dir), NOT to <cwd>: a worktree ship deletes <cwd>
# during ship_cleanup, so the result must land in the main repo where the
# ss.ship.verify hook (running from the main repo at the next SessionStart) can
# still read it. No --state-dir flag is needed — the default handles this.
nohup node "${CLAUDE_PLUGIN_ROOT}/scripts/post-merge-watcher.js" \
  --cwd "<cwd>" \
  --base "main" \
  --merge-sha "<ship_release.mergeSha>" \
  --pr "<ship_release.pr.number>" \
  --max-wait 1800 \
  --verify-config "<cwd>/.claude/skills/ship/reference.md" \
  --version "<ship_version_bump.vNew or empty>" \
  > /dev/null 2>&1 &
```

On Windows (PowerShell), use `Start-Process` with `-WindowStyle Hidden` instead of `nohup`:
```powershell
Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList @("$env:CLAUDE_PLUGIN_ROOT/scripts/post-merge-watcher.js", "--cwd", "<cwd>", "--base", "main", "--merge-sha", "<sha>", "--pr", "<n>", "--max-wait", "1800", "--verify-config", "<cwd>/.claude/skills/ship/reference.md", "--version", "<vNew>")
```

The watcher writes status to `<main-repo>/.claude/.ship-watcher/<merge-sha>.json`
(resolved from the git-common-dir, so a removed worktree cannot swallow the result)
and the `ss.ship.verify` hook surfaces unack'd results at the next SessionStart. On
failure, a best-effort Windows toast fires immediately.

**Skip the watcher entirely** when:
- `intermediate: true` (no CI on intermediate merges typically)
- The repo has no `.github/workflows/` directory (check with `Glob`)
- User passed `--no-watch` to the ship trigger (interpret intent from the user's message)

Pass `state.watcher = { spawned: true, sha: "<sha>" }` (or `spawned: false`) into the
completion card in Step 6 so it can render "Deploy-Verify läuft im Hintergrund".

## Step 4c — Live Surface Verification (final ship only)

**A green pipeline ≠ a release users can see.** CI can pass, the merge can land,
the Step 4b watcher's HTTP probe can return 200 — and the version users actually
get can still be the **old** one. This step opens the real user-facing surface(s)
in a browser and asserts the **shipped version is live and visible** before the
completion card declares done. It complements (does NOT replace) the
`stop.flow.browsertest` gate (which verifies code changes *pre*-merge) and the
Step 4b watcher (headless, post-session). (#210)

**Skip this step entirely when ANY of:**
- `intermediate: true` (intermediate merges have no live surface).
- The project declares **no surfaces** — see config below. This is the default
  (libraries, CLIs, internal tooling have no user-facing deploy). Skip silently.
- User passed `--no-verify` / `--no-watch` intent in the ship trigger.

### Config — declare surfaces

Read `{project}/.claude/skills/ship/reference.md` for a `surfaces:` list (or, for
a single surface, the existing `verify:` block's `url`/`selector`/`expected`).
Each surface: `{ name, url, selector, expected }` where `expected` may use the
`$VERSION` placeholder (expands to the just-shipped `vNew` / tag). Full format:
`deep-knowledge/post-merge-verify.md → Declarative surfaces`.

### Verify each surface

For every declared surface:

1. Pick the browser tool via the waterfall in
   `deep-knowledge/browser-tool-strategy.md` (Claude-in-Chrome in Edge first).
   This is a live post-deploy read — see `deep-knowledge/test-autonomy.md`.
   Works in foreground, background, and autonomous mode.
2. Open `url` in the **separate Edge testing window** (per the Edge Credo).
3. Read the **rendered** version marker. Use **Eval JS** (`javascript_tool` /
   `browser_evaluate` / `preview_eval`) to read structured data
   (`document.querySelector(selector)?.textContent` or the documented attribute)
   — NOT "read page", which strips scripts and misses client-rendered values.
4. Assert the rendered value contains the shipped version (`vNew` / tag).

**Why a browser, not just the watcher's HTTP probe:** the headless probe fetches
raw response bytes — it misses **client-rendered** version strings (SPA where JS
injects the version) and cannot see a download page whose served artifact is
gated behind a DB row or an API. A real browser renders the DOM and follows the
same path a user does. Gaps this catches that pass CI:
- a GitHub release marked `prerelease` leaves the prior version as
  `/releases/latest` → the "latest" download link still serves the old version;
- a download page driven by a DB row / API (not GitHub directly) keeps serving
  the old version until that row is registered;
- multi-surface releases (web + desktop binary + edge functions) where one
  surface silently lags.

### Feed the result into Step 6

- **All surfaces serve the shipped version** → clean `ship-successful`.
- **Any surface lags / still shows the old version / unreachable** → STILL
  `ship-successful` (the merge happened — per the Step 6 variant rule, never
  downgrade after a merge), but add one **prominent `userFinalTest` item per
  lagging surface**, e.g.
  `{ action: "Download-Seite zeigt noch <alt> statt <neu> — prerelease-Flag / DB-Row prüfen", afterDeployment: true }`.
  When a surface definitively serves the **old** version (a real regression
  risk), make that item the first and loudest.
- **No browser tool available** (waterfall fails): do NOT block the ship. Record
  a `userFinalTest` item "Live-Surface manuell verifizieren: <url> sollte <vNew> zeigen".

Pass `state.surfaceVerify = { checked: N, live: M, lagging: [...] }` into the card.

## Step 4d — Out-of-Band Deploy Gate (final ship only)

**A code merge does NOT apply DB migrations or deploy edge/serverless functions.**
When the shipped diff touches such artifacts, merging the PR leaves the code
referencing infra that was never applied — the change is silently NOT live even
though every prior step went green. This step turns `ship_preflight`'s detection
into either an actual deploy (when a handler is configured) or a mandatory,
loud completion-card gate. (#243)

**Skip this step entirely when:**
- `intermediate: true` (no deploy target for intermediate merges), or
- `ship_preflight.outOfBandDeploys.detected` is `false` (the common case — skip
  silently, nothing changed).

**When `outOfBandDeploys.detected` is `true`:**

1. **If Step 0 captured a `deploy:` handler** that can apply these artifacts
   (e.g. `supabase` → `apply_migration` + `deploy_edge_function` via the Supabase
   MCP): run it now, after the merge landed. Deploy each detected artifact.
   - **All deployed successfully** → the change is live. Do NOT set the gate;
     instead add a `userFinalTest` item to **verify** the deployed infra behaves
     (e.g. "Verify the migration applied: query the new column in prod").
   - **Any deploy failed / handler errored** → fall through to step 2 for the
     artifacts that did not deploy, naming the failure.

   Keep concrete deploy automation in the **project** extension — the plugin
   ships detection + the gate, never a stack-specific deployer.

2. **Otherwise (no handler, or a deploy failed)** — raise the deploy gate. This
   is mandatory: the completion card MUST NOT read as "all done" while merged
   infra is undeployed. Carry into Step 6:
   - `state.deployPending: true` — flips the ship-successful CTA from
     "Alles ERLEDIGT" to "🚨 DEPLOY erforderlich (noch nicht live)".
   - `deployGate: [...]` — one item per detected artifact, each
     `{ artifact: "<path>", kind: "<migration|function|infra>", action: "<the concrete deploy step still required>" }`.
     Derive `artifact`/`kind` from `outOfBandDeploys.matched`; write `action` as
     the smallest true next step (e.g. "apply_migration", "deploy edge function
     desktop-latest", or "run your migration + function deploy").

Never downgrade the variant — the merge DID happen (per the Step 6 variant rule).
The gate lives in `deployGate` + `state.deployPending`, not in the variant.

## Step 5a — Continue-Intent Check (auto-detect keep-mode)

Before cleanup, decide whether **follow-up work** is expected in this same branch/worktree.
If yes → **keep-mode** (skip Step 5b's destructive cleanup, jump to 5c).
If no → **normal cleanup** (Step 5b).

**Default is normal cleanup.** Only switch to keep-mode when a signal is clear — false-positives
accumulate unmerged branches and orphan worktrees.

### Signals that trigger keep-mode

Evaluate all sources; ANY positive hit → keep-mode.

1. **Open TodoWrite tasks not covered by this ship.** Call `TaskList` and check for `pending` or
   `in_progress` items that describe work NOT delivered by the current PR's diff. Tasks that
   were *about* this ship (e.g. "Run npm test", "Bump version") and are still open due to a
   tracking slip do NOT count — only genuine follow-up scope.

2. **Explicit follow-up signals in recent user messages** (this session, last ~10 turns):
   - German: `"danach"`, `"dann noch"`, `"anschließend"`, `"weiter mit"`, `"als nächstes"`,
     `"Phase 2"`, `"wir sind nicht fertig"`, `"noch nicht durch"`, `"zwischendurch"`,
     `"erstmal X, dann Y"`, `"shippen aber wir machen weiter"`
   - English: `"after this"`, `"then we"`, `"next up"`, `"phase 2"`, `"still need to"`,
     `"we'll continue"`, `"ship but keep going"`, `"intermediate ship"`

3. **Multiple distinct scopes announced earlier.** If the user laid out a sequence of
   logically separate work blocks and only the first is being shipped now → keep-mode.

4. **Explicit ship-but-keep wording in the trigger.** If the prompt that started this ship
   says something like `"ship das aber wir machen weiter"`, `"ship und weiter"`,
   `"keep worktree"`, `"--keep"`, `"ohne cleanup"` → keep-mode (highest priority).

### When the signal is ambiguous

If you considered keep-mode but the signal is weak (e.g. one borderline phrase, no clear
follow-up scope), default to **normal cleanup**. Cleanup is recoverable — the branch can be
re-created from the merge commit. Orphan worktrees from false-positive keep-mode are not.

### Decision logging

In the completion card's `changes` or `summary`, mention the chosen mode briefly when
keep-mode triggers — e.g. `"Worktree behalten — Folge-Arbeit erkannt"` — so the user sees
what was decided and can override (`"nein, doch räum auf"` for a follow-up cleanup).

## Step 5b — Cleanup (normal mode)

**Skip this step entirely if Step 5a chose keep-mode** — jump to Step 5c.

### Substep 1 — Capture session context

**Before any cleanup action**, capture two pieces of state for Substep 3:

1. The current worktree path (if running inside one) — capture via
   `pwd` / `git rev-parse --show-toplevel` BEFORE `ExitWorktree` runs.
   Save it as `$WORKTREE_PATH`. Skip this if not in a worktree.
2. The resolved main-repo root via `git rev-parse --git-common-dir` and
   walking to its parent (or `git worktree list --porcelain` first entry).
   Save it as `$MAIN_REPO_ROOT`. Substep 3 re-resolves this internally but
   capturing it here makes the cleanup trail easier to log.

### Substep 2 — Exit worktree + ship_cleanup

**If in a worktree**: call `ExitWorktree(action: "remove")` FIRST to release the CWD lock.

If `ExitWorktree` **fails** (e.g. directory locked by another process): **STOP**. Do not proceed to cleanup.
Report the error to the user. The merge already landed on GitHub — cleanup can be retried later.

**If `ExitWorktree` returns a No-op** (the worktree was created externally — by the harness or
`git worktree add` — not via `EnterWorktree` in this session): the tool cannot release the CWD
lock and `ship_cleanup` will refuse (`"attached to an active worktree"`). Do **NOT** force-remove
the directory the session lives in — that would break the session. This is **forced-keep**, NOT
deliberate keep-mode:
- Clear the sentinel with `ship_cleanup({ ..., keep: true })` (same call as Step 5c) so Edit/branch
  guards reset — but treat it purely as sentinel cleanup.
- In Step 6, render the **normal** DONE CTA — do **NOT** pass `state.kept: true`. Keep-mode's
  `WEITER in <branch>` CTA is reserved for *deliberate* keep (expected follow-up work); a worktree
  kept only because cleanup was blocked must not signal "keep coding here".
- Instead, add a short manual-cleanup note **above** the card (close the session, then from the main
  repo: `git worktree remove <path>` + `git branch -d <branch>`).
- Skip the rest of Step 5b/5c.

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

If `success: false` → log warning but continue to Substep 3 (re-opening files
is still useful) then Step 6. Cleanup failures are non-fatal — the merge
already landed.

### Substep 3 — Re-open session-opened files from main-repo path

After `ship_cleanup` completes, every file:// URL the session opened from
inside `$WORKTREE_PATH` is now dead (the worktree directory has been
pruned). The merged HTML still lives at the equivalent path inside the
main repo, so re-open every tracked file from there so the user's browser
tab silently picks up the live version.

Skip this step entirely when `$WORKTREE_PATH` was empty in Substep 1 (the ship
ran directly from the main checkout, no path rewrite needed).

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/session-open-tracker.js" reopen-main \
  --worktree="$WORKTREE_PATH"
```

The script:
- Reads `<main-repo>/.claude/session-opened-files.json` (the tracking
  file is anchored at the main repo root so it survives worktree
  cleanup — see `scripts/session-open-tracker.js` for the storage
  contract).
- Filters tracked entries to those that were under `$WORKTREE_PATH`.
- Maps each filtered entry to the main-repo equivalent (`relative
  path within worktree` → `<main-repo>/<relative>`).
- Opens every still-existing file in Edge via the standard
  `start "" msedge "file:///…"` pattern.
- Prints a JSON summary `{ reopened: [...], missing: [...], consumed }`.

Treat the summary as informational. Any entries listed under `missing`
mean the file did not survive the merge (likely deleted during the
session) — that is expected and not a ship failure.

**Background — issue #160.** Without this step, `/ship` silently
invalidates every browser tab that was pointing into the worktree. The
user sees a 404 / blank tab and reasonably concludes the concept page
itself is broken, when in reality the content is fine at the main path.

## Step 5c — Keep-mode cleanup (sentinel only)

**Only runs when Step 5a chose keep-mode.**

Do NOT call `ExitWorktree` — the worktree stays. Do NOT delete the branch.

Call `ship_cleanup` with `keep: true` to clear the ship-in-progress sentinel (so Edit/branch
guards reset) without touching anything else:
```
ship_cleanup({ branch: "claude/feature-branch", base: "main", cwd: "<cwd>", keep: true })
```

Returns `{ success: true, kept: true, cleaned: ["sentinel"], warnings: [...] }`.

The remote branch was deleted by the GitHub merge — that's expected. The next commit + push
in this worktree will re-create it via `git push --set-upstream origin <branch>` automatically.

In Step 6, pass `state.kept: true` and `state.branch: "<feature-branch>"` to
`render_completion_card` so the CTA renders `KEEP CODING in <branch>` / `WEITER in <branch>`
instead of `All DONE` / `Alles ERLEDIGT`.

## Step 6 — Completion Card

Call `render_completion_card` MCP tool (dotclaude-completion server) with data from previous steps.

**CRITICAL — `cwd` is required for clickable links.** Without `cwd`, `getRepoUrl` falls back to the MCP server's own working directory (plugin dir, not your target repo) and the card renders PR/commit/branch as plain text. Always pass the same `cwd` you used for the ship tools.

### Promotion-gap nudge (final ship to main only — MANDATORY)

Deliberate promotion has no heartbeat without a forcing function — invisible
channel lag is how stable rots. Before rendering the card, compute the drift:

```bash
git ls-remote --tags origin
```

- Latest alpha version = highest `alpha/vX.Y.Z` (numeric compare, never lexicographic).
- Latest stable version = highest of `stable/vX.Y.Z` ∪ bare `vX.Y.Z`.
- No channel tags at all (pre-migration repo) → skip silently.

When alpha > stable, append ONE `userFinalTest` item:
- Gap < 3 versions AND last stable tag younger than 7 days (annotated
  taggerdate via `git for-each-ref --format='%(taggerdate:iso)' 'refs/tags/stable/*'`):
  `{ action: "alpha ist N Version(en) vor stable — /promote zum Promoten" }`
- Gap ≥ 3 versions OR ≥ 7 days: escalate the wording:
  `{ action: "⚠ stable ist N Versionen / D Tage hinter alpha — /promote ausführen" }`

Visible lag is the ring model working; the nudge just keeps it visible.

```
render_completion_card({
  variant: "ship-successful",
  summary: "<~10 words, user's language>",
  lang: "de",
  cwd: "<current working directory — same as ship_release>",
  buildId: <from ship_build.buildId>,
  changes: [<top 3 FUNCTIONAL changes — user-perceived effect, phrased as behavior. Derive from ship_build/version_bump results but do NOT list files/modules. See completion-card template § Changes.>],
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
  },
  delivery: {
    pr: { number: <ship_release.pr.number>, title: <PR title> },
    ship: { version: <ship_version_bump.vNew>, base: "main" },
    promote: { channels: { alpha: <ship_version_bump.vNew> }, current: "alpha" }
  }
})
```

**Delivery track (`delivery`).** Populate it so the card shows WHERE in the
pipeline this ship sits (PR → Ship → Promote). `pr` + `ship` are known
post-merge. Add `promote: { channels: { alpha: <vNew> }, current: "alpha" }`
**only for ring-model projects** (plain ship publishes to alpha) — that also
makes the CTA read "SHIPPED → alpha" and shows the channel ladder with beta/
stable still pending. Projects without channels omit `promote`; the track then
just shows PR → Ship, and a later `/promote` renders the `released` card that
advances the ladder to beta/stable.

**Variant reflects what the pipeline DID, not what's verified downstream.**
Once `ship_release` reports `merged` + (where applicable) `tag` + `release`,
the ship **has happened** → render `ship-successful`. Do NOT downgrade to
`ready` just because a downstream auto-deploy isn't confirmed yet (Vercel on
main-push, a tag-triggered build, the Step 4b watcher still running). `ready`
is the PRE-ship variant — its CTA is "SHIP or CHANGE?" — so using it after a
merge is self-contradictory and reads as "nothing shipped". Surface any
pending/unverified downstream as an explicit `userFinalTest` item instead
(e.g. "Vercel-Deploy live verifizieren", "Build run #N läuft — `gh run view N`").
The MCP variant guard already auto-corrects `ship-successful`→`ready` when
`state.merged`/`state.pushed` are falsy, so the only judgement call left to you
is: merged ⇒ `ship-successful`, downstream-still-pending ⇒ `userFinalTest`,
never a variant downgrade. (Project ship-extensions: keep project-specific
downstream surfaces, but don't re-encode this variant rule.)

**Out-of-band deploy gate (from Step 4d).** When Step 4d raised the gate, pass
`state.deployPending: true` and the `deployGate` array to `render_completion_card`.
This is stronger than a `userFinalTest` item: the CTA itself flips to
"🚨 DEPLOY erforderlich (noch nicht live)" and a loud gate block names each
undeployed artifact — so a merged-but-undeployed ship is never mistaken for done.
Undeployed infra is the ONE thing that must not hide behind a green card.
Example:
```
deployGate: [
  { artifact: "supabase/migrations/20260708_token_revoked.sql", kind: "migration", action: "apply_migration" },
  { artifact: "supabase/functions/desktop-latest/index.ts",     kind: "function",  action: "deploy edge function desktop-latest" }
],
state: { branch: "main", pushed: true, merged: "main", commit: "<sha>", deployPending: true }
```

**Keep-mode variant** (Step 5a chose keep, Step 5c ran):
```
render_completion_card({
  variant: "ship-successful",
  summary: "<~10 words — mention 'Worktree behalten' or similar>",
  lang: "de",
  cwd: "<current working directory — still the worktree path>",
  buildId: <from ship_build.buildId>,
  changes: [...],
  tests: [...],
  state: {
    branch: "<feature-branch name, NOT 'main' — the kept branch>",
    worktree: true,
    commit: <from ship_release.commit>,
    pushed: true,
    pr: { number: <from ship_release.pr.number>, title: <PR title> },
    merged: "main",
    kept: true
  },
  cta: { vOld, vNew, bump }
})
```

The renderer flips the CTA from `All DONE` / `Alles ERLEDIGT` to
`KEEP CODING in <branch>` / `WEITER in <branch>` when `state.kept: true`.

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
