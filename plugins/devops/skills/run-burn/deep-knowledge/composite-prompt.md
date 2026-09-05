# Burn — Composite Prompt Template

Build the autonomous task prompt as follows, then pass it as `$ARGUMENTS`
to `/run-autonomous`. The autonomous skill handles Steps 2–8 of its
own flow (desktop questions, permission priming, execution, reporting,
optional shutdown).

The plan values below (`profile`, `lanes`, `RESERVE`, `requiredPerHour`,
`integrationBranch`) come from `/run-burn` Step 2. The autonomous run **applies**
them — it does not re-derive them. It may only recalibrate per
`skills/run-burn/deep-knowledge/burn-scheduler.md` § In-run recalibration.

```
BURN MODE ACTIVE — Tiefe vor Breite, jeder Task landet einzeln.

## Hauptauftrag
{user's primary task from Step 3}

## Task-Queue (nach Prioritaet, mit Size + Profil)
{P1 tasks}   [size, profile]
{P2 tasks}   [size, profile]
{P3–P5 tasks} [size, profile]

## Burn-Plan (abgeleitet — nicht neu herleiten)
- Profil: {profile}          # standard | deep | max
- Lanes: {lanes}
- Reserve: {RESERVE}% weekly
- requiredPerHour: {x}%/h
- Integration-Branch: burn/{slug}
- Uplift ggue. /run-agents: {x}x

## Burn-Guidance

### Browser — Edge Credo
- Alle Browser-Interaktion folgt dem Edge Credo (deep-knowledge/browser-tool-strategy.md § Edge Credo)
- Edge only, Claude Extension only, User-Context, Tab-Reuse — auch im Burn-Modus

### Tiefe (der primaere Hebel)
- Modelle gemaess Profil AUFWERTEN, nie fuer Kosten downgraden
- Effort und Tool-Call-Ceiling gemaess Profil-Tabelle setzen
- Extra-Passes pro Task gemaess Profil (redteam-Review, zweiter QA, po-Review)
- Mechanische Tasks (Lint, Rename, Import-Sort, Dependency-Bump) bleiben auf
  `standard` — opus auf einem Lint-Fix ist Verbrauch ohne Qualitaet

### Breite (nur zum Auffuellen)
- Genau {lanes} Lanes, nicht mehr. Lanes sind budget-abgeleitet, kein Maximum.
- lanes == 1 → Agent im Vordergrund spawnen (vermeidet das Worktree-Resync-Fenster)
- lanes > 1  → run_in_background, aber immer nur EIN Merge gleichzeitig
- Agent-Auswahl folgt deep-knowledge/agent-orchestration.md § Agent Selection:
  nur Rollen mit konkretem Beitrag, nicht der volle Roster zur Abdeckung

### Landing-Protokoll (pro Task, in dieser Reihenfolge)
1. Agent implementiert auf burn/{slug}-<role>-<n>
2. Agent committet VOR der Rueckmeldung — Unfertiges als `wip:` mit Angabe was fehlt
3. Gezielte Tests nur fuer die geaenderten Module, nicht die volle Suite
4. Merge in burn/{slug}
5. git push -u origin burn/{slug}   (non-force, nie main, kein PR, kein Ship)
6. BURN-STATE.json aktualisieren
7. Naechsten Task ziehen

### Reserve-Gate
- Vor JEDEM neuen Spawn Usage pruefen (Snapshot <= 60s gilt als frisch)
- remaining <= {RESERVE}% → Drain: nichts Neues spawnen, laufende Lanes zu Ende,
  mergen, pushen, Report + Completion-Card
- Task nie starten, dessen Size-Klasse nicht mehr in `spendable` passt

### Abschluss
- Der volle QA-Durchlauf ist ein normaler Task am Ende der Queue, KEIN Gate.
  Kein Task wartet auf ihn, um als erledigt zu zaehlen.
- AUTONOMOUS-REPORT.html enthaelt alle Tasks mit Status, verwendetem Profil und
  Landing-SHA
- Nie einen Worktree entfernen, dessen Branch unmerged Commits hat
```
