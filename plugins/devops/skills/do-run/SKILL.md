---
name: do-run
version: 0.3.0
description: >-
  Door for every run of work bigger than one edit. Asks one short question
  set (what · how · scope · passes), then implements the prompt through the
  agent execution path, works off the planned GitHub backlog (milestones or
  loose issues — refine, implement, test, ship each item), runs fully
  autonomous while the user is away (optional PC shutdown), burns the
  remaining weekly budget as depth per task (ONLY on the literal /do-run
  burn or /run-burn or the "Budget verbrennen" answer, never from wording
  such as burn, budget, limit or token), rethinks a stuck area from scratch
  (code-blind lens agents, concept page), or runs a full-spectrum audit
  with evidence for every finding. Do NOT trigger for: a single known bug
  (auto-fix), a pure consistency or UI pass, a security-only review,
  repo/branch hygiene, shipping, or a quick edit.
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
argument-hint: "[backlog | autonomous | burn | rethink | audit] [--from=do-batch] [task, filter or target]"
allowed-tools: >-
  Bash(*), Read, Write, Edit, Glob, Grep, Agent, SendMessage, Skill,
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

One door for every multi-step run. This file is the router: it asks one
question call, at most one follow-up, then runs the matching mode file. Each
mode file is the verbatim body of a former skill; where the router already
answered one of its questions, the mode file says so and reads the answer.

## Step 0 — Load Extensions

Silently check (do not surface "not found"):
1. Global: `~/.claude/skills/do-run/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/do-run/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Machine prompts and presets

**Machine prompts never see a question.** Route them straight into the mode
and skip Steps 2–5:

| Prompt starts with | Follow |
|---|---|
| `AUTONOMOUS_AUTOSTART:` | `modes/autonomous.md` Step 0.1 |
| `AUTONOMOUS_RESUME:` | `modes/autonomous.md` Step 0.2 |
| `RUN_BACKLOG_AUTOSTART:` | `modes/backlog.md` Step 0.1 |
| `BURN_RESUME:` | `modes/burn.md` Step 0.6 (the `prompt.burn.resume` hook names the policy) |

The same holds while an AFK lockout is active
(`node "{PLUGIN_ROOT}/scripts/autonomous-lockout.js" check` →
`active: true`): take the click-through answers (every first option, Step 3)
without asking.

**Presets.** An unambiguous signal in `$ARGUMENTS` or the prompt answers a
question in advance. A preset drops the question (or the option) from the
call and is stated in one line before it ("Was: Backlog — aus dem Prompt").
It never reorders the options that remain.

| Signal | Effect |
|---|---|
| `--from=do-batch` | Q1 dropped — the merged batch plan is the prompt (Prompt umsetzen). |
| `backlog`, or a backlog trigger phrase | Q1 dropped → Backlog. |
| `audit`, or an audit trigger phrase | Q1 dropped → Audit. |
| `autonomous`, or an AFK phrase ("while I'm away", "afk", "autopilot") | Q2 shows only its two `Autonom · …` options, in table order. |
| `rethink`, or a stuck phrase (the rethink triggers above) | Q4 marks "Rethink vorher" as recommended. |
| literal `burn` (`/do-run burn`, `/run-burn`) | Budget verbrennen is on; the option leaves Q4 whatever the usage. |
| strict already armed for this branch (`node "{PLUGIN_ROOT}/hooks/lib/strict-state.js" status` → `active: true, reason: "on"`) | Q3 dropped → Strikt (`strict off` lifts it, not this question). |

The remaining tokens of `$ARGUMENTS` (or the prompt itself) are the task,
the backlog filter or the audit target.

## Step 2 — Resume before anything else

Only when a resume state exists in the project root — otherwise go straight
to Step 3:

- `AUTONOMOUS-RESUME.json` → an interrupted autonomous run.
- `BURN-STATE.json` with a non-empty `queue` or `inFlight` → an interrupted burn.

Ask ONE `AskUserQuestion` (header `"Fortsetzen"`) — its question and the
options per resume state: `deep-knowledge/questions.md` § Resume question.

Every answer but "Run neu starten" skips Steps 3–5 and enters the mode's
resume path with it: `modes/autonomous.md` Step 0.5 "If resuming" or
`modes/burn.md` Step 0.5. The modes do not ask again.

## Step 3 — Base call: four questions, one `AskUserQuestion`

Before building this call, read `deep-knowledge/questions.md`: the question
rules, the conditions computed first, and how the answers are read.

```
Q1  header: "Was?"          multiSelect: false
    question: "Was soll dieser Run tun?"
    1. "Prompt umsetzen (Recommended)"  — Den Auftrag aus deinem Prompt implementieren.
    2. "Audit"                          — Voller Qualitätsaudit mit Belegen; Umsetzen oder Concept fragt die Nachfrage.
    3. "Backlog"                        — Offene Milestones / Issues abarbeiten.   [only when open issues exist]

Q2  header: "Ablauf?"       multiSelect: false
    question: "Bleibst du erreichbar, und wer shippt am Ende?"
    1. "Interaktiv · Ship manuell (Recommended)" — Du bleibst erreichbar und beantwortest Rückfragen. Am Ende zeigt die ready-Card das Ergebnis; PR, Merge und Release machst du selbst.
    2. "Interaktiv · Ship automatisch"           — Du bleibst erreichbar und beantwortest Rückfragen. Ist alles grün, läuft am Ende do-ship (PR, Merge, Alpha-Release) ohne weitere Frage.
    3. "Autonom · Ship manuell"                  — Du gehst weg: Claude fragt nichts mehr, entscheidet selbst und sammelt offene Punkte. Das Ergebnis bleibt auf dem Branch, du shippst danach selbst.
    4. "Autonom · Ship automatisch"              — Du gehst weg: Claude fragt nichts mehr, entscheidet selbst und sammelt offene Punkte. Ist alles grün, läuft am Ende do-ship.

Q3  header: "Umfang?"       multiSelect: false
    question: "Wie weit darf die Änderung greifen?"
    1. "Flexibel (Recommended)"         — Zieht Nötiges mit: Aufrufer, Tests, Doku.
    2. "Strikt"                         — Nur was der Prompt nennt; jede offene Wahl wird berichtet.

Q4  header: "Durchgänge?"   multiSelect: true
    question: "Welche Durchgänge kommen dazu? (Leer lassen = Harden + Polish)"   [name every option marked (Recommended) in this call, e.g. "Harden + Polish + Rethink"]
    1. "Harden danach (Recommended)"    — Tests, Bugs, Konsistenz über die Änderung.
    2. "Polish danach (Recommended)"    — UI-Feinschliff über die Änderung.
    3. "Rethink vorher"                 — Erst frisch neu denken (Concept-Seite), dann umsetzen.   [+ " (Recommended)" when the prompt reads stuck]
    4. "Budget verbrennen"              — Restbudget, das sonst verfällt, als Tiefe pro Task verbrauchen.   [only when burn-plan.js offer says so; never recommended]
```

## Step 4 — Follow-up: at most one more call

Carry only what the answers leave open, in one `AskUserQuestion` call (max
four questions). No follow-up when nothing is open.

| Answer | Follow-up question(s) |
|---|---|
| Q1 Audit | F1 Ergebnis + F2 Audit-Umfang |
| Q1 Backlog | F3 Milestones (and F4 Issues when loose issues exist) — run `modes/backlog.md` Step 1 fetch, trust gate and presence-cron arm first; they feed the options |
| Q2 Autonom (not Backlog), or Budget verbrennen | F5 Desktop + F6 PC danach |
| Q2 Autonom with Backlog | F6 PC danach (backlog never asks Desktop) |
| Budget verbrennen (not Backlog) | additionally F7 Burn-Resume + F8 Zusatz-Tasks — four questions, the tool maximum |
| Budget verbrennen with Backlog | additionally F6 (if not already asked) + F7; no F8 — the backlog is the queue |

The follow-up questions F1–F8, and what each answer feeds:
`deep-knowledge/questions.md` § Follow-up questions.

## Step 5 — Umfang

- **Flexibel** → nothing to arm.
- **Strikt** → strict for this run, through the existing strict machinery
  (`{PLUGIN_ROOT}/deep-knowledge/strict.md`, `hooks/lib/strict-state.js`);
  how to arm it: `deep-knowledge/execution.md` § Strikt.

## Step 5b — Run contract

**Armed automatically — no action needed here.** A conscious deviation is
one CLI call, never a silent skip — the completion card shows it as ⚠.
Hooks, gates and CLI: `deep-knowledge/execution.md` § Run contract.

## Step 6 — Run the mode

Read the mode file completely before acting; it replaces this skill's flow
from the named step on. Mode files refer to themselves as "this skill" and to
siblings as "… mode": switching modes means reading the other file in the
same run — never a new Skill call to `do-run`. Every mode file and the skill
it was folded from: `deep-knowledge/execution.md` § Mode files.

**Answers → execution.** `$SHIP` = `auto` / `manual` from Q2, `$PASSES` from
Q4, `$STRICT` from Q3. Implementation always goes through `auto-agents`,
the single execution path: `Skill("devops:auto-agents")` with args
`--from=do-run --mode=<interactive|background> --ship=<auto|manual> <task>`
(Interaktiv → `interactive`, Autonom → `background`). Inside a do-run run
`auto-agents` always decides the tier, Inline included — it reports Inline
in one line, never a shortcut around loading the skill (run-contract's
`auto-agents` obligation, Step 5b).

| Q1 | Ablauf | Runs | Mode questions answered here (the mode skips them) |
|---|---|---|---|
| Prompt umsetzen | Interaktiv | [Rethink vorher → `modes/rethink.md`] → `auto-agents` → Step 7 | — |
| Prompt umsetzen | Autonom | [Rethink vorher → `modes/rethink.md`, while the user is still here] → `modes/autonomous.md` from Step 0.7 with the prompt as task, `$EXEC_MODE=implement`; its Step 6.5 hands back to Step 7 | autonomous Step 1 intake, Step 2 Q1–Q4 (Q1 → implement, Q2 ← F5, Q3+Q4 ← F6) |
| Prompt umsetzen + Budget verbrennen | either | `modes/burn.md` from Step 2 with the prompt as primary task → its Step 7 autonomous frame (F5/F6 answers) → Step 7 | burn Step 1 confirmation (the tick is the confirmation), Step 3 intake, Step 4 task sources (F8), Step 6 plan confirmation (autonomous Step 4 with its 3-minute autostart), resume policy (F7); autonomous Step 2 |
| Audit | Interaktiv | `modes/audit.md` with `--scope=<F2> --mode=<F1>` → Step 7 when `implement` | audit Step 2 intake |
| Audit | Autonom | `modes/autonomous.md` frame; its Step 5 work unit is `modes/audit.md` with `--autonomous --scope=<F2> --mode=<F1>`; `$EXEC_MODE` = `implement` (umsetzen) or `analyze` (Concept — the page waits for the user's return) | autonomous Steps 1–2, audit Step 2 |
| Backlog | Interaktiv / Autonom | `modes/backlog.md` from Step 1.3 with F3/F4 as the selection; shutdown/resume ← F6 (Autonom) or `no`/`no` (Interaktiv); `$BURN_MODE` ← Budget verbrennen, its resume policy ← F7; ship mandate ← `$SHIP`; passes run per issue | backlog Step 1.2 selection, Step 3.2 ship mandate, Step 3.3 shutdown/resume + budget mode |

Combinations without a meaning are dropped with one line, never asked:
Rethink vorher with Audit or Backlog; Budget verbrennen with Audit; Harden /
Polish with "Audit als Concept" (the concept page owns what gets built).

## Step 7 — Passes and ship

Runs after implementation, in this order. Autonom runs reach it from
`modes/autonomous.md` Step 6.5 (before that mode's report and Step 8);
backlog runs apply items 1–2 per issue inside its loop and its own ship
step for item 3.

**Gated.** The run contract (Step 5b) refuses a `ship_release` call, and
refuses the final completion card, while a chosen pass is still open for the
segment being closed — the block names the exact `Skill(...)` call that
satisfies it. Ship through `Skill("devops:do-ship")` only, never the
`ship_*` MCP tools directly: `do-ship` is what runs the diff passes and the
Codex review, and the gate cannot see a ship it never ran.

1. **Harden danach** → `Skill("devops:auto-harden")`, args
   `--invoked-by=do-run` (Interaktiv) or `--invoked-by=autonomous` (Autonom), plus
   `--strict` under Strikt.
2. **Polish danach** → `Skill("devops:auto-polish")`, same args.
3. **Ship.**
   - `$SHIP=auto`, Interaktiv → `Skill("devops:do-ship")`; it renders the card.
   - `$SHIP=auto`, Autonom → arm the lockout first so no ship gate can wedge the
     run on a modal, ship, clear it:
     `deep-knowledge/execution.md` § Autonom ship lockout.
   - `$SHIP=manual` → no ship. Interaktiv: render the `ready` card via
     `render_completion_card`; Autonom: `modes/autonomous.md` Step 7 renders it.

Acting on the auto-agents result block (`ship`, `needs-decision`, `open`)
before the ship: `deep-knowledge/execution.md` § auto-agents hand-off.

## Rules

- One base call, at most one follow-up — every other question a folded skill
  used to ask is answered by them and skipped in its mode file.
- Option order is fixed; the agnostic recommendation is first; click-through
  is a valid run; labels are parallel and never "Ja" / "Nein".
- Budget verbrennen is never recommended and only visible when
  `burn-plan.js offer` says budget would expire unused, or on the literal
  `burn` argument. A burn stopped by a limit is never burned on silently:
  a manual nudge is asked (`prompt.burn.resume`), an automatic resume
  follows F7.
- Ship authority lives in this router (Q2) and in backlog mode's per-issue
  loop. The autonomous engine itself still never ships.
- Every chosen pass runs, or is skipped with a reason that the card shows —
  never silently dropped (Step 5b, `{PLUGIN_ROOT}/deep-knowledge/run-contract.md`).
- When the request fits no mode and is not an implementation task, say so
  and stop.
