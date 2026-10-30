---
name: do-ship
version: 0.16.0
description: >-
  End-to-end shipping in ONE deterministic MCP call: ship_run drives preflight,
  rebase, build, CHANGELOG + version bump, release, cleanup and hygiene in code;
  the model only makes the decisions (bump, CHANGELOG text, Codex verdict,
  conflicts) and renders the completion card as the last action.
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
argument-hint: "[beta|stable|promote] [<version>] [--cwd <path>] [--keep] [--queued] [--delegated] [--card-data] [--inline]"
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(node *), Bash(bash *), Bash(nohup *), Read, Glob, Grep, AskUserQuestion, ExitWorktree, Agent, SendMessage, TaskList, TaskCreate, TaskUpdate, Skill, mcp__plugin_devops_dotclaude__*, mcp__ccd_session_mgmt__get_session, mcp__ccd_session_mgmt__set_session_title, mcp__ccd_session_mgmt__archive_session
---

# Ship

A ship is ONE `ship_run` call. The order (preflight → rebase → build → bump → release → cleanup → hygiene) lives in code and runs the same way every time; you make the decisions before the call and at the points where it returns `needs`.

> **`cwd` is required on every MCP tool call.** Every `ship_*` tool call MUST include `cwd`
> set to this session's working directory (or the `--cwd` target), or it operates on the wrong repository.

**Fallback — the step-by-step pipeline.** When `ship_run` answers `disabled: true` (env `DEVOPS_SHIP_RUN=0`), is not among the ship tools (older server), or a `tool-error` survives one re-call, follow `deep-knowledge/manual-pipeline.md` instead — same gates, one `ship_*` call per step. Its steps are also the reference for every rule this driver names by step number (Step 4c, Step 5a, …).

**After a context compaction mid-ship** only the first 5,000 tokens of this skill survive: re-invoke `Skill("devops:do-ship", "--resume")` before the next ship call. `ship_run` itself resumes from its checkpoint and never repeats a bump, PR, merge or tag.

## Target channel — alpha by default, beta / stable on request

A ship always lands on **alpha**. Naming a higher channel means "ship if anything is unshipped, then promote" (Step 5d). Read the target from the skill arguments (`prompt.ship.detect` passes `beta`, `stable`, `promote`, optionally a version) or the user's own prompt; a **negated** channel ("ohne promote") is no channel, and before deciding a version or "unshipped" read `deep-knowledge/target-channel.md` (parser: `hooks/lib/ship-intent.js`).

| Unshipped work? | Channel | Run |
|---|---|---|
| any | a promotion naming a **version** (every card button) | **promotion only** of exactly that version — never ship first; unshipped work becomes an `open` item |
| yes | none / alpha | the ship below |
| yes | beta / stable | the ship below, then Step 5d promotes the version just shipped; ONE `released` card |
| no | beta / stable / bare `promote` | **promotion only**: Pre-Step A, then `modes/promote.md` Steps 0–4 |

**Promotion stays a user decision.** The channel word the user typed IS that decision. Never promote on a channel that did not come from the user: orchestrator arguments (`--queued`, `--cwd`, `/do-run backlog`) and any `$SHIP_LOCKOUT` run skip the promotion; the card's Promote buttons offer it — never an `open` item (its reply would ride on Nachbessern; `lib/open-admission.js` drops it). All `ship_promote` guards stay final (monotonicity, ancestry, immutability).

## Composed ships — `--cwd`, `--keep`, `--queued`, the queue marker

| Signal | Effect |
|---|---|
| `--cwd=<path>` | Every `ship_*` MCP call passes this path as `cwd`, git runs as `git -C <path>`, the Step 1e passes get `--cwd=<path>`. `ExitWorktree` is **never** called — `--cwd` implies `--keep`. Pre-Steps B/C still refer to this session. |
| `--keep` | `ship_run({ …, keep: true })` — no branch or worktree teardown, only sentinel + lockout marker cleared. |
| `--queued` | `ship_run({ …, queued: true })` — no hygiene; summary suffix `(Queue n/N)`; a blocked outcome is parked by the caller, not retried here. |
| land a green Dependabot PR | `ship_run({ cwd, landPr: <n> })` — squash-merges it, no worktree/bump/changelog; `land-refused` unless bot-authored, non-draft, mergeable, all checks green. `gh pr merge` stays guarded. |
| `.claude/.ship-queue` marker, `--delegated`, `--card-data`, `--resume`, `--inline` | read `deep-knowledge/composed-ships.md` (§ Queue marker, § Run flags) before Pre-Step A. |

## Pre-steps — model-side, before `ship_run`

Run them in this order; each one's full text is the same-named step in `deep-knowledge/manual-pipeline.md`.

1. **Pre-Step 0 — delegate.** A `[ship-delegate]` block in this turn (context above `DOTCLAUDE_SHIP_DELEGATE_THRESHOLD`, default 600 k since `ship_run`) and no `--delegated`: run no `ship_*` call and no git push or merge — spawn the subagent per `modes/delegated.md`. `--delegated`: you are that subagent, follow `modes/delegated.md` → *Subagent*.
2. **Pre-Step R — resume** (`--resume`): `modes/resume.md`, then the same `ship_run` call — it skips what landed.
3. **Pre-Step A — lockout.** `node "{PLUGIN_ROOT}/scripts/autonomous-lockout.js" check --ship`; `active: true` → `$SHIP_LOCKOUT=true` for the run (persisted in `.claude/.ship-lockout`; re-derive it from that marker at every gate, `ship_cleanup` deletes it on every exit; a failing check counts as not locked). Under lockout **never call `AskUserQuestion`**: a gate either **BLOCKs** (sentinel cleanup, `ship-blocked` card, return) or **RECORDs & CONTINUEs** (a `userFinalTest` item). Pass `interactive: !$SHIP_LOCKOUT`.
4. **Pre-Step B — session activity.** Background agents/commands or open tasks → ask Warten / Trotzdem / Abbrechen; under lockout in-scope activity → BLOCK.
5. **Pre-Step C — sidebar title** `⏳ ➜ 🚀 Shipping ┃ {title}` from the `[post.flow.title-mode]` block, parallel to your next call (`deep-knowledge/session-title.md`). Desktop only, never a gate.
6. **Step 0 / 0.5 — extensions and schemas.** Capture the extension fields (`deep-knowledge/extensions.md`): build commands → `build`, `outOfBandDeploy:` → `outOfBandGlobs`, `versionFiles:` → `versionFiles`, `deploy:`, `deployParity:`. Detect Codex (`{PLUGIN_ROOT}/deep-knowledge/codex-integration.md`). Load the schemas in ONE call: `ToolSearch({ query: "select:mcp__plugin_devops_dotclaude__ship_run,mcp__plugin_devops_dotclaude__ship_cleanup,mcp__plugin_devops_dotclaude__ship_promote,mcp__plugin_devops_dotclaude__ship_hygiene", max_results: 4 })`. Server not connected → `deep-knowledge/offline-cli.md` (`node mcp-server/ship/cli.js ship_run <params.json>`); tools absent → `deep-knowledge/manual-ship.md`. Never improvise a ship with `gh pr create`.
7. **Step 1d light — purpose alignment** (`deep-knowledge/purpose-alignment.md`): mechanical fixes ship with this PR; high-impact conflicts → ONE batched question (lockout: RECORD & CONTINUE).
8. **Step 1e — ship passes** (`deep-knowledge/ship-passes.md`): `ship-harden.js --invoked-by=ship` on the diff, `/auto-polish --invoked-by=ship` on UI files (same `--cwd`), strict mode applies nothing. Never blocks.
9. **Step 2.6 — docs-sync** (`deep-knowledge/docs-sync.md`), non-blocking.
10. **Step 3 decisions — bump + CHANGELOG text.** Pick the bump (`deep-knowledge/versioning.md` § When to bump); a **major** bump is asked (lockout: BLOCK). Write the entry body (sections, no heading) — `ship_run` puts it under a heading in the repo's own format. Skip both for an intermediate ship.
11. **Step 5a decision — keep-mode** (`deep-knowledge/cleanup.md` § Keep-mode signals): harness-created worktree → keep, always (#442); a clear follow-up signal or `--keep` → keep + `state.kept`. Default is normal cleanup. Never print git commands for the user to run after a ship.

## The call

```
ship_run({ cwd: "<cwd>", title: "feat: …", body: "Closes #N …", bump: "minor", changelogEntry: "### Added\n- …",
           validation: [ …card items… ], interactive: true, codexGate: <Codex installed or deploy-parity applies>,
           build: { buildCmd, lintCmd, testCmd }, keep: <5a decision>, queued: <--queued>, lang: "de" })
```

Do not pass `build.testCmd` when it equals the auto-detected test script: an explicit `testCmd` disables the related-tests scope (the CI `suite` check then runs the full suite) and forces the full suite locally (`deep-knowledge/quality-gates.md` § Full suite).

`codexGate: true` makes `ship_run` stop after a green build (`stage: "build-done"`, `needs: "codex-judgment"`): start the deploy-parity build in the background (`{PLUGIN_ROOT}/deep-knowledge/deploy-parity.md` § In the ship — `failed` → BLOCK), run the Codex review via `bash "{PLUGIN_ROOT}/scripts/codex-safe.sh" - < <prompt file>` (prompt = instructions + `git diff -U25 origin/<base>...HEAD` written to a scratch file, judged from the diff alone, never passed as an argument — Windows caps the command line at ~32K chars; never `/codex:rescue`; rc 0 clean/auto-fixable → fix and go on, judgment → ask Fixen / Ignorieren / Abbrechen, lockout → BLOCK; rc 75 / 124 / 126 / 127 / 69 / other → go on, never retry — `deep-knowledge/codex-gate.md`), then call `ship_run` again with the same params plus `codex: { rc, outcome }`. **Triage applies to every reviewer** (Codex, the Claude-API fallback, harden/polish/QA): a defect in the diff's own topic is fixed with a regression test before the merge, or asked (`status: "decision"`) / BLOCKed under lockout — never an `open` item on the `ship-successful` card (only `finding: "out-of-scope"` items may be; in-scope ones are refused). A pre-existing error that breaks the ship's own build or type-check is in scope. A fix commit changes the tree, so the build reruns.

## Decision points — `{ ok: false, stage, needs, detail, resume }`

Handle the need, then call `ship_run` again with the same params (plus what `resume` names). Every other field of a landed ship is in the checkpoint — nothing is repeated.

| `needs` | What you do |
|---|---|
| `preflight-failed` | report `detail.errors`; dirty tree from untracked files → settle per `deep-knowledge/preflight-rebase.md` § Dirty tree from untracked files, then re-call; else BLOCK |
| `uncommitted-work` | the ship's content is still uncommitted (`detail.files`, tracked only): commit it as the work commit, then re-call — `deep-knowledge/preflight-rebase.md` § Uncommitted tracked work |
| `conflict` | the rebase hit a code conflict and was aborted: resolve per `deep-knowledge/preflight-rebase.md` § Rebase conflict resolution (then `git push --force-with-lease` and re-call). Truly ambiguous → ask (lockout: BLOCK "unresolvable merge conflict — needs human decision"). Re-run the **Step 1d full check** after any rebase |
| `rebase-required` | base kept moving: rebase as above, re-call |
| `validation-gaps` | close the listed gaps, re-call with updated `validation`; `acceptGaps: true` only when the user said to ship as-is |
| `build-red` | `ship-blocked` card with the failing steps; `timeoutHit` → re-call with a higher `build.stepTimeoutSec` |
| `codex-judgment` | the Codex gate above |
| `bump-required` / `major-bump` | pass `bump`; major → ask, then `majorConfirmed: true` (lockout: BLOCK) |
| `bump-mismatch` | the version WAS raised: bring `detail.mismatches` to `vNew` by hand, re-call (the bump is never repeated) |
| `full-suite-required` | `ship_run` already ran one full local build; still red/absent → `ship-blocked` |
| `checks-failed` | real red checks → `ship-blocked` with names + links. `ciQuotaDecisionNeeded` → ask the user (skip-checks / wait), re-call with `quotaDecision`; never `skipChecks` on your own (`deep-knowledge/release-results.md` § Account-limited CI) |
| `release-failed` | `ship-blocked` with `detail.error`; `prLeftOpen` names the open draft |
| `land-refused` | `landPr` only: the PR is not an eligible Dependabot PR — report `detail.reason`, land nothing, never fall back to `gh pr merge` |
| `tool-error` | re-call once; again → the fallback pipeline from the stage named |

**Never retry a merged release.** `ship_run` reads `merged` first and never calls release again for a landed merge; never call `ship_release` yourself after a `merged` result either (double-ship).

**Sentinel hygiene on every blocked exit:** before rendering ANY `ship-blocked` card, first call `ship_cleanup({ branch, cwd, keep: true })` — it clears the ship-in-progress sentinel (main-branch guards resume) and the `.claude/.ship-lockout` marker. A run that will be resumed (gaps being closed, a question being answered) keeps both until the final exit.

## After the final result

The result carries the card's data: `version`, `pr`, `merged`, `mergeSha`, `tag`, `channels`, `betaLag`, `stableLag`, `landingLock`, `prLeftOpen`, `porcelain`, `testScope` / `fullSuiteVia`, `tests` (build steps, test scope, CI checks with wait time, hygiene, Ship-Dauer), `hygiene` (`risk` / `open` / `openItems`), `outOfBandDeploys`, `components`, `timings`. Read `merged` before claiming a merge — never `success`/`ok` alone; `mode: "file-only"` → `ready-files` card, never a claimed merge (`deep-knowledge/repo-modes.md`).

- **Steps 4a–4d** (`deep-knowledge/post-merge-steps.md`): delivery hook, post-merge watcher (skip it when `intermediate`, `merged` absent or `pushed` false, no `.github/workflows/`, or `--no-watch`), live surfaces, out-of-band deploy gate from `outOfBandDeploys` (`state.deployPending` + `deployGate`, never a downgrade).
- **Step 5b/5c — cleanup.** `cleanup.reason: "exit-worktree-first"` (a worktree this session entered, keep false): `ExitWorktree(action: "remove")` first — on failure STOP, on a no-op fall back to keep — then `ship_cleanup({ branch, base, cwd })`. Harness worktree: `porcelain` must be empty before the card — settle every listed file, never by restoring a parked copy. Deliberate keep → `state.kept: true` + `state.branch` + `nextStep`; harness keep → normal heading, no `state.kept`.
- **Step 5d — promote** only on the user's channel word, final merged ship with an alpha tag: `modes/promote.md` § Inputs after a ship (cwd `$MAIN_REPO_ROOT` once the worktree is gone). Straight alpha→stable → `open` item "Beta übersprungen …" + `delivery.promote.fastTrack: true`. A failed promotion never undoes the ship.
- **Step 5e — memory dream** (`deep-knowledge/memory-dream.md`), silent, only when memories were touched.
- **Step 6 — card** (`deep-knowledge/completion-card-payloads.md`, read before the call): pass `cwd`; `merged` ⇒ `ship-successful` (never downgrade for pending downstream checks); ONE `released` card when Step 5d promoted; promotion-gap nudge from `channels` / `betaLag` / `stableLag` (no own `git ls-remote`); append `hygiene.risk` / `open` / `openItems` to `open` (risk first), `result.tests` to `tests`. Execute the `[SESSION TITLE]` block before the card, the `[SESSION ARCHIVE]` call only when the hook says so. **The card is the last output** — nothing after it, no recap before it, no side topics on it (task chip instead).

## Reference files — every one is one level from here

Paths relative to `{PLUGIN_ROOT}/skills/do-ship/`. A *spec* describes what a tool already does — never repeat it by hand.

| File | Read when |
|---|---|
| `deep-knowledge/manual-pipeline.md` | the fallback (`DEVOPS_SHIP_RUN=0`, no `ship_run`, persistent `tool-error`), and for the full text of any step this driver names |
| `modes/delegated.md` | Pre-Step 0 — a `[ship-delegate]` block, or `--delegated` |
| `modes/resume.md` | Pre-Step R — `--resume`, also after a compaction mid-ship |
| `modes/promote.md` | Step 5d and every promotion-only run |
| `deep-knowledge/target-channel.md` | § Target channel — a negated channel, a version, or deciding "unshipped" |
| `deep-knowledge/session-title.md` | Pre-Step C — the title is unknown or the session tools are deferred |
| `deep-knowledge/composed-ships.md` | the `.claude/.ship-queue` marker, or `--delegated` / `--card-data` / `--resume` / `--inline` |
| `deep-knowledge/extensions.md` | Step 0 — the fields to capture from `reference.md` |
| `deep-knowledge/offline-cli.md` | Step 0.5 — the ship server failed to connect |
| `deep-knowledge/manual-ship.md` | Step 0.5 — the ship tools are absent |
| `deep-knowledge/preflight-rebase.md` | `preflight-failed` (dirty tree, markers) and `conflict` |
| `deep-knowledge/pre-flight.md` | *spec* of the `ship_preflight` checks |
| `deep-knowledge/repo-modes.md` | `mode: "file-only"` or `"git-no-remote"` |
| `deep-knowledge/purpose-alignment.md` | Step 1d, and the full check after a rebase |
| `deep-knowledge/ship-passes.md` | Step 1e — before the first pass |
| `deep-knowledge/quality-gates.md` | *spec* of the build gates, the CI gate and the early CI-quota probe |
| `deep-knowledge/codex-gate.md` | the Codex gate — rc 75, or the opt-in Claude API fallback |
| `deep-knowledge/build-id.md` | the card's `buildId` |
| `deep-knowledge/build-reuse.md` | a reused green test result — tree key, failure classes |
| `deep-knowledge/docs-sync.md` | Step 2.6 — every ship to main |
| `deep-knowledge/versioning.md` | Step 3 decision — the bump kind |
| `deep-knowledge/call-examples.md` | the `ship_*` payloads (fallback pipeline) |
| `deep-knowledge/release-results.md` | every release field beyond a clean `merged` |
| `deep-knowledge/release-flow.md` | *spec* of `ship_release`; § owner hand-off when the tag cannot be pushed |
| `deep-knowledge/post-merge-steps.md` | Steps 4a–4d |
| `deep-knowledge/post-merge-verify.md` | Steps 4b/4c — the project's `verify:` / `surfaces:` config |
| `deep-knowledge/cleanup.md` | Steps 5a–5c and the post-ship hygiene |
| `deep-knowledge/memory-dream.md` | Step 5e |
| `deep-knowledge/completion-card-payloads.md` | Step 6 — before `render_completion_card` |
| `deep-knowledge/data-flow.md` | the direct- and intermediate-ship data flow diagrams |
| `deep-knowledge/hierarchical-merge.md` | intermediate ships (sub-branch → feature branch → main) |
| `deep-knowledge/branching.md` | the branch naming (`<parent>-<role>`) hierarchical merges detect |
