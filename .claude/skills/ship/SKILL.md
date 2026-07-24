---
name: ship
description: >-
  Project ship extension for the dotclaude plugin-source repo. After a successful
  ship to main, syncs the locally-installed devops plugin to the just-shipped
  version so this Claude Code instance doesn't end up on a stale install.
---

# Ship Extension — dotclaude (plugin-source repo)

Adds one project-specific step to `/ship`: a **post-ship self-update** of the
installed devops plugin. This repo ships the plugin that runs the ship, so the local
install must be reconciled with what was just merged. See `reference.md` in this folder
for the full rationale (double-restart problem, observed cache/registry drift).

This extension is **additive** — every plugin-default step still runs unchanged.

## Step 6.5 — Announce the local channel outcome IN the completion card

Do this **before** calling `render_completion_card` in Step 6, using pure file reads
(no MCP). **Channel-aware (ring model):** a plain `/ship` publishes vNew to the
**alpha** channel only. The local install follows its channel pin at
`~/.claude/plugins/.channels.json` (`{ "dotclaude": "<channel>" }`; absent → `stable`).
Whether the local install moves to vNew depends on that pin — it does NOT
automatically sync to every ship.

1. Read the channel pin: `~/.claude/plugins/.channels.json` → `dotclaude` (absent/unknown → `stable`).
2. Read installed version: `~/.claude/plugins/installed_plugins.json` → `plugins["devops@dotclaude"][0].version`.
3. Add exactly one `userFinalTest` item, in the user's language:
   - **Pin is `alpha`** — the install tracks alpha, so the Step 8 finalizer moves it to vNew:
     > `{ action: "devops lokal (alpha) auf v<vNew> synchronisiert — Claude einmal neu starten, dann ist die neue Version aktiv.", afterDeployment: true }`
   - **Pin is `beta`/`stable`** (the default) — an alpha-only ship does NOT reach this
     install. Do **not** claim any local sync; point to promotion:
     > `{ action: "v<vNew> ist auf alpha veröffentlicht; dein <pin>-Install bleibt auf v<installed>. /promote promoten (alpha→<pin>), danach zieht der Install v<vNew> beim nächsten Start.", afterDeployment: true }`

**Never assert "lokal auf vNew synchronisiert" on a beta/stable pin.** The finalizer
(Step 8) correctly holds the install on its pinned channel tag, so an alpha-only ship
leaves it unchanged — a false "synced" claim sends the user hunting a non-existent
sync failure (observed 2026-07-19). This keeps the completion card the **last visible
output** (per plugin Step 6); do **not** print the notice as separate prose after the
card — the card carries it.

## Step 8 — Self-update finalizer (silent, runs LAST)

> **Ordering is mandatory.** This MUST run **after** `render_completion_card` (Step 6)
> and after Memory Dream (Step 7). The sync rebuilds the cache to a new `installPath`
> and writes `~/.claude/plugins/.mcp-stale.json`; once that sentinel exists,
> `pre.mcp.health` blocks every further MCP call (including the completion card).
> Running it before the card would brick the card render.

> **Channel-aware — NOT a guaranteed move to vNew.** The finalizer runs
> `ss.plugin.update`, which is channel-pinned (ring model): it reconciles the local
> install to the **highest version visible to the pin** (`.channels.json`, default
> `stable`) via a detached channel-tag checkout — NOT to `main`/vNew. After a plain
> (alpha-only) ship on a stable/beta pin the version does NOT move and the finalizer
> only cache-repairs — that is EXPECTED, not a drift bug. Do NOT force the marketplace
> clone onto `main`/an alpha tag to "fix" it (the pin resets it every SessionStart by
> design). The install receives vNew only after `/promote` promotes it to the pin.

### Guards — skip the finalizer entirely when ANY of:

- **Not a final ship to main.** `intermediate: true` from Step 1 → skip. Intermediate
  merges don't change the published plugin version.
- **Keep-mode** (Step 5a chose keep / Step 5c ran). The user keeps working in this same
  session; marking MCP stale would break their next `ship_*` / card call mid-flow. Skip,
  and do **not** add the Step 6.5 card item either. The plugin syncs on their next real
  restart via `ss.plugin.update` as usual.
- **Ship did not succeed** (`ship_release.success` falsy / `ship-blocked` card). Nothing
  was merged → nothing to sync.
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
0.107.0 ship. Glob the cache first, fall back to the marketplace clone (always
present, survives every rebuild):

```bash
f="$(ls -d "$HOME/.claude/plugins/cache/dotclaude/devops"/*/hooks/session-start/ss.plugin.update.js 2>/dev/null | head -1)"
[ -z "$f" ] && f="$HOME/.claude/plugins/marketplaces/dotclaude/plugins/devops/hooks/session-start/ss.plugin.update.js"
node "$f"
```

If the cache/registry/marketplace already report the just-shipped version and no
`~/.claude/plugins/.mcp-stale.json` exists, another session raced ahead and the sync
already happened — the hook run is then a silent no-op; verify the three paths (see
reference.md) instead of treating the earlier `MODULE_NOT_FOUND`-style failure as fatal.

The hook handles `git pull --ff-only` on the marketplace clone, cache rebuild to the
shipped version, `installed_plugins.json` update, and the MCP-stale sentinel on a real
version move.

**Produce NO visible output after this.** The completion card (with the restart item from
Step 6.5) is the last thing the user sees. Capture the hook's stdout into the tool result
only — do not echo it into the chat. The session is now in a deliberately MCP-stale state;
that is expected and resolves on the user's single restart.

### After-restart contract

On the user's next session start, `ss.plugin.update` finds the marketplace clone and cache
already on the shipped version → nothing moves → it **clears** the stale sentinel → MCP
tools work immediately, new version active. One restart, no blocked-tool window.
