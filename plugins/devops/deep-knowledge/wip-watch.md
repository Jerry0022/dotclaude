# WIP Watch (opt-in)

A weekly pure-node job that finds work existing nowhere else — unlanded
branches, dirty or broken worktrees, old stashes — and nudges you once. Off by
default; script `scripts/wip-watch.js`. It only REPORTS: it never deletes,
prunes, fetches, pushes or starts Claude.

## Enable / disable / status

"WIP-Wächter an":

```bash
node "{PLUGIN_ROOT}/scripts/wip-watch.js" enable --roots ~/IdeaProjects --day sun
```

`--roots` (comma-separated, default `~/IdeaProjects`) and `--day` (mon..sun,
default sun) are optional; they are saved in the global `wipWatch.*` settings
(`devops-config.md`) and the weekly job is registered at 10:00 (Windows Task
Scheduler with catch-up after a missed run, crontab elsewhere). If the job
cannot be registered, the watch stays off. The job runs the launcher
`~/.claude/devops-jobs/wip-watch.js`, which finds the newest installed devops
plugin at run time — plugin updates need no re-run of `enable`.

- "WIP-Wächter aus": `node "{PLUGIN_ROOT}/scripts/wip-watch.js" disable`
- Status: `node "{PLUGIN_ROOT}/scripts/wip-watch.js" status`
- Look now (no notification, report refreshed): `... scan [--json]`

Also tunable: `wipWatch.discardAfterWeeks` (default 8).

## What it detects

Discovery: each root itself and its direct children that are main git
checkouts. Linked worktrees are covered through `git worktree list`. The
comparison base is the existing `refs/remotes/origin/<default>` (default from
`origin/HEAD`, else main/master) — no `git fetch`, so a stale remote ref means
a stale comparison. The only network call is an optional, 20 s-bounded
`gh pr list --state merged`; without gh it is skipped.

| Finding | Condition |
|---|---|
| `branch` | local branch with no upstream or a gone upstream, or with unpushed commits, whose content is not in the default branch |
| `worktree-dirty` | `status --porcelain` non-empty (main checkout and linked worktrees); untouched for less than 1 day is skipped as a probably running session |
| `stash` | stash older than 30 days |
| `worktree-broken` | `git worktree list` says prunable, or the directory is gone |

"Landed" uses the same combination as ship hygiene: ancestor of the remote
default branch, or the tip is the head of a merged PR, or the content rule
(`scripts/lib/content-landed.js`: every file the branch changed is identical
in main, or re-applying its changes onto main is a no-op). Squash merges count
by content; a squash-merged PR whose files main changed later still counts
through its merged-PR head. History reachability alone never counts. Anything
a git call cannot answer fails closed: action `review`, never landed.

## Suggestions (rule based, no model)

| Finding | Action | Rule |
|---|---|---|
| branch, content in main | `delete` | listed, but never notifies |
| branch, ahead and `git merge-tree --write-tree` is clean | `push-pr` | push, open a PR / merge |
| branch, conflicts or >= 50 commits behind | `reimplement` | redo on current main |
| branch, uninspectable | `review` | check by hand |
| dirty worktree | `commit` | commit and secure; `discard` if untouched > `discardAfterWeeks` |
| old stash | `stash-branch` | secure as branch; `stash-drop` if older than `discardAfterWeeks` |
| broken worktree | `prune` | `git worktree prune` |

## Report and notification

`~/.claude/wip-watch/report.json` (`{version:1, generatedAt, roots, repos:[{path,
defaultBranch, findings:[{id, kind, branch?, worktree?, stash?, ahead, behind,
ageDays, landed, suggestion:{action, reason}}]}], fingerprint}`). The finding
`id` is a hash of repo + kind + ref + tip sha.

Notify-worthy = every finding that is not `landed` (un-landed work or broken
state). `~/.claude/wip-watch/state.json` keeps the ids of the last notified
set. A run notifies only when it has at least one notify-worthy finding AND at
least one id not in that set; a subset of the notified set stays silent; zero
findings never notify ("all ok" does not exist) and reset the set so a later
finding notifies again. A notification that could not be shown is retried next
run. The toast carries the count, the report path and the prompt to paste:

> WIP-Report aufräumen

That phrase starts `auto-cleanup` in its WIP-report input mode: one page,
findings grouped per repo, each item's suggested action pre-selected, you pick
per item, execution runs per repo behind the Apply-Manifest + Dry-Run-Confirm
with each item re-verified first. The job itself never invokes Claude.

## Token cost

Zero. Scan, report and notification are plain node + git; tokens are spent only
when you open the cleanup page.
