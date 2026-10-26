# Decision modes — how a concept page asks

How Claude authors a decision on a concept page: the seven modes, the fields
every decision carries, the label rules and the before / after rewrites they
came from. **The way to answer follows the question — never the other way
round.** The markup and payload of each mode (`data-decision-mode`, the
`dm-{id}` controls, `value` per mode) are defined in `templates-analysis.md`
§ Decision modes and § Payload; this file never redefines them, it says when
to use which and how to word it.

Why this exists: an analysis of 200 recent decisions found the single
include / discard bi-state carrying nine different kinds of decision and
fitting only one of them (66 of 200 fit, 117 did not). Pages explained the
control in prose ("„Verwerfen“ heißt hier nicht „nie“, sondern „später“"),
hid the real options in paragraphs, and 22 of 26 notes held a decision the
toggle could not. The modes below replace that for every new decision; the
bi-state stays only for its one fitting job (§ Legacy bi-state).

## Anatomy — the fields of every decision

From top to bottom, in one reading order: where it applies → what is asked →
what is preselected → Weiter.

| # | Field | Markup (`templates-analysis.md`) | Rule |
|---|---|---|---|
| 1 | **Gilt für** | `data-applies-to` + quiet line `[data-applies]` | Where it acts — screen, skill, file, project, "nur diese Runde". Quiet text above the question, **not a label or chip** |
| 2 | **Frage** | `[data-question]` | A real question ending in "?", naming the object. The loudest element of the card (largest type, 1–2 lines). Never a statement ("Keine Testläufe") |
| 3 | **Ein Satz Kontext** | `[data-context]` | One quiet line of background — answers "why am I asked this?". Everything else stands in the analysis column |
| 4 | **Befund** | `data-finding` + the L3 block (`data-alevel="3"`) | The finding the decision rests on, shown in the right third; its display comes from `analysis-palette.md` |
| 5 | **Antworten** | `[data-options]`, `[data-opt]`, `[data-opt-label]`, `[data-opt-consequence]` | In the fitting mode; each option = an outcome label with a verb + one consequence line. They answer exactly this question |
| 6 | **Empfehlung + warum** | `data-rec`, `data-rec-why`, `[data-recommended]` | ★ badge on the recommended option, the reason ("…, weil …") in its tooltip. **The only label on the card** |
| 7 | **Vorauswahl** | the `data-rec` control is checked / set | **Always the recommendation**, in every mode — gate A2 fails a decision without it |
| — | Stepper name | `data-label` | Short noun phrase for the stepper tooltip, the review and the payload; reads correctly out of context |
| — | Note | `textarea[data-comment="{id}-note"]` | ONE inline note field, directly typeable — never a second "✎ Notiz" button, never an option |
| — | Issue link | `dm-{id}-issue` / `dm-{id}-epic` | Discreet text link "Als Issue anlegen (ggf. mit Epic)" — the only way to defer |

What a decision card does **not** carry: a Tragweite / impact label, a status
chip (offen · entschieden · Issue lives only in the stepper), a type or id
chip, a "weicht von der Empfehlung ab" line, a second submit. One primary
"Weiter" (Enter) bottom right, "Zurück" (⇧ + Enter) beside it.

## Which mode? (Wahlhilfe)

Ask the questions in this order; the first yes picks the mode.

| Question | Mode |
|---|---|
| Do the answers exclude each other? | 1 · `single` |
| Are there several independent items, each in or out? | 2 · `multi` |
| Is there one concrete proposal to accept, refuse or change? | 3 · `yesnoalt` |
| Is it a number, threshold or budget on a scale? | 4 · `slider` |
| Is everything done anyway, but the position matters? | 5 · `order` |
| Is it whether something is true / built right? | 6 · `verify` |
| Is it about a word — a name, a label, a phrasing? | 7 · `wording` |

Never a mode: a point in time ("jetzt / später / Welle 2"). See § Rules.

## 1 · single — Einzelwahl

- **Wann Claude ihn einsetzt:** die Antworten schließen sich aus und haben
  verschiedene Folgen; 2–3 Optionen plus „Keine davon / anders …“.
- **Control:** radio cards (`dm-{id}`); the last card may be
  `data-opt="other"` "Keine davon / anders …" — choosing it makes the inline
  note required (it does not add a second field).
- **Payload value:** the option id (`"optin"`).
- **Labels:** each option is the outcome with a verb ("Opt-in statt
  Standard"), never a letter ("A") or a polarity ("Verwerfen").
- **Example:** *Gilt für Plugin* — **Wie weiter mit graphify?**
  - ★ **Opt-in statt Standard** — läuft nur, wo ein Projekt es einschaltet.
  - **Komplett entfernen** — der Rückweg kostet Aufwand.
  - **Keine davon / anders …** — Notiz ist dann Pflicht.
- Result reads: "graphify → Opt-in statt Standard".

## 2 · multi — Mehrfachauswahl

- **Wann Claude ihn einsetzt:** unabhängige Punkte, jeder einzeln rein oder
  raus — Umfang, Leitplanken.
- **Control:** checklist (`dm-{id}.{opt}`); the recommended items carry ★ and
  are preselected; a live count "3 von 4" shows the scope.
- **Payload value:** the checked ids in document order (`["p1","p2","p3"]`).
- **Labels:** items are phrased positively as the thing that applies, never
  negated ("Footer erst am Listenende", not "Kein Footer neben endlosem
  Scrollen").
- **Example:** *Gilt für alle Entwürfe* — **Welche Prinzipien gelten als
  Leitplanken?** ★ P1 Header-Modus pro Seitentyp · ★ P2 Crumbs oder Zurück,
  nie beides · ★ P3 Overlay = dieselbe Route · P4 Footer erst am Listenende.
- Result reads: "Leitplanken → P1, P2, P3".

## 3 · yesnoalt — Ja / Nein / Anders

- **Wann Claude ihn einsetzt:** ein konkreter Vorschlag, den du annimmst,
  ablehnst oder abwandelst.
- **Control:** three radios `yes` / `no` / `alt`; `alt` opens its text field
  (`dm-{id}-alt`) "Was stattdessen?".
- **Payload value:** `{ "answer": "yes" }` / `{ "answer": "alt", "alt": "…" }`.
- **Labels:** Ja and Nein name the outcome ("Ja, entfernen" · "Nein, bleibt"),
  never bare "Ja" / "Nein". The question itself is positive — no negation
  under a yes / no.
- **Example:** *Gilt für Stop-Hook* — **Löschen wir den Debug-Nudge?**
  ★ Ja, entfernen · Nein, bleibt · Anders … (Was stattdessen?).
- Result reads: "Debug-Nudge → Ja, entfernen".

## 4 · slider — Schieberegler

- **Wann Claude ihn einsetzt:** eine Zahl, Schwelle oder ein Budget auf einer
  Skala; die Folgen ändern sich stetig.
- **Control:** a range over a bar (`dm-{id}`, `min` / `max` / `step`,
  `data-unit` on the decision); the start value is the recommendation, shown
  as a ★ mark; 2–3 named stops carry the consequence of that zone.
- **Payload value:** the number (`8`).
- **Labels:** a unit at every mark, a consequence at each zone ("4 s · öfter
  Abbruch", "8 s · Ziel p95", "15 s · spürbar").
- **Example:** *Gilt für Stop-Hook* — **Wie lange darf das Turn-Ende
  höchstens warten?** 4 s … ★ 8 s … 15 s.
- Result reads: "Budget → 8 s".

## 5 · order — Reihenfolge

- **Wann Claude ihn einsetzt:** alles wird gemacht, aber die Position bewirkt
  etwas — was oben steht, zählt zuerst.
- **Control:** a sortable list (drag, Alt + ↑ / ↓, "⤒ nach oben") writing the
  hidden `dm-{id}`; preset in the recommended order.
- **Payload value:** the ids in the chosen order (`["a","c","b"]`).
- **Labels:** item = outcome, position = rank. Never a schedule ("später",
  "Welle 2") and never buckets "Jetzt · Danach · Später · Nie" — dropping an
  item is a `multi` question, deferring one is an issue.
- **Example:** *Gilt für Kurzblick* — **Welche Kennzahl zeigt der Kurzblick
  zuerst?** ★ Turn-Ende p95 · Cache-Tokens · Session-Start · Prozesse je Call.
- Result reads: "Kurzblick → Turn-Ende, Cache-Tokens, …".

## 6 · verify — Prüfen

- **Wann Claude ihn einsetzt:** ein Befund, eine Deutung oder etwas Gebautes
  soll bestätigt werden.
- **Control:** always the three radios `ok` / `partial` / `wrong` (Stimmt ·
  Teilweise · Stimmt nicht); from "Teilweise" on the correction field
  (`dm-{id}-fix`) "Was stimmt nicht?" opens.
- **Payload value:** the verdict (`"partial"`) plus the correction in `fix`.
- **Labels:** the question states the claim ("Stimmt die Diagnose: Jede
  Seitenfamilie baut ihren eigenen Kopf?"). What to *do* about a confirmed
  finding is a separate decision in its own mode, not a second control on
  this card.
- Result reads: "Diagnose → stimmt".

## 7 · wording — Freitext-Wahl

- **Wann Claude ihn einsetzt:** ein Name, ein Wording, ein Label —
  Vorschläge plus eigenes Wort; die Analyse daneben ist Formatierter Text.
- **Control:** radios per suggestion (each `data-text="…"`) plus `custom`
  with its text field (`dm-{id}-text`) "✎ eigenes Wort".
- **Payload value:** the final wording, verbatim (`"Weiter"`), plus `choice`.
- **Labels:** each suggestion is the literal word as it will appear, no
  description around it.
- **Example:** *Gilt für Bühne* — **Wie heißt der Knopf unter jeder
  Entscheidung?** ★ Weiter · Übernehmen · Bestätigen · ✎.
- Result reads: "Knopf → „Weiter“".

## Label rules

All checkable while writing; several are gate warnings.

| Rule | Wrong | Right |
|---|---|---|
| **Outcome verbs.** Each label names what happens | "Variante A", "Option 2" | "Tests erst nach Freigabe laufen lassen" |
| **No polarity-only labels.** Verwerfen, Miteinbeziehen, Ja, Nein, An, Aus never stand alone | [ Verwerfen ] [ Miteinbeziehen ] | [ Bei 8 Farben bleiben ] [ Auf 16 erweitern ] |
| **No double negation.** A negated statement never sits under yes / no or include / discard — turn it into a question | "Kein Inhaltsverzeichnis im FAB" — Miteinbeziehen | Zeigt das FAB ein Inhaltsverzeichnis? ★ Nein, nur die Karte · Ja · Anders |
| **One consequence line per option** (`data-opt-consequence`) | a bare label | "Aus 17 Prozessen werden 2." |
| **Text never explains the control.** If prose must say what a button means here, the mode is wrong | "„Verwerfen“ heißt hier nicht „nie“, sondern „später“." | mode `order`: drag, top counts first |
| **Reads outside the card** — in the panel, the payload, the final report | "Hinweis Umsetzen → include" | "graphify → Opt-in statt Standard" |
| **One decision, one control.** A second control on the same subject is an error | radio "Übernehmen / Ablehnen / Autor fragen" plus a bi-state on the same issue | one `single`: ★ Übernehmen mit #702 · Eigenes Issue · Ablehnen · Autor fragen |
| **Answers fit the question.** The options are content answers to exactly this question — not to a neighbouring one, not "später", not "alle" | "Wie bündeln wir die Hook-Prozesse?" — Welle 1 · Welle 2 | Ein Dispatcher pro Event · Nur die 5 häufigsten · Einer für alles |

## Rules

- **Only the recommendation is a label.** ★ on the option, reason in its
  tooltip. "Gilt für" is quiet text; no impact, status, type or id chips.
- **Preselection = recommendation, always.** In every mode the recommended
  answer is already set (gate A2). No "nothing preselected because the impact
  is high" — the untouched rule below covers click-through instead.
- **Timing is never a decision.** The default is: implement now. Never ask
  "wann", "Welle 1 / 2 / 3", "jetzt / später / nie". Deferring is the
  per-decision link "Als Issue anlegen (ggf. mit Epic)" — gate A8 warns on
  timing words.
- **No "alle wie empfohlen übernehmen".** The user clicks through each
  decision; "Weiter" takes what is selected.
- **Untouched ≠ agreed.** A decision never opened, or open for less than 3 s,
  is *untouched*: it is submitted with its preselected value and
  `untouched: true`, and Claude treats it as "not looked at", not as consent.
  Open ≥ 3 s (or changed) = decided "keep the preselection". The review lists
  deviations first, then issues, then the untouched ones, with "Zum ersten
  Unberührten".
- **Settled stays settled.** A decision taken in an earlier round is never
  re-asked as a toggle ("R3 bleibt"); show it as context.
- **An exclusive choice is never N bi-states.** Three cards that each say
  "Miteinbeziehen" for alternatives of one question can be submitted as "all
  three" — use `single` (gate A7).
- **Findings are content, not decisions.** A finding gets a control only when
  Claude needs it confirmed — then it is `verify`.
- **≤ 3 topics, ≤ 7 decisions each** in a Full analysis; ≤ 5 decisions in a
  Lite (gates A4 / A5). More means split, not squeeze.

## Before / after — rewrites of real decisions

From pages of the last weeks (round 2 and round 3 of the concept that
introduced the modes). Project-specific nouns are neutralised.

### Testläufe — bi-state on a negated statement → `single`

- **Before:** "D6 · Keine Testläufe" with [Verwerfen] [Miteinbeziehen ✓]; the
  real options hid in the paragraph ("Nein in Stufe 1 … Tests erlauben, z. B.
  in einem Wegwerf-Worktree"). What does "Verwerfen" do — allow tests? drop
  the rule? allow them where?
- **After:** *Gilt für Phase A + B · alle Projekte im Alpha-Kanal* —
  **Dürfen während der Frustrated-Analyse Tests laufen?** Kontext: Der Guard
  erlaubt in der Analyse heute nur Lese-Tools.
  - ★ **Erst nach Freigabe** — ein Test, den eine Hypothese braucht, wird der
    erste Planschritt.
  - **Im Wegwerf-Worktree** — die Analyse prüft sofort; der Guard braucht eine
    Ausnahme.
  - **Gar nicht in der Analyse** — was nur ein Test klären kann, bleibt offen.
  - **Keine davon / anders …** — Notiz ist dann Pflicht.
  - Analysis column: Formatierter Text (Heute · Risiko · Ausweg), Belege (2).

### Größenstufe „mittel“ — three bi-states all preset include → `single`

- **Before:** three exclusive answers as three bi-states, all three preset
  Miteinbeziehen — "„mittel“ für später reservieren", "Mittlere Einträge als
  „mittel“ zeigen", "„mittel“ streichen". Submitted as shown it meant "all
  three", which is impossible; the "only one" rule stood in a sentence above.
- **After:** **Welche Größenstufen zeigt die Anzeige?**
  - ★ **Bei klein / groß bleiben, „mittel“ reservieren** — nichts ändert sich.
  - **Mittlere Einträge als „mittel“ anzeigen** — schon auf der Anzeige
    unterscheidbar, die Detailansicht verliert diesen Grund.
  - **„mittel“ ganz streichen** — ein späterer mittlerer Eintrag braucht
    wieder eine neue Stufe.
  - Exactly one answer is possible — "all three" cannot happen any more.

### Wie geht es weiter? — "Behalte den Weg, den du willst" → `order`

- **Before:** A · "Konzept abschließen, weiter mit dem Folgekonzept"
  (empfohlen), B · "Jetzt einen ersten Teil umsetzen", C · "Zuerst die
  geparkten Konzepte", each [Verwerfen] [Miteinbeziehen]. The user kept A and
  B and wrote on C "die machen wir danach" — the real answer was an order the
  switch could not hold.
- **After:** **Was baut worauf auf — in welcher Reihenfolge entstehen die
  Konzepte?** Sortable, preset in the recommended order, each with its
  consequence ("baut darauf auf; nichts entsteht doppelt", "vorher gebaut,
  entsteht die Hälfte doppelt"). The user's original answer fits 1 : 1 — no
  note, no schedule.

### Hook-Prozesse — everything equally loud → one reading order (round 3)

- **Before:** seven blocks of almost the same weight — Gilt-für chip, question,
  a three-line explanation, three cards with "Aufwand L · umkehrbar mit
  Aufwand", a ★ block saying "Hohe Tragweite: bewusst nicht vorausgewählt",
  "＋ Notiz" button, Zurück / Weiter. The eye jumps between them, nothing is
  preselected.
- **After:** *Gilt für alle Hook-Events · Plugin* — **Wie bündeln wir die
  Hook-Prozesse?** (31 px, bold) · one context line "Heute läuft jeder Hook
  als eigener Prozess — 17 pro Bash-Call." · cards (17 px): ★ **Ein
  Dispatcher pro Event** (preselected) — aus 17 Prozessen werden 2 · **Nur
  die 5 häufigsten** — aus 17 werden 13 · **Einer für alles** — ein Fehler
  trifft jedes Event · Keine davon / anders … · quiet row (12–14 px): Notiz ·
  Als Issue anlegen · **Weiter ⏎**. Reading order: ① Frage → ② ★ → ③ Weiter.

### Negated statement → `yesnoalt` with a positive question

- **Before:** "Kein Inhaltsverzeichnis im FAB beim Abschluss" —
  [Verwerfen] [Miteinbeziehen]. Verwerfen of "kein" = yes, a TOC?
- **After:** **Zeigt das FAB beim Abschluss ein Inhaltsverzeichnis?**
  ★ Nein, nur die Karte · Ja, mit Inhaltsverzeichnis · Anders …

### Finding as a decision → `verify`

- **Before:** "B5 · Breite: alles gleich, es gibt kein „schmal“ — 37 von 38
  Routen haben exakt dieselbe Inhaltsbreite" with [Verwerfen]
  [Miteinbeziehen]. What does including a measurement trigger?
- **After:** **Stimmt der Befund: Alle Routen haben dieselbe
  Inhaltsbreite?** Stimmt · Teilweise · Stimmt nicht (→ Was stimmt nicht?).
  Analysis column: Punktmatrix or Rangbalken of the widths. Whether to add a
  narrow width is a separate `single` decision.

### Timing as a decision → content question + Issue link

- **Before:** "B1 nicht bauen", preset Miteinbeziehen; the card listed
  "Erst wenn B0 Bedarf zeigt · Gleich mitbauen · Gar nie". Verwerfen could
  mean "build now" or "build never".
- **After:** **Bauen wir die Aufzeichnung nutzergeführter Abläufe (B1)?**
  (`yesnoalt`) ★ Nein, die Regel „Overlay liest die Seite nie“ bleibt ·
  Ja, gleich mitbauen — bricht diese Regel · Anders … — and "Erst wenn B0
  Bedarf zeigt" is not an answer but the discreet link **Als Issue anlegen
  (mit Epic B0)**.

### Duplicate controls → one `single`

- **Before:** each foreign issue had a good radio ("Übernehmen (zusammen mit
  #702) · Übernehmen, eigenes Issue · Ablehnen · Autor fragen") *and* a
  bi-state "#791 · Verwerfen / Miteinbeziehen" — "Ablehnen" + "Miteinbeziehen"
  was a legal, contradictory submission.
- **After:** only the radio, ★ on "Übernehmen mit #702", preselected.

## Legacy bi-state

A decision without `data-decision-mode` is the include / discard bi-state of
`templates-decision.md` § Bi-State Variant Evaluation, with its unchanged
`evaluation` payload. Old and frozen rounds keep it. In new rounds it is
acceptable only for its one fitting job — independent items each in or out
on a plain `decision` / `free` round — and even there `multi` is preferred,
because its labels name the outcome and its payload knows "untouched".
