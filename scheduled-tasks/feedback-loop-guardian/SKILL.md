---
name: feedback-loop-guardian
description: Daily 8am check: ensure feedback memory self-audit loop is running, start it if not
---

Prüfe ob die Feedback-Loop (CronJob, alle 30 Minuten) in dieser Session aktiv ist. Nutze CronList um alle aktiven Jobs zu sehen.

Falls ein Job mit "Feedback-Loop" im Prompt existiert → alles OK, nichts tun.

Falls KEIN solcher Job existiert → erstelle ihn mit CronCreate:
- Cron: */30 * * * *
- Recurring: true
- Prompt: (die vollständige Feedback-Loop v2.4 Anweisung):

Feedback-Loop v2.4 — führe diese 5 Schritte der Reihe nach aus:

1. SELF-AUDIT: Finde alle feedback_*.md im Memory-Verzeichnis des aktuellen Projekts (Glob: feedback_*.md im Memory-Pfad aus MEMORY.md). Lies jede Datei. Prüfe dein bisheriges Verhalten in dieser Session gegen jede Regel. Bei Verstoß: sofort korrigieren und kurz melden.

2. LERNEN: Scanne den bisherigen Session-Verlauf nach neuen Feedback-Patterns — z.B. Korrekturen vom User, bestätigte ungewöhnliche Ansätze, oder wiederholte Muster. Wenn ein neues Pattern gefunden wird: direkt als feedback_*.md Memory speichern (Frontmatter + Why + How to apply) und MEMORY.md Index updaten. Kurz melden was gespeichert wurde.

3. PROAKTIV: Prüfe ob anstehende Aktionen gegen Feedback-Regeln verstoßen könnten. Beispiel: Steht eine Karte an? → Template aus deep-knowledge laden. Steht ein Browser-Task an? → Im Hintergrund ausführen. Bei Fund: vorbereitende Aktion durchführen.

4. SKILL- UND TEMPLATE-INTERNALISIERUNG:
   a) Lies die globale CLAUDE.md (~/.claude/CLAUDE.md) und identifiziere alle Verweise auf Skills und deren deep-knowledge.
   b) Discovere ALLE deep-knowledge Dateien: Glob ~/.claude/skills/**/deep-knowledge/*.md
   c) Sortiere die Ergebnisliste alphabetisch nach vollem Pfad.
   d) Berechne Batch-Größe = ceil(Gesamtanzahl * 0.25).
   e) Halte intern einen Zähler (startet bei 0 im ersten Zyklus dieser Session, +1 pro Zyklus).
   f) Startindex = (Zähler * Batch-Größe) mod Gesamtanzahl.
   g) Lies genau die Dateien von Startindex bis Startindex + Batch-Größe (mit wrap-around am Listenende).
   h) Verinnerliche Regeln und Templates. Kein Output nötig — stille Selbstkalibrierung.

   Beispiel bei 17 Dateien: Batch = ceil(17 * 0.25) = 5.
   Zyklus 0: Dateien 0–4, Zyklus 1: Dateien 5–9, Zyklus 2: Dateien 10–14, Zyklus 3: Dateien 15–16 + 0–1 (wrap).

5. BASELINE-REVIEW: Wenn Schritte 1-3 keine Funde hatten, lies die globale CLAUDE.md (~/.claude/CLAUDE.md) und die Projekt-CLAUDE.md (im aktuellen Working Directory) komplett durch als stille Selbstkalibrierung. Kein Output nötig.

Pfad-Regeln: Verwende IMMER ~ für das Home-Verzeichnis und relative Pfade zum aktuellen Projekt. Niemals absolute Pfade hardcoden.

Danach: führe die Loop einmal sofort aus (erster Check der Session).
