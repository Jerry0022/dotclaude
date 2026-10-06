# Router Questions — Rules, Conditions, Resume, Follow-up

Question detail for `/do-run`: what Steps 2–4 of `SKILL.md` need to build
their `AskUserQuestion` calls and to read the answers. The **decision** stays
in the skill body — whether the resume question comes first (Step 2), the
base call Q1–Q4 (Step 3) and which follow-up an answer opens (the Step 4
table); this file only answers "I am asking it, now what exactly?". The
rules apply to every question the router asks: the base call in `SKILL.md`
as much as the resume and follow-up questions below. Step numbers and
`modes/…` paths refer to `SKILL.md` and its directory.

Spec: `docs/superpowers/specs/2026-09-24-skill-restructure-design.md`
§ "do-run questions".

## Rules for every question

Rules for every question this router asks (spec § "do-run questions"):

- **Fixed option order.** The options below always appear in exactly this
  order. A condition may hide an option; nothing ever moves one.
- **The first option is the agnostic recommendation** and the only
  single-select option whose label carries `(Recommended)`. What the prompt
  or the user's history suggests never moves the marker or the order — it
  shows as a description suffix instead (Q3), or as a preset (Step 1).
- **Click-through is a valid run.** Accepting the first option of every
  single-select question and submitting Q4 empty (when it is asked at all)
  runs: Prompt umsetzen · Interaktiv · Ship manuell · Flexibel — Harden
  after the implementation, Polish when it touched UI files.
- **Parallel labels.** Short, same shape, the verb in the same place — never
  "Ja" / "Nein".

## Conditions, computed before the call

- **Backlog option** — one cheap probe:
  `gh issue list --state open --limit 1 --json number --jq length`.
  Output `1` → show it. `0`, a non-zero exit, no `gh`, no remote, no auth →
  omit it silently (Q1 then has two options). Skipped when Q1 is preset.
- **Budget verbrennen** — call `mcp__plugin_devops_dotclaude-completion__get_usage`
  once (it freshens `~/.claude/usage-live.json`), then
  `node "{PLUGIN_ROOT}/scripts/burn-plan.js" offer --no-refresh`.
  Show the option only when it prints `"offer": true`: at the user's own
  pace this week, at least 10 % above the reserve would expire unused. (The
  old rule, `weekly.pct > 80`, showed it exactly where little is left and a
  normal run uses it anyway.) It is always the last option and never
  carries `(Recommended)`.
- **Rethink marker** — "reads stuck" means a stuck phrase from Step 1 or an
  explicit `rethink` argument; nothing else.
- **Last choice for Q3.** Scan this conversation for the most recent answer
  to this router's `"Umfang?"` question (the `AskUserQuestion` result in
  your context). If one exists, append `" · zuletzt gewählt"` to the
  **description** of that option. Label, marker and order stay unchanged;
  the user's last choice is one keypress away and visibly flagged.

## Reading the answers

**Reading Q1.** A free-text Q1 answer that names several options by number
("1 und 2") runs them in order — first "Prompt umsetzen" (implement the
chat's own work), then "Audit" (over that work) — never just the first
number read and the rest dropped.

**Reading Q4.** Q4 carries only what changes the run's shape: Rethink
vorher (Prompt umsetzen only) and Budget verbrennen (only on a
`burn-plan.js` offer). Harden and Polish are no option — Harden always
runs after the implementation, Polish whenever the change touched UI files
(the 48 h session scan of 2026-09-27: the passes were picked in 10 of 13
runs, and Polish ran on UI-free backlog items for nothing). When neither
option applies, Q4 is dropped. Whenever Q4 is asked, `"Nichts davon"` —
Direkt umsetzen — is its last option, however many others apply (#635): the
Desktop app cannot submit a multi-select with nothing ticked, and without it
the only way to say "nothing" was an empty Other.

`AskUserQuestion` has no pre-selection: an option can be marked, never
pre-ticked. The question text therefore names what an empty answer runs.

- **Nothing ticked** → every option whose label carries `(Recommended)`
  (Rethink vorher when the prompt reads stuck), else nothing extra.
- **"Nichts davon"** → nothing extra; Harden and Polish run as always.
- **An empty Other** ("Sonstiges" / "Something else" without text) → the
  same as nothing ticked: the question text names the empty answer, so an
  empty Other is that answer. Never ask again (`post.ask.answers` says so;
  it also never asks when the same call answered Q2 with `Autonom · …` —
  the user is leaving).
- **Anything ticked** → exactly the ticked options, nothing added.
- **A pass that should not run** → not an answer here: a conscious skip goes
  through `run-contract.js skip harden|polish --reason "<why>"` and shows
  on the card as ⚠.

## Resume question

Ask ONE `AskUserQuestion` (header `"Fortsetzen"`, question names the task
and, for autonomous, the missing permission; for burn, `{done}` landed ·
`{queue}` open · `{inFlight}` unclear):

- **Autonomous:**
  1. `"Run fortsetzen (Recommended)"` — continue where it stopped.
  2. `"Run neu starten"` — drop the old run (the resume file is deleted), then Step 3.
- **Burn** — a stopped burn is never silently burned on; the default
  finishes the user's tasks without it:
  1. `"Ohne Burn fortsetzen (Recommended)"` — open core tasks at standard
     depth on one lane; filler dropped.
  2. `"Mit Burn fortsetzen"` — plan re-derived from the current usage.
  3. `"Run neu starten"` — archive to `BURN-STATE.prev.json`, then Step 3.

## Follow-up questions

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

F5  header: "Desktop"       multiSelect: false   [only behind the desktop gate below]
    1. "Desktop frei lassen (Recommended)" — Kein Maus/Tastatur-Takeover; Browser-Tests laufen trotzdem.
    2. "Desktop übernehmen"                — Computer-Use für native Apps.

F6  header: "PC danach"     multiSelect: false   [only behind the resume gate below]
    1. "🟢 PC anlassen · ➕ Resume (Recommended)" — PC bleibt an; nach dem 5h-Reset werden hängende Worktrees mit »weiter« angestoßen.
    2. "🟢 PC anlassen · ➖ Resume"          — PC bleibt an; kein automatischer Anstoß.
    3. "🔴 PC ausmachen"                     — PC fährt nach Abschluss herunter (wartet auf andere Sessions).

F7  header: "Burn-Resume"   multiSelect: false   [only with Budget verbrennen]
    question: "Stoppt das Limit den Burn und der Auto-Resume stößt nach dem Reset an: weiterbrennen? (Gilt nur mit »🟢 PC anlassen · ➕ Resume«.)"
    1. "Burn fortsetzen (Recommended)"     — Nach dem Reset läuft der Burn mit neu berechnetem Plan weiter.
    2. "Burn abschalten"                   — Nach dem Reset nur noch die offenen Hauptaufgaben, Standard-Tiefe; Füll-Tasks entfallen.

F8  header: "Zusatz-Tasks"  multiSelect: true    [only with Budget verbrennen, not with Backlog]
    question: "Welche Quellen sollen zusätzlich Tasks liefern? (Leer lassen = nur dein Prompt)"
    1. "Issues"                            — Offene, vertrauenswürdige Issues.   [only when open issues exist — the Backlog probe]
    2. "TODO/FIXME"                        — TODO/FIXME/HACK-Kommentare im Code.
    3. "Lint & Typen"                      — Lint- und Typfehler.
    4. "Coverage-Lücken"                   — Ungetestete Dateien und Funktionen.
```

**F5 and F6 are gated — do not bother the user with them by default.** A
gated-out question is simply not asked; its default holds and is named in
one line only when it matters ("Desktop bleibt frei · PC bleibt an").

- **Desktop gate (F5).** Ask only when a mouse/keyboard takeover adds real
  value: verifying the change needs a native, non-browser GUI — the project
  is a desktop, game or mobile-emulator app (Electron, Tauri, WPF/WinUI, Qt,
  Unity/Godot, Android/iOS emulator) **and** the task touches its UI, or
  the prompt names native-app interaction. Web apps, CLIs, libraries,
  backends, docs and plugin code never get it — browser tools cover web
  UIs without the desktop. Gated out → `Desktop frei lassen`.
- **Resume gate (F6).** Ask only when hitting the 5h limit is foreseeable,
  with buffer: estimate the run's share of the 5h window (short prompt run
  ~10–20 %; long run — a backlog of ≥ 3 issues or milestones, "Alles
  prüfen", parallel lanes — ≥ 50 %), add half of it again as buffer, and
  ask when that reaches the window's remaining headroom from the newest
  `[budget]` line (or parallel sessions draw on it). Budget verbrennen
  always passes the gate. Gated out → `🟢 PC anlassen · ➖ Resume`.
- **Phrase presets (Step 1).** "PC danach aus", "fahr den PC runter",
  "shutdown" → F6 = `🔴 PC ausmachen`; "resume nach dem Limit",
  "weitermachen nach dem Reset" → F6 = `🟢 PC anlassen · ➕ Resume`;
  "übernimm den Desktop", "teste mit Maus/Tastatur" → F5 = `Desktop
  übernehmen`. A preset answers the question whether or not its gate
  passed — shutdown stays reachable without asking everyone.

F6 is asked only when a resume is foreseeable, so its first option — the
recommendation — is `➕ Resume`; the order never changes. The symbols carry
the state at a glance: 🟢/🔴 the PC stays on or shuts down, ➕/➖
auto-resume on or off; shutdown never resumes, so its label needs no resume
symbol.

F7 is the auto-resume answer for the burn: whatever the user types after a
limit is asked again by `prompt.burn.resume` (manual nudge, "Burn
abschalten" recommended there); only the unattended resume follows F7. A
week that has reset since the burn started switches it off regardless. F8
feeds `modes/burn.md` Step 5: issues assigned to the user are core work
(P2); lint and type fixes are mechanical (P1); TODOs, coverage gaps and
unassigned issues are filler (P3–P5). Mechanical and filler tasks always run
at standard depth.

F6 folds the autonomous shutdown and auto-resume questions into one: no
option pairs shutdown with resume, so the HARD GATE of
`modes/autonomous.md` Step 2 (`$SHUTDOWN=yes` ⇒ `$AUTO_RESUME=no`) holds by
construction. F3/F4 labels are data, exempt from the label rules. When more
milestones and loose issues exist than the call has room for, the rest of
the selection continues in `modes/backlog.md` Step 1.2 — the tool's
four-question cap is the only reason for a second follow-up.
