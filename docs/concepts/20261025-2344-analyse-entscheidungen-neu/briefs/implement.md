# Implement brief — new analysis & decision presentation for auto-concept

Concept: `docs/concepts/20261025-2344-analyse-entscheidungen-neu.html` (source folder next to it; rounds 01–03 hold the approved prototypes — `rounds/03.html` is the target look, read the parts you need, never the built page). Round summaries: `docs/concepts/20261025-2344-analyse-entscheidungen-neu-decisions.json`. Analyses that motivated it: scratchpad `analysis-pages-findings.md`, `decisions-findings.md` (C:/Users/Jerem/AppData/Local/Temp/claude/C--Users-Jerem-IdeaProjects-dotclaude--claude-worktrees-devops-analyse-konzepte-699e5c/2d97a139-4e91-4fe3-b647-d3e474da4977/scratchpad/).

Target code: `plugins/devops/skills/auto-concept/` (SKILL.md, deep-knowledge/templates-*.md engine parts, step1-templates.md, validation-gate*.md), `plugins/devops/scripts/concept-build.js`, `plugins/devops/hooks/lib/concept-gate.js`, tests next to them. Read `plugins/devops/CONVENTIONS.md` and `docs/dev/feature-flags.md` first. This is the plugin source repo; consumers get it via ship.

## Goal
Analysis results + decisions get the same guided, prototype-quality presentation as the design template, in two variants, with a new decision model. The user approved round 3 with "implement".

## Approved scope (all of it is in scope — nothing deferred)

### A. Two variants
1. **Full** (a concept whose content is analysis results + decisions): new analysis/decision mode of the engine (new template or content variant — choose the cleanest engine fit, keep `decision`/`free` back-compatible).
   - Screens: Briefing → per Themenfeld (≤ 3 groups, ≤ 7 decisions each; 3 and 7 are the golden numbers) → one decision per stage → Review → Nächste Runde.
   - Briefing reads top→bottom: Analyse → Potential (prominent, e.g. "≈ 51 M Tokens") → Themenfelder → "Los geht's" CTA that pulses softly until pressed and names the duration; motivational text short and punchy (half the length of round 3). Visual "Striche und Verbindungen" linking why → potential → Themenfelder (user loved it). No sub-header like "was wir gemessen haben", no "Deine drei Themenfelder" heading/naming, no level numbers.
   - Stage layout: decision ≈ 66 % (question incl.), analysis ≈ 33 % right column.
   - Analysis column = three levels stacked: L1 Briefing/overall · L2 Themenfeld · L3 this decision. Titles = exactly the stepper/header names. Accordion: one level long at a time; the current level is long, others short. Choreography (CSS animation, transform/opacity, ease-out, respects prefers-reduced-motion): briefing shows only L1; entering a Themenfeld L1 collapses and L2 slides in from below and expands; entering a decision L1+L2 retract to short, L3 appears and expands short→long. Duration ≈ 1 s the first two times, ≈ 0.3 s afterwards (persist count per page in localStorage, try/catch). Replay button "↻ Übergang".
   - **Kurz** = 1 sentence + KPI or mini graphic (strong lean to mini graphic); no number → "Formatierter Text". **Lang** = one palette display type + 2–4 sentences, never scrolls; evidence ("Belege") opens as popup/overlay. L1 collapses after the briefing, reopenable. L2 short = always the group's result. L3 after deciding stays long and shows the consequence of the choice; undecided → analysis.
   - Sticky stepper at top: segments per Themenfeld with one dot per decision, clickable, tooltips (title + state); done = bold green check + green segment; status (offen/entschieden/Issue) lives only here. No top-right counters ("1 Abweichung"), no "☰ Liste" button — list mode only as a quiet text link.
   - Colours: Themenfeld/topic colours must NOT be red/green/orange (or near shades) — those are reserved for status. Analysis figures are not red; use neutral/light-blue accent per analysis.
   - No "weicht von der Empfehlung ab" info line on a stage.
   - Decision hierarchy: question dominant (largest type), options = big cards (action zone), "Gilt für" as quiet text above the question, one context sentence of background under the question (user: "sehr gut wenn die Texte gut gesteuert sind … ein Satz Hintergrunderklärung"). The ONLY label is the recommendation: ★ badge on the recommended option, reason in its tooltip; that option is highlighted and ALWAYS preselected. No "Tragweite". Clear primary "Weiter" (Enter) bottom right, "Zurück" (⇧+Enter). The 3 answers must be the content answers to exactly that question.
   - Note: ONE note input, directly accessible (inline text field), never a second "✎ Notiz" button and never as an option choice.
   - Timing is never a decision (default implement now); per decision a discreet text link "Als Issue anlegen (ggf. mit Epic)".
   - No "alle wie empfohlen übernehmen" — the user clicks through.
   - Untouched = stage never opened or open < 3 s; opened ≥ 3 s = decided "keep preselection". Review offers "Zum ersten Unberührten".
   - Review: deviations from recommendation first, then issues, then untouched; "Was deine Auswahl bewirkt" = computed impact if calculable, else other summary — always with a chart. No separate submit button in the review: submit stays in the side panel and the FAB menu; the 💬 chat FAB is always present.
   - Next round card incl. a button back to the briefing; "Drei kurze Fragen" that may be ignored and handled later.
   - Hotkeys: every interactive element shows its full hotkey in its tooltip. Enter/⇧+Enter, 1–N choose option (when the block has focus), arrow keys everywhere (user: "Pfeiltasten überall leveragen"), plus the scheme in rounds/03.html.
2. **Lite** (embedded in another concept, e.g. questions during a design/prototype concept): same rules and choreography with L1 + L3 (no group level), one decision at a time with progress dots, ≤ 5 decisions (more → Full), 1–3 keys while focused, arrows.

### B. Decision modes (7), each with a "Wann Claude ihn einsetzt" line for the authoring docs
Einzelwahl (radio cards) · Mehrfachauswahl (checklist) · Ja / Nein / Anders · Schieberegler über einen Balken (value/threshold) · Reihenfolge (sortable) · Prüfen (stimmt / teilweise / stimmt nicht) · Freitext-Wahl (naming/wording with suggestions). Each emits a typed payload value (not include/discard); keep the legacy bi-state working for old pages. Label rules: outcome verbs, no polarity-only labels, no double negation, consequence line per option.

### C. Display palette (≥ 30 types)
Catalogue (as in round 2 `palette` design) grouped by content shape, each type with name + "Nimm sie, wenn …"/"Nicht, wenn …" for Claude; exactly ONE pure text type ("Formatierter Text"). Style rules for custom types (tokens, max colours, labelling, dark/light, a11y, size budget for short/long slots); a custom type joins the catalogue automatically after two uses with a profile. Implement as reusable engine components driven by a small spec (JSON/attributes), at least the types the Full/Lite flows need, with the full catalogue documented in deep-knowledge for authors.

### D. Engine / docs / gate
- Authoring docs (step1-templates.md §1b etc.): when to use Full vs Lite; decision-mode and palette selection guidance; mandatory fields per decision (question as a question, Gilt für, finding it rests on, outcome label + consequence per option, recommendation + why, preselection).
- Gate: fail Full without briefing (what/why/potential); warn quantitative finding without a visual; fail decision without recommendation/preselection; warn > 3 groups or > 7 per group; warn exclusive choice built as N bi-states; warn timing-as-decision.
- Payload/bridge: new decision values must survive bake/freeze/collect (`collectDecisions`, `bake`, frozen rounds) — add tests.
- Independent fixes found in the analysis, in scope: (a) mixed/design-mode pages lose title/subtitle (`concept-build.js` ~557–585); (b) section TOC hides nested decisions and says "Varianten" (`templates-section-nav-2.md`); (c) stale tri-state text in `templates-decision.md`/`step1-templates.md`.
- If the change is alpha-gated per `docs/dev/feature-flags.md`, register the flag and gate all find-points; otherwise ship to all.

## Done
`npm test` and `npm run lint` green; a demo concept built with the new engine (Full + Lite) passes the gate and renders without console errors; qa verifies visually at desktop width; nothing pushed or shipped (shipping is the close-out sheet's job). Report: done items, shortfalls with reasons.
