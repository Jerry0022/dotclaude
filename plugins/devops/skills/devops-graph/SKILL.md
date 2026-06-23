---
name: devops-graph
version: 0.2.0
description: >-
  On-demand codebase knowledge graph via the external graphify CLI. Detects
  graphify, offers to install it (with confirmation — never silent), builds or
  refreshes the graph, then answers codebase questions with `graphify query`.
  Best for large codebases where querying a graph beats grepping/reading files.
  Deliberately does NOT install graphify's own PreToolUse hook (would collide
  with the devops project-map and token-guard hooks). Triggers: "knowledge
  graph", "graphify", "code graph", "/devops-graph". Do NOT trigger for simple
  single-file lookups — plain grep/Read is cheaper there.
allowed-tools: Bash(node *), Bash(graphify *), Bash(uv *), Bash(pipx *), Read, Glob
---

# devops-graph — On-Demand Codebase Knowledge Graph

Thin orchestration over the real [`graphify`](https://github.com/safishamsi/graphify)
CLI. graphify stays the single source of truth — this skill reimplements
nothing. It only **detects**, **offers to install**, **freshens the graph**, and
**queries** it. Everything is on-demand; nothing runs in the background.

## Hard rules

- **Never install silently.** If graphify is missing, *offer* and wait for an
  explicit OK before running any install command.
- **Never run `graphify claude install`.** That command writes graphify's own
  PreToolUse hook + CLAUDE.md skill, which collides with the devops plugin's
  PreToolUse hooks (the project-map re-scoping hint and `pre.tokens.guard.js`).
  This skill invokes graphify on-demand instead.
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

## Ambient nudge (automatic, once per session)

Once a graph exists, you do not have to remember this skill. The devops
`pre.tokens.guard` PreToolUse hook injects a one-line hint on the **first broad
search of a session** (alongside the project-map) that steers Claude toward
`graphify query` for semantic questions instead of grepping raw files. This is
the token-saving payoff — the graph gets *used*, not just built. The hint is:

- **Silent until a graph exists** — no graph.json, no nudge (no nagging about an
  unbuilt tool).
- **Once per session** — Claude is told the graph exists a single time, then
  decides per question; it does not spam every search.
- **devops-owned** — it lives in our hook chain, so it never collides with other
  PreToolUse hooks. We still never run `graphify claude install`.

Logic lives in `hooks/lib/graph-nudge.js` (unit-tested).

## Out of scope (v1)

- No graphify MCP server (`python -m graphify.serve`) — shell-out per query.
- No post-commit auto-rebuild hook — graph refresh is on-demand (Step 3) only.
  A background auto-rebuild could be added later as an explicit opt-in.
- The nudge piggybacks on the first *broad* search; a session that never runs
  one won't see it (acceptable for v1 — most sessions do).
