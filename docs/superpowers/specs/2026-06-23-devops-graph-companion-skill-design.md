# /devops-graph — Companion Skill Design

**Date:** 2026-06-23
**Status:** Approved (design) — pending implementation
**Repo:** dotclaude (plugin source)

## Summary

A thin, on-demand orchestration skill that wires the external
[`graphify`](https://github.com/safishamsi/graphify) knowledge-graph CLI into the
devops plugin. graphify turns a codebase into a queryable knowledge graph so the
assistant can query the graph instead of grepping/reading full files
(token saver). The skill deliberately does **not** adopt graphify's
auto-installed PreToolUse hook / CLAUDE.md skill, which would collide with the
devops plugin's own PreToolUse hooks. graphify stays the single source of truth
for graph building and querying; this skill owns only detection, an install
offer, and command invocation.

## Goals

- On-demand **build + query** of a codebase knowledge graph via the real
  `graphify` CLI (no reimplementation — "no parallel world").
- **Never silently install** anything: detect + offer with confirmation.
- **Zero collision** with existing devops PreToolUse hooks and `project-map`.

## Non-Goals

- No replacement of `project-map` — different layer: always-on orientation
  (cheap, inlined every session) vs on-demand deep retrieval (heavy, queried).
- No graphify MCP server in v1 (shell-out per call; MCP is a later option).
- No migration of `check-local-llm.js` onto the new generic helper in this
  iteration (helper is built reusable; migration deferred — YAGNI).

## Placement

- Skill: `plugins/devops/skills/devops-graph/SKILL.md`
- Helper: `plugins/devops/scripts/check-tool.js` (generic PATH/availability check)
- Test: `plugins/devops/scripts/check-tool.test.js`

## Components

### 1. `check-tool.js` (generic, reusable)

- Input: a command/binary name (e.g. `graphify`), optional version-probe args.
- Behavior: resolves whether the command is on PATH (cross-platform — Windows
  `where` / POSIX `command -v`, or a Node PATH scan) and returns
  `{ installed: boolean, path?: string, version?: string }`.
- Detection logic separable from process spawning so tests run **without**
  graphify installed.
- Generalizes the intent of `check-local-llm.js`; local-llm may migrate onto it
  later (out of scope now).

### 2. `SKILL.md` flow

1. **Detect** `graphify` via `check-tool.js`.
2. **If missing** → present an offer to run
   `uv tool install graphifyy && graphify install` (fallbacks: `pipx`, `pip`).
   Only after explicit user OK. Never silent.
3. **Ensure graph**: if `graphify-out/graph.json` is missing or stale →
   `graphify extract . --update` (incremental, AST-only = free, no API cost).
4. **Query**: `graphify query "<question>"`, return the result to the
   conversation.
5. **Explicitly does NOT** run `graphify claude install` (the hook / CLAUDE.md
   writer) — see rationale below.

### Install policy

Detect → offer → confirm. The SKILL.md documents the collision rationale inline
so a future maintainer does not "helpfully" re-add `graphify claude install`.

## Enforcement (option B → hardened to a real gate)

The "Build + Query on-demand" core was first supplemented by a soft, once-per-
session **nudge** (devops-owned, via `pre.tokens.guard`). A multi-agent
verification (research + audit + adversarial red-team) then established two
load-bearing facts:

1. **graphify's own registration does not force usage.** `graphify claude install`
   writes a PreToolUse hook that emits `permissionDecision:"allow"` (guarded with
   `|| true`) plus an advisory CLAUDE.md — a nudge, never a block (graphify issues
   #249, #83). So "equivalent to registered graphify" (D4) and "forced usage"
   (D3) are mutually inconsistent; a real gate is *stronger* than graphify.
2. **A hard block is only safe with two preconditions** — otherwise it forces
   Claude onto stale data or wedges searches the graph cannot answer.

On the user's explicit choice (hard block + auto-build via git hooks **and**
SessionStart), the nudge was upgraded to enforcement:

- **Consent** — `.claude/graphify.json` (`consent:true|false`), written only after
  an explicit opt-in offered by the `ss.graphify` SessionStart hook. Never silent.
- **Auto-build (D2)** — `ss.graphify` ensures install, runs `graphify hook install`
  once (git AST rebuild, free), and background-rebuilds when the graph is
  missing/stale. (`hooks/lib/graphify-state.js`, `graph-nudge.graphIsStale`.)
- **Hard gate (D3)** — `pre.tokens.guard` blocks (exit 2) a broad raw-file
  Grep/Glob toward `graphify query`, **only when** the user consented AND the
  graph is fresh AND no `graphify query` ran yet this session. Precondition 1:
  staleness guard (`graphIsStale`, mtime vs newest source). Precondition 2:
  escape hatch — blocks a given search once, a retry falls through;
  `post.graphify.query` relents the gate for the session once a query runs.

Verified by `graphify-state.test.js`, `graph-nudge.test.js` (staleness), and a
spawn-based integration test `pre.tokens.guard.graphgate.test.js` (block / retry-
relent / no-consent / declined / stale / queried).

## Architecture rationale — the hook collision

`graphify claude install` writes graphify's own PreToolUse hook + CLAUDE.md skill
that nudges the assistant away from grep toward `graphify query`. The devops
plugin already ships PreToolUse hooks — the `project-map` re-scoping hint and
`pre.tokens.guard.js`. Running both means every search gets two competing
injections with unclear precedence, and a third-party tool writes into config the
plugin treats as its own. Mitigation: invoke graphify **on-demand from our
skill**; never install graphify's hook. The "Build + Query on-demand" scope
inherently avoids the collision.

## Testing

- `check-tool.test.js`: detection returns `installed: false` for a nonexistent
  binary and `installed: true` for a known one (e.g. `node`), without requiring
  graphify to be installed.
- Frontmatter YAML guard (`frontmatter-yaml.test.js`) already validates SKILL.md
  frontmatter.
- `npm test` must pass.

## Out of scope / future

- graphify MCP server registration for repeated queries.
- Migrating `check-local-llm.js` onto `check-tool.js`.
- A `deep-knowledge/graphify.md` reference doc (add only if usage proves it
  needed).
