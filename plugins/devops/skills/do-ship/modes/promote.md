<!-- do-ship promotion steps — the body of the former `promote` skill (v0.1.0), moved in PR 2 of the skill restructure (docs/superpowers/specs/2026-09-24-skill-restructure-design.md). Its triggers, allowed tools and argument hint live in ../SKILL.md, which decides WHEN these steps run (§ Target channel: promotion-only, or Step 5d after a ship). -->

# Release — Channel Promotion

Promote a shipped version to a higher channel. Ship publishes every version
to **alpha** autonomously; the promotion is the deliberate half of the ring
model (spec: `docs/superpowers/specs/2026-07-11-tag-channel-system-design.md`).
do-ship runs these steps in two situations (`../SKILL.md` § Target channel):
**promotion-only** (a channel is named and nothing is unshipped) and **Step
5d** (a channel is named and the ship just landed `vNew` on alpha).

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

## Step 2 — Which promotion

**A channel named by the user answers this step** — "ship stable", "promote
to beta", "auf stable heben", `/do-ship stable`: the target is that channel,
the version is the one named, else `vNew` of the ship that just ran (Step
5d), else the latest alpha. Target stable with the version not yet on beta →
fast-track (Step 3). Only when that promotion is not meaningful (the version
already sits on the target or higher) say so and stop — no question.

**A named version** ("promote stable 0.193.0", the card's promote buttons
carry one) promotes exactly that version and nothing else: this run never
ships first, even when the branch has unshipped work — a click on an old
card must not ship edits made after it. Unshipped work is named as an `open`
item on the card, never shipped.

**A bare "promote"** (no channel) asks. Precompute only the **meaningful**
promotions (source strictly ahead of target). Present via AskUserQuestion,
recommended option first:

- `alpha vX → beta` (Recommended when alpha > beta)
- `beta vY → stable`
- `alpha vX → stable (fast-track)` — legitimate skip; beta is optional
- Abbrechen

If NO promotion is meaningful (all channels equal) → report "all channels
are at vX — nothing to promote" and stop. Never promote autonomously, even
with `--autonomous` in the trigger: a channel counts only when the USER
named it (never an orchestrator's arguments, never under `$SHIP_LOCKOUT`).

## Step 3 — Execute

Single-step promotion:

```
ship_promote({ version: "0.117.0", from: "alpha", to: "beta", cwd: "<cwd>" })
```

**Fast-track** = ONE call from alpha: `ship_promote` keeps the ring invariant
(stable ⊆ beta ⊆ alpha) itself — it tags `beta/vN` first (unless beta already
serves this version or a newer one), then `stable/vN` and the bare `vN`:

`ship_promote({ version, from: "alpha", to: "stable", releaseNotes: "<CHANGELOG entry for the version>", cwd })`

For any promotion to `stable`, pass `releaseNotes` (read the version's
CHANGELOG.md entry) — used as fallback notes if release.yml did not create
the GitHub Release.

**Every fast-track names the skipped beta soak** on the card (Step 4): an
`open` item "Beta übersprungen — v<version> ging direkt alpha→stable, ohne
Beta-Phase" (en: "Beta skipped — v<version> went straight alpha→stable, no
beta soak") plus `delivery.promote.fastTrack: true`. Stable tags are
irreversible; the skipped soak is never silent.

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
summary e.g. "vX.Y.Z auf <channel> promotet"). After a ship in the same run
(Step 5d) this is the run's ONE card: keep every ship field from
`../SKILL.md` Step 6 (`changes`, `tests`, `validation`, `userFinalTest`,
`state`, `cta`, `delivery.pr`, `delivery.ship`) and add the fields below;
the summary then names what changed for the user, like a ship card. Populate:
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

The card result carries a `[SESSION TITLE]` block that puts
`🎊 Released <Alpha|Beta|Stable> – ` on the session title — the channel comes
from `delivery.promote.current` (else `promotion.to`). Execute it before
outputting the card; Desktop app only, skip silently elsewhere.

## Rollback = roll forward

There is deliberately NO demote operation (immutable tags + latest-wins
resolution). A bad promotion is corrected by fixing on a branch, shipping a
new version (alpha), and fast-track promoting the fix.
