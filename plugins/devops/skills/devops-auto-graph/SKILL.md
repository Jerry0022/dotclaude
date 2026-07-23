---
name: devops-auto-graph
version: 0.4.0
description: >-
  Codebase knowledge graph via the external graphify CLI, default-on and
  opt-out. Detects graphify, auto-installs it in the background if missing,
  keeps the graph fresh with a key-less `graphify update .`, and answers
  codebase questions with `graphify query`. Enabled automatically in every
  project unless `.claude/graphify.json` (or the global `~/.claude/graphify.json`)
  has `{"consent":false}`. Once enabled, the graph is kept fresh windowlessly
  (SessionStart refresh + PreToolUse self-heal — graphify's own git hooks are
  removed, not installed) and broad raw-file searches are hard-gated toward
  the graph. Deliberately does NOT install graphify's own PreToolUse hook
  (would collide with the devops token-guard); the enforcement is
  devops-owned. Triggers: "knowledge graph", "graphify", "code graph",
  "/devops-auto-graph". Do NOT trigger for simple single-file lookups.
allowed-tools: Bash(node *), Bash(graphify *), Bash(uv *), Bash(pipx *), Read, Glob, Write
---

# devops-auto-graph — Codebase Knowledge Graph (default-on, opt-out)

Thin orchestration over the real [`graphify`](https://github.com/safishamsi/graphify)
CLI. graphify stays the single source of truth — this skill reimplements
nothing. It **detects**, **auto-installs** if missing, **freshens the graph**,
and **queries** it. graphify enforcement is **enabled by default** in every
project — no consent prompt, no offer to confirm. The graph is kept fresh
automatically and broad searches are hard-gated toward it — see
[Enforcement](#enforcement-default-on).

## Hard rules

- **No consent prompt, ever.** Enforcement is default-on. Never ask the user
  to confirm enabling graphify and never write a consent record on their
  behalf — `.claude/graphify.json` / `~/.claude/graphify.json` are read-only
  from hooks; only the user edits them, manually, to opt out.
- **Never run `graphify claude install`.** That command writes graphify's own
  PreToolUse hook + CLAUDE.md skill, which collides with the devops plugin's
  PreToolUse hooks (the project-map re-scoping hint and `pre.tokens.guard.js`).
  Our enforcement is devops-owned instead (single, ordered hook chain).
- **Never install graphify's own git hooks.** They pop a console window on
  Windows on every commit/checkout. `ss.graphify` actively removes them
  (`graphify hook uninstall`) if present — devops owns graph freshness
  instead, windowlessly, via SessionStart + PreToolUse self-heal.
- **Do not touch `project-map`.** It is a different layer (cheap always-on
  orientation, not on-demand deep retrieval).

## Step 1 — Detect graphify

Probe with the generic helper (resolves the plugin root via the cache path or
this source repo):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-tool.js" graphify --version
```

Parse the single JSON line:
- `{"installed":true,...}` → go to Step 3.
- `{"installed":false}` → go to Step 2.

## Step 2 — Install if missing (background, no confirmation needed)

If graphify is missing, `ss.graphify` already kicked off a best-effort,
windowless background install (`uv tool install graphifyy`) at SessionStart —
this is auto-installed, not offered. If you land here mid-session and the CLI
still isn't on PATH, you may run the same command directly:

```bash
uv tool install graphifyy
```

Fallbacks if `uv` is absent: `pipx install graphifyy` or `pip install graphifyy`
(pip needs manual PATH setup). This is fail-open — if no installer is
available, report that graph features are unavailable this session and fall
back to normal Grep/Glob.

After install, re-run Step 1 to verify before continuing.

## Step 3 — Ensure the graph is fresh

Check for `graphify-out/graph.json` in the project root (use **Glob**). If it is
missing or the user expects recent code changes to be reflected, refresh it:

```bash
graphify update .
```

`graphify update` is incremental, AST-only, and key-less — it costs no API
tokens and needs no LLM key. A first-time full build on a large repo may take
longer; say so before running. Do **not** use `graphify extract . --update`
for this automatic path — that command needs an LLM API key once docs/PDF/image
extraction is involved and is not run automatically. `graphify extract` is
still the right command only if the user explicitly wants full semantic
extraction over docs/papers/images.

## Step 4 — Query

Answer the user's codebase question against the graph instead of grepping:

```bash
graphify query "<the user's question>"
```

Relay the result. For follow-up questions in the same session, reuse the
existing graph — only re-run Step 3 if the code changed meaningfully.

## Enforcement (default-on)

graphify enforcement is **enabled by default** in every project. The only way
to turn it off is an explicit opt-out record — hooks never write these, only
the user does:

- `.claude/graphify.json` with `{"consent":false}` → disabled for this project.
- `~/.claude/graphify.json` with `{"consent":false}` → disabled machine-wide,
  for every project.
- Absent (both project and global) → **enabled** — this is the default and
  the common case.

The first time graphify auto-enables for a project with no record at all,
`ss.graphify` prints a one-time (weekly-throttled), non-blocking transparency
line disclosing that it's on and how to opt out. This is a disclosure, not an
offer — there is nothing to confirm.

When **enabled**, two things are automatic — no need to invoke this skill:

**1. Auto-install + auto-build / freshness.** `ss.graphify` ensures graphify
is installed (best-effort background `uv tool install graphifyy` if missing),
removes graphify's own git hooks once per project if present (`graphify hook
uninstall` — those pop a console window on Windows on every commit), and kicks
off a background `graphify update .` (windowless, sentinel-tracked) whenever
the graph is missing, stale, or fails a periodic validity check. So the graph
follows the code purely via windowless SessionStart refresh + PreToolUse
self-heal — never via graphify's own git hooks.

**2. Hard gate (D3).** `pre.tokens.guard` **blocks** a broad raw-file Grep/Glob
(exit 2) and tells Claude to run `graphify query` instead. Two preconditions
keep this safe — both enforced in code, never optional:

- **Bounded staleness tolerance** — the gate does not require perfect
  freshness. `stalenessInfo` counts how many source files are newer than
  graph.json; the gate still fires (with a "graph lags N file(s) behind —
  background refresh started" disclosure) up to a small tolerance, and only
  falls back to self-heal (no block) when the lag is large or cannot be
  bounded at all (missing graph, truncated scan, nothing comparable). A graph
  whose staleness cannot be proven is never forced onto Claude.
- **Escape hatch** — the gate blocks a given search at most once per session;
  *retrying the same search falls through*, so a question the graph cannot
  answer (exact string, a new/uncommitted file, a non-code asset) is never
  wedged. Once any `graphify query` runs (tracked by `post.graphify.query`), the
  gate relents for the rest of the session.

This is stronger than graphify's own registration — graphify's `claude install`
hook only emits `permissionDecision:"allow"` (a soft nudge), never a block. The
trade-off: a real gate adds friction the bare nudge does not. Logic lives in
`hooks/lib/graph-nudge.js` + `hooks/lib/graphify-state.js` (unit + integration
tested).

## Out of scope (v1)

- No graphify MCP server (`python -m graphify.serve`) — shell-out per query.
- Auto-build is **code-only** (`graphify update .`, AST). Doc/PDF/image semantic
  extraction via `graphify extract` (which costs API tokens) is never enabled
  automatically — only on explicit user request.
- The gate only covers *broad* searches (Grep/Glob with no `path`); targeted,
  path-scoped reads are intentionally left free.
