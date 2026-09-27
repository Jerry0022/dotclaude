# Ship — Pre-flight and rebase details

Referenced by `/do-ship` Step 1a and Step 1b. Moved verbatim from SKILL.md;
the gate decisions (BLOCK, lockout, STOP) stay in the skill.

## Dirty tree from untracked files

The Desktop app refuses to archive a session whose worktree is dirty, and it
copies the main checkout's untracked `.claude/` into every new worktree. An
untracked file moved aside so preflight passes and put back after the merge
blocks the archive — observed with `.claude/graphify.json` (2026-09-23). Settle
each file where it belongs, inside this ship:
- **Plugin configuration** (`.claude/graphify.json`, `settings.json`, the rest
  of the *MUST be tracked* list in `{PLUGIN_ROOT}/deep-knowledge/project-setup.md`
  § .gitignore) → commit it. Include it in the ship when it matches the main
  checkout's copy.
- **Plugin runtime state** → it belongs in `hooks/lib/runtime-ignores.js`, which
  `ss.project.setup` writes into `.git/info/exclude` at every session start (a
  file missing there is a plugin bug — add it to that list), or delete it when
  it is a stray hook artifact (e.g. a `.claude/` created in a subdirectory).

## Rebase conflict resolution

   a. `git diff --name-only --diff-filter=U` to list conflicting files.
   b. For each conflicting file:
      - Read the file (contains `<<<<<<<`/`|||||||`/`=======`/`>>>>>>>` markers with diff3 base section)
      - Analyze **both sides semantically**: what did our branch change vs. what did base change?
      - Check **chronological context**: which change is newer? Do they contradict or complement each other?
      - Produce a merged version that preserves **both** intents
      - Write the resolved file, then `git add <file>` — with **all four** marker
        lines removed, `|||||||` included. Deleting the familiar three and
        leaving the diff3 base marker is the failure `no-conflict-markers` exists
        for; it blocks the ship at Step 4 rather than landing on main.
   c. `git rebase --continue`
   d. If more conflicts appear (multi-commit rebase), repeat (b)–(c)

## Base auto-detection

The tool **auto-detects** the correct base branch:
- If on a sub-branch like `feat/42-video-filters-core`, it detects `feat/42-video-filters` as the parent and uses it as base.
- Otherwise it uses the repository's default branch (resolves `origin/HEAD` — typically `main`, but `master` or any other name works too). Falls back to `main` if `origin/HEAD` is not set.
- You can override by passing an explicit base: `ship_preflight({ base: "feat/42", cwd: "<cwd>" })`.
