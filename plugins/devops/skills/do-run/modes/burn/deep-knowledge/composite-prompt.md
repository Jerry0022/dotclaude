# Burn — Composite Prompt Template

Build the autonomous task prompt as follows, then pass it as `$ARGUMENTS`
to autonomous mode (`modes/autonomous.md`, same skill). Autonomous mode
handles permission priming, the 3-minute start confirmation, execution,
reporting and optional shutdown; its Step 5 runs auto-agents with
`--burn=<project root>/BURN-STATE.json`.

The plan lives in `BURN-STATE.json` (written by `burn-plan.js init` in burn
Step 7). The run never re-derives it and never computes a lane, a reserve or
a fit by hand — `burn-plan.js gate` decides every spawn and recalibrates.

```
BURN MODE ACTIVE — Tiefe vor Breite, jeder Task landet einzeln, das Skript entscheidet.

## Hauptauftrag
{user's primary task from Step 3}

## Task-Queue (steht in BURN-STATE.json — nur zur Übersicht)
{P0–P2 tasks}   [size, profile]
{P3–P5 tasks}   [size, standard]

## Burn-Plan (aus burn-plan.js init — nicht neu herleiten)
- Profil: {profile} · Lanes: {lanes} · Reserve: {reservePct}% · Uplift: {uplift}×
- Integration-Branch: burn/{slug}
- Auto-Resume nach Limit: {continue | off} (F7)
- State: {project root}/BURN-STATE.json

## Ausführung
auto-agents mit --burn={project root}/BURN-STATE.json — Conveyor statt Waves
(skills/auto-agents/SKILL.md § Burn conveyor):
1. node burn-plan.js gate → spawn · wait · hold · pause · finish
2. spawn: Agent mit den models-Overrides aus dem Gate, danach
   burn-plan.js state agent <id> --agent-id=… --branch=… --worktree=…
3. Agent committet `wip(burn): …` nach jedem grünen Teilschritt (mind. alle ~10 Tool-Calls)
4. passes aus dem Gate (redteam) für substanzielle Diffs
5. gezielte Tests → Merge in burn/{slug} → git push -u origin burn/{slug}
   (non-force, nie main, kein PR, kein Ship) → burn-plan.js state land <id> --sha=…
6. pause → Cron aus dem Gate armen (state resume-cron), Report „pausiert bis …", Turn beenden
7. finish → voller QA-Lauf als letzter Task (kein Gate), dann Report

### Browser — Edge Credo
- Alle Browser-Interaktion folgt dem Edge Credo (deep-knowledge/browser-tool-strategy.md § Edge Credo)

### Nie
- Lanes, Reserve oder Profil selbst ändern — nur burn-plan.js
- Einen Worktree ohne `burn-plan.js prune-check` entfernen
- Nach einem Limit-Stopp einfach weiterbrennen — der [burn-resume]-Block entscheidet

### Abschluss
- burn-plan.js state finish --status=<COMPLETED|INTERRUPTED|BLOCKED> (misst die Kalibrierung)
- AUTONOMOUS-REPORT.html: alle Tasks mit Status, Profil und Landing-SHA; übersprungene Füll-Tasks
```
