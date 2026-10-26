# Analysis display palette — which display carries which finding

The catalogue Claude picks from whenever an analysis level (`data-alevel`) of a
Full or Lite analysis (`step1-templates.md` § 1b · Analysis results and
decisions — Full vs Lite) shows a finding: 35 display types, grouped by the
**shape of the content**, each with "Nimm sie, wenn …" / "Nicht, wenn …" for
the choice and the slot it fits. The markup (`data-viz`, `data-viz-spec`,
`data-slot`, `data-evidence`) is defined in `templates-analysis.md`
§ Display palette — this file never redefines an attribute, it only says which
type to pick and how to fill it.

## How Claude picks a display

1. **Name the statement first.** One sentence: what does the reader learn?
   ("35 s Wartezeit, 21 davon Autosave.")
2. **Name its shape:** a number against a target, a distribution, a ranking,
   a comparison, a course over time, a relation between two dimensions, a
   structure, a flow, a state — or a word.
3. **Search only that group below.** Take the type whose "Nimm sie, wenn …"
   fits and whose "Nicht, wenn …" does not apply.
4. **Check the slot.** The short slot (`data-slot="short"`) only takes types
   marked `kurz`; the long slot (`data-slot="long"`) takes types marked `lang`.
5. **No number, no structure → "Formatierter Text"** (`data-viz="text"`), the
   one pure text type. A graphic without a number is decoration.
6. **Nothing fits → build a custom type** under § Style rules for custom
   types, with a profile (§ Custom type profile).

One display per long slot; a short slot carries one KPI or one mini graphic
plus one sentence. A quantitative finding without a visual is gate warning A6
(`validation-gate.md` § Analysis & decision modes).

### Core vs custom

The engine renders eight **core** ids (`templates-analysis.md` § Display
palette): `text`, `kpi`, `bar`, `bars`, `spark`, `donut`, `compare`, `flow`.
Every catalogue entry says one of:

- **core `<id>`** — write `data-viz="<id>"` with the spec shown; the engine
  draws it.
- **→ core `<id>`** — the type is a core id with a particular spec (a progress
  ring is a two-part `donut`). Keys outside the core spec table are ignored by
  the engine; put anything essential into `label`.
- **custom `<id>`** — no engine renderer. Claude builds it as inline SVG / CSS
  inside the element under § Style rules for custom types, keeps the listed id
  in `data-viz` and puts a one-sentence `"text"` into the spec (the engine's
  fallback and the accessible summary). Where a fallback core id is named,
  use it when the custom drawing is not worth the tokens.

Every spec, core or custom, carries `"text"` when the statement is not obvious
from the numbers: an unparsable spec or unknown renderer falls back to it, so
a slot is never empty.

## Slot budgets

| | Short (`data-slot="short"`) | Long (`data-slot="long"`) |
|---|---|---|
| When | every level the reader is not on | the level the reader is on |
| Text | 1 sentence, ≤ 140 characters — only the statement | 2–4 sentences: statement, reading, what it means for the decision |
| Graphic | 1 KPI or 1 mini graphic (≤ 52 × 16 px) — strong lean to the mini graphic whenever there is a number | 1 palette display, cut down to this statement |
| Height | ≤ 3 lines (≈ 64 px) | graphic 150–220 px, whole slot ≤ 420 px, **never scrolls** |
| Evidence | none | "Belege (n) ›" opens `data-evidence` as a popup — raw numbers, sources, logs |
| No number | Formatierter Text, one sentence | Formatierter Text, 2–4 sentences, free formatting |

L2 short is always the topic's **result**, never its progress (the stepper
shows progress). L3 long after the user decided shows the **consequence of the
chosen option**; undecided it shows the finding. Level titles (`data-title`)
are exactly the stepper / header names — no level numbers.

## 1 · Messwert & Ziel — one number, a target, a delta

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| KPI-Kachel mit Delta | core `kpi` | eine Zahl die Aussage trägt und ein Vergleich (vorher, Ziel) dazugehört. | mehr als vier Zahlen gleich wichtig sind — dann Scorecard oder Rangbalken. | kurz · lang |
| Bullet-Chart | → core `bar` (`max` = Ziel) | ein Messwert gegen ein Ziel und Zonen (gut · knapp · schlecht) steht. | es kein Ziel gibt — dann reicht die KPI-Kachel. | kurz · lang |
| Fortschrittsring | → core `donut` (2 Teile) | genau ein Anteil an einem Ganzen zählt (9 von 17 entschieden). | mehrere Anteile verglichen werden — dann 100-%-Balken. | kurz |
| Vorher / Nachher-Paar | core `compare` | eine Änderung einen Wert verschiebt und genau das abgewogen wird. | es mehr als zwei Zustände gibt — dann Slope Chart. | kurz · lang |

```text
kpi      {"value":"35 s","unit":"p95","label":"Turn-Ende","delta":"-77 %"}
bar      {"value":35,"max":8,"unit":"s","label":"p95 gegen Budget 8 s"}
donut    {"parts":[{"label":"entschieden","value":9},{"label":"offen","value":8}]}
compare  {"before":{"label":"heute","value":35},"after":{"label":"mit Budget","value":8},"unit":"s"}
```

## 2 · Verteilung & Anteil — how it spreads, what it consists of

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| Histogramm mit Schwelle | custom `histogram` | viele Messungen streuen und eine Grenze (Budget, Limit) gesetzt wird. | es weniger als ~15 Messwerte sind — dann Punktstreifen. | lang |
| 100-%-Balken | custom `stack100` (fallback → core `donut`) | sich ein Ganzes in zwei bis fünf Teile gliedert. | die absolute Größe zählt oder es mehr als fünf Teile sind. | kurz · lang |
| Waffel (Stückzahl) | custom `waffle` | Stückzahlen greifbar werden sollen (17 Prozesse, 2 bleiben). | es über ~100 Einheiten sind. | lang |
| Punktstreifen | custom `strip` | wenige Einzelwerte streuen und Ausreißer die Aussage sind. | es Hunderte Werte sind — dann Histogramm. | kurz · lang |

```text
histogram {"bins":[2,9,14,6,3,1],"binWidth":2,"unit":"s","threshold":8,"text":"Fast alle Turn-Enden sind unter 8 s fertig."}
stack100  {"parts":[{"label":"Cache","value":60},{"label":"Hooks","value":40}],"text":"Der Cache trägt 60 % des Potentials."}
waffle    {"total":17,"marked":2,"label":"Prozesse bleiben","text":"Von 17 Prozessen bleiben 2."}
strip     {"values":[1.2,1.4,1.3,9.8],"unit":"s","text":"Ein Ausreißer: 9,8 s."}
```

## 3 · Rangfolge — what is bigger, what comes first

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| Rangbalken | core `bars` | Elemente nach einer Größe sortiert verglichen werden. | es um einen Verlauf über die Zeit geht. | kurz · lang |
| Ranked Dot Plot mit Zielband | custom `dotrange` | Werte je Element gegen einen Zielkorridor stehen (Abstand je Seite). | es weder Reihenfolge noch Ziel gibt. | lang |
| Slope Chart | custom `slope` | sich eine Rangfolge zwischen zwei Zeitpunkten verschiebt. | es mehr als ~8 Linien werden. | lang |

```text
bars     {"items":[{"label":"Autosave","value":21},{"label":"Pre-Hooks","value":7}],"unit":"s"}
dotrange {"items":[{"label":"Liste","value":720}],"band":[640,760],"unit":"px","text":"Zwei Seiten liegen außerhalb des Korridors."}
slope    {"from":"Sep","to":"Okt","items":[{"label":"Cache","a":3,"b":1}],"text":"Der Cache ist auf Platz 1 gerückt."}
```

## 4 · Vergleich — options or values side by side

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| Hantel (zwei Werte je Zeile) | custom `dumbbell` (one row: → core `compare`) | je Element zwei Werte verglichen werden (heute · Ziel, A · B). | es mehr als zwei Werte pro Element sind. | lang |
| Scorecard ✓ ◐ ✗ | custom `scorecard` | Optionen gegen Kriterien bewertet werden. | eine Zahl das Kriterium besser trägt. | lang · mit Text |
| Vergleichstabelle | custom `table` | zwei bis vier Optionen in Worten nebeneinanderstehen müssen (Folge, Aufwand, Risiko). | es nur um eine einzige Zahl geht. | lang · mit Text |

```text
dumbbell  {"items":[{"label":"Start","a":4.1,"b":1.2}],"aLabel":"heute","bLabel":"Ziel","unit":"s","text":"Der Start halbiert sich."}
scorecard {"criteria":["Aufwand","Risiko"],"options":[{"label":"Opt-in","marks":["ok","part"]}],"text":"Opt-in erfüllt beide Kriterien am besten."}
table     {"columns":["Folge","Aufwand"],"rows":[{"label":"Opt-in","cells":["läuft nur auf Wunsch","S"]}],"text":"…"}
```

Scorecard marks are always glyph **and** word (✓ erfüllt · ◐ teilweise ·
✗ nicht) — never colour alone.

## 5 · Zeit & Verlauf — where it is heading

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| Sparkline mit Endwert | core `spark` | nur die Richtung eines Verlaufs zählt — gemacht für den Kurzblick. | einzelne Zeitpunkte abgelesen werden müssen. | kurz |
| Verlauf mit Ereignissen | custom `events` (no events: → core `spark`) | ein Wert über die Zeit kippt und ein Ereignis (Release, Merge) die Ursache ist. | es keine Zeitachse gibt. | lang |
| Phasen-Zeitleiste | → core `flow` | Schritte aufeinander aufbauen und Abhängigkeiten zählen. | damit ein Zeitpunkt zur Entscheidung gemacht würde — Timing ist nie eine Entscheidung. | lang |
| Kalender-Heatmap | custom `calendar` | Häufigkeit pro Tag ein Muster zeigt (Spitzen am Montag). | weniger als ~3 Wochen Daten vorliegen. | lang |

```text
spark    {"points":[31,33,35,34,12],"label":"p95 Turn-Ende, 5 Wochen"}
events   {"points":[3,4,4,9,9],"events":[{"at":3,"label":"v0.205"}],"unit":"s","text":"Seit v0.205 dauert der Start doppelt so lang."}
flow     {"steps":[{"label":"Analyse","value":"zuerst"},{"label":"Umbau","value":"baut auf der Analyse auf"}]}
calendar {"start":"2026-09-01","values":[0,3,5,1],"text":"Spitzen am Montag."}
```

## 6 · Zusammenhang & Matrix — two dimensions at once

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| Wirkungsmatrix (Nutzen × Aufwand) | custom `impact` | viele Befunde nach zwei Achsen priorisiert werden. | es weniger als fünf Punkte sind. | lang |
| Heatmap-Matrix | custom `heatmap` | Element × Dimension eine Stärke hat (Seite × Viewport). | exakte Werte gelesen werden müssen. | lang |
| Streudiagramm | custom `scatter` | der Zusammenhang zweier Größen die Aussage ist. | Leser Einzelwerte brauchen. | lang |
| Punktmatrix (Merkmal je Element) | custom `dotmatrix` | je Element mehrere Ja/Nein-Merkmale vorliegen (Route × Crumbs, Suche, Tabs). | es Abstufungen gibt — dann Heatmap. | lang |

```text
impact    {"x":"Aufwand","y":"Nutzen","points":[{"label":"V9","x":1,"y":5,"topic":"t-cache"}],"text":"Oben links die schnellen Gewinne."}
heatmap   {"rows":["Liste"],"cols":["Phone","Desktop"],"values":[[2,0]],"text":"Nur die Liste bricht auf dem Phone."}
scatter   {"x":"Kontext (k)","y":"Dauer (s)","points":[[120,4.1]],"text":"Je mehr Kontext, desto länger der Start."}
dotmatrix {"rows":["/a"],"cols":["Crumbs","Suche"],"values":[[true,false]],"text":"Keine Route hat beides."}
```

In the Wirkungsmatrix a point's colour is its topic (topic colours, never
status colours); the quadrant labels carry the reading.

## 7 · Struktur & Hierarchie — what belongs to what

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| Treemap | custom `treemap` | ein Ganzes hierarchisch in Größen zerfällt (Kontext nach Quelle). | es eine flache Liste unter fünf Teilen ist. | lang |
| Abhängigkeitsgraph | custom `graph` | Dinge aufeinander aufbauen oder sich aufrufen (Hook → Skript → Datei). | es über ~15 Knoten werden. | lang |

```text
treemap {"items":[{"label":"Skills","value":40,"children":[{"label":"auto-concept","value":22}]}],"unit":"k","text":"Ein Skill trägt die Hälfte des Kontexts."}
graph   {"nodes":["hook","script","file"],"edges":[["hook","script"],["script","file"]],"text":"Jeder Hook startet ein eigenes Skript."}
```

## 8 · Prozess & Fluss — where it flows, where it waits

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| Sankey (Mengenfluss) | custom `sankey` | Mengen von Quellen zu Zielen fließen (Tokens nach Herkunft → Verwendung). | Platz knapp ist — nie im Kurzblick. | lang |
| Trichter | custom `funnel` (fallback → core `bars`, absteigend) | eine Menge über Stufen schrumpft (Nudges → mögliche → echte Abfragen). | die Stufen nicht nacheinander kommen. | lang |
| Wasserfall | custom `waterfall` (fallback → core `bars`) | sich eine Summe aus Beiträgen zusammensetzt (35 s = 21 + 7 + 4 + …). | es mehr als ~7 Beiträge sind. | lang |
| Prozessfluss | core `flow` | ein Ablauf mit Zweigen zeigt, wo etwas passiert (Turn-Ende → Hooks → Autosave). | es um Mengen geht. | lang · mit Text |

```text
sankey    {"links":[{"from":"CLAUDE.md","to":"Kontext","value":12}],"unit":"k","text":"Der meiste Kontext kommt aus Regeldateien."}
funnel    {"steps":[{"label":"Nudges","value":120},{"label":"echte Abfragen","value":9}],"text":"Von 120 Nudges führen 9 zu einer Abfrage."}
waterfall {"items":[{"label":"Autosave","value":21},{"label":"Pre-Hooks","value":7}],"total":"35 s p95","unit":"s","text":"Der Autosave ist mehr als die Hälfte."}
flow      {"steps":[{"label":"Turn-Ende","value":"0 s"},{"label":"Autosave","value":"+21 s"}]}
```

## 9 · Zustand & Status — many things, one state each

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| Status-Raster | custom `statusgrid` | viele Elemente einen Zustand haben (16 Sessions: ok · warnt · hängt). | es um Größen statt Zustände geht. | kurz · lang |
| Checkliste mit Status | custom `checklist` | Kriterien erfüllt sind oder nicht (Gate-Regeln, Anforderungen). | es Abstufungen gibt — dann Scorecard. | kurz · lang · mit Text |

```text
statusgrid {"items":[{"label":"S1","state":"ok"},{"label":"S2","state":"warn"}],"text":"2 von 16 Sessions hängen."}
checklist  {"items":[{"label":"Briefing vorhanden","state":"ok"},{"label":"Empfehlung je Frage","state":"fail"}],"text":"Eine Regel fehlt."}
```

These two are the only types where green / amber / red are allowed — the
colour IS the state, always doubled by a glyph and a word.

## 10 · Text-nahe Formen — a sentence carries it, the display frames it

| Type | `data-viz` | Nimm sie, wenn … | Nicht, wenn … | Slots |
|---|---|---|---|---|
| Callout + Kennzahl | → core `kpi` (`label` = der Satz) | ein Satz und eine Zahl zusammen die Aussage sind. | zwei Zahlen gleich wichtig sind. | kurz · lang · mit Text |
| Zitat-Karte | custom `quote` | eine Nutzer-Aussage, ein Log oder eine Doku-Stelle der Beleg ist. | sie nur Deko ohne Quelle wäre. | lang · mit Text |
| Annotierte Grafik | custom `annotated` (a core type + 1–3 notes) | eine Grafik erst mit ein bis drei Hinweisen im Bild verständlich wird. | mehr als drei Hinweise nötig wären. | lang · mit Text |
| Diff-Ausschnitt | custom `diff` | die Entscheidung an einer konkreten Text- oder Codeänderung hängt. | der Ausschnitt über ~12 Zeilen wird. | lang · mit Text |
| **Formatierter Text** | core `text` | es keine Zahl und keine Struktur gibt — Wortwahl, Begründung, Abwägung; Claude formatiert frei (Absatz, Liste, Fettung, Gegenüberstellung). | eine Grafik dieselbe Aussage schneller trägt. | kurz · lang · **die einzige reine Textform** |

```text
kpi       {"value":"21 s","label":"Der Autosave allein ist mehr als die Hälfte der Wartezeit."}
quote     {"quote":"Belege als Popup, die Analyse scrollt nie.","source":"Runde 2, Notiz","text":"Der Wunsch kam aus Runde 2."}
annotated {"base":"bars","spec":{"items":[{"label":"Autosave","value":21}]},"notes":[{"at":"Autosave","text":"blockiert die Kette"}],"text":"…"}
diff      {"lang":"md","minus":["Verwerfen"],"plus":["Bei 8 Farben bleiben"],"text":"Das Label nennt jetzt das Ergebnis."}
text      {"text":"**Heute:** nur Lese-Tools. **Risiko:** Snapshots, Caches. **Ausweg:** Test als erster Planschritt."}
```

**Exactly one pure text type exists: Formatierter Text.** Seven other types
carry text (Vergleichstabelle, Scorecard, Prozessfluss, Checkliste, Callout,
Zitat, Diff), but each adds a structure the reader can scan. A wording
decision (`decision-modes.md` § 7 · wording) always shows its analysis as
Formatierter Text.

Count: 4 + 4 + 3 + 3 + 4 + 4 + 2 + 4 + 2 + 5 = **35 types** — 6 drawn by a core
id as is, 4 built on a core id with a particular spec, 25 custom; all eight
core ids are used.

## Style rules for custom types

A custom display must look as if the same engine drew it. Every rule is
checkable before the round is built.

1. **Page tokens only.** Colours, font and radii come from the page tokens:
   `--text-color`, `--text-secondary`, `--border-color`, `--panel-bg`,
   `--bg-color`, `--accent-color`. No hex value in a custom drawing — the
   tokens keep dark and light theme right without own rules. Look at both
   themes (the panel's theme toggle) before the round goes out.
2. **At most three data colours plus grey.** The accent (`--accent-color`,
   the light-blue analysis colour), one lighter tint of it, and — only where
   topics are shown — the topic colours. Grey (`--text-secondary`,
   `--border-color`) for everything that is context.
3. **Red, green and orange are reserved for status.** `--success-color`,
   `--warning-color`, `--danger-color` and near shades appear only where a
   value IS a state (Status-Raster, Checkliste, ✓ ◐ ✗). Never for topics,
   series or categories. An analysis figure is never red, even when it is
   bad news — the sentence says it is bad. Topic colours avoid red, green,
   orange and their near shades.
4. **Label instead of legend.** Values and names sit at the element, always
   with a unit. The statement is one sentence above or beside the graphic,
   never a title like "Diagramm 1". Target and threshold lines are dashed in
   `--text-color` with their label ("Budget 8 s"), not coloured.
5. **Size per slot.** Short: ≤ 52 × 16 px, one number beside it. Long: full
   column width (≈ 360 px), 150–220 px high, never full screen, never a
   scroll container — further detail goes into `data-evidence`.
6. **Accessible.** `role="img"` plus an `aria-label` that states the finding
   (the spec's `"text"`). Never colour alone: form, glyph or word
   distinguishes too. Text contrast ≥ 4.5 : 1 in both themes. A hover detail
   is keyboard-reachable and uses the app-styled tooltip (`data-tip`,
   `templates-utilities.md` § App Tooltips), never a bare `title=`.
7. **No script.** Inline SVG or CSS only — no JavaScript, no `<canvas>`, no
   external library. Motion only when it shows a change, and none under
   `prefers-reduced-motion: reduce`. SVG uses `viewBox` and `width: 100%` so
   it scales with the column; no `vh` / `vw`, no `position: fixed`, no `#id`
   selectors (`step1-templates.md` § 1a-ii · Form factors).

## Custom type profile

Every custom display carries a profile (Steckbrief) as an HTML comment
directly above its element, so the next concept can find and reuse it:

```text
<!-- viz-profile: id=hookchain · group=Prozess & Fluss
     Nimm sie, wenn … Schritte nacheinander laufen und einer davon die Wartezeit dominiert.
     Nicht, wenn … die Schritte parallel laufen — dann Rangbalken.
     slots=lang (kurz als Mini-Balken) · rules: 3 Farben ✓ beschriftet ✓ aria-label ✓ 96 px ✓ -->
```

**Promotion is automatic.** When a custom type is used with a profile in a
second concept, Claude adds it to this catalogue in the same change — group
table row, id, both lines, slots, one spec example — without asking again (the
user approved "automatically after two uses"). Before building a new custom
type, search the repo's concepts for `viz-profile:` in the same group: reuse
beats a second drawing of the same thing.
