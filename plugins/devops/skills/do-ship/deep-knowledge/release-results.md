# Ship — `ship_release` results

Referenced by `/do-ship` Step 4. "The one above" / "the full result" is the
return shape listed under Step 4 → *Returns* in SKILL.md. The rules that
decide what to do next (merged ⇒ never retry, never read `success: true`
alone as a merge, `rebaseRequired` / `autoRebased`) stay in the skill.

## Merge and tag fields

- `mergeSha: null` + `mergeWarning` → merged, but the merge commit could not be
  read back (slow fetch); `mergeVerified: false` → merged, but `gh pr view`
  never confirmed it. Both are warnings for the card, not failures.
- `success: false` **with** `merged` + `postMergeError` → a post-merge step
  (tree guard, local sync, tagging) threw. The ring state is in the tag fields:
  `tagSkipped: true` + `tagWarning` means `alpha/<tag>` was NOT created and must
  be created by hand on `mergeSha` — surface it as a `userFinalTest` item.
- `tagError` → tag creation/push failed after its own retries; the ship is still
  `success: true` (tag trouble never fails a landed merge), but the card must
  show the ring gap.
- `tagHandoff` (with `tagError`) → the session could not push the tag; the owner
  can (#566). Put it on the card as the FIRST `open` item, an owner action, not a
  test: `{ text: "alpha/v<X.Y.Z> fehlt — Tag selbst anlegen (Befehle unten)", reply: "<tagHandoff.commands joined with newlines>" }`,
  plus `tagHandoff.gates` as the reason when `permanent: true`. Never fold it into
  "Promotion ausgesetzt". The block's format and rules: `release-flow.md` § owner hand-off.

## Other return shapes

**Two other return shapes exist and must not be mistaken for the one above:**

- `{ success: true, skipped: true, reason: "file-only-mode", delivered: "none" }`
  — not a git repo. Nothing was committed, and there was nothing to commit to.
  `success` means "the tool did what it could", NOT "the work reached main".
- `{ success: true, reason: "no-remote", delivered: "local-merge", merged: "<base>", mergeSha, pushed: false, tag, tagLocal: true, localMerge: { via } }`
  — local repo without an origin. Commit, merge into the local base and tag
  all happened locally; only push and PR did not. On `success: false` with
  `rebaseRequired` (or `delivered: "local-commit-only"`), the commit is on
  the branch but not merged — rebase onto the local base and retry, or report
  the `error` (a dirty checkout of the base is never overwritten).

## git-probe-timeout

**A third shape is a transient failure, not a mode:**
`{ success: false, reason: "git-probe-timeout", delivered: "none", error }` —
the repo-mode probe (`git rev-parse`) did not answer within its budget on a
loaded machine. `ship_preflight` reports the same case as `mode: "unknown"`,
`ready: false`, and `ship_cleanup` as `reason: "git-probe-timeout"` with the
sentinel kept. Nothing happened; **retry the same call once** — do not read it
as file-only (that was the 2026-09-18 failure: a real repo got a skipped
`success: true` and the ship silently never ran). A second timeout → BLOCK
(`ship-blocked`, "git unresponsive — machine under load").

## titleClamped

**If `titleClamped` is set**: the PR title exceeded the 70-char budget and was cut on a word boundary — the ship proceeded, it is not an error. The field carries `{ original, applied, max }`. Aim for a shorter title next time; surface it only if the clamped subject reads badly.

## Pre-merge CI gate options

- Hot-fix bypass: pass `skipChecks: true` or set `DEVOPS_SHIP_SKIP_CHECKS=1`. Result records `checks.status: "skipped"` so the card flags it.
- Tune timeout per call: `checksTimeoutSec: <30..3600>`.
- See `deep-knowledge/quality-gates.md → Pre-Merge CI Checks Gate` for the full state matrix.

## Post-merge tree verification

**If `postMergeTreeMatch: false`** (merge succeeded but `postMergeWarning` is set): **verify before surfacing** — the guard can fire as a false alarm (a tooling error in the tree lookup or a stale `origin/<base>` ref right after the merge; observed as a permanent Windows false positive before v0.107.1). Run:

```bash
git fetch origin <base>
git show -s --format=%T <branch-HEAD-sha>   # tree of what was built+tested
git show -s --format=%T origin/<base>        # tree of what landed
```

- **Trees equal** → false alarm. Log one line ("post-merge tree guard false alarm — trees verified identical"), NO `userFinalTest` item.
- **Trees differ** → a concurrent ship was three-way merged into base during the merge — its changes are preserved. Surface `postMergeWarning` as a `userFinalTest` item ("Verify main is consistent — a parallel ship merged in concurrently"). Do NOT treat it as a ship failure — the merge landed.
- Comparing `origin/<base>` to the `mergeSha` alone proves nothing (same commit after propagation) — always compare against the **branch HEAD** that was built and tested.

## Squash-merge traceability

When shipping a **feature branch → main** that was built from intermediate sub-branch merges, the PR body **MUST** include references to all intermediate PRs:

```markdown
## Summary
Feature: Video filters (end-to-end)

## Intermediate PRs
- #47 — feat(core): video filter data models
- #48 — feat(frontend): video filter UI
- #49 — feat(ai): video filter ML pipeline
```

This preserves the audit trail through squash-merges. Without these references, `git log` on main only shows one commit with no link back to the sub-branch work.

## Ring tag

Referenced by `/do-ship` Step 4. The tag rule itself stays in SKILL.md.

**Ring model (channels):** the tag is `alpha/vX.Y.Z` — every ship publishes to
the EARLIEST channel autonomously. beta/stable tags and GitHub Releases are
created later by a promotion (`ship beta|stable`, Step 5d — same SHA, no rebuild).
Pass the bare `tag: "vX.Y.Z"` (the tool prefixes the channel) — or **omit
`tag`** and the tool derives `v<version>` from the version file `ship_version_bump`
just wrote (result carries `tagDefaulted: true`). Only an explicit `tag: null`
skips the ring tag, and even then the result says so: `tagSkipped: true` +
`tagWarning` (main is ahead of every ring, a promotion has nothing to promote) —
surface that warning as a `userFinalTest` item, never render an all-green card
over it (#372). See `docs/superpowers/specs/2026-07-11-tag-channel-system-design.md`.
