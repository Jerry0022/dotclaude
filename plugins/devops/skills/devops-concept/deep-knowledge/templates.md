# Concept HTML Templates

**These are recommendations, not mandatory structures.** Claude should adapt
layout, elements, and design to fit the specific content. Use these as
starting points and inspiration — deviate freely when the content calls for it.

## Common Structure (all variants)

```html
<!DOCTYPE html>
<html lang="de" data-theme="dark" data-page-version="{generation-timestamp}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Concept — {title}</title>
  <style>/* all CSS inline */</style>
</head>
<body>
  <div class="concept-layout">
    <!-- Main content: ~80% width -->
    <div class="concept-content">
      <header>
        <h1>{title}</h1>
        <p class="subtitle">{context line}</p>
        <button id="theme-toggle" aria-label="Toggle theme">🌙/☀️</button>
      </header>

      <!-- Iteration tabs — one entry per iteration, active = current round.
           Older tabs are clickable but show a frozen snapshot. Anchored here
           above <main> so the tab bar lives in the decision panel header
           without crowding the variant content. -->
      <nav class="iteration-tabs" role="tablist" aria-label="Iterationen">
        <!-- Auto-populated, one tab per <section data-iteration="N">:
        <button class="iteration-tab" role="tab" data-iteration="1" aria-selected="false">Iteration 1</button>
        <button class="iteration-tab" role="tab" data-iteration="2" aria-selected="true">Iteration 2</button>
        -->
      </nav>

      <main>
        <!-- One <section data-iteration="N"> per iteration. Exactly one has
             data-active. All others render their controls disabled/readonly
             and preserve the values the user submitted that round. -->
        <!--
        <section data-iteration="1" hidden>...frozen first round...</section>
        <section data-iteration="2" data-active>...current round (active)...</section>
        -->
      </main>
    </div>

    <!-- Decision panel: ~20% width, fixed sidebar, NOT overlay -->
    <aside class="concept-decision-panel">
      <h3>Entscheidungen</h3>

      <!-- Variant Navigation / TOC — each entry is an anchor link -->
      <nav class="variant-nav" id="variant-nav">
        <!-- Auto-populated: one entry per variant. Example: -->
        <!--
        <a href="#variant-a" class="variant-nav-item" data-variant="variant-a">
          <span class="variant-nav-label">A Orbital Ring</span>
          <span class="variant-nav-state">Miteinbeziehen</span>
        </a>
        <a href="#variant-b" class="variant-nav-item" data-variant="variant-b">
          <span class="variant-nav-label">B Hexagonal</span>
          <span class="variant-nav-state">Miteinbeziehen</span>
        </a>
        -->
      </nav>

      <!-- Connection warning — shown when Claude heartbeat is stale -->
      <div id="connection-warning" class="panel-warning" style="display: none;">
        <span class="warning-icon">⚠</span>
        <span>Claude ist nicht verbunden. Stelle sicher, dass die Claude-Extension aktiv ist.</span>
      </div>

      <!-- Normal state: decision summary + submit -->
      <div id="panel-ready">
        <div id="decision-summary">
          <!-- Auto-populated summary of current selections -->
        </div>
        <button id="submit-btn" class="primary">Entscheidungen abschicken</button>
        <p class="hint">Deine Auswahl wird direkt an Claude übermittelt.</p>
      </div>

      <!-- Post-submit state: waiting for Claude -->
      <div id="panel-submitted" style="display: none;">
        <div class="submitted-indicator">
          <span class="check-icon">✓</span>
          <strong>Entscheidungen übermittelt</strong>
        </div>
        <p class="submitted-hint">Claude verarbeitet deine Auswahl. Wechsle zum <strong>Claude Chat</strong> um den Fortschritt zu sehen.</p>
        <div class="waiting-animation"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
      </div>
    </aside>
  </div>

  <script type="application/json" id="concept-decisions">
    {"submitted": false, "decisions": [], "comments": []}
  </script>
  <script>/* all JS inline */</script>
</body>
</html>
```

### Layout Modes

#### Sidebar (default)

Content left (~80%), decision panel right (~20%). Best for most concepts.

```css
.concept-layout {
  display: flex;
  min-height: 100vh;
}
.concept-content {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
}
.concept-decision-panel {
  width: 20%;
  min-width: 240px;
  max-width: 360px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  padding: 1.5rem;
  border-left: 1px solid var(--border-color);
  background: var(--panel-bg);
}
/* Mobile: collapse to sticky bottom */
@media (max-width: 768px) {
  .concept-layout { flex-direction: column; }
  .concept-decision-panel {
    width: 100%;
    max-width: none;
    height: auto;
    position: sticky;
    bottom: 0;
    border-left: none;
    border-top: 1px solid var(--border-color);
  }
}
```

#### Fullscreen + Overlay

Content fills 100% of the viewport. Decision panel slides in from the right
via a floating action button. Best for visual prototypes, mockups, previews,
or any content that needs maximum display area.

```html
<div class="concept-layout fullscreen">
  <div class="concept-content">
    <!-- Full-width content: mockups, previews, diagrams -->
  </div>

  <!-- Floating toggle button -->
  <button id="panel-toggle" class="panel-fab" aria-label="Entscheidungen öffnen">
    <span class="fab-icon">☰</span>
  </button>

  <!-- Slide-in overlay panel -->
  <aside class="concept-decision-panel overlay" id="decision-panel">
    <button id="panel-close" class="panel-close-btn" aria-label="Schliessen">✕</button>
    <h3>Entscheidungen</h3>
    <nav class="variant-nav" id="variant-nav"><!-- ... --></nav>
    <!-- rest of panel content -->
  </aside>
  <div class="panel-backdrop" id="panel-backdrop"></div>
</div>
```

```css
.concept-layout.fullscreen .concept-content {
  width: 100%;
  padding: 2rem;
}
.concept-layout.fullscreen .concept-decision-panel {
  display: none;  /* hidden by default */
}

/* Floating action button */
.panel-fab {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: var(--accent-color, #58a6ff);
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 100;
  transition: transform 0.2s, opacity 0.2s;
}
.panel-fab:hover { transform: scale(1.1); }
.panel-fab.hidden { opacity: 0; pointer-events: none; }

/* Slide-in panel overlay */
.concept-decision-panel.overlay {
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  right: -400px;
  width: 360px;
  max-width: 90vw;
  height: 100vh;
  padding: 1.5rem;
  background: var(--panel-bg, #161b22);
  border-left: 1px solid var(--border-color, #30363d);
  z-index: 200;
  overflow-y: auto;
  transition: right 0.3s ease;
}
.concept-decision-panel.overlay.open {
  right: 0;
}
.panel-close-btn {
  align-self: flex-end;
  background: none;
  border: none;
  color: var(--text-color, #c9d1d9);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.25rem;
}

/* Backdrop */
.panel-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 150;
}
.panel-backdrop.visible {
  display: block;
}
```

```javascript
// --- Fullscreen Overlay Panel ---
const panelToggle = document.getElementById('panel-toggle');
const panelClose = document.getElementById('panel-close');
const panel = document.getElementById('decision-panel');
const backdrop = document.getElementById('panel-backdrop');

function openPanel() {
  panel.classList.add('open');
  backdrop.classList.add('visible');
  panelToggle.classList.add('hidden');
}
function closePanel() {
  panel.classList.remove('open');
  backdrop.classList.remove('visible');
  panelToggle.classList.remove('hidden');
}

if (panelToggle) panelToggle.addEventListener('click', openPanel);
if (panelClose) panelClose.addEventListener('click', closePanel);
if (backdrop) backdrop.addEventListener('click', closePanel);

// Close panel on variant nav click (scroll to section)
document.querySelectorAll('.variant-nav-item').forEach(link => {
  link.addEventListener('click', () => {
    closePanel();
    // small delay so panel closes before scroll
    setTimeout(() => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  });
});
```

### Variant Navigation CSS (Decision Panel as TOC)

The decision panel doubles as a table-of-contents. Each variant gets a
clickable nav entry that scrolls to it and shows the current evaluation state.

```css
.variant-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 1rem;
}
.variant-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  text-decoration: none;
  color: var(--text-color, #c9d1d9);
  font-size: 0.9rem;
  transition: background 0.15s;
  cursor: pointer;
}
.variant-nav-item:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}
.variant-nav-state {
  font-size: 0.8rem;
  color: var(--accent-color, #58a6ff);
  white-space: nowrap;
}
.variant-nav-state.state-discard { color: var(--danger-color, #f85149); }
.variant-nav-state.state-only { color: var(--success-color, #3fb950); }
```

**Variant sections need matching `id` attributes:**
```html
<section id="variant-a" class="variant-card">...</section>
<section id="variant-b" class="variant-card">...</section>
```

### Decision Panel State CSS

```css
/* Connection warning */
.panel-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 1rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--warning-color, #d29922) 15%, transparent);
  border: 1px solid var(--warning-color, #d29922);
  font-size: 0.85rem;
  line-height: 1.4;
}
.panel-warning .warning-icon { font-size: 1.1rem; flex-shrink: 0; }

/* Submitted state */
.submitted-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  margin-bottom: 0.75rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
  border: 1px solid var(--success-color, #3fb950);
}
.submitted-indicator .check-icon {
  font-size: 1.3rem;
  color: var(--success-color, #3fb950);
}
.submitted-hint {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

/* Waiting dots animation */
.waiting-animation {
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 0.5rem 0;
}
.waiting-animation .dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--accent-color, #58a6ff);
  animation: pulse 1.4s ease-in-out infinite;
}
.waiting-animation .dot:nth-child(2) { animation-delay: 0.2s; }
.waiting-animation .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

/* Disabled submit button when disconnected */
#submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

## Design System

### Colors
- Dark mode: `#0d1117` background, `#c9d1d9` text, `#58a6ff` accent
- Light mode: `#ffffff` background, `#24292f` text, `#0969da` accent
- Success: `#3fb950` / `#1a7f37`
- Warning: `#d29922` / `#9a6700`
- Danger: `#f85149` / `#cf222e`

### Typography
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Headings: 600 weight, tight letter-spacing
- Body: 400 weight, 1.6 line-height
- Code: `'Cascadia Code', 'Fira Code', monospace`

### Spacing
- Section gap: `2rem`
- Card padding: `1.5rem`
- Element gap: `0.75rem`

### Interactive Elements
- Toggle switches: 44px wide, smooth transition, clear on/off state
- Checkboxes: custom styled, visible check mark
- Comment fields: `width: 100%` within their container, `min-height: 80px`,
  auto-expanding textarea, subtle border, placeholder text. Never narrow —
  users must be able to type comfortably
- Text inputs: `width: 100%` within container, generous padding (`0.75rem`)
- Submit button: in decision panel sidebar, full-width within panel
- Sliders: labeled endpoints, current value display, full container width

## Variant: analysis

**Purpose:** Present findings from a data analysis with accept/reject controls.

**Structure:**
```
[Header: Analysis title + date]
[Summary card: key metrics / TL;DR]

[Finding 1]
  ├── Description + evidence
  ├── [Toggle: Akzeptieren / Ablehnen]
  ├── [Priority: Hoch / Mittel / Niedrig]
  └── [Comment field: "Anmerkung..."]

[Finding 2]
  └── ...

[Submit button]
```

**Decision schema:**
```json
{
  "decisions": [
    { "id": "finding-1", "label": "...", "accepted": true, "priority": "high" }
  ],
  "comments": [
    { "id": "finding-1", "text": "..." }
  ]
}
```

## Variant: plan

**Purpose:** Present an implementation plan with step approval controls.

**Structure:**
```
[Header: Plan title]
[Overview card: goal, scope, timeline]

[Phase 1: Name]
  [Step 1.1]
    ├── Description + rationale
    ├── [Checkbox: Einschliessen]
    ├── [Effort indicator: S / M / L / XL]
    └── [Comment field]

  [Step 1.2]
    └── ...

[Phase 2: Name]
  └── ...

[Submit button]
```

**Decision schema:**
```json
{
  "decisions": [
    { "id": "step-1-1", "label": "...", "included": true, "effort": "M" }
  ]
}
```

## Variant: concept

**Purpose:** Present architecture or design variants for evaluation.

**Structure:**
```
[Header: Concept title]
[Context card: problem statement]

[Variant A: Name]
  ├── Description + diagram/illustration
  ├── Pro/Con list
  ├── [Tri-state: Verwerfen / Miteinbeziehen (default) / Nur diese]
  ├── [Rating: 1-5 stars or slider]
  └── [Comment field (wide, min-height: 80px)]

[Variant B: Name]
  └── ...

[Decision panel sidebar: summary + submit]
```

### Tri-State Variant Evaluation

Every variant MUST include a tri-state selector:

```html
<div class="variant-evaluation" data-decision="variant-a" data-label="Variant A">
  <div class="tri-state-group">
    <label class="tri-state-option">
      <input type="radio" name="eval-variant-a" value="discard">
      <span class="tri-state-label">Verwerfen</span>
      <span class="tri-state-hint feedback">Feedback</span>
    </label>
    <label class="tri-state-option">
      <input type="radio" name="eval-variant-a" value="include" checked>
      <span class="tri-state-label">Miteinbeziehen</span>
      <span class="tri-state-hint feedback">Feedback</span>
    </label>
    <label class="tri-state-option">
      <input type="radio" name="eval-variant-a" value="only">
      <span class="tri-state-label">Exakt diese</span>
      <span class="tri-state-hint action">Claude setzt um</span>
    </label>
  </div>
</div>
```

```css
.tri-state-group {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  overflow: hidden;
}
.tri-state-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  text-align: center;
  position: relative;
  border-right: 1px solid var(--border-color, #30363d);
  transition: background 0.2s, box-shadow 0.2s;
}
.tri-state-option:last-child { border-right: none; }

/* Unselected hover — shows "you can click me" */
.tri-state-option:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}

.tri-state-option input { display: none; }

/* Selected label — bold + color */
.tri-state-option:has(input:checked) .tri-state-label {
  font-weight: 700;
}

/* Hint always visible but faded; full opacity when selected */
.tri-state-hint {
  font-size: 0.75rem;
  margin-top: 0.25rem;
  opacity: 0.5;
  transition: opacity 0.2s;
}
.tri-state-option:has(input:checked) .tri-state-hint { opacity: 1; }
.tri-state-hint.feedback { color: var(--accent-color, #58a6ff); }
.tri-state-hint.action { color: var(--warning-color, #d29922); }

.tri-state-label { font-size: 0.9rem; transition: font-weight 0.15s; }

/* Checkmark badge on the selected option */
.tri-state-option:has(input:checked)::after {
  content: '✓';
  position: absolute;
  top: 4px;
  right: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  pointer-events: none;
}

/* ── Active state backgrounds + ring + checkmark colors ── */

/* Miteinbeziehen (default, info) */
.tri-state-option:has(input[value="include"]:checked) {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent);
  box-shadow: inset 0 0 0 2px var(--accent-color, #58a6ff);
}
.tri-state-option:has(input[value="include"]:checked)::after {
  background: var(--accent-color, #58a6ff);
  color: white;
}

/* Verwerfen (discard, muted) */
.tri-state-option:has(input[value="discard"]:checked) {
  background: color-mix(in srgb, var(--danger-color, #f85149) 12%, transparent);
  box-shadow: inset 0 0 0 2px var(--danger-color, #f85149);
}
.tri-state-option:has(input[value="discard"]:checked)::after {
  background: var(--danger-color, #f85149);
  color: white;
}
.tri-state-option:has(input[value="discard"]:checked) .tri-state-label {
  color: var(--danger-color, #f85149);
}

/* Exakt diese (only, success/action) */
.tri-state-option:has(input[value="only"]:checked) {
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
  box-shadow: inset 0 0 0 2px var(--success-color, #3fb950);
}
.tri-state-option:has(input[value="only"]:checked)::after {
  background: var(--success-color, #3fb950);
  color: white;
}
.tri-state-option:has(input[value="only"]:checked) .tri-state-label {
  color: var(--success-color, #3fb950);
}

/* ── Unselected state — clearly "not chosen" ── */
.tri-state-option:has(input:not(:checked)) {
  opacity: 0.7;
}
.tri-state-option:has(input:not(:checked)):hover {
  opacity: 1;
}
```

**Indicator rules (strict):**
- **Verwerfen** and **Miteinbeziehen**: show "(Feedback)" — passive input
- **Exakt diese** only: show "Claude setzt um" — this is the only option
  that triggers direct action (proceed with this variant, discard all others)

**Behavior:**
- Default: "Miteinbeziehen" (all variants considered)
- "Exakt diese": auto-sets ALL other variants to "Verwerfen",
  shows visual feedback + undo button per auto-changed variant
- "Verwerfen": grays out the variant card visually (but keeps it accessible)

**Decision schema:**
```json
{
  "decisions": [
    { "id": "variant-a", "label": "...", "evaluation": "include", "rating": 4 },
    { "id": "variant-b", "label": "...", "evaluation": "discard", "rating": 2 },
    { "id": "variant-c", "label": "...", "evaluation": "only", "rating": 5 }
  ]
}
```

**evaluation values:** `"discard"` | `"include"` | `"only"`

## Variant: comparison

**Purpose:** Side-by-side comparison of options with winner selection.

**Structure:**
```
[Header: Comparison title]

[Criteria table / matrix]
  ├── Row per criterion
  ├── Column per option
  ├── [Weight slider per criterion]
  └── Auto-calculated weighted scores

[Per-option detail cards]
  ├── Strengths
  ├── Weaknesses
  ├── [Tri-state: Verwerfen / Miteinbeziehen (default) / Nur diese]
  └── [Comment field (wide)]

[Decision panel sidebar: summary + submit]
```

Each option in the comparison gets the same **tri-state evaluation** as
concept variants (see above): Verwerfen / Miteinbeziehen / Exakt diese.

**Decision schema:**
```json
{
  "decisions": [
    { "id": "option-a", "label": "...", "evaluation": "include" },
    { "id": "option-b", "label": "...", "evaluation": "only" },
    { "id": "weight-performance", "value": 0.8 },
    { "id": "weight-cost", "value": 0.4 }
  ]
}
```

## Variant: prototype

**Purpose:** Interactive UI mockup or flow prototype.

**Structure:**
- Variant-specific — depends on what's being prototyped
- Must include navigation between screens/states
- Clickable elements should log interactions
- Include a floating feedback button on each screen

**Decision schema:**
```json
{
  "decisions": [
    { "id": "screen-1-approve", "approved": true },
    { "id": "flow-alternative", "selected": "option-a" }
  ],
  "comments": [
    { "id": "screen-2", "text": "Button placement too low" }
  ]
}
```

## Variant: dashboard

**Purpose:** Status overview or metric dashboard with filters.

**Structure:**
```
[Header + date range]
[KPI cards row: 3-5 key metrics]

[Filter bar: toggles for categories/segments]

[Expandable sections]
  ├── Section title + summary stat
  ├── Expanded: detail table or chart
  └── [Comment field per section]

[Action items section]
  ├── [Checkbox per item]
  └── [Comment field]

[Submit button]
```

## Variant: creative

**Purpose:** Brainstorming, ideation, collecting ideas.

**Structure:**
```
[Header: Topic]
[Context / constraints]

[Idea cards grid]
  ├── Idea title + description
  ├── [Vote: thumbs up/down]
  ├── [Tag selector: category]
  └── [Comment field]

[Add new idea button → inline form]
[Submit button]
```

## JavaScript Patterns

### State Persistence

Interactive element state MUST survive page reloads AND accidental tab closes
via `localStorage` with a time-to-live (TTL). This prevents the user from
losing selections, comments, and ratings.

**Storage key:** `concept-state-{slug}` (derived from the page's filename slug)
**TTL:** 24 hours — auto-clears stale state from previous days

```javascript
// --- State Persistence (localStorage + TTL) ---
const STORAGE_KEY = 'concept-state-' + location.pathname.split('/').pop().replace('.html', '');
const STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function saveState() {
  const state = {
    _savedAt: Date.now(),
    _pageVersion: document.documentElement.dataset.pageVersion || ''
  };
  // Save toggles, checkboxes, radios
  document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
    if (el.name || el.id) state['input:' + (el.name || el.id) + ':' + el.value] = el.checked;
  });
  // Save text inputs, textareas
  document.querySelectorAll('textarea, input[type="text"], input[type="number"]').forEach(el => {
    if (el.id || el.dataset.comment) state['text:' + (el.id || el.dataset.comment)] = el.value;
  });
  // Save sliders
  document.querySelectorAll('input[type="range"]').forEach(el => {
    if (el.id || el.name) state['range:' + (el.id || el.name)] = el.value;
  });
  // Save select elements
  document.querySelectorAll('select').forEach(el => {
    if (el.id || el.name) state['select:' + (el.id || el.name)] = el.value;
  });
  // Save theme preference
  state['theme'] = document.documentElement.getAttribute('data-theme');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    // TTL check — discard state older than 24 hours
    if (state._savedAt && (Date.now() - state._savedAt) > STATE_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    // Version check — discard state from a different page version
    // (Claude sets data-page-version on <html> when generating the page;
    // iteration appends keep the same value so frozen-tab state survives;
    // only a fresh concept session for the same slug bumps the value)
    const currentVersion = document.documentElement.dataset.pageVersion || '';
    if (state._pageVersion && state._pageVersion !== currentVersion) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    // Restore theme first (prevents flash)
    if (state.theme) document.documentElement.setAttribute('data-theme', state.theme);
    // Restore inputs
    Object.entries(state).forEach(([key, value]) => {
      if (key.startsWith('_')) return; // skip metadata keys
      const [type, ...rest] = key.split(':');
      if (type === 'input') {
        const [name, val] = [rest.slice(0, -1).join(':'), rest[rest.length - 1]];
        const el = document.querySelector(`input[name="${name}"][value="${val}"], input[id="${name}"][value="${val}"]`);
        if (el) el.checked = value;
      } else if (type === 'text') {
        const id = rest.join(':');
        // data-comment first — getElementById can collide with section IDs
        const el = document.querySelector(`[data-comment="${id}"]`) || document.querySelector(`textarea#${CSS.escape(id)}, input#${CSS.escape(id)}`);
        if (el) el.value = value;
      } else if (type === 'range') {
        const id = rest.join(':');
        const el = document.getElementById(id) || document.querySelector(`input[name="${id}"]`);
        if (el) { el.value = value; el.dispatchEvent(new Event('input')); }
      } else if (type === 'select') {
        const id = rest.join(':');
        const el = document.getElementById(id) || document.querySelector(`select[name="${id}"]`);
        if (el) el.value = value;
      }
    });
  } catch (e) { /* corrupt storage — ignore, user starts fresh */ }
}

// Restore on load, save on every interaction
document.addEventListener('DOMContentLoaded', restoreState);
document.addEventListener('change', saveState);
document.addEventListener('input', saveState);
```

**Rules:**
- Use `localStorage` with a 24-hour TTL — survives tab close, browser restart,
  and accidental reloads. Stale state auto-clears after 24h so old concept
  sessions don't pollute new ones
- Save on every `change` and `input` event — not just on submit
- Restore runs on `DOMContentLoaded` — before the user sees the page
- The `concept-submitted` class is deliberately NOT persisted — after a reload
  the page is back to "not yet submitted" (correct behavior)
- Theme preference IS persisted — prevents dark/light flash on reload

### Collect Decisions
```javascript
function collectDecisions() {
  const decisions = [];
  const comments = [];

  document.querySelectorAll('[data-decision]').forEach(el => {
    decisions.push({
      id: el.dataset.decision,
      label: el.dataset.label || '',
      ...getElementState(el)
    });
  });

  document.querySelectorAll('[data-comment]').forEach(el => {
    if (el.value.trim()) {
      comments.push({
        id: el.dataset.comment,
        text: el.value.trim()
      });
    }
  });

  return { submitted: true, decisions, comments };
}
```

### Variant Navigation JS

Smooth-scrolls to the variant section and keeps the evaluation state label
in sync with the tri-state radio selection.

```javascript
// --- Variant Navigation (Decision Panel as TOC) ---
function updateVariantNav() {
  document.querySelectorAll('.variant-nav-item').forEach(link => {
    const variantId = link.dataset.variant;
    const checked = document.querySelector(`input[name="eval-${variantId}"]:checked`);
    const currentState = checked ? checked.value : 'include';
    const stateEl = link.querySelector('.variant-nav-state');
    if (stateEl) {
      const labels = { include: 'Miteinbeziehen', discard: 'Verwerfen', only: 'Exakt diese' };
      stateEl.textContent = labels[currentState] || currentState;
      stateEl.className = 'variant-nav-state state-' + currentState;
    }
  });
}

// Smooth scroll on nav click
document.querySelectorAll('.variant-nav-item').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// Keep nav state in sync
document.addEventListener('change', updateVariantNav);
document.addEventListener('DOMContentLoaded', updateVariantNav);
```

**Important:** The `data-variant` attribute on each nav item must match the
radio button name pattern `eval-{variant-id}`. The variant section must have
the matching `id` attribute for the anchor link to work.

### Submit Handler
```javascript
// Timestamp of the most recent submit click. Compared against the server's
// `_processed_at` in the heartbeat poll to detect "Claude finished processing"
// and auto-restore the ready panel without a JS eval round-trip.
let _submittedAt = 0;

document.getElementById('submit-btn').addEventListener('click', async () => {
  const data = collectDecisions();
  const container = document.getElementById('concept-decisions');
  container.textContent = JSON.stringify(data);
  document.body.classList.add('concept-submitted');
  _submittedAt = Date.now();

  // Switch panel to "submitted" state immediately (optimistic UI)
  document.getElementById('panel-ready').style.display = 'none';
  document.getElementById('panel-submitted').style.display = 'block';

  // POST decisions to bridge server — Claude reads via GET /decisions
  try {
    await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (e) {
    // Bridge server unreachable — cache decisions for retry
    localStorage.setItem(STORAGE_KEY + '-pending', JSON.stringify(data));
  }

  saveState();
});

// --- Offline Submit Queue ---
// If the user submitted while disconnected, retry delivery when the bridge
// server comes back. Checked after each successful heartbeat poll.
async function retryPendingSubmission() {
  const pendingKey = STORAGE_KEY + '-pending';
  const pending = localStorage.getItem(pendingKey);
  if (!pending) return;
  try {
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: pending
    });
    if (res.ok) localStorage.removeItem(pendingKey);
  } catch (e) { /* still offline — will retry next heartbeat cycle */ }
}
```

### Panel State Reset

When Claude finishes processing, it calls `POST /reset` on the bridge server.
The server stamps `_processed_at` with the current time. The page's heartbeat
poll (see § Claude Connection Heartbeat) reads that timestamp on the next
tick and — if it's newer than `_submittedAt` — runs `restorePanelToReady()`
locally. No browser eval injection from Claude needed; the page self-heals.

```javascript
// Called by the heartbeat poll when the server's processed_at has advanced
// past our last submit. Also safe to call manually for legacy eval paths.
function restorePanelToReady() {
  document.getElementById('panel-submitted').style.display = 'none';
  document.getElementById('panel-ready').style.display = 'block';
  const btn = document.getElementById('submit-btn');
  btn.disabled = false;
  btn.textContent = 'Entscheidungen abschicken';
  document.body.classList.remove('concept-submitted');
  _submittedAt = 0;
  // Clear cached decisions so reload doesn't resurrect stale selections
  const slug = location.pathname.split('/').pop().replace('.html', '');
  localStorage.removeItem('concept-state-' + slug);
}
```

This is the visual cycle:
```
[Ready: button active] → User clicks Submit → [Submitted: waiting indicator]
    → Claude processes → POST /reset → heartbeat poll sees processed_at >
    submittedAt → restorePanelToReady() → [Ready: button active, new round]
```

### Theme Toggle
```javascript
document.getElementById('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
});
```

### Claude Connection Heartbeat (HTTP Bridge)

The heartbeat uses the **HTTP Bridge** — the concept bridge server
(`scripts/concept-server.py`) exposes `/heartbeat` endpoints that both Claude
and the page communicate through.

**How it works:**
- Claude sends `curl -s -X POST localhost:{port}/heartbeat` every 60 seconds
  (via CronCreate) plus on each monitoring poll cycle (~15s when active)
- The page polls `GET /heartbeat` every 5 seconds via `fetch()`
- If the heartbeat is older than 90 seconds → the submit button is disabled
  and a warning is shown (90s threshold safely covers the 60s cron interval
  with buffer for timing jitter)
- If the heartbeat is fresh → submit is enabled, warning hidden

```javascript
// --- Claude Connection Heartbeat (HTTP Bridge) ---
const HEARTBEAT_STALE_MS = 90000; // 90s — safely covers 60s cron interval + buffer
const HEARTBEAT_GRACE_MS = 30000; // 30s — Claude needs time to start bridge + cron
const _pageLoadedAt = Date.now();
let _lastHeartbeatTs = 0;

async function pollHeartbeat() {
  try {
    const res = await fetch('/heartbeat', { cache: 'no-store' });
    const data = await res.json();
    _lastHeartbeatTs = data.ts || 0;
  } catch (e) {
    // Server unreachable — heartbeat stays stale
  }
}

// Poll /decisions for the server's `_processed_at` timestamp. When the
// server stamp is newer than our last submit we know Claude ran POST /reset
// and we should flip the panel back to ready — fully client-driven, no
// browser-eval injection from Claude needed.
async function pollProcessedState() {
  if (!_submittedAt) return; // nothing pending locally
  try {
    const res = await fetch('/decisions', { cache: 'no-store' });
    const data = await res.json();
    const processedIso = data && data._processed_at;
    if (!processedIso) return;
    const processedMs = Date.parse(processedIso);
    if (Number.isFinite(processedMs) && processedMs > _submittedAt) {
      restorePanelToReady();
    }
  } catch (e) {
    // Server unreachable — will retry next tick
  }
}

function checkClaudeConnection() {
  // Suppress warning during grace period — Claude needs time to start the
  // bridge server, set up the heartbeat cron, and send the first POST.
  if (Date.now() - _pageLoadedAt < HEARTBEAT_GRACE_MS) return;

  const isConnected = _lastHeartbeatTs && (Date.now() - _lastHeartbeatTs) < HEARTBEAT_STALE_MS;
  const warning = document.getElementById('connection-warning');
  const btn = document.getElementById('submit-btn');
  const panelSubmitted = document.getElementById('panel-submitted');

  // Don't interfere with the "submitted" state
  if (panelSubmitted && panelSubmitted.style.display !== 'none') return;

  if (isConnected) {
    if (warning) warning.style.display = 'none';
    if (btn) btn.disabled = false;
    // Retry any pending offline submission now that we're connected
    retryPendingSubmission();
  } else {
    if (warning) warning.style.display = 'flex';
    // Submit button stays ENABLED even when disconnected — decisions are
    // cached in localStorage and auto-delivered when Claude reconnects.
    // The warning banner is enough to inform the user.
    if (btn) btn.disabled = false;
  }
}

// Poll heartbeat every 5 seconds — starts immediately so data arrives ASAP.
// checkClaudeConnection() is a no-op during grace period, so the warning
// won't flash before Claude has had time to set up.
setInterval(async () => {
  await pollHeartbeat();
  checkClaudeConnection();
  await pollProcessedState();
}, 5000);
```

**Claude-side heartbeat** (executed by Claude via Bash or CronCreate):
```bash
curl -s -X POST http://localhost:{port}/heartbeat
```

No browser JS injection needed. See `monitoring.md` § HTTP Bridge Monitoring
for integration into the monitoring protocol.

**Legacy fallback:** If the bridge server is not available (e.g., someone opens
a concept HTML file directly), the heartbeat check gracefully degrades — the
`fetch('/heartbeat')` call fails silently, the heartbeat stays stale, and the
submit button remains disabled. The user can still use the page for read-only
review.

## Iteration Tabs

Iterations of a concept page are appended as `<section data-iteration="N">`
blocks inside the same HTML file. The tab bar lives **inside the content
area's header, above `<main>`** — NOT in the right-side decision sidebar
(which stays reserved for submit controls).

### Tab Bar HTML

```html
<nav class="iteration-tabs" role="tablist" aria-label="Iterationen">
  <button class="iteration-tab" role="tab"
          data-iteration="1"
          aria-selected="false"
          aria-controls="iter-1">
    Iteration 1
  </button>
  <button class="iteration-tab" role="tab"
          data-iteration="2"
          aria-selected="true"
          aria-controls="iter-2">
    Iteration 2
  </button>
</nav>

<main>
  <section id="iter-1" data-iteration="1" hidden>…frozen round 1…</section>
  <section id="iter-2" data-iteration="2" data-active>…active round 2…</section>
</main>
```

Rules:
- Exactly one section carries `data-active`. The matching tab has
  `aria-selected="true"`.
- Non-active sections get the `hidden` attribute AND are frozen
  (see "Freezing Past Iterations" below).
- Tabs stay clickable — switching tab reveals the chosen section and
  hides all others. Tabs never disappear.

### Tab Bar CSS

```css
.iteration-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 8px 0 0;
  border-bottom: 1px solid var(--border);
  scrollbar-width: thin;
}
.iteration-tab {
  flex: 0 0 auto;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: var(--bg-subtle);
  color: var(--fg-muted);
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.iteration-tab:hover { background: var(--bg-hover); color: var(--fg); }
.iteration-tab[aria-selected="true"] {
  background: var(--bg);
  color: var(--fg);
  border-color: var(--accent);
  font-weight: 600;
  position: relative;
}
.iteration-tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: -1px;
  height: 2px;
  background: var(--bg);
}
/* Frozen (non-active) iteration: slightly dimmed, no pointer events on inputs */
section[data-iteration]:not([data-active]) {
  opacity: 0.85;
}
section[data-iteration]:not([data-active]) .tri-state-btn,
section[data-iteration]:not([data-active]) input,
section[data-iteration]:not([data-active]) textarea,
section[data-iteration]:not([data-active]) select {
  pointer-events: none;
  filter: grayscale(0.4);
}
```

### Freezing Past Iterations

When appending iteration N+1, Claude must freeze the previous section so
the user sees exactly what they submitted:

1. Remove `data-active`, add `hidden` to the previous `<section>`.
2. On every `input`, `textarea`, `select`, `button` inside it: set `disabled`.
3. On every `textarea`, `input[type="text"]`: set `readonly`.
4. For tri-state buttons: keep the `aria-pressed`/selected class exactly as
   the user submitted it — do NOT clear selections.
5. Add a small "Eingefroren — Iteration N" banner at the top of the section
   (optional but strongly recommended) so the user knows why it is read-only.

### Tab Switch JS

```javascript
// --- Iteration Tabs ---
function showIteration(n) {
  document.querySelectorAll('section[data-iteration]').forEach(sec => {
    const match = String(sec.dataset.iteration) === String(n);
    sec.hidden = !match;
  });
  document.querySelectorAll('.iteration-tab').forEach(tab => {
    const match = String(tab.dataset.iteration) === String(n);
    tab.setAttribute('aria-selected', match ? 'true' : 'false');
  });
  // Heartbeat/submit "music" only runs for the active iteration. Older
  // iterations are frozen snapshots — no re-submit, no new decisions.
  const activeSec = document.querySelector('section[data-iteration][data-active]');
  const isLive = activeSec && String(activeSec.dataset.iteration) === String(n);
  document.body.classList.toggle('viewing-frozen', !isLive);
  // Hide ALL live panel states when viewing a frozen iteration — otherwise
  // a mid-processing spinner (panel-submitted) or the ready panel can bleed
  // through and misrepresent the frozen snapshot as interactive.
  const panelReady = document.getElementById('panel-ready');
  const panelSubmitted = document.getElementById('panel-submitted');
  const panelFrozen = document.getElementById('panel-frozen');
  if (panelReady) panelReady.style.display = isLive ? 'block' : 'none';
  if (panelSubmitted) {
    // Only show panel-submitted when live AND concept-submitted is set
    const submitted = document.body.classList.contains('concept-submitted');
    panelSubmitted.style.display = (isLive && submitted) ? 'block' : 'none';
  }
  // Optional passive hint while viewing history
  if (panelFrozen) panelFrozen.style.display = isLive ? 'none' : 'block';
}

document.querySelectorAll('.iteration-tab').forEach(tab => {
  tab.addEventListener('click', () => showIteration(tab.dataset.iteration));
});

// On load, show whichever iteration is marked data-active.
document.addEventListener('DOMContentLoaded', () => {
  const active = document.querySelector('section[data-iteration][data-active]');
  if (active) showIteration(active.dataset.iteration);
});
```

### Reload Polling (pick up file rewrites)

Every iteration append rewrites the HTML file on disk, then Claude POSTs
`/reload` on the bridge server. The browser polls `/reload` and reloads
when the counter advances — guaranteeing the tab matches disk without any
browser MCP injection.

```javascript
// --- Reload Poller ---
// The bridge server exposes /reload with a monotonic counter. Claude POSTs
// to bump it after rewriting the HTML file. The page polls and reloads
// when it sees a newer counter than the one it booted with.
let _bootReloadCounter = null;
async function pollReload() {
  try {
    const res = await fetch('/reload', { cache: 'no-store' });
    if (!res.ok) return;
    const { counter } = await res.json();
    if (_bootReloadCounter === null) { _bootReloadCounter = counter; return; }
    if (counter > _bootReloadCounter) {
      // New iteration landed on disk — reload so the tab bar and new
      // section appear. localStorage preserves frozen-tab state.
      location.reload();
    }
  } catch (e) { /* bridge offline — ignore, retry next tick */ }
}
setInterval(pollReload, 3000);
document.addEventListener('DOMContentLoaded', pollReload);
```

**Why 3 s?** Fast enough that the new iteration appears within a blink
after Claude finishes writing, slow enough that idle pages do not hammer
the server. The cron tick for heartbeat runs every 60 s — those two loops
are independent.
