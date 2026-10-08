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
| `--project` | `<main checkout>/.claude/devops-config.json` | this clone and all its worktrees; never committed (excluded via `.git/info/exclude`) |
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

## Settings

### `cleanup` — branch/worktree hygiene after a ship

| Key | Default | Meaning |
|---|---|---|
| `autoClean` | `true` | After a successful ship, remove old leftovers on its own (branches, clean session worktrees and a removed branch's same-commit twin on origin, all only when their content provably landed). |
| `autoCleanGateDays` | `30` | The automatic cleanup only runs once a removable leftover is older than this. |
| `autoCleanMinAgeDays` | `30` | …and then removes every removable leftover older than this; younger ones only via the cleanup page. Worktree removal never touches a session's conversation — transcripts follow Claude Code's own `cleanupPeriodDays`. |
| `autoCleanKeepNewest` | `20` | Count trigger: more removable leftovers than this → all but the newest 20 go, whatever their age. A busy repo (~10 sessions a day) never reaches the age gate; the newest 20 stay as recent reference. `0` = off. |
| `autoCleanMaxGB` | `10` | Disk trigger: the kept removable session worktrees, summed newest first, above this many GB → the one crossing the line and every older one lose their checkout (mostly `node_modules`); their branch stays. Sizes are measured at most 30 s per ship and cached in `~/.claude/devops-hygiene.json`. `0` = off. |
| `nudge` | `true` | After a successful ship or promote, suggest the cleanup page when too much piles up. |
| `nudgeThreshold` | `50` | Suggest it when more than this many branches/worktrees lie around. |
| `nudgeCooldownDays` | `7` | Days of silence after a suggestion (0 = after every ship above the threshold). |

Calibration of the defaults (plugin source repo, heavy single-project use):
19 / 25 / 32 PRs in the ISO weeks 36–38 of 2026, 52 in the first four days of
week 39. At 50 the hint comes about every one to two weeks in a normal-to-high
week; the 7-day cooldown keeps it weekly at most in peak weeks.

What the automatic cleanup never touches, whatever the settings: branches or
worktrees with unshipped content, worktrees with uncommitted changes, locked
worktrees, worktrees outside `.claude/worktrees/`, the current worktree, the
default branch, remote branches. Those stay for the cleanup page ("branch
cleanup" / "branches aufräumen" — the auto-cleanup skill).

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

### `ship` — what happens after a successful ship

| Key | Default | Meaning |
|---|---|---|
| `archiveAfterShip` | `true` | Desktop app: right after the card of a successful ship (`ship-successful` / `released`, merged) the session archives itself. Never for any other card, with an explicit keep (`--keep`, follow-up signals), pending agents/tasks/workflows, open points or user tests on the card, a dirty work tree, or while an autonomous run or ship queue still works. `false` → the session stays in the sidebar. |

"Session nach dem Ship nicht archivieren" → `ship.archiveAfterShip false`.
Background: `deep-knowledge/claude-desktop-app-setup.md` § Session archiving
after ship.
