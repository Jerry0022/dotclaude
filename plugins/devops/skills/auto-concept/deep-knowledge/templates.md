# Concept HTML Templates

Index of the concept engine reference: the three templates (decision, design, free) and the shared systems Claude copies verbatim into every concept page. The reference is split into the parts below. Read in this order, together they form the whole engine.

## Reading order

| # | Part | Lines | Sections |
|---|---|---|---|
| 01 | [templates-common.md](templates-common.md) | 948 | The three templates (overview) · UI Locale · Common Structure (all templates) |
| 02 | [templates-panel.md](templates-panel.md) | 1009 | Panel Chrome (all templates) · Per-Iteration Templates |
| 03 | [templates-decision.md](templates-decision.md) | 443 | Template: decision · Layout — Document rounds (decision / free) · Bi-State Variant Evaluation · Content Variants (within the decision template) |
| 04 | [templates-design.md](templates-design.md) | 1247 | Template: design · Rules · Responsive device views · Click-through wiring (`data-screen-link`) · Annotation Layer (optional) · Views (optional) · Layout — Fullscreen single-screen + Overlay Panel + Feedback Dock |
| 05 | [templates-design-css.md](templates-design-css.md) | 940 | Layout CSS |
| 06 | [templates-design-js.md](templates-design-js.md) | 1345 | Layout JS — single-screen navigation + context-sensitive feedback |
| 07 | [templates-design-wiring.md](templates-design-wiring.md) | 951 | Annotation Layer JS — `wireAnnotationLayer()` · Click-through Handler · Screen-pattern markup · Decision schema · collectDecisions (design branch) |
| 08 | [templates-design-overview.md](templates-design-overview.md) | 1230 | Variant overview JS — `wireDesignOverview()` · Variant overview CSS (≥2 designs) |
| 09 | [templates-free.md](templates-free.md) | 233 | Template: free · Layout — Document, freeform body · Mapping block (optional) · Optional bi-state auto-detection · Decision schema · collectDecisions (free branch) |
| 10 | [templates-section-nav.md](templates-section-nav.md) | 924 | Shared Systems (all templates) · Section Navigation (Decision Panel as TOC) |
| 11 | [templates-panel-state.md](templates-panel-state.md) | 1144 | Decision Panel State CSS |
| 12 | [templates-persistence.md](templates-persistence.md) | 808 | State Persistence (localStorage + TTL) · Comment Slot Injection |
| 13 | [templates-attachments.md](templates-attachments.md) | 640 | Attachments |
| 14 | [templates-mapping.md](templates-mapping.md) | 1612 | Information Mapping (engine) |
| 15 | [templates-submit.md](templates-submit.md) | 1908 | collectDecisions (dispatcher) · Two-Button Submit (iterate vs. implement) · Panel State Reset · Submit Progress Steps |
| 16 | [templates-utilities.md](templates-utilities.md) | 708 | App Tooltips · Theme Toggle · Claude Connection Heartbeat (HTTP Bridge) |
| 17 | [templates-rounds.md](templates-rounds.md) | 920 | Iteration Tabs · Final Report Panel · Design System |

## Using the parts

- **Generating a page:** `scripts/concept-build.js` copies the engine (`step2-build.md`) — Claude reads a part only for the markup its round authors. The build copies it verbatim from the parts of the plugin running this session: all of them, in the order above (SKILL.md Step 2 § Engine source). A later round may switch template, so a page carries every part’s code, whatever its first round uses.
- **Looking up a section:** a reference like `templates.md § Section Navigation` means that section in the part that lists it above. References written before the split name `templates.md`; newer ones name the part directly.
- **Editing:** change the part and keep its first two lines, the part header. Tests, the concept gate’s drift checks and `scripts/build-concept-fixture.js` read the joined text through `skills/auto-concept/templates-source.js`. It follows this table’s order, so a new part is listed here and nowhere else.
