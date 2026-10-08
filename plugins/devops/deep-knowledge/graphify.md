# graphify — Codebase Knowledge Graph (default-on, opt-out)

Codebase knowledge graph via the external graphify CLI: default-on, opt-out via `{"consent":false}` in `.claude/graphify.json` or `~/.claude/graphify.json`. Former `auto-graph` skill (skill restructure PR 3).

Thin orchestration over the real [`graphify`](https://github.com/safishamsi/graphify)
CLI. graphify stays the single source of truth — the plugin reimplements
nothing. It **detects**, **auto-installs** if missing, **freshens the graph**,
and **queries** it. graphify enforcement is **enabled by default** in every
project — no consent prompt, no offer to confirm. The graph is kept fresh
automatically; searches are never blocked or answered from it — see
[When the graph helps](#when-the-graph-helps).

## How it reaches you

Not a skill any more: the hooks do the automatic part (`ss.graphify` —
install, freshness, the session-start nudge; `pre.tokens.guard` — a one-time
graph hint on the first broad search; `post.graphify.search` / `post.graphify.query` — telemetry),
and `prompt.knowledge.dispatch` points at this document when a prompt talks
about the graph ("knowledge graph", "graphify", "code graph", or the old
`/auto-graph`). Steps 1–4 below are what to do by hand when the user asks for
the graph explicitly, or when the automatic path reported a failure. Use it
for codebase questions; not for simple single-file lookups. The old skill had
no extension point, so a `.claude/skills/auto-graph/` directory is ignored.

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
node "{PLUGIN_ROOT}/scripts/check-tool.js" graphify --version
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

Graphify answers *structural/semantic* questions (what defines/calls X, how do
A and B relate, where is Y handled) — grep is still the right tool for an
*exact string*. Ask, don't grep, and keep the budget small — a wide default
answer can cost more than the raw search it replaces:

```bash
graphify query "<the user's question>" --budget 400
```

`--budget` up to `800` is fine for a question that genuinely needs more nodes;
going wider than that usually means the question is too broad, not the budget
too small. In a **linked worktree** (or a session whose cwd is a subdirectory),
the graph usually lives in the primary checkout, not under the cwd. The gate
message and the session-start nudge print the resolved path — copy their
`--graph` flag verbatim:

```bash
graphify query "<the user's question>" --budget 400 --graph "<primary-checkout>/graphify-out/graph.json"
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

"Project" means a **git work tree** (a `.git` dir or worktree file somewhere
above the cwd) whose root is not the home directory. A session started outside
one — a Desktop session with no folder picked, a terminal opened in `~` — gets
no auto-install, no transparency line and no build: `graphify update .`
indexes everything below the cwd, and from `$HOME` that once crawled the whole
profile for hours. Manual `graphify update .` stays available anywhere.

Both automatic paths spawn the `graphify` binary by bare name; set
`DOTCLAUDE_GRAPHIFY_BIN=<absolute path>` when the CLI lives off `PATH` (uv's
`~/.local/bin` on a fresh Windows box), or point it at a stub in tests.

The first time graphify auto-enables for a project with no record at all,
`ss.graphify` prints a one-time (weekly-throttled), non-blocking transparency
line disclosing that it's on and how to opt out. This is a disclosure, not an
offer — there is nothing to confirm.

When **enabled**, two things are automatic — nothing to run by hand:

**1. Auto-install + auto-build / freshness.** `ss.graphify` ensures graphify
is installed (best-effort background `uv tool install graphifyy` if missing),
removes graphify's own git hooks once per project if present (`graphify hook
uninstall` — those pop a console window on Windows on every commit), and kicks
off a background `graphify update .` (windowless, sentinel-tracked) whenever
the graph is missing, stale, or fails a periodic validity check. So the graph
follows the code purely via windowless SessionStart refresh + PreToolUse
self-heal — never via graphify's own git hooks.

**2. No search gate.** Until 0.16.0 of `pre.tokens.guard`, an eligible Grep
was blocked and answered from the graph ("answer-in-gate"). Removed: of 140
fires, 105 were retried anyway, eligible greps returned a median of ~1.75k
chars (~470 tokens), and every forced retry is one more API call that re-reads
the whole context. Grep and Glob now pass the token guard on size alone; the
only graph hint is the one-time nudge on a session's first broad search.

Graph resolution (`graph-nudge.resolveGraphJson`): `<cwd>/graphify-out/graph.json`
→ the enclosing repo root → the **primary checkout** when cwd is a linked
worktree. `ss.graphify` still builds a per-cwd graph once it is missing or
drifts, so the fallback is a bridge, not a replacement.

## When the graph helps

- **Use it** for exploration across many files — "where/how is X wired",
  "what calls Y", "how do A and B relate": run `graphify query "<question>"`
  first, then read only the files it names. It replaces reading candidate
  files one by one, which is where the tokens go.
- **Skip it** for a single narrow lookup (one identifier, one string, a known
  directory): a scoped Grep returns a few hundred tokens — cheaper than a
  query answer (4.7k-6.3k chars at the default budget).

### Measuring whether it pays off

Telemetry (`~/.claude/graphify-metrics.jsonl` — or `DOTCLAUDE_GRAPHIFY_METRICS`
when set, which every test and live-QA run should use instead of the real
file) records `query_ran` (with `responseChars` and `budget`),
`guard_blocked`/`guard_released` (the generic token guard), `map_injected`,
`nudge_injected`, and — via `post.graphify.search` — every Grep/Glob that ran
(`search_ran`, `broad`, `pathKind`, `eligible`, `outputMode`,
`responseChars`). `gate_*` events in older lines come from the removed gate;
the audit still counts them for history. The audit script reads that stream **and**
the session transcripts, so it also covers sessions from before the telemetry
existed, and prints a per-session telemetry table plus a NET tokens
cost/saved line (not clamped to 0 — a bypassed gate is counted as a real
loss, not zero):

```bash
node "{PLUGIN_ROOT}/scripts/graphify-audit.js" --sessions 10 --since 2026-09-01
```

Logic lives in `hooks/lib/graph-nudge.js` + `hooks/lib/graphify-state.js`.

## Out of scope (v1)

- No graphify MCP server (`python -m graphify.serve`) — shell-out per query.
- Auto-build is **code-only** (`graphify update .`, AST). Doc/PDF/image semantic
  extraction via `graphify extract` (which costs API tokens) is never enabled
  automatically — only on explicit user request.
- No search gate: Grep/Glob are never blocked or answered from the graph.
