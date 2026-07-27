---
name: promote
version: 0.1.0
description: >-
  Deliberate channel promotion for the ring model: move an already-shipped
  version alpha→beta→stable (or fast-track alpha→stable) by re-tagging the
  SAME commit via the ship_promote MCP tool. Never rebuilds, never bumps
  versions, never runs autonomously — promotion is always a user decision.
  Triggers on: "release", "promote", "promotion", "channel release",
  "auf stable heben", "promote to beta", "promote to stable". Do NOT trigger
  for shipping new work (use /ship) or plugin updates
  (/auto-update).
allowed-tools: Bash(git *), AskUserQuestion, Read
---

# Release — Channel Promotion

Promote a shipped version to a higher channel. Ship publishes every version
to **alpha** autonomously; this skill is the deliberate half of the ring
model (spec: `docs/superpowers/specs/2026-07-11-tag-channel-system-design.md`).

> **CRITICAL — `cwd` is required on every MCP tool call.**
> The ship MCP server runs in the plugin directory, NOT the target repo.
> Every `ship_promote` call MUST include `cwd` set to the current working
> directory of this Claude session.

## Step 0 — Load deferred MCP schema

`ship_promote` may be deferred. Load it first:

```
ToolSearch({ query: "select:mcp__plugin_devops_dotclaude-ship__ship_promote", max_results: 5 })
```

If the tool is not registered → STOP and report (do NOT fall back to manual
`git tag` — the promotion guards live in the tool).

## Step 1 — Gather channel state

```bash
git ls-remote --tags origin
```

Parse tag names (`alpha/vX.Y.Z`, `beta/vX.Y.Z`, `stable/vX.Y.Z`, bare
`vX.Y.Z` = stable alias) and compute the latest version per channel by
**numeric** version comparison — never lexicographic, never
`--sort=v:refname` across channel prefixes.

Render ONE line:

```
Channels: alpha v0.117.0 · beta v0.114.0 · stable v0.112.0
```

If alpha has never shipped a channel tag → report "no channel tags yet —
ship something first" and stop.

## Step 2 — Ask which promotion

Precompute only the **meaningful** promotions (source strictly ahead of
target). Present via AskUserQuestion, recommended option first:

- `alpha vX → beta` (Recommended when alpha > beta)
- `beta vY → stable`
- `alpha vX → stable (fast-track)` — legitimate skip; beta is optional
- Abbrechen

If NO promotion is meaningful (all channels equal) → report "all channels
are at vX — nothing to promote" and stop. Never promote autonomously, even
with `--autonomous` in the trigger.

## Step 3 — Execute

Single-step promotion:

```
ship_promote({ version: "0.117.0", from: "alpha", to: "beta", cwd: "<cwd>" })
```

**Fast-track** = TWO sequential calls so the ring invariant
(stable ⊆ beta ⊆ alpha) always holds:

1. `ship_promote({ version, from: "alpha", to: "beta", cwd })`
2. `ship_promote({ version, from: "beta", to: "stable", releaseNotes: "<CHANGELOG entry for the version>", cwd })`

For any promotion to `stable`, pass `releaseNotes` (read the version's
CHANGELOG.md entry) — used as fallback notes if release.yml did not create
the GitHub Release.

**Partial failure recovery:** re-run the SAME call(s). Every step is
skip-if-exists idempotent; an already-completed step returns
`alreadyPromoted: true` and the missing tags are completed
(`pushed`/`missing` in the result show exactly what happened).

`pushed`/`missing` are decided by the **remote**, not by the push exit code
(#251). Each tag push is followed by a retrying `ls-remote` confirmation, and
no tag is reported in `missing` until a final re-query still fails to find it —
a push that throws `ETIMEDOUT` after the ref already landed therefore reports
as pushed, not as a failure. Tune with `tagPushAttempts` (default 3),
`tagVerifyAttempts` (default 4, **per push attempt** — the read budget per tag
is the product) and `tagRetryDelayMs` (default 1000, ×3 per attempt); all of it
is capped in wall-clock by `tagBudgetMs` (default 120 000). A tag present on a
**different** SHA is never retried — that is the immutability guard, and it is
final. An unreadable remote is likewise never read as "tag absent"; the error
distinguishes the two.

One state a re-run cannot clear: a **local** tag left at the wrong commit. The
error names it and the remedy (`git tag -d <tag>`) — delete it, then re-run.

**Guard errors are final** — do not work around them:
- `monotonicity: ...` → the target channel is already ahead; roll forward
  (ship a newer version) instead.
- `ancestry: ...` → the SHA is not on origin/main; something is wrong —
  investigate, never force.
- `... published tags are immutable` → never delete/move tags to "fix" this.

## Step 4 — Report

Render the completion card (`render_completion_card`, variant **`released`**,
summary e.g. "vX.Y.Z auf <channel> promotet"). Populate:
- `delivery` — the pipeline track. Fill `pr`/`ship` when known, and
  `promote: { channels: { alpha, beta, stable }, current: "<target>", fastTrack }`
  using the per-channel versions from the re-run Step 1 (null for a channel not
  yet reached → renders as —). `current` is the channel just promoted to.
- `promotion` — the end-info straight from the `ship_promote` result:
  `{ from, to, sha, tags: <result.pushed>, release: <result.release> }`. The CTA
  keys off `to`: beta → "🔼 PROMOTED", stable → "🎊 RELEASED — LIVE".
- `userFinalTest` — a lagging-consumer note ("Consumer-Maschine: nächster
  SessionStart pinnt auf <channel>/vX.Y.Z"); for stable pass
  `{ action, afterDeployment: true }`.

Do NOT use variant `ready` — its CTA reads "SHIP or CHANGE?", which is wrong for
a *completed* promotion. `released` is the purpose-built variant.

## Rollback = roll forward

There is deliberately NO demote operation (immutable tags + latest-wins
resolution). A bad promotion is corrected by fixing on a branch, shipping a
new version (alpha), and fast-track promoting the fix.
