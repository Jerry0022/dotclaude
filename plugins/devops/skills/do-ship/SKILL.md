---
name: do-ship
version: 0.15.0
description: >-
  Full end-to-end shipping pipeline using MCP tools: ship_preflight, ship_build,
  ship_version_bump, ship_release, ship_cleanup, silent memory consolidation,
  then render_completion_card as the last action.
  Supports hierarchical merges (sub-branch → feature → main).
  Use when work is ready to land. Ships to alpha; naming beta or stable
  ("ship stable", "promote to beta", "auf stable heben") ships anything
  unshipped first, then promotes by re-tagging the SAME commit via
  ship_promote (formerly the promote skill) — never rebuilds, never bumps,
  never autonomous. Runs auto-harden and auto-polish diff-scoped at ship.
  Do NOT trigger during coding/debugging, for commits without shipping, or
  for plugin updates (/auto-update).
  Triggers on: "ship it", "push and merge", "release", "promote", "promotion",
  "channel release", "auf stable heben", "promote to beta", "promote to stable".
layer: 3
invokes: [auto-harden, auto-polish]
triggers:
  en: ["ship it", "push and merge", "release", "promote", "promotion", "channel release", "promote to beta", "promote to stable"]
  de: ["auf stable heben"]
argument-hint: "[beta|stable|promote] [<version>] [--cwd <path>] [--keep] [--queued] [--delegated] [--inline]"
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(node *), Bash(bash *), Bash(nohup *), Read, Glob, Grep, AskUserQuestion, ExitWorktree, Agent, SendMessage, TaskList, TaskCreate, TaskUpdate, Skill, mcp__plugin_devops_dotclaude-ship__*, mcp__plugin_devops_dotclaude-completion__*, mcp__plugin_devops_dotclaude-issues__*, mcp__ccd_session_mgmt__get_session, mcp__ccd_session_mgmt__set_session_title, mcp__ccd_session_mgmt__archive_session
---

# Ship

Ship completed work via PR using the `dotclaude-ship` MCP server tools.
Supports two modes: **direct** (branch → main) and **intermediate** (sub-branch → feature branch).

> **`cwd` is required on every MCP tool call.** The ship MCP server runs in the
> plugin directory, not the target repo. Every `ship_*` tool call MUST include `cwd`
> set to this session's working directory, or it operates on the wrong repository.

## Pipeline at a glance

The map of one run; each step's full rules are further down.

| Step | What | Call | Ends the run when |
|---|---|---|---|
| Pre-Steps 0, R, A–C | delegate, resume, lockout, session activity, sidebar title | `autonomous-lockout.js check --ship` | activity pending (ask; BLOCK under lockout) |
| 0 / 0.5 | extensions, Codex detection, ship tool schemas | `ToolSearch select:…` | server skipped → same steps via `mcp-server/ship/cli.js`; tools absent → `deep-knowledge/manual-ship.md` |
| 1 | preflight + rebase loop, purpose alignment, harden/polish passes | `ship_preflight` | `ready: false`; ambiguous conflict |
| 2 | build + Codex gate | `ship_build`, `codex-safe.sh` | build red; Codex judgment (ask; BLOCK under lockout) |
| 2.5 / 2.6 | deploy-parity build (background), docs-sync | `deploy-parity.js` | parity `failed` |
| 3 | CHANGELOG + bump (final ship to main only) | `ship_version_bump` | `success: false`; major (ask; BLOCK under lockout) |
| 4 | commit, PR, CI, merge, alpha tag | `ship_release` | `success: false` without `merged` |
| 4a–4d | delivery hook, watcher, live surfaces, out-of-band deploy gate | — | never (card fields) |
| 5a–5c | keep-mode decision, cleanup | `ship_cleanup` | `ExitWorktree` fails |
| 5d | promote (beta/stable named by the user) | `ship_promote` | never (guard error → `open` item) |
| 5e, 6 | memory dream, promotion gap, hygiene, card — the last action | `ship_hygiene`, `render_completion_card` | — |

Every `ship-blocked` exit calls `ship_cleanup({ keep: true })` first (Pre-Step C → *Sentinel hygiene*).

**After a context compaction mid-ship** Claude Code keeps only the first 5,000
tokens of this skill — roughly everything from Step 0 on is gone from context. Before
the next ship step, re-invoke `Skill("devops:do-ship", "--resume")`: Pre-Step R
skips what landed and the full text is back. Never finish a ship from this
table alone.

## Target channel — alpha by default, beta / stable on request

A ship always lands on **alpha**. Naming a higher channel means "ship if
anything is unshipped, then promote".

**Read the target** from the skill arguments first — `prompt.ship.detect`
passes it (`beta`, `stable`, `promote`, optionally a version: `stable 0.171.0`)
— else from the user's own prompt: "ship stable", "promote to beta",
"release beta", "auf stable heben", "stable promoten", `/do-ship stable`,
`/do-ship promote`, the pre-PR-2 `/promote`, the card's Promote beta / Promote stable buttons. A
channel counts only as the object of ship/promote/release/heben ("the stable
API" is no request). Several named → the highest.

| Unshipped work on this branch? | Channel | Run |
|---|---|---|
| any | a promotion that names a **version** (`stable 0.193.0`, `promote 0.193.0`, every card button) | **promotion only** of exactly that version — never ship first, even with unshipped work (a stale card click must not ship edits made after the card); unshipped work stays and is named as an `open` item "Ungeshippte Änderungen nicht mitgenommen — Promotion von v<version> ohne Ship" |
| yes | none / alpha | the pipeline below, unchanged |
| yes | beta / stable | the pipeline below to alpha, then **Step 5d** promotes the version just shipped; ONE `released` card (Step 6) |
| no | beta / stable / bare `promote` | **promotion only**: Pre-Step A, then `modes/promote.md` Steps 0–4 — no preflight, no build, no passes |
| no | none / alpha | the pipeline below (preflight reports "nothing to ship", as before) |

A **negated** channel ("ship, aber nicht auf stable", "don't promote to
stable", "ohne promote") is no channel — a plain ship to alpha
(`hooks/lib/ship-intent.js` is the parser). A version counts only next to
the promotion phrase ("promote stable 0.170.2", "0.170.2 auf stable");
"promote stable, fixes 0.170.2 regression" names none.

"Unshipped" = tracked changes, or commits whose files still differ from the
default branch (`git diff --name-only origin/<base>...HEAD` non-empty AND
`git diff --quiet origin/<base> HEAD -- <those files>` fails) — a content
check, so a squash-merged keep-mode branch counts as shipped
(`hooks/lib/ship-unshipped.js` is the same test).

**Promotion stays a user decision.** The channel word the user typed IS that
decision — no extra confirmation. Never promote on a channel that did not
come from the user: arguments an orchestrator passes (`--queued`, `--cwd`,
`/do-run backlog`, auto-cleanup) and any `$SHIP_LOCKOUT` run skip the
promotion and name it as an `open` item. A bare "promote" (no channel) asks
which promotion (`modes/promote.md` Step 2). All `ship_promote` guards stay
final (monotonicity, ancestry, immutability — `modes/promote.md` Step 3).

## Composed ships — `--cwd`, `--keep`, `--queued`, the queue marker

Orchestrators that land several PRs from one session (auto-cleanup Step 10b,
`/do-run backlog`) pass these; a plain `/do-ship` without them is unchanged.

| Signal | Effect on this run |
|---|---|
| `--cwd=<path>` | **Target directory override.** Every `ship_*` MCP call passes this path as `cwd`, every git/gh command runs with `git -C <path>` / inside it, and both Step 1e passes get `--cwd=<path>`. The branch that ships is the one checked out THERE, not this session's own. Pre-Step B (session activity) and Pre-Step C (sidebar title) still refer to this session; `ExitWorktree` is **never** called (it would act on this session's worktree, not the target) — the orchestrator owns the target's teardown, so `--cwd` implies `--keep`. |
| `--keep` | Keep-mode (Step 5a signal 4): no branch or worktree teardown, `ship_cleanup({ keep: true })` only clears the sentinel and the lockout marker. |
| `--queued` | This ship is one of several in a queue. The card `summary` gets a `(Queue n/N)` suffix when the orchestrator passes `--queued=n/N`, a `ship-blocked` outcome is expected to be *parked* by the caller, not retried here, and Step 6 skips `ship_hygiene` — the orchestrator decided what stays. |
| `.claude/.ship-queue` marker in the target repo root (`{ owner, since }`) | Written by the orchestrator before its first ship, deleted after its own finalizer. Project ship extensions MUST skip any post-ship step that mutates this install (plugin self-sync, cache rebuild, MCP restart) while it exists — the orchestrator runs that step exactly once at the end. Not a lockout: `AskUserQuestion` gates stay interactive unless Pre-Step A says otherwise. **Stale rule:** a marker whose `since` is older than 6 h belongs to a queue that died; a plain `/do-ship` (no `--queued`) deletes it and proceeds as if absent, so one crashed cleanup run never defers finalizers forever. |
| `--delegated` | This run is the fresh-context subagent of a delegated ship (Pre-Step 0). Follow `modes/delegated.md` → *Subagent*: gates return a decision instead of asking, the card comes back as JSON. |
| `--resume` | Continue an interrupted ship from its checkpoint (Pre-Step R). Sent by `prompt.ship.detect`'s `[ship-resume]` block when the user continues ("weiter", "continue", a ship prompt) and a ship stopped half-way. |
| `--inline` (old: `--no-compact`) | Keep this one ship in the main context even when the context is large (Pre-Step 0). Parsed and dropped — it changes nothing else. |

Parse these from the skill arguments first; then continue with Pre-Step A.

## Pre-Step 0 — Large context: ship in a subagent (the hook decides, this skill obeys)

Above `DOTCLAUDE_SHIP_DELEGATE_THRESHOLD` (default 250 k tokens, `0` turns it off)
`prompt.ship.detect` emits a `[ship-delegate]` block instead of the inline mandate
(why — about 25 calls, each re-reading the largest context of the session: `modes/delegated.md`).
A do-ship Skill call in such a context gets the same block from `pre.ship.delegate`
as the refusal of that call.

**If that block is in this turn's context and this run is not `--delegated`:
do not run the pipeline here.** Run no `ship_*` call and no git push or merge.
Follow the block: write the brief, spawn the general-purpose subagent with
`--delegated`, and relay its decisions through `AskUserQuestion`. The subagent
renders the card with this session's id; you set the title and show the card
it hands back. `modes/delegated.md` → *Main session* covers failures.

**`--delegated`:** you are that subagent. Follow `modes/delegated.md` →
*Subagent* for every step it names. Every other step is unchanged.

This holds for a ship you start yourself through the Skill tool (concept
finalize, `/do-run backlog`, an autonomous ship), too. Below the threshold
the ship stays here (`pre.ship.delegate` refuses a `--delegated` spawn).
A **promotion-only** prompt ("promote stable" with nothing unshipped, about
4 calls) is never delegated; a promotion that has to ship first is a ship and
is delegated like any other.

## Pre-Step R — Resume an interrupted ship (`--resume`)

The ship MCP server keeps a checkpoint of every step
(`.claude/.ship-checkpoint.json`), so a ship stopped by a usage limit or a
crash continues at the first step that did not finish. It never starts over,
and it never repeats a bump, PR or tag. With `--resume`, follow
`modes/resume.md`: read the checkpoint, check it against git/gh, skip what
landed, and end with the normal ship card.

## Pre-Step A — Autonomous Lockout Detection

Unsupervised orchestrators (do-run backlog mode) run `/do-ship` in a
**Post-Confirmation Lockout** — the user is AFK and **no `AskUserQuestion` can
ever be answered**; one modal would hang the whole night run. Detect that state
FIRST, before any other step:

```bash
node "{PLUGIN_ROOT}/scripts/autonomous-lockout.js" check --ship
```

Parse the JSON. If `active: true`, set `$SHIP_LOCKOUT=true` for this whole run.
`--ship` persists it durably in the `.claude/.ship-lockout` marker (repo root)
and, with no active lockout, deletes a marker an earlier blocked or aborted ship
left behind. A compaction during the CI wait can drop the variable, so at every
interactive gate re-derive `$SHIP_LOCKOUT=true` when the marker file exists — never trust
recall alone (`autonomous-lockout.js ship-marker` answers it and expires a
marker older than 6 h). `ship_cleanup` deletes the marker on every exit —
success, keep-mode and each `ship-blocked` exit; never write or delete it by hand.
If the command errors or the script is absent (older plugin), treat it as **not
locked** and continue: the guard only ever *adds* non-interactive safety.

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
| Step 1e — ship-pass finding (`/auto-harden` + `/auto-polish --invoked-by=ship`) | mechanical → fix; else `userFinalTest` (never asks) | same: mechanical → fix; else **RECORD & CONTINUE** — never BLOCK |
| Step 5d — promotion (beta/stable named) | promote on the user's channel word | never promote — `open` item "Promotion auf <channel> ausgesetzt — unbeaufsichtigter Lauf" |
| Step 2 — Codex judgment-required finding | ask Fixen/Ignorieren/Abbrechen | auto-fixable → fix inline; design/logic/security → **BLOCK** (finding named) |
| Step 3 — major version bump | always ask | **BLOCK** ("needs major-version decision — not shipped unattended") |

A BLOCK under lockout is the safe outcome, not a failure: the caller parks the
issue as a `⏸ Rückfrage` and the queue continues. Shipping an unreviewed
security finding, an ambiguous merge, or an unattended breaking change would be
the actual failure. When `$SHIP_LOCKOUT` is false (a normal interactive ship),
every gate behaves exactly as written elsewhere in this skill — unchanged.

## Pre-Step B — Session Activity Guard

Check whether this session still has work in progress: background agents
still running, background Bash commands still executing, or `TaskList` tasks
not `completed` / `cancelled`.

If any is active, do not ship yet — name the pending activities and ask via
AskUserQuestion:
- "Warten bis alles fertig ist" — pause and resume /do-ship automatically when all activity completes
- "Trotzdem shippen" — user accepts the risk, continue with Step 0
- "Abbrechen" — cancel /do-ship entirely

**If `$SHIP_LOCKOUT` (Pre-Step A):** do not ask. If genuine in-scope activity is
still pending, **BLOCK** (`ship-blocked`, "session activity active"); otherwise
proceed to Step 0.

This guard only applies to the **current chat session**, not external CI or other terminals.

## Pre-Step C — Mark the session in the sidebar

Mark the session as mid-ship, like `/auto-concept` and `/do-batch` do — the
prefixes are `SESSION_PREFIX` in `mcp-server/lib/mode-state.js`. Hooks compute
the exact title from the transcript tail (`hooks/lib/session-title.js`), so
this step normally costs no API call of its own — no `get_session`:

- **`/do-ship` typed by the user:** `prompt.flow.title-work` marks a ship
  prompt itself (same classifier as `prompt.ship.detect`) — it arrives here
  already marked.
- **Skill loaded via the Skill tool** (an affirmation after a card, a queue in
  auto-cleanup or `/do-run backlog`): `post.flow.title-mode` answers the load
  with a `[post.flow.title-mode]` block carrying the exact
  `🚀 Shipping – {title}` — call `mcp__ccd_session_mgmt__set_session_title`
  with `session_id: "self"` and that title **in the same message as your next
  tool call** (parallel, e.g. with `ship_preflight`). No block → the title is
  already right: done.
- **Fallback — only when the block says the title is unknown:**
  1. `mcp__ccd_session_mgmt__get_session` with `session_id: "self"` → `title`.
  2. If the title already starts with `🚀 Shipping – `: done.
  3. Strip any leading devops prefix (`🚀 Shipping – `, `🚀 Shipped – `, `🧪 Test – `,
     `📦 Ready – `, `⛔ Blocked – `, `⏳ `, … — the `SESSION_PREFIX` values) left by an earlier card or
     ship in this session — never stack them.
  4. `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"` and
     `title: "🚀 Shipping – {stripped title}"`.

The bare `⏳ ` is the fallback for "being worked on", never the override: no
hook or skill replaces a running `🚀 Shipping – ` with it (design § 7).

**Both tools exist only in the Desktop app.** Deferred is not unavailable: when they sit in the deferred-tools list, load
the set tool (fallback: both once with `ToolSearch` `select:mcp__ccd_session_mgmt__get_session,mcp__ccd_session_mgmt__set_session_title`), then call them
(`{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md`). In a terminal session, an
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
> it only clears the sentinel (main-branch protection resumes immediately) and the
> `.claude/.ship-lockout` marker (the next ship starts interactive).
> The `ship-blocked` card's `[SESSION TITLE]` block then swaps the sidebar prefix
> to `⛔ Blocked – ` (Step 6 → *Session title on exit*).

## Step 0 — Load Extensions

Check for optional overrides; Glob each path first and skip missing files silently.

1. Global: `~/.claude/skills/do-ship/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/do-ship/SKILL.md` + `reference.md`
   Fallback (pre-PR-2 name): where `do-ship/` does not exist, read `~/.claude/skills/ship/` / `{project}/.claude/skills/ship/` instead — an extension written before the rename keeps working.
   A promotion (Step 5d / promotion-only) additionally reads the pre-PR-2 `~/.claude/skills/promote/` / `{project}/.claude/skills/promote/` when present.
3. Merge: project > global > plugin defaults

Project extensions define: quality gate commands, deploy targets, version files, CI specifics.

Also capture, if present in the merged `reference.md`, for use later in this run:
- `outOfBandDeploy:` — a list of path globs for artifacts a code merge does NOT
  deploy (DB migrations, edge/serverless functions). Pass them to `ship_preflight`
  in Step 1a. Omit when absent — the tool applies stack-agnostic defaults.
- `deploy:` — a deploy handler (e.g. `supabase`) that can actually APPLY those
  artifacts post-merge. Used by Step 4d. When absent, Step 4d raises the deploy
  gate instead of deploying.
- `deployParity:` — overrides for the deploy-parity build (Step 2.5):
  `disable`, `buildCmd`, `installCmd`, `dir`, `timeoutSec`, `passEnv`.

4. Codex context: Read `{PLUGIN_ROOT}/deep-knowledge/codex-integration.md` — the Step 2 Codex review gate (§1 there) is mandatory and runs only via `{PLUGIN_ROOT}/scripts/codex-safe.sh` (5-min hard timeout, § "Hard Timeout & Failure-Tolerance"), never via the `/codex:rescue` Agent tool. Detect Codex availability now.

## Step 0.5 — Load Deferred MCP Schemas

Ship tools from the `dotclaude-ship` MCP server are often **deferred** in large-tool-inventory sessions (their names appear in the SessionStart deferred-tools list, but their schemas are NOT loaded yet). Calling them directly before the schema is loaded fails with `InputValidationError`.

See `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md` for the full pattern.

**Before Step 1**, load all ship tool schemas in ONE `ToolSearch` call:

```
ToolSearch({
  query: "select:mcp__plugin_devops_dotclaude-ship__ship_preflight,mcp__plugin_devops_dotclaude-ship__ship_build,mcp__plugin_devops_dotclaude-ship__ship_version_bump,mcp__plugin_devops_dotclaude-ship__ship_release,mcp__plugin_devops_dotclaude-ship__ship_cleanup,mcp__plugin_devops_dotclaude-ship__ship_hygiene",
  max_results: 6
})
```

If the `ToolSearch` result contains all six `<function>` entries, proceed. If ANY are missing from the returned block, the server is genuinely not registered — do NOT improvise a ship with `gh pr create` (the guard hook blocks it) or the tool at hand. When the session reminder shows the server as **failed to connect** (`Connection closed`), run the cache diagnosis in `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md → When the server is genuinely down` first: a cache that lost its `*.js` files is the usual cause and is repairable in-session.

**Server installed but not connected → the offline ship CLI.** When the reminder says `Skipping connection (recent failure cached …)` or `CONNECT_TIMEOUT` for `dotclaude-ship` and `{PLUGIN_ROOT}/mcp-server/ship/cli.js` exists, run the same pipeline through it — Steps 1–5 unchanged, every `ship_*` call becomes `node "{PLUGIN_ROOT}/mcp-server/ship/cli.js" <tool> <params.json>` (params = the exact tool arguments as a JSON file, result JSON on stdout; exit 2 = invalid params, 1 = the handler threw). Same handlers, same gates, same checkpoint — this is the pipeline, not a manual ship, and needs no restart. Announce it in one line. Details: `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md` § When the connect is skipped.

**Tools absent and not repairable → the manual checklist (#567).** This check runs here, before Step 1 and before any git or GitHub action — fail closed, never on a failed `ship_preflight` halfway through. The ship tools are absent when `mcp__plugin_devops_dotclaude-ship__*` is in neither the loaded nor the deferred tool list, `ToolSearch` finds none of them and the offline CLI above is not on disk either (a claude.ai cloud session without the plugin's MCP servers is the typical case). Announce the switch in one line with the reason, then read `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/manual-ship.md` and follow it instead of Steps 1–5; its tag step points at `release-flow.md` § owner hand-off. Deferred tools are never absent — load them and run the pipeline.

Do NOT skip this step even if you "think" the tools are available. `analysis` / `ready` / `test` cards have no ship-tool dependency and won't hit this — only the full pipeline does.

## Step 1 — Pre-Flight & Rebase Loop

Run preflight, resolve any merge-safety issues autonomously, and re-check — repeat until the branch is clean.

### 1a. Run preflight

Call `ship_preflight` MCP tool (dotclaude-ship server) with `cwd`.
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

Auto-detected base = a sub-branch's parent, else the default branch; override with
`ship_preflight({ base: "feat/42", cwd: "<cwd>" })`. Details:
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/preflight-rebase.md` § Base auto-detection.

Check the result:
- `autoDetectedBase` — non-null if a parent branch was detected (confirms intermediate merge).
- `intermediate` — `true` if merging into a feature branch instead of main.
- `ready: false` → report errors and **STOP**. Do not proceed.
- `needsRebase: true` → continue to 1b (do NOT stop).

**Dirty tree from untracked files: fix the source, never park and restore.**
Settle each untracked file where it belongs, inside this ship — read
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/preflight-rebase.md` § Dirty tree from untracked files
and follow it (plugin configuration → commit it; plugin runtime state →
`hooks/lib/runtime-ignores.js` or delete it). Never park and restore.
A harness-created worktree must end Step 5c with an empty `git status --porcelain`.

The marker check has two scopes. A marker in the files **this ship would land** is a hard error — `ship_release` re-scans immediately before committing, so one left behind by the rebase in 1b is caught there too. A marker anywhere else in the repo is a **warning**: it predates this branch, so report it and open a separate fix rather than holding an unrelated release hostage.
Merge-safety issues (`base-ahead`, `file-overlap`, `config-conflictstyle`) are **warnings, not errors** — they are resolved autonomously below.

### 1a-ii. Read `mode` — the repo-mode fork

`ship_preflight` returns a `mode` field. **Read it** — it decides which steps
below can run (ignoring it once reported a merge that never happened).

| `mode` | What it means | How the pipeline changes |
|---|---|---|
| `git` | Repo with an origin | Full pipeline, nothing changes. |
| `git-no-remote` | Local repo, no origin | The pipeline runs as usual, but everything that needs GitHub happens **locally**: `ship_release` commits, merges the branch into its local base (main, or the parent of a sub-branch; squash/merge/rebase as passed) and creates the `alpha/v…` tag locally. Only push and PR are skipped. A base that moved ahead returns `rebaseRequired` → `git rebase <base>` (local, no fetch) and retry. The card is `ship-successful` with `state: { mode: "git-no-remote", merged, pushed: false, delivered: "local-merge" }`. Skip Step 4b (no CI) and Step 5d (no remote to promote on). |
| `file-only` | Not a git repo at all | Everything that is not a git action still runs — see below. |

**`file-only` is NOT "skip the ship".** When `mode: "file-only"`, read
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/repo-modes.md` § file-only and follow it: Step 2 and
Step 3 run as normal, Step 1b and Step 4b are skipped, `ship_release` and `ship_cleanup`
are still called, and the card is `ready-files` — never `ship-successful`, never a
claimed commit, branch, PR or merge.

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
   Read `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/preflight-rebase.md` § Rebase conflict
   resolution and follow its steps a–d (resolve both intents semantically, remove
   **all four** marker lines incl. `|||||||`, `git add`, `git rebase --continue`, repeat).
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

### 1e. Ship passes — harden + polish, diff-scoped

Every ship runs two static, diff-only passes on exactly what it lands
(`--invoked-by=ship`; no agents, no browser, no card) — one call each, then
continue:

1. `node "{PLUGIN_ROOT}/scripts/ship-harden.js" --invoked-by=ship --base=<base> [--cwd=<path>] <files of the diff>` — every
   changed file; checks H1–H7 on the added lines and applies the mechanical
   H1/H2 fixes itself (`auto-harden` § Ship path as a script, same JSON). Add
   `--strict` under strict mode (below).
2. `/auto-polish --invoked-by=ship [--cwd=<path>] <ui files of the diff>` — only when the
   diff has UI files (`{PLUGIN_ROOT}/deep-knowledge/ui-defaults.md` § Detection
   allowlist (row *UI file detection*), plus the project's `## UI rules` override in
   `.claude/skills/auto-polish/reference.md`, pre-PR-2 fallback `tune-polish/`);
   the static halves of the standing UI rules (`auto-polish` § Rules-only path).

**Composed ships (`--cwd=<path>`):** pass the SAME `--cwd=<path>` to both
passes, and compute the diff with `git -C <path>`. Both skills scope the diff
AND their fixes to that checkout; a mechanical polish fix you apply yourself
edits the file under `<path>` too.

Treat what they return like the other 1d findings:
- `applicable: false` → nothing; no card entry.
- harden `fixed` items (it applied them) and polish findings with
  `mechanical: true` (apply the one-line `fix` yourself) → commit with this
  ship, list under `changes`.
- every other finding → a `userFinalTest` item naming id/rule, file:line and
  what to check; a harden H3 (secret-shaped literal) goes first.
- one `tests` line per pass that ran: `{ method: "Harden (Ship)", result: "1 Fix · 2 Hinweise" }`,
  `{ method: "UI-Regeln", result: "2 Findings · R2b deaktiviert (Projekt-Override) · R4b n/a" }`.

**Never blocks.** If Step 2's `ship_build` goes red on a line a pass fixed,
revert that fix, re-run the gate, and report the finding instead; a red
build the passes did not cause is the normal `ship-blocked`. **Priority:** a
more recent project convention from the mined PRs (1d) beats a standing rule.

**Strict mode** (`node "{PLUGIN_ROOT}/hooks/lib/strict-state.js" status`
→ `active: true`, or the `[claude-strict contract]` in context): the passes
still run with `--strict` added, and nothing is applied: every finding,
mechanical or not, becomes a `userFinalTest` item.

**Skip** both when `mode: "file-only"` (no diff) or the run is
promotion-only. `$SHIP_LOCKOUT` changes nothing here — the passes never ask.

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

On success, **start Step 2.5 in the background now**, before the Codex gate — the two overlap.

### Codex Review Gate (after build passes)

**MUST run** whenever codex-plugin-cc is installed — mandatory, never skipped for time or context.

1. Invoke Codex via Bash with hard timeout: `bash "{PLUGIN_ROOT}/scripts/codex-safe.sh" "<review prompt containing git diff>"`. Do NOT use the `/codex:rescue` Agent tool.
2. Evaluate by exit code (see `{PLUGIN_ROOT}/deep-knowledge/codex-integration.md` "Hard Timeout & Failure-Tolerance"):
   - **rc=0, no findings / clean** → continue to Step 3
   - **rc=0, auto-fixable** (typos, missing imports, style) → fix inline, continue
   - **rc=0, judgment required** (design concerns, logic flaws, security) →
     AskUserQuestion with findings + options: "Fixen", "Ignorieren", "Abbrechen".
     **If `$SHIP_LOCKOUT` (Pre-Step A):** do not ask — **BLOCK** (`ship-blocked`,
     naming the finding).
   - **rc=75** (Codex usage limit — stored per user, or just hit) → continue to Step 3 immediately; card `tests` line `{ method: "Codex-Review", result: "übersprungen — Limit bis <reset time from stderr>" }`. The wrapper skips Codex on its own until that time; the first ship after it runs Codex again. Do NOT retry. If the user says Codex is usable again before then (plan bought, limit raised), run `bash "{PLUGIN_ROOT}/scripts/codex-safe.sh" --reset-limit` once, then call the gate normally.
   - **rc=124** (timeout, 5 min) → log "Codex review timed out — proceeding without review" in the ship log, continue to Step 3. Do NOT retry, do NOT block the ship.
   - **rc=126** (`DEVOPS_DISABLE_CODEX=1`) or **rc=127** (codex CLI missing) → skip silently
   - **other non-zero** → surface first line of stderr, continue to Step 3
3. If codex-plugin-cc not installed → skip silently

## Step 2.5 — Deploy-Parity Build

Build the commit **the way the deploy host will** (host build command, npm `pre`/`post` hooks, fresh lockfile install, clean temp worktree), stack-independent. Skip when `intermediate: true` or the extension sets `deployParity.disable: true`. Otherwise start it with Bash `run_in_background: true` right after `ship_build` passes (own budget, never inside the 120 s step ceiling), passing the extension's `deployParity:` values as flags:

```bash
node "{PLUGIN_ROOT}/scripts/deploy-parity.js" --cwd "<cwd>" [--build-cmd "…"] [--install-cmd "…"] [--dir "…"] [--timeout-sec N] [--pass-env A,B]
```

Wait for its JSON before Step 3. `failed` → **STOP** with `ship-blocked` (also under `$SHIP_LOCKOUT`); `passed` / `inconclusive` / `skipped` → continue with a card `tests` line. Card lines, detection and the inconclusive heuristic: `{PLUGIN_ROOT}/deep-knowledge/deploy-parity.md` § In the ship.

## Step 2.6 — Docs-Sync

Reconcile living documentation against the **frozen shipped diff** before the
version bump — so doc edits land in the same version-bump commit.

1. Determine what this ship actually changes — new feature, changed flow, new
   subsystem, architecture/contract change, or removal. Use the diff since the
   merge-base, not intentions.
2. Apply the **proportional** doc action per
   `{PLUGIN_ROOT}/deep-knowledge/documentation-maintenance.md` § Trigger Matrix:
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

Determine bump type based on changes. The full table: `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/versioning.md` § When to bump.
- **patch/minor**: decide autonomously
- **major**: always ask user via AskUserQuestion. **If `$SHIP_LOCKOUT`
  (Pre-Step A):** do not ask — **BLOCK** (`ship-blocked`, "needs major-version
  decision — not shipped unattended").
- **none**: internal-only changes (no user-visible impact)

**Before calling ship_version_bump**, update CHANGELOG.md with the new version entry.
The MCP tool updates JSON files and README — CHANGELOG is editorial and must be done by Claude.

> **CHANGELOG is large** — `pre.tokens.guard` blocks a full Read. Read only the head
> (`Read` with `limit: 40`, newest entries are on top) to satisfy the Edit
> precondition, or retry a blocked Read once (the sanctioned bypass). Never load the
> whole file.

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

**Requirement gate.** Pass `validation` (the card's items; omitted → the last card of this checkout, ≤ 12 h, is checked). A gap that is still your own work — no status, partial/unmet without `waitsOn`, or `waitsOn: "pending"` — returns `reason: "validation-gaps"` with nothing pushed: close the listed gaps, then call `ship_release` again. `waitsOn` user/deploy/external may ship. `status` means delivered: implemented but only user-verifiable is `met` (the check goes to `userTest`), never `partial`. `acceptGaps: true` only when the user said to ship as-is.

The tool handles: commit (optional), rebase verification, push (explicit force-with-lease after rebase), PR create (or reuse with mergeability check), **pre-merge CI checks gate (waits for green)**, **pre-merge rebase re-check (closes the checks-window race)**, merge (squash or merge commit), **post-merge tree guard**, **alpha channel tag** (main only), GitHub release deferred to promotion.

Returns: `{ branch, commit, rebased, pushed, pr: {number, url}, checks: {status, passed, failed, pending}, merged, mergeSha, mergeVerified?, mergeWarning?, mergeStrategy, intermediate, tag, channel, tagVerified, releaseDeferred, postMergeTreeMatch, postMergeWarning, postMergeError?, titleClamped }`.

**Merge and tag are reported separately (#398).** Once the merge landed, the
result always carries `merged` + `mergeSha` — even when a later step failed.
Read the fields in this order:

- `merged` present → the PR IS on base. Never retry `ship_release` for the same
  branch (double-ship) and never conclude "nothing happened" from `success: false`.
- Any other merge/tag field (`mergeSha: null` + `mergeWarning`, `mergeVerified: false`,
  `success: false` with `merged` + `postMergeError`, `tagSkipped` + `tagWarning`, `tagError`):
  read `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/release-results.md` § Merge and tag fields and follow
  it — these are card warnings or ring gaps on a landed merge, never a retry.

**Two other return shapes** — never mistake them for the shape above:
`reason: "file-only-mode"` (not a git repo) and `reason: "no-remote"` (local repo
without an origin): when either appears, read
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/release-results.md` § Other return shapes and follow it.

**Never read `success: true` alone as a merge.** Always check `merged` before
reporting one, and check `skipped` / `pushed` before continuing to any step
that assumes a remote.

**A third shape is a transient failure, not a mode:** `reason: "git-probe-timeout"`.
Nothing happened; **retry the same call once** — never read it as file-only. A second
timeout → BLOCK (`ship-blocked`, "git unresponsive — machine under load"). Details:
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/release-results.md` § git-probe-timeout.

**If `titleClamped` is set**: the ship proceeded, it is not an error — see
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/release-results.md` § titleClamped.

**Ring model (channels):** the tag is `alpha/vX.Y.Z` — a ship always tags the earliest
channel; beta/stable and GitHub Releases come only from a promotion (Step 5d). Pass the
bare `tag: "vX.Y.Z"` or omit `tag` (derived from the bumped version, `tagDefaulted: true`).
An explicit `tag: null` returns `tagSkipped` + `tagWarning` → a `userFinalTest` item, never
an all-green card (#372). Background: `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/release-results.md` § Ring tag.

**Pre-merge CI gate** (default ON): after PR create, `ship_release` runs `gh pr checks --watch` (default 600s timeout). If checks fail or timeout → `success: false`, `checksBlocked: true`, PR stays open, branch not deleted. Render `ship-blocked` card with the failing check names + run URLs.

- Hot-fix bypass (`skipChecks`), timeout tuning and the full state matrix:
  `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/release-results.md` § Pre-merge CI gate options.

**If `rebaseRequired: true`**: the branch is not rebased onto base. Go back to Step 1b and rebase before retrying. This also fires as `baseAdvancedDuringChecks: true` when a **parallel ship landed on base while we waited for CI** — the PR is left open and unmerged (no silent overwrite). Same action: rebase + retry, then re-run the **Step 1d full check** before the retry: a parallel ship just landed, and its purpose may impose obligations on this branch (see `deep-knowledge/purpose-alignment.md`). See `{PLUGIN_ROOT}/deep-knowledge/merge-safety.md → How ship_release Prevents Overwrites`.

**`autoRebased` set** (with `rebaseRequired` + `retestRequired`): only version files collided, so `ship_release` already rebased and bumped again (`autoRebased.to`; the CHANGELOG header follows). Skip the manual rebase: push the branch (`git push --force-with-lease`), run `ship_build`, re-run preflight, then call `ship_release` again — the release commit exists, a `commitMessage` on the clean tree is skipped. Use `autoRebased.to` as `vNew` on the card. `autoRebaseRefused` names why the tool left it to Step 1b.

**If `postMergeTreeMatch: false`** (merge succeeded but `postMergeWarning` is set): **verify
before surfacing** — read `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/release-results.md` § Post-merge
tree verification and follow it. Trees equal → false alarm, NO `userFinalTest` item; trees
differ → a `userFinalTest` item, never a ship failure (the merge landed).

If `success: false` → do NOT proceed to cleanup. Report error and render completion card with variant `ship-blocked`.

### Squash-Merge Traceability Convention

When shipping a **feature branch → main** that was built from intermediate sub-branch merges,
the PR body **MUST** include references to all intermediate PRs — template:
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/release-results.md` § Squash-merge traceability.

### Step 4a — Delivery extension hook

After `ship_release` succeeds, check the project's `reference.md` for a `deliver:` field:
read `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/post-merge-steps.md` § Step 4a — Delivery extension hook
and follow it. Default (`git+gh` or field absent): PR + merge already done in Step 4.

## Step 4b — Spawn Post-Merge Watcher (final ship only)

**Skip the watcher entirely** when:
- `intermediate: true` (only a ship to main has one)
- `merged` is absent or null, or `pushed` is false — `file-only` / `git-no-remote`:
  nothing reached GitHub (a local merge sets `merged` but not `pushed`)
- The repo has no `.github/workflows/` directory (check with `Glob`)
- User passed `--no-watch` to the ship trigger (interpret intent from the user's message)

Otherwise, after `ship_release` returns `success: true` **and** `merged: "main"`, spawn the
post-merge watcher in the background (fire and forget): read
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/post-merge-steps.md` § Step 4b — Watcher spawn and run its
command exactly (bash `nohup` / PowerShell `Start-Process`).

Pass `state.watcher = { spawned: true, sha: "<sha>" }` (or `spawned: false`) into the
completion card in Step 6 so it can render "Deploy-Verify läuft im Hintergrund".

## Step 4c — Live Surface Verification (final ship only)

Open the real user-facing surface(s) in a browser and assert the **shipped version is
live and visible** before the card declares done (#210).

**Skip this step entirely when ANY of:**
- `intermediate: true` (intermediate merges have no live surface).
- The project declares **no surfaces** — see config below. This is the default
  (libraries, CLIs, internal tooling have no user-facing deploy). Skip silently.
- User passed `--no-verify` / `--no-watch` intent in the ship trigger.

Otherwise read `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/post-merge-steps.md` § Step 4c — Live surface
verification and follow it for every declared surface. A lagging surface or a missing browser
tool never blocks and never downgrades the variant — each becomes a `userFinalTest` item.
Pass `state.surfaceVerify = { checked: N, live: M, lagging: [...] }` into the card.

## Step 4d — Out-of-Band Deploy Gate (final ship only)

**A code merge does NOT apply DB migrations or deploy edge/serverless functions.**

**Skip this step entirely when:**
- `intermediate: true` (no deploy target for intermediate merges), or
- `ship_preflight.outOfBandDeploys.detected` is `false` (the common case — skip
  silently, nothing changed).

**When `outOfBandDeploys.detected` is `true`:** read
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/post-merge-steps.md` § Step 4d — Out-of-band deploy gate and
follow it. A configured `deploy:` handler deploys each artifact now; otherwise (no handler, or a
deploy failed) the gate is mandatory — carry `state.deployPending: true` + `deployGate` into Step 6.

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
This rule alone does **not** keep the session: the card still archives it (Step 6 →
*Session archive on exit*). Check the signals below anyway — a hit (or `--keep`)
passes `state.kept: true`, which is what keeps the session open for the follow-up.

### Signals that trigger keep-mode

ANY positive hit → keep-mode:

1. **Open tasks** (`TaskList`, `pending` / `in_progress`) describing follow-up
   scope this PR did NOT deliver — tasks *about* this ship do not count.
2. **Follow-up phrases** in the user's last ~10 turns ("danach", "Phase 2",
   "after this", "we'll continue", …).
3. **Several announced work blocks**, only the first shipped now.
4. **Ship-but-keep wording in the trigger** ("ship und weiter", "keep
   worktree", `--keep`, "ohne cleanup") — highest priority.

A weak or borderline signal → **normal cleanup** (a branch is re-creatable from
the merge commit, an orphan worktree is not). When keep-mode triggers, say so
on the card (`"Worktree behalten — Folge-Arbeit erkannt"`). Before deciding on
signal 1–3, read `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/cleanup.md` § Keep-mode signals (Step 5a) and follow it:
the full phrase lists (de + en), the ambiguity rule and the decision note.

## Step 5b — Cleanup (normal mode)

**Skip this step entirely if Step 5a chose keep-mode** — jump to Step 5c.

### Substep 1 — Capture session context

**Before any cleanup action** (before `ExitWorktree`), capture for Substep 3 and Step 5d:
`$WORKTREE_PATH` = `git rev-parse --show-toplevel` (only inside a worktree, else empty) and
`$MAIN_REPO_ROOT` = the parent of `git rev-parse --git-common-dir` (or the first entry of
`git worktree list --porcelain`).

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
app's, `ship_hygiene`'s or the auto-cleanup page's job. Never hand the user git commands to run.

Then call `ship_cleanup` MCP tool with the `base` from Step 1 (always pass `cwd`):
```
ship_cleanup({ branch: "claude/feature-branch", base: "main", cwd: "<cwd>" })
```

For intermediate merges:
```
ship_cleanup({ branch: "feat/42-video-filters-core", base: "feat/42-video-filters", cwd: "<cwd>" })
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

Skip this step entirely when `$WORKTREE_PATH` was empty in Substep 1. Otherwise run
`node "{PLUGIN_ROOT}/scripts/session-open-tracker.js" reopen-main --worktree="$WORKTREE_PATH"`
and treat its JSON summary as informational (`missing` entries are expected, not a failure).
What the script does and why: `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/cleanup.md` § Re-open session-opened files (Step 5b Substep 3).

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

The remote branch is gone either way (why, and how the next push re-creates it:
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/cleanup.md` § Keep-mode: the remote branch (Step 5c)). A
`remoteBranchWarning` in the release result means the delete failed: surface it as one `open` item on the card
("Remote-Branch `<branch>` konnte nicht gelöscht werden — »branches aufräumen« öffnet die Aufräum-Seite"), nothing else.

In Step 6:
- **Deliberate keep** (follow-up work expected): pass `state.kept: true` and
  `state.branch: "<feature-branch>"` so the CTA renders `KEEP CODING in <branch>` /
  `WEITER in <branch>` instead of `All DONE` / `Alles ERLEDIGT`.
- **Harness-created worktree** (keep only because the app owns the teardown): render the
  **normal** DONE CTA — no `state.kept`, no cleanup note. The `WEITER in <branch>` CTA is
  reserved for expected follow-up work; a worktree kept because nobody else may remove it
  must not read as "keep coding here".

## Step 5d — Promote (beta / stable requested)

**Runs only when** the target channel (§ Target channel) is beta or stable,
it came from the user, this was a final ship to main that merged, and
`ship_release` tagged `alpha/v<vNew>`. Otherwise skip — and when a channel
WAS requested, say why on the card as an `open` item (Step 6):

| Reason to skip | `open` item |
|---|---|
| `$SHIP_LOCKOUT` / orchestrator arguments | "Promotion auf <channel> ausgesetzt — unbeaufsichtigter Lauf, bitte selbst anstoßen" |
| Step 4d raised the deploy gate | "Promotion auf <channel> ausgesetzt — erst deployen, dann `promote <channel>`" |
| intermediate ship (feature branch) | "Promotion erst nach dem Ship auf main" |
| `tagSkipped` / `tagError` (no alpha tag) | "Promotion ausgesetzt — alpha-Tag fehlt (siehe Test-Punkt)"; with `tagHandoff` the owner-action item from `release-results.md` comes first |
| no channel tags in the repo (no ring model) | "Kein Ring-Modell (keine Channel-Tags) — nichts zu promoten" |

Otherwise follow `modes/promote.md` with these fixed inputs — its Step 2
question is already answered by the channel the user named:
- **Version** = `vNew` of this ship (or the version the user named).
- **cwd** = this session's cwd; after Step 5b removed the worktree, the
  captured `$MAIN_REPO_ROOT`.
- **beta** → `ship_promote({ version, from: "alpha", to: "beta", cwd })`.
- **stable** → fast-track, two sequential calls (alpha→beta, then
  beta→stable with `releaseNotes` = this version's CHANGELOG entry), unless
  the version is already on beta — then only beta→stable.
- **Beta soak skipped** — whenever the version goes to stable without having
  sat on beta before this run (every ship + "stable" run, every fast-track),
  the card MUST say so: an `open` item "Beta übersprungen — v<version> ging
  direkt alpha→stable, ohne Beta-Phase" (en: "Beta skipped — v<version> went
  straight alpha→stable, no beta soak") and `delivery.promote.fastTrack: true`.
  Never silent: stable tags are irreversible, and the skipped soak is the
  one risk the user did not see happen.
- Guard errors are final (`modes/promote.md` Step 3): no retry around
  monotonicity/ancestry/immutability. A failed promotion never undoes the
  ship — the card stays `ship-successful` with the guard error as an `open`
  item.

Carry the result into Step 6: `promotion: { from, to, sha, tags: <pushed>, release }`
and the re-read channel ladder (`git ls-remote --tags origin`).

**Promotion-only runs** (§ Target channel: nothing unshipped, or a version
named) do exactly this and nothing else — `modes/promote.md` Steps 0–4, the
version = latest alpha unless one was named; a bare "promote" asks its Step
2 question. A named version never triggers a ship, whatever the tree holds.

## Step 5e — Memory Dream (silent, before the card)

Silent memory consolidation after shipping. Runs **before** the completion
card — the card is the last action of the run (Step 6).

**Skip condition:** If no memory files were written or updated during this session → skip silently.

**If memories were touched this session**, run the lightweight dream pass: read
`{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/memory-dream.md` and follow it — silent (no user-visible
output), ~5K tokens, never touches `CLAUDE.md`.

## Step 6 — Completion Card

Call `render_completion_card` MCP tool (dotclaude-completion server) with data from previous steps.

**One card per run.** When Step 5d promoted, the run ends with ONE
`released` card — never a `ship-successful` card first. It carries the
ship's fields exactly as below (`changes`, `tests`, `validation`,
`userFinalTest`, `state`, `cta`, `delivery.pr` + `delivery.ship`) plus
`delivery.promote: { channels, current: "<channel>", fastTrack }` and
`promotion` (see `modes/promote.md` Step 4); skip the promotion-gap nudge —
the ladder already shows the new state. Its `[SESSION TITLE]` block sets
`🎊 Released <Channel> – `. Without a promotion the variants below apply
unchanged.

**`cwd` is required for clickable links** — without it the card renders PR/commit/branch as plain text. Pass the same `cwd` as the ship tools.

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
| `released` (Step 5d promoted, with or without a ship before it) | `🎊 Released <Beta\|Stable> – {title}` |

The block also strips a stale `🚀 Shipping – ` when the title carries one. A
title with none of the devops prefixes is left untouched — the user renamed it
meanwhile, and that name wins. Desktop app only (deferred is not unavailable — load both tools via `ToolSearch` first, `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md`); skip silently elsewhere or on
any failure.

### Session archive on exit (carried by the card result, #632)

A merged `ship-successful` / `released` card in the Desktop app also returns a
`[SESSION ARCHIVE]` block: the session archives itself **after** the card. Show
the widget as usual; its hook then releases exactly one more call —
`mcp__ccd_session_mgmt__archive_session {session_id:"self"}` — with no text
around it. Make it only when the hook says so. The renderer leaves the block
out for an explicit keep (`state.kept` — `--keep` or a Step 5a signal),
`pending` work (check `TaskList`, agents and workflows — declare what still
runs), `open` points or `userTest` items on the card, a dirty work tree
(untracked files too; ignored files are fine), a missing `cwd`, a concept or batch mode, an autonomous run / lockout or ship queue
(intermediate ships of a run never archive), and the devops setting
`ship.archiveAfterShip false`. Background:
`{PLUGIN_ROOT}/deep-knowledge/claude-desktop-app-setup.md` § Session archiving
after ship.

### Promotion-gap nudge (final ship to main without a promotion — MANDATORY)

**Before rendering the card**,
read `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/completion-card-payloads.md` § Promotion-gap nudge and
compute the drift from `git ls-remote --tags origin`: every channel's latest version →
`delivery.promote.channels`, each gap → `betaLag` / `stableLag`. No channel tags at all → skip
silently. It is NOT a `userFinalTest` item and NOT an `open` item.

### Post-ship hygiene (merged ship or promotion — MANDATORY)

After every run that merged (`ship-successful` — normal, keep-mode or
intermediate) or promoted (`released`), call once, before the card, with the
same `cwd` the card gets:

```
ship_hygiene({ cwd: "<cwd>", trigger: "ship", lang: "de" })
```

(`trigger: "promote"` for a promotion-only run — `modes/promote.md` Step 4.)
What it removes, flags and suggests: `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/cleanup.md` § Post-ship hygiene (Step 6).
Pass its card lines through unchanged: `card.tests` → append to
`tests`, `card.risk` and `card.open` (each a `{ text, reply }` item) → append
to `open`, `risk` first. All are absent when nothing happened — add nothing
then, and never restate the result in prose.

Skip it for `--queued` ships (the auto-cleanup queue already decided on its
page what stays) and for every blocked or aborted run. A failed call
(`success: false`) is non-fatal: no card line, no retry. The thresholds are the
user's settings (`{PLUGIN_ROOT}/deep-knowledge/devops-config.md`) — never
override them for one run.

**Read `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/completion-card-payloads.md` § ship-successful payload
before calling `render_completion_card` and build the call from it** — every field and its limits:
`variant`, `summary`, `lang`, `cwd` (the same as `ship_release`), `buildId`, `changes`, `tests`
(incl. the Step 1e lines), `validation`, `userFinalTest`, `open`, `state` (`branch`, `commit`,
`pushed`, `pr`, `merged`), `cta` (`vOld`, `vNew`, `bump`) and `delivery` (`pr`, `ship`, `promote`).

`delivery` rules — `ship.version` is the semver from the bump, never a commit SHA; `promote`
**only for ring-model projects**: `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/completion-card-payloads.md` § Delivery track.

**Variant reflects what the pipeline DID, not what's verified downstream.**
`merged` (+ `tag` where applicable) ⇒ `ship-successful`. Never downgrade to
`ready` (the PRE-ship variant, "SHIP or CHANGE?") because a downstream deploy,
tag build or the Step 4b watcher is still pending — each becomes a
`userFinalTest` item ("Vercel-Deploy live verifizieren", "Build run #N läuft —
`gh run view N`"). The MCP variant guard already turns `ship-successful` into
`ready` when `state.merged`/`state.pushed` are falsy. (Project ship-extensions:
keep project-specific downstream surfaces, but don't re-encode this rule.)

**Out-of-band deploy gate (from Step 4d).** When Step 4d raised the gate, pass
`state.deployPending: true` and the `deployGate` array to `render_completion_card`.
This is stronger than a `userFinalTest` item: the CTA itself flips to
"🚨 DEPLOY erforderlich (noch nicht live)" and a loud gate block names each
undeployed artifact — so a merged-but-undeployed ship is never mistaken for done.
Example payload: `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/completion-card-payloads.md` § deployGate example.

**Keep-mode variant** (Step 5a chose keep, Step 5c ran):
the same call with `cwd` still the worktree path, a summary that mentions "Worktree behalten",
and `state: { branch: "<kept feature branch, NOT 'main'>", worktree: true, …, merged: "main", kept: true }`.
Full payload: `{PLUGIN_ROOT}/skills/do-ship/deep-knowledge/completion-card-payloads.md` § Keep-mode variant.
`state.kept: true` flips the CTA to `KEEP CODING in <branch>` / `WEITER in <branch>`.

Output the card markdown VERBATIM — card is the last **visible** output, nothing after closing `---`.

**The card ends the run — nothing after it.** No memory pass, no extension
step, no check of a background task, no line of text (on Desktop each call after
the widget shows as a row under it). Everything else happens before the card (Step 5e). A project extension step that cannot run
before `render_completion_card` — it would stale the card's own MCP call — runs
between that call and the Desktop `show_widget` call, never after the widget.
When such a step fails, say it in ONE line before the widget, not after it.

**No recap before the card.** The card (on Desktop: the widget) is the ship
summary — never restate in prose what it already shows: changes, tests, skipped
checks, version, PR, open items, a restart hint. Everything of that belongs in
the card fields (`tests`, `open`, `userFinalTest`, …). Text before the card only
for what the card cannot carry: the answer to a question in the user's prompt
(always in full — the card never carries it), other topics of the user's prompt, points beyond the card's three, and hook blocks that are still
marked for the user and still true (a session-start finding this ship resolved
is dropped, not restated with an "outdated" note).

**No side topics on the ship card.** Its `open` points are decisions about THIS
work. A finding outside it goes into a task chip (`spawn_task`, Desktop app) —
never both a chip and an open point about it. Only where no chip exists
(terminal) may a side finding stay an open point.

## Reference files — every one is one level from here

Every file under `deep-knowledge/` and `modes/` (paths relative to
`{PLUGIN_ROOT}/skills/do-ship/`) is listed here, so none is reachable only
through another reference. Read one when its step sends you there. A *spec*
describes what an MCP tool already does: the pipeline never repeats it by hand —
only the manual checklist (`manual-ship.md`, Step 0.5) walks it step by step.

| File | Read when |
|---|---|
| `modes/delegated.md` | Pre-Step 0 — a `[ship-delegate]` block, or `--delegated` |
| `modes/resume.md` | Pre-Step R — `--resume`, also after a compaction mid-ship |
| `modes/promote.md` | Step 5d and every promotion-only run |
| `deep-knowledge/manual-ship.md` | Step 0.5 — the ship tools are absent |
| `deep-knowledge/preflight-rebase.md` | Steps 1a/1b — base detection, dirty tree, rebase conflicts |
| `deep-knowledge/pre-flight.md` | *spec* of the `ship_preflight` checks |
| `deep-knowledge/repo-modes.md` | Step 1a-ii — `mode: "file-only"` |
| `deep-knowledge/purpose-alignment.md` | Step 1d, and the Step 4 re-check after `baseAdvancedDuringChecks` |
| `deep-knowledge/quality-gates.md` | *spec* of the Step 2 gates and the pre-merge CI gate |
| `deep-knowledge/build-id.md` | the card's `buildId` — what it hashes, when it changes |
| `deep-knowledge/versioning.md` | Step 3 — the bump kind (§ When to bump); the rest is the *spec* of `ship_version_bump` |
| `deep-knowledge/call-examples.md` | Step 4 — the `ship_release` payloads |
| `deep-knowledge/release-results.md` | Step 4 — every result field beyond a clean `merged` |
| `deep-knowledge/release-flow.md` | *spec* of `ship_release`; § owner hand-off when the tag cannot be pushed |
| `deep-knowledge/post-merge-steps.md` | Steps 4a–4d |
| `deep-knowledge/post-merge-verify.md` | Steps 4b/4c — the project's `verify:` / `surfaces:` config |
| `deep-knowledge/cleanup.md` | Steps 5a–5c and the post-ship hygiene of Step 6 |
| `deep-knowledge/memory-dream.md` | Step 5e |
| `deep-knowledge/completion-card-payloads.md` | Step 6 |
| `deep-knowledge/data-flow.md` | the direct- and intermediate-ship data flow diagrams |
| `deep-knowledge/hierarchical-merge.md` | intermediate ships (sub-branch → feature branch → main) |
| `deep-knowledge/branching.md` | the branch naming (`<parent>-<role>`) that hierarchical merges detect |
