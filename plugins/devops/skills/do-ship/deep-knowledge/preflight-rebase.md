# Ship — Pre-flight and rebase details

Referenced by `/do-ship` Step 1a and Step 1b. Moved verbatim from SKILL.md;
the gate decisions (BLOCK, lockout, STOP) stay in the skill.

## Dirty tree from untracked files

The Desktop app refuses to archive a session whose worktree is dirty, and it
copies the main checkout's untracked `.claude/` into every new worktree. An
untracked file moved aside so preflight passes and put back after the merge
blocks the archive — observed with `.claude/settings.json` (2026-09-23). Settle
each file where it belongs, inside this ship:
- **Plugin configuration** (`.claude/settings.json`, the rest
  of the *MUST be tracked* list in `{PLUGIN_ROOT}/deep-knowledge/project-setup.md`
  § .gitignore) → commit it. Include it in the ship when it matches the main
  checkout's copy.
- **Plugin runtime state** → it belongs in `hooks/lib/runtime-ignores.js`, which
  renders into the managed `# >>> claude (managed) >>>` block of `.gitignore`
  (`scripts/claude-ignore.js migrate`; a file missing there is a plugin bug —
  add it to that list), or delete it when
  it is a stray hook artifact (e.g. a `.claude/` created in a subdirectory).

## Rebase loop

Step 1b, only when `needsRebase: true`:

1. **Set diff3** (if `config-conflictstyle` warning): `git config merge.conflictstyle diff3`

2. **Rebase onto base**:
   ```bash
   git fetch origin <base>
   git rebase origin/<base>
   ```

3. **If rebase succeeds** (no conflicts): push and re-check (go to 1c).

4. **If rebase has conflicts** — resolve them autonomously (do NOT ask user):
   follow § Rebase conflict resolution below, steps a–d (resolve both intents
   semantically, remove **all four** marker lines incl. `|||||||`, `git add`,
   `git rebase --continue`, repeat).
   e. **Truly ambiguous conflicts** (both sides change the same logic in contradictory ways and the correct resolution is not determinable from code context): abort the rebase (`git rebase --abort`) and ask the user via AskUserQuestion with a clear, developer-readable explanation:
      - Show the conflicting snippet (both sides + base)
      - Explain what each side intended
      - Ask which intent should win, or whether both need manual reconciliation

      Under `$SHIP_LOCKOUT` the skill's Step 1b BLOCK applies instead of the question.

5. **Push**: `git push --force-with-lease` to update the remote branch.

6. **No suite run here.** Do not run the full test suite after the rebase:
   `ship_build` (Step 2) runs it on exactly the rebased tree and is the gate, and
   the pre-flight sentinel makes the `pre.test.fullguard` hook refuse a hand-run
   full suite during a ship anyway. A second run on the same tree costs ~3 min
   and proves nothing new. A filtered run (`npx vitest run <files>`) of the files
   a conflict touched is fine for diagnosing a resolution. If `ship_build` goes
   red, diagnose and fix then.

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

## Carried-forward fields

If Step 0 captured an `outOfBandDeploy:` glob list from the extension, pass it:
`ship_preflight({ cwd: "<cwd>", outOfBandGlobs: ["**/migrations/**", ...] })`.
Otherwise omit it — the tool uses stack-agnostic defaults.

The result carries `outOfBandDeploys: { detected, files, kinds, globs }` — artifacts
this diff touches that a code merge will NOT deploy (#243). **Carry this value
forward to Step 4d.** It is informational, never a hard gate (`ready` is unaffected).
Its `components` (sub-app manifests whose version the diff changed, #695) feed
Step 6's `delivery.ship.components` — carry them forward.

## Marker check scopes

The marker check has two scopes. A marker in the files **this ship would land** is a hard error — `ship_release` re-scans immediately before committing, so one left behind by the rebase in 1b is caught there too. A marker anywhere else in the repo is a **warning**: it predates this branch, so report it and open a separate fix rather than holding an unrelated release hostage.
