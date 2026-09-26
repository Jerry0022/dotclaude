# Concept templates, part 09 of 16: Shared systems — section navigation

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
// On the FINAL REPORT the rule is different (applyNavWindow()): the TOC is
// secondary there and the close-out sheet below it needs the height, so by
// default only the entry under the reading line plus its neighbour on each
// side stay visible, whatever the scroll box would fit.
function applyNavOverflow(nav, scrollBox) {
  nav.querySelectorAll('.nav-more-toggle').forEach(el => el.remove());
  nav.querySelectorAll('[data-nav-overflow-hidden]').forEach(el => {
    el.hidden = false;
    el.removeAttribute('data-nav-overflow-hidden');
  });
  if (document.body.classList.contains('viewing-final')) {
    applyNavWindow(nav, nav.querySelector('.section-nav-item.is-active'));
    return;
  }
  if (!scrollBox || scrollBox.scrollHeight <= scrollBox.clientHeight) return;
  const items = [...nav.children];
  // Floor: the top-level child holding the active entry (the first child
  // when none is active) is never hidden. An open group taller than the box
  // would otherwise keep the loop going until every child is hidden and the
  // panel shows nothing but the toggle (#541); the box scrolls the rest.
  const active = nav.querySelector('.section-nav-item.is-active');
  const floor = Math.max(0, active ? items.findIndex(el => el === active || el.contains(active)) : 0);
  let hiddenCount = 0;
  for (let i = items.length - 1; i > floor && scrollBox.scrollHeight > scrollBox.clientHeight; i--) {
    items[i].hidden = true;
    items[i].setAttribute('data-nav-overflow-hidden', '');
    hiddenCount++;
  }
  if (!hiddenCount) return;
  nav.appendChild(makeNavMoreToggle(nav, hiddenCount));
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
    // Expanded by hand stays expanded: the spy must not re-window the list
    // on the next reading-line change (applyNavWindow() checks this).
    nav.dataset.navExpanded = 'true';
    toggle.remove();
  });
  return toggle;
}
// Final-report TOC window: at most NAV_WINDOW_MAX top-level entries —
// the current one, the one before it (if any) and the one after it (if
// any); at the first entry that is two, never three-from-the-top. The rest
// hides behind the same "+N weitere" toggle the overflow rule uses, and the
// window FOLLOWS the reading line (setActiveNavItem() re-applies it) until
// the user expands the list once — `nav.dataset.navExpanded` — after which
// it stays fully open for that build. Counts over the nav's direct children
// (a grouped TOC's <details> counts as one entry), same as the overflow
// rule; `current` is the child that CONTAINS the active item, or the first
// child when nothing is active yet.
const NAV_WINDOW_MAX = 3;
function applyNavWindow(nav, activeItem) {
  if (nav.dataset.navExpanded === 'true') return;
  nav.querySelectorAll('.nav-more-toggle').forEach(el => el.remove());
  const items = [...nav.children];
  if (items.length <= NAV_WINDOW_MAX) return;
  let cur = activeItem ? items.findIndex(el => el === activeItem || el.contains(activeItem)) : 0;
  if (cur < 0) cur = 0;
  const lo = Math.max(0, cur - 1);
  const hi = Math.min(items.length - 1, cur + 1);
  let hiddenCount = 0;
  items.forEach((el, i) => {
    const hide = i < lo || i > hi;
    el.hidden = hide;
    if (hide) { el.setAttribute('data-nav-overflow-hidden', ''); hiddenCount++; }
    else el.removeAttribute('data-nav-overflow-hidden');
  });
  if (hiddenCount) nav.appendChild(makeNavMoreToggle(nav, hiddenCount));
}

function buildSectionNav() {
  buildIterationTree();
  const nav = document.getElementById('section-nav');
  if (!nav) return;
  // Use :not([hidden]) so the nav reflects the VISIBLE iteration (may be
  // a frozen tab the user is reviewing), not the live/latest one.
  const activeIteration = document.querySelector('section[data-iteration]:not([hidden])');
  if (!activeIteration) return;
  // Top-level only — nested section[id][data-nav-label] (a variant's own
  // sub-sections) are collected separately, under the selected-variant node.
  const sections = [...activeIteration.querySelectorAll(':scope > section[id][data-nav-label]')];
  nav.innerHTML = '';
  // A hand-expanded final-report window (applyNavWindow()) is per build —
  // the next tab switch starts windowed again.
  delete nav.dataset.navExpanded;
  // Every group + listener created from here on belongs to THIS generation;
  // any 'toggle' event still queued from a PREVIOUS one is now stale by
  // definition, whatever its own .open reads.
  _navGeneration++;
  const myGeneration = _navGeneration;
  // TOC kinds come from the EXISTING contract — a section with an eval-{id}
  // radio group is a variant, anything else is context — plus an optional
  // data-nav-group="…" override on the section (its value is the group
  // name).
  const kindOf = sec => sec.dataset.navGroup
    || (sec.querySelector(`input[name="eval-${sec.id}"]`) ? 'variants' : 'context');
  const kindLabel = kind => kind === 'variants' ? '{{nav.group_variants}}'
                          : kind === 'context'  ? '{{nav.group_context}}'
                          : kind;
  const makeItem = sec => {
    const id = sec.id;
    const label = sec.dataset.navLabel;
    const hasTriState = !!sec.querySelector(`input[name="eval-${id}"]`);
    const link = document.createElement('a');
    link.href = '#' + id;
    link.className = 'section-nav-item';
    link.dataset.sectionId = id;
    if (hasTriState) link.setAttribute('data-variant', '');
    // The hand-offs section is the one entry that names work still left for
    // the reader; the attribute is what the nav CSS paints.
    if (sec.hasAttribute('data-handoffs')) link.setAttribute('data-handoffs', '');
    const labelEl = document.createElement('span');
    labelEl.className = 'section-nav-label';
    labelEl.textContent = label;
    link.appendChild(labelEl);
    // A mapping section (§ Information Mapping (engine)) mirrors its progress
    // where a variant shows its verdict: `assigned/total · violations ⚠`.
    if (sec.hasAttribute('data-mapping')) link.setAttribute('data-mapping-nav', '');
    if (hasTriState || sec.hasAttribute('data-mapping')) {
      const stateEl = document.createElement('span');
      stateEl.className = 'section-nav-state';
      link.appendChild(stateEl);
    }
    return link;
  };

  const variantSections = sections.filter(s => s.querySelector(`input[name="eval-${s.id}"]`));
  const selectedVariant = computeSelectedVariant(variantSections);

  if (selectedVariant) {
    // Grouped around the selected variant: it renders OPEN with its own
    // sub-sections nested inside; every OTHER variant collapses into one
    // accordion row; context sections stay flat, in document order.
    const otherVariants = variantSections.filter(s => s !== selectedVariant);
    let otherRow = null;
    sections.forEach(sec => {
      if (sec === selectedVariant) {
        const open = document.createElement('details');
        open.className = 'nav-group nav-variant-open';
        open.dataset.navGroup = 'selected-variant';
        open.open = true;
        const summary = document.createElement('summary');
        summary.className = 'nav-group-summary';
        summary.appendChild(makeItem(sec));
        open.appendChild(summary);
        const subSections = [...sec.querySelectorAll('section[id][data-nav-label]')];
        subSections.forEach(sub => open.appendChild(makeItem(sub)));
        nav.appendChild(open);
        return;
      }
      if (otherVariants.includes(sec)) {
        if (!otherRow) {
          otherRow = document.createElement('details');
          otherRow.className = 'nav-group nav-other-variants';
          otherRow.dataset.navGroup = 'other-variants';
          const summary = document.createElement('summary');
          summary.className = 'nav-group-summary';
          const name = document.createElement('span');
          name.className = 'nav-group-name';
          name.textContent = '{{nav.other_variants}}';
          summary.appendChild(name);
          otherRow.appendChild(summary);
          nav.appendChild(otherRow);
        }
        otherRow.appendChild(makeItem(sec));
        return;
      }
      nav.appendChild(makeItem(sec));
    });
    if (otherRow) {
      let discarded = 0;
      otherVariants.forEach(s => {
        const checked = s.querySelector(`input[name="eval-${s.id}"]:checked`);
        if (checked && checked.value === 'discard') discarded++;
      });
      const name = otherRow.querySelector('.nav-group-name');
      name.textContent = '{{nav.other_variants}} · ' + otherVariants.length
        + (discarded ? ' · ' + discarded + ' {{nav.summary_discarded}}' : '');
    }
  } else {
    // No unambiguous selection (or fewer than 2 variants) — the previous
    // flat/kind-grouped list applies unchanged. Grouping is the exception,
    // not the rule: only when ≥2 kinds meet AND the round has more than
    // NAV_GROUP_OVER_ENTRIES entries.
    const kinds = [...new Set(sections.map(kindOf))];
    const grouped = kinds.length >= NAV_GROUP_MIN_KINDS && sections.length > NAV_GROUP_OVER_ENTRIES;
    const hosts = {};
    if (grouped) {
      kinds.forEach(kind => {
        const group = document.createElement('details');
        group.className = 'nav-group';
        group.dataset.navGroup = kind;
        const summary = document.createElement('summary');
        summary.className = 'nav-group-summary';
        const name = document.createElement('span');
        name.className = 'nav-group-name';
        name.textContent = kindLabel(kind);
        const count = document.createElement('span');
        count.className = 'nav-group-count';
        count.textContent = String(sections.filter(s => kindOf(s) === kind).length);
        summary.appendChild(name);
        summary.appendChild(count);
        group.appendChild(summary);
        nav.appendChild(group);
        hosts[kind] = group;
      });
    }
    sections.forEach(sec => {
      (grouped ? hosts[kindOf(sec)] : nav).appendChild(makeItem(sec));
    });
  }
  // One-open among the groups, bound HERE because this DOM is rebuilt on
  // every tab switch — a listener bound once at load would sit on detached
  // nodes. `toggle` runs the accordion (opening one closes the others,
  // whoever opened it: a click or the scroll spy); the summary click records
  // a DELIBERATE close, which openNavGroupFor honours for
  // NAV_MANUAL_CLOSE_GRACE_MS instead of reopening the group next frame. The
  // selected-variant node stays open by construction — no toggle listener on
  // it, nothing may close it.
  nav.querySelectorAll('details.nav-group:not(.nav-variant-open)').forEach(group => {
    group.addEventListener('toggle', () => {
      // A 'toggle' event queued by THIS group can still fire after a LATER
      // buildSectionNav() call has replaced the whole tree (nav.innerHTML =
      // '' only detaches `group` — it does not, and cannot, cancel an
      // already-queued event on it). A detached group's own `.open` is
      // frozen at whatever it last was, so this check must come BEFORE the
      // `!group.open` one: a stale but still-"open" `group` would otherwise
      // pass that check and close CURRENT groups queried fresh off the
      // shared, never-replaced `nav` element — the exact defect that left
      // a freshly-built tree closed right after boot.
      if (myGeneration !== _navGeneration) return;
      if (!group.open) return;
      nav.querySelectorAll('details.nav-group:not(.nav-variant-open)').forEach(other => {
        if (other !== group && other.open) other.open = false;
      });
    });
    group.querySelector('summary').addEventListener('click', () => {
      if (group.open) _navManualClosedAt.set(group, Date.now());
      else _navManualClosedAt.delete(group);
    });
  });
  // The tree now lives inside the scroll box on its own — the live round's
  // TOC only; the other rounds moved to the head's rounds list.
  const hereSection = document.querySelector('[data-here-section]');
  if (hereSection) hereSection.hidden = !sections.length;
  updateSectionNavState();
  // Reset the manual-close grace on every rebuild. The groups themselves are
  // brand new DOM nodes each time (nav.innerHTML = '' above), so old WeakMap
  // entries can never match them by identity anyway — this just makes that
  // explicit instead of relying on it, so nothing the spy does next (below)
  // can be blocked by a stale close from a PREVIOUS build's groups.
  _navManualClosedAt = new WeakMap();
  // Deterministic open state — does NOT depend on the scroll spy having run,
  // or on anything being `.is-active` yet: on a fresh page the spy may be
  // IntersectionObserver-driven and asynchronous, or the very first
  // getBoundingClientRect() read may simply predate layout/paint. Whichever
  // group holds the reading line — or, if nothing can be measured at all,
  // the FIRST group — is open the instant buildSectionNav() returns, on
  // load, on every tab switch and on every rebuild, full stop. This is a
  // FLOOR: openGroupExclusively() below is what the final state actually is.
  const navItems = [...nav.querySelectorAll('.section-nav-item')];
  const openGroupExclusively = item => {
    const group = item && item.closest('details.nav-group');
    if (!group) return false;
    // Single-open, enforced HERE and now — never left for the accordion's
    // own 'toggle' listener to sort out later. That listener only runs once
    // its (browser-queued) 'toggle' EVENT fires, which is one more task tick
    // than "the instant buildSectionNav() returns" allows: opening a second
    // group via installScrollSpy() below, synchronously, right after this
    // one was opened, would otherwise leave BOTH open until that event
    // catches up — which is exactly the empty-looking, both-collapsed (or,
    // depending on timing, both-open-then-one-randomly-wins) tree this whole
    // mechanism exists to prevent.
    //
    // Assign ONLY on an actual transition, explicitly (never `g.open =
    // false` on a group that is already closed, never `group.open = true`
    // on one that is already open). A same-value assignment queues no
    // 'toggle' event of its own, but this call runs up to twice per
    // buildSectionNav() (the pre-spy floor, then the post-spy settle) and,
    // across the two DOMContentLoaded-driven calls at boot, up to four
    // times in one tick — every REAL close still queues one real 'toggle'
    // event on THAT group, and if the two calls settle on the SAME target
    // (the common case), being explicit keeps that count at the true
    // minimum instead of leaving it to chance which browsers treat a
    // same-value set as a no-op. Fewer queued events is what makes the
    // accordion listener's own `if (!group.open) return;` guard reliable —
    // a group that this run never actually closed can never have a stale
    // queued close-event fire against a state some LATER call reopened.
    nav.querySelectorAll('details.nav-group:not(.nav-variant-open)').forEach(g => {
      if (g !== group && g.open) g.open = false;
    });
    if (!group.open) group.open = true;
    return true;
  };
  if (!openGroupExclusively(pickInitialNavTarget(navItems))) {
    const anyGroup = nav.querySelector('details.nav-group');
    if (anyGroup) anyGroup.open = true;
  }
  installScrollSpy();   // nav DOM was replaced → rebind the spy — sets
                         // .is-active from REAL geometry once it exists,
                         // which may or may not be the same entry the
                         // pre-spy pick above landed on.
  // Whatever the spy resolved to (or, if it found nothing at all, the same
  // deterministic pick as above) is the single source of truth for which
  // group is open, reconciled synchronously — before any queued 'toggle'
  // event from either open() call above has a chance to race the other.
  const settledItem = nav.querySelector('.section-nav-item.is-active') || pickInitialNavTarget(navItems);
  openGroupExclusively(settledItem);
  applyNavOverflow(nav, document.querySelector('.panel-nav-scroll'));
}

// Synchronous, spy-independent pick of "the entry that should be open right
// now": an already-settled `.is-active` item wins outright; failing that, the
// LAST item whose section is at/above the 28%-down reading line — the same
// heuristic updateScrollSpy uses — but ONLY when at least one section
// produced a real (non-zero) rect; if every rect reads (0, 0) — no layout to
// read yet, real browser or jsdom alike — there is no signal to act on, so
// this deliberately falls back to the FIRST entry rather than guessing.
function pickInitialNavTarget(items) {
  if (!items.length) return null;
  const active = items.find(i => i.classList.contains('is-active'));
  if (active) return active;
  const line = window.innerHeight * 0.28;
  let picked = null;
  let measured = false;
  for (const item of items) {
    const sec = document.getElementById(item.dataset.sectionId);
    if (!sec) continue;
    const rect = sec.getBoundingClientRect();
    if (rect.top !== 0 || rect.bottom !== 0) measured = true;
    if (rect.top <= line) picked = item;
  }
  return (measured && picked) ? picked : items[0];
}

// The scroll spy OPENS the group that holds the active entry and never
// closes anything (the accordion listener above does the closing). A group
// the user closed on purpose stays closed for NAV_MANUAL_CLOSE_GRACE_MS —
// and, since setActiveNavItem returns early for an unchanged entry, until
// the active entry actually changes.
function openNavGroupFor(item) {
  const group = item.closest('details.nav-group');
  if (!group || group.open) return;
  const closedAt = _navManualClosedAt.get(group) || 0;
  if (Date.now() - closedAt < NAV_MANUAL_CLOSE_GRACE_MS) return;
  group.open = true;
}

function updateSectionNavState() {
  const labels = { include: 'Miteinbeziehen', discard: 'Verwerfen' };
  document.querySelectorAll('.section-nav-item[data-variant]').forEach(link => {
    const id = link.dataset.sectionId;
    const checked = document.querySelector(`input[name="eval-${id}"]:checked`);
    const currentState = checked ? checked.value : 'include';
    const stateEl = link.querySelector('.section-nav-state');
    if (stateEl) {
      stateEl.textContent = labels[currentState] || currentState;
      stateEl.className = 'section-nav-state state-' + currentState;
    }
  });
  // Mapping progress mirror (§ Information Mapping (engine)): the engine
  // re-calls this after every cell write and every restore.
  if (typeof mappingProgress === 'function') {
    // buildSectionNav() lists the VISIBLE round; resolve the section inside
    // that same round. Mapping ids are unique page-wide (gate M2), so this is
    // defence in depth — a page-wide lookup only when no round is visible.
    const host = document.querySelector('section[data-iteration]:not([hidden])');
    document.querySelectorAll('.section-nav-item[data-mapping-nav]').forEach(link => {
      const id = link.dataset.sectionId;
      const sec = host
        ? [...host.querySelectorAll('section[data-mapping]')].find(s => s.id === id) || null
        : document.getElementById(id);
      const stateEl = link.querySelector('.section-nav-state');
      if (!sec || !stateEl) return;
      const p = mappingProgress(sec);
      stateEl.textContent = p.assigned + '/' + p.total + (p.violations ? ' · ' + p.violations + ' ⚠' : '');
      stateEl.className = 'section-nav-state state-mapping';
      stateEl.classList.toggle('has-violations', p.violations > 0);
    });
  }
}

document.addEventListener('click', e => {
  const link = e.target.closest('.section-nav-item');
  if (!link) return;
  e.preventDefault();
  const target = document.querySelector(link.getAttribute('href'));
  if (!target) return;
  setActiveNavItem(link);   // instant feedback; the spy confirms it once the smooth scroll settles
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function installScrollSpy() {
  scrollSpyEntries = [];
  document.querySelectorAll('.section-nav-item').forEach(item => {
    const sec = document.getElementById(item.dataset.sectionId);
    if (sec) scrollSpyEntries.push({ item, section: sec });
  });
  updateScrollSpy();
}

function setActiveNavItem(item) {
  if (!item || item.classList.contains('is-active')) return;
  scrollSpyEntries.forEach(({ item: other }) => {
    other.classList.remove('is-active');
    other.removeAttribute('aria-current');
  });
  item.classList.add('is-active');
  item.setAttribute('aria-current', 'true');
  _lastActiveSectionId = item.dataset.sectionId || null;
  // "You are here" breadcrumb in the pinned head (§ Common Structure) — the
  // final report has no second head line at all (showIteration hides it).
  const here = document.querySelector('[data-here-section]');
  if (here && !document.body.classList.contains('viewing-final')) {
    const label = item.querySelector('.section-nav-label');
    here.textContent = '› ' + (label ? label.textContent : '');
    here.hidden = false;
  }
  updateHereRoundParenthesis(item);
  openNavGroupFor(item);
  // On the final report the TOC is a 3-entry window around the reading line
  // (applyNavWindow()); it has to move with the line, or the active entry
  // would scroll out of the window it is supposed to be the centre of.
  if (document.body.classList.contains('viewing-final')) {
    const nav = document.getElementById('section-nav');
    if (nav && nav.contains(item)) applyNavWindow(nav, item);
  }
  revealNavItem(item);
}

// Head line reads "Iteration N (Variante)": the parenthesis names the
// variant under the reading line, and ONLY when that section carries a
// variant bi-state — general/context sections never get one.
function updateHereRoundParenthesis(item) {
  const round = document.querySelector('[data-here-round]');
  if (!round) return;
  if (round.dataset.hereRoundBase == null) round.dataset.hereRoundBase = round.textContent;
  const base = round.dataset.hereRoundBase;
  const isVariant = item && item.hasAttribute('data-variant');
  if (isVariant) {
    const label = item.querySelector('.section-nav-label');
    round.textContent = base + ' (' + (label ? label.textContent : '') + ')';
  } else {
    round.textContent = base;
  }
}

// Nearest ancestor that actually scrolls. Returns null when nothing between
// `el` and <body> scrolls, so callers can fall back to the document.
function nearestScrollBox(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if (/(auto|scroll|overlay)/.test(oy) && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

// Keeps the active entry inside the visible part of a long TOC. Scrolls ONLY
// the panel's own scroll box — never the content column — and only when the
// entry is genuinely out of view, so it can't fight the user's scrolling.
function revealNavItem(item) {
  // An entry inside a closed <details> (a folded group, or the archive) has
  // no box at all; measuring its (0,0) rect would drag the scroll box to the
  // top on every frame. Nothing to reveal → do nothing.
  if (item.getClientRects().length === 0) return;
  const box = nearestScrollBox(item.parentElement);
  if (!box) return;
  const boxRect = box.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const pad = 12;
  if (itemRect.top < boxRect.top + pad) {
    box.scrollTop -= (boxRect.top + pad) - itemRect.top;
  } else if (itemRect.bottom > boxRect.bottom - pad) {
    box.scrollTop += itemRect.bottom - (boxRect.bottom - pad);
  }
}

// Picks the section that owns the "reading line" (28% down the viewport):
// the LAST section whose top is above the line. This is deliberately not
// IntersectionObserver's isIntersecting — a section taller than the observer
// band, or shorter than the gap between two entries, produces gaps and
// flicker there. Two edge cases are pinned explicitly: above the first
// section the first entry stays active, and at the very bottom of the scroll
// container the last entry wins (a short trailing section may never reach
// the line on its own).
function updateScrollSpy() {
  if (!scrollSpyEntries.length) return;
  const line = window.innerHeight * 0.28;
  let active = null;
  for (const entry of scrollSpyEntries) {
    if (entry.section.getBoundingClientRect().top <= line) active = entry;
  }
  if (!active) active = scrollSpyEntries[0];
  const box = nearestScrollBox(scrollSpyEntries[0].section.parentElement)
    || document.documentElement;
  // "User is at the bottom" requires a real, measured scroll box — a
  // scrollHeight of exactly 0 (nothing laid out yet, or the box's own
  // ancestor is still off-canvas/hidden) is "nothing to measure", never
  // "already at the bottom", and must not override the reading-line pick
  // above with the LAST entry.
  if (box.scrollHeight > 0 && box.scrollHeight - box.scrollTop - box.clientHeight < 4) {
    active = scrollSpyEntries[scrollSpyEntries.length - 1];
  }
  setActiveNavItem(active.item);
}

function scheduleScrollSpy() {
  if (scrollSpyFrame) return;
  scrollSpyFrame = requestAnimationFrame(() => {
    scrollSpyFrame = 0;
    updateScrollSpy();
  });
}

// Capture phase: scroll events do NOT bubble, so a listener on document only
// sees them during capture. This covers both the document scroll and an inner
// .concept-content scroll box without knowing which one is in play.
document.addEventListener('scroll', scheduleScrollSpy, { capture: true, passive: true });
window.addEventListener('resize', scheduleScrollSpy, { passive: true });

document.addEventListener('change', updateSectionNavState);
document.addEventListener('DOMContentLoaded', buildSectionNav);
```

**Important:**
- Every navigable `<section>` needs `id` AND `data-nav-label`. A section
  nested INSIDE a variant (its own sub-sections) also needs both — collected
  separately once that variant is the selected one, never as a top-level TOC
  entry of its own.
- If a section has a bi-state radio group, its `name` MUST be `eval-{section-id}`.
- `buildSectionNav()` must run again after every iteration switch.
- Never call `installScrollSpy()` on its own — `buildSectionNav()` calls it as
  its last step. Binding it independently is how the highlight goes stale
  after a tab switch.
- **The tree is JS-built, the chips are not.** `buildSectionNav()` builds
  `#section-nav` for the live round only and `buildIterationTree()` derives
  the 🕘 rounds chip + list in `.panel-here` from the chips; the page author
  only ever appends a plain `<button class="iteration-tab" …>` at the end of
  `nav.iteration-tabs` (iteration-rules.md § Iteration append checklist).
  Never hand-write an `.iteration-tab-summary` or a `.nav-group` into the
  HTML — they are recomputed from the sections on load.
- **Selected-variant grouping beats size-based grouping.** When ≥2 variant
  sections exist and exactly one is left "Miteinbeziehen" while every other
  one is "Verwerfen" (or, absent that, whichever variant was under the
  reading line before the rebuild), that variant renders OPEN with its own
  nested sections, every other variant collapses into one
  "{{nav.other_variants}}" row, and context sections stay flat. Otherwise the
  size-based rule below applies unchanged.
- **Grouping is opt-out by size, opt-in by attribute.** A round with ≤12
  entries, or with only one kind, renders the flat list. To place a section
  in a group of its own (or to rename its kind) add `data-nav-group="…"`
  on the section — the value is the group name; `variants` and `context`
  map to the locale labels.
- One-open applies among `.nav-group` only (the selected-variant node is
  exempt — nothing may close it) — never between the rounds list and the
  TOC, which are two separate, independently-toggled surfaces now.
- **"+N weitere" is overflow-only — except on the final report.**
  `applyNavOverflow()` hides the TOC's tail only when `.panel-nav-scroll`'s
  `scrollHeight` exceeds its `clientHeight` after render, and the toggle
  expands it in place — never a fixed cut-off on a round that already fits.
  On the final report (`body.viewing-final`) it defers to `applyNavWindow()`
  instead: by default only the entry under the reading line plus one
  neighbour on each side (at most `NAV_WINDOW_MAX` = 3 top-level entries)
  stay visible, the rest sits behind the same toggle, and the window follows
  the reading line (`setActiveNavItem()`) until the user expands it once.
  The TOC is secondary there; the close-out sheet below it gets the height.

