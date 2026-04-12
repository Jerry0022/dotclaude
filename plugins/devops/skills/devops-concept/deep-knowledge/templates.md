# Concept HTML Templates

**These are recommendations, not mandatory structures.** Claude should adapt
layout, elements, and design to fit the specific content. Use these as
starting points and inspiration — deviate freely when the content calls for it.

## Common Structure (all variants)

```html
<!DOCTYPE html>
<html lang="de" data-theme="dark">
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

      <main>
        <!-- Variant-specific content -->
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
  border-right: 1px solid var(--border-color, #30363d);
  transition: background 0.15s;
}
.tri-state-option:last-child { border-right: none; }
.tri-state-option:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 8%, transparent);
}
.tri-state-option input { display: none; }
.tri-state-option input:checked ~ .tri-state-label { font-weight: 600; }
.tri-state-option input:checked ~ .tri-state-hint { opacity: 1; }
.tri-state-label { font-size: 0.9rem; }
.tri-state-hint {
  font-size: 0.75rem;
  margin-top: 0.25rem;
  opacity: 0.7;
}
.tri-state-hint.feedback { color: var(--accent-color, #58a6ff); }
.tri-state-hint.action { color: var(--warning-color, #d29922); }

/* Active state backgrounds */
.tri-state-option:has(input[value="include"]:checked) {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent);
}
.tri-state-option:has(input[value="discard"]:checked) {
  background: color-mix(in srgb, var(--text-secondary, #6e7681) 15%, transparent);
}
.tri-state-option:has(input[value="only"]:checked) {
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
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

Interactive element state MUST survive page reloads via `sessionStorage`.
This prevents the user from losing their selections when they press F5.

**Storage key:** `concept-state-{slug}` (derived from the page's filename slug)

```javascript
// --- State Persistence ---
const STORAGE_KEY = 'concept-state-' + location.pathname.split('/').pop().replace('.html', '');

function saveState() {
  const state = {};
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
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function restoreState() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    // Restore theme first (prevents flash)
    if (state.theme) document.documentElement.setAttribute('data-theme', state.theme);
    // Restore inputs
    Object.entries(state).forEach(([key, value]) => {
      const [type, ...rest] = key.split(':');
      if (type === 'input') {
        const [name, val] = [rest.slice(0, -1).join(':'), rest[rest.length - 1]];
        const el = document.querySelector(`input[name="${name}"][value="${val}"], input[id="${name}"][value="${val}"]`);
        if (el) el.checked = value;
      } else if (type === 'text') {
        const id = rest.join(':');
        const el = document.getElementById(id) || document.querySelector(`[data-comment="${id}"]`);
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
- Use `sessionStorage` (not `localStorage`) — state is per-tab, per-session,
  and auto-clears when the tab is closed. No stale state across sessions.
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
document.getElementById('submit-btn').addEventListener('click', async () => {
  const data = collectDecisions();
  const container = document.getElementById('concept-decisions');
  container.textContent = JSON.stringify(data);
  document.body.classList.add('concept-submitted');

  // POST decisions to bridge server — Claude reads via GET /decisions
  try {
    await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (e) {
    // Fallback: decisions are still in the DOM for JS eval reading
  }

  // Switch panel to "submitted" state
  document.getElementById('panel-ready').style.display = 'none';
  document.getElementById('panel-submitted').style.display = 'block';

  // Clear sessionStorage submitted flag so reload restores "ready" state
  saveState();
});
```

### Panel State Reset

When Claude processes decisions and updates the page (Step 5c), it resets
the panel back to the "ready" state via browser eval:

```javascript
// Called by Claude after processing — resets the panel for the next round
document.getElementById('panel-submitted').style.display = 'none';
document.getElementById('panel-ready').style.display = 'block';
document.getElementById('submit-btn').disabled = false;
document.getElementById('submit-btn').textContent = 'Entscheidungen abschicken';
document.body.classList.remove('concept-submitted');
```

This is the visual cycle:
```
[Ready: button active] → User clicks Submit → [Submitted: waiting indicator]
    → Claude processes → [Ready: button active again, new round]
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
and the page communicate through. This bypasses Chrome MCP JS injection
entirely.

**How it works:**
- Claude sends `curl -s -X POST localhost:{port}/heartbeat` every 10 seconds
  (via CronCreate or the monitoring loop)
- The page polls `GET /heartbeat` every 5 seconds via `fetch()`
- If the heartbeat is older than 45 seconds (3 missed polls) or missing →
  the submit button is disabled and a warning is shown
- If the heartbeat is fresh → submit is enabled, warning hidden

```javascript
// --- Claude Connection Heartbeat (HTTP Bridge) ---
const HEARTBEAT_STALE_MS = 45000; // 3 missed polls = disconnected
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

function checkClaudeConnection() {
  const isConnected = _lastHeartbeatTs && (Date.now() - _lastHeartbeatTs) < HEARTBEAT_STALE_MS;
  const warning = document.getElementById('connection-warning');
  const btn = document.getElementById('submit-btn');
  const panelSubmitted = document.getElementById('panel-submitted');

  // Don't interfere with the "submitted" state
  if (panelSubmitted && panelSubmitted.style.display !== 'none') return;

  if (isConnected) {
    if (warning) warning.style.display = 'none';
    if (btn) btn.disabled = false;
  } else {
    if (warning) warning.style.display = 'flex';
    if (btn) btn.disabled = true;
  }
}

// Poll heartbeat every 5 seconds, check connection after each poll
setInterval(async () => { await pollHeartbeat(); checkClaudeConnection(); }, 5000);
// Initial grace period: 30 seconds — Claude needs time to start the bridge
// server, set up the heartbeat cron, and send the first POST.
setTimeout(async () => { await pollHeartbeat(); checkClaudeConnection(); }, 30000);
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
