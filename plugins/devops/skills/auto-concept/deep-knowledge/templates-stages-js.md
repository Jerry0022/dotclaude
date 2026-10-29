# Concept templates, part 48 of 48: Shared systems — Etappen (stages) JS

## Etappen JS

Renders § Etappen from `#concept-stages` + `data-stage` (templates-stages.md). Re-runs on every `iteration:changed` and every ☰ open.

```javascript
// ── Etappen (stages) — reads #concept-stages + data-stage, never derives them.
function conceptStages() {
  const node = document.getElementById('concept-stages');
  let d = null;
  if (node) { try { d = JSON.parse(node.textContent || 'null'); } catch (e) { d = null; } }
  if (!d || typeof d !== 'object') return { stages: [], current: '', icon: '', title: '' };
  return {
    stages: Array.isArray(d.stages) ? d.stages.filter(s => s && s.id) : [],
    current: d.current || '', icon: d.icon || '', title: d.title || ''
  };
}

function conceptHeadName() {
  const d = conceptStages();
  const icon = d.icon || '🧭';
  const title = d.title || String(document.title || '')
    .replace(/^(?:Concept\s+[—-]\s+|(?:👉|⏳|🛠️|🛠|🏁|✅)️?\s+)/u, '').trim();
  return title ? icon + ' ' + title : '';
}

function _stRounds() {
  return [...document.querySelectorAll('section[data-iteration]')]
    .filter(s => !s.hasAttribute('data-final-report') && !s.hasAttribute('data-reality-check'))
    .sort((a, b) => Number(a.dataset.iteration) - Number(b.dataset.iteration));
}
function _stVisibleRound() {
  return document.querySelector('section[data-iteration]:not([hidden])')
    || document.querySelector('section[data-iteration][data-active]');
}
function _stLive() { return document.querySelector('section[data-iteration][data-active]'); }
function _stRoundLabel(sec) { return '{{iteration.tab}} ' + (sec ? sec.dataset.iteration : ''); }
function _stStageOf(sec) {
  if (!sec) return '';
  if (sec.dataset.stage) return sec.dataset.stage;
  // The final report / a reality check carry no data-stage: they belong to
  // the live Etappe.
  return conceptStages().current || '';
}
function _stState(id) {
  const ids = conceptStages().stages.map(s => s.id);
  const cur = ids.indexOf(conceptStages().current || _stStageOf(_stLive()));
  const i = ids.indexOf(id);
  return i < cur ? 'done' : i === cur ? 'now' : 'ahead';
}
function _stEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// "Übersicht · Runde N" on the overview row, else a plain "Runde N" row.
function renderRoundRow() {
  const sec = _stVisibleRound();
  const ov = document.querySelector('#screen-nav .screen-nav-overview-item');
  if (ov) {
    let tag = ov.querySelector('.screen-nav-rnd');
    if (!tag) {
      tag = _stEl('span', 'screen-nav-rnd');
      const label = ov.firstElementChild;
      (label || ov).appendChild(tag);
    }
    tag.textContent = '· ' + _stRoundLabel(sec);
  }
  const scroll = document.querySelector('#decision-panel .panel-nav-scroll');
  if (!scroll) return;
  let row = document.getElementById('panel-round-row');
  if (!row) {
    row = _stEl('div', 'panel-round-row');
    row.id = 'panel-round-row';
    scroll.insertBefore(row, scroll.firstChild);
  }
  const ovGroup = document.querySelector('#screen-nav .screen-nav-overview-group');
  const ovShown = !!(ov && document.documentElement.dataset.template === 'design'
    && !(ovGroup && ovGroup.hidden));
  const isFinal = !!(sec && sec.hasAttribute('data-final-report'));
  row.hidden = ovShown || isFinal || !sec || !sec.hasAttribute('data-active');
  row.textContent = _stRoundLabel(sec);
}

// A round's kind: the glyph of its Etappe's stepper node and line 1 of the
// tab's tooltip.
function _stKindOf(sec) {
  if (!sec) return { kind: 'none', line: '' };
  const designs = sec.querySelectorAll(':scope > section[data-design]');
  const n = designs.length;
  if ((sec.dataset.iterationTemplate || '') === 'design' || n) {
    if (n <= 1) return { kind: 'one', line: '{{stage.kind_one}}' };
    const set = sec.dataset.designSet || '';
    const kind = set === 'topics' ? 'seq' : set === 'alternatives' ? 'pick' : 'open';
    const key = kind === 'seq' ? '{{stage.kind_seq}}' : kind === 'pick' ? '{{stage.kind_pick}}' : '{{stage.kind_open}}';
    return { kind, line: key.replace('{n}', String(n)) };
  }
  if (sec.dataset.analysis === 'full') {
    const decs = sec.querySelectorAll('[data-decision][data-decision-mode]').length;
    return { kind: 'analysis', line: '{{stage.kind_analysis}}'.replace('{n}', String(decs)) };
  }
  const entries = sec.querySelectorAll('section[id][data-nav-label]').length;
  return { kind: 'doc', line: '{{stage.kind_doc}}'.replace('{n}', String(entries)) };
}
function stageKindLine(sec) { return _stKindOf(sec).line; }

// One stroke glyph per kind (16 × 16, currentColor).
const _ST_GLYPHS = {
  pick: 'M2 4h3v8H2zM6.5 4h3v8h-3zM11 4h3v8h-3zM6.5 14h3',
  seq: 'M1.5 8h13M3.5 8a1.5 1.5 0 1 0 0 .01M8 8a1.5 1.5 0 1 0 0 .01M12.5 8a1.5 1.5 0 1 0 0 .01',
  open: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  one: 'M2 3h12v8H2zM6 14h4M8 11v3',
  analysis: 'M3 13.5V9M8 13.5V3M13 13.5V6.5M1.5 13.5h13',
  doc: 'M3 4h10M3 8h10M3 12h6'
};
function _stGlyph(kind) {
  const d = _ST_GLYPHS[kind];
  if (!d) return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}
// The stepper node of one Etappe: its kind glyph (newest round) with the
// letter as a badge; an Etappe without a round yet shows the letter alone.
function _stNode(stage) {
  const rounds = _stRounds().filter(r => r.dataset.stage === stage.id);
  const newest = rounds[rounds.length - 1] || null;
  const k = _stKindOf(newest);
  const node = _stEl('span', 'stage-node');
  node.setAttribute('aria-hidden', 'true');
  node.dataset.kind = k.kind;
  const g = _stGlyph(k.kind);
  if (g) node.appendChild(g);
  node.appendChild(_stEl('span', 'stage-tl', stage.id));
  const tip = newest
    ? k.line + '\n' + '{{stage.label}} ' + stage.id + ' · ' + _stRoundLabel(newest)
    : '{{stage.ahead}}';
  return { node, tip };
}

let _stageSelected = '';
function renderStageTabs() {
  const d = conceptStages();
  const panel = document.getElementById('decision-panel');
  let row = document.getElementById('stage-tabs');
  if (!d.stages.length || !panel) { if (row) row.remove(); return; }
  if (!_stageSelected) _stageSelected = _stStageOf(_stVisibleRound()) || d.stages[0].id;
  if (!row) {
    row = _stEl('div', 'stage-tabs');
    row.id = 'stage-tabs';
    const prev = _stEl('button', 'stage-arr stage-arr-prev', '‹');
    const next = _stEl('button', 'stage-arr stage-arr-next', '›');
    prev.type = next.type = 'button';
    prev.dataset.tip = '{{stage.prev}}';
    prev.setAttribute('aria-label', '{{stage.prev}}');
    next.dataset.tip = '{{stage.more}}';
    next.setAttribute('aria-label', '{{stage.more}}');
    const sc = _stEl('div', 'stage-tabs-sc');
    const list = _stEl('div', 'stage-tabs-in');
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', '{{stage.tabs}}');
    sc.appendChild(list);
    row.append(prev, sc, next);
    const step = (dir) => {
      const t = list.querySelector('.stage-tab');
      const w = t ? t.getBoundingClientRect().width + 4 : 72;
      if (typeof sc.scrollBy === 'function') sc.scrollBy({ left: dir * w, behavior: 'smooth' });
      else sc.scrollLeft += dir * w;
    };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    sc.addEventListener('scroll', () => syncStageArrows(row), { passive: true });
    list.addEventListener('keydown', (e) => {
      const tabs = [...list.querySelectorAll('.stage-tab')];
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let to = -1;
      if (e.key === 'ArrowRight') to = Math.min(tabs.length - 1, i + 1);
      else if (e.key === 'ArrowLeft') to = Math.max(0, i - 1);
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = tabs.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStageTab(tabs[i].dataset.stageId); return; }
      if (to < 0) return;
      e.preventDefault();
      tabs.forEach((t, k) => { t.tabIndex = k === to ? 0 : -1; });
      tabs[to].focus();
      revealStageTab(tabs[to]);
    });
    const here = document.getElementById('panel-here');
    if (here && here.parentNode === panel) panel.insertBefore(row, here.nextSibling);
    else {
      const head = panel.querySelector('.panel-head');
      panel.insertBefore(row, head ? head.nextSibling : panel.firstChild);
    }
  }
  const list = row.querySelector('.stage-tabs-in');
  list.replaceChildren();
  d.stages.forEach(s => {
    const t = _stEl('button', 'stage-tab');
    t.type = 'button';
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-controls', 'stage-pane');
    t.dataset.stageId = s.id;
    t.dataset.state = _stState(s.id);
    const sel = s.id === _stageSelected;
    t.setAttribute('aria-selected', sel ? 'true' : 'false');
    t.tabIndex = sel ? 0 : -1;
    const nd = _stNode(s);
    t.append(nd.node, _stEl('span', 'stage-tn', s.name || ''));
    t.dataset.tip = nd.tip;
    t.setAttribute('aria-label', '{{stage.label}} ' + s.id + ' · ' + (s.name || '') + ' · ' + nd.tip.replace('\n', ' · '));
    t.addEventListener('click', () => selectStageTab(s.id));
    list.appendChild(t);
  });
  layoutStageTabs(row);
  renderStagePane();
}

// Size the viewport to whole tabs (no tab is ever cut) and flag overflow.
function layoutStageTabs(row) {
  const sc = row.querySelector('.stage-tabs-sc');
  const list = row.querySelector('.stage-tabs-in');
  const first = list.querySelector('.stage-tab');
  sc.style.width = '';
  row.style.removeProperty('--stage-tab-w');
  delete row.dataset.overflow;
  const avail = row.getBoundingClientRect().width;
  const w = first ? first.getBoundingClientRect().width : 0;
  if (!avail || !w) { syncStageArrows(row); return; }
  const gap = 4;
  const n = list.children.length;
  if (n * (w + gap) - gap <= avail + 0.5) {
    // Few Etappen: the stepper spans the row (names wrap less, never cut),
    // capped so two Etappen do not turn into wide slabs.
    const fill = Math.min(7 * 16, Math.floor((avail - gap * (n - 1)) / n));
    if (fill > w) row.style.setProperty('--stage-tab-w', fill + 'px');
  } else {
    row.dataset.overflow = '';
    const k = Math.max(1, Math.floor((avail - 36 + gap) / (w + gap)));
    sc.style.width = (k * (w + gap) - gap) + 'px';
  }
  syncStageArrows(row);
}
function syncStageArrows(row) {
  const sc = row.querySelector('.stage-tabs-sc');
  const prev = row.querySelector('.stage-arr-prev');
  const next = row.querySelector('.stage-arr-next');
  if (!sc || !prev || !next) return;
  prev.disabled = sc.scrollLeft <= 1;
  next.disabled = sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 1;
}
function revealStageTab(tab) {
  const sc = tab && tab.closest('.stage-tabs-sc');
  if (!sc || !sc.clientWidth) return;
  const l = tab.offsetLeft, r = l + tab.offsetWidth;
  if (l < sc.scrollLeft) sc.scrollLeft = l;
  else if (r > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = r - sc.clientWidth;
}

function selectStageTab(id) {
  _stageSelected = id;
  const row = document.getElementById('stage-tabs');
  if (!row) return;
  row.querySelectorAll('.stage-tab').forEach(t => {
    const on = t.dataset.stageId === id;
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
    if (on) revealStageTab(t);
  });
  renderStagePane();
}

function _stJump(sec, entryId) {
  if (typeof showIteration === 'function') showIteration(sec.dataset.iteration);
  if (entryId) {
    const target = document.getElementById(entryId);
    if (target && target.hasAttribute('data-screen') && typeof window.showScreen === 'function') {
      try { window.showScreen(entryId); } catch (e) { /* not a design round */ }
    } else if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
  }
  if (typeof window.closePanel === 'function') window.closePanel();
}
// One round: its "Runde N" row + its table of contents (the same entries the
// section TOC lists: section[id][data-nav-label]).
function _stRoundBlock(sec) {
  const frag = document.createDocumentFragment();
  const head = _stEl('button', 'stage-round', _stRoundLabel(sec));
  head.type = 'button';
  head.dataset.iteration = sec.dataset.iteration;
  head.addEventListener('click', () => _stJump(sec, null));
  frag.appendChild(head);
  const entries = [...sec.querySelectorAll('section[id][data-nav-label]')];
  if (entries.length) {
    const toc = _stEl('div', 'stage-toc');
    entries.forEach(s => {
      const b = _stEl('button', 'stage-ti', s.dataset.navLabel);
      b.type = 'button';
      b.addEventListener('click', () => _stJump(sec, s.id));
      toc.appendChild(b);
    });
    frag.appendChild(toc);
  }
  return frag;
}
// 🕘 disclosure for earlier rounds (newest first), not persisted.
function _stOlder(rounds) {
  const wrap = _stEl('div', 'stage-older-wrap');
  const btn = _stEl('button', 'stage-older-btn');
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  const chip = _stEl('span', 'stage-older-chip');
  const clock = _stEl('span', '', '🕘');
  clock.setAttribute('aria-hidden', 'true');
  chip.append(clock, document.createTextNode(' ' + rounds.length));
  const caret = _stEl('span', 'stage-older-caret', '▾');
  caret.setAttribute('aria-hidden', 'true');
  btn.append(chip, document.createTextNode('{{stage.older}}'), caret);
  const list = _stEl('div', 'stage-older');
  list.hidden = true;
  rounds.slice().reverse().forEach(sec => list.appendChild(_stRoundBlock(sec)));
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    list.hidden = !open;
  });
  wrap.append(btn, list);
  return wrap;
}

function renderStagePane() {
  const scroll = document.querySelector('#decision-panel .panel-nav-scroll');
  if (!scroll) return;
  const d = conceptStages();
  let pane = document.getElementById('stage-pane');
  let curOlder = document.getElementById('stage-cur-older');
  if (!d.stages.length) {
    if (pane) pane.remove();
    if (curOlder) curOlder.remove();
    delete scroll.dataset.stageView;
    return;
  }
  if (!pane) {
    pane = _stEl('div', 'stage-pane');
    pane.id = 'stage-pane';
    pane.setAttribute('role', 'tabpanel');
    scroll.insertBefore(pane, scroll.firstChild);
  }
  if (!curOlder) {
    curOlder = _stEl('div', 'stage-cur-older');
    curOlder.id = 'stage-cur-older';
    scroll.appendChild(curOlder);
  }
  const visible = _stVisibleRound();
  const visStage = _stStageOf(visible);
  const sel = _stageSelected || visStage;
  const rounds = _stRounds().filter(s => s.dataset.stage === sel);
  pane.replaceChildren();
  curOlder.replaceChildren();
  if (sel === visStage) {
    delete scroll.dataset.stageView;
    pane.hidden = true;
    const earlier = rounds.filter(s => visible && Number(s.dataset.iteration) < Number(visible.dataset.iteration));
    if (earlier.length) curOlder.appendChild(_stOlder(earlier));
    return;
  }
  scroll.dataset.stageView = 'other';
  pane.hidden = false;
  if (!rounds.length) {
    pane.appendChild(_stEl('p', 'stage-ahead', '{{stage.ahead}}'));
    return;
  }
  const newest = rounds[rounds.length - 1];
  pane.appendChild(_stRoundBlock(newest));
  if (rounds.length > 1) pane.appendChild(_stOlder(rounds.slice(0, -1)));
}

// Journey: "Nächste Etappe ›" while the live round is not in the last Etappe.
function renderStageNext() {
  const d = conceptStages();
  const live = _stLive();
  const ids = d.stages.map(s => s.id);
  const cur = _stStageOf(live);
  const i = ids.indexOf(cur);
  const next = (i >= 0 && i < ids.length - 1) ? d.stages[i + 1] : null;
  const isFinal = !!(live && live.hasAttribute('data-final-report'));
  let btn = document.getElementById('jr-next-stage');
  if (!next || isFinal) {
    delete document.body.dataset.stageNext;
    if (btn) btn.remove();
    return;
  }
  const row = document.getElementById('journey')
    || (typeof mountJourney === 'function' ? mountJourney() : null);
  if (!row) return;
  document.body.dataset.stageNext = '';
  if (!btn) {
    btn = _stEl('button', 'jr-next-stage');
    btn.type = 'button';
    btn.id = 'jr-next-stage';
    btn.addEventListener('click', () => {
      const n = btn.dataset.next;
      const s = btn.dataset.stage;
      if (typeof submitWithAction === 'function') submitWithAction('next-stage', { stage: s, next: n });
    });
    const wa = row.querySelector('.jr-wire-a');
    row.insertBefore(btn, wa ? wa.nextSibling : null);
  }
  btn.dataset.stage = cur;
  btn.dataset.next = next.id;
  btn.textContent = '{{stage.next}} ›';
  btn.dataset.tip = '{{stage.next_tip}}'.replace('{next}', next.id).replace('{name}', next.name || '');
  const phase = typeof journeyPhase === 'function' ? journeyPhase() : 'you';
  btn.disabled = phase === 'rethinking' || phase === 'implementing';
}

function renderStages() {
  const staged = conceptStages().stages.length > 0;
  if (staged) document.body.dataset.staged = ''; else delete document.body.dataset.staged;
  renderRoundRow();
  renderStageTabs();
  renderStageNext();
}

(function bootStages() {
  const boot = () => {
    renderStages();
    document.addEventListener('iteration:changed', () => {
      _stageSelected = _stStageOf(_stVisibleRound());
      renderStages();
    });
    // Every panel open: the visible round's Etappe is the open tab, scrolled
    // into view (and the round row follows a nav rebuilt meanwhile).
    let wasOpen = document.body.classList.contains('panel-open');
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => {
        const open = document.body.classList.contains('panel-open');
        if (open && !wasOpen) {
          _stageSelected = _stStageOf(_stVisibleRound());
          renderStages();
          const t = document.querySelector('#stage-tabs .stage-tab[aria-selected="true"]');
          if (t) revealStageTab(t);
        }
        if (!open && wasOpen) renderStageNext();
        wasOpen = open;
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('resize', () => {
      const row = document.getElementById('stage-tabs');
      if (row) layoutStageTabs(row);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
```
