# Concept templates, part 23 of 42: Shared systems — section navigation (continued 2)

```javascript
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
  revealNavItem(item);
}

// Head line reads "{{iteration.tab}} N (Variante)": the parenthesis names the
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
  On the final report (`body.viewing-final`) the panel shows no TOC at all
  — its body belongs to the close-out inbox — so there is nothing to cut.

