# Concept templates, part 46 of 48: Template: analysis — engine UI JS (continued 2)

```javascript
  }
  function drawConn(inst) {
    const b = inst.brief;
    if (!b || !b.isConnected || b.classList.contains('an-off') || !b.getBoundingClientRect().width) return;
    let svg = b.querySelector(':scope > .an-conn');
    if (!svg) { svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'an-conn'); svg.setAttribute('aria-hidden', 'true'); b.insertBefore(svg, b.firstChild); }
    svg.textContent = '';
    const br = b.getBoundingClientRect();
    const R = el => { const r = el.getBoundingClientRect(); return { x: r.left - br.left, y: r.top - br.top, w: r.width, h: r.height }; };
    const pot = b.querySelector('[data-briefing-potential]'), why = b.querySelector('[data-briefing-why]') || b.querySelector('[data-briefing-what]');
    const chips = [...b.querySelectorAll('[data-briefing-topic]')];
    if (!pot) return;
    const p = R(pot), defs = document.createElementNS(NS, 'defs');
    svg.appendChild(defs);
    const add = (d, w, c1, c2, i, x1, y1, x2, y2) => {
      const gid = 'an-g' + inst.stages.length + '-' + i;
      const g = document.createElementNS(NS, 'linearGradient');
      g.setAttribute('id', gid); g.setAttribute('gradientUnits', 'userSpaceOnUse');
      [['x1', x1], ['y1', y1], ['x2', x2], ['y2', y2 === y1 ? y1 + 1 : y2]].forEach(a => g.setAttribute(a[0], a[1]));
      [['0', c1], ['1', c2]].forEach(s => { const st = document.createElementNS(NS, 'stop'); st.setAttribute('offset', s[0]); st.setAttribute('stop-color', s[1]); g.appendChild(st); });
      defs.appendChild(g);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d); path.setAttribute('stroke', 'url(#' + gid + ')'); path.setAttribute('stroke-width', String(w)); path.setAttribute('opacity', '.8');
      svg.appendChild(path);
      try { path.style.setProperty('--len', String(Math.ceil(path.getTotalLength()) + 2)); } catch (e) { /* jsdom */ }
    };
    if (why) {
      const w = R(why), x = p.x + 40;
      add('M' + x + ' ' + (w.y + w.h + 6) + ' L' + x + ' ' + p.y, 5, '#8b949e', '#79c0ff', 'w', x, w.y + w.h, x, p.y);
    }
    const total = chips.reduce((a, c) => a + (num(c.dataset.share) || 100 / chips.length), 0) || 1;
    let acc = 0;
    chips.forEach((c, i) => {
      const share = num(c.dataset.share) || 100 / chips.length, r = R(c);
      const x1 = p.x + p.w * ((acc + share / 2) / total), y1 = p.y + p.h, x2 = r.x + r.w / 2, y2 = r.y, my = (y1 + y2) / 2;
      acc += share;
      add('M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' C' + x1.toFixed(1) + ' ' + my.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + my.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1),
        (2 + share / 100 * 10).toFixed(1), '#79c0ff', c.style.getPropertyValue('--c') || '#a371f7', i, x1, y1, x2, y2);
    });
  }
  function rowFor(inst, st, cls) {
    const d = st.el, s = stateOf(inst, d);
    const b = btn(cls || 'an-rw');
    b.dataset.go = String(inst.stages.indexOf(st));
    b.innerHTML = '<i class="an-st an-s-' + s + '"></i><span></span><em></em>';
    const sp = b.querySelector('span');
    sp.textContent = d.dataset.label || decId(d);
    const a = d.dataset.appliesTo;
    if (a) sp.appendChild(Object.assign(h('small'), { textContent: L('Gilt für ', 'Applies to ') + a }));
    b.querySelector('em').textContent = recText(d);
    return b;
  }
  function prepIntro(inst, g) {
    const intro = g.intro;
    intro.tabIndex = -1;
    intro.style.setProperty('--c', g.color);
    intro.dataset.group = String(g.idx);
  }
  function fillIntro(inst, st) {
    const g = st.group, el = st.el;
    el.textContent = '';
    const l2 = [...g.topic.children].find(c => c.getAttribute('data-alevel') === '2');
    el.appendChild(h('div', 'an-pop-k', L('Themenfeld ', 'Topic ') + (g.idx + 1) + ' / ' + inst.groups.length));
    el.appendChild(h('div', 'an-h', (l2 && l2.dataset.title) || g.label));
    el.appendChild(h('div', 'an-sub', g.decs.length + ' ' + L('Entscheidungen · Empfehlung je Zeile', 'decisions · recommendation per row')));
    const rows = h('div', 'an-rows');
    g.decs.forEach(d => rows.appendChild(rowFor(inst, d)));
    el.appendChild(rows);
    const foot = h('div', 'an-foot');
    foot.appendChild(h('div', 'an-quiet')).appendChild(listLink(inst));
    foot.appendChild(goButtons(inst, L('Starten', 'Start')));
    el.appendChild(foot);
  }
  function prepLiteStart(inst) {
    const st = inst.stages.find(s => s.kind === 'start');
    if (!st) return;
    st.el.tabIndex = -1;
  }
  function fillLiteStart(inst, st) {
    const l1 = inst.root.querySelector('[data-alevel="1"]'), el = st.el;
    el.textContent = '';
    el.appendChild(h('div', 'an-h', (l1 && l1.dataset.title) || L('Kurze Fragen', 'Quick questions')));
    el.appendChild(h('div', 'an-sub', inst.decs.length + ' ' + L('kurze Entscheidungen', 'quick decisions')));
    const foot = h('div', 'an-foot');
    foot.appendChild(h('div', 'an-quiet'));
    foot.appendChild(goButtons(inst, L("Los geht's", "Let's go")));
    el.appendChild(foot);
  }
  /** [Zurück] [Weiter] pair. */
  function goButtons(inst, nextLabel, opts) {
    opts = opts || {};
    const go2 = h('div', 'an-go');
    const back = btn('an-back', L('Zurück', 'Back'));
    tip(back, '', '⇧+Enter');
    back.addEventListener('click', () => step(inst, -1));
    const next = btn('an-btn' + (opts.glow ? ' an-glow' : ''), nextLabel || L('Weiter', 'Next'));
    tip(next, '', 'Enter');
    next.addEventListener('click', () => { next.classList.add('an-pressed'); step(inst, 1); });
    if (!opts.noBack) go2.appendChild(back);
    if (!opts.noNext) go2.appendChild(next);
    // No next button: an invisible one of the same width keeps Zurück where
    // it is on every other stage.
    else if (!opts.noBack && !opts.noPh) { const ph = h('span', 'an-go-ph'); ph.setAttribute('aria-hidden', 'true'); go2.appendChild(ph); }
    return go2;
  }

  /* ================= 5. a decision stage ================= */
  function prepDecision(inst, st) {
    const d = st.el, id = decId(d), mode = d.dataset.decisionMode;
    d.classList.add('an-stage');
    d.tabIndex = -1;
    const opts = d.querySelector('[data-options]');
    const zone = h('div', 'an-zone');
    if (opts) { opts.parentNode.insertBefore(zone, opts); zone.appendChild(opts); }
    else { const a = d.querySelector('[data-context]') || d.querySelector('[data-question]'); if (a) a.after(zone); else d.appendChild(zone); }
    const fresh = !isTouched(d);
    const rec = recList(d);
    if (mode === 'multi') {
      if (fresh && rec.length && ![...d.querySelectorAll('input[type=checkbox]')].some(c => c.checked)) rec.forEach(r => { const c = ctl1(d, 'dm-' + id + '.' + r); if (c) c.checked = true; });
      d.querySelectorAll('input[type=checkbox][name^="dm-' + id + '."]').forEach(c => { const o = c.closest('[data-opt]'); if (o) o.classList.add('an-cb'); });
    } else if (mode === 'slider') {
      const r = d.querySelector('input[type=range]');
      if (r) buildSlider(inst, d, r, zone);
    } else if (mode === 'order') {
      buildOrder(inst, d, zone);
    } else if (fresh && rec.length && !ctl(d, 'dm-' + id).some(c => c.type === 'radio' && c.checked)) {
      const c = ctl(d, 'dm-' + id).find(x => x.value === rec[0]);
      if (c) c.checked = true;
    }
    // ★ badge on the recommended option(s); the reason is its tooltip.
    const why = d.dataset.recWhy ? L('Warum: ', 'Why: ') + d.dataset.recWhy : L('Unsere Empfehlung', 'Our recommendation');
    d.querySelectorAll('[data-opt]').forEach((o, i) => {
      if (mode === 'order') return;
      if (rec.indexOf(o.getAttribute('data-opt')) >= 0 || o.hasAttribute('data-recommended')) {
        o.classList.add('an-rec');
        if (!o.querySelector('.an-badge')) { const b = h('span', 'an-badge', '★ ' + L('Empfehlung', 'Recommended')); b.setAttribute('data-tip', why); b.tabIndex = 0; o.appendChild(b); }
      }
      if (i < 9) tip(o, '', String(i + 1));
    });
    // Inline fields that belong to one option (alt / fix / custom text).
    const inline = { yesnoalt: ['-alt', 'alt'], verify: ['-fix', 'partial|wrong'], wording: ['-text', 'custom'] }[mode];
    if (inline) {
      const f = ctl1(d, 'dm-' + id + inline[0]);
      if (f) {
        const wrap = h('label', 'an-inl');
        wrap.appendChild(h('span', '', { yesnoalt: L('Anders:', 'Other:'), verify: L('Korrektur:', 'Correction:'), wording: L('Eigene Formulierung:', 'Own wording:') }[mode]));
        f.parentNode.insertBefore(wrap, f);
        wrap.appendChild(f);
        wrap.dataset.when = inline[1];
        zone.appendChild(wrap);
        if (!f.placeholder) f.placeholder = L('kurz eintippen', 'type briefly');
      }
    }
    // Foot: ONE note field across the full width (its 📎 inside it), then
    // the bar: discreet issue link left, Zurück / Weiter right.
    const foot = h('div', 'an-foot'), quiet = h('div', 'an-quiet');
    const note = d.querySelector('[data-comment="' + cssEsc(id + '-note') + '"]');
    let notew = null;
    if (note) {
      note.classList.add('an-note'); note.rows = 1;
      note.setAttribute('aria-label', L('Notiz zu dieser Frage', 'Note on this question'));
      tip(note, '', 'N');
      note.addEventListener('input', () => { note.style.height = 'auto'; note.style.height = Math.min(note.scrollHeight, 120) + 'px'; });
      // A bar wired before this move sits where the note was; it follows the
      // note and stays its adjacent sibling (`textarea[hidden] + .attach-bar`).
      // A bar wired later is mounted right after the textarea anyway.
      const key = note.getAttribute('data-comment');
      const bar = [...d.querySelectorAll('.attach-slot, .attach-bar')]
        .find(b => (b.getAttribute('data-attach-slot') || b.getAttribute('data-attach-for')) === key) || null;
      notew = h('div', 'an-notew');
      notew.appendChild(note.closest('.field-row') || note);
      if (bar && !bar.contains(note)) note.after(bar);
    }
    const iss = btn('an-link', L('Als Issue anlegen (ggf. mit Epic)', 'Create an issue (with epic if needed)'));
    iss.setAttribute('aria-pressed', 'false');
    tip(iss, '', 'I');
    const epic = h('input'); epic.type = 'text'; epic.className = 'an-epic'; epic.hidden = true;
    epic.placeholder = L('Epic (optional)', 'Epic (optional)');
    epic.setAttribute('aria-label', 'Epic');
    iss.addEventListener('click', () => toggleIssue(inst, d));
    epic.addEventListener('input', () => setHidden(d, '-epic', epic.value.trim()));
    quiet.append(iss, epic, listLink(inst));
    if (notew) foot.appendChild(notew);
    foot.append(quiet, goButtons(inst));
    d.appendChild(foot);
    st.iss = iss; st.epic = epic;
    syncDecision(d);
  }
  function toggleIssue(inst, d) {
    const on = (ctl1(d, 'dm-' + decId(d) + '-issue') || {}).value !== '1';
    setHidden(d, '-issue', on ? '1' : '');
    if (!on) setHidden(d, '-epic', '');
    markTouched(d);
    refresh(inst);
  }
  function buildSlider(inst, d, r, zone) {
    const wrap = h('div', 'an-sl');
    const unit = d.dataset.unit || '';
    const top = h('div', 'an-sl-top');
    const out = h('span', 'an-sl-v');
    top.append(h('span', '', r.min + (unit ? ' ' + unit : '')), out, h('span', '', r.max + (unit ? ' ' + unit : '')));
    r.parentNode.insertBefore(wrap, r);
    wrap.append(top, r);
    const rec = num(d.dataset.rec);
    const recRow = h('div', 'an-sl-rec');
    const badge = h('span', 'an-badge', '★ ' + L('Empfehlung', 'Recommended') + ' · ' + fmt(rec) + (unit ? ' ' + unit : ''));
    badge.setAttribute('data-tip', d.dataset.recWhy ? L('Warum: ', 'Why: ') + d.dataset.recWhy : L('Unsere Empfehlung', 'Our recommendation'));
    badge.tabIndex = 0;
    const pct = (num(r.max) - num(r.min)) ? (rec - num(r.min)) / (num(r.max) - num(r.min)) * 100 : 0;
    badge.style.left = clamp(pct, 8, 92) + '%';
    recRow.appendChild(badge);
    wrap.appendChild(recRow);
    zone.appendChild(wrap);
    tip(r, d.dataset.label || '');
    r.setAttribute('data-tip-key', '← →');
    d.__slider = { r, out, unit };
    syncSlider(d);
  }
  function syncSlider(d) {
    const s = d.__slider;
    if (!s) return;
    const min = num(s.r.min), max = num(s.r.max) || 100;
    s.out.innerHTML = esc(fmt(s.r.value)) + (s.unit ? '<small>' + esc(s.unit) + '</small>' : '');
    s.r.style.setProperty('--an-p', clamp((num(s.r.value) - min) / ((max - min) || 1) * 100, 0, 100) + '%');
  }
  function buildOrder(inst, d, zone) {
    const hid = ctl1(d, 'dm-' + decId(d));
    const opts = d.querySelector('[data-options]');
    if (opts) opts.hidden = true;
    const ol = h('ol', 'an-ord');
    ol.setAttribute('aria-label', d.dataset.label || '');
    zone.appendChild(ol);
    if (hid && !hid.value && d.dataset.rec && !isTouched(d)) hid.value = recList(d).join(',');
    d.__order = { hid, ol, sig: '' };
    syncOrder(inst, d);
    let dragged = null;
    ol.addEventListener('dragstart', e => { dragged = e.target.closest('.an-oi'); if (dragged) { dragged.classList.add('an-drag'); e.dataTransfer && (e.dataTransfer.effectAllowed = 'move'); } });
    ol.addEventListener('dragover', e => { e.preventDefault(); const over = e.target.closest('.an-oi'); if (!dragged || !over || over === dragged) return; const r = over.getBoundingClientRect(); ol.insertBefore(dragged, e.clientY < r.top + r.height / 2 ? over : over.nextSibling); });
    ol.addEventListener('dragend', () => { if (dragged) dragged.classList.remove('an-drag'); dragged = null; writeOrder(inst, d); });
    ol.addEventListener('keydown', e => {
      const it = e.target.closest('.an-oi');
      if (!it) return;
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); moveItem(inst, d, it, e.key === 'ArrowUp' ? -1 : 1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); const n = e.key === 'ArrowUp' ? it.previousElementSibling : it.nextElementSibling; if (n) n.focus(); }
    });
  }
  function syncOrder(inst, d) {
    const o = d.__order;
    if (!o || !o.hid) return;
    const ids = o.hid.value.split(',').map(s => s.trim()).filter(Boolean);
    if (o.sig === o.hid.value) return;
    o.sig = o.hid.value;
    o.ol.textContent = '';
    ids.forEach((id, i) => {
      const li = h('li', 'an-oi'); li.draggable = true; li.tabIndex = 0; li.dataset.id = id;
      const lab = h('span', 'an-ol', optLabel(d, id));
      const c = optCons(optEl(d, id));
      if (c) lab.appendChild(h('small', '', c));
      const bs = h('span', 'an-ob'), up = btn('', '▲'), dn = btn('', '▼');
      up.setAttribute('aria-label', L('Nach oben', 'Move up')); dn.setAttribute('aria-label', L('Nach unten', 'Move down'));
      tip(up, L('Nach oben · Alt+↑', 'Move up · Alt+↑')); tip(dn, L('Nach unten · Alt+↓', 'Move down · Alt+↓'));
      up.addEventListener('click', () => moveItem(inst, d, li, -1)); dn.addEventListener('click', () => moveItem(inst, d, li, 1));
      bs.append(up, dn);
      li.append(h('b', '', String(i + 1)), lab, bs);
      o.ol.appendChild(li);
    });
  }
  function moveItem(inst, d, it, dir) {
    const o = d.__order, ref = dir < 0 ? it.previousElementSibling : it.nextElementSibling;
    if (!ref) return;
    if (dir < 0) o.ol.insertBefore(it, ref); else o.ol.insertBefore(ref, it);
    writeOrder(inst, d);
    it.focus();
  }
  function writeOrder(inst, d) {
    const o = d.__order;
    const ids = [...o.ol.children].map(li => li.dataset.id);
    [...o.ol.children].forEach((li, i) => { li.firstChild.textContent = String(i + 1); });
    o.sig = ids.join(',');
    if (o.hid.value !== o.sig) { o.hid.value = o.sig; fire(o.hid); }
  }
  /** Keeps the option cards / inline fields / slider / order list in step with the controls. */
  function syncDecision(d) {
    d.querySelectorAll('[data-opt]').forEach(o => { const i = o.querySelector('input'); if (i) o.classList.toggle('is-on', !!i.checked); });
    const id = decId(d), checked = ctl(d, 'dm-' + id).find(c => c.type === 'radio' && c.checked);
    d.querySelectorAll('.an-inl').forEach(w => {
      const on = !!checked && w.dataset.when.split('|').indexOf(checked.value) >= 0;
      w.classList.toggle('an-show', on);
    });
    syncSlider(d);
    const inst = instances.find(i => i.root.contains(d));
    if (d.__order && inst) syncOrder(inst, d);
    const st = inst && inst.decs.find(x => x.el === d);
    if (st && st.iss) {
      const on = (ctl1(d, 'dm-' + id + '-issue') || {}).value === '1';
      st.iss.setAttribute('aria-pressed', on ? 'true' : 'false');
      st.iss.textContent = on ? '✓ ' + L('Wird als Issue angelegt', 'Will become an issue') : L('Als Issue anlegen (ggf. mit Epic)', 'Create an issue (with epic if needed)');
      st.epic.hidden = !on;
      const ev = ctl1(d, 'dm-' + id + '-epic');
      if (ev && !st.epic.value) st.epic.value = ev.value;
    }
  }
  function onEdit(inst, e) {
    const d = e.target.closest && e.target.closest('[data-decision][data-decision-mode]');
    if (!d) return;
    const n = e.target.name || '';
    if (/-touched$/.test(n)) { refresh(inst); return; }
    syncDecision(d);
    if (e.target.classList && e.target.classList.contains('an-epic')) return;
    if (e.target.type === 'radio' && d.dataset.decisionMode === 'wording' && e.target.value === 'custom') { const t = ctl1(d, 'dm-' + decId(d) + '-text'); if (t) t.focus(); }
    if (!markTouched(d)) refresh(inst);
  }
  function refresh(inst) {
    inst.decs.forEach(st => syncDecision(st.el));
    refreshStepper(inst);
    updateCons(inst);
    if (inst.root.querySelector(':scope > .an-review:not(.an-off)')) fillReview(inst, inst.stages.find(s => s.kind === 'review'));
    if (typeof updateSectionNavState === 'function') updateSectionNavState();
  }

  /* ================= 5b. fitted Full: one viewport, no page scroll ================= */
  // A visible Full wider than 900px and >= 520px tall takes exactly the
  // viewport below what precedes it (page header): .an-fit + --an-fit-h.
  // Then the open stage and the analysis column are checked for overflow and
  // condensed step by step — the stage .an-dense, .an-dense2, the column
  // .an-afold (short summaries fold to their head); only what still does not
  // fit scrolls inside its own box (.an-ovf / .an-aovf), never the page. The right gutters of the stepper
  // and the bar clear the ☰ and 💬 FABs where they overlap the round.
  const FIT_MIN_W = 900, FIT_MIN_H = 520;
  function fabGutter(root, id, fallback) {
    const fab = document.getElementById(id);
    if (!fab || !fab.getClientRects().length) return fallback;
    const fr = fab.getBoundingClientRect(), rr = root.getBoundingClientRect();
    if (!fr.width || !rr.width) return fallback;
    return Math.max(0, Math.ceil(rr.right - fr.left + 12));
  }
  function fitFull(inst) {
    const root = inst.root;
    if (inst.lite) return;
    const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    const on = vw > FIT_MIN_W && vh >= FIT_MIN_H && !root.closest('[hidden]') && root.getClientRects().length > 0;
    // Measured without transitions: a fold that is still animating would
    // read as overflow and condense one step too far.
    const before = root.className + '|' + root.style.getPropertyValue('--an-fit-h');
    root.classList.add('an-fitting');
    root.classList.remove('an-dense', 'an-dense2', 'an-ovf', 'an-afold', 'an-aovf');
    root.classList.toggle('an-fit', on);
    try { fitMeasure(inst, on); } finally { void root.offsetHeight; root.classList.remove('an-fitting'); }
    // A changed fit moved the briefing's chips: redraw its connectors.
    if (root.className + '|' + root.style.getPropertyValue('--an-fit-h') !== before) drawConn(inst);
  }
  function fitMeasure(inst, on) {
    const root = inst.root;
    const vh = window.innerHeight || 0;
    if (!on) { root.style.removeProperty('--an-fit-h'); return; }
    root.style.setProperty('--an-step-pr', fabGutter(root, 'panel-toggle', 74) + 'px');
    root.style.setProperty('--an-bar-pr', fabGutter(root, 'feedback-toggle', 0) + 'px');
    const top = root.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
    const host = root.closest('.concept-content');
    const below = host ? (parseFloat(getComputedStyle(host).paddingBottom) || 0) : 0;
    let fit = Math.max(FIT_MIN_H - 120, Math.floor(vh - top - below));
    root.style.setProperty('--an-fit-h', fit + 'px');
    const doc = document.documentElement;
    const extra = doc.scrollHeight - vh;
    if (extra > 0 && extra < fit / 2) { fit -= extra; root.style.setProperty('--an-fit-h', fit + 'px'); }
    const st = inst.stages[inst.idx];
    const over = el => !!el && el.getClientRects().length > 0 && el.scrollHeight > el.clientHeight + 1;
    // The stage condenses on its own overflow, the analysis column on its
    // own: a long finding must not shrink the question beside it.
    ['an-dense', 'an-dense2', 'an-ovf'].forEach(c => { if (over(st && st.el)) root.classList.add(c); });
    // The column is measured by layout, not scrollHeight: a level that is
    // still rising in (translateY) would count its transform as overflow.
    const anaOver = () => {
      const a = inst.ana;
      if (!a || !a.getClientRects().length) return false;
      a.scrollTop = 0;
      return inst.lvs.getBoundingClientRect().bottom - a.getBoundingClientRect().top > a.clientHeight + 1;
    };
    ['an-afold', 'an-aovf'].forEach(c => { if (anaOver()) root.classList.add(c); });
  }
  function fitSoon(inst, ms) {
    clearTimeout(inst.fitTimer);
    inst.fitTimer = setTimeout(() => fitFull(inst), ms || 0);
  }

  /* ================= 6. navigation, touched timer, replay ================= */
  const TOUCH_MS = 3000;
  const canTouch = inst => !inst.root.closest('[hidden], [data-baked]') && !document.hidden && inst.root.getClientRects().length > 0;
  function armTouch(inst) {
    clearTimeout(inst.touchTimer);
    const st = inst.stages[inst.idx];
    if (!st || st.kind !== 'dec' || !canTouch(inst)) return;
    inst.touchTimer = setTimeout(() => { if (inst.stages[inst.idx] === st && canTouch(inst)) markTouched(st.el); }, TOUCH_MS);
  }
  function go(inst, i, opt) {
    opt = opt || {};
    i = clamp(Number.isFinite(i) ? i : 0, 0, inst.stages.length - 1);
    const prev = inst.stages[inst.idx], st = inst.stages[i];
    if (inst.pop) closeEvidence(inst);
    if (!opt.initial && prev && prev.kind === 'dec') inst.visited.add(decId(prev.el));
    if (st.aux && !prev.aux) inst.back = inst.idx;
    inst.idx = i;
    if (!st.aux) inst.maxIdx = Math.max(inst.maxIdx, i);
    inst.stages.forEach(s => s.el.classList.toggle('an-off', s !== st));
    inst.groups.forEach(g => g.topic.classList.toggle('an-off', st.group !== g));
    if (inst.brief) inst.brief.classList.toggle('an-off', st.kind !== 'brief');
    inst.root.classList.toggle('an-wide-stage', isWideKind(st.kind));
    inst.root.dataset.anStage = st.kind;
    if (st.kind === 'topic') fillIntro(inst, st);
    else if (st.kind === 'start') fillLiteStart(inst, st);
    else if (st.kind === 'review') fillReview(inst, st);
    else if (st.kind === 'next') fillNext(inst, st);
    else if (st.kind === 'list') fillList(inst, st);
    else if (st.kind === 'done') fillDone(inst, st);
    if (!isWideKind(st.kind)) {
      const same = !!prev && prev.kind === 'dec' && st.kind === 'dec' && prev.topic === st.topic;
      applyLevels(inst, st, { swap: same, dur: opt.initial ? 0 : undefined });
    }
    inst.root.querySelectorAll('.an-back').forEach(x => { x.disabled = st === inst.seq[0]; });
    refreshStepper(inst);
    if (typeof updateSectionNavState === 'function') updateSectionNavState();
    armTouch(inst);
    fitFull(inst);
    fitSoon(inst, (opt.initial ? 0 : transMs()) + 60);
    requestAnimationFrame(() => drawConn(inst));
    if (!opt.initial) {
      if (!opt.noFocus) st.el.focus({ preventScroll: true });
      const anchor = inst.stepEl && !inst.lite ? inst.stepEl : inst.root;
      if (typeof anchor.scrollIntoView === 'function') anchor.scrollIntoView({ block: 'nearest' });
    }
    const navItem = document.querySelector('.section-nav-item[data-section-id="' + cssEsc((st.group && st.kind === 'topic') ? st.group.topic.id : st.el.id || '') + '"]');
    if (navItem && typeof setActiveNavItem === 'function') setActiveNavItem(navItem);
    inst.root.dispatchEvent(new CustomEvent('conceptanalysis:stage', { bubbles: true, detail: { index: i, kind: st.kind } }));
  }
  function step(inst, dir) {
    const cur = inst.stages[inst.idx];
    if (cur.aux) { go(inst, inst.back || 0); return; }
    const k = inst.seq.indexOf(cur);
    go(inst, inst.stages.indexOf(inst.seq[clamp(k + dir, 0, inst.seq.length - 1)]));
  }
  function replay(inst) {
    const st = inst.stages[inst.idx];
    if (!st || isWideKind(st.kind)) return;
    [1, 2, 3].forEach(n => { if (inst.lv[n]) { inst.lv[n].remove(); delete inst.lv[n]; } });
    const base = inst.stages.find(s => s.kind === 'brief' || s.kind === 'start');
    if (base && base !== st) applyLevels(inst, base, { dur: 0 });
    setTimeout(() => applyLevels(inst, st, { dur: reduced() ? 0 : 1000, replay: true }), 40);
  }
  function firstUntouched(inst) {
    const st = inst.decs.find(s => !isTouched(s.el));
    if (st) go(inst, inst.stages.indexOf(st));
    return !!st;
  }

  /* ================= 7. review, next round, list, done ================= */
  function tag(text, cls) { return h('span', 'an-tag ' + cls, text); }
  function rgroup(title, cls, rows, extra) {
    const g = h('div', 'an-rg');
    const hd = h('div', 'an-rg-h');
    hd.appendChild(h('i', 'an-st an-s-' + cls));
    hd.appendChild(document.createTextNode(title));
    hd.appendChild(h('span', '', String(rows.length)));
    g.appendChild(hd);
    rows.forEach(r => g.appendChild(r));
    if (extra) g.appendChild(extra);
    return g;
  }
  function reviewRow(inst, x, cells) {
    const b = btn('an-tr');
    b.dataset.go = String(inst.stages.indexOf(x.s));
    const first = h('div');
    first.appendChild(h('b', '', x.d.dataset.label || decId(x.d)));
    const ap = x.d.dataset.appliesTo;
    if (ap) first.appendChild(h('small', '', L('Gilt für ', 'Applies to ') + ap));
    // A condensed review cuts label / scope to one line: the tooltip has both.
    tip(b, (x.d.dataset.label || decId(x.d)) + (ap ? ' · ' + L('Gilt für ', 'Applies to ') + ap : ''));
    b.appendChild(first);
    cells.forEach(c => { const w = h('div'); w.appendChild(c); b.appendChild(w); });
    return b;
  }
  function impactSpec(inst, ents) {
    const items = [];
    let any = false;
    const groups = inst.groups.length ? inst.groups : [{ label: L('Entscheidungen', 'Decisions'), decs: inst.decs }];
    groups.forEach(g => {
      let sum = 0;
      g.decs.forEach(s => {
        const x = ents.find(y => y.s === s), e = x.e;
        const ids = e.mode === 'multi' ? e.value : e.mode === 'yesnoalt' ? [e.value.answer] : e.mode === 'single' || e.mode === 'verify' ? [e.value] : [];
        ids.forEach(v => { const o = optEl(s.el, v); if (o && o.hasAttribute('data-opt-impact')) { any = true; sum += num(o.getAttribute('data-opt-impact')); } });
      });
      items.push({ label: g.label, value: Math.round(sum * 10) / 10 });
    });
    if (any) return { title: L('Was deine Auswahl bewirkt', 'What your choice does'), spec: { items, unit: inst.root.dataset.impactUnit || '' }, calc: true };
    const cnt = k => ents.filter(x => (k === 'dev' ? x.e.deviates : k === 'iss' ? x.e.issue : k === 'un' ? x.e.untouched : !x.e.deviates && !x.e.untouched)).length;
    return {
      title: L('Was deine Auswahl bewirkt', 'What your choice does'), calc: false,
      spec: { items: [{ label: L('Wie empfohlen', 'As recommended'), value: cnt('ok') }, { label: L('Weicht ab', 'Differs'), value: cnt('dev') }, { label: L('Issue', 'Issue'), value: cnt('iss') }, { label: L('Unberührt', 'Untouched'), value: cnt('un') }] }
    };
  }
  function fillReview(inst, st) {
    const el = st.el;
    const keepFocus = el.contains(document.activeElement) ? document.activeElement.className : '';
    el.textContent = '';
    const ents = inst.decs.map(s => ({ s, d: s.el, e: entryOf(s.el) }));
    const dev = ents.filter(x => x.e.deviates), iss = ents.filter(x => x.e.issue), un = ents.filter(x => x.e.untouched);
    el.appendChild(h('div', 'an-pop-k', L('Review', 'Review')));
    el.appendChild(h('div', 'an-h', ents.length - un.length + ' / ' + ents.length + ' ' + L('angesehen', 'looked at')));
    // Overview: the groups in the main column, impact + submit hint beside them.
    const rv = h('div', 'an-rv'), main = h('div', 'an-rv-main'), side = h('div', 'an-rv-side');
    if (dev.length) main.appendChild(rgroup(L('Weicht von der Empfehlung ab', 'Differs from the recommendation'), 'dev', dev.map(x => reviewRow(inst, x, [tag(valueText(x.d, x.e), 'an-y'), tag(recText(x.d), 'an-r')]))));
    else rv.appendChild(h('div', 'an-sub', L('Alles wie empfohlen.', 'Everything as recommended.')));
    if (iss.length) main.appendChild(rgroup('Issues', 'iss', iss.map(x => reviewRow(inst, x, [tag(x.e.epic ? 'Epic: ' + x.e.epic : L('als Issue', 'as issue'), 'an-i'), h('span')]))));
    if (un.length) {
      const bar = h('div', 'an-unt');
      bar.appendChild(h('span', '', L('Nie geöffnet oder kürzer als 3 s offen — die Vorauswahl gilt.', 'Never opened or open under 3 s — the preselection stands.')));
      const jump = btn('an-btn2', L('Zum ersten Unberührten', 'Jump to the first untouched'));
      tip(jump, '', 'U');
      jump.addEventListener('click', () => firstUntouched(inst));
      bar.appendChild(jump);
      main.appendChild(rgroup(L('Unberührt', 'Untouched'), 'un', un.map(x => reviewRow(inst, x, [tag(valueText(x.d, x.e), 'an-u'), h('span')])), bar));
    }
    const imp = impactSpec(inst, ents), box = h('div', 'an-imp');
    box.appendChild(h('h4', '', imp.title));
    const viz = h('div'); viz.setAttribute('data-viz', 'bars'); viz.setAttribute('data-viz-spec', JSON.stringify(imp.spec));
    box.appendChild(viz);
    renderViz(box, 'long');
    side.appendChild(box);
    side.appendChild(h('div', 'an-send', L('Absenden geht über das Panel oder das Menü unten rechts. Der 💬 Chat bleibt jederzeit offen.', 'Submit from the panel or the menu at the bottom right. The 💬 chat stays open.')));
    if (main.childNodes.length) rv.appendChild(main);
    rv.appendChild(side);
    el.appendChild(rv);
    const foot = h('div', 'an-foot');
    foot.appendChild(h('div', 'an-quiet')).appendChild(listLink(inst));
    foot.appendChild(goButtons(inst, L('Weiter', 'Next')));
    el.appendChild(foot);
    if (keepFocus) { const f = el.querySelector('.' + keepFocus.split(' ')[0]); if (f) f.focus({ preventScroll: true }); }
  }
  function fillNext(inst, st) {
    const el = st.el;
    const nq = inst.root.querySelector('[data-next-questions]');
    if (nq && !nq.__moved) nq.__moved = true;
    el.textContent = '';
    const wrap = h('div', 'an-nx');
    wrap.appendChild(h('div', 'an-pop-k', L('Nächste Runde', 'Next round')));
    const c = h('div', 'an-nx-c');
    c.appendChild(h('div', 'an-h', L('So geht es weiter', 'What happens next')));
    const ol = h('ol');
    [L('Du sendest ab — über das Panel oder das Menü unten rechts.', 'You submit — from the panel or the menu at the bottom right.'),
      L('Claude setzt deine Entscheidungen um und meldet, was sich geändert hat.', 'Claude applies your decisions and reports what changed.'),
      L('Offenes landet als Issue, die Unberührten bleiben bei der Empfehlung.', 'Open items become issues; untouched ones keep the recommendation.')]
      .forEach(t => ol.appendChild(h('li', '', t)));
    c.appendChild(ol);
    if (nq) { nq.hidden = false; c.appendChild(nq); }
    const f = h('div', 'an-nx-f');
    f.appendChild(h('span', '', L('Drei kurze Fragen darfst du auch später beantworten.', 'You may answer any short question later.')));
    const back = btn('an-btn2', '← ' + L('zurück zum Briefing', 'back to the briefing'));
    tip(back, '', 'Pos1');
    back.addEventListener('click', () => go(inst, 0));
    f.appendChild(back);
    c.appendChild(f);
    wrap.appendChild(c);
    el.appendChild(wrap);
    const foot = h('div', 'an-foot');
    foot.appendChild(goButtons(inst, '', { noNext: true }));
    el.appendChild(foot);
  }
  function fillList(inst, st) {
    const el = st.el;
    el.textContent = '';
    el.appendChild(h('div', 'an-h', L('Alle Entscheidungen', 'All decisions')));
    const grid = h('div', 'an-lst');
    const groups = inst.groups.length ? inst.groups : [{ label: L('Entscheidungen', 'Decisions'), color: TOPIC_COLORS[0], decs: inst.decs }];
    groups.forEach(g => {
      const col = h('div', 'an-lg'); col.style.setProperty('--c', g.color);
      col.appendChild(h('div', 'an-lg-h', g.label));
      g.decs.forEach(s => { const r = rowFor(inst, s, 'an-lr'); col.appendChild(r); });
      grid.appendChild(col);
    });
    el.appendChild(grid);
    const foot = h('div', 'an-foot');
    foot.appendChild(goButtons(inst, '', { noNext: true }));
    el.appendChild(foot);
  }
  function fillDone(inst, st) {
    const el = st.el;
    el.textContent = '';
    el.appendChild(h('div', 'an-h', L('Fertig', 'Done')));
    el.appendChild(h('div', 'an-sub', L('Deine Antworten gehen mit dem Absenden raus.', 'Your answers go out when you submit.')));
    const mini = h('div', 'an-mini');
    inst.decs.forEach(s => {
      const e = entryOf(s.el), c = h('div'); if (e.deviates) c.className = 'an-dv';
      c.appendChild(h('b', '', s.el.dataset.label || decId(s.el)));
      c.appendChild(document.createTextNode(valueText(s.el, e) + (e.deviates ? ' · ' + L('weicht ab', 'differs') : '')));
      mini.appendChild(c);
    });
    el.appendChild(mini);
    const foot = h('div', 'an-foot');
    const again = btn('an-btn2', L('Nochmal ansehen', 'Look again'));
    again.addEventListener('click', () => go(inst, inst.stages.indexOf(inst.decs[0])));
    foot.appendChild(h('div', 'an-quiet')).appendChild(again);
    const go2 = goButtons(inst, '', { noNext: true, noPh: true });
    doneSubmitButtons().forEach(b => go2.appendChild(b));
    foot.appendChild(go2);
    el.appendChild(foot);
  }
  // The last step ends in the two ways out — next round and implement — in
  // the SAME style as "Look again" (.an-btn2) and through the SAME submit
  // path as the dock journey: a click is a click on #submit-iterate-btn /
  // #submit-implement-btn. Implement keeps the journey's unlock: the first
  // click only unlocks (label turns into the confirmation, the dock lock opens
  // with it), the second submits; a pause of 5 s or Escape re-locks.
  function doneSubmitButtons() {
    const q = id => document.getElementById(id);
    const next = btn('an-btn2', L('Zur nächsten Runde', 'To the next round'));
    next.dataset.anAct = 'iterate';
    tip(next, L('Antworten absenden, Claude denkt die nächste Runde', 'Submit and let Claude rethink the next round'), '');
    next.addEventListener('click', () => { const t = q('submit-iterate-btn'); if (t && !t.disabled) t.click(); });
    const impl = btn('an-btn2', L('Jetzt umsetzen', 'Implement now'));
    impl.dataset.anAct = 'implement';
    impl.dataset.armed = 'false';
    const idle = L('Jetzt umsetzen', 'Implement now');
    let timer = 0;
    const lock = () => {
      clearTimeout(timer);
      if (impl.dataset.armed !== 'true') return;
      impl.dataset.armed = 'false'; impl.textContent = idle;
      impl.setAttribute('data-tip', L('Zweimal klicken: keine weitere Runde, direkt umsetzen', 'Click twice: no further round, implement right away'));
      if (typeof setJourneyUnlocked === 'function') setJourneyUnlocked(false);
    };
    impl.setAttribute('data-tip', L('Zweimal klicken: keine weitere Runde, direkt umsetzen', 'Click twice: no further round, implement right away'));
    impl.addEventListener('click', () => {
      if (impl.dataset.armed !== 'true') {
        impl.dataset.armed = 'true';
        impl.textContent = L('Sicher? Nochmal klicken', 'Sure? Click again');
        impl.setAttribute('data-tip', L('Zweiter Klick setzt um', 'The second click implements'));
        if (typeof setJourneyUnlocked === 'function') setJourneyUnlocked(true);
        // setJourneyUnlocked() parks focus on the dock button after its
        // cross-fade; the user is working HERE, so take it back.
        setTimeout(() => { try { impl.focus({ preventScroll: true }); } catch (e) {} }, 450);
        timer = setTimeout(lock, 5000);
        return;
      }
      clearTimeout(timer);
      impl.dataset.armed = 'false'; impl.textContent = idle;
      const t = q('submit-implement-btn'); if (t && !t.disabled) t.click();
    });
    impl.addEventListener('keydown', e => { if (e.key === 'Escape' && impl.dataset.armed === 'true') { e.stopPropagation(); lock(); } });
    return [next, impl];
  }

  /* ================= 8. keys ================= */
  function visibleInst(target) {
    const own = target && target.closest ? target.closest('[data-analysis]') : null;
    if (own && own.__an) return own.__an;
    if (target && target !== document.body && target !== document.documentElement) return null;
    const vis = instances.filter(i => !i.lite && !i.root.closest('[hidden]') && i.root.getClientRects().length > 0);
    return vis.length === 1 ? vis[0] : null;
  }
  function pickOption(inst, d, k) {
    const inputs = [...d.querySelectorAll('[data-options] input[type=radio], [data-options] input[type=checkbox]')];
    const c = inputs[k];
    if (!c || c.disabled) return false;
    c.click();   // focus stays on the stage: the key must keep working and no tooltip opens on a hidden radio
    return true;
  }
  function moveOption(d, dir) {
    const radios = [...d.querySelectorAll('[data-options] input[type=radio]')];
    if (!radios.length) return false;
    const i = radios.findIndex(r => r.checked);
    const n = radios[clamp((i < 0 ? 0 : i) + dir, 0, radios.length - 1)];
    n.click();
    return true;
  }
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing) return;
    const inst = visibleInst(e.target);
    if (!inst) return;
    const t = e.target, tag0 = t.tagName, type = (t.type || '').toLowerCase();
    if (e.key === 'Escape' && inst.pop) { e.preventDefault(); e.stopPropagation(); closeEvidence(inst); return; }
    const typing = tag0 === 'TEXTAREA' || tag0 === 'SELECT' || (tag0 === 'INPUT' && !/^(radio|checkbox|range|button|submit)$/.test(type)) || t.isContentEditable;
    const st = inst.stages[inst.idx], d = st && st.kind === 'dec' ? st.el : null;
    if (typing) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); step(inst, e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { t.blur(); if (st) st.el.focus({ preventScroll: true }); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const act = fn => { e.preventDefault(); e.stopPropagation(); fn(); };
    const onButton = tag0 === 'BUTTON' || tag0 === 'A' || tag0 === 'SUMMARY';
    const key = e.key;
    if (key === 'Enter') { if (onButton && !e.shiftKey) return; act(() => step(inst, e.shiftKey ? -1 : 1)); return; }
    if (e.shiftKey && /^Digit[1-9]$/.test(e.code || '')) { const g = inst.groups[Number(e.code.slice(5)) - 1]; if (g) act(() => go(inst, inst.stages.findIndex(s => s.group === g && s.kind === 'topic'))); return; }
    if (e.shiftKey) return;
    if (/^[1-9]$/.test(key) && d) { act(() => pickOption(inst, d, Number(key) - 1)); return; }
    if (key === 'ArrowRight' && type !== 'range' && type !== 'radio' && type !== 'checkbox') { act(() => step(inst, 1)); return; }
    if (key === 'ArrowLeft' && type !== 'range' && type !== 'radio' && type !== 'checkbox') { act(() => step(inst, -1)); return; }
    if ((key === 'ArrowDown' || key === 'ArrowUp') && d && tag0 !== 'INPUT' && !t.closest('.an-ord')) { if (d.dataset.decisionMode !== 'order' && d.dataset.decisionMode !== 'slider') act(() => moveOption(d, key === 'ArrowDown' ? 1 : -1)); return; }
    if ((key === 'ArrowRight' || key === 'ArrowLeft') && (type === 'radio' || type === 'checkbox') && !d) return;
    if (key === 'PageDown') { act(() => stepLevel(inst, 1)); return; }
    if (key === 'PageUp') { act(() => stepLevel(inst, -1)); return; }
    if (key === 'Home' && type !== 'range' && !inst.lite) { act(() => go(inst, 0)); return; }
    if (key === 'End' && type !== 'range' && !inst.lite) { act(() => go(inst, inst.stages.findIndex(s => s.kind === 'review'))); return; }
    if (onButton && (key === ' ')) return;
    const k = key.toLowerCase();
    if (k === 'n' && d) { const n = d.querySelector('.an-note'); if (n) act(() => n.focus()); return; }
    if (k === 'i' && d) { act(() => toggleIssue(inst, d)); return; }
    if (k === 'l' && !inst.lite) { act(() => go(inst, inst.stages.findIndex(s => s.kind === 'list'))); return; }
    if (k === 'r') { act(() => replay(inst)); return; }
    if (k === 'b') { const ev = inst.lvs.querySelector('.an-lv[data-state="long"] .an-ev'); if (ev) act(() => ev.click()); return; }
    if (k === 'u' && !inst.lite) { act(() => firstUntouched(inst)); }
  }, true);
  // The section nav (TOC) jumps to a stage instead of scrolling to a hidden section.
  document.addEventListener('click', e => {
    const link = e.target.closest && e.target.closest('.section-nav-item');
    if (!link) return;
    const target = document.getElementById(link.dataset.sectionId || '');
    const inst = target && instances.find(i => i.root.contains(target));
    if (!inst) return;
    const idx = inst.stages.findIndex(s => s.el === target || (s.kind === 'topic' && s.group.topic === target));
    if (idx < 0) return;
    e.preventDefault(); e.stopPropagation();
    go(inst, idx);
  }, true);
  window.addEventListener('resize', () => instances.forEach(i => { drawConn(i); fitSoon(i, 60); }), { passive: true });

  /* ================= 9. boot ================= */
  function init(scope) {
    (scope || document).querySelectorAll('[data-analysis]').forEach(r => {
      if (r.parentElement && r.parentElement.closest('[data-analysis]')) return;
      if (!r.__an) setup(r);
    });
  }
  window.conceptAnalysis = { init, setup, go, step, refresh, markTouched, renderViz, replay, instances, TOUCH_MS, transMs, transCount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { init(); setTimeout(() => instances.forEach(refresh), 500); });
  else { init(); setTimeout(() => instances.forEach(refresh), 500); }
})();
```
