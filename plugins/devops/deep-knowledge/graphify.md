# graphify — Codebase Knowledge Graph (default-on, opt-out)

Codebase knowledge graph via the external graphify CLI: default-on, opt-out via `{"consent":false}` in `.claude/graphify.json` or `~/.claude/graphify.json`. Former `auto-graph` skill (skill restructure PR 3).

Thin orchestration over the real [`graphify`](https://github.com/safishamsi/graphify)
CLI. graphify stays the single source of truth — the plugin reimplements
nothing. It **detects**, **auto-installs** if missing, **freshens the graph**,
and **queries** it. graphify enforcement is **enabled by default** in every
project — no consent prompt, no offer to confirm. The graph is kept fresh
automatically and broad searches are hard-gated toward it — see
[Enforcement](#enforcement-default-on).

## How it reaches you

Not a skill any more: the hooks do the automatic part (`ss.graphify` —
install, freshness, the session-start nudge; `pre.tokens.guard` — the
answer-in-gate; `post.graphify.search` / `post.graphify.query` — telemetry),
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

**2. Answer-in-gate.** `pre.tokens.guard` does not just nudge toward
`graphify query` — for an ELIGIBLE search it *runs the query itself*
(`--budget 400`, ~4s timeout, `shell:false` — a real, structural
command-injection defence, not just escaping; see
`hooks/lib/graphify-query-spawn.js`) and either blocks with the answer
already in the message (exit 2 — nothing further to call) or, when the graph
has no answer, allows the search silently. Eligibility
(`graph-nudge.isEligibleSearch`) is deliberately narrow — a default-budget
query costs more than most scoped grep results, so the gate must not fire on
every search, and only ever considers **Grep** (Glob keeps only the classic
broad-search block, no answer-in-gate at all): the pattern must read as a
semantic/identifier question (1-4 identifier-ish terms) rather than an exact
string, a path, or a version literal, AND the search must be either path-less
or a `content`-mode search scoped to an existing **directory** inside the
resolved graph root (never a single file, never `node_modules`/`.git`/etc.,
and never a `files_with_matches`/`count` search — those are already cheaper
than a block round-trip plus a graph answer). Hot path: the cheap/pure part of
this check (tool name, pattern shape, path/`output_mode` shape) runs with
zero `require()`s beyond Node builtins, so a non-candidate Grep and every
Glob call cost close to nothing extra. Safety preconditions, all enforced in
code, never optional:

- **Bounded staleness tolerance** — the gate does not require perfect
  freshness. `stalenessInfo` counts how many source files are newer than
  graph.json; the gate still fires (with a "graph lags N file(s) behind —
  background refresh started" disclosure) up to a small tolerance, and only
  falls back to self-heal (no block) when the lag is large or cannot be
  bounded at all (missing graph, truncated scan, nothing comparable). A graph
  whose staleness cannot be proven is never forced onto Claude.
- **Escape hatch** — the gate blocks a given search at most once per session;
  *retrying the same search falls through* and ALSO pre-releases the classic
  full-repo-search confirmation for the same key, so the retry does not fall
  straight into a SECOND, unrelated block.
- **Adaptive relent** — 3 consecutive bypasses with no accepted answer in
  between (tracked across DIFFERENT searches, not just retries of one)
  disables the gate for the rest of the session (`gate_relented`). A
  `graphify query` run elsewhere no longer relents the gate by itself — the
  gate answers eligible searches directly now. Every piece of this state
  (gate flag, bypass streak, relent, last-blocked record) carries a ~12h TTL,
  and the whole gate is skipped when the session id is missing/unstable.
- **Machine-wide concurrency cap** — at most 2 real `graphify query` children
  in flight at once (a small file-based semaphore, ~10s stale window); over
  the cap the gate is skipped entirely for that search (`gate_skipped_busy`,
  fail-open) rather than queuing.
- **Graph resolution** — `hasGraph`/`stalenessInfo` look for the graph in this
  order: `<cwd>/graphify-out/graph.json` → the enclosing repo root → the
  **primary checkout** when cwd is a linked worktree (graph-nudge
  `resolveGraphJson`). A fresh worktree is therefore gated from its first
  search against the main graph, with staleness counted over the worktree's
  own files (branch edits = the lag that graph has). The build side stays
  local: `ss.graphify` still builds a per-cwd graph once it is missing or
  drifts, so the fallback is a bridge, not a replacement.

### Measuring whether it pays off

Telemetry (`~/.claude/graphify-metrics.jsonl` — or `DOTCLAUDE_GRAPHIFY_METRICS`
when set, which every test and live-QA run should use instead of the real
file) records `gate_fired` (with `answerChars`, `outputMode`, a `keyHash`),
`gate_noanswer`, `gate_bypassed` (also `keyHash` — links a bypass DIRECTLY
back to the block it bypassed), `gate_relented`, `gate_skipped_busy`,
`query_ran` (with `responseChars` and `budget`), `guard_blocked`/
`guard_released` (the generic token guard), and — via `post.graphify.search`
— every Grep/Glob that ran (`search_ran`, `broad`, `pathKind`, `eligible`,
`outputMode`, `responseChars`). The audit script reads that stream **and**
the session transcripts, so it also covers sessions from before the telemetry
existed, and prints a per-session telemetry table plus a NET tokens
cost/saved line (not clamped to 0 — a bypassed gate is counted as a real
loss, not zero):

```bash
node "{PLUGIN_ROOT}/scripts/graphify-audit.js" --sessions 10 --since 2026-09-01
```

Baseline 2026-09-17 (20 sessions): 1 session with a query, 3 gate blocks
(1 bypass), Grep/Glob output 0.03 % of new model input — the upper bound of
what any search gate can save. Re-run after changes before arguing about the
gate either way.

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
- The gate only covers **Grep**: path-less searches, or `content`-mode
  searches scoped to a directory inside the resolved graph root. Glob and any
  `files_with_matches`/`count`-mode or single-file Grep are intentionally
  left free of the answer-in-gate (Glob still hits the classic broad-search
  threshold block on its own).
