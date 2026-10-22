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

## Account-limited CI

GitHub's Actions minutes, spending limit and artifact storage quota are shared
by every repo of the account. When one is used up, checks go red without a
defect in the code: a job that was never started ("The job was not started
because … spending limit …"), or a green test job whose `upload-artifact` step
failed ("Artifact storage quota has been hit"). `ship_release` reads the
failure annotations of every red Actions check
(`mcp-server/ship/lib/ci-account-limits.js`) and, when ALL of them match a limit, returns
`checks.status: "account-limited"` + `ciAccountLimited: { kinds, checks }`
instead of a plain failure. One real failure annotation ("Process completed
with exit code 1"), an unreadable annotation or a non-Actions check (Vercel)
keeps it a normal `failed` — the gate stays fail-closed.

What the skill does with it (SKILL.md Step 4): local gate with tests, then
`skipChecks: true`, then one card `tests` line. No `open` item, no question
and no button to re-run or "catch up" CI after the reset: the first ship after
the reset runs CI on a PR that contains main with everything merged meanwhile —
that run is the catch-up. The quota resets on its own (artifact usage is recalculated every
6–12 h; minutes at the billing cycle), so waiting is never the answer inside
a ship. Prevention runs on every ship: `ship_preflight.workflowHygiene`
(Step 1e) makes uploads non-fatal and short-lived in each repo it touches.

### In the ship (Step 4)

- **`checks.status: "account-limited"`** (`ciAccountLimited.kinds`: `actions-minutes`, `artifact-quota`): every red check failed only on a GitHub account limit, not on the code. Do not retry into the limit and do not render `ship-blocked` for it: run the full local gate (`ship_build` WITH tests — never `buildIdOnly`), and only when it is green call `ship_release` again with `skipChecks: true`. The card then gets a `tests` line `{ method: "CI", result: "nicht gelaufen — GitHub-Limit (<kind>), lokaler Gate grün" }` — nothing else about CI: no `open` item, no re-run/catch-up question or button (see above). A red local gate → `ship-blocked` as usual. Also under `$SHIP_LOCKOUT`: the fallback needs no judgment.
- **Recorded minutes block** (#752): an `actions-minutes` verdict is stored machine-wide per GitHub account — the `owner` of origin, since minutes are shared by every private repo of it (`ciQuota` in `ship_preflight`; `checks.quota` in the result). First ship, interactive: the result is `checks.status: "quota-decision-needed"` + `ciQuotaDecisionNeeded` — ask the user (skip-checks | wait), run the full local gate on skip-checks, then call `ship_release` again with `quotaDecision` = the answer (`skip-checks` | `wait` | `revoke`), never on your own judgement; never fall back to `skipChecks: true` there. Autonomous / `$SHIP_LOCKOUT`: the account-limited path above, no question. The answer is stored per account until the quota reset, across repos and sessions — ask it once per period, never again per ship (also not in your own AskUserQuestion or a card button while `ciQuota.decision` is set). A stored `skip-checks` is applied by later ships (`checks.status: "skipped"`, `checks.storedDecisionApplied: true`; the local gate still runs and the card names the stored decision via `checks.reason`); a stored `wait` blocks with `quotaBlocked: true`. A real red check is never skipped.

### Shared minutes block and the user's decision (#752)

`ci-account-limits.js` stays the single detector. When it reports kind `actions-minutes` for the red checks (never `artifact-quota`, never a mixed real failure), `ship_release` records the block machine-wide in `~/.claude/devops-ci-quota.json` (key: the account `owner`; older `owner/repo` keys are folded into it on read; override the path with env `DEVOPS_CI_QUOTA_FILE`). Every later ship in any session or worktree sees it: `ship_preflight` returns `ciQuota` plus a `ci-quota` warning, and `ship_release` probes for at most 60 s instead of waiting for CI.

- No stored decision, **interactive ship** (`ship_release` called with `interactive: true` and no live `.claude/.ship-lockout` marker): `success: false`, `checks.status: "quota-decision-needed"` and `ciQuotaDecisionNeeded: { account, resetAt, options: ["skip-checks", "wait"], validUntil, question }`. Nothing is merged and the result does NOT advise `skipChecks`. Ask the user (AskUserQuestion, the two options), run the full local gate when the answer is `skip-checks`, then call `ship_release` again with `quotaDecision` set to the answer. Never answer it yourself and never fall back to `skipChecks: true` here.
- No stored decision, **autonomous / lockout run** (`interactive` omitted or false, or the lockout marker is live): unchanged — the account-limited result above (`checks.quota` names the record); local gate green → retry with `skipChecks: true`, no question.
- The answer is stored per account (`owner` of `origin`) for the **whole quota period** — until the block's reset date at the time of the answer (`validUntil`, shown as `checks.quota.decisionExpiresAt`), valid in every repo of the account, every session and worktree. It survives the block clearing and a new block inside that period; the first minutes block after the reset asks again. A store write that fails still applies the answer to the call that carried it.
- Stored `skip-checks`: the ship merges without CI, `checks.status: "skipped"`, `checks.storedDecisionApplied: true`, `checks.reason` names the block and its reset date. **The card must say that a stored CI-quota decision was applied** — the user did not re-confirm this ship. That `tests` line is all: no re-confirm question, no "catch up CI later" item or button. The local gate (`ship_build` with tests) still runs.
- Stored `wait`: `success: false`, `quotaBlocked: true`, `checks.status: "quota-blocked"`; `quotaDecision: "revoke"` forgets the answer.
- Expiry: the block at the reset date (unknown: 1st of next month 00:00 UTC) or as soon as a check on the account runs again without a minutes verdict (`checks.quotaCleared: true` — that run covered everything merged without CI); the answer at its `validUntil`. A real red check is never skipped, stored decision or not.

## bump "none" — no ring tag

A ship whose `ship_version_bump` ran with `bump: "none"` keeps the version, and
`alpha/v<version>` already marks the previous ship's commit. `ship_release`
then creates **no** ring tag — whether the bump comes from the `bump` param or
from this ship's checkpoint, and even over an explicit `tag`. The result
carries `tag: null`, `tagSkipped: true`, `tagSkipReason` ("bump: none — version
unchanged (vX.Y.Z), so no new ring tag; nothing to promote for this ship") and
the same text in `tagWarning`. The card shows `tagSkipReason` as an info line;
it is a deliberate skip, not the `tag: null` gap below, so it needs no
`userFinalTest` item, and Step 5d (promotion) is skipped.

## Offline CLI result file

The offline CLI (`mcp-server/ship/cli.js`) writes every tool result to
`<repo root>/.claude/.ship-cli-last.json` (`{ tool, at, root, result }`,
runtime state, git-ignored). When a `ship_release` CLI call's stdout was
redirected to a file, the run-contract post hook reads this file instead: only
a `ship_release` entry ≤ 10 min old, of the same repo root, with a merged result
counts as the do-ship release. JSON on stdout still wins.

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

In the ship (SKILL.md Step 4): **Ring model (channels):** the tag is `alpha/vX.Y.Z` — a ship always tags the earliest
channel; beta/stable and GitHub Releases come only from a promotion (Step 5d). Pass the
bare `tag: "vX.Y.Z"` or omit `tag` (derived from the bumped version, `tagDefaulted: true`).
An explicit `tag: null` returns `tagSkipped` + `tagWarning` → a `userFinalTest` item, never
an all-green card (#372). `tagSkipReason` (bump none) is a deliberate skip: show it as an
info line, no `userFinalTest` item, and skip Step 5d.

## Result fields

See `call-examples.md` for the three reference payloads (final ship to main,
intermediate ship, overlap-with-merge-commit). For intermediate merges: no tag,
no release notes, no version commit — the tool automatically skips tag/release
creation when `base` is not `main`.

The tool handles: commit (optional), rebase verification, push (explicit force-with-lease after rebase), PR create (or reuse with mergeability check), **pre-merge CI checks gate (waits for green)**, **pre-merge rebase re-check (closes the checks-window race)**, merge (squash or merge commit), **post-merge tree guard**, **alpha channel tag** (main only), GitHub release deferred to promotion.

Returns: `{ branch, commit, rebased, pushed, pr: {number, url}, checks: {status, passed, failed, pending}, merged, mergeSha, mergeVerified?, mergeWarning?, mergeStrategy, intermediate, tag, channel, tagVerified, releaseDeferred, postMergeTreeMatch, postMergeWarning, postMergeError?, titleClamped }`.

## autoRebased

**`autoRebased` set** (with `rebaseRequired` + `retestRequired`): only version files collided, so `ship_release` already rebased and bumped again (`autoRebased.to`; the CHANGELOG header follows). Skip the manual rebase: push the branch (`git push --force-with-lease`), run `ship_build`, re-run preflight, then call `ship_release` again — the release commit exists, a `commitMessage` on the clean tree is skipped. Use `autoRebased.to` as `vNew` on the card. `autoRebaseRefused` names why the tool left it to Step 1b.
