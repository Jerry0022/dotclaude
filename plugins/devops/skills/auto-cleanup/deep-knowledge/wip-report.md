# Repo-Health — WIP-report input mode

Read by `SKILL.md` ("Where this skill sits") when the user says
`WIP-Report aufräumen` / "wip report aufräumen", or the skill is invoked for
the report. The opt-in WIP watch (`scripts/wip-watch.js`, runbook
`{PLUGIN_ROOT}/deep-knowledge/wip-watch.md`) wrote the report in a pure-node
job — zero tokens. Opening this page is the only token-costing step.

## Differences to the single-repo run

| Single-repo run | WIP-report mode |
|---|---|
| Step 0: cwd must be a git repo | No cwd check — the report names the repos. Step 0 applies per repo, at execution (`git -C <repo> rev-parse --is-inside-work-tree`) |
| Steps 1–7: investigate the current repo | **Skipped.** Load `~/.claude/wip-watch/report.json` instead; it already holds the findings. Missing/unreadable file or `version` != 1: say so, offer `node "{PLUGIN_ROOT}/scripts/wip-watch.js" scan`, end |
| One repo header card | One group per `repos[]` entry (path, default branch, finding count) |
| Pre-check by Löschbar/Untersuchen | Pre-select each finding's `suggestion.action`; the user picks per item |

A report older than 7 days (`generatedAt`) is flagged on the page header; the
per-item re-verification below is what makes it safe to act on regardless.

## Page

Use the existing audit/concept page (Step 8, `page-structure.md`,
`auto-concept` templates): one section per repo, one row per finding with
kind, ref (branch / worktree path / stash), ahead/behind, age, the reason
text, a "?" detail (Step 7 data may be gathered lazily per row) and a
per-item action select. Action ids and what they do:

| `action` | Meaning when chosen | Needs |
|---|---|---|
| `delete` | local branch removal (content is in the default branch) | Deletion gate, `repo-health-audit.js` pass |
| `push-pr` | push the branch, open a PR, then land it via `/do-ship` | Step 10b ship queue |
| `reimplement` | do NOT merge the old branch: start a fresh branch off the current default branch and re-do the work, using the old branch as reference; keep the old branch until the user deletes it | a separate task, offered afterwards |
| `commit` | commit the dirty worktree on its branch and push (secure it) | worktree's session is not running |
| `discard` | discard uncommitted changes (`git restore`/`clean`) | own explicit `Unmerged`-style yes naming the worktree and file count |
| `stash-branch` | `git stash branch <name> <stash>` (secure as a branch) | |
| `stash-drop` | `git stash drop <stash>` | own explicit yes naming the stash |
| `prune` | `git worktree prune` | |
| `review` | uninspectable — show details only; never pre-select a destructive choice | |
| `keep` | do nothing (always offered) | |

`delete`, `discard` and `stash-drop` are the destructive ones: none is ever
carried out without the Dry-Run-Confirm and, where listed, its own yes. A
finding with `landed: false` is never pre-selected for `delete` regardless of
what the file says.

## Execution

Per repo, with that repo as cwd (`git -C` is not enough for the gate hook —
run the commands from the repo directory):

1. Rebuild the protected set (`git worktree list --porcelain`) — SAFETY holds
   for every repo, including live session worktrees.
2. **Re-verify each chosen item against the live repo before acting**:
   branch tip still equals the report's (`id` is a hash of repo + kind + ref +
   tip, so recompute or compare the tip); worktree still dirty / still
   missing; stash sha unchanged (stash indexes shift — resolve by sha). Any
   drift: skip the item, say why, never act on the stale record.
3. For `delete`, re-check the content rule (`scripts/lib/content-landed.js`
   `contentInBase`) or the merged-PR head; a branch that no longer proves
   landed is skipped.
4. One Apply-Manifest + Dry-Run-Confirm (`execution.md` § Step 10a) for the
   whole run, grouped per repo, listing every action by full name; then execute
   repo after repo. `push-pr` items go through Step 10b.
5. Completion card as in Step 11, summary names the repo count.

After a successful run, suggest `node "{PLUGIN_ROOT}/scripts/wip-watch.js" scan`
to refresh the report (it never notifies).
