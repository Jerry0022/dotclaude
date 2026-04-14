# Merge Safety — Parallel Development

Cross-cutting reference for preventing silent overwrites when multiple developers
ship to the same branch. Referenced by `/devops-ship` (Step 1.5) and `git-sync.js`.

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

## How git-sync.js Handles Conflicts

As of v0.2.0, `git-sync.js` **never auto-resolves conflicts**. When a merge from a
parent branch (e.g., main → feature) conflicts:

1. The merge is **aborted** immediately
2. A warning is printed with the list of conflicting files
3. The developer must rebase manually before shipping

This prevents the previous behavior where `--ours` silently discarded parent branch
changes — the #1 cause of lost work in parallel development.

## How ship_release Prevents Overwrites

The release tool verifies the branch is rebased before allowing merge:

1. `git fetch origin <base>` — get latest base
2. `isRebasedOnto(origin/<base>)` — verify HEAD includes all base commits
3. If not rebased → return `rebaseRequired: true` with overlap analysis
4. The ship skill (Step 1.5) handles rebase + AI conflict resolution + test

Additionally, when file overlap is detected in preflight, the skill switches from
`squash` to `merge` strategy to preserve the ancestry chain for future merges.
