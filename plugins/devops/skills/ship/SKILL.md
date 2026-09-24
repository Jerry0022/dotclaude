---
name: ship
version: 0.10.0
description: >-
  Full end-to-end shipping pipeline using MCP tools: ship_preflight, ship_build,
  ship_version_bump, ship_release, ship_cleanup, render_completion_card,
  then silent memory consolidation.
  Supports hierarchical merges (sub-branch → feature → main).
  Use when work is ready to land. Triggers on: "ship it", "push and merge".
  Do NOT trigger during coding/debugging or for commits without shipping.
layer: 2
invokes: [tune-polish]
triggers:
  en: ["ship it", "push and merge"]
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(node *), Bash(bash *), Bash(nohup *), Read, Glob, Grep, AskUserQuestion, ExitWorktree, TaskList, TaskCreate, TaskUpdate, Skill, mcp__plugin_devops_dotclaude-ship__*, mcp__plugin_devops_dotclaude-completion__*, mcp__plugin_devops_dotclaude-issues__*, mcp__ccd_session_mgmt__get_session, mcp__ccd_session_mgmt__set_session_title
---

# Ship

Ship completed work via PR using the `dotclaude-ship` MCP server tools.
Supports two modes: **direct** (branch → main) and **intermediate** (sub-branch → feature branch).

> **CRITICAL — `cwd` is required on every MCP tool call.**
> The ship MCP server runs in the plugin directory, NOT the target repo.
> Every `ship_*` tool call MUST include `cwd` set to the current working directory of this Claude session.
> Omitting `cwd` will cause the tool to operate on the wrong repository.

## Composed ships — `--cwd`, `--keep`, `--queued`, the queue marker

`/ship` is also invoked by orchestrators that land **several** PRs from ONE
session (`/setup-cleanup` Step 10b ships every selected open PR this way;
`/run-backlog` ships every queued issue). Three arguments and one marker make
that safe; a plain `/ship` with no arguments behaves exactly as before.

| Signal | Effect on this run |
|---|---|
| `--cwd=<path>` | **Target directory override.** Every `ship_*` MCP call passes this path as `cwd`, every git/gh command runs with `git -C <path>` / inside it. The branch that ships is the one checked out THERE, not this session's own. Pre-Step B (session activity) and Pre-Step C (sidebar title) still refer to this session; `ExitWorktree` is **never** called (it would act on this session's worktree, not the target) — the orchestrator owns the target's teardown, so `--cwd` implies `--keep`. |
| `--keep` | Keep-mode (Step 5a signal 4): no branch or worktree teardown, `ship_cleanup({ keep: true })` only clears the sentinel. |
| `--queued` | This ship is one of several in a queue. Informational: the card `summary` gets a `(Queue n/N)` suffix when the orchestrator passes `--queued=n/N`, and a `ship-blocked` outcome is expected to be *parked* by the caller, not retried here. |
| `.claude/.ship-queue` marker in the target repo root (`{ owner, since }`) | Written by the orchestrator before its first ship, deleted after its own finalizer. Project ship extensions MUST skip any post-ship step that mutates this install (plugin self-sync, cache rebuild, MCP restart) while it exists — the orchestrator runs that step exactly once at the end. Not a lockout: `AskUserQuestion` gates stay interactive unless Pre-Step A says otherwise. **Stale rule:** a marker whose `since` is older than 6 h belongs to a queue that died; a plain `/ship` (no `--queued`) deletes it and proceeds as if absent, so one crashed cleanup run never defers finalizers forever. |

| `--no-compact` | Skip the careful-compact stop for this one ship (below). Parsed and dropped — it changes nothing else. |

Parse these from the skill arguments first; then continue with Pre-Step A.

## Pre-Step 0 — Careful compact (the hook decides, this skill obeys)

A ship runs ~16 API calls, each re-reading the whole context, at the end of a
session when that context is largest (measured 2026-09-21: Ø 434 k tokens per
call, ~24 % of a session's tokens). Nothing in Claude Code lets a skill or hook
compact the context — only the user can, with `/compact`. So
`prompt.ship.detect` measures the context on every ship prompt and, above
`DOTCLAUDE_SHIP_COMPACT_THRESHOLD` (default 350 k tokens, `0` disables), emits a
`[ship-compact]` block instead of the ship instruction. It never fires twice
in a row: the ship prompt right after an advice is the user's answer and runs.

**If that block is in this turn's context: stop here.** Run nothing — no
Pre-Step, no `ship_*` call, no git — and end the turn with the completion card
the block names (`variant: "ship-blocked"`, `compact: { tokens }`). The card
shows the saving and the full `/compact` command as text; on Desktop its one
button puts `ship --no-compact` into the input box. The user either compacts
and types `/ship` again (the hook sees the compaction and lets it through), or
ships without compacting (the button, or simply `/ship` again).
Ships reached through the Skill tool by an orchestrator (`/run-backlog`,
`/setup-cleanup`) never see the block — the hook only reads user prompts.

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
| Step 1d — standing UI-rule finding (`/tune-polish --invoked-by=ship`) | mechanical → fix; else `userFinalTest` (never asks) | same: mechanical → fix; else **RECORD & CONTINUE** — never BLOCK |
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

## Pre-Step C — Mark the session in the sidebar

A ship takes minutes (CI wait, rebase loop) and a session that is mid-pipeline
looks like any other idle session from the sidebar. Mark it the way `/concept`
and `/claude-batch` do — the prefix strings are pinned in
`mcp-server/lib/mode-state.js` (`SESSION_PREFIX`) next to the card emojis:

1. `mcp__ccd_session_mgmt__get_session` with `session_id: "self"` → `title`.
2. If the title already starts with `🚀 Shipping – `: done — `prompt.flow.title-work`
   marks a ship prompt itself (same classifier as `prompt.ship.detect`), so a
   `/ship` typed by the user arrives here already marked. Only a ship reached
   another way (an affirmation after a card, a queue in `/setup-cleanup` or
   `/run-backlog`) still needs steps 3–4.
3. Strip any leading devops prefix (`🚀 Shipping – `, `🚀 Shipped – `, `🧪 Test – `,
   `📦 Ready – `, `⛔ Blocked – `, `⏳ `, … — the `SESSION_PREFIX` values) left by an earlier card or
   ship in this session — never stack them.
4. `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"` and
   `title: "🚀 Shipping – {stripped title}"`.

The bare `⏳ ` is the fallback for "being worked on", never the override: no
hook or skill replaces a running `🚀 Shipping – ` with it (design § 7).

**Both tools exist only in the Desktop app.** In a terminal session, an
unattended run, or when the call fails for any reason: skip silently — no
retry, no note to the user, no fallback. The rename is a courtesy, never a
gate. The completion card's `[SESSION TITLE]` block replaces the prefix with
the outcome (`🚀 Shipped – ` / `⛔ Blocked – `, see Step 6); never restore a
remembered title by re-typing it.

> **Sentinel hygiene (every exit path).** `ship_preflight` writes a
> ship-in-progress sentinel that makes the main-branch Edit guards
> (`pre.main.guard` / `pre.edit.branch`) stand down for the ship's duration. It is
> cleared by `ship_cleanup` on a *successful* ship — but a **ship-blocked / abort**
> return (any `render_completion_card` variant `ship-blocked` below) skips cleanup
> and would leave the sentinel stranded, silently disarming main-branch protection
> until it ages out. **Rule:** before rendering ANY `ship-blocked` card, first call
> `ship_cleanup({ branch, cwd, keep: true })` — keep-mode deletes no branch/worktree,
> it only clears the sentinel so main-branch protection resumes immediately.
> The `ship-blocked` card's `[SESSION TITLE]` block then swaps the sidebar prefix
> to `⛔ Blocked – ` (Step 6 → *Session title on exit*).

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

If the `ToolSearch` result contains all five `<function>` entries, proceed. If ANY are missing from the returned block, the server is genuinely not registered — do NOT fall back to `gh pr create` (the guard hook blocks it). When the session reminder shows the server as **failed to connect** (`Connection closed`), run the cache diagnosis in `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md → When the server is genuinely down` before reporting: a cache that lost its `*.js` files is the usual cause and is repairable in-session.

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

The tool checks: clean tree, commits ahead, all pushed, version consistency (skipped for intermediate), worktree detection, and unresolved conflict markers (`no-conflict-markers`).

**Dirty tree from untracked files: fix the source, never park and restore.**
The Desktop app refuses to archive a session whose worktree is dirty, and it
copies the main checkout's untracked `.claude/` into every new worktree. An
untracked file moved aside so preflight passes and put back after the merge
blocks the archive — observed with `.claude/graphify.json` (2026-09-23). Settle
each file where it belongs, inside this ship:
- **Plugin configuration** (`.claude/graphify.json`, `settings.json`, the rest
  of the *MUST be tracked* list in `skills/setup-project/SKILL.md` § 2.2) →
  commit it. Include it in the ship when it matches the main checkout's copy.
- **Plugin runtime state** → add it to the ignore block (`/setup-project`) or
  delete it when it is a stray hook artifact (e.g. a `.claude/` created in a
  subdirectory).
A harness-created worktree must end Step 5c with an empty `git status --porcelain`.

The marker check has two scopes. A marker in the files **this ship would land** is a hard error — `ship_release` re-scans immediately before committing, so one left behind by the rebase in 1b is caught there too. A marker anywhere else in the repo is a **warning**: it predates this branch, so report it and open a separate fix rather than holding an unrelated release hostage.
Merge-safety issues (`base-ahead`, `file-overlap`, `config-conflictstyle`) are **warnings, not errors** — they are resolved autonomously below.

### 1a-ii. Read `mode` — the repo-mode fork

`ship_preflight` returns a `mode` field. **Read it.** It decides which of the
steps below can run at all, and ignoring it is how a ship in a repo-less
project marched into rebase/push/PR and reported a merge that never happened.

| `mode` | What it means | How the pipeline changes |
|---|---|---|
| `git` | Repo with an origin | Full pipeline, nothing changes. |
| `git-no-remote` | Local repo, no origin | Everything up to and including the **commit** runs. `ship_release` commits and then stops; push, PR, merge, tag and release are skipped and reported as skipped. |
| `file-only` | Not a git repo at all | Everything that is not a git action still runs — see below. |

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
      - Write the resolved file, then `git add <file>` — with **all four** marker
        lines removed, `|||||||` included. Deleting the familiar three and
        leaving the diff3 base marker is the failure `no-conflict-markers` exists
        for; it blocks the ship at Step 4 rather than landing on main.
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

**Standing UI rules (part of the Light check).** Besides the conventions
mined from recent PRs, every project has the standing UI conventions in
`{PLUGIN_ROOT}/deep-knowledge/ui-defaults.md` (tooltips, dropdowns, spacing,
hotkeys — plus the project's `## UI rules` override in
`.claude/skills/tune-polish/reference.md`). When the diff contains UI files
(`ui-defaults.md` § UI file detection), invoke the **rules-only path** of
tune-polish — `/tune-polish --invoked-by=ship <ui files of the diff>` (the
Skill tool, same as every other skill composition here) — and treat what it returns exactly like the other 1d findings:
- `applicable: false` (no UI files, no UI profile) → nothing; no card entry.
- `mechanical: true` findings → apply the one-line fix, list under `changes`.
- every other finding → a `userFinalTest` item naming rule, file:line and
  what to check.
- `disabled` / `notApplicable` ids → one `tests` line for the card
  ("UI-Regeln: 2 Findings · R2b deaktiviert (Projekt-Override) · R4 n/a").
The rules-only path is static, diff-only, runs no agents and no browser, and
returns no card of its own; the runtime halves of the rules are a full
`/tune-polish` matter and are never attempted here. **Priority:** a more
recent project convention from the mined PRs beats a standing rule — the
convention is a decision, the rule a default. This check never blocks a ship.

**If `$SHIP_LOCKOUT` (Pre-Step A):** still apply the mechanical fixes; for the
high-impact conflicts do not ask — **RECORD & CONTINUE** (fold each into a
`userFinalTest` item for Step 6). This gate never blocks the ship on its own.

Skip silently when: `mode: "file-only"`, no purpose sources found, or the diff
is clearly out of scope for every gathered purpose. The standing-UI-rules part
additionally skips when the diff touches no UI file.

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
2. Evaluate by exit code (see `{PLUGIN_ROOT}/deep-knowledge/codex-integration.md` "Hard Timeout & Failure-Tolerance"):
   - **rc=0, no findings / clean** → continue to Step 3
   - **rc=0, auto-fixable** (typos, missing imports, style) → fix inline, continue
   - **rc=0, judgment required** (design concerns, logic flaws, security) →
     AskUserQuestion with findings + options: "Fixen", "Ignorieren", "Abbrechen".
     **If `$SHIP_LOCKOUT` (Pre-Step A):** do not ask — **BLOCK** (`ship-blocked`,
     naming the finding). A design/logic/security concern must not merge
     unreviewed unattended; the caller parks the issue for the user.
   - **rc=75** (Codex usage limit — stored per user, or just hit) → continue to Step 3 immediately; card `tests` line `{ method: "Codex-Review", result: "übersprungen — Limit bis <reset time from stderr>" }`. The wrapper skips Codex on its own until that time; the first ship after it runs Codex again. Do NOT retry. If the user says Codex is usable again before then (plan bought, limit raised), run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-safe.sh" --reset-limit` once, then call the gate normally.
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

Returns: `{ branch, commit, rebased, pushed, pr: {number, url}, checks: {status, passed, failed, pending}, merged, mergeSha, mergeVerified?, mergeWarning?, mergeStrategy, intermediate, tag, channel, tagVerified, releaseDeferred, postMergeTreeMatch, postMergeWarning, postMergeError?, titleClamped }`.

**Merge and tag are reported separately (#398).** The merge is the one
irreversible step, so once it landed the result ALWAYS carries `merged` +
`mergeSha` — even when a later step failed. Read the fields in this order:

- `merged` present → the PR IS on base. Never retry `ship_release` for the same
  branch (double-ship) and never conclude "nothing happened" from `success: false`.
- `mergeSha: null` + `mergeWarning` → merged, but the merge commit could not be
  read back (slow fetch); `mergeVerified: false` → merged, but `gh pr view`
  never confirmed it. Both are warnings for the card, not failures.
- `success: false` **with** `merged` + `postMergeError` → a post-merge step
  (tree guard, local sync, tagging) threw. The ring state is in the tag fields:
  `tagSkipped: true` + `tagWarning` means `alpha/<tag>` was NOT created and must
  be created by hand on `mergeSha` — surface it as a `userFinalTest` item.
- `tagError` → tag creation/push failed after its own retries; the ship is still
  `success: true` (tag trouble never fails a landed merge), but the card must
  show the ring gap.

**Two other return shapes exist and must not be mistaken for the one above.**
Both set `success: true` — success means "the tool did what it could", NOT
"the work reached main":

- `{ success: true, skipped: true, reason: "file-only-mode", delivered: "none" }`
  — not a git repo. Nothing was committed, and there was nothing to commit to.
- `{ success: true, skipped: true, reason: "no-remote", delivered: "local-commit-only", commit, pushed: false, merged: null }`
  — local repo without an origin. The commit **did** happen; push/PR/merge did not.

In both, `merged` is absent or `null`. **Never read `success: true` alone as a
merge.** Always check `merged` before reporting one, and check `skipped` before
continuing to any step that assumes a remote.

**A third shape is a transient failure, not a mode:**
`{ success: false, reason: "git-probe-timeout", delivered: "none", error }` —
the repo-mode probe (`git rev-parse`) did not answer within its budget on a
loaded machine. `ship_preflight` reports the same case as `mode: "unknown"`,
`ready: false`, and `ship_cleanup` as `reason: "git-probe-timeout"` with the
sentinel kept. Nothing happened; **retry the same call once** — do not read it
as file-only (that was the 2026-09-18 failure: a real repo got a skipped
`success: true` and the ship silently never ran). A second timeout → BLOCK
(`ship-blocked`, "git unresponsive — machine under load").

**If `titleClamped` is set**: the PR title exceeded the 70-char budget and was cut on a word boundary — the ship proceeded, it is not an error. The field carries `{ original, applied, max }`. Aim for a shorter title next time; surface it only if the clamped subject reads badly.

**Ring model (channels):** the tag is `alpha/vX.Y.Z` — every ship publishes to
the EARLIEST channel autonomously. beta/stable tags and GitHub Releases are
created later by `/promote` (deliberate promotion, same SHA, no rebuild).
Pass the bare `tag: "vX.Y.Z"` (the tool prefixes the channel) — or **omit
`tag`** and the tool derives `v<version>` from the version file `ship_version_bump`
just wrote (result carries `tagDefaulted: true`). Only an explicit `tag: null`
skips the ring tag, and even then the result says so: `tagSkipped: true` +
`tagWarning` (main is ahead of every ring, `/promote` has nothing to promote) —
surface that warning as a `userFinalTest` item, never render an all-green card
over it (#372). See `docs/superpowers/specs/2026-07-11-tag-channel-system-design.md`.

**Pre-merge CI gate** (default ON): after PR create, `ship_release` runs `gh pr checks --watch` (default 600s timeout). If checks fail or timeout → `success: false`, `checksBlocked: true`, PR stays open, branch not deleted. Render `ship-blocked` card with the failing check names + run URLs.

- Hot-fix bypass: pass `skipChecks: true` or set `DEVOPS_SHIP_SKIP_CHECKS=1`. Result records `checks.status: "skipped"` so the card flags it.
- Tune timeout per call: `checksTimeoutSec: <30..3600>`.
- See `deep-knowledge/quality-gates.md → Pre-Merge CI Checks Gate` for the full state matrix.

**If `rebaseRequired: true`**: the branch is not rebased onto base. Go back to Step 1b and rebase before retrying. This also fires as `baseAdvancedDuringChecks: true` when a **parallel ship landed on base while we waited for CI** — the PR is left open and unmerged (no silent overwrite). Same action: rebase + retry, then re-run the **Step 1d full check** before the retry: a parallel ship just landed, and its purpose may impose obligations on this branch (see `deep-knowledge/purpose-alignment.md`). See `{PLUGIN_ROOT}/deep-knowledge/merge-safety.md → How ship_release Prevents Overwrites`.

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

See `{PLUGIN_ROOT}/deep-knowledge/skill-extension-guide.md -> Delivery targets` for reference.md examples.

## Step 4b — Spawn Post-Merge Watcher (final ship only)

**Skip this step for intermediate merges** — only relevant when shipping to main.

**Also skip it whenever `merged` is absent or null** — that is the `file-only`
and `git-no-remote` case, where no merge happened and there is no GitHub
Actions run to wait for. Gate on `merged`, never on `success` alone: both
skipped shapes return `success: true`.

After `ship_release` returns `success: true` **and** `merged: "main"`, spawn the post-merge
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
and the `ss.ship.verify` hook — reading the same main-repo dir from ANY worktree,
never the worktree's seeded copy — surfaces unack'd results once at the next
SessionStart. On failure, a best-effort Windows toast fires immediately.

The watcher is a plugin `scripts/` CLI and is orphaned on purpose; the MCP reaper
(`hooks/lib/mcp-reaper.js`) exempts that class, so a Stop/SessionStart reap never
kills it mid-wait.

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
   `{PLUGIN_ROOT}/deep-knowledge/browser-tool-strategy.md` (Claude-in-Chrome in Edge first).
   This is a live post-deploy read — see `{PLUGIN_ROOT}/deep-knowledge/test-autonomy.md`.
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

**Harness-created worktree → keep-mode, always (#442).** In a Claude Desktop (Code tab)
session the worktree is created by the app, not by `EnterWorktree`: `ship_preflight`
reports `inWorktree: true` and this session never called `EnterWorktree`. There
`ExitWorktree` is a no-op, `ship_cleanup` refuses ("attached to an active worktree"),
and the app owns the worktree lifecycle (auto-archive removes worktree + branch). Decide
this up front — before the signals below — and go straight to Step 5c: `ship_cleanup({
keep: true })`, normal DONE CTA (no `state.kept`, see 5c). The remote branch was
already deleted by `ship_release` (`remoteBranchDeleted`); the local branch and
worktree are the app's to remove. **Never print git commands for the user to run after
a ship** — no "close the session, then `git worktree remove …`" note, ever.

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

**If `--cwd` was given** (composed ship): this substep does not apply — `--cwd`
implies keep-mode, and `ExitWorktree` would remove *this session's* worktree, not
the target's. Go to Step 5c.

**If in a worktree this session entered via `EnterWorktree`**: call `ExitWorktree(action: "remove")`
FIRST to release the CWD lock. (A harness-created worktree never reaches this substep — Step 5a
routed it to 5c.)

If `ExitWorktree` **fails** (e.g. directory locked by another process): **STOP**. Do not proceed to cleanup.
Report the error to the user. The merge already landed on GitHub — cleanup can be retried later.

**If `ExitWorktree` returns a No-op** (the worktree was created outside this session after all):
do **NOT** force-remove the directory the session lives in — that would break the session. Fall
back to Step 5c (`ship_cleanup({ ..., keep: true })`, normal DONE CTA, no `state.kept`) and
stay silent about it: the remote branch is gone (`ship_release`), the local leftovers are the
app's or `/setup-cleanup`'s job. Never hand the user git commands to run.

Then call `ship_cleanup` MCP tool with the `base` from Step 1 (always pass `cwd`):
```
ship_cleanup({ branch: "claude/feature-branch", base: "main", cwd: "<cwd>" })
```

For intermediate merges:
```
ship_cleanup({ branch: "feat/42-video-filters/core", base: "feat/42-video-filters", cwd: "<cwd>" })
```

The tool deletes the sub-branch but **preserves the feature branch** for further sub-branch merges or final ship to main.

The tool refuses to run inside a worktree — its error names the way out for each worktree kind
(harness-created → `keep: true`; `EnterWorktree` → `ExitWorktree` first).

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

**Runs when Step 5a chose keep-mode — deliberately (follow-up work expected) or because the
worktree is harness-created (Claude Desktop, #442).**

Do NOT call `ExitWorktree` — the worktree stays. Do NOT delete the branch.

Call `ship_cleanup` with `keep: true` to clear the ship-in-progress sentinel (so Edit/branch
guards reset) without touching anything else:
```
ship_cleanup({ branch: "claude/feature-branch", base: "main", cwd: "<cwd>", keep: true })
```

Returns `{ success: true, kept: true, cleaned: ["sentinel"], warnings: [...] }`.

Harness-created worktree: run `git status --porcelain` afterwards. Anything
listed blocks the Desktop archive — settle it per Step 1a (*Dirty tree from
untracked files*) before the card, never by restoring a parked copy.

The remote branch is gone either way — deleted by the GitHub merge (`--delete-branch`)
outside a worktree, by `ship_release` itself inside one (`remoteBranchDeleted: true`; it
also drops the stale remote-tracking ref so the next lease-pinned push is not rejected).
The next commit + push in this worktree re-creates it via
`git push --set-upstream origin <branch>` automatically. A `remoteBranchWarning` in the
release result means the delete failed: surface it as one `open` item on the card
("Remote-Branch `<branch>` konnte nicht gelöscht werden — /setup-cleanup"), nothing else.

In Step 6:
- **Deliberate keep** (follow-up work expected): pass `state.kept: true` and
  `state.branch: "<feature-branch>"` so the CTA renders `KEEP CODING in <branch>` /
  `WEITER in <branch>` instead of `All DONE` / `Alles ERLEDIGT`.
- **Harness-created worktree** (keep only because the app owns the teardown): render the
  **normal** DONE CTA — no `state.kept`, no cleanup note. The `WEITER in <branch>` CTA is
  reserved for expected follow-up work; a worktree kept because nobody else may remove it
  must not read as "keep coding here".

## Step 6 — Completion Card

Call `render_completion_card` MCP tool (dotclaude-completion server) with data from previous steps.

**CRITICAL — `cwd` is required for clickable links.** Without `cwd`, `getRepoUrl` falls back to the MCP server's own working directory (plugin dir, not your target repo) and the card renders PR/commit/branch as plain text. Always pass the same `cwd` you used for the ship tools.

### Session title on exit (carried by the card result)

Pre-Step C put `🚀 Shipping – ` on the session title. The outcome prefix is
**not** chosen here: `render_completion_card` returns a `[SESSION TITLE]`
block next to the card markdown (stderr on the `--render-card` CLI path) that
names the prefix for the variant rendered — execute it **before** outputting
the card (the card stays the last output of the turn). What it resolves to:

| Outcome | Title |
|---------|-------|
| `ship-successful` — final (`state.merged` = main, normal **or** keep-mode) or intermediate ship (feature branch) | `🚀 Shipped – {title}` — the finished form of `🚀 Shipping – `; the next card that ends a turn replaces the marker |
| `ship-blocked` (any gate, build, checks, PR not merged) | `⛔ Blocked – {title}` — same emoji as the card headline |

The block also strips a stale `🚀 Shipping – ` when the title carries one. A
title with none of the devops prefixes is left untouched — the user renamed it
meanwhile, and that name wins. Desktop app only; skip silently elsewhere or on
any failure.

### Promotion-gap nudge (final ship to main only — MANDATORY)

Deliberate promotion has no heartbeat without a forcing function — invisible
channel lag is how stable rots. Before rendering the card, compute the drift:

```bash
git ls-remote --tags origin
```

- Latest alpha version = highest `alpha/vX.Y.Z` (numeric compare, never lexicographic).
- Latest stable version = highest of `stable/vX.Y.Z` ∪ bare `vX.Y.Z`.
- No channel tags at all (pre-migration repo) → skip silently.

When alpha > stable, pass the gap as `delivery.promote.stableLag`:
- `{ versions: N }` — gap < 3 versions AND last stable tag younger than 7 days
  (annotated taggerdate via
  `git for-each-ref --format='%(taggerdate:iso)' 'refs/tags/stable/*'`).
- `{ versions: N, days: D }` — gap ≥ 3 versions OR ≥ 7 days.

The card renders it on the channel ladder line
(`🟢 alpha \`v0.27.0\` · ⚪ beta · ✅ stable \`v0.19.0\` · alpha 8 Versionen / 7 Tage vor stable → \`/promote\``).
It is NOT a `userFinalTest` item — it is not a test — and NOT an `open` item.
Visible lag is the ring model working; the nudge just keeps it visible.

```
render_completion_card({
  variant: "ship-successful",
  summary: "<≤ 8 words / 60 chars, user's language: WHAT changed for the user. No version, no 'gemergt/geshipped/live' — the Delivery block and the CTA say that.>",
  lang: "de",
  cwd: "<current working directory — same as ship_release>",
  buildId: <from ship_build.buildId>,
  changes: [<top 3 FUNCTIONAL changes — user-perceived effect, phrased as behavior; area ≤ 24, description ≤ 90 chars (one line each). Derive from ship_build/version_bump results but do NOT list files/modules. See completion-card template § Changes.>],
  tests: [<from ship_build results — the automated GATES, one line each: { method: "npm test", result: "1460 grün" }. Numbers, not prose; include skipped/non-green gates ("Codex-Review → übersprungen — Limit") and, when Step 1d ran the UI rules, one line { method: "UI-Regeln", result: "2 Findings · R2b deaktiviert" } — omitted entirely when the diff had no UI files. Rendered on the header line(s) under **Geprüft**.>],
  validation: [<requirement ≤ 70 → evidence ≤ 100 chars; partial/unmet items first. Long-form evidence belongs in the PR body.>],
  userFinalTest: [<ONLY real manual tests the user must run>],
  open: [<decisions, cleanups, open questions — NOT tests: "feat/x liegt 70 PRs hinter main — committen oder verwerfen?">],
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
    promote: { channels: { alpha: <ship_version_bump.vNew>, stable: <latest stable or null> }, current: "alpha",
               stableLag: <from the promotion-gap nudge above, omit when alpha == stable> }
  }
})
```

The card renders `delivery` as ONE block at the foot of the body (PR · base +
bump · commit · build-id · channel ladder) and drops the separate 📌 footer and
state line — every pipeline fact appears once. `ship.version` must be the
semver from the bump, never a commit SHA.

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
  cta: { vOld, vNew, bump },
  delivery: { pr, ship: { version: vNew, base: "main" }, promote: { channels: { alpha: vNew }, current: "alpha" } }
})
```

The renderer flips the CTA from `All DONE` / `Alles ERLEDIGT` to
`KEEP CODING in <branch>` / `WEITER in <branch>` when `state.kept: true`, and
names the kept branch on the Delivery ship line (`· \`feat/x (kept locally)\``).

Output the card markdown VERBATIM — card is the last **visible** output, nothing after closing `---`.

**No recap before the card.** The card (on Desktop: the widget) is the ship
summary — never restate in prose what it already shows: changes, tests, skipped
checks, version, PR, open items, a restart hint. Everything of that belongs in
the card fields (`tests`, `open`, `userFinalTest`, …). Text before the card only
for what the card cannot carry: answers to side questions or other topics of the
user's prompt, points beyond the card's three, and hook blocks that are still
marked for the user and still true (a session-start finding this ship resolved
is dropped, not restated with an "outdated" note).

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
