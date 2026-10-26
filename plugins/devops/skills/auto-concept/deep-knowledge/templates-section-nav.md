# Concept templates, part 22 of 42: Shared systems — section navigation

# Shared Systems (all templates)

All three templates reuse the same iteration, persistence, heartbeat, submit
handler, and navigation plumbing. The only template-specific parts are the
layout CSS and `collectDecisions` branch shown above. Everything below
applies uniformly.

## Section Navigation (Decision Panel as TOC)

The decision panel doubles as a full table-of-contents for the active
iteration. EVERY major `<section id="…" data-nav-label="…">` inside the
current iteration gets a clickable nav entry — not just variants. Sections
with a bi-state radio group additionally display the current evaluation
state.

A scroll spy marks the section the user is currently reading with
`.is-active` (accent bar + tint), and auto-scrolls the TOC so that marker
stays visible even in a long list. Without it, a 20-entry TOC forces the user
to hunt for their own position on every scroll.

```css
/* The TOC is the whole content of the scroll box now — the live round's
   sections only, everything else moved to the head's 🕘 rounds list — so it
   reads as a nested level: indented, with a thin accent rail. */
.section-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 2px 0 8px 0.5rem;
  padding-left: 0.5rem;
  border-left: 2px solid color-mix(in srgb, var(--accent-color, #58a6ff) 45%, transparent);
}
/* TOC groups — rendered only when ≥2 kinds meet AND the round has >12
   entries (buildSectionNav); one open at a time. */
.nav-group { margin: 2px 0; }
.nav-group > summary {
  list-style: none;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  font-size: 0.74rem; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--text-secondary, #8b949e);
  cursor: pointer;
}
.nav-group > summary::-webkit-details-marker { display: none; }
.nav-group > summary::before { content: "▸"; margin-right: 0.35rem; }
.nav-group[open] > summary::before { content: "▾"; }
.nav-group > summary:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}
.nav-group-name { flex: 1 1 auto; }
.nav-group-count { font-weight: 400; opacity: 0.8; }
.nav-group > .section-nav-item { margin-left: 0.5rem; }
.section-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  text-decoration: none;
  color: var(--text-color, #c9d1d9);
  font-size: 0.9rem;
  transition: background 0.15s, box-shadow 0.15s;
  cursor: pointer;
}
.section-nav-item:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}
.section-nav-item:not([data-variant]) .section-nav-label {
  font-weight: 500;
  opacity: 0.9;
}
.section-nav-state {
  font-size: 0.8rem;
  color: var(--accent-color, #58a6ff);
  white-space: nowrap;
}
.section-nav-state.state-discard { color: var(--danger-color, #f85149); }
.section-nav-state.state-only { color: var(--success-color, #3fb950); }
/* Mapping progress mirror (§ Information Mapping (engine)): muted until a
   min/max rule is violated, then the warning colour. */
.section-nav-state.state-mapping { color: var(--text-secondary); }
.section-nav-state.state-mapping.has-violations { color: var(--warning-color); }
/* "You are here" marker — driven by the scroll spy, NOT by :target or click
   alone. The accent bar is an inset box-shadow (not a border) so the entry
   never shifts horizontally when it becomes active. */
.section-nav-item.is-active {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 18%, transparent);
  box-shadow: inset 3px 0 0 var(--accent-color, #58a6ff);
  font-weight: 600;
}
.section-nav-item.is-active .section-nav-label { opacity: 1; }
/* The hand-offs entry is the one TOC item that names work still left for the
   reader — warning colour and a marker in every scroll position, so it cannot
   be mistaken for one more report paragraph. */
.section-nav-item[data-handoffs] .section-nav-label {
  opacity: 1;
  color: var(--warning-color, #d29922);
  font-weight: 600;
}
.section-nav-item[data-handoffs] .section-nav-label::before { content: '⚠ '; }
/* Selected-variant node — always open, its own .section-nav-item as the
   summary, nested sub-sections indented one step further. Never gets the
   toggle listener .nav-group does, so nothing can close it. */
.nav-group.nav-variant-open > summary { padding: 0; background: none; cursor: default; }
.nav-group.nav-variant-open > summary::-webkit-details-marker,
.nav-group.nav-variant-open > summary::before { content: none; display: none; }
.nav-group.nav-variant-open > summary:hover { background: none; }
.nav-group.nav-variant-open > summary .section-nav-item { width: 100%; }
.nav-group.nav-variant-open > .section-nav-item { margin-left: 0.75rem; }
/* "Weitere Varianten · N · k verworfen" — one collapsed row for every
   variant that is not the selected one. */
.nav-group.nav-other-variants > .section-nav-item { margin-left: 0.5rem; opacity: 0.85; }
/* The overflow cut and the final-report window hide top-level entries with
   `hidden`. `.section-nav-item { display: flex }` outranks the browser's own
   [hidden] rule, so a flat TOC kept every "hidden" entry on screen next to
   its "+N weitere" toggle — this rule makes `hidden` mean hidden again. */
#section-nav > [hidden] { display: none; }
/* "+N weitere" — only rendered when the TOC overflows the scroll box. */
.nav-more-toggle {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 0.4rem 0.75rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--accent-color, #58a6ff);
  font-size: 0.8rem; font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.nav-more-toggle:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .section-nav-item { transition: none; }
}
```

**Every navigable section needs a matching `id` AND a `data-nav-label`:**
```html
<!-- Plain section — TOC entry, scroll only -->
<section id="ist-zustand" data-nav-label="Ist-Zustand">...</section>

<!-- Variant section — TOC entry + bi-state evaluation -->
<section id="variant-a" class="variant-card" data-nav-label="A Orbital Ring">...</section>
```

Sections without `data-nav-label` are skipped by the TOC auto-populator.

```javascript
// --- Section Navigation (Decision Panel as TOC) ---
// Rebuilt by installScrollSpy() on EVERY nav rebuild. An iteration switch
// replaces the whole nav DOM, so a spy bound once at load would silently stop
// highlighting on every tab except the one that existed at DOMContentLoaded.
let scrollSpyEntries = [];
let scrollSpyFrame = 0;

// "Kompass" tree tunables — decided on the concept page, not tuned by feel:
// group the TOC only when ≥2 kinds are present AND the round has >12
// entries; honour a deliberate group close for 4 s before the scroll spy may
// open that group again.
const NAV_GROUP_MIN_KINDS = 2;
const NAV_GROUP_OVER_ENTRIES = 12;
const NAV_MANUAL_CLOSE_GRACE_MS = 4000;
let _navManualClosedAt = new WeakMap();   // details.nav-group → Date.now() of a user close — reset on every buildSectionNav() rebuild
let _lastActiveSectionId = null;            // survives a rebuild — the "reading line" fallback below
// Bumped once per buildSectionNav() call, captured by every 'toggle'
// listener bound during that call. `nav` (the #section-nav element) is the
// SAME node across every rebuild — only its children are replaced — so a
// 'toggle' event queued by an EARLIER build's (now-detached) group, firing
// AFTER a later build has already replaced the tree, would otherwise still
// read that detached group's OWN `.open` (never touched again after
// detachment, so often still `true`), pass the "am I open" guard, and close
// groups it queries fresh off the live `nav` — i.e. the CURRENT build's
// groups, which have nothing to do with it. The generation check below
// makes any listener from a superseded build a no-op, unconditionally,
// before it reads or writes anything.
let _navGeneration = 0;

// The live round's chip is authored with {{iteration.active_suffix}} on it
// (" · aktiv" / " · active" — the fixture builder and every hand-appended
// chip still add it; § Iteration append checklist). The head must never
// show it ("no aktiv/active wording on the live round's head line"), so it
// is stripped once, here, at the single source every consumer (head, frozen
// bar, rounds list, status line) reads data-tab-label from. Also covers the
// older "(aktiv)"/"(active)" parenthesis form.
function stripActiveSuffix(label) {
  return label.replace(/\s*(?:·\s*(?:aktiv|active)\b|\(\s*(?:aktiv|active)\s*\))\s*$/i, '').trim();
}

// The label a chip was appended with, stamped on data-tab-label the first
// time the tree is built — BEFORE any generated summary line is added to the
// chip, so showIteration / renderPanelStatus / the frozen bar never read the
// summary as part of the name.
function iterationTabLabel(tab) {
  if (!tab.dataset.tabLabel) {
    const stale = tab.querySelector('.iteration-tab-summary');
    if (stale) stale.remove();
    tab.dataset.tabLabel = stripActiveSuffix(tab.textContent.trim());
  }
  return tab.dataset.tabLabel;
}

// ONE tree: every .iteration-tab is a node header. Non-selected chips get a
// generated one-line summary ("14 Einträge · 3 verworfen", from that round's
// section[id][data-nav-label] and its eval-* radios; reality-check and
// final-report chips keep their glyph labels). The chips themselves are
// never recreated — same <button>, same click listeners, only read from —
// which is why the append checklist can keep string-appending them at the
// end of nav.iteration-tabs. The bar itself is hidden (§ Tab Bar CSS); the
// 🕘 rounds chip + list in the pinned head (buildRoundsChip) is what the
// user actually sees and clicks.
function buildIterationTree() {
  const bar = document.querySelector('.iteration-tabs');
  if (!bar) return;
  const tabs = [...bar.querySelectorAll('.iteration-tab')];
  const liveTab = tabs.find(t => t.getAttribute('aria-selected') === 'true');
  tabs.forEach(tab => {
    iterationTabLabel(tab);
    const old = tab.querySelector('.iteration-tab-summary');
    if (old) old.remove();
    if (tab === liveTab) return;
    if (tab.hasAttribute('data-reality-check') || tab.hasAttribute('data-final-report')) return;
    const sec = document.querySelector('section[data-iteration="' + tab.dataset.iteration + '"]');
    if (!sec) return;
    const entries = sec.querySelectorAll('section[id][data-nav-label]');
    let discarded = 0;
    entries.forEach(s => {
      const checked = s.querySelector('input[name="eval-' + s.id + '"]:checked');
      if (checked && checked.value === 'discard') discarded++;
    });
    const summary = document.createElement('span');
    summary.className = 'iteration-tab-summary';
    summary.textContent = entries.length + ' {{nav.summary_entries}}'
      + (discarded ? ' · ' + discarded + ' {{nav.summary_discarded}}' : '');
    tab.appendChild(summary);
  });
  buildRoundsChip(tabs, liveTab);
}

// 🕘 rounds chip + its toggled list, both inside the pinned .panel-here.
// "Previous" = every chip before the live one, same population the archive
// fold used to wrap — only the presentation moved. Each row reuses the
// .iteration-tab-summary text already computed above (single source), tags
// itself {{nav.archived}}, and clicking it drives the SAME showIteration()
// path as clicking the (now hidden) tab would.
function buildRoundsChip(tabs, liveTab) {
  const chip = document.getElementById('panel-here-rounds');
  const list = document.getElementById('panel-here-rounds-list');
  if (!chip || !list) return;
  const liveIdx = liveTab ? tabs.indexOf(liveTab) : -1;
  const previous = liveIdx > 0 ? tabs.slice(0, liveIdx) : [];
  chip.hidden = previous.length === 0;
  const count = chip.querySelector('[data-here-rounds-count]');
  if (count) count.textContent = String(previous.length);
  list.innerHTML = '';
  previous.forEach(tab => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'panel-here-rounds-item';
    row.setAttribute('role', 'listitem');
    row.dataset.iteration = tab.dataset.iteration;
    const label = document.createElement('span');
    label.className = 'panel-here-rounds-label';
    label.textContent = tab.dataset.tabLabel || tab.textContent.trim();
    row.appendChild(label);
    const tabSummary = tab.querySelector('.iteration-tab-summary');
    if (tabSummary) {
      const summary = document.createElement('span');
      summary.className = 'panel-here-rounds-summary';
      summary.textContent = tabSummary.textContent;
      row.appendChild(summary);
    }
    const tag = document.createElement('span');
    tag.className = 'panel-here-rounds-tag';
    tag.textContent = '{{nav.archived}}';
    row.appendChild(tag);
    row.addEventListener('click', () => {
      list.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
      showIteration(tab.dataset.iteration);
    });
    list.appendChild(row);
  });
}

// Closed by default, plain toggle, no persistence: a click on the chip
// flips the list; a click outside it (or Escape) closes it again.
document.addEventListener('click', e => {
  const chip = document.getElementById('panel-here-rounds');
  const list = document.getElementById('panel-here-rounds-list');
  if (!chip || !list) return;
  if (chip.contains(e.target)) {
    const willOpen = list.hidden;
    list.hidden = !willOpen;
    chip.setAttribute('aria-expanded', String(willOpen));
    return;
  }
  if (!list.hidden && !list.contains(e.target)) {
    list.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const chip = document.getElementById('panel-here-rounds');
  const list = document.getElementById('panel-here-rounds-list');
  if (list && !list.hidden) {
    list.hidden = true;
    if (chip) chip.setAttribute('aria-expanded', 'false');
  }
});

// The "selected" variant, per the TOC grouping rule: the one variant left on
// "Miteinbeziehen" while every OTHER variant is "Verwerfen" — an unambiguous
// signal the round has converged on one option. Below two variants there is
// nothing to group around. Absent that unambiguous signal, fall back to
// whichever variant was under the reading line before this rebuild (the spy
// keeps _lastActiveSectionId current), so a mid-review round does not jump
// its grouping on every radio click.
function computeSelectedVariant(variantSections) {
  if (variantSections.length < 2) return null;
  let includeCount = 0, discardCount = 0, includeSec = null;
  variantSections.forEach(s => {
    const checked = s.querySelector(`input[name="eval-${s.id}"]:checked`);
    const value = checked ? checked.value : 'include';
    if (value === 'include') { includeCount++; includeSec = s; }
    else if (value === 'discard') discardCount++;
  });
  if (includeCount === 1 && discardCount === variantSections.length - 1) return includeSec;
  if (_lastActiveSectionId) {
    const prev = variantSections.find(s => s.id === _lastActiveSectionId);
    if (prev) return prev;
  }
  return null;
}

// "+N weitere" — only when the TOC would otherwise overflow the scroll box
// (measured AFTER render, never a fixed cut-off). Hides the tail of the
// direct-children list and reveals it on click.
// On the FINAL REPORT the panel shows no TOC at all (§ CSS
// body.viewing-final .panel-nav-scroll), so there is nothing to cut.
function applyNavOverflow(nav, scrollBox) {
  nav.querySelectorAll('.nav-more-toggle').forEach(el => el.remove());
  nav.querySelectorAll('[data-nav-overflow-hidden]').forEach(el => {
    el.hidden = false;
    el.removeAttribute('data-nav-overflow-hidden');
  });
  if (document.body.classList.contains('viewing-final')) return;
  if (!scrollBox || scrollBox.scrollHeight <= scrollBox.clientHeight) return;
  const items = [...nav.children];
  const floor = navOverflowFloor(nav, items);
  let hiddenCount = 0;
  for (let i = items.length - 1; i > floor && scrollBox.scrollHeight > scrollBox.clientHeight; i--) {
    items[i].hidden = true;
    items[i].setAttribute('data-nav-overflow-hidden', '');
    hiddenCount++;
  }
  if (!hiddenCount) return;
  nav.appendChild(makeNavMoreToggle(nav, hiddenCount));
}
// The overflow cut never hides the child that holds the active entry — or,
// with nothing active yet, the first child — nor anything above it. When that
// group alone is taller than the scroll box, hiding used to go on until the
// panel showed nothing but "+N weitere" (#541); now the box scrolls instead.
function navOverflowFloor(nav, items) {
  const active = nav.querySelector('.section-nav-item.is-active');
  const i = active ? items.findIndex(el => el === active || el.contains(active)) : -1;
  return i < 0 ? 0 : i;
}
function makeNavMoreToggle(nav, hiddenCount) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-more-toggle';
  toggle.textContent = '+' + hiddenCount + ' {{nav.more_entries}}';
  toggle.addEventListener('click', () => {
    nav.querySelectorAll('[data-nav-overflow-hidden]').forEach(el => {
      el.hidden = false;
      el.removeAttribute('data-nav-overflow-hidden');
    });
    toggle.remove();
  });
  return toggle;
}
```

