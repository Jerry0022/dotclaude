# Resume an interrupted ship (`--resume`)

A ship can stop half-way: the usage limit hits, the PC crashes, or the session
closes. The ship MCP server writes a checkpoint (`.claude/.ship-checkpoint.json`,
`hooks/lib/ship-checkpoint.js`) after every step. Preflight opens it,
build/bump/release record their results, and `ship_cleanup` removes it on every
exit path. A delegated ship also stores its brief and the user's decisions
there. A resumed run therefore rebuilds nothing from the conversation.

1. `node "{PLUGIN_ROOT}/scripts/ship-checkpoint.js" show --cwd "<cwd>"` →
   `{ open, next, summary, checkpoint }`. `open: false` → no ship to resume:
   run a normal ship.
2. **Check it against git and gh.** The checkpoint records what a tool
   returned, and a crash can land between the action and that record:
   `git -C <cwd> status --short`, `git -C <cwd> log -1 --oneline`, and
   `gh pr list --head <branch> --state all --json number,state,mergedAt` when
   a remote exists. If `git status` itself fails with an index error (a crash
   inside `ship_release` can leave a zeroed index and a 0-byte `HEAD.lock`),
   move `.git/index` aside, run `git reset`, delete the empty lock, then go on.
   A branch that differs from `checkpoint.branch` → the checkpoint is not this
   branch's: `ship-checkpoint.js clear` and run a normal ship.
3. **Run the pipeline from `next`, skipping what landed:**
   - `ship_preflight` always runs again. It re-arms the sentinel and keeps the
     checkpoint's steps.
   - `build` ✓ and no commit since → skip `ship_build`. Otherwise run it again,
     because it is idempotent.
   - `bump` ✓ (the version file already says `vNew`) → **never** call
     `ship_version_bump` again, and do not add a second CHANGELOG section.
     `verified: false` means the bump rewrote the version files but
     verification failed (usually the CHANGELOG still names `vOld`). Bring the
     files in `mismatches` to `vNew` by hand; never bump again.
   - `release` with a PR and not merged → `ship_release` reuses the open PR.
     Merged → skip straight to Step 4b onwards (watcher, cleanup, card).
   - The checkpoint records only the tool steps. Skill steps that sit
     between the last ✓ and the next step run again. Example: build ✓ but
     bump not landed → the Codex gate, Docs-Sync and the CHANGELOG entry run
     before the bump. A ✓ on a later tool step implies the gates before it
     passed.
   - `checkpoint.decisions` are answers the user already gave. Apply them;
     never ask again.
4. Everything after that is the normal pipeline, including the ship card
   (`ship-successful` / `ship-blocked` → `🚀 Shipped – ` / `⛔ Blocked – `). The title
   already says `🚀 Shipping – `: `prompt.flow.title-work` marks a resuming prompt
   as a ship.
