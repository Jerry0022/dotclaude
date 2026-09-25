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

One door for every multi-step run. This file is the router: it asks one
question call, at most one follow-up, then runs the matching mode file. Each
mode file is the verbatim body of a former skill; where the router already
answered one of its questions, the mode file says so and reads the answer.

Spec: `docs/superpowers/specs/2026-09-24-skill-restructure-design.md`
§ "do-run questions".

## Step 0 — Load Extensions

Silently check (do not surface "not found"):
1. Global: `~/.claude/skills/do-run/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/do-run/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

Each mode additionally reads the extension of the skill it was folded from
(its own Step 0), so extensions written before the restructure keep working.

## Step 1 — Machine prompts and presets

**Machine prompts never see a question.** Route them straight into the mode
and skip Steps 2–5:

| Prompt starts with | Follow |
|---|---|
| `AUTONOMOUS_AUTOSTART:` | `modes/autonomous.md` Step 0.1 |
| `AUTONOMOUS_RESUME:` | `modes/autonomous.md` Step 0.2 |
| `RUN_BACKLOG_AUTOSTART:` | `modes/backlog.md` Step 0.1 |

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

Ask ONE `AskUserQuestion` (header `"Fortsetzen"`, question names the task
and, for autonomous, the missing permission; for burn, `{done}` landed ·
`{queue}` open · `{inFlight}` unclear):

1. `"Run fortsetzen (Recommended)"` — continue where it stopped.
2. `"Run neu starten"` — drop the old run (burn archives it to
   `BURN-STATE.prev.json`, autonomous deletes the resume file), then Step 3.

"Run fortsetzen" skips Steps 3–5 and enters the mode's resume path with that
answer: `modes/autonomous.md` Step 0.5 "If resuming" or `modes/burn.md`
Step 0.5 "Fortsetzen". The modes do not ask again.

## Step 3 — Base call: four questions, one `AskUserQuestion`

Rules for every question this router asks (spec § "do-run questions"):

- **Fixed option order.** The options below always appear in exactly this
  order. A condition may hide an option; nothing ever moves one.
- **The first option is the agnostic recommendation** and the only
  single-select option whose label carries `(Recommended)`. What the prompt
  or the user's history suggests never moves the marker or the order — it
  shows as a description suffix instead (Q3), or as a preset (Step 1).
- **Click-through is a valid run.** Accepting the first option of every
  single-select question and submitting Q4 empty runs: Prompt umsetzen ·
  Interaktiv · Ship manuell · Flexibel · Harden danach + Polish danach.
- **Parallel labels.** Short, same shape, the verb in the same place — never
  "Ja" / "Nein".

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
    4. "Budget verbrennen"              — Restbudget der Woche als Tiefe pro Task verbrauchen.   [only when weekly usage > 80 %; never recommended]
```

**Conditions, computed before the call:**

- **Backlog option** — one cheap probe:
  `gh issue list --state open --limit 1 --json number --jq length`.
  Output `1` → show it. `0`, a non-zero exit, no `gh`, no remote, no auth →
  omit it silently (Q1 then has two options). Skipped when Q1 is preset.
- **Budget verbrennen** — call `mcp__plugin_devops_dotclaude-completion__get_usage`
  once. Show the option only when the result has no `error` and
  `weekly.pct > 80`. It is always the last option and never carries
  `(Recommended)`.
- **Rethink marker** — "reads stuck" means a stuck phrase from Step 1 or an
  explicit `rethink` argument; nothing else.
- **Last choice for Q3.** Scan this conversation for the most recent answer
  to this router's `"Umfang?"` question (the `AskUserQuestion` result in
  your context). If one exists, append `" · zuletzt gewählt"` to the
  **description** of that option. Label, marker and order stay unchanged;
  the user's last choice is one keypress away and visibly flagged.

**Reading Q1.** A free-text Q1 answer that names several options by number
("1 und 2") runs them in order — first "Prompt umsetzen" (implement the
chat's own work), then "Audit" (over that work) — never just the first
number read and the rest dropped.

**Reading Q4.** `AskUserQuestion` has no pre-selection: an option can be
marked, never pre-ticked, so opt-out checkboxes are impossible. The
question text therefore names the set an empty answer runs — the user sees
what "leer lassen" means instead of having to untick anything.

- **Nothing ticked** → the recommended set: every option whose label carries
  `(Recommended)` in this call (Harden danach + Polish danach, plus Rethink
  vorher when it was marked). This is what makes click-through work.
- **Anything ticked** → exactly the ticked options, nothing added.
- **No passes at all** → the user writes "keine" / "none" in the tool's
  free-text field. Say so in the question only if the user asks.

## Step 4 — Follow-up: at most one more call

Carry only what the answers leave open, in one `AskUserQuestion` call (max
four questions). No follow-up when nothing is open.

| Answer | Follow-up question(s) |
|---|---|
| Q1 Audit | F1 Ergebnis + F2 Audit-Umfang |
| Q1 Backlog | F3 Milestones (and F4 Issues when loose issues exist) — run `modes/backlog.md` Step 1 fetch, trust gate and presence-cron arm first; they feed the options |
| Q2 Autonom (not Backlog), or Budget verbrennen | F5 Desktop + F6 PC danach |
| Q2 Autonom with Backlog | F6 PC danach (backlog never asks Desktop) |

```
F1  header: "Ergebnis"      multiSelect: false
    1. "Audit umsetzen (Recommended)"   — Sichere Fixes anwenden, vorher/nachher belegt.
    2. "Audit als Concept"              — Nichts ändern; Befunde + Roadmap als Concept-Seite.

F2  header: "Audit-Umfang"  multiSelect: false
    1. "Chat-Arbeit prüfen (Recommended)" — Was dieser Chat gebaut hat.   [only when this chat wrote files or commits]
    2. "Alles prüfen"                     — Ganze App, alle Dimensionen, plus 48h-Anforderungen.   [(Recommended) when option 1 is hidden]
    3. "48h-Anforderungen prüfen"         — Nur funktionale Anforderungen der letzten 48 h.

F3  header: "Milestones"    multiSelect: true
    options = milestone title + trusted open-issue count (modes/backlog.md Step 1.2)

F4  header: "Issues"        multiSelect: true
    options = loose trusted issues without milestone (modes/backlog.md Step 1.2)

    >4 options → split into further questions of the same call, headers exactly
    "Milestones 2", "Milestones 3" … / "Issues 2", "Issues 3" … (the run contract
    reads only these headers).

F5  header: "Desktop"       multiSelect: false
    1. "Desktop frei lassen (Recommended)" — Kein Maus/Tastatur-Takeover; Browser-Tests laufen trotzdem.
    2. "Desktop übernehmen"                — Computer-Use für native Apps.

F6  header: "PC danach"     multiSelect: false
    1. "PC an · mit Resume (Recommended)"  — PC bleibt an; nach dem 5h-Reset werden hängende Worktrees mit »weiter« angestoßen.
    2. "PC an · ohne Resume"               — PC bleibt an; kein automatischer Anstoß.
    3. "PC aus · ohne Resume"              — PC fährt nach Abschluss herunter (wartet auf andere Sessions).
```

F6 folds the autonomous shutdown and auto-resume questions into one: no
option pairs shutdown with resume, so the HARD GATE of
`modes/autonomous.md` Step 2 (`$SHUTDOWN=yes` ⇒ `$AUTO_RESUME=no`) holds by
construction. F3/F4 labels are data, exempt from the label rules. When more
milestones and loose issues exist than the call has room for, the rest of
the selection continues in `modes/backlog.md` Step 1.2 — the tool's
four-question cap is the only reason for a second follow-up.

## Step 5 — Umfang

- **Flexibel** → nothing to arm.
- **Strikt** → strict for this run, through the existing strict machinery
  (`deep-knowledge/strict.md`, `hooks/lib/strict-state.js`). Arm an inline
  mode exactly as `prompt.strict.enforce` does for `strict: <task>` — never
  over a branch mode or a mode bound to a running concept / autonomous
  workflow (the CLI keeps those, `kept: true`):
  ```bash
  node "{PLUGIN_ROOT}/hooks/lib/strict-state.js" inline
  ```
  It prints one JSON line and then the contract block — the block only when
  the mode is verifiably active. A non-zero exit means strict is NOT on:
  say so in one line and ask whether to continue without it; never proceed
  as if strict were armed.
  The printed block is binding for the rest of the run, with the duties of
  `deep-knowledge/strict.md` (contract, execution, report): the block at the top of every Agent prompt
  (`pre.strict.agent-gate` refuses a spawn without it), `--strict` on every
  auto-harden / auto-polish call, `strict=on` in every `AUTONOMOUS_AUTOSTART:`
  / `RUN_BACKLOG_AUTOSTART:` cron prompt, the strict report before the card.
  `stop.strict.release` binds the inline mode to a running workflow
  (`AUTONOMOUS-LOCKOUT.flag`, `.claude/concept-active.json`) or releases it
  at turn end.

## Step 5b — Run contract

**Armed automatically — no action needed here.** A PostToolUse hook reads
this router's own answers (Q1–Q4, the follow-up) straight from the
`AskUserQuestion` result and writes them to `.claude/run-contract.json`. From
that point on, a PreToolUse hook refuses the tool call that would walk past a
chosen pass, a skipped `auto-agents` classification, an unrefined issue, or a
ship that bypasses `devops:do-ship` — with the exact call that satisfies it.
Mechanism, obligations and gates: `deep-knowledge/run-contract.md`.

| Gate hits… | Applies to |
|---|---|
| `auto-agents` | every `prompt` / `backlog` run — the tier decision is never skipped |
| `harden` / `polish` | a chosen pass, once the segment has real work |
| `qa` | code changes past the size threshold |
| `do-ship` | `Ship automatisch` — a `ship_release` call is refused without a prior `Skill("devops:do-ship")` |
| `refine` / `triage` | backlog mode's Präsenz obligations |

A conscious deviation is one CLI call, never a silent skip — the completion
card shows it as ⚠:

```bash
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" status
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" skip <ob> [--item <N>] --reason "<why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" park <N> --reason "<why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" abort --reason "<status>: <why>"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" done
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" batch-clear --reason "<why>"
```

`status` prints the header and what is still open for the current segment.
`skip` is one conscious skip (card: ⚠). `park` (backlog) records a blocked /
`⏸ Rückfrage` item once — it satisfies every open obligation of that item and
ends its segment. `abort` closes a run that is over with open steps (card:
✗ + reason) — before its card. `done` only when every chosen step ran
(`prompt` / `audit`: the final card closes it anyway; `backlog`: once every
queued item shipped, was skipped or parked); with open obligations it
refuses unless `--reason` is given, and then closes as aborted. `batch-clear`
drops a stale do-batch hand-off marker. The contract, its markers and the
card line belong to the session that armed them — a `.claude/` copied into a
new worktree never gates another session.

## Step 6 — Run the mode

Read the mode file completely before acting; it replaces this skill's flow
from the named step on. Mode files refer to themselves as "this skill" and to
siblings as "… mode": switching modes means reading the other file in the
same run — never a new Skill call to `do-run`.

| Mode | Follow | Former skill |
|---|---|---|
| `backlog` | `modes/backlog.md` | `run-backlog` |
| `autonomous` | `modes/autonomous.md` | `run-autonomous` |
| `burn` | `modes/burn.md` | `run-burn` |
| `rethink` | `modes/rethink.md` | `tune-rethink` |
| `audit` | `modes/audit.md` | `tune-audit` |

**Answers → execution.** `$SHIP` = `auto` / `manual` from Q2, `$PASSES` from
Q4, `$STRICT` from Q3. Implementation always goes through `auto-agents`,
the single execution path: `Skill("devops:auto-agents")` with args
`--from=do-run --mode=<interactive|background> --ship=<auto|manual> <task>`
(Interaktiv → `interactive`, Autonom → `background`). It shows its own agent cards,
returns a result block (`tier`, `done`, `open`, `needs-decision`, `ship`)
and never ships or renders a card — this router acts on the block and
renders the card. Inside a do-run run `auto-agents` always decides the
tier, Inline included — it reports Inline in one line, never a shortcut
around loading the skill (run-contract's `auto-agents` obligation, Step 5b).

| Q1 | Ablauf | Runs | Mode questions answered here (the mode skips them) |
|---|---|---|---|
| Prompt umsetzen | Interaktiv | [Rethink vorher → `modes/rethink.md`] → `auto-agents` → Step 7 | — |
| Prompt umsetzen | Autonom | [Rethink vorher → `modes/rethink.md`, while the user is still here] → `modes/autonomous.md` from Step 0.7 with the prompt as task, `$EXEC_MODE=implement`; its Step 6.5 hands back to Step 7 | autonomous Step 1 intake, Step 2 Q1–Q4 (Q1 → implement, Q2 ← F5, Q3+Q4 ← F6) |
| Prompt umsetzen + Budget verbrennen | either | `modes/burn.md` from Step 2 with the prompt as primary task → its Step 7 autonomous frame (F5/F6 answers) → Step 7 | burn Step 1 confirmation (the tick is the confirmation), Step 3 intake; autonomous Step 2 |
| Audit | Interaktiv | `modes/audit.md` with `--scope=<F2> --mode=<F1>` → Step 7 when `implement` | audit Step 2 intake |
| Audit | Autonom | `modes/autonomous.md` frame; its Step 5 work unit is `modes/audit.md` with `--autonomous --scope=<F2> --mode=<F1>`; `$EXEC_MODE` = `implement` (umsetzen) or `analyze` (Concept — the page waits for the user's return) | autonomous Steps 1–2, audit Step 2 |
| Backlog | Interaktiv / Autonom | `modes/backlog.md` from Step 1.3 with F3/F4 as the selection; shutdown/resume ← F6 (Autonom) or `no`/`no` (Interaktiv); `$BURN_MODE` ← Budget verbrennen; ship mandate ← `$SHIP`; passes run per issue | backlog Step 1.2 selection, Step 3.2 ship mandate, Step 3.3 shutdown/resume + budget mode |

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
     `node "{PLUGIN_ROOT}/scripts/autonomous-lockout.js" arm do-run` →
     `Skill("devops:do-ship")` → `… autonomous-lockout.js clear`. A blocked
     ship is reported, never retried interactively. **The clear runs on every
     exit of this step**, before anything else is reported:
     - ship succeeded (`ship-successful` / `ready` card) → clear;
     - ship blocked (`ship-blocked`, a parked gate, a failed MCP step) → clear,
       then report the block;
     - ship aborted (do-ship errored or was skipped, the run is interrupted,
       a pass before it stopped the run) → clear before handing back to
       `modes/autonomous.md` Step 7.
     After a compaction or a resumed session, run `… autonomous-lockout.js
     check` first; `active:true` with `owner:"do-run"` and no ship running
     → clear it. A lockout that still slips through (crash) expires on its
     own: `do-run` lockouts are stale after 6 h and are ignored and removed
     by every reader (`readLockout`, `check` reports `stale:true`).
   - `$SHIP=manual` → no ship. Interaktiv: render the `ready` card via
     `render_completion_card`; Autonom: `modes/autonomous.md` Step 7 renders it.

Act on the auto-agents result block: `ship: auto` → item 3 above;
`needs-decision` stops before Step 7 — Interaktiv → open an `auto-concept` page
for the fork (`Skill("devops:auto-concept")`) and call auto-agents again with
the answer; Autonom → log it, skip the fork, continue. The completion card is
this router's (or do-run's composed do-ship's), never auto-agents'.

## Rules

- One base call, at most one follow-up — every other question a folded skill
  used to ask is answered by them and skipped in its mode file.
- Option order is fixed; the agnostic recommendation is first; click-through
  is a valid run; labels are parallel and never "Ja" / "Nein".
- Budget verbrennen is never recommended and only visible above 80 % weekly
  usage or on the literal `burn` argument.
- Ship authority lives in this router (Q2) and in backlog mode's per-issue
  loop. The autonomous engine itself still never ships.
- Every chosen pass runs, or is skipped with a reason that the card shows —
  never silently dropped (Step 5b, `deep-knowledge/run-contract.md`).
- When the request fits no mode and is not an implementation task, say so
  and stop.
