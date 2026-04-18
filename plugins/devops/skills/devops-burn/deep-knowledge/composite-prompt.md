# Burn — Composite Prompt Template

Build the autonomous task prompt as follows, then pass it as `$ARGUMENTS`
to `/devops-autonomous`. The autonomous skill handles Steps 2–8 of its
own flow (desktop questions, permission priming, execution, reporting,
optional shutdown).

```
BURN MODE ACTIVE — Maximale Parallelisierung.

## Hauptauftrag
{user's primary task from Step 3}

## Zusaetzliche Tasks (nach Prioritaet)
{P1 tasks}
{P2 tasks}
{P3–P5 tasks}

## Burn-Guidance

### Browser — Edge Credo
- Alle Browser-Interaktion folgt dem Edge Credo (deep-knowledge/browser-tool-strategy.md § Edge Credo)
- Edge only, Claude Extension only, User-Context, Tab-Reuse — auch im Burn-Modus

### Parallelisierung
- IMMER die maximale Agent-Anzahl nutzen (full devops roster: core, frontend,
  ai, windows, designer, qa, po, research — je nach Relevanz)
- Waves wo moeglich zusammenlegen: wenn keine harte Abhaengigkeit besteht,
  können Agents aus verschiedenen Waves parallel starten
- Für unabhängige Tasks: separate Feature-Branches + separate Agent-Gruppen
  die gleichzeitig laufen
- Research-Agent im Hintergrund für alle Tasks die Kontext brauchen

### Durchsatz-Optimierung
- Keine übertriebene Planung — direkt starten
- Bei Zweifeln: implementieren statt recherchieren
- Tests erst am Ende als QA-Wave, nicht nach jedem Einzeltask
- Lint/Type-Fixes können ohne eigenen Agent inline passieren
- Kleine Tasks (< 5 Minuten geschätzt) direkt inline, nicht delegieren

### Task-Reihenfolge
- P0 und P1 Tasks starten sofort in Wave 1
- P2+ Tasks starten parallel sobald Agents frei werden
- Wenn ein Agent früher fertig wird: nächsten Task aus der Queue ziehen
- Nie idle sein — immer den nächsten Task starten

### Ergebnis-Konsolidierung
- Alle Änderungen auf dem gleichen Integration-Branch sammeln
- Sub-Branches pro Agent, sequentiell mergen
- Ein finaler QA-Durchlauf über alle Änderungen
- AUTONOMOUS-REPORT.html muss alle Tasks und deren Status enthalten
```
