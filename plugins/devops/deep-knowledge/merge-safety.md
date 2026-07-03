# Merge Safety — Parallel Development

Cross-cutting reference for preventing silent overwrites when multiple developers
(humans or agents) work in parallel. Referenced by `git-sync`, `/devops-ship`,
and agent collaboration flows.

## Core Principle

**Never discard changes silently.** Every merge conflict signals that two parties
changed the same area. Both changes may be valid. Strategies that blindly pick one
side (`--ours`, `--theirs`) destroy information and must never be used.

## Worktree Path Discipline

When the session runs in a git worktree (cwd is `…/.claude/worktrees/<name>/`),
resolve **every** file edit against the worktree root — never the bare main-repo
root (`…/<repo>/plugins/…`). They are separate working directories on separate
branches.

**Why:** the main checkout may run a parallel `/devops-ship` or `git-sync` that
does `git reset --hard` / `git checkout`. Uncommitted edits made to the main
checkout's files are silently wiped by that reset — the Edit tool reports
success, you see confusing "file modified since read" races, and the change is
gone. Edits in your own worktree are isolated and survive. If a path during a
worktree session lacks the `worktrees/<name>/` segment, it is wrong.

The same discipline applies to **reads during verification** (version checks,
cache-integrity diffs, file-presence audits). The main-repo working directory
may sit on a stale or unrelated branch — reading `plugin.json` (or any file)
from the bare main-repo root then reports *that* branch's state, not the
session's, and surfaces as a false version conflict. Source of truth for the
current version is the worktree, `main`, or the relevant tag — never the
main-repo cwd. Resolve version/source comparisons against `git show main:<path>`
or `git show <tag>:<path>`, not an absolute main-repo path.

This discipline extends to git-mutating commands (commit, checkout -b, merge,
rebase). See [git-hygiene.md § Session-worktree hygiene](git-hygiene.md#session-worktree-hygiene)
for the full tracked-or-gitignored invariant and enforcement points.

## Why Squash Merges Cause Data Loss

Squash merges sever Git's ancestry chain. When Dev B squash-merges to main, the new
commit has **no ancestry relationship** to B's original branch. When Dev A later merges,
Git uses the pre-B state as merge base — which can silently drop B's changes if A's
branch has an older version of overlapping files.

**Fix**: mandatory rebase before merge. This moves the merge base to current main,
forcing Git to surface real conflicts instead of silently overwriting.

## Required Git Config

Both developers MUST set these:

```bash
# Show base version in conflict markers (base + ours + theirs)
git config --global merge.conflictstyle diff3

# Better diff algorithm for code with repeated patterns
git config --global diff.algorithm histogram
```

`diff3` is critical — without it, conflict markers only show ours/theirs, making
it nearly impossible to understand what the base version was.

## GitHub Branch Protection (Recommended)

Enable on main branch:
- **Require branches to be up to date before merging** — forces rebase at platform level
- **Require pull request reviews** — catches structural changes a second pair of eyes would spot
- **Require status checks to pass** — prevents merging broken code

These protect against bypassing the plugin's rebase checks (e.g., manual `gh pr merge`).

## Mergiraf — AST-Aware Merge Driver

[Mergiraf](https://mergiraf.org) is a tree-sitter-based merge driver that understands
code structure. It catches semantic conflicts that line-based merging misses:

- Function deleted in one branch, modified in another → conflict (Git misses this)
- Import reordering vs. new import → clean merge (Git sometimes conflicts here)

### Setup

```bash
# Install (Rust/cargo)
cargo install mergiraf

# Configure as merge driver
git config --global merge.mergiraf.driver "mergiraf merge --git %O %A %B -s %S -x %X -y %Y -p %P"
git config --global merge.mergiraf.name "mergiraf"

# In project .gitattributes:
*.js merge=mergiraf
*.ts merge=mergiraf
*.json merge=mergiraf
*.yaml merge=mergiraf
*.md merge=mergiraf
```

Supported languages: JavaScript, TypeScript, JSON, YAML, Markdown, Python, Rust, Go,
Java, Scala, and more via tree-sitter grammars. Falls back to line-based merge for
unsupported or unparseable files.

## When This Applies

- `git-sync` cron merging parent branches into the current working branch
- Feature agent merging sub-agent branches at integration
- `/devops-ship` when base branch has diverged
- Any `git merge` or `git rebase` during collaborative work

## Conflict Resolution Protocol

### Step 1 — Attempt the merge

```bash
git merge <source> --no-edit
```

If clean merge succeeds, proceed to Step 5 (semantic verification).
If conflict → proceed to Step 2.

### Step 2 — Gather context

For each conflicted file:

1. Read the file with conflict markers (shows both sides inline)
2. Identify what each side changed relative to the common ancestor:
   - Ours (current branch): `git diff :1:<file> :2:<file>` (ancestor vs ours)
   - Theirs (incoming): `git diff :1:<file> :3:<file>` (ancestor vs theirs)
3. If ancestor is needed for full context: `git show :1:<file>`

### Step 3 — Classify each conflict hunk

| Classification | Description | Resolution |
|---|---|---|
| **Complementary — different sections** | Both sides add/modify non-overlapping areas | Keep both changes. |
| **Complementary — same section** | Both add content to the same area (e.g., two new functions, two new imports) | Keep both additions in logical order. |
| **Redundant** | Both sides made the same or equivalent change | Keep one copy. |
| **Superseding** | One change is a refinement of the other (e.g., rename + extended rename) | Keep the more complete version. |
| **Mutually exclusive — technical** | Different implementation of the same thing (import path, utility name, algorithm choice) where neither is a user-facing decision | AI picks the better option. No user question needed. |
| **Mutually exclusive — design** | Different user-facing choices (color, text, layout, behavior, feature toggle) | **Ask the user.** These are product decisions. |
| **Delete vs. modify** | One side deletes code the other side modified | Investigate intent. Deletion for cleanup → deletion likely wins. Modification adding functionality → modification likely wins. When unclear → ask user. |

### Step 4 — Resolve

For each hunk, based on classification:

1. **Auto-resolvable** (complementary, redundant, superseding, technical):
   Edit the file to contain the correct merged result. Stage with `git add`.

2. **User decision required** (mutually exclusive design choices, ambiguous delete-vs-modify):
   Batch all user-decision conflicts into a single `AskUserQuestion`. Present:
   - What each side intended (with file path and line context)
   - The common ancestor state ("originally it was X")
   - A recommendation if one option is clearly stronger

**Batching rule:** Resolve all auto-resolvable conflicts first. Then present
remaining conflicts in one question, not one question per conflict.

### Step 5 — Semantic verification

After all textual conflicts are resolved (or after a clean merge):

1. **Read the merged file** — verify it makes logical sense as a whole
2. **Check for silent semantic conflicts:** changes that merged cleanly on text
   level but may be logically incompatible. Common patterns:
   - Function signature changed on one side + new call added on the other without updated arguments
   - Type/interface extended on one side + existing usage assumes old shape on the other
   - Config key renamed on one side + new code references old key name on the other
   - Import added on one side + the module was moved/renamed on the other
3. **If the project has build/lint/typecheck** → run it to catch compilation errors
4. If semantic issues found → fix them as part of the merge resolution
5. **Purpose-level verification (ship flow only):** code-semantic checks catch
   broken wiring, not broken *intent*. During `/devops-ship`, the Purpose
   Alignment Gate additionally verifies that the merged result honors the
   goals and cross-cutting conventions of recently merged branches — in both
   directions (e.g. "all elements get hotkeys" must cover an element the
   other branch added, and a convention introduced on the shipping branch is
   retro-applied to existing artifacts).
   See `skills/devops-ship/deep-knowledge/purpose-alignment.md`. The git-sync
   cron resolves code-level conflicts only — purpose alignment runs at ship
   time.

### Step 6 — Complete the merge

```bash
git add <resolved-files>
git commit --no-edit
```

## How git-sync.js Handles Conflicts

As of v0.3.0, `git-sync.js` resolves conflicts in two tiers:

1. **Trivial conflicts** — resolved automatically without user intervention:
   - One side unchanged from base → take the other side
   - Both sides made identical changes → take either
   - Only whitespace differences on one side → take the substantive change

2. **Ambiguous conflicts** — merge is aborted, warning printed:
   - Both sides changed the same code in different ways
   - No trivial resolution determinable from the diff alone
   - Claude resolves semantically via the cron callback (Steps 2–6 above)

## How ship_release Prevents Overwrites

`ship_release` enforces a **two-phase rebase gate** plus a **post-merge tree
guard**. Together these make a parallel change on `base` impossible to drop or
overwrite — regardless of merge strategy.

### Phase 1 — entry gate (before push/PR)

1. `git fetch origin <base>` — get latest base
2. `isRebasedOnto(origin/<base>)` — verify HEAD includes all base commits
3. If not rebased → return `rebaseRequired: true` with overlap analysis
4. The ship skill (Step 1 loop) handles rebase + AI conflict resolution + test

### Phase 2 — pre-merge re-check (the critical one)

The entry gate alone is **not enough**: the pre-merge CI-checks gate blocks for
up to `checksTimeoutSec` (default 600s), and a parallel ship can land on `base`
during that wait. Crucially, the merge runs `gh pr merge --admin` — needed for
the bot to self-merge past required-review protection — which **bypasses
GitHub's own "require branches to be up to date before merging" rule**. So the
tool re-asserts `isRebasedOnto(origin/<base>)` immediately before the merge:

- still up to date → proceed to merge
- base advanced → return `rebaseRequired: true` + `baseAdvancedDuringChecks:
  true`, PR left **open** (not merged). The skill rebases and retries.

This restores, in our own code, the up-to-date guarantee that `--admin`
discards. It is the fix for the silent-overwrite vector in #207.

### Phase 3 — post-merge tree guard

After the merge, `treeOf(HEAD)` is compared to `treeOf(origin/<base>)`. Because
Phase 2 guarantees `HEAD ⊇ origin/base` at merge time, the merge is
**fast-forward-equivalent for every strategy** (squash/merge/rebase all yield
`base`'s tree == HEAD's tree). So:

- **`postMergeTreeMatch: true`** → `base` captured exactly the tree that was
  rebased + built + tested. The pre-merge build/test **is** the post-merge
  validation — no separate post-merge build needed.
- **`postMergeTreeMatch: false`** → a concurrent ship squeezed into the ~1s
  window between the re-check and gh's merge and was three-way merged in (its
  changes are **preserved**, not lost), or an unexpected divergence. Non-fatal
  (the merge already landed) but surfaced as `postMergeWarning` so the skill
  flags "verify main is consistent".

### Why squash is safe here

The classic squash data-loss (see "Why Squash Merges Cause Data Loss" above)
requires merging **without** a rebase. Phase 2 forbids that: every merge —
intermediate *and* final — is ff-equivalent, so the squash commit's tree equals
HEAD's tree and a later branch sharing history is itself forced to rebase before
it can merge. `squash` therefore cannot sever ancestry in a data-losing way. The
skill still upgrades `squash` → `merge` when preflight reports file overlap, as a
belt-and-suspenders for history readability.

### Force-push scoping

The `git push --force-with-lease` only ever targets the **feature branch**,
never `base` — so it cannot clobber base commits. It uses an **explicit lease**
pinned to the last-known remote sha (`--force-with-lease=<branch>:<sha>`) rather
than the bare form, so an implicit background fetch (the git-sync cron) cannot
widen the lease and let a concurrent push to the same branch slip through
unseen. Brand-new branches (no remote-tracking ref) push without a lease.

## Timestamp Caveat

Git merge resolution is based on the commit DAG, not timestamps. A commit authored
earlier may appear "newer" if it was pushed or pulled later. **Never assume temporal
ordering implies correctness.** The only reliable signal is the content diff against
the common ancestor.

Example: Developer A makes a change at 10:00, pushes at 10:05. Developer B pulls
at 09:50 (before A's push), makes changes at 10:10, pulls again at 10:15 (now
sees A's commit). Both changes are equally valid — timestamp ordering is irrelevant.

## Escalation Rules

| Situation | Action |
|---|---|
| All conflicts auto-resolvable | Resolve silently, report summary |
| Mix of auto and user-decision | Resolve auto conflicts first, batch remaining for one `AskUserQuestion` |
| Build/lint fails after resolution | Fix if cause is obvious, otherwise ask user |
| >10 conflicted files | Flag to user — suggests structural divergence that may need coordination |
| Same file modified by 3+ parties | Extra caution — read the full file after resolution, not just the hunks |

## Scope: Merge Operations

This protocol is written for `git merge` operations. Rebase and cherry-pick
have **reversed ours/theirs polarity**:

| Operation | "Ours" is | "Theirs" is |
|---|---|---|
| `git merge` | Current branch (HEAD) | Incoming branch |
| `git rebase` | Upstream (the branch you rebase onto) | Your patch being replayed |
| `git cherry-pick` | Current branch (HEAD) | The cherry-picked commit |

When resolving rebase or cherry-pick conflicts, swap "ours" and "theirs" in
the classification logic. The semantic intent analysis (Step 3) remains the
same — only the side labels change.

## Anti-Patterns

- **`--ours` / `--theirs`**: Silently drops one side's work. **Never use.**
- **Skipping conflicts**: Leaving conflict markers (`<<<<<<<`) in code. Never commit unresolved markers.
- **Retry without analysis**: Re-running merge hoping it works. Diagnose the conflict first.
- **Timestamp-based priority**: "Their commit is newer so it wins." Timestamps don't determine correctness.
- **Asking the user for every conflict**: Auto-resolve complementary/technical changes. Only escalate genuine design decisions.
- **Resolving without reading context**: A conflict hunk in isolation is ambiguous. Read surrounding code and the full diff to understand intent.
