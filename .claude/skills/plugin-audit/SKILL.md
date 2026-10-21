---
name: plugin-audit
description: >-
  Project skill of the dotclaude plugin-source repo (NOT part of the shipped
  plugin): audits plugins/devops and plugins/local-llm for token cost vs benefit,
  integrity and Claude-Code currency, repo and ship hygiene, and produces an
  interactive concept-page report with one include/discard card per suggestion.
  Triggers on: "plugin audit", "plugin-audit", "audit the plugin", "Plugin prüfen".
  Also started automatically in the background after a ship that crosses a
  decade boundary (0.289.x -> 0.290.0), see .claude/skills/do-ship/reference.md.
---

# plugin-audit

Audit of the plugin source, in five steps. Steps 1 and 5 are plain `node` (0 model
tokens); steps 2 and 3 are one subagent each; step 4 is plain `node` plus the
auto-concept hand-off. Rules produce findings — agents only prioritise and phrase.

State lives in `<main repo>/.claude/plugin-audit/` (git-ignored, shared by all
worktrees): `last.json`, `history.json`, `runs/<version>-<timestamp>/`,
`report-pending.json`. `<dir>` below is the run directory.

**Pending report first.** If `<state>/report-pending.json` exists at the start of a
session (a ship-triggered run finished without a live session), skip step 1: its
`dir` holds `results.json` — continue with step 2 (skip a step whose output file
already exists in `<dir>`).

## Step 1 — Collect (deterministic)

```
node .claude/skills/plugin-audit/scripts/audit.js --out <dir> [--skip-tests] [--days N] [--trigger manual|ship]
```

Without `--out` a new `runs/` directory is created. From a ship, run it with the
Bash tool's `run_in_background: true` and carry on. It prints one summary line and
writes `<dir>/results.json` (footprint, mining, benefit, integrity[12], hygiene[8],
net). `--skip-tests` skips `npm test` + `npm run lint` (a full audit runs them).
Exit 0 unless the arguments are invalid.

## Step 2 — Claude-Code currency (one `devops:research` agent, `model: sonnet`)

Spawn ONE agent. Brief it with: the Claude Code version recorded in the last audit
(`history.json` → last entry `ccVersion`; none → the last 60 days), the task "read the
Claude Code changelog since then and compare it with (a) the hook events and fields
the plugin uses (`plugins/devops/hooks/hooks.json`, `hooks/lib/*.js` transcript and
hook-input parsing) and (b) custom workarounds that a new Claude Code feature may now
make redundant (grep for `workaround`, `hack`, `until Claude Code` in hooks and
deep-knowledge)". It returns `{ccVersion, findings:[{msg, file?, line?, kind:
"breaking"|"opportunity"|"info"}]}`.

Merge into `<dir>/results.json` → integrity check `cc-currency`: `status` red when a
`breaking` finding exists, yellow for `opportunity`, green when only `info`/none;
`findings` as returned; `metrics: {ccVersion}`. Agent failed or no network → leave
the check `skipped` and add the reason as a finding.

## Step 3 — Synthesis (one agent, `model: sonnet`, at most 15 tool calls)

One agent reads `<dir>/results.json` and writes `<dir>/suggestions.json`:

```json
{ "suggestions": [ { "id": "kebab-id", "title": "…", "priority": "high|medium|low",
  "group": "Integrität|Hygiene|Token|Nutzen", "evidence": ["file:line or metric"],
  "change": "one concrete change" } ] }
```

Rules for the agent: every suggestion carries at least one piece of evidence taken
from results.json (a `file:line` finding or a named metric); no claim without
evidence; no new findings; gate catches are frequencies, never token savings; the
`net` figure keeps its uncertainty note; group related findings into one
suggestion; order by priority. No suggestions file → `report.js` derives rule-based
suggestions from the red/yellow checks.

## Step 4 — Report (interactive only)

```
node .claude/skills/plugin-audit/scripts/report.js --in <dir>
```

Builds the concept source folder `<dir>/report/` (page.json via concept-build `init`,
mode `free`, locale `de`, one round fragment `rounds/01.html`), runs concept-build
`build` and prints the build line and the built html path. The page has the sections
Überblick, Nutzen-Proxys, Prüfkatalog, Repo- & Ship-Hygiene and Verbesserungsvorschläge
(one bi-state card per suggestion, include checked by default).

Then open it through the devops **auto-concept** skill, Step 3 (concept bridge +
Edge) and handle the submission per auto-concept Step 5: every suggestion left on
*Miteinbeziehen* becomes an issue via **auto-issue** or is implemented, as the user
chooses in the page. The report is ONLY interactive — there is no static fallback.
No live session (ship ran headless)? `audit.js --trigger ship` already wrote
`report-pending.json`; the next session opens the page on its first prompt.

## Step 5 — Record

```
node .claude/skills/plugin-audit/scripts/audit.js --record --in <dir>
```

Appends the run summary (footprint, cost/benefit, check tallies, suggestion count,
`ccVersion`, sizes) to `history.json`, writes `last.json`
(`{version, minor, decade, ranAt, trigger}`) and clears a matching
`report-pending.json`. Run it after step 4 even when the user discarded everything —
the decade trigger reads `last.json`.

## Notes

- `scripts/lib/trigger.js --prev X --new Y` decides the automatic run (decade boundary,
  once per decade); a manual run ignores it.
- Not measurable from transcripts and reported as such: token-guard and local-llm
  savings (no hook logs one). Delegation savings use a relative price table
  (`lib/mining.js` `PRICE_RATIO`); gate catches are frequencies only.
- Transcripts carry no plugin version; runs are attributed by time window
  (since the last audit, default 30 days).
