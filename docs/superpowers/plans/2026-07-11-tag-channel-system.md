# Tag-Based Release Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the alpha/beta/stable ring model from `docs/superpowers/specs/2026-07-11-tag-channel-system-design.md`: ship tags `alpha/vX.Y.Z` autonomously, `ship_promote` + `/promote` promote the same SHA, the consumer hook pins a channel via tag resolution.

**Architecture:** Shared pure helpers exist twice by necessity — ESM (`mcp-server/ship/lib/channels.js`, imported by tools) and CJS (`hooks/lib/channels.js`, hooks must stay dependency-free standalone scripts). Both are small and tested independently. All git effects go through existing `lib/git.js` / `lib/github.js` patterns.

**Tech Stack:** Node ESM (mcp-server) + CJS (hooks), vitest with the repo's zod-stub mock pattern, no new dependencies.

## Global Constraints

- Version files NEVER carry a channel suffix (spec §2) — `ship_version_bump` untouched.
- All channel tags are ANNOTATED (`git tag -a`) with a JSON message payload (spec §2/R4).
- Never move/delete published tags; all tag creation is skip-if-exists idempotent (spec §4.1).
- Cross-prefix tag resolution MUST compare versions numerically — `--sort=v:refname` across prefixes is forbidden (spec §5.2/R9).
- Bootstrap fallback: no `stable/*` tag ⇒ hook behaves exactly like today (spec §5.2/R1).
- Beta promotions create NO GitHub Release at launch (PO/O2). Stable creates bare `vX.Y.Z` + Release.
- Chat language German, artifacts English.

---

### Task 1: ESM channel helpers (`lib/channels.js`)

**Files:**
- Create: `plugins/devops/mcp-server/ship/lib/channels.js`
- Test: `plugins/devops/mcp-server/ship/lib/channels.test.js`

**Interfaces:**
- Produces: `parseChannelTag(ref) -> {channel:'alpha'|'beta'|'stable'|'bare', version:string}|null`, `compareVersions(a,b) -> -1|0|1`, `visibleChannels(pin) -> string[]`, `latestVisible(tagNames, pin) -> {tag, version, channel}|null`, `CHANNELS = ['alpha','beta','stable']`

- [ ] **Step 1: Write failing tests** — cases: parse `alpha/v0.113.0`, bare `v0.113.0`, reject `foo/v1`, `v1.2` (needs x.y.z), numeric compare `0.9.0 < 0.10.0`, cross-prefix `alpha/v0.113.0 > stable/v0.112.0` via latestVisible, union rules per pin (stable pin ignores alpha tags; alpha pin sees all), empty list → null.
- [ ] **Step 2: Run** `npx vitest run plugins/devops/mcp-server/ship/lib/channels.test.js` — expect FAIL (module missing).
- [ ] **Step 3: Implement** pure functions, no I/O.
- [ ] **Step 4: Run again** — expect PASS.
- [ ] **Step 5: Commit** `feat(ship): channel tag helpers (parse/compare/resolve)`

### Task 2: `ship_promote` MCP tool

**Files:**
- Create: `plugins/devops/mcp-server/ship/tools/promote.js`
- Test: `plugins/devops/mcp-server/ship/tools/promote.test.js`
- Modify: `plugins/devops/mcp-server/ship/index.js` (register tool)
- Modify: `plugins/devops/mcp-server/ship/lib/github.js` (add `releaseExists(tag, opts)`)

**Interfaces:**
- Consumes: Task 1 helpers; `git`/`gitStrict` from `lib/git.js`; `createRelease`/`releaseExists` from `lib/github.js`.
- Produces: tool result `{ success, version, from, to, sha, tag, bareTag?, alreadyPromoted?, release?, pushed?, missing? }`. Schema: `{ version, from: enum(alpha,beta), to: enum(beta,stable), cwd }`.

Handler logic (spec §4.1): ls-remote source tag → SHA; monotonicity guard (empty target ⇒ allow; `==` + same SHA ⇒ `alreadyPromoted:true`; `<` ⇒ refuse); ancestry guard `merge-base --is-ancestor <sha> origin/main`; annotated tag via `execFileSync("git",["tag","-a",tag,sha,"-m",payload])`, push, ls-remote verify, skip-if-exists; stable ⇒ additionally bare tag (stable-first ordering, both-verified gate, `pushed`/`missing` on partial); stable ⇒ poll `releaseExists(bareTag)` (6×10s), fallback `createRelease` with CHANGELOG notes passed in via param `releaseNotes`; beta ⇒ NO release.

- [ ] **Step 1: Write failing tests** (mirror `release.test.js` mock pattern: zod stub, mock `node:child_process`, `../lib/git.js`, `../lib/github.js`, `../lib/channels.js` NOT mocked — pure). Cases: happy alpha→beta; missing source tag; downgrade refused; equal+same-SHA idempotent; empty target allowed; stable creates stable+bare in order; partial bare failure → `success:false, missing:["v0.113.0"]`; re-run completes; beta creates no release; stable falls back to createRelease when poll never sees it.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `promote.js` + `releaseExists` + register in `index.js` (description: "Promote a shipped version to a higher channel by re-tagging the same SHA (alpha→beta→stable). Never rebuilds.").
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(ship): ship_promote tool — ring promotion via annotated tags`

### Task 3: `ship_release` ships to alpha

**Files:**
- Modify: `plugins/devops/mcp-server/ship/tools/release.js:241-269`
- Test: `plugins/devops/mcp-server/ship/tools/release.test.js`

**Interfaces:**
- Consumes: existing params (`tag` stays bare `vX.Y.Z`).
- Produces: result `tag: "alpha/vX.Y.Z"`, `channel: "alpha"`, `releaseDeferred: true`; no `createRelease` call at ship time.

- [ ] **Step 1: Adjust/extend tests**: expect annotated `alpha/v1.0.0` created+pushed; `createRelease` NOT called; idempotency check against `alpha/v1.0.0`; intermediate merges still skip tags.
- [ ] **Step 2: Run** — FAIL on new expectations.
- [ ] **Step 3: Implement**: prefix `alpha/`, `execFileSync` annotated tag (`-m {"channel":"alpha"}`), drop createRelease block (keep params accepted; set `releaseDeferred: true` when releaseNotes given).
- [ ] **Step 4: Run full ship tool tests** — PASS.
- [ ] **Step 5: Commit** `feat(ship): ship_release publishes to alpha channel`

### Task 4: CJS channel helpers + consumer hook rewrite

**Files:**
- Create: `plugins/devops/hooks/lib/channels.js` (CJS twin of Task 1 + `readChannelPin(pluginsDir, marketplace)`)
- Test: `plugins/devops/hooks/lib/channels.test.js`
- Modify: `plugins/devops/hooks/session-start/ss.plugin.update.js:334-345` (pull → pin), `:264-292` (registry `channel` field)

**Interfaces:**
- Consumes: `.channels.json` sidecar at `~/.claude/plugins/.channels.json` (`{"<marketplace>": "beta"}`), default `stable`.
- Produces: pin sequence — `git fetch origin --tags` + fetch branch; if NO `stable/*` tag → legacy pull path unchanged (bootstrap fallback); else resolve `latestVisible`, and when target SHA ≠ HEAD: `reset --hard` + `clean -fd` + `checkout --detach <tag>`. `headChanged` stays SHA-based (localHead vs newHead) — versionChanged logic untouched (bit-identical channels ⇒ same version ⇒ same dir).

- [ ] **Step 1: Write failing tests** for the CJS lib (same cases as Task 1 + pin file read: missing file ⇒ stable, invalid JSON ⇒ stable, valid pin).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement lib**, then rewrite the hook's pull block per the spec table (§5.2): legacy path preserved verbatim under the fallback condition; dirty-retry inside the pin path re-pins (never pulls).
- [ ] **Step 4: Run lib tests + `node -c`-style smoke** (`node --check ss.plugin.update.js`) — PASS.
- [ ] **Step 5: Commit** `feat(hooks): channel-aware plugin updates (tag pinning + bootstrap fallback)`

### Task 5: `/promote` skill

**Files:**
- Create: `plugins/devops/skills/promote/SKILL.md`

Content per spec §4.2: frontmatter (name promote, triggers "release", "promote", "promotion", "channel release", explicit-invocation bias), one-line channel state via `git ls-remote --tags origin`, AskUserQuestion with precomputed meaningful promotions (recommended first), fast-track = two `ship_promote` calls with retry semantics, completion card. Document `cwd` requirement like ship does.

- [ ] **Step 1: Write SKILL.md** (skills have no unit tests; validate against `plugins/devops/CONVENTIONS.md` skill structure).
- [ ] **Step 2: Commit** `feat(skills): /promote — deliberate channel promotion`

### Task 6: Ship skill nudge + plugin-update channel UX + docs

**Files:**
- Modify: `plugins/devops/skills/ship/SKILL.md` (Step 4: tag is `alpha/vX.Y.Z`; Step 6: promotion-gap nudge — compute drift via `git ls-remote --tags origin 'refs/tags/stable/*' 'refs/tags/v*'`, escalate ≥3 versions/≥7 days, add as card `userFinalTest`/summary line)
- Modify: `plugins/devops/skills/auto-update/SKILL.md` (`--channel` flag → writes sidecar; drift line "latest visible vN (alpha has vM available)")
- Modify: `plugins/devops/CONVENTIONS.md` (ring-model tagging convention)
- Modify: `plugins/devops/skills/ship/deep-knowledge/versioning.md` + `release-flow.md` (channel section)
- Modify: `.github/workflows/release.yml` (checkout `fetch-depth: 0` + `fetch-tags: true`; `git describe --tags --match 'v[0-9]*' --abbrev=0 HEAD~1`)

- [ ] **Step 1: Apply all edits.**
- [ ] **Step 2: Commit** `feat(ship): promotion-gap nudge, channel docs, release.yml tag fixes`

### Task 7: Full verification + ship

- [ ] **Step 1:** `npm test` — all green (expect existing suite + new tests).
- [ ] **Step 2:** `npm run lint` — clean.
- [ ] **Step 3:** CHANGELOG entry for the feature version; then `/ship` (minor bump). Rollout checklist §5.4 note: steps 2–5 of the checklist (release.yml live check, content-identity, fast-track stable promotion, consumer verify) happen POST-ship via `/promote` — the bootstrap fallback keeps consumers safe until then.
