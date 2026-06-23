---
name: devops-graph
version: 0.3.0
description: >-
  Codebase knowledge graph via the external graphify CLI, with opt-in
  enforcement. Detects graphify, offers to install it (confirmation — never
  silent), builds/refreshes the graph, and answers codebase questions with
  `graphify query`. Once the user opts in per project, the graph is kept fresh
  automatically (git hooks + SessionStart) and broad raw-file searches are
  hard-gated toward the graph. Deliberately does NOT install graphify's own
  PreToolUse hook (would collide with the devops token-guard); the enforcement
  is devops-owned. Triggers: "knowledge graph", "graphify", "code graph",
  "/devops-graph". Do NOT trigger for simple single-file lookups.
allowed-tools: Bash(node *), Bash(graphify *), Bash(uv *), Bash(pipx *), Read, Glob, Write
---

# devops-graph — Codebase Knowledge Graph (opt-in enforced)

Thin orchestration over the real [`graphify`](https://github.com/safishamsi/graphify)
CLI. graphify stays the single source of truth — this skill reimplements
nothing. It **detects**, **offers to install**, **freshens the graph**, and
**queries** it. After a per-project opt-in (recorded in `.claude/graphify.json`)
the graph is kept fresh automatically and broad searches are hard-gated toward
it — see [Enforcement](#enforcement-after-opt-in).

## Hard rules

- **Never install silently.** If graphify is missing, *offer* and wait for an
  explicit OK before running any install command. The consent record
  (`.claude/graphify.json`) is written only after the user decides.
- **Never run `graphify claude install`.** That command writes graphify's own
  PreToolUse hook + CLAUDE.md skill, which collides with the devops plugin's
  PreToolUse hooks (the project-map re-scoping hint and `pre.tokens.guard.js`).
  Our enforcement is devops-owned instead (single, ordered hook chain).
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

## Step 2 — Offer install (confirmation required)

Tell the user graphify is not installed and offer the command. **Do not run it
until the user confirms.** Recommended:

```bash
uv tool install graphifyy && graphify install
```

Fallbacks if `uv` is absent: `pipx install graphifyy` or `pip install graphifyy`
(pip needs manual PATH setup). On decline, stop here and report that the graph
features are unavailable until graphify is installed.

After a confirmed install, re-run Step 1 to verify before continuing.

## Step 3 — Ensure the graph is fresh

Check for `graphify-out/graph.json` in the project root (use **Glob**). If it is
missing or the user expects recent code changes to be reflected, refresh it:

```bash
graphify extract . --update
```

`--update` is incremental and AST-only for code, so it costs no API tokens.
A first-time full build on a large repo may take longer; say so before running.
Only docs/PDF/image extraction would incur LLM cost — do not enable that unless
the user asks.

## Step 4 — Query

Answer the user's codebase question against the graph instead of grepping:

```bash
graphify query "<the user's question>"
```

Relay the result. For follow-up questions in the same session, reuse the
existing graph — only re-run Step 3 if the code changed meaningfully.

## Enforcement (after opt-in)

The user can opt a project in (the `ss.graphify` SessionStart hook offers this
once). Opt-in is recorded in `.claude/graphify.json`:

- `{"consent":true,"autoBuild":true}` → **enabled**
- `{"consent":false}` → **declined** (never nagged again)
- absent → **undecided** (offer shown, throttled weekly)

When **enabled**, two things become automatic — no need to invoke this skill:

**1. Auto-build / freshness (D2).** `ss.graphify` ensures graphify is installed,
installs graphify's git hooks once (`graphify hook install` — post-commit/
post-checkout AST rebuild, free), and kicks off a background
`graphify extract . --update` whenever the graph is missing or stale. So the
graph follows the code via both git hooks *and* SessionStart.

**2. Hard gate (D3).** `pre.tokens.guard` **blocks** a broad raw-file Grep/Glob
(exit 2) and tells Claude to run `graphify query` instead. Two preconditions
keep this safe — both enforced in code, never optional:

- **Staleness guard** — the gate only fires when the graph is *fresh*
  (`graphIsStale` compares graph.json mtime vs the newest source file). A stale
  graph is never forced onto Claude.
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
- Auto-build is **code-only** (`--update`, AST). Doc/PDF/image semantic
  extraction (which costs API tokens) is never enabled automatically.
- The gate only covers *broad* searches (Grep/Glob with no `path`); targeted,
  path-scoped reads are intentionally left free.
