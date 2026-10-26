# Ship Reference — dotclaude (plugin-source repo)

This is the **plugin-source** repo. A ship here changes the devops plugin itself,
so after the merge the locally-installed devops in *this* Claude Code instance must
be brought in sync with what was just shipped — otherwise the running instance keeps
the old version and the next session lands in a stale state ("devops nicht verfügbar").

> **Channel caveat (ring model).** "In sync with what was just shipped" only holds
> when the local install's channel pin (`~/.claude/plugins/.channels.json`, default
> `stable`) actually receives the shipped version. A plain `/do-ship` publishes to
> **alpha** only, so on the default stable pin the local install correctly STAYS on the
> previous stable version until `/do-ship promote` promotes it — the Step 8 finalizer is
> then a cache-repair no-op, not a failure. Do not "fix" the detached-HEAD marketplace
> clone by forcing it onto `main`; the pin resets it by design. See the memory
> `project_ring_model_local_stays_stable` for the full symptom/diagnosis note.

## Why, paths, path resolution

Why this repo (and no other) self-updates after a ship, the double-restart and
cache/registry-drift failure modes, the paths involved, and why Step 8 resolves the
hook fresh instead of trusting `${CLAUDE_PLUGIN_ROOT}`:
`deep-knowledge/self-update-rationale.md`. The finalizer delegates to the same hook as
`/auto-update` (`hooks/session-start/ss.plugin.update.js`); no update logic lives here.

## deliver / verify

deliver: git+gh
<!-- No remote-deploy surface. The "delivery" of this repo is the plugin update above. -->

---


# Ship Extension — dotclaude (plugin-source repo)

Adds one project-specific step to `/do-ship`: a **post-ship self-update** of the
installed devops plugin. This repo ships the plugin that runs the ship, so the local
install must be reconciled with what was just merged. Full rationale (double-restart
problem, observed cache/registry drift): `deep-knowledge/self-update-rationale.md`.

This extension is **additive** — every plugin-default step still runs unchanged.

## Step 6.5 — Announce the local channel outcome IN the completion card

Do this **before** calling `render_completion_card` in Step 6, using pure file reads
(no MCP). **Channel-aware (ring model):** a plain `/do-ship` publishes vNew to the
**alpha** channel only. The local install follows its channel pin at
`~/.claude/plugins/.channels.json` (`{ "dotclaude": "<channel>" }`; absent → `stable`).
Whether the local install moves to vNew depends on that pin — it does NOT
automatically sync to every ship.

1. Read the channel pin: `~/.claude/plugins/.channels.json` → `dotclaude` (absent/unknown → `stable`).
2. Read installed version: `~/.claude/plugins/installed_plugins.json` → `plugins["devops@dotclaude"][0].version`.
3. Add exactly one `userFinalTest` item, in the user's language:
   - **Pin is `alpha`** — the install tracks alpha, so the Step 8 finalizer moves it to vNew.
     The card is rendered before the finalizer runs, so the item names the sync
     that follows, never a finished one:
     > `{ action: "devops lokal (alpha) wird auf v<vNew> synchronisiert — danach Claude einmal neu starten, dann ist die neue Version aktiv.", afterDeployment: true }`

     When Step 8's verify loop gives up (the clone still reports vOld after three
     attempts), that is said in ONE line before the card widget (Step 8) — never
     after the card, and never as a claimed sync.
   - **Pin is `alpha` AND a `backlog-runner` lockout is active** (Step 8 guard below —
     this ship is one of several in a `/do-run backlog` queue): the finalizer is deferred
     to the runner's own Step 5, so do not claim a sync yet:
     > `{ action: "devops lokal (alpha) wird nach dem letzten Backlog-Issue auf die geshippte Version synchronisiert — danach Claude einmal neu starten.", afterDeployment: true }`
   - **Pin is `alpha` AND `.claude/.ship-queue` exists** (an auto-cleanup PR queue):
     same deferral, the cleanup run syncs once after its last PR:
     > `{ action: "devops lokal (alpha) wird nach dem letzten PR der Queue auf die geshippte Version synchronisiert — danach Claude einmal neu starten.", afterDeployment: true }`
   - **Pin is `beta`/`stable`** (the default) — an alpha-only ship does NOT reach this
     install. Do **not** claim any local sync; point to promotion:
     > `{ action: "v<vNew> ist auf alpha veröffentlicht; dein <pin>-Install bleibt auf v<installed>. »promote <pin> <vNew>« an Claude promotet genau diese Version (alpha→<pin>), danach zieht der Install v<vNew> beim nächsten Start.", afterDeployment: true }`

**Never assert "lokal auf vNew synchronisiert" on a beta/stable pin.** The finalizer
(Step 8) correctly holds the install on its pinned channel tag, so an alpha-only ship
leaves it unchanged — a false "synced" claim sends the user hunting a non-existent
sync failure (observed 2026-07-19). This keeps the completion card the **last visible
output** (per plugin Step 6); do **not** print the notice as separate prose after the
card — the card carries it.

## Step 8 — Self-update finalizer (silent, between the render and the card widget)

> **Ordering is mandatory.** This MUST run **after** `render_completion_card` (Step 6)
> and **before** the card reaches the user: on the Desktop app before the
> `show_widget` call the render result asks for, in the terminal before the card
> markdown is output. The sync rebuilds the cache to a new `installPath` and writes
> `~/.claude/plugins/.mcp-stale.json`; once that sentinel exists, `pre.mcp.health`
> blocks every further `mcp__plugin_devops_*` call — running it before the render
> would brick the card. `show_widget` belongs to the Desktop app, not to this
> plugin, so the sentinel never blocks it. This step used to run after the card:
> its Bash row sat under the widget and drew a closing "synced, restart" sentence
> the card already carried (observed 2026-09-25).

> **Channel-aware — NOT a guaranteed move to vNew.** The finalizer runs
> `ss.plugin.update`, which is channel-pinned (ring model): it reconciles the local
> install to the **highest version visible to the pin** (`.channels.json`, default
> `stable`) via a detached channel-tag checkout — NOT to `main`/vNew. After a plain
> (alpha-only) ship on a stable/beta pin the version does NOT move and the finalizer
> only cache-repairs — that is EXPECTED, not a drift bug. Do NOT force the marketplace
> clone onto `main`/an alpha tag to "fix" it (the pin resets it every SessionStart by
> design). The install receives vNew only after `/do-ship promote` promotes it to the pin.

### Guards — skip the finalizer entirely when ANY of:

- **Not a final ship to main.** `intermediate: true` from Step 1 → skip. Intermediate
  merges don't change the published plugin version.
- **Keep-mode** (Step 5a chose keep / Step 5c ran). The user keeps working in this same
  session; marking MCP stale would break their next `ship_*` / card call mid-flow. Skip,
  and do **not** add the Step 6.5 card item either. The plugin syncs on their next real
  restart via `ss.plugin.update` as usual.
- **Ship did not succeed** (`ship_release.success` falsy / `ship-blocked` card). Nothing
  was merged → nothing to sync.
- **A `backlog-runner` lockout is active.** Run
  `node "$CLAUDE_PLUGIN_ROOT/scripts/autonomous-lockout.js" check` and read `owner`:
  `"backlog-runner"` means this ship is one of several that `/do-run backlog` composes
  from ONE session. The finalizer marks the MCP servers stale, and `pre.mcp.health`
  would then block the `ship_*` / card calls of every issue still in the queue — on
  2026-09-18 the deferral had to be done by hand (PRs #401/#402/#404). Skip here; the
  runner runs this finalizer exactly once at its Step 5, after its final card's render
  and before that card is delivered. Use the deferred Step 6.5 wording for the card item.
- **A ship-queue marker exists.** `{project}/.claude/.ship-queue` (written by
  the auto-cleanup skill's Step 10b — or any orchestrator that lands several PRs from one
  session, see the plugin `/do-ship` → *Composed ships*) means the same thing as the
  `backlog-runner` lockout above, without an AFK lockout: the user is present, the
  ships are interactive, but the finalizer would still strand every later `ship_*`
  call of the queue behind `.mcp-stale`. Skip here; the orchestrator runs this
  finalizer exactly once after its last ship and then deletes the marker. Use the
  deferred Step 6.5 wording for the card item (replace „Backlog-Issue" with „PR").
  A marker older than 6 h is stale (plugin `/do-ship` → *Composed ships*): delete it
  and run the finalizer normally.
- **devops not installed here** ("falls vorhanden"). If
  `~/.claude/plugins/marketplaces/dotclaude` does not exist, there is no install to sync.
  The hook no-ops on its own, so just running it is safe — no extra guard needed.

### Action

Run the canonical updater (same hook `/auto-update` delegates to — single
source of truth, no duplicated logic).

**Resolve the hook path fresh — do NOT use `${CLAUDE_PLUGIN_ROOT}`.** That variable
pins the version dir the session started with (e.g. `…/devops/0.106.0`), which a
cache rebuild (a parallel session's SessionStart, or a prior finalizer run) may have
**deleted** by the time Step 8 runs — observed as `MODULE_NOT_FOUND` right after the
0.107.0 ship. Take the **marketplace clone's** hook first: it is always present, it
survives every rebuild, and it is the newest hook on disk (the clone was pulled by
the previous sync and is pulled again by this run). Only when the clone is missing,
fall back to the cache — the **highest** version dir, never the first one `ls`
prints: several version dirs coexist and `ls | head -1` returns the lexically first,
i.e. the OLDEST (observed 2026-09-21: the 0.179.0 hook ran with `--force`, exited 0,
printed nothing and moved nothing; only the clone's hook synced 0.183.8 → 0.183.9).
Same version-glob rule as `CONVENTIONS.md` (Scripts → Version-glob rule).

```bash
M="$HOME/.claude/plugins/marketplaces/dotclaude"
f="$M/plugins/devops/hooks/session-start/ss.plugin.update.js"
[ -f "$f" ] || f="$(ls -d "$HOME/.claude/plugins/cache/dotclaude/devops"/*/hooks/session-start/ss.plugin.update.js 2>/dev/null | sort -V | tail -1)"
# sed, not node: under Git Bash `$M` is a POSIX path (/c/Users/…) that node's
# require() cannot resolve — the helper printed '' and the loop never saw success.
installed() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$M/plugins/devops/.claude-plugin/plugin.json" | head -1; }
for attempt in 1 2 3; do
  node "$f" --force
  [ "$(installed)" = "<vNew>" ] && break
  echo "[finalizer] attempt $attempt: clone still on $(installed), expected <vNew> — refetching tags" >&2
  git -C "$M" fetch --tags origin >/dev/null 2>&1
  sleep 5
done
echo "[finalizer] installed: $(installed)"
```

**Verify, then retry — never trust one silent run;** `--force` is mandatory (it bypasses
the SessionStart cooldown); a pin failure prints `pin to <tag> failed …` — carry that line
into the honest-miss item. Why, and the already-synced race signature:
`deep-knowledge/step8-finalizer.md`.

**Then deliver the card — and nothing after it.** The completion card (with the restart
item from Step 6.5) is the last thing the user sees: call `show_widget` (Desktop) or output
the markdown (terminal) right after this step. Capture the hook's stdout into the tool
result only — do not echo it into the chat. Only when the verify loop gave up (the clone
still on vOld) write ONE line before the card, in the user's language — never a claimed
sync:
> `{ line: "devops lokal (alpha) steht noch auf v<vOld> — der Sync-Hook hat das Tag alpha/v<vNew> nicht gesehen. Claude »devops update« sagen, dann Claude einmal neu starten." }`

The session is now in a deliberately MCP-stale state; that is expected and resolves on the
user's single restart.

### After-restart contract

On the user's next session start, `ss.plugin.update` finds the marketplace clone and cache
already on the shipped version → nothing moves → it **clears** the stale sentinel → MCP
tools work immediately, new version active. One restart, no blocked-tool window.

## Add after Step 5b

### Plugin audit on a decade boundary (background, never a gate)

On the final ship of a version that crosses a decade boundary (`0.289.x → 0.290.0`),
start the plugin audit in the background after Step 5b. Trigger check, command, card
hint, and why the parent owns it under `--delegated`:
`deep-knowledge/plugin-audit-trigger.md` (sibling of this file).
