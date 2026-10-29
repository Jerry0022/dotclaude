# Concept HTML Templates

Index of the concept engine reference: the three templates (decision, design, free; the analysis presentation Full + Lite is a content variant of them, § templates-analysis.md) and the shared systems Claude copies verbatim into every concept page. The reference is split into the parts below. Read in this order, together they form the whole engine.

## Reading order

| # | Part | Lines | Sections |
|---|---|---|---|
| 01 | [templates-common.md](templates-common.md) | 373 | The three templates (overview) · UI Locale |
| 02 | [templates-common-structure.md](templates-common-structure.md) | 626 | Common Structure (all templates) |
| 03 | [templates-panel.md](templates-panel.md) | 585 | Panel Chrome (all templates) — markup and CSS |
| 04 | [templates-panel-chrome-js.md](templates-panel-chrome-js.md) | 368 | Panel Chrome JS (page-level wiring, dock focus/auto-grow) + shared tip/field tokens CSS |
| 05 | [templates-panel-feedback-dock.md](templates-panel-feedback-dock.md) | 576 | Feedback dock (all templates) |
| 06 | [templates-panel-iteration.md](templates-panel-iteration.md) | 45 | Per-Iteration Templates |
| 07 | [templates-decision.md](templates-decision.md) | 443 | Template: decision · Layout — Document rounds (decision / free) · Bi-State Variant Evaluation · Content Variants (within the decision template) |
| 08 | [templates-design.md](templates-design.md) | 294 | Template: design · Rules · Responsive device views · Click-through wiring (`data-screen-link`) · Annotation Layer (optional) |
| 09 | [templates-design-views.md](templates-design-views.md) | 568 | Views (optional) · Variant overview (≥2 designs) |
| 10 | [templates-design-layout.md](templates-design-layout.md) | 479 | Layout — Fullscreen single-screen + Overlay Panel + Feedback Dock |
| 11 | [templates-design-css.md](templates-design-css.md) | 600 | Layout CSS |
| 12 | [templates-design-css-2.md](templates-design-css-2.md) | 378 | Layout CSS (continued) |
| 13 | [templates-design-js.md](templates-design-js.md) | 1377 | Layout JS — single-screen navigation + context-sensitive feedback |
| 14 | [templates-design-wiring.md](templates-design-wiring.md) | 597 | Annotation Layer JS — `wireAnnotationLayer()` · Click-through Handler |
| 15 | [templates-design-screens.md](templates-design-screens.md) | 495 | Screen-pattern markup · Decision schema · collectDecisions (design branch) |
| 16 | [templates-design-overview.md](templates-design-overview.md) | 1710 | Variant overview JS — `wireDesignOverview()` |
| 17 | [templates-design-overview-css.md](templates-design-overview-css.md) | 537 | Variant overview CSS (≥2 designs) |
| 18 | [templates-design-overview-css-2.md](templates-design-overview-css-2.md) | 69 | Variant overview CSS (≥2 designs) (continued) |
| 19 | [templates-design-hotkeys.md](templates-design-hotkeys.md) | 235 | Hotkey overlay, Space and nudges — `wireChromeHotkeys()` |
| 20 | [templates-free.md](templates-free.md) | 257 | Template: free · Layout — Document, freeform body · Mapping block (optional) · Optional bi-state auto-detection · Decision schema · collectDecisions (free branch) |
| 21 | [templates-free-pins.md](templates-free-pins.md) | 492 | Document pins — own notes in decision / free rounds (`wireDocumentPins()`) |
| 22 | [templates-section-nav.md](templates-section-nav.md) | 428 | Shared Systems (all templates) · Section Navigation (Decision Panel as TOC) |
| 23 | [templates-section-nav-2.md](templates-section-nav-2.md) | 500 | Shared Systems (all templates) · Section Navigation (Decision Panel as TOC) (continued) |
| 24 | [templates-panel-state.md](templates-panel-state.md) | 560 | Decision Panel State CSS |
| 25 | [templates-panel-state-2.md](templates-panel-state-2.md) | 577 | Decision Panel State CSS (continued) |
| 26 | [templates-panel-state-3.md](templates-panel-state-3.md) | 332 | Decision Panel State CSS (continued) |
| 27 | [templates-persistence.md](templates-persistence.md) | 599 | State Persistence (localStorage + TTL) |
| 28 | [templates-persistence-2.md](templates-persistence-2.md) | 110 | State Persistence (localStorage + TTL) (continued) |
| 29 | [templates-persistence-comments.md](templates-persistence-comments.md) | 126 | Persist Warning Banner CSS · Comment Slot Injection |
| 30 | [templates-attachments.md](templates-attachments.md) | 214 | Attachments — HTML and CSS |
| 31 | [templates-attachments-js.md](templates-attachments-js.md) | 428 | Attachments — JS |
| 32 | [templates-mapping.md](templates-mapping.md) | 291 | Information Mapping (engine) — Spec to Wiring, CSS |
| 33 | [templates-mapping-js.md](templates-mapping-js.md) | 1323 | Information Mapping (engine) — JS |
| 34 | [templates-submit.md](templates-submit.md) | 341 | collectDecisions (dispatcher) · Two-Button Submit (iterate vs. implement) — HTML and CSS |
| 35 | [templates-submit-js.md](templates-submit-js.md) | 526 | Two-Button Submit — JS |
| 36 | [templates-submit-js-2.md](templates-submit-js-2.md) | 569 | Two-Button Submit — JS (continued) |
| 37 | [templates-submit-js-3.md](templates-submit-js-3.md) | 282 | Two-Button Submit — JS (continued) |
| 38 | [templates-submit-journey.md](templates-submit-journey.md) | 543 | Journey row · Panel State Reset · Submit Progress Steps |
| 39 | [templates-utilities.md](templates-utilities.md) | 268 | App Tooltips · Theme Toggle |
| 40 | [templates-heartbeat.md](templates-heartbeat.md) | 597 | Claude Connection Heartbeat (HTTP Bridge) |
| 41 | [templates-rounds.md](templates-rounds.md) | 447 | Iteration Tabs |
| 42 | [templates-final-report.md](templates-final-report.md) | 499 | Final Report Panel · Design System |
| 43 | [templates-analysis.md](templates-analysis.md) | 293 | Template: analysis (Full + Lite) · Markup contract · Decision modes · Payload · collectModeDecision · Display palette |
| 44 | [templates-analysis-css.md](templates-analysis-css.md) | 341 | Template: analysis — Styling CSS (Full + Lite) |
| 45 | [templates-analysis-js.md](templates-analysis-js.md) | 579 | Template: analysis — Engine UI JS (palette, stages, stepper, choreography) |
| 46 | [templates-analysis-js-2.md](templates-analysis-js-2.md) | 609 | Template: analysis — Engine UI JS (continued) |
| 47 | [templates-stages.md](templates-stages.md) | 195 | Etappen (stages) — contract, panel head name, round row, stepper tabs, next-stage station · CSS |
| 48 | [templates-stages-js.md](templates-stages-js.md) | 468 | Etappen JS |

## Using the parts

- **Generating a page:** `scripts/concept-build.js` copies the engine (`step2-build.md`) — Claude reads a part only for the markup its round authors. The build copies it verbatim from the parts of the plugin running this session: all of them, in the order above (SKILL.md Step 2 § Engine source). A later round may switch template, so a page carries every part’s code, whatever its first round uses.
- **Looking up a section:** a reference like `templates.md § Section Navigation` means that section in the part that lists it above; a section that spans several rows (its markup and CSS, then its JS) continues in the rows right below it. References written before the split name `templates.md`; newer ones name the part directly.
- **Editing:** change the part and keep its first two lines, the part header. Tests, the concept gate’s drift checks and `scripts/build-concept-fixture.js` read the joined text through `skills/auto-concept/templates-source.js`. It follows this table’s order, so a new part is listed here and nowhere else.
