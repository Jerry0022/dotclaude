# Ship — manual checklist (no ship MCP server)

Referenced by `/do-ship` Step 0.5. Runs **only** when the `dotclaude-ship`
tools are absent from the session — not merely deferred (#567). Typical case:
a claude.ai cloud session whose container never loaded the plugin's MCP
servers, or a local session whose server could not be restored by the cache
diagnosis in `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md`.

Without the tools nothing enforces the conventions they encode — squash merge,
tag on the squash commit, annotated tag, verified push. Improvising the ship
lost two of them once (a merge commit on `main`, no release tag). This
checklist is the contract instead: work through it in order, tick nothing
that did not happen.

## Announce the switch — one line, first

> Ship-MCP-Server nicht verfügbar (<reason: not in the tool list / failed to
> connect, cache not repairable>) — ich shippe nach der manuellen Checkliste.

In a cloud session add: the plugin is not loaded there; enabling the devops
plugin for cloud sessions brings the automated pipeline back.

## Checklist

1. **Clean start** — `git status --porcelain` empty, branch pushed, rebased on
   `origin/<base>`. Conflict markers: `git grep -nE '^(<{7}|={7}|>{7}|\|{7})( |$)'`
   over the diff must find nothing.
2. **Gates** — every pre-merge gate the project extension names (lint, tests,
   build). A red gate stops the ship; say so, do not merge.
3. **Version bump** — every version-bearing file the project extension (or
   `versioning.md`) names, all to the same `X.Y.Z`. Major → ask the user
   (under a lockout: stop, as the pipeline would).
4. **CHANGELOG** — a new top entry `## [X.Y.Z] — <date>` with the user-facing
   change, committed with the bump: `chore(release): vX.Y.Z`.
5. **PR** — title `type(scope): summary`, body starting `Closes #N` when an
   issue is shipped. Prefer the GitHub MCP tools (`create_pull_request`);
   `gh pr create` is blocked by `pre.ship.guard` wherever the plugin's hooks
   run, unless the user set `DOTCLAUDE_ALLOW_MANUAL_SHIP=1`.
6. **Wait for checks** — every required check green before the merge.
7. **Squash merge** — never a merge commit, never a rebase merge, unless the
   pipeline's own rule applies (overlapping files with a parallel branch →
   merge commit, `merge-safety.md`). Commit title
   `type(scope): summary (X.Y.Z) (#PR)`. Read back the merge commit SHA from
   `origin/<base>` after a fetch.
8. **Ring tag** — the annotated `alpha/vX.Y.Z` on that squash commit, pushed
   and verified with `ls-remote`. The exact commands, and what to do when this
   session cannot push the tag, are in `release-flow.md` § owner hand-off
   (#566) — follow them from there, do not restate them.
9. **Cleanup** — delete the remote branch; the local branch and worktree only
   when this session created them.
10. **Summary** — the card, or where `render_completion_card` is absent too, a
    short summary with the same facts (version, PR, merge SHA, tag state) and
    one line **"Nicht gelaufen: …"** naming every automated guard that did not
    run: preflight (merge-safety, file-overlap), the post-merge tree guard, the
    Codex review, the ship passes (harden/polish), the post-merge watcher,
    hygiene. When the plugin files exist on disk, the card renders offline:
    `node "{PLUGIN_ROOT}/mcp-server/index.js" --render-card <payload.json>`.
    The card says the ship was manual: a `tests` line
    `{ method: "Ship", result: "manuell — Ship-MCP nicht verfügbar" }`.

## Never

- Never a merge commit because it is the default of the tool at hand.
- Never a lightweight tag, never a tag on the branch head instead of the
  squash commit.
- Never "Everything up-to-date" as proof that a tag landed.
- Never this checklist while the ship tools are merely deferred — load them
  (Step 0.5) and run the pipeline.
