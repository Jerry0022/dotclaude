# Tag-Based Release Channels (alpha / beta / stable) — Design

**Status:** DRAFT v3 — redteam-hardened + PO-trimmed; pending user approval
**Date:** 2026-07-11
**Scope:** devops plugin distribution (producer: ship pipeline; consumer: plugin update hook)

## 1. Goal & Principles

Introduce three release channels — **alpha → beta → stable** — for the devops plugin, following the **ring model**:

- **Ship stays autonomous.** Every `/ship` to `main` publishes to the *earliest* channel (alpha) with zero prompts. The channel question never interrupts the ship pipeline.
- **Promotion is bit-identical.** Moving a version alpha→beta→stable re-tags the *same commit SHA*. No rebuild, no new commit, no version-file change. What was tested in alpha is byte-for-byte what stable consumers get.
- **Promotion is deliberate.** A separate `/promote` skill promotes, with an explicit user decision (alpha→beta, beta→stable, or fast-track alpha→stable).
- **Consumers pin a channel.** Each consumer machine follows one channel **per marketplace**; the update hook resolves "latest version visible to my channel" from git tags.

Industry basis (research-verified): npm dist-tag decoupling (version = immutable identity, channel = pointer), Rust release-train (channel as label, not version), container digest promotion (promote the tested artifact), Obsidian BRAT (GitHub-hosted plugin beta channels).

## 2. Tag Scheme

**Namespaced immutable tags**, one per (channel, version), all pointing at the same merge commit:

```
alpha/v0.113.0     ← created by ship_release (automatic, every ship)
beta/v0.113.0      ← created by promotion (same SHA)
stable/v0.113.0    ← created by promotion (same SHA)
v0.113.0           ← created ONLY at stable promotion (same SHA) — backward-compat alias
```

Rules:

- **All channel tags are ANNOTATED tags** (`git tag -a`), not lightweight. Rationale (redteam R4): lightweight tags carry no tagger/date — since all channel tags share one commit, promotion time and actor would be unrecoverable. Annotated tags make the promotion log fully derivable from git (`for-each-ref --format='%(taggerdate) %(taggername)'` + a JSON payload in the tag message: `{"from":"alpha","to":"beta"}`). No committed log file, no extra commit per promotion (resolves former O1).
- **Never move, never delete** a published tag (git re-tagging is unsafe across clones; fetch won't overwrite without `--force`). Rollback = roll forward (§7).
- **Version stays frozen across channels.** `plugin.json` / `marketplace.json` / `package.json` carry bare `X.Y.Z` — no channel suffix, ever. The channel lives *only* in the tag namespace. This is what makes promotion a pure re-tag (verified: `ship_version_bump` is never called during promotion). Note: `ship_version_bump` forces devops AND local-llm to the same version each ship (version.js:118-136, 199-206), so one repo tag ⇒ one consistent version for both plugins (redteam-verified).
- The **bare `vX.Y.Z` tag doubles as the stable marker** and keeps existing conventions intact: `CONVENTIONS.md`, the `.github/workflows/release.yml` trigger (`v[0-9]+.[0-9]+.[0-9]+` matches bare tags only — verified: GHA glob `+` is supported; channel-prefixed tags never match), and GitHub's `/releases/latest` semantics.
- **Tag accumulation is accepted** (redteam R10): one `alpha/*` tag per ship, add-only forever. Documented trade-off; a retention policy (e.g. prune alpha tags older than latest stable) is a possible future exception to "never delete" — deferred, not launch-relevant.

### Not chosen (and why)

- **Moving channel tags** (`beta` re-pointed): documented git anti-pattern; consumers silently stay on stale SHAs without `fetch --force`.
- **Channel branches** (`alpha`/`beta`/`main`): user decision for tags; branches add ff-only discipline burden and a second long-lived-ref maintenance surface.
- **SemVer prerelease suffixes** (`v1.2.3-beta.1`): would force a version-file change per channel → new commit → breaks bit-identity.

## 3. Producer Side — Ship Pipeline Changes

### 3.1 `ship_release` (mcp-server/ship/tools/release.js)

Today (release.js:241-259): creates lightweight bare `v{X.Y.Z}` on `origin/<base>` + GitHub Release.

Change:

- Tag name becomes **`alpha/v{X.Y.Z}`**, created **annotated** with message payload `{"channel":"alpha","ship":true}`. Idempotency check (`ls-remote --tags origin <tag>`) keys on the full namespaced string — unique per (channel, version).
- **No GitHub Release at ship time.** Releases are created at promotion (beta = prerelease, stable = full). Rationale: alpha ships happen on every merge; a Release per alpha is noise. The `createRelease` call (release.js:261-269) moves into the promote tool.
- Result fields: `tag: "alpha/v0.113.0"`, `channel: "alpha"` added.
- **Post-merge watcher note** (redteam needs-info): release.yml no longer fires at ship time (it triggers on bare tags only). The watcher spawned in ship Step 4b keys on push-to-main workflow runs — currently none exist, so it reports benign `no-run` (unchanged behavior). The release-verification duty moves into `ship_promote` step 6, which polls the Release inline. No watcher change required now; if a push-to-main CI workflow is ever added, the watcher covers it as designed.

### 3.2 `/ship` skill

- Step 3 (version bump) unchanged — every ship to main still bumps `X.Y.Z` and writes one CHANGELOG entry. CHANGELOG remains **one entry per version** regardless of how many channels the version reaches.
- Step 4/6 texts + completion card: show `alpha/vX.Y.Z` as the created tag.
- **Promotion-gap nudge (MUST-HAVE, PO #4):** every `ship-successful` card shows the channel drift — "alpha is N versions ahead of stable — `/promote` to promote" (one `ls-remote 'refs/tags/stable/*'` + bare at card time). Escalated wording past a threshold (≥3 versions **or** ≥7 days since last stable promotion): "stable is 5 versions / 9 days behind alpha." Rationale: with multi-ships/week and a solo maintainer, deliberate promotion has no heartbeat without a forcing function — invisible lag is the failure mode that kills the feature; visible lag is the feature working.
- deep-knowledge (`versioning.md`, `release-flow.md`) and `CONVENTIONS.md`: document the ring model.

### 3.3 `.github/workflows/release.yml`

- Trigger pattern stays `v[0-9]+.[0-9]+.[0-9]+` → fires only on the bare stable tag (redteam-verified; also verified: `ship_promote` pushes with the user's git credential, not `GITHUB_TOKEN`, so the tag push DOES trigger the workflow).
- **Fix 1 (pre-existing bug, redteam R5):** `actions/checkout@v4` defaults to `fetch-depth: 1` without tags — `git describe --tags HEAD~1` fails silently TODAY (release notes degrade to `git log -20` on a 1-commit checkout). Add `fetch-depth: 0` and `fetch-tags: true`.
- **Fix 2:** `PREV_TAG=$(git describe --tags --abbrev=0 HEAD~1)` must become `git describe --tags --match 'v[0-9]*' --abbrev=0 HEAD~1` so channel tags on the same commits never pollute the release-notes range.
- The double-release-producer overlap resolves: ship no longer creates Releases; the workflow fires on stable tags; `ship_promote` polls before creating (idempotent both ways).

## 4. Promotion — `/promote` skill + `ship_promote` MCP tool

### 4.1 New MCP tool `ship_promote` (deterministic git work)

```
ship_promote({ version: "0.113.0", from: "alpha", to: "beta", cwd })
```

Steps (all against `origin`, never local state):

1. Resolve source tag `"{from}/v{version}"` via `ls-remote` → SHA. Missing → error `source-tag-not-found`.
2. **Monotonicity guard** (amended per redteam R6): let `L` = latest version in `{to}` channel.
   - `{to}` empty → allow (first promotion into the channel).
   - `version > L` → allow.
   - `version == L` **and target tag exists on the same SHA** → **idempotent success** (`alreadyPromoted: true`), NOT an error — this is what makes partial-failure retries work.
   - `version < L` → refuse (would be invisible under latest-resolution). No `--force` escape hatch.
3. **Ancestry guard:** verify the SHA is reachable from `origin/main` (`merge-base --is-ancestor`).
4. Create **annotated** tag `"{to}/v{version}"` (message payload `{"from":"{from}","to":"{to}"}`) on the SHA; push; verify via `ls-remote`. Skip-if-exists (idempotent).
5. If `to === "stable"`: additionally create annotated bare `v{version}` on the same SHA. **Transactionality** (redteam R7): push `stable/v{version}` FIRST, then bare `v{version}`; each step skip-if-exists; `success: true` only when BOTH verified via `ls-remote`. On partial failure, return `{ success: false, pushed: [...], missing: [...] }` — a re-run completes the missing pushes (guaranteed by skip-if-exists + guard rule `version == L` → idempotent).
6. GitHub Release:
   - `to === "beta"` → **no GitHub Release at launch** (PO decision on O2: tags are the canonical channel truth; there is no beta audience using the GitHub UI yet — presentation for zero viewers is deferred, re-added as a single idempotent `gh release create --prerelease` call the day an external beta tester exists).
   - `to === "stable"` → the bare tag triggers release.yml; poll for the Release (timeout 60s), create via `gh` as fallback (skip if exists).
7. Promotion log: **derived, not stored** — annotated tag metadata (taggerdate, taggername, message payload) IS the audit trail. `ship_promote` returns it; `/promote` renders it.

Returns `{ success, version, from, to, sha, tag, bareTag?, alreadyPromoted?, release?, pushed?, missing? }`.

### 4.2 `/promote` skill (interactive gate)

1. Gather state: latest version per channel via per-channel globs (`git for-each-ref --sort=-v:refname --count=1 'refs/tags/{ch}/*'` — safe within ONE prefix; see §5.2 for why cross-prefix sorting must never use this). Render a **one-line channel state** ("alpha v0.117 / beta v0.114 / stable v0.112") — PO trim: no rich table at current scale; the annotated-tag metadata plumbing stays (it is free) but elaborate rendering is deferred.
2. AskUserQuestion with the **meaningful promotions precomputed**:
   - `alpha/v0.115.0 → beta` (Recommended, if alpha is ahead of beta)
   - `beta/v0.113.0 → stable`
   - `alpha/v0.115.0 → stable (fast-track)` — legitimate skip; beta is optional per user decision
   - Abbrechen
3. Fast-track alpha→stable executes as TWO `ship_promote` calls (alpha→beta, then beta→stable) so the ring invariant "stable ⊆ beta ⊆ alpha" always holds. **Partial-failure recovery** (redteam R6): if step 2 fails after step 1 succeeded, re-running the fast-track is safe — step 1 returns `alreadyPromoted: true` and step 2 retries.
4. Render completion card (summary "promoted vX to <channel>").

No autonomous promotion anywhere. Ship never calls this.

## 5. Consumer Side — Channel-Aware Updates

### 5.1 Channel pin — per MARKETPLACE, not per plugin (redteam R3)

One marketplace clone = one working tree = one checked-out SHA — it **cannot** serve two plugins on different channels. Divergent per-plugin pins are therefore structurally unsatisfiable and forbidden by design:

- **Authoritative store:** `~/.claude/plugins/.channels.json` — plugin-owned sidecar, `{ "<marketplace>": "alpha" | "beta" | "stable" }`. Lives OUTSIDE the clones (survives `reset --hard`/`clean -fd` and native registry rewrites; redeam needs-info: Claude Code native tooling may strip unknown fields from `installed_plugins.json`, so that file cannot be authoritative).
- `installed_plugins.json` entries additionally get an informational `channel` field (kept in sync by the hook; tolerated if stripped).
- Default when absent: **`stable`**. Set via `/devops-plugin-update --channel <ch>` (updates the sidecar for the whole marketplace). The plugin-source dev machine pins `alpha`.

### 5.2 Resolution rule (the core rewrite in `ss.plugin.update.js`)

**Every branch-pull site is replaced** (redteam R2 — the spec explicitly enumerates ALL of them):

| Site | Today | New |
|---|---|---|
| ss.plugin.update.js:336 (main pull) | `git pull --ff-only origin main \|\| master` | fetch-tags + resolve + pin (below) |
| ss.plugin.update.js:339-345 (dirty-tree retry) | `checkout -- . && clean -fd` then **pull again** | `reset --hard && clean -fd` then **re-pin to resolved tag** (never pull — a detached HEAD that is an ancestor of main would silently fast-forward to alpha tip) |
| devops-plugin-update/SKILL.md:52 (docs) | describes `git pull --ff-only` | describes tag resolution |

New pin sequence per marketplace clone:

```
git fetch origin --tags                              # add-only; immutable tags need no --force
resolve: highest SemVer version among tags in
         UNION(own channel, all more-stable channels)
         alpha → alpha ∪ beta ∪ stable ∪ bare
         beta  → beta ∪ stable ∪ bare
         stable→ stable ∪ bare
git reset --hard && git clean -fd                    # guard: dirty/half-merged clone (redteam R8)
git checkout --detach <resolved-tag>
```

- **Bootstrap fallback** (redteam R1 — kills the migration oscillation): **if no `stable/*` tag exists at all**, the hook falls back to legacy behavior (`git pull --ff-only origin main`). This makes the hook swap self-gating: until the first stable promotion exists, consumers behave exactly as today; the moment `stable/vN` is pushed, every consumer pins to it on next SessionStart. No oscillation window, because the fallback and the pin converge on the same content once N is stable (see §5.4 rollout).
- **Union resolution** guarantees a channel never lags a more-stable channel (covers fast-track promotions). **Hard requirement** (redteam R9): the union resolver parses versions from tag names and compares **numerically**. `git for-each-ref --sort=-v:refname` over a cross-prefix glob is FORBIDDEN for the union — the refname sort would rank the `alpha/` vs `stable/` prefix above the version. Required test: `alpha/v0.113.0 > stable/v0.112.0` and `0.9.0 < 0.10.0`.
- **Change detection** (`versionChanged`, line 355): switch from "HEAD moved && version string differs" to **"resolved tag SHA ≠ current HEAD SHA"**.
- Cache path stays **version-keyed** (`cache/dotclaude/devops/<version>/`) — safe because channels are content-identical per version by construction. Registry entry gains informational `channel`; `gitCommitSha` = the resolved tag's SHA.
- `.mcp-stale.json` sentinel logic unchanged — redteam-verified: same-version promotion ⇒ same SHA ⇒ no rebuild ⇒ no sentinel; no hook keys on tag strings.

### 5.3 `/devops-plugin-update` skill

- New Step: read/print current channel + resolved target **including drift** ("Channel: stable — latest visible: v0.113.0 (alpha has v0.117.0 available)"). Drift visibility on the consumer side mirrors the producer-side ship-card nudge (PO acceptance criterion #5). `--channel` flag re-pins (sidecar write) then updates.
- Step 3a version-alignment check unchanged (three sources still must match — promotion never touches files).

### 5.4 Migration & rollout (rewritten per redteam R1)

The naive rollout oscillates: old hook pulls main (alpha-quality tip N, contains new hook) → new hook pins `stable` = last bare tag (old content, old hook) → old hook pulls main again → loop. **Two measures kill this:**

1. **Bootstrap fallback** (§5.2): the new hook only switches to tag-pinning once a `stable/*` tag exists; before that it behaves exactly like the old hook (pull main). No behavioral flip-flop is possible — both hook versions do the same thing until stable exists.
2. **Mandatory rollout step:** the release that ships this feature (version N) is **immediately fast-track promoted to stable** as part of its rollout checklist. From that moment, `stable/vN` exists, contains the new hook, and every consumer converges on it. The window in which consumers ran alpha-quality main-tip is the same window that exists today (they always ran main tip) — no regression.

**Rollout checklist (ordered — PO additions marked):**

1. Ship the feature version N (`/ship` → `alpha/vN`).
2. **Sequencing guard (PO):** verify release.yml on `main` contains `fetch-depth: 0` + `fetch-tags: true` + `--match 'v[0-9]*'` (§3.3) BEFORE any stable promotion — otherwise the first `stable/vN` triggers the still-broken `git describe` and corrupts the launch Release notes.
3. **Content-identity check (PO):** verify the SHA of `alpha/vN` contains the rewritten `ss.plugin.update.js` (the rollout's correctness depends on the new hook being INSIDE stable/vN; promoting an older SHA strands consumers on the old hook).
4. Fast-track promote N to stable (`/promote`).
5. Verify on one consumer machine: next SessionStart pins to `stable/vN`, subsequent SessionStart does NOT flip back (oscillation check).

- Existing bare tags (`v0.112.0` and older) are treated as `stable` — automatic, since bare is in every union.
- Native `git pull` interference (Desktop App/CLI touching the clone): on a detached HEAD a plain `pull` fails or leaves a dirty state — the pin sequence's `reset --hard && clean -fd` (§5.2) repairs it every SessionStart (self-healing, same philosophy as today's dirty-tree reset).

## 6. Merge Strategy Impact

**None.** Branching, PRs, squash-merge to `main`, hierarchical sub-branch merges, git-sync (`scripts/git-sync.js` hardcoding `MAIN='main'`) — all unchanged. `main` remains the only long-lived branch and the single source of truth; channels are a *distribution* concept layered on tags, not a development concept. This was the decisive argument for tags over channel-branches.

## 7. Rollback Policy — Roll Forward

Published tags are never moved or deleted. A bad promotion is corrected by:

1. **Bad stable:** fix on a branch → `/ship` (new version, alpha) → `/promote` fast-track to stable. Consumers resolve the higher version and move on.
2. **Bad beta:** same, promote the fixed version to beta.
3. Optional marker: `gh release edit <tag> --prerelease` demotion or a `[YANKED]` note in CHANGELOG — cosmetic; resolution ignores it (monotone latest-wins).

There is deliberately **no demote operation** — it cannot work under immutable tags + latest-resolution; npm/cargo converge on the same yank-not-delete answer.

## 8. Error Handling & Races

| Failure | Behavior |
|---|---|
| Tag push race (two ships) | Impossible per version: version bump is serialized through the PR merge; idempotency check skips existing tags. |
| Promotion of unmerged/foreign SHA | Ancestry guard (§4.1.3) refuses. |
| Promote older-than-current version | Monotonicity guard refuses (`<` only; `==` on same SHA is idempotent success). |
| Partial fast-track (beta ok, stable fails) | Re-run fast-track: step 1 returns `alreadyPromoted`, step 2 retries. Deterministic recovery, no manual state surgery. |
| Partial stable (stable/vN pushed, bare vN fails) | `success: false` with `missing: ["vN"]`; re-run pushes only the missing tag (skip-if-exists). Both-verified gate prevents "half-stable" success. |
| release.yml + promote both create stable Release | Promote polls first, creates only if absent (idempotent both ways). |
| Consumer fetches mid-promotion | Sees previous latest — harmless staleness, corrected next SessionStart. Tags are add-only; no clobber states exist. |
| Dirty/half-merged consumer clone | `reset --hard && clean -fd` before every pin (§5.2). |
| GitHub Release creation fails | `release: false` in result; card flags it; tags (the canonical channel truth) are already pushed — Releases are presentation. |

## 9. Testing Strategy

- **Unit (vitest):** promote guards (monotonicity incl. empty-channel + idempotent-equal, ancestry, missing source), union resolver (numeric sort, cross-prefix `alpha/v0.113.0 > stable/v0.112.0`, `0.9.0 < 0.10.0`, bare-as-stable), change detection (SHA-based), bootstrap fallback (no stable/* ⇒ legacy pull), partial-failure retry (beta-then-stable resume; stable-then-bare resume).
- **Integration (local bare-repo fixture):** ship→alpha tag; promote alpha→beta→stable; fast-track; per-channel consumer resolution; migration sequence (bare-tags-only state → first stable promotion → pin flips); dirty-clone repair.
- **Manual (userFinalTest in card):** one real ship + one real promotion + `/devops-plugin-update --channel beta` from a consumer machine; verify GitHub Release appears exactly once.

## 10. Acceptance Criteria (PO — post-launch gates)

1. **Ship autonomy preserved:** 5 consecutive `/ship` runs create `alpha/vX.Y.Z` tags with zero channel prompts and zero GitHub Releases at ship time.
2. **Bit-identical promotion:** for any promoted version, `git rev-parse alpha/vN == beta/vN == stable/vN == vN` (same SHA), and `plugin.json` version is unchanged between alpha tag and stable tag.
3. **Idempotent recovery:** a `ship_promote` re-run after a simulated mid-promotion failure completes the missing tag/Release and returns `success: true` with no manual git surgery (gated on §9 partial-failure tests).
4. **Rollout converges without oscillation:** after the mandatory fast-track of version N, a default-channel consumer pins to `stable/vN` on next SessionStart and does NOT flip back on the subsequent SessionStart.
5. **Drift is visible (operational-health criterion):** when alpha leads stable by ≥1 version, the ship card shows the gap (§3.2 nudge) and `/devops-plugin-update` shows "latest visible vN (alpha has vM available)" (§5.3).

Criteria 1–4 are ship-blocking; degraded #5 means the feature will rot even if 1–4 pass.

## 11. Out of Scope

- `scripts/git-sync.js` (dev-time branch sync — no channel relevance, verified).
- **Divergent per-plugin channels** — structurally impossible with one shared clone (§5.1); would require per-plugin marketplace clones. Explicitly forbidden, not just deferred.
- local-llm plugin versioning (lockstep-versioned with devops by `ship_version_bump`; follows the same repo tags).
- **Beta GitHub prerelease Releases** (former O2 — PO: deferred until a real external beta tester exists; 10-minute follow-up, not architecture).
- Rich channel-state table in `/promote` (PO trim: one-liner suffices at current scale).
- Auto-promotion policies ("alpha→beta after 7 days") — possible later on top of `ship_promote`, deliberately not now.
- Alpha-tag retention/pruning (accepted growth, §2).

## 12. Review Resolution Map

### PO review (verdict: trim-scope, then ship)

| PO recommendation | Resolution |
|---|---|
| #4 Promotion-gap nudge = MUST-HAVE | §3.2 ship-card nudge with escalation threshold |
| #5 Defer beta GitHub prereleases (O2) | §4.1.6 no beta Release at launch; §11 out-of-scope |
| #6 Trim channel table | §4.2.1 one-liner state |
| Rollout: sequencing guard + content-identity check | §5.4 checklist steps 2-3 |
| Acceptance criteria | §10 |
| O3 default stable | Confirmed (§5.1) |
| Operational rhythm: forcing function, not calendar; fast-track as default path; visible lag = feature working | Adopted as design stance (§3.2 rationale) |

### Redteam findings (verdict after rework: resolved)

| Finding | Resolution |
|---|---|
| R1 migration oscillation (blocker) | §5.2 bootstrap fallback + §5.4 mandatory stable promotion at rollout |
| R2 incomplete pull-site rewrite (blocker) | §5.2 enumerated site table; retry path re-pins, never pulls |
| R3 divergent per-plugin pins (major) | §5.1 pin per marketplace; sidecar authoritative; divergence forbidden |
| R4 lightweight tags break derived log (major) | §2 all channel tags annotated; log derived from tag metadata |
| R5 release.yml already broken (major) | §3.3 fetch-depth 0 + fetch-tags + `--match` |
| R6 monotonicity blocks retry (major) | §4.1.2 `==`+same-SHA ⇒ idempotent success; empty ⇒ allow |
| R7 non-transactional stable+bare (major) | §4.1.5 ordered pushes, skip-if-exists, both-verified gate |
| R8 no dirty-clone guard (major) | §5.2 reset --hard + clean -fd before pin |
| R9 cross-prefix refname sort trap (minor) | §5.2 numeric union resolver mandatory; for-each-ref forbidden cross-prefix; test required |
| R10 unbounded alpha tags (minor) | §2 accepted + documented; retention deferred |
| NI post-merge-watcher voided | §3.1 note: release verification moved into ship_promote step 6 |
| NI registry field stripping | §5.1 sidecar outside registry is authoritative |

## Open Questions

None — O1 resolved by annotated tags (§2), O2 decided by PO (deferred, §11), O3 confirmed (stable default, §5.1).
