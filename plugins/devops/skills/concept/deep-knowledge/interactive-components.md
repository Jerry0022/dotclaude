# Interactive Components

Reference implementations for interactive elements in concept pages.
These patterns are tested and **must be used as-is** when the corresponding
element is needed — do not improvise CSS-only hacks for these components.

## Star Rating

A 1-5 star rating with correct left-to-right fill, hover preview, and
re-selection support.

**Common mistakes to AVOID:**
- CSS-only `direction: rtl` + sibling selector tricks — they reverse the
  visual fill order and break keyboard/screen-reader accessibility
- Filling stars from right-to-left (stars 4-5 filled for rating 2 = wrong)
- Not allowing re-selection (user clicks 3, can't change to 4)
- Not allowing deselection (click same star again to clear)

### HTML

```html
<div class="star-rating-group">
  <label class="star-rating-label">Rating:</label>
  <div class="star-rating" data-rating="0" data-for="variant-a">
    <span class="star" data-value="1">&#9733;</span>
    <span class="star" data-value="2">&#9733;</span>
    <span class="star" data-value="3">&#9733;</span>
    <span class="star" data-value="4">&#9733;</span>
    <span class="star" data-value="5">&#9733;</span>
  </div>
</div>
```

**`data-for`** links the rating to a variant ID for decision collection.
**`data-rating`** holds the current value (0 = unrated, 1-5 = rated).

### CSS

```css
.star-rating-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.star-rating-label {
  font-size: 0.9rem;
  color: var(--text-secondary, #8b949e);
}
.star-rating {
  display: inline-flex;
  flex-direction: row;  /* LTR — star 1 is leftmost */
  gap: 4px;
  cursor: pointer;
  font-size: 1.5rem;
  user-select: none;
  line-height: 1;
}
.star-rating .star {
  color: var(--text-secondary, #6e7681);
  transition: color 0.15s, transform 0.1s;
}
.star-rating .star.filled {
  color: var(--warning-color, #d29922);
}
.star-rating .star.hover {
  color: var(--warning-color, #d29922);
  transform: scale(1.15);
}
```

### JavaScript

```javascript
// --- Star Rating ---
document.querySelectorAll('.star-rating').forEach(container => {
  const stars = container.querySelectorAll('.star');

  function setRating(value) {
    container.dataset.rating = value;
    stars.forEach(star => {
      // Fill all stars from 1 up to the selected value
      star.classList.toggle('filled', parseInt(star.dataset.value) <= value);
      star.classList.remove('hover');
    });
  }

  function previewRating(value) {
    stars.forEach(star => {
      star.classList.toggle('hover', parseInt(star.dataset.value) <= value);
    });
  }

  function clearPreview() {
    stars.forEach(star => star.classList.remove('hover'));
  }

  stars.forEach(star => {
    star.addEventListener('click', () => {
      const value = parseInt(star.dataset.value);
      const current = parseInt(container.dataset.rating);
      // Click same star = deselect (set to 0), otherwise set new rating
      setRating(value === current ? 0 : value);
      saveState(); // trigger sessionStorage persistence
    });
    star.addEventListener('mouseenter', () => {
      previewRating(parseInt(star.dataset.value));
    });
    star.addEventListener('mouseleave', clearPreview);
  });

  // Initialize from data attribute (supports sessionStorage restore)
  setRating(parseInt(container.dataset.rating) || 0);
});
```

### State Persistence Integration

Star ratings use `data-rating` which is NOT auto-captured by the generic
`saveState()` in templates.md. Add this to `saveState()`:

```javascript
// Inside saveState() — add after the select block:
document.querySelectorAll('.star-rating').forEach(el => {
  if (el.dataset.for) state['stars:' + el.dataset.for] = el.dataset.rating;
});
```

And in `restoreState()`:

```javascript
// Inside restoreState() — add a case in the Object.entries loop:
} else if (type === 'stars') {
  const id = rest.join(':');
  const el = document.querySelector(`.star-rating[data-for="${id}"]`);
  if (el) {
    el.dataset.rating = value;
    // Re-run setRating after DOM is ready
    requestAnimationFrame(() => {
      el.querySelectorAll('.star').forEach(star => {
        star.classList.toggle('filled', parseInt(star.dataset.value) <= parseInt(value));
      });
    });
  }
```

### Decision Collection Integration

In `collectDecisions()`, star ratings are attached to their parent variant:

```javascript
// Inside the [data-decision] loop, after getElementState(el):
const rating = el.querySelector('.star-rating');
if (rating) decision.rating = parseInt(rating.dataset.rating) || 0;
```

## Slider with Value Display

A labeled range slider that shows the current numeric value.

### HTML

```html
<div class="slider-group">
  <label for="weight-perf">Performance</label>
  <input type="range" id="weight-perf" name="weight-perf"
         min="0" max="10" value="5" step="1"
         data-decision="weight-performance">
  <output for="weight-perf" class="slider-value">5</output>
</div>
```

### CSS

```css
.slider-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.slider-group label {
  min-width: 100px;
  font-size: 0.9rem;
}
.slider-group input[type="range"] {
  flex: 1;
  accent-color: var(--accent-color, #58a6ff);
}
.slider-value {
  min-width: 2rem;
  text-align: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
```

### JavaScript

```javascript
document.querySelectorAll('input[type="range"]').forEach(slider => {
  const output = document.querySelector(`output[for="${slider.id}"]`);
  if (output) {
    slider.addEventListener('input', () => { output.textContent = slider.value; });
  }
});
```

## Toggle Switch

A styled toggle for binary decisions (better than plain checkboxes for
accept/reject patterns).

### HTML

```html
<label class="toggle-switch">
  <input type="checkbox" name="accept-finding-1" data-decision="finding-1">
  <span class="toggle-track">
    <span class="toggle-thumb"></span>
  </span>
  <span class="toggle-label">Akzeptieren</span>
</label>
```

### CSS

```css
.toggle-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  user-select: none;
}
.toggle-switch input { display: none; }
.toggle-track {
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: var(--text-secondary, #6e7681);
  position: relative;
  transition: background 0.2s;
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
}
.toggle-switch input:checked + .toggle-track {
  background: var(--success-color, #3fb950);
}
.toggle-switch input:checked + .toggle-track .toggle-thumb {
  transform: translateX(20px);
}
```

## Expandable Section

For dashboard-style collapsible content blocks.

### HTML

```html
<details class="expandable-section" open>
  <summary>
    <span class="section-title">Section Title</span>
    <span class="section-summary">3 items</span>
    <span class="expand-icon">&#9660;</span>
  </summary>
  <div class="section-content">
    <!-- Content here -->
  </div>
</details>
```

### CSS

```css
.expandable-section {
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  overflow: hidden;
}
.expandable-section summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  cursor: pointer;
  background: color-mix(in srgb, var(--panel-bg, #161b22) 50%, transparent);
  list-style: none;
}
.expandable-section summary::-webkit-details-marker { display: none; }
.expand-icon {
  margin-left: auto;
  transition: transform 0.2s;
  font-size: 0.8rem;
}
.expandable-section[open] .expand-icon {
  transform: rotate(180deg);
}
.section-content {
  padding: 1.5rem;
}
.section-summary {
  color: var(--text-secondary);
  font-size: 0.85rem;
}
```

## Inline Comment Field

Wide, comfortable text input for variant feedback. Must be full-width
within its container — never narrow.

### HTML

```html
<div class="comment-field">
  <textarea
    data-comment="variant-a"
    placeholder="Anmerkungen zu Orbital Ring..."
    rows="3"
  ></textarea>
</div>
```

### CSS

```css
.comment-field {
  margin-top: 1rem;
}
.comment-field textarea {
  width: 100%;
  min-height: 80px;
  padding: 0.75rem;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  background: var(--input-bg, #0d1117);
  color: var(--text-color, #c9d1d9);
  font-family: inherit;
  font-size: 0.9rem;
  line-height: 1.5;
  resize: vertical;
  transition: border-color 0.15s;
}
.comment-field textarea:focus {
  outline: none;
  border-color: var(--accent-color, #58a6ff);
}
.comment-field textarea::placeholder {
  color: var(--text-secondary, #6e7681);
}
```
