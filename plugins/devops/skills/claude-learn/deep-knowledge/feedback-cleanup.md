# Feedback-Memory Cleanup — Mechanics

Execution detail for `/claude-learn` Step 4. The rule is one line — *the
canonical file now owns this rule, so a duplicate `feedback_*.md` entry is
stale* — but resolving the memory directory correctly is fiddly enough to
live outside the skill body.

## When this runs

Only after the learning was actually persisted **locally** (branches A and C).
Branches B and D created an issue and wrote nothing here, so there is no
canonical file to supersede anything — leave auto-memory alone.

## 1. Resolve the project memory dir

The path is `~/.claude/projects/<encoded-cwd>/memory/`, where `<encoded-cwd>`
replaces each `:`, `\`, and `/` in the **canonical absolute path** with `-`.

Before encoding:

- Resolve symlinks (`realpath` semantics).
- Preserve the OS's native drive-letter case (Windows: as reported by
  `git rev-parse`).
- **In a worktree, use the MAIN project path, not the worktree path.** Derive it
  via `git worktree list --porcelain` and take the first `worktree` entry — that
  is always the primary checkout. Do NOT trim `git-common-dir`: it fails for
  `core.worktree`, `core.bare`, separate-git-dir, and submodule layouts.

Confirm the resulting directory exists with Glob; if not, skip the whole step
silently. For non-standard paths (UNC, network shares) where the encoding looks
ambiguous (e.g. a leading `\\server`), skip rather than guess.

## 2. List candidates

Glob `feedback_*.md` in that directory and read `MEMORY.md` (the index). No
`feedback_*` files → skip silently.

**Only ever target `feedback_*.md`.** Never touch `user_*`, `project_*`, or
`reference_*` memories — different lifecycles, and not what this skill replaces.

## 3. Match semantically

For each candidate, read its frontmatter `description` and the first ~10 body
lines. A match means: same intent **and** same trigger condition **and**
non-trivial overlap with the rule just written — not merely "same broad topic".
Be conservative; in doubt, treat as non-match and skip.

## 4. Confirm per match

Zero matches → no output, continue.

One or more → AskUserQuestion (one question per match, or `multiSelect` for
bulk). Show file name, description, and which new file now owns the rule:

- **Löschen** (Recommended) — Regel lebt jetzt in `<new file>`
- **Behalten** — bleibt als persönliche Präferenz relevant
- **Erst vollständig anzeigen**

## 5. Apply

Per confirmed deletion: delete the `feedback_*.md` file, remove its bullet from
`MEMORY.md` (Edit, not Write), and add the path to the Step 5 report.
