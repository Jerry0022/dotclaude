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
node "$CLAUDE_PLUGIN_ROOT/scripts/devops-config.js" list                      # effective values + where each comes from
node "$CLAUDE_PLUGIN_ROOT/scripts/devops-config.js" set cleanup.nudgeThreshold 80 --project
node "$CLAUDE_PLUGIN_ROOT/scripts/devops-config.js" set cleanup.autoClean false --global
node "$CLAUDE_PLUGIN_ROOT/scripts/devops-config.js" unset cleanup.nudgeThreshold --project   # back to global/default
```

Run them from the project's directory (or pass `--cwd <dir>`). The script
validates key and value and refuses anything else — never edit the JSON by
hand. Confirm the change in one line with the new effective value.

## Settings

### `cleanup` — branch/worktree hygiene after a ship

| Key | Default | Meaning |
|---|---|---|
| `autoClean` | `true` | After a successful ship, remove old leftovers on its own (branches and clean session worktrees whose content provably landed). |
| `autoCleanGateDays` | `30` | The automatic cleanup only runs once a removable leftover is older than this. |
| `autoCleanMinAgeDays` | `7` | …and then removes every removable leftover older than this; younger ones only via the cleanup page. |
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
