---
name: do-run
version: 0.1.0
description: >-
  Door for every run of work bigger than one edit. Modes: implement the prompt
  through the agent execution path; work off the planned GitHub backlog
  (milestones or loose issues) unsupervised — refine, implement, test, ship
  each item; run fully autonomous while the user is away from the PC, with
  optional PC shutdown; burn the remaining weekly budget as depth per task
  (ONLY on the literal /do-run burn or /run-burn, never from wording such as
  burn, budget, limit or token); a strategic rethink when development is stuck
  and incremental fixes stopped helping (code-blind lens agents, concept page,
  then autonomous implementation); a full-spectrum audit (functional, visual,
  motion, audio, accessibility, logging, performance, resilience, security
  basics, tests, architecture) with evidence for every finding. Do NOT
  trigger for: a single known bug (auto-fix), a pure consistency or UI pass,
  a security-only review, repo/branch hygiene, shipping, or a quick edit.
  Triggers: "backlog abarbeiten", "arbeite den backlog ab", "backlog runner",
  "run the backlog", "milestones abarbeiten", "arbeite die milestones ab",
  "arbeite den milestone ab", "autonomous", "run autonomous",
  "run this while I'm away", "afk mode", "autopilot", "/run-burn",
  "festgefahren", "stuck", "unstuck", "wir drehen uns im Kreis",
  "neu denken", "rethink", "frischer Ansatz", "fresh approach",
  "komplett neu denken", "das führt zu nichts", "audit", "full audit",
  "voller Audit", "auditiere", "auditieren", "prüf alles",
  "komplett durchchecken", "health check der App", "Qualitätsaudit".
layer: 1
invokes: [auto-concept, do-ship, auto-harden, auto-polish, auto-agents, auto-issue]
triggers:
  en: ["backlog runner", "run the backlog", "autonomous", "run autonomous", "run this while I'm away", "afk mode", "autopilot", "/run-burn", "stuck", "unstuck", "rethink", "fresh approach", "audit", "full audit"]
  de: ["backlog abarbeiten", "arbeite den backlog ab", "milestones abarbeiten", "arbeite die milestones ab", "arbeite den milestone ab", "festgefahren", "wir drehen uns im Kreis", "neu denken", "frischer Ansatz", "komplett neu denken", "das führt zu nichts", "voller Audit", "auditiere", "auditieren", "prüf alles", "komplett durchchecken", "health check der App", "Qualitätsaudit"]
argument-hint: "[backlog | autonomous | burn | rethink | audit] [task, filter or target]"
allowed-tools: >-
  Bash(*), Read, Write, Edit, Glob, Grep, Agent, Skill,
  AskUserQuestion, CronCreate, CronDelete, CronList,
  EnterWorktree, ExitWorktree, TodoWrite,
  WebFetch, WebSearch,
  mcp__computer-use__*, mcp__Claude_in_Chrome__*,
  mcp__Claude_Preview__*, mcp__Claude_Browser__*,
  mcp__plugin_playwright_playwright__*,
  mcp__plugin_devops_dotclaude-completion__*,
  mcp__plugin_devops_dotclaude-ship__*,
  mcp__plugin_devops_dotclaude-issues__*,
  mcp__ccd_session_mgmt__*
---

# Do Run

One door for every multi-step run. The work itself lives in the mode files
next to this one — each is the verbatim body of a former skill.

<!-- PR2-phaseB: replace this temporary body with the do-run router and the question design of the spec (§ "do-run questions"): one AskUserQuestion with Was? / Ablauf? / Umfang? / Durchgänge?, the follow-ups, and auto-agents as the single execution path. -->

## Step 0 — Load Extensions

Silently check (do not surface "not found"):
1. Global: `~/.claude/skills/do-run/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/do-run/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

Each mode additionally reads the extension of the skill it was folded from
(its own Step 0), so extensions written before the restructure keep working.

## Step 1 — Pick the mode

Pick the mode from the request (the `args`, an explicit mode word, the
trigger phrase or the old skill name that routed here) and follow its file.
Read the mode file completely before acting; it replaces this skill's flow.

| Mode | Follow | Pick it when | Former skill |
|---|---|---|---|
| `backlog` | `modes/backlog.md` | the planned backlog / milestones should be worked off unsupervised | `run-backlog` |
| `autonomous` | `modes/autonomous.md` | one task should run while the user is away (AFK, optional shutdown) | `run-autonomous` |
| `burn` | `modes/burn.md` | ONLY the literal `/do-run burn` or `/run-burn` — never from wording | `run-burn` |
| `rethink` | `modes/rethink.md` | development is stuck, iterations circle, a fresh approach is wanted | `tune-rethink` |
| `audit` | `modes/audit.md` | a full-spectrum audit of the app or of recent work | `tune-audit` |
| *none* | Skill `auto-agents` | the prompt itself should be implemented with agents | — |

Mode files refer to themselves as "this skill" and to their siblings as
"… mode": switching modes (rethink → autonomous, burn → autonomous) means
reading the other mode file in the same run — never a new Skill call to
`do-run`. When the request fits no mode and is not an implementation task,
say so and stop.
