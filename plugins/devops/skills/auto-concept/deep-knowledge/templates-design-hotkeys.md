# Concept templates, part 19 of 41: Template: design — hotkey overlay, Space and nudges

## Hotkey overlay, Space and nudges — `wireChromeHotkeys()`

Runs on EVERY template (decision, free, design), so the plain-mode pages get
the same hotkeys and tips as a design round. Three jobs:

- **Space** toggles the notes dock (a click on `#feedback-toggle`, like `N`),
  only when focus is not in a field, the dock, a bubble or a pin editor and
  not on a native button / link (which keep their own Space); it calls
  `preventDefault()`, so the page never scrolls. Space no longer advances
  screens or the overview overlay — that moved to the arrow keys.
- **Alt held** = `body.hk-alt` plus `#hk-overlay`: one `kbd.hk-badge` at the
  top-right of every `[data-tip-key]` control that is on screen, and — on a
  design page — an example own pin labelled "Ctrl + click". Alt up, window
  blur or a tab switch removes it. The "Design öffnen" button of the overview
  shows its key from the same class.
- **Nudges** — a quiet tip tab (`#hk-nudge.hk-nudge`) sitting on top of the
  status toast: key caps, a text that names the word "Hotkey(s)", a 1.5px
  timer line, ✕. It appears only when the engine sees the user doing by mouse
  what a hotkey does faster: switching variants (2 mouse clicks on the quick
  nav in 90 s), clicking through pages (3), opening the dock by click (2),
  submitting the round by mouse, and — once — on the first visit
  ("Halte Alt für alle Hotkeys"). It auto-expires after 9 s; ✕ silences that
  one nudge for 30 days (`localStorage` `concept-nudge:<id>` = timestamp,
  every access in try / catch). Never two nudges within 60 s.
  **Tip rules** (shared with the dock's "Wusstest du schon?", § Panel chrome):
  a nudge is shown at most ONCE per page session; at most twice ever
  (`hint-nudge-shown:<id>`, the Alt tip once); and never again once the
  user has used that hotkey (`hint-hotkey-used:<id>`, recorded on the
  first real use — Space, Alt, 1–9, arrows, Ctrl + Enter, F, V, Esc,
  Ctrl + click on the design). Every nudge is one line (`nowrap` +
  ellipsis) in the calm `--tip-color`, never the amber of open questions.
  `window.conceptHotkeyUsed(id)` reads the used state for the dock tips.
  **Contract for the toast:** the tab's bottom edge is
  `bottom: var(--hk-nudge-bottom, 6.5rem)`; the toast code sets that custom
  property on `:root` to the toast's height + gap (nothing else is shared).
  `window.conceptNudge(id, caps, text)` shows one by hand; `window.conceptNudgeSilenced(id)`
  reads the 30-day state.

```javascript
(function wireChromeHotkeys() {
  const T = {
    alt: '{{nudge.alt}}', variants: '{{nudge.variants}}', pages: '{{nudge.pages}}',
    dock: '{{nudge.dock}}', submit: '{{nudge.submit}}', dismiss: '{{nudge.dismiss}}',
    space: '{{design.key_space}}', ctrl: '{{design.key_ctrl}}', click: '{{design.keys_click}}'
  };
  const body = document.body;
  const DAY = 86400000;
  const TTL = 30 * DAY;
  const BASE = 'concept-nudge:';
  const fieldIn = t => !!(t && t.closest && t.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"], #feedback-dock, .anno-bubble, .upin-editor'));
  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // The dock FAB names its hotkey like every other hotkey-bound control.
  const fab = document.getElementById('feedback-toggle');
  if (fab && !fab.dataset.tipKey) fab.dataset.tipKey = T.space;

  // ── Space → notes dock ──────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || (e.key !== ' ' && e.code !== 'Space')) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (fieldIn(e.target)) return;
    if (document.getElementById('decision-panel')?.classList.contains('open')) return;
    const t = document.activeElement;
    if (t && t.closest && t.closest('button, a[href], summary, select')) return;
    const toggle = document.getElementById('feedback-toggle');
    if (!toggle) return;
    e.preventDefault();
    toggle.click();
  });

  // ── Alt held → every hotkey badge ───────────────────────────────────
  let layer = null;
  const visible = n => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  function showKeys() {
    if (layer) return;
    body.classList.add('hk-alt');
    layer = mk('div', 'hk-overlay');
    layer.id = 'hk-overlay';
    layer.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('[data-tip-key]').forEach(n => {
      if (!visible(n)) return;
      const r = n.getBoundingClientRect();
      const badge = mk('kbd', 'app-kbd hk-badge', n.dataset.tipKey);
      badge.style.left = Math.round(r.right) + 'px';
      badge.style.top = Math.round(r.top) + 'px';
      layer.appendChild(badge);
    });
    const onDesign = document.querySelector('section[data-design]')
      && body.dataset.overviewActive !== 'true' && body.dataset.viewActive !== 'true';
    if (onDesign) {
      const ex = mk('div', 'hk-pin-example');
      ex.append(mk('span', 'hk-pin-dot'), mk('span', 'hk-pin-label', T.ctrl + ' + ' + T.click));
      layer.appendChild(ex);
    }
    body.appendChild(layer);
  }
  function hideKeys() {
    body.classList.remove('hk-alt');
    if (layer) { layer.remove(); layer = null; }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Alt' && !e.repeat) showKeys(); });
  document.addEventListener('keyup', e => { if (e.key === 'Alt') hideKeys(); });
  window.addEventListener('blur', hideKeys);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideKeys(); });

  // ── Nudges ──────────────────────────────────────────────────────────
  function silenced(id) {
    try {
      const at = Number(localStorage.getItem(BASE + id));
      return !!at && Date.now() - at < TTL;
    } catch (e) { return false; }
  }
  function silence(id) {
    if (typeof _guardedSetItem === 'function') _guardedSetItem(BASE + id, String(Date.now()));
  }
  let lastShown = 0;
  let current = null;
  function hideNudge() {
    if (!current) return;
    clearTimeout(current.timer);
    current.node.remove();
    current = null;
  }
  // Tip rules (see the prose above): once per session, ≤ MAX_SHOWS ever,
  // never after the hotkey was used. A Space tip that showed five times in
  // one session was the bug that made these rules.
  const USED = 'hint-hotkey-used:';
  const SHOWN = 'hint-nudge-shown:';
  const MAX_SHOWS = { alt: 1 };
  const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { if (typeof _guardedSetItem === 'function') _guardedSetItem(k, v); };
  const usedNow = new Set();
  function hotkeyUsed(id) { return usedNow.has(id) || !!read(USED + id); }
  function markUsed(id) {
    if (usedNow.has(id)) return;
    usedNow.add(id);
    write(USED + id, String(Date.now()));
  }
  window.conceptHotkeyUsed = hotkeyUsed;
  const sessionShown = new Set();
  function nudge(id, caps, text) {
    if (silenced(id) || current || Date.now() - lastShown < 60000) return false;
    if (sessionShown.has(id) || hotkeyUsed(id)) return false;
    const shows = Number(read(SHOWN + id)) || 0;
    if (shows >= (MAX_SHOWS[id] || 2)) return false;
    sessionShown.add(id);
    write(SHOWN + id, String(shows + 1));
    lastShown = Date.now();
    const node = mk('div', 'hk-nudge');
    node.id = 'hk-nudge';
    node.setAttribute('role', 'status');
    node.dataset.nudge = id;
    const keys = mk('span', 'hk-nudge-keys');
    caps.forEach(c => keys.appendChild(mk('kbd', 'hk-nudge-key', c)));
    const x = mk('button', 'hk-nudge-x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', T.dismiss);
    x.dataset.tip = T.dismiss;
    x.dataset.tipTier = 'info';
    x.addEventListener('click', () => { silence(id); hideNudge(); });
    node.append(keys, mk('span', 'hk-nudge-text', text), x, mk('i', 'hk-nudge-timer'));
    document.body.appendChild(node);
    current = { node, timer: setTimeout(hideNudge, 9000) };
    return true;
  }
  window.conceptNudge = nudge;
  window.conceptNudgeSilenced = silenced;

  // Real hotkey use ends that hotkey's tips for good (capture phase, so a
  // handler that stops the event still counts; fields only for Ctrl + Enter).
  document.addEventListener('keydown', e => {
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'Enter') { markUsed('submit'); return; }
    if (k === 'Alt') { markUsed('alt'); return; }
    if (k === 'Escape' && e.target && e.target.closest && e.target.closest('#feedback-dock')) { markUsed('dock-esc'); return; }
    if (fieldIn(e.target) || mod || e.altKey) return;
    if (k === ' ') markUsed('dock');
    else if (/^[1-9]$/.test(k)) markUsed('variants');
    else if (/^Arrow/.test(k)) markUsed('pages');
    else if (k === 'f' || k === 'F') markUsed('fav');
    else if (k === 'v' || k === 'V') markUsed('view');
    else if (k === 'Escape') markUsed('esc');
  }, true);
  document.addEventListener('click', e => {
    if ((e.ctrlKey || e.metaKey) && e.target && e.target.closest && e.target.closest('section[data-design]')) markUsed('upin');
  }, true);

  // Mouse moments. detail > 0 = a real pointer click (a keyboard "click"
  // reports 0), so using the hotkey never counts as the slow way.
  const counts = {};
  const hit = (id, need) => {
    const now = Date.now();
    const list = (counts[id] = (counts[id] || []).filter(t => now - t < 90000));
    list.push(now);
    return list.length >= need;
  };
  document.addEventListener('click', e => {
    if (!(e.detail > 0) || !e.target || !e.target.closest) return;
    const t = e.target;
    if (t.closest('.design-quick-seg') && hit('variants', 2)) {
      const n = document.querySelectorAll('.design-quick-designs > .design-quick-seg, .design-quick-designs > .design-quick-group').length;
      const caps = [];
      for (let i = 1; i <= Math.min(n, 3); i++) caps.push(String(i));
      if (caps.length) nudge('variants', caps, T.variants.replace('{n}', String(Math.min(n, 9))));
    } else if (t.closest('.design-quick-page, .design-quick-vitem, .screen-nav-item') && hit('pages', 3)) {
      nudge('pages', ['←', '→'], T.pages);
    } else if (t.closest('#feedback-toggle') && hit('dock', 2)) {
      nudge('dock', [T.space], T.dock);
    } else if (t.closest('#submit-iterate-btn')) {
      nudge('submit', [T.ctrl, 'Enter'], T.submit);
    }
  }, true);
  // First visit: once, a few seconds after the page settled.
  setTimeout(() => { nudge('alt', ['Alt'], T.alt); }, 7000);
})();
```

```css
/* Alt overlay: badges sit at the control's top-right, right-aligned, slightly overlapping. */
.hk-overlay { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
.hk-badge {
  position: fixed; transform: translate(-100%, -35%); margin: 0; z-index: 1;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); animation: hk-pop 0.14s ease both;
}
.hk-pin-example {
  position: fixed; left: 62%; top: 58%; display: flex; align-items: center; gap: 0.5rem;
  animation: hk-pop 0.18s ease both;
}
.hk-pin-dot {
  width: 22px; height: 22px; border-radius: 50%; background: var(--accent-color, #388bfd);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-color, #388bfd) 28%, transparent), 0 0 22px var(--accent-color, #388bfd);
}
.hk-pin-label {
  padding: 0.25rem 0.7rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; color: var(--text, #e6edf3);
  background: color-mix(in srgb, var(--panel-bg, #0d1117) 92%, transparent); border: 1px solid var(--border-color, #30363d);
}
@keyframes hk-pop { from { opacity: 0; transform: translate(-100%, -35%) scale(0.85); } }
.hk-pin-example { animation-name: hk-fade; }
@keyframes hk-fade { from { opacity: 0; } }

/* Nudge tab: quiet, almost no background, coloured key caps, 1.5px timer line. */
.hk-nudge {
  position: fixed; left: 50%; bottom: var(--hk-nudge-bottom, 6.5rem); transform: translateX(-50%); z-index: 9000;
  display: flex; align-items: center; gap: 0.6rem; max-width: min(92vw, 560px); box-sizing: border-box;
  padding: 0.4rem 0.7rem 0.45rem; border-radius: 12px 12px 0 0; overflow: hidden;
  font-size: 0.9rem; color: var(--text-secondary, #8b949e); white-space: nowrap;
  background: color-mix(in srgb, var(--panel-bg, #0d1117) 55%, transparent);
  backdrop-filter: blur(6px); animation: hk-nudge-in 0.25s ease both;
}
.hk-nudge-keys { display: inline-flex; gap: 0.25rem; }
.hk-nudge-key {
  min-width: 1.5rem; padding: 0.1rem 0.4rem; border-radius: 6px; text-align: center; font: inherit; font-weight: 800;
  color: #04141c; background: var(--tip-color, #3fa7d6); box-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
}
.hk-nudge-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.hk-nudge-x {
  flex: none; width: 1.5rem; height: 1.5rem; padding: 0; border: 0; border-radius: 50%; background: transparent;
  color: inherit; font: inherit; cursor: pointer;
}
.hk-nudge-x:hover, .hk-nudge-x:focus-visible { background: rgba(255, 255, 255, 0.1); color: var(--text, #e6edf3); }
.hk-nudge-timer {
  position: absolute; left: 0; bottom: 0; height: 1.5px; width: 100%; transform-origin: 0 50%;
  background: var(--tip-color, #3fa7d6); animation: hk-nudge-timer 9s linear both;
}
@keyframes hk-nudge-in { from { opacity: 0; transform: translateX(-50%) translateY(6px); } }
@keyframes hk-nudge-timer { to { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) {
  .hk-badge, .hk-pin-example, .hk-nudge { animation: none; }
  .hk-nudge-timer { animation: none; transform: scaleX(0.5); }
}
```
