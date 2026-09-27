# Ship — Post-merge steps (4a–4d)

Referenced by `/do-ship` Steps 4a–4d. Each step's skip conditions and its
card outcome stay in SKILL.md; this is the execution detail.

## Step 4a — Delivery extension hook

After `ship_release` succeeds, check `{project}/.claude/skills/do-ship/reference.md` (fallback: the
pre-PR-2 `ship/` dir, Step 0) for a
`deliver:` field:

- **Default (`git+gh` or field absent):** existing behavior — PR + merge already done in Step 4.
- **`ssh-rsync`:** rsync build output to the configured `target`. (Future work — currently falls through to `none`.)
- **`ha-rest`:** POST to Home Assistant REST API at `base_url`. (Future work — currently falls through to `none`.)
- **`none`:** skip delivery entirely.

When `deliver` is set, the MCP `ship_release` tool dispatches to the corresponding
handler. Handlers `ssh-rsync` and `ha-rest` are extension points documented for
consumer configuration — not yet implemented in this release (they fall through to
`none` intentionally).

See `{PLUGIN_ROOT}/deep-knowledge/skill-extension-guide.md -> Delivery targets` for reference.md examples.

## Step 4b — Watcher spawn

After `ship_release` returns `success: true` **and** `merged: "main"`, spawn the post-merge
watcher in the background. It waits for the GitHub Actions run triggered by the merge
and (if configured) probes the production URL — all without blocking the ship flow.

```bash
# Background — fire and forget. The watcher anchors its state dir to the MAIN
# repo (resolved via git-common-dir), NOT to <cwd>: a worktree ship deletes <cwd>
# during ship_cleanup, so the result must land in the main repo where the
# ss.ship.verify hook (running from the main repo at the next SessionStart) can
# still read it. No --state-dir flag is needed — the default handles this.
nohup node "{PLUGIN_ROOT}/scripts/post-merge-watcher.js" \
  --cwd "<cwd>" \
  --base "main" \
  --merge-sha "<ship_release.mergeSha>" \
  --pr "<ship_release.pr.number>" \
  --max-wait 1800 \
  --verify-config "<cwd>/.claude/skills/do-ship/reference.md" \
  --version "<ship_version_bump.vNew or empty>" \
  > /dev/null 2>&1 &
```

On Windows (PowerShell), use `Start-Process` with `-WindowStyle Hidden` instead of `nohup`:
```powershell
Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList @("{PLUGIN_ROOT}/scripts/post-merge-watcher.js", "--cwd", "<cwd>", "--base", "main", "--merge-sha", "<sha>", "--pr", "<n>", "--max-wait", "1800", "--verify-config", "<cwd>/.claude/skills/do-ship/reference.md", "--version", "<vNew>")
```

Always pass the `do-ship/` path: when it does not exist, the watcher falls back
to the pre-PR-2 `.claude/skills/ship/reference.md` itself.

The watcher writes status to `<main-repo>/.claude/.ship-watcher/<merge-sha>.json`
(resolved from the git-common-dir, so a removed worktree cannot swallow the result)
and the `ss.ship.verify` hook — reading the same main-repo dir from ANY worktree,
never the worktree's seeded copy — surfaces unack'd results once at the next
SessionStart. On failure, a best-effort Windows toast fires immediately.

The watcher is a plugin `scripts/` CLI and is orphaned on purpose; the MCP reaper
(`hooks/lib/mcp-reaper.js`) exempts that class, so a Stop/SessionStart reap never
kills it mid-wait.

## Step 4c — Live surface verification

**A green pipeline ≠ a release users can see.** CI can pass, the merge can land,
the Step 4b watcher's HTTP probe can return 200 — and the version users actually
get can still be the **old** one. This step opens the real user-facing surface(s)
in a browser and asserts the **shipped version is live and visible** before the
completion card declares done. It complements (does NOT replace) the
`stop.flow.browsertest` gate (which verifies code changes *pre*-merge) and the
Step 4b watcher (headless, post-session). (#210)

### Config — declare surfaces

Read `{project}/.claude/skills/do-ship/reference.md` (fallback: the pre-PR-2 `ship/` dir,
Step 0) for a `surfaces:` list (or, for
a single surface, the existing `verify:` block's `url`/`selector`/`expected`).
Each surface: `{ name, url, selector, expected }` where `expected` may use the
`$VERSION` placeholder (expands to the just-shipped `vNew` / tag). Full format:
`deep-knowledge/post-merge-verify.md → Declarative surfaces`.

### Verify each surface

For every declared surface:

1. Pick the browser tool via the waterfall in
   `{PLUGIN_ROOT}/deep-knowledge/browser-tool-strategy.md` (Claude-in-Chrome in Edge first).
   This is a live post-deploy read — see `{PLUGIN_ROOT}/deep-knowledge/test-autonomy.md`.
   Works in foreground, background, and autonomous mode.
2. Open `url` in the **separate Edge testing window** (per the Edge Credo).
3. Read the **rendered** version marker. Use **Eval JS** (`javascript_tool` /
   `browser_evaluate` / `preview_eval`) to read structured data
   (`document.querySelector(selector)?.textContent` or the documented attribute)
   — NOT "read page", which strips scripts and misses client-rendered values.
4. Assert the rendered value contains the shipped version (`vNew` / tag).

**Why a browser, not just the watcher's HTTP probe:** the headless probe fetches
raw response bytes — it misses **client-rendered** version strings (SPA where JS
injects the version) and cannot see a download page whose served artifact is
gated behind a DB row or an API. A real browser renders the DOM and follows the
same path a user does. Gaps this catches that pass CI:
- a GitHub release marked `prerelease` leaves the prior version as
  `/releases/latest` → the "latest" download link still serves the old version;
- a download page driven by a DB row / API (not GitHub directly) keeps serving
  the old version until that row is registered;
- multi-surface releases (web + desktop binary + edge functions) where one
  surface silently lags.

### Feed the result into Step 6

- **All surfaces serve the shipped version** → clean `ship-successful`.
- **Any surface lags / still shows the old version / unreachable** → STILL
  `ship-successful` (the merge happened — per the Step 6 variant rule, never
  downgrade after a merge), but add one **prominent `userFinalTest` item per
  lagging surface**, e.g.
  `{ action: "Download-Seite zeigt noch <alt> statt <neu> — prerelease-Flag / DB-Row prüfen", afterDeployment: true }`.
  When a surface definitively serves the **old** version (a real regression
  risk), make that item the first and loudest.
- **No browser tool available** (waterfall fails): do NOT block the ship. Record
  a `userFinalTest` item "Live-Surface manuell verifizieren: <url> sollte <vNew> zeigen".

Pass `state.surfaceVerify = { checked: N, live: M, lagging: [...] }` into the card.

## Step 4d — Out-of-band deploy gate

When the shipped diff touches such artifacts, merging the PR leaves the code
referencing infra that was never applied — the change is silently NOT live even
though every prior step went green. This step turns `ship_preflight`'s detection
into either an actual deploy (when a handler is configured) or a mandatory,
loud completion-card gate. (#243)

**When `outOfBandDeploys.detected` is `true`:**

1. **If Step 0 captured a `deploy:` handler** that can apply these artifacts
   (e.g. `supabase` → `apply_migration` + `deploy_edge_function` via the Supabase
   MCP): run it now, after the merge landed. Deploy each detected artifact.
   - **All deployed successfully** → the change is live. Do NOT set the gate;
     instead add a `userFinalTest` item to **verify** the deployed infra behaves
     (e.g. "Verify the migration applied: query the new column in prod").
   - **Any deploy failed / handler errored** → fall through to step 2 for the
     artifacts that did not deploy, naming the failure.

   Keep concrete deploy automation in the **project** extension — the plugin
   ships detection + the gate, never a stack-specific deployer.

2. **Otherwise (no handler, or a deploy failed)** — raise the deploy gate. This
   is mandatory: the completion card MUST NOT read as "all done" while merged
   infra is undeployed. Carry into Step 6:
   - `state.deployPending: true` — flips the ship-successful CTA from
     "Alles ERLEDIGT" to "🚨 DEPLOY erforderlich (noch nicht live)".
   - `deployGate: [...]` — one item per detected artifact, each
     `{ artifact: "<path>", kind: "<migration|function|infra>", action: "<the concrete deploy step still required>" }`.
     Derive `artifact`/`kind` from `outOfBandDeploys.matched`; write `action` as
     the smallest true next step (e.g. "apply_migration", "deploy edge function
     desktop-latest", or "run your migration + function deploy").
