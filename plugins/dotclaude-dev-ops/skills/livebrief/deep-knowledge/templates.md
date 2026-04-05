# Livebrief HTML Templates

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
  <title>Livebrief — {title}</title>
  <style>/* all CSS inline */</style>
</head>
<body>
  <header>
    <h1>{title}</h1>
    <p class="subtitle">{context line}</p>
    <button id="theme-toggle" aria-label="Toggle theme">🌙/☀️</button>
  </header>

  <main>
    <!-- Variant-specific content -->
  </main>

  <footer>
    <button id="submit-btn" class="primary">Entscheidungen abschicken</button>
    <p class="hint">Deine Auswahl wird direkt an Claude uebermittelt.</p>
  </footer>

  <script type="application/json" id="livebrief-decisions">
    {"submitted": false, "decisions": [], "comments": []}
  </script>
  <script>/* all JS inline */</script>
</body>
</html>
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
- Comment fields: auto-expanding textarea, subtle border, placeholder text
- Submit button: full-width on mobile, centered on desktop, `min-height: 48px`
- Sliders: labeled endpoints, current value display

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
  ├── [Toggle: Favorit]
  ├── [Rating: 1-5 stars or slider]
  └── [Comment field]

[Variant B: Name]
  └── ...

[Submit button]
```

**Decision schema:**
```json
{
  "decisions": [
    { "id": "variant-a", "label": "...", "favorite": true, "rating": 4 }
  ]
}
```

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
  └── [Comment field]

[Winner selection: radio buttons]
[Submit button]
```

**Decision schema:**
```json
{
  "decisions": [
    { "id": "winner", "selected": "option-b" },
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

### Submit Handler
```javascript
document.getElementById('submit-btn').addEventListener('click', () => {
  const data = collectDecisions();
  const container = document.getElementById('livebrief-decisions');
  container.textContent = JSON.stringify(data);
  document.body.classList.add('livebrief-submitted');

  // Visual confirmation
  const btn = document.getElementById('submit-btn');
  btn.textContent = 'Entscheidungen uebermittelt ✓';
  btn.disabled = true;
  btn.classList.add('submitted');
});
```

### Theme Toggle
```javascript
document.getElementById('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
});
```
