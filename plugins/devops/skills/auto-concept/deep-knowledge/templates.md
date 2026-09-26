# Concept HTML Templates

Index of the concept engine reference: the three templates (decision, design, free) and the shared systems Claude copies verbatim into every concept page. The reference is split into the parts below. Read in this order, together they form the whole engine.

## Reading order

| # | Part | Lines | Sections |
|---|---|---|---|
| 01 | [templates-common.md](templates-common.md) | 907 | The three templates (overview) · UI Locale · Common Structure (all templates) |
| 02 | [templates-panel.md](templates-panel.md) | 927 | Panel Chrome (all templates) · Per-Iteration Templates |
| 03 | [templates-decision.md](templates-decision.md) | 404 | Template: decision · Layout — Document rounds (decision / free) · Bi-State Variant Evaluation · Content Variants (within the decision template) |
| 04 | [templates-design.md](templates-design.md) | 1137 | Template: design · Rules · Responsive device views · Click-through wiring (`data-screen-link`) · Annotation Layer (optional) · Views (optional) · Layout — Fullscreen single-screen + Overlay Panel + Feedback Dock |
| 05 | [templates-design-css.md](templates-design-css.md) | 893 | Layout CSS |
| 06 | [templates-design-js.md](templates-design-js.md) | 1233 | Layout JS — single-screen navigation + context-sensitive feedback |
| 07 | [templates-design-wiring.md](templates-design-wiring.md) | 755 | Annotation Layer JS — `wireAnnotationLayer()` · Click-through Handler · Screen-pattern markup · Decision schema · collectDecisions (design branch) |
| 08 | [templates-free.md](templates-free.md) | 231 | Template: free · Layout — Document, freeform body · Mapping block (optional) · Optional bi-state auto-detection · Decision schema · collectDecisions (free branch) |
| 09 | [templates-section-nav.md](templates-section-nav.md) | 918 | Shared Systems (all templates) · Section Navigation (Decision Panel as TOC) |
| 10 | [templates-panel-state.md](templates-panel-state.md) | 1142 | Decision Panel State CSS |
| 11 | [templates-persistence.md](templates-persistence.md) | 791 | State Persistence (localStorage + TTL) · Comment Slot Injection |
| 12 | [templates-attachments.md](templates-attachments.md) | 638 | Attachments |
| 13 | [templates-mapping.md](templates-mapping.md) | 1610 | Information Mapping (engine) |
| 14 | [templates-submit.md](templates-submit.md) | 1809 | collectDecisions (dispatcher) · Two-Button Submit (iterate vs. implement) · Panel State Reset · Submit Progress Steps |
| 15 | [templates-utilities.md](templates-utilities.md) | 680 | App Tooltips · Theme Toggle · Claude Connection Heartbeat (HTTP Bridge) |
| 16 | [templates-rounds.md](templates-rounds.md) | 899 | Iteration Tabs · Final Report Panel · Design System |

## Using the parts

- **Generating a page:** copy the engine verbatim from the parts of the plugin running this session: all of them, in the order above (SKILL.md Step 2 § Engine source). A later round may switch template, so a page carries every part’s code, whatever its first round uses.
- **Looking up a section:** a reference like `templates.md § Section Navigation` means that section in the part that lists it above. References written before the split name `templates.md`; newer ones name the part directly.
- **Editing:** change the part and keep its first two lines, the part header. Tests, the concept gate’s drift checks and `scripts/build-concept-fixture.js` read the joined text through `skills/auto-concept/templates-source.js`. It follows this table’s order, so a new part is listed here and nowhere else.
