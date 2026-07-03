---
name: ship
description: >-
  Project ship extension for the dotclaude plugin-source repo. After a successful
  ship to main, syncs the locally-installed devops plugin to the just-shipped
  version so this Claude Code instance doesn't end up on a stale install.
---

# Ship Extension — dotclaude (plugin-source repo)

Adds one project-specific step to `/devops-ship`: a **post-ship self-update** of the
installed devops plugin. This repo ships the plugin that runs the ship, so the local
install must be reconciled with what was just merged. See `reference.md` in this folder
for the full rationale (double-restart problem, observed cache/registry drift).

This extension is **additive** — every plugin-default step still runs unchanged.

## Step 6.5 — Announce the self-update IN the completion card

Runs only when the **self-update will actually run** (see Step 8 guards). Do this
**before** calling `render_completion_card` in Step 6, using pure file reads (no MCP):

1. Read marketplace version: `~/.claude/plugins/marketplaces/dotclaude/plugins/devops/.claude-plugin/plugin.json` → `version`.
2. Read installed version: `~/.claude/plugins/installed_plugins.json` → `plugins["devops@dotclaude"][0].version`.
3. If they differ (or will differ because this ship bumped the version), add one
   `userFinalTest` item to the Step 6 card payload, in the user's language:

   > `{ action: "devops lokal auf v<vNew> synchronisiert — Claude einmal neu starten, dann ist die neue Version aktiv.", afterDeployment: true }`

This keeps the completion card the **last visible output** (per plugin Step 6) while
still telling the user the one thing they must do: restart once. Do **not** print any
restart notice as separate prose after the card — the card carries it.

If the versions already match and this ship did not bump the plugin version, skip the
card item (the Step 8 sync will be a silent no-op / in-place cache repair).

## Step 8 — Self-update finalizer (silent, runs LAST)

> **Ordering is mandatory.** This MUST run **after** `render_completion_card` (Step 6)
> and after Memory Dream (Step 7). The sync rebuilds the cache to a new `installPath`
> and writes `~/.claude/plugins/.mcp-stale.json`; once that sentinel exists,
> `pre.mcp.health` blocks every further MCP call (including the completion card).
> Running it before the card would brick the card render.

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

Run the canonical updater (same hook `/devops-plugin-update` delegates to — single
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
