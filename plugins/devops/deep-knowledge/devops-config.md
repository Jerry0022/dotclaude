# Plugin Settings (devops-config)

How to change devops plugin behaviour when the user asks in plain words — per project or for every project on the machine. No skill: a settings file plus `scripts/devops-config.js`.

## When this applies

The user says how the plugin should behave, in any words: "in diesem Projekt
nie automatisch aufräumen", "den Aufräum-Hinweis erst ab 80 Branches", "überall
nur Hinweise, nichts selbst löschen", "wie ist der Cleanup eingestellt?". Only
the settings below exist — for anything else, say it is not configurable
instead of inventing a key.

## Scope — the user's call

| Scope | File | Applies to |
|---|---|---|
| `--project` | `<main checkout>/.claude/devops-config.json` | this clone and all its worktrees; never committed (listed in the managed `.gitignore` block) |
| `--global` | `~/.claude/devops-config.json` | every project on this machine without its own value |

Resolution per key: project > global > default. "Hier", "in diesem Projekt" →
`--project`; "überall", "immer", "in allen Projekten", "global" → `--global`.
When the words do not say which, ask with `AskUserQuestion` ("Nur dieses
Projekt" / "Alle Projekte") — never pick silently.

## Commands

```bash
node "{PLUGIN_ROOT}/scripts/devops-config.js" list                      # effective values + where each comes from
node "{PLUGIN_ROOT}/scripts/devops-config.js" set cleanup.nudgeThreshold 80 --project
node "{PLUGIN_ROOT}/scripts/devops-config.js" set cleanup.autoClean false --global
node "{PLUGIN_ROOT}/scripts/devops-config.js" unset cleanup.nudgeThreshold --project   # back to global/default
```

Run them from the project's directory (or pass `--cwd <dir>`). The script
validates key and value and refuses anything else — never edit the JSON by
hand. Confirm the change in one line with the new effective value.

## Channel features

Every release ships to all channels, but some features are marked for a
channel: an **alpha** feature is offered only when the plugin's marketplace is
pinned to `alpha`, a **beta** feature to `alpha` and `beta`. A `stable` pin
(the default — also when the pin is missing or unreadable) gets none of them:
their docs are not loaded and their scripts exit 126. The pin lives in
`~/.claude/plugins/.channels.json` (`{"<marketplace>": "alpha"|"beta"|"stable"}`).
Which features exist and which are on for this machine:

```bash
node "{PLUGIN_ROOT}/scripts/feature-flag.js" list          # JSON: channel + each feature's allowed flag
node "{PLUGIN_ROOT}/scripts/feature-flag.js" check <name>  # exit 0 allowed, 126 not on this channel
```

Never offer or describe a feature that `list` reports as not allowed.

## Settings

### `cleanup` — branch/worktree hygiene after a ship

| Key | Default | Meaning |
|---|---|---|
| `autoClean` | `true` | After a successful ship, remove old leftovers on its own (branches, clean session worktrees and a removed branch's same-commit twin on origin, all only when their content provably landed). |
| `autoCleanGateDays` | `3` | The automatic cleanup only runs once a removable leftover is older than this. |
| `autoCleanMinAgeDays` | `3` | …and then removes every removable leftover older than this; younger ones only via the cleanup page. Worktree removal never touches a session's conversation — transcripts follow Claude Code's own `cleanupPeriodDays`. |
| `autoCleanKeepNewest` | `5` | Count trigger: more removable leftovers than this → all but the newest 5 go, whatever their age. A busy repo (~10 sessions a day) never reaches the age gate; the newest 5 stay as recent reference. `0` = off. |
| `autoCleanMaxGB` | `10` | Disk trigger: the kept removable session worktrees, summed newest first, above this many GB → the one crossing the line and every older one lose their checkout (mostly `node_modules`); their branch stays. Sizes are measured at most 30 s per ship and cached in `~/.claude/devops-hygiene.json`. `0` = off. |
| `nudge` | `true` | After a successful ship or promote, suggest the cleanup page when too much piles up. |
| `nudgeThreshold` | `50` | Suggest it when more than this many branches/worktrees lie around. |
| `nudgeCooldownDays` | `7` | Days of silence after a suggestion (0 = after every ship above the threshold). |

Also part of every automatic cleanup (not separate settings):

- **Landed proof via PR chain.** A branch counts as landed when its tip is an
  ancestor of a merged PR's head (an integration branch that collected
  sub-agent branches) and that head still holds all of the branch's changes.
  Commits made on the integration branch after its PR merged keep it unlanded.
  Needs `gh`; offline the old proof applies.
- **Backup expiry.** `backup/*` and `rescue/*` branches on origin older than
  14 days whose content is landed (or covered by a landed leftover) are
  deleted from origin (`trigger: "backup-expiry"` in the removal log).
- **Temp worktrees.** Registered worktrees below the OS temp dir (eval
  variants, deploy-parity builds), idle over 1 h and not locked by a live
  process, are removed once clean and landed (or detached).
- **Stale own PRs.** The card gets a ⚠ OFFEN item per own open PR that is
  superseded by main or untouched for over 5 days with no worktree on its
  head. Nothing is closed automatically.

Calibration of the defaults (plugin source repo, heavy single-project use):
19 / 25 / 32 PRs in the ISO weeks 36–38 of 2026, 52 in the first four days of
week 39. At 50 the hint comes about every one to two weeks in a normal-to-high
week; the 7-day cooldown keeps it weekly at most in peak weeks.

What the automatic cleanup never touches, whatever the settings: branches or
worktrees with unshipped content, worktrees with uncommitted changes, locked
worktrees, worktrees outside `.claude/worktrees/`, the current worktree, the
default branch, remote branches. Those stay for the cleanup page ("branch
cleanup" / "branches aufräumen" — the auto-cleanup skill).

### `concept` — the auto-concept round loop

| Key | Default | Meaning |
|---|---|---|
| `roundAgent` | `true` | From round 2 on, a sub-agent writes the round fragment (auto-concept SKILL.md § Round author). The session keeps only its short report, so its context does not grow with every round. `false` → every round is written in the session itself. |

"Konzept-Runden ohne Sub-Agent" → `concept.roundAgent false`. The page's look
(tokens, fonts, CSP) is no setting: it lives in a `head.html` (per concept, or
per project at `.claude/skills/auto-concept/head.html`).

### `deployParity` — the deploy-parity build before a ship merges

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `/do-ship` Step 2.5 builds the commit the way the deploy host will (clean checkout, fresh lockfile install, host build command incl. npm `pre`/`post` hooks) and blocks the merge when that build fails. `false` → skipped with a card line. |
| `timeoutSec` | `600` | Budget for install + build together (30–7200). Running out reads as *inconclusive*, never as failed. |

"Keinen Deploy-Build vor dem Ship" → `deployParity.enabled false`; "der
Host-Build darf 20 Minuten dauern" → `deployParity.timeoutSec 1200`. The build
command itself, extra released env names and a hard team-wide opt-out belong in
the committed ship extension (`deployParity:` block in the project's
`.claude/skills/do-ship/reference.md`), not here. Details:
`deep-knowledge/deploy-parity.md`.

### `workspace` — where new work runs

| Key | Default | Meaning |
|---|---|---|
| `ownWorktree` | `false` | `true` → new work started in the main checkout goes straight into its own worktree, also when that checkout holds uncommitted/unpushed changes: ss.git.check reports them but no longer asks "Wo soll die Arbeit laufen?". Set for the project automatically the first time one of its sessions enters a worktree (post.worktree.enter), so the question comes at most once per project. |

"Nie mehr fragen, immer eigener Worktree — überall" → `workspace.ownWorktree true --global`.
"Hier bleiben" stays the `DEVOPS_ALLOW_MAIN=1` bypass in `.claude/settings.local.json`.

### `ship` — what happens after a successful ship

| Key | Default | Meaning |
|---|---|---|
| `archiveAfterShip` | `true` | Desktop app: right after the card of a successful ship (`ship-successful` / `released`, merged) the session archives itself. Never for any other card, with an explicit keep (`--keep`, follow-up signals), pending agents/tasks/workflows, open points or user tests on the card, a dirty work tree, or while an autonomous run or ship queue still works. `false` → the session stays in the sidebar. |

### `apiCredit` — read-only side work on the plan's monthly API credit (opt-in)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Read-only side work (sweeps, research, reviews, audits) runs on the Claude API credit of the linked Console org first — `scripts/claude-api-agent.js`, `claude-api-safe.js` when Codex is skipped, `api-credit-audit.js`, evals from the user's terminal — with the plan as the fallback. Claude Code itself always stays on the plan. |
| `webGuide` | `false` | With `enabled` on and no key stored, offer the one-time auto-guide through the Console (workspace, spend limit, key). |
| `contextEditing` | `true` | The API agent loop clears old tool results once the prompt passes 100k tokens (keeps the last 3, frees at least 60k) to cut cache cost. Env `DEVOPS_API_CONTEXT_EDITING=0` disables. |

"Nutze mein API-Guthaben" → the two questions and the `--global` writes in
`deep-knowledge/api-credits.md` § Activation — never set these silently.

### `homeBackup` — daily backup of `~/.claude` to a private repo (opt-in, global only)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | A daily OS job (Task Scheduler / crontab) runs `scripts/home-backup.js run`: stage the allowlist, scan for secrets and private data, commit + push only when something changed and nothing was found. Pure node — zero model tokens. |
| `repo` | `''` | The private backup repo, `<owner>/<name>`. |

Never set these with `set`: "richte Home-Backup ein" → `scripts/home-backup.js
setup --repo <owner>/claude-home` (creates the repo, registers the job, writes
both keys); "Home-Backup aus" → `home-backup.js disable` (removes the job, sets
`enabled false`). Runbook: `deep-knowledge/home-backup.md`.

### `wipWatch` — weekly WIP watch over your repos (opt-in, global only)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | A weekly OS job runs `scripts/wip-watch.js run`: un-landed local branches, dirty or broken worktrees, old stashes under the roots → `~/.claude/wip-watch/report.json`, one notification only when something new turned up. Pure node — zero model tokens. |
| `roots` | `~/IdeaProjects` | Comma-separated folders; each folder and its direct child repos are scanned. |
| `day` | `sun` | Weekday of the run (`mon` … `sun`). |
| `discardAfterWeeks` | `8` | Dirty worktrees and stashes untouched longer than this get "discard" instead of "secure" as suggestion. |

"WIP-Wächter an" → `scripts/wip-watch.js enable [--roots …] [--day …]`
(registers the job and sets `enabled`); "WIP-Wächter aus" → `wip-watch.js
disable`. `roots`, `day` and `discardAfterWeeks` may be changed with `set …
--global`; after a `day` change run `enable` again so the job moves. Runbook:
`deep-knowledge/wip-watch.md`.

"Session nach dem Ship nicht archivieren" → `ship.archiveAfterShip false`.
Background: `deep-knowledge/claude-desktop-app-setup.md` § Session archiving
after ship.

### `sessionEnd` — safety net for unsaved session work

| Key | Default | Meaning |
|---|---|---|
| `autosave` | `local` | When a turn ends in a session worktree (`.claude/worktrees/<name>`) holding uncommitted work or unpushed commits and no open PR, `stop.session.autosave` saves a snapshot commit (temporary index; your branch, index and files are never touched) on the local branch `parked/autosave/<name>` — one stable ref per worktree, so the park register lists it. `push` also pushes that ref (never force) and fast-forwards the session branch only if it already exists on origin; a branch that was never pushed or was deleted after a merge is never (re)created. `off` = nothing. Secrets (`.env*`, keys, credentials, dumps), build output, tooling files and files over 5 MB are left out (the notice says how many). Skipped: during a ship, a merge/rebase/cherry-pick in progress, protected branches (main/master/develop/trunk/release/*), the plugin cache, once per 10 min per worktree. Known gap: with an open PR nothing is saved. |
