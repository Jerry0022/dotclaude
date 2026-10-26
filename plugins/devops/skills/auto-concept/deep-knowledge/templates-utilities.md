# Concept templates, part 39 of 43: Shared systems — tooltips, theme toggle

## App Tooltips

Page chrome on every template, like the theme toggle below: no element of a
concept page uses the native `title` attribute — it renders in the OS look,
its delay cannot be set and it never opens on keyboard focus
(`ui-defaults.md` R0/R1, gate 48b). Every hover hint is `data-tip="…"`, and
this engine renders it in the page's own tokens with the two delay tiers:
**Info** (1500 ms) is the default; **Label** (500 ms) applies only when the
tip is the element's only name (an icon-only control), shows cut-off text, or
explains a disabled control. The engine detects those three cases itself;
`data-tip-tier="label"` / `"info"` overrides the detection (e.g. `info` on a
universal ✕); `data-tip-tier="help"` (0 ms) is reserved for an "i" / "?"
button that exists only for its tip. A tip never repeats a visible label: an
item with a visible name gets only its hotkey via `data-tip-key` +
`data-tip-key-only`, and siblings of one group carry the same kind of tip
(ui-defaults R1). Once a tip has closed, the next one opens instantly within
300 ms; keyboard focus opens it instantly; the pointer can move onto it;
Escape, a click or a scroll closes it; touch opens it on long-press. A stray
`title` — page content Claude writes, an older script — is moved to
`data-tip` on sight, so the OS tooltip can never appear.

**Hotkey hints ride in the same tooltip** (ui-defaults R4b): an element with
`data-tip-key="1"` (parts joined by `+`, e.g. `⇧+1`, `Strg+Enter`) gets the
key as app-styled `<kbd class="app-kbd">` caps after its label — "Cockpit
[1]" — in ONE tooltip. There is never a second floating keycap badge next to
the element. Pair it with `aria-keyshortcuts` on the element.

```css
.app-tip {
  position: fixed;
  z-index: 10000;
  max-width: min(320px, calc(100vw - 16px));
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--panel-bg, #161b22);
  color: var(--text-color, #e6edf3);
  border: 1px solid var(--border-color, #30363d);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-line;
  overflow-wrap: anywhere;
  opacity: 0;
  transition: opacity 120ms ease;
}
.app-tip[data-open] { opacity: 1; }
.app-tip[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .app-tip { transition: none; } }
```

```javascript
(function wireAppTooltips() {
  if (window.__appTooltips) return;
  window.__appTooltips = true;
  const DELAY = { info: 1500, label: 500, help: 0 };  // R1 tiers — Info is the default; help = an "i"/"?" button that exists only for its tip
  const SKIP_MS = 300;                        // the next tip opens instantly
  const NO_ADOPT = /^(IFRAME|FRAME|LINK|STYLE|META)$/;
  const SYMBOLIC = /^[\s\p{Extended_Pictographic}\p{S}\p{P}‍️]*$/u;
  const tip = document.createElement('div');
  tip.className = 'app-tip';
  tip.id = 'app-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  let owner = null, openTimer = 0, closeTimer = 0, pressTimer = 0, lastClose = 0;

  // A native title would put the OS tooltip on top of ours: move it to
  // data-tip and keep an accessible name on an otherwise empty control.
  function adopt(el) {
    if (!el || el.nodeType !== 1 || NO_ADOPT.test(el.tagName) || !el.hasAttribute('title')) return;
    const text = el.getAttribute('title');
    el.removeAttribute('title');
    if (!text) return;
    if (!el.dataset.tip) el.dataset.tip = text;
    if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', text);
  }

  function tierOf(el) {
    const forced = el.getAttribute('data-tip-tier');
    if (forced === 'label' || forced === 'info' || forced === 'help') return forced;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return 'label';
    if (el.matches('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [tabindex]')
      && SYMBOLIC.test(el.textContent || '')) return 'label';
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis') return 'label';
    return 'info';
  }

  function describe(el, on) {
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/)
      .filter((id) => id && id !== tip.id);
    if (on) ids.push(tip.id);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight, gap = 8;
    let top = r.top - h - gap;
    if (top < 4) top = r.bottom + gap;
    const left = Math.max(4, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 4));
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  // Label text plus, for `data-tip-key`, one keycap per key part.
  // `data-tip-key-only`: the element's label is already visible, so the tip
  // carries only its keycaps — never an echo of the label (ui-defaults R1).
  function fill(el) {
    const keyOnly = el.hasAttribute('data-tip-key-only');
    tip.textContent = keyOnly ? '' : el.dataset.tip;
    const key = el.dataset.tipKey;
    if (!key) return;
    if (!keyOnly) tip.appendChild(document.createTextNode(' '));
    key.split('+').forEach((part, i) => {
      if (i) tip.appendChild(document.createTextNode('+'));
      const cap = document.createElement('kbd');
      cap.className = 'app-kbd';
      cap.textContent = part;
      tip.appendChild(cap);
    });
  }

  function show(el) {
    const text = el.dataset.tip;
    if (!text || !el.isConnected) return;
    if (!tip.isConnected) document.body.appendChild(tip);
    if (owner && owner !== el) describe(owner, false);
    owner = el;
    fill(el);
    tip.hidden = false;
    place(el);
    tip.setAttribute('data-open', '');
    describe(el, true);
  }

  function hide() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (!owner) return;
    describe(owner, false);
    owner = null;
    tip.removeAttribute('data-open');
    tip.hidden = true;
    lastClose = Date.now();
  }

  function schedule(el, instant) {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (owner === el) return;
    if (owner) hide();
    const wait = instant || Date.now() - lastClose < SKIP_MS ? 0 : DELAY[tierOf(el)];
    openTimer = setTimeout(() => show(el), wait);
  }

  const triggerOf = (node) => (node instanceof Element ? node.closest('[data-tip]') : null);

  function boot() {
    document.querySelectorAll('[title]').forEach(adopt);
    new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === 'attributes') {
          if (rec.attributeName === 'title') adopt(rec.target);
          else if (rec.target === owner) {
            if (owner.dataset.tip) { fill(owner); place(owner); } else hide();
          }
          continue;
        }
        rec.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          adopt(n);
          n.querySelectorAll('[title]').forEach(adopt);
        });
      }
    }).observe(document.documentElement,
      { subtree: true, childList: true, attributes: true, attributeFilter: ['title', 'data-tip', 'data-tip-key'] });
  }

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    if (tip.contains(e.target)) { clearTimeout(closeTimer); return; }
    const el = triggerOf(e.target);
    if (el) schedule(el, false);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const to = e.relatedTarget;
    if (to instanceof Node && (tip.contains(to) || (owner && owner.contains(to)))) return;
    if (!triggerOf(e.target) && !tip.contains(e.target)) return;
    clearTimeout(openTimer);
    if (owner) closeTimer = setTimeout(hide, 120);
  });
  // Keyboard focus opens instantly; focus from a click does not (the pointer
  // runs its own delay), so the last input modality decides.
  let viaKeyboard = false;
  document.addEventListener('focusin', (e) => {
    const el = triggerOf(e.target);
    if (el && viaKeyboard) schedule(el, true);
  });
  document.addEventListener('focusout', (e) => { if (owner && owner.contains(e.target)) hide(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
    else viaKeyboard = true;
  }, true);
  document.addEventListener('pointerdown', (e) => {
    viaKeyboard = false;
    if (!tip.contains(e.target)) hide();
    if (e.pointerType !== 'touch') return;
    const el = triggerOf(e.target);
    if (el) pressTimer = setTimeout(() => show(el), DELAY.label);
  }, true);
  ['pointerup', 'pointercancel'].forEach((type) =>
    document.addEventListener(type, () => clearTimeout(pressTimer), true));
  window.addEventListener('scroll', hide, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
```

## Theme Toggle

The page defaults to **dark** (`<html data-theme="dark">`, see § Common
Structure); a project's `reference.md` may override the default, the user's
choice is persisted as `state['theme']` (§ State Persistence). The control is
`#theme-toggle` in the ☰ panel's `.panel-head` row — page chrome on every
template, never in the content column, never a FAB (the two FABs are a closed
pair, gate P13). It flips `data-theme` and names the NEXT action: while dark
the ☀️ glyph shows (CSS, § Panel Chrome) and the tooltip reads
`{{theme.to_light}}`; while light, 🌙 and `{{theme.to_dark}}`.

```javascript
// Null-guarded (#341): a page whose panel predates the head row has no
// #theme-toggle, and an unguarded dereference here threw at boot and took the
// rest of the script with it — the tab-switch boot never ran, so the "you are
// here" head stayed empty until the first manual tab click.
(() => {
  const html = document.documentElement;
  const wire = () => {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    // Tooltip + a11y label name the NEXT action, exactly like the ☰/💬 FABs.
    // Read off the button's own dataset — the locale substitution happened
    // once, at generation time, in the markup. The glyph is CSS
    // (html[data-theme] → [data-glyph]), so nothing here touches the spans.
    const sync = () => {
      const next = html.getAttribute('data-theme') === 'dark' ? btn.dataset.labelLight : btn.dataset.labelDark;
      if (!next) return;
      btn.setAttribute('data-tip', next);
      btn.setAttribute('aria-label', next);
    };
    btn.addEventListener('click', () => {
      const current = html.getAttribute('data-theme');
      html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
      sync();
      // § State Persistence saves on `change`/`input`; a <button> click fires
      // neither, so the choice would only reach localStorage with the user's
      // next keystroke — and a reload in between reverted the theme. Same
      // explicit-save pattern as showScreen()/applyViewport().
      if (typeof saveState === 'function') saveState();
    });
    // data-theme has more than one writer: restoreState() sets it on load
    // (and again on the bridge draft restore), so the label follows the
    // attribute itself rather than only this button's click.
    new MutationObserver(sync).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    sync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
```

