# Design Spec — `/devops-burn-backlog`

**Date:** 2026-07-18
**Status:** Approved (build authorized — dogfooded via `/devops-autonomous` + auto-ship)
**Plugin:** devops (MINOR bump on release — new skill)

## Problem

Projects accumulate a backlog of milestones and issues — old ideas, planned
improvements, and fixes — that never get worked off because doing so requires
sustained, interactive sessions the user does not always have energy for. The
existing autonomous surface does not cover "burn down the planned backlog":

- `devops-autonomous` is a generic AFK engine for a **single** ad-hoc task and,
  by a load-bearing safety guarantee, **never ships** unsupervised.
- `devops-burn` is **budget**-driven (maximize the remaining weekly token
  window), pulls **flat** issues + code signals, has **no** milestone concept,
  and no per-item ship lifecycle.

What is missing is a **milestone-centric backlog runner**: pick milestones (or
loose issues), let Claude refine → detail → implement → test/QA → **ship** each
selected item consequently, one after another, until the backlog is worked off —
so the user can lean back or go to bed and wake up to shipped work.

## Goals

- Fetch the project's open GitHub milestones; fall back to open issues (grouped)
  when there are none. Let the user checkbox-select what to burn down.
- For each selected item: refine the (possibly thin) issue into an actionable
  spec, implement it, test/QA it thoroughly, and **ship it** (branch → PR →
  ship pipeline → merge to `main` → close issue). Close a milestone
  automatically once all its issues are done.
- Escalate items that are too large or need a product/UX decision to a
  `concept` decision page — resolved **live while the user is present**
  during a pre-triage phase, or **parked** with a prepared page when discovered
  mid-run.
- Run the burn-down phase fully unsupervised (user AFK), with optional PC
  shutdown afterwards, reusing the `devops-autonomous` frame machinery — without
  weakening that skill's no-ship guarantee.

## Non-Goals

- Not a budget runner (that is `devops-burn` — explicit `/devops-burn` only).
- Not a generic single-task AFK engine (that is `devops-autonomous`).
- Does **not** modify `devops-autonomous` or its guardrails. Ship authority
  lives **only** in this skill (Approach C — standalone), keeping the autonomous
  "never ships unsupervised" guarantee intact.
- Not a debugging pass (`devops-flow`) or a consistency/UI pass
  (`devops-harden` / `devops-polish`).

## Architecture — Approach C (standalone, compose-not-copy)

`devops-burn-backlog` is a **standalone autonomous-class orchestrator**. It owns
its own control flow and is itself the **ship instance**. It composes existing
building blocks rather than duplicating them:

| Concern | Reused building block (composed, not copied) |
|---|---|
| Decision pages | `/concept` (invoked mid-flow → returns control, no own card) |
| Shipping | `/ship` (MCP ship tools `ship_preflight/build/version_bump/release/cleanup`) |
| Implementation | role agents (`devops:core/frontend/qa/…`) per `agent-orchestration.md`; may delegate one heavy item to a `devops-autonomous` implement sub-run |
| AFK-frame mechanics | the **same plugin scripts** `devops-autonomous` calls: `permission-audit.js`, `autonomous-shutdown-timer.js`, `autonomous-resume-schedule.js`, the external watchdog (`shutdown-watchdog.md`), `session-open-tracker.js`, `render_completion_card` |
| Guardrails / orchestration | references `deep-knowledge/autonomous-execution.md`, `agent-orchestration.md`, `test-strategy.md`, `injection-hardening.md`, `pre-mortem.md` |
| Issue/milestone conventions | `devops-new-issue` (`[TYPE]` titles, `type:*` labels), `deep-knowledge/milestone-rules.md` |

**Key architectural fact.** `devops-autonomous` cannot be the component that
ships — a task string never overrides its hard no-ship guardrail (that is the
point of the guardrail). Therefore `burn-backlog` **is** the ship instance and
uses `devops-autonomous` only for the AFK frame (its shared scripts) and,
optionally, for per-item implementation sub-runs (`implement` mode, which never
ships). This reconciles "standalone (C)" + "compose don't copy" + "use
autonomous directly" + "per-issue full ship".

**Ship mandate.** `burn-backlog` grants itself ship authority as its own
documented, gate-confirmed contract. Safeguards (mirrored from
`autonomous-execution.md`, minus the ship line): ship **only** via the MCP ship
tools, **own repo only**, **no force-push**, no destructive git ops, no external
comms beyond the PR/merge/issue-close the ship pipeline performs.

## Skill Definition

- **Name:** `devops-burn-backlog` — directory
  `plugins/devops/skills/devops-burn-backlog/`
- **Invocation:** `/devops-burn-backlog`
- **Version:** 0.1.0
- **Triggers:** "backlog abarbeiten", "arbeite den backlog ab", "burn backlog",
  "milestones abarbeiten", "arbeite die milestones ab", "burndown",
  "arbeite den milestone ab".
- **Do NOT trigger** on bare "burn" (→ that is nothing; `/devops-burn` is
  explicit-only), nor on generic "autonomous"/"afk" (→ `devops-autonomous`).
  The description must disambiguate from `devops-burn` explicitly (shared "burn"
  token is the only discovery risk).
- **Frontmatter:** `description: >-` folded scalar (YAML-safety convention),
  `argument-hint: "[optional: milestone/issue filter, e.g. 'only bugs']"`,
  `allowed-tools` mirroring `devops-autonomous` **plus** the ship MCP tools and
  `mcp__ccd_session_mgmt__*` (for resume nudges), and GitHub access via `Bash`
  (`gh`).
- **Extension paths (Step 0):** `~/.claude/skills/burn-backlog/` and
  `{project}/.claude/skills/burn-backlog/` (SKILL.md + reference.md,
  project > global > plugin).

## Pipeline

Four phases: **Präsenz** (user present) → **Gate** → **Autonom** (user AFK) →
**Abschluss**.

### Step 0 — Load Extensions

Standard three-layer load per CONVENTIONS.md. Silent on missing files.
Extension dir slug: `burn-backlog`.

### Step 1 — Fetch & Select (Präsenz)

1. **Fetch milestones** (no MCP helper exists → `gh` directly):
   `gh api "repos/{owner}/{repo}/milestones?state=open"` and per-milestone open
   issue counts (`gh issue list --milestone "<title>" --state open --json …`).
2. **Selection logic** (exact rule from the user):
   - If there are milestones **with ≥1 open issue** → one `AskUserQuestion`
     multi-select over **milestones only** (label = milestone title + open-issue
     count + short description). All open issues of a chosen milestone are taken
     **wholesale** — no per-issue selection inside a milestone. >4 milestones →
     split across several multi-select questions.
   - **Second step, only if** there are open issues **without** any milestone →
     a separate multi-select over those loose issues. (Skipped when every open
     issue already belongs to a milestone.)
   - If there are **no** milestones with open issues → skip the milestone step;
     go straight to the loose-issue selection.
   - If there are **no** open milestones **and no** open issues → stop cleanly
     with a one-line message; render an `analysis` completion card.
3. **Build the work queue:** a flat, ordered list of the selected issues,
   grouped by milestone for auto-close tracking.

### Step 2 — Triage, Live Decisions & Refine (Präsenz)

1. **Pre-triage** — one lightweight analysis agent per queued issue classifies
   it: `ready` | `needs-decision` | `oversized`.
   - `needs-decision` = several viable implementation paths or an open product
     question.
   - `oversized` = too large for a single-issue ship; must be decomposed.
2. **Live concept decisions** — for every `needs-decision` / `oversized` item,
   **now** (user present) generate a `/concept` decision page and let the
   user decide the path / decomposition. `oversized` items are decomposed into
   sub-issues via the concept `create-issues` path; the resulting sub-issues
   enter the queue. (Concept invoked mid-flow returns control without its own
   completion card.)
3. **Refine → issue** — each `ready` issue is expanded into a spec (acceptance
   criteria, **User value:** line per `new-issue` convention, implementation
   plan) and written **back into the GitHub issue** (body update / comment).
   This is a GitHub write, done **while the user is present** → allowed.

### Step 3 — Gate (permission priming + ship mandate + shutdown/resume)

Reuse the `devops-autonomous` frame by calling its **shared scripts** and
referencing its deep-knowledge (do not duplicate the prose):

1. **Permission audit + priming** — `permission-audit.js` (Step 0.7 pattern),
   then prime shell/file/`gh`/browser/MCP + ship tools; artifact hygiene
   registers `/BURN-*` in `.git/info/exclude`.
2. **Ship-mandate confirmation** — an explicit gate point:
   > "Ship-Mandat: pro fertigem Issue Branch → PR → ship → merge `main` →
   > Issue geschlossen. Nur MCP-Ship-Tools, eigenes Repo, kein Force-Push. OK?"
3. **Shutdown / resume questions** — reuse `devops-autonomous` Step 2 Q3
   (shutdown yes/no) and Q4 (auto-resume, only if shutdown=no), with the same
   fixed option order and HARD GATE.
4. **Confirmation + 3-min autostart cron**, **external watchdog** (`register`,
   action derived from shutdown choice), **auto-resume cron** (if applicable) —
   all exactly per `devops-autonomous` Step 4 / `shutdown-watchdog.md`.
5. **Post-Confirmation Lockout** — after confirm, ZERO blocking interaction.

### Step 4 — Per-Issue Lifecycle Loop (Autonom, AFK)

If shutdown=yes, arm the fail-safe shutdown timer first
(`autonomous-shutdown-timer.js arm`). Read `autonomous-execution.md` at the
start. Maintain an append-only `BURN-LOG.md` decision journal. Mandatory
pre-mortem before the first state-mutating op.

Loop the queue, one issue at a time:

```
for each issue in queue:
  1. worktree/branch for the issue
  2. IMPLEMENT  → role agents per agent-orchestration.md (Autonomous directive);
                  may delegate a heavy single item to a devops-autonomous
                  implement sub-run (implement mode — never ships)
  3. TEST/QA    → pin profile via devops-test-plan; devops:qa agent; verify per
                  test-strategy.md (browser verification mandatory for web tech)
  4. SHIP       → /ship (MCP ship tools) — burn-backlog's own authority
  5. CLOSE      → close the issue; when all issues of a milestone are done,
                  close the milestone
  ── special cases ──
  • oversized discovered only here → refine + prepare a /concept page +
    PARK the item; the loop continues with the next issue
  • blocked (tests red / preflight blocks / ambiguity found) → clean rollback or
    park-branch; emit a non-blocking "⏸ Rückfrage" status message into the chat
    thread (special status the user reacts to next session); the loop continues
```

Per-issue shipping keeps `main` incrementally green; one failure never stops the
night.

### Step 5 — Completion & Blocked Handling

- **Report** — self-contained `BURN-REPORT.html` (dark theme, per
  `html-report.md`): per item status `shipped` / `parked` / `blocked` (+ reason
  + branch), milestone progress, list of shipped PRs.
- **Blocked / parked → chat thread** — one non-blocking "⏸ Rückfrage" block per
  item with a distinct status, on which the user reacts next session; the
  reactions feed a follow-up burn. (Not a modal `AskUserQuestion` — compatible
  with the Lockout and with shutdown.) Also recorded in the report.
- **Completion card** — via `render_completion_card` (variant per aggregate
  status: `ship-successful` if ≥1 shipped and no blockers, else `ship-blocked`
  / `ready` as appropriate). Relayed verbatim.
- **Optional shutdown** — per the `devops-autonomous` Step 8 decision matrix
  (`shutdown-watchdog.md`): cancel the fail-safe timer first; never auto-shutdown
  while any item left the run in a BLOCKED aggregate state.

## Artifacts

`BURN-LOG.md` (decision journal), `BURN-REPORT.html` (deliverable),
`BURN-DONE.flag` (watchdog handshake), `BURN-RESUME.json` (late-permission /
follow-up state). All registered under `/BURN-*` in `.git/info/exclude`
(artifact hygiene). Family and semantics mirror the `AUTONOMOUS-*` set.

## Registry & Docs Updates (part of the change)

- `README.md`: add the curated name to the skills list (count marker
  auto-regenerates) and a table row under "Skills (invoked explicitly or by
  hooks)".
- `plugins/devops/skills/devops-burn-backlog/reference.md`: documents the
  extension mechanism.
- Optional skill-level `deep-knowledge/` only if a topic warrants it (kept lean;
  the skill leans on plugin-level deep-knowledge by reference).
- `project-map.md`, README/architecture counts, dk-index: **auto-generated** by
  `ship_build` — not hand-edited.

## Error Handling

| Situation | Behavior |
|---|---|
| No open milestones and no open issues | Stop cleanly, `analysis` card |
| Concept decision not made in Präsenz | Item stays `needs-decision`; excluded from the burn, noted for the user |
| Item blocked mid-run | Clean rollback/park-branch, non-blocking "⏸ Rückfrage" in thread, continue |
| Oversized discovered mid-run | Refine + prepared concept page + park, continue |
| Ship preflight blocks an item | Treat as blocked; other items proceed |
| Late permission / rate-limit | `BURN-RESUME.json` + INTERRUPTED, per autonomous protocol |

## Rules

- **Never modify `devops-autonomous`** — ship authority lives only here.
- **Ship only via MCP ship tools, own repo, no force-push.**
- **Refine-writes-to-GitHub happen only in Präsenz** (Step 2), never after the
  Lockout.
- **Compose, don't copy** — reuse shared scripts, deep-knowledge, and sub-skills
  by reference; never duplicate the autonomous frame prose.
- **Per-issue shipping** — keep `main` incrementally green; a blocked item never
  halts the queue.
