# Claude Preview — Capabilities & Hard Limits

Canonical reference for **Claude Preview** (`preview_*`), the primary localhost
app-test tool when the Chrome-in-Edge extension is not connected. Tool precedence
lives in [browser-tool-strategy.md](browser-tool-strategy.md); autonomy rules in
[test-autonomy.md](test-autonomy.md). This file documents what Preview can and
cannot do, so skills/agents defer here instead of re-describing it.

---

## What Preview Is

A sandboxed browser view that attaches to **the project's own local dev server**.
Started from `.claude/launch.json` (a named config with `runtimeExecutable` +
`port`) via `preview_start`. It previews **localhost only** — it is not a general
browser.

## Toolset → tier mapping

The tiers are defined in [test-autonomy.md](test-autonomy.md) § Surface Tier Order.

| Tier | Capability | Preview tool |
|------|-----------|--------------|
| 1 — Structured read | DOM + ARIA + console + network | `preview_snapshot`, `preview_console_logs`, `preview_network` |
| 2 — Rendered read | rendered pixels, layout, colour, CSS | `preview_screenshot`, `preview_inspect` (exact CSS props) |
| 2 — Responsive | viewport + dark mode | `preview_resize` (`mobile`/`tablet`/`desktop` presets **or** exact `width`/`height`, plus `colorScheme` light/dark) |
| 3 — Interaction | click / fill / eval | `preview_click`, `preview_fill`, `preview_eval` |
| — | lifecycle | `preview_start`, `preview_list`, `preview_stop` |

`preview_resize` ships **native** viewport presets, so for localhost responsive
testing it is preferred over the `javascript_tool` resize hack (see
[responsive-testing.md](responsive-testing.md)).

## Key advantage — session persistence

Preview persists cookies + localStorage in an Electron partition keyed by the
**baseRepo path** (`%APPDATA%\Claude\Partitions\launch-preview-<md5(baseRepo)>`).
Consequences (empirically verified):

- A login done once in a repo's Preview **persists across worktrees and chats** of
  that repo — no per-window Edge profile juggling, no re-login per chat. The account
  you log in as is normally the **local test user** (full app permissions, dev-only,
  never deployed to prod — see [test-strategy.md](test-strategy.md) § Local Test User).
- It survives `preview_stop` → `preview_start` (the partition is held by the Claude
  Desktop App main process).
- Scope is **per baseRepo**: a different repo has its own jar (one login per repo).

## Hard limits — the scope boundary

These are exactly the cases that fall back to Chrome-MCP (Edge) / Playwright /
computer-use:

- **Origin-locked to localhost.** Preview refuses external/top-level navigation
  (e.g. `window.location='https://example.com'` snaps back). `preview_start`
  requires a local dev-server port — there is no way to point Preview at an
  external URL.
- **No native desktop apps** — packaged binaries, OS shells, tray, installers.
- **No multi-tab** orchestration, **no file upload** to third parties, **no
  external-provider auth** (the partition is not logged in to third parties).

## N/A list — never route these to Preview

- **claude.ai usage scraper** (`refresh-usage-headless.js`, `~/.claude/edge-usage-profile`) —
  external origin + auth. Stays on dedicated Edge CDP. See [edge-profiles.md](edge-profiles.md).
- **External / deployed-URL checks** (e.g. post-merge production health) — not localhost.
- **`concept` interactive pages** — served over an http bridge with a cron
  heartbeat in the user's real Edge; Preview's sandbox cannot host the bridge.
- **Native / cross-app flows** — `desktop-testing.md`, `agents/windows`.

---

## Cross-References

| Topic | File |
|-------|------|
| Tool precedence / waterfall | [browser-tool-strategy.md](browser-tool-strategy.md) |
| Autonomy + tier order | [test-autonomy.md](test-autonomy.md) |
| Responsive viewports | [responsive-testing.md](responsive-testing.md) |
| Edge profiles + usage scraper | [edge-profiles.md](edge-profiles.md) |
