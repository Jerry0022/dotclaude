# Concept templates, part 41 of 46: Shared systems — iteration tabs

## Iteration Tabs

Iterations of a concept page are appended as `<section data-iteration="N">`
blocks inside the same HTML file. `nav.iteration-tabs` still lives at the top
of the panel's scroll box exactly as it always has, so the append checklist
(one plain chip, string-appended) never changes — but the bar itself is no
longer the visible round switcher: `buildIterationTree()` hides it
(`.iteration-tabs { display: none }`, § Tab Bar CSS) and re-derives the 🕘
rounds chip + its list in the pinned head (`.panel-here`, § Common Structure)
from the same chips. All three templates support iterations — design and
free include them identically.

**At runtime the bar is one tree ("Kompass", § Section Navigation):** the
selected chip's TOC is `#section-nav`, built fresh by `buildSectionNav()` and
shown alone in the scroll box (the tree no longer holds the other rounds);
every other chip carries a generated `.iteration-tab-summary` line, consumed
by `buildRoundsChip()` for the head's 🕘 rounds list and never rendered on
screen itself. None of that is written into the HTML — the markup below
stays a flat list of `<button class="iteration-tab">` chips, appended by
string edit, and the JS re-derives the head chip/list from it on every load
and every switch.

### Tab Bar HTML

```html
<nav class="iteration-tabs" role="tablist" aria-label="{{iteration.label}}">
  <button class="iteration-tab" role="tab"
          data-iteration="1" aria-selected="false" aria-controls="iter-1">
    Iteration 1
  </button>
  <!-- Reality-check tab: a NORMAL iteration in every mechanical respect —
       it keeps the running data-iteration counter, both submit buttons, and
       the ordinary freeze behaviour. Only the label and the
       data-reality-check flag differ, so the user can see at a glance why an
       implement click produced another round. Appended only by the implement
       path when the default branch drifted; never two in a row. See
       reality-check.md. -->
  <button class="iteration-tab" role="tab" data-reality-check
          data-iteration="2" aria-selected="false" aria-controls="iter-2">
    {{iteration.reality_tab}}
  </button>
  <!-- Final-report tab: same DOM contract (data-iteration carries the
       running counter), distinct labelling + the data-final-report
       flag so .iteration-tab[data-final-report] CSS + panel JS pick
       it up. The label is the locale string {{iteration.final_tab}},
       NEVER "Iteration N". Only the implement-action path appends
       this — at most one per concept session. -->
  <button class="iteration-tab" role="tab" data-final-report
          data-iteration="3" aria-selected="true" aria-controls="iter-3">
    {{iteration.final_tab}}
  </button>
</nav>

<main>
  <section id="iter-1" data-iteration="1" data-iteration-template="decision" hidden>…frozen round 1…</section>
  <section id="iter-2" data-iteration="2" data-iteration-template="decision" data-reality-check hidden>…frozen reality check…</section>
  <section id="iter-3" data-iteration="3" data-iteration-template="free" data-final-report data-active>
    …final report (Abschlussbericht)…
  </section>
</main>
```

Rules:
- Exactly one section carries `data-active`. The matching tab has
  `aria-selected="true"`.
- A new chip is appended as a plain `<button class="iteration-tab">` at the
  END of `nav.iteration-tabs` — never with a hand-written
  `.iteration-tab-summary`, never a hand-built rounds chip/list. The tree
  (summaries, the moved `#section-nav`, the head's rounds chip/list) is
  rebuilt by `buildSectionNav()` on load and on every switch; markup that
  pre-empts it is simply re-derived.
- Non-active sections get the `hidden` attribute AND are frozen
  (see "Freezing Past Iterations").
- Tabs stay clickable — switching tab reveals the chosen section and
  hides all others.
- A concept session has **at most one** `data-final-report` section.
  Once it exists, no further iterate/implement submissions are
  accepted (the panel-final-report has no such buttons). The only
  submission the final-report tab can produce is `action: "finalize"`.
- `data-reality-check` marks a round the implement path inserted because the
  default branch drifted. It goes on **both** the section and its tab, and it
  is load-bearing, not decorative: submitting implement from a section that
  carries it skips the check and implements immediately, which is what stops
  two forced rounds in a row. The section additionally carries
  `data-reality-head="<sha>"` — the commit that check examined, which the
  baseline advances to once the round is answered. A concept may contain several over its life —
  but never two adjacent ones, because the round after a reality check is
  always either the implementation or an ordinary iterate round. See
  `reality-check.md`.

### Reality-check section explainer

The first child of a `data-reality-check` section, before any decision card.
It answers the only question the user has at that moment — "I clicked
implement, why am I reading this?" — and it is copied with the wording from
the locale table, never improvised:

```html
<section id="iter-2" data-iteration="2" data-iteration-template="decision" data-reality-check
         data-reality-head="9be03d1f4c22" data-active>
  <div class="reality-banner" role="note">
    <h2>{{reality.headline}}</h2>
    <p>{{reality.intro}}</p>
    <p class="reality-evidence">4f2a1c9 · feat(hooks): rename pre.x → pre.y<br>
       9be03d1 · refactor(bridge): /status payload now requires version</p>
    <p class="reality-reassure">{{reality.reassure}}</p>
  </div>
  <!-- …one flat, independently answerable decision card per drift item… -->
</section>
```

`.reality-evidence` carries the actual commits — short SHA + subject, one per
line. It is not optional: a drift claim the user cannot verify is a claim they
have to take on trust, and `reality-check.md` § Force classes forbids showing
a card without that evidence.

### Tab Bar CSS

```css
/* The bar is no longer the round switcher — the 🕘 rounds chip + list in
   .panel-here (§ Common Structure) took over that job. It stays in the DOM,
   hidden, so the append checklist and the chips' click listeners never
   change: buildIterationTree()/buildRoundsChip() read data-tab-label,
   aria-selected and the generated .iteration-tab-summary straight off these
   (invisible) buttons. */
.iteration-tabs {
  display: none;
}
/* Generated summary line (buildIterationTree): "14 Einträge · 3 verworfen".
   Computed here and consumed by buildRoundsChip() for the head's rounds
   list — the bar itself never renders it on screen. */
.iteration-tab-summary {
  display: block;
  margin-top: 2px;
  font-size: 0.72rem;
  font-weight: 400;
  color: var(--text-secondary, #8b949e);
}
.iteration-tab {
  flex: 0 0 auto;
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  background: var(--bg-subtle, transparent);
  color: var(--text-secondary, #8b949e);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.iteration-tab:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
  color: var(--text-color, #c9d1d9);
}
.iteration-tab[aria-selected="true"] {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent);
  color: var(--text-color, #c9d1d9);
  border-color: var(--accent-color, #58a6ff);
  font-weight: 600;
}
.iteration-tab[aria-selected="true"]::before {
  content: "● ";
  color: var(--accent-color, #58a6ff);
}
section[data-iteration]:not([data-active]) {
  opacity: 0.85;
}
/* Kills every input on a frozen tab — which is exactly why the mapping view
   toggle, tabs and collapse controls (§ Information Mapping) are <button>s:
   a frozen mapping stays browsable while its checkboxes go inert. */
section[data-iteration]:not([data-active]) .tri-state-btn,
section[data-iteration]:not([data-active]) input,
section[data-iteration]:not([data-active]) textarea,
section[data-iteration]:not([data-active]) select {
  pointer-events: none;
  filter: grayscale(0.4);
}
```

### Freezing Past Iterations

On a built page (`step2-build.md`) steps 1–3 are applied by `concept-build.js
build` and the submitted values (step 4) by `bake`; the rules below are what
both guarantee. When appending iteration N+1, the previous section is frozen:

1. Remove `data-active`, add `hidden` to the previous `<section>`.
   **`data-active` is the ONLY attribute a freeze removes from the section
   element.** Every other `data-*` on it — `data-iteration`,
   `data-iteration-template`, `data-final-report`, `data-reality-check` —
   survives verbatim. This is not cosmetic bookkeeping: `data-reality-check`
   is what tells the implement path that this round was already the forced
   one, and dropping it while rewriting the file re-arms a check that has
   already been answered.
2. On every `input`, `textarea`, `select`, `button` inside it: set `disabled`.
3. On every `textarea`, `input[type="text"]`: set `readonly`.
4. For bi-state buttons: keep the `aria-pressed`/selected class exactly as
   the user submitted it — do NOT clear selections.
5. Add a small "Eingefroren — Runde N" banner at the top (optional).

### Tab Switch JS

```javascript
// Resolve the template of ONE iteration section. Authoritative source is
// data-iteration-template; `prototype` is the legacy alias of `design`;
// a missing attribute falls back to the current <html data-template> so
// pages generated before per-iteration templates behave exactly as before.
// The page-level attribute as it was WRITTEN AT GENERATION TIME, captured at
// script load — before applyIterationTemplate() can project anything onto it.
const _pageTemplateAtLoad = document.documentElement.dataset.template || '';

// The concept's BASE template: the first iteration section that declares one.
// This — never the live <html data-template> — is the fallback for a section
// that declares none. That attribute is a PROJECTION rewritten on every tab
// switch, so using it as the fallback made an undeclared section's layout
// depend on which tab the user arrived from: the same final report rendered
// as a fullscreen canvas when reached from a design tab and as a document
// when reached from a decision tab. Observed on a real generated page whose
// final-report section shipped without data-iteration-template. Deterministic
// or not at all.
let _baseTemplate = null;
function baseIterationTemplate() {
  if (_baseTemplate) return _baseTemplate;
  // LOWEST iteration number, not first-in-DOM: sections are appended in order
  // today, but a re-sync or a hand edit that moves one (a reality-check round
  // pulled up, a final report hoisted) would otherwise silently redefine the
  // base template for every section that declares none.
  const declared = Array.from(
    document.querySelectorAll('section[data-iteration][data-iteration-template]')
  ).sort((a, b) => (parseInt(a.dataset.iteration, 10) || 0) - (parseInt(b.dataset.iteration, 10) || 0));
  const raw = (declared[0] && declared[0].dataset.iterationTemplate) || _pageTemplateAtLoad || 'decision';
  _baseTemplate = raw === 'prototype' ? 'design' : raw;
  return _baseTemplate;
}

function resolveIterationTemplate(section) {
  const raw = (section && section.dataset && section.dataset.iterationTemplate)
    || baseIterationTemplate();
  return raw === 'prototype' ? 'design' : raw;
}

// Project the shown iteration's template onto <html> and lock/unlock body
// scroll. Everything else (layout, panel docking, FABs, dock) is pure CSS off
// [data-template="design"] — no per-iteration layout code beyond these two
// lines. Called FIRST from showIteration().
function applyIterationTemplate(section) {
  const template = resolveIterationTemplate(section);
  document.documentElement.dataset.template = template;
  document.body.style.overflow = template === 'design' ? 'hidden' : '';
  return template;
}

function showIteration(n) {
  // MUST run first: the layout must be correct before buildSectionNav() or
  // any iteration:changed listener measures/renders against it.
  applyIterationTemplate([...document.querySelectorAll('section[data-iteration]')]
    .find(sec => String(sec.dataset.iteration) === String(n)));
  document.querySelectorAll('section[data-iteration]').forEach(sec => {
    const match = String(sec.dataset.iteration) === String(n);
    sec.hidden = !match;
  });
  document.querySelectorAll('.iteration-tab').forEach(tab => {
    const match = String(tab.dataset.iteration) === String(n);
    tab.setAttribute('aria-selected', match ? 'true' : 'false');
  });
  const activeSec = document.querySelector('section[data-iteration][data-active]');
  const isLive = activeSec && String(activeSec.dataset.iteration) === String(n);
  // The live section may be a regular iteration OR a final report. The
  // panel switches between three live states (ready / submitted / final)
  // plus the frozen state for non-live tabs.
  const isFinal = isLive && activeSec.hasAttribute('data-final-report');
  document.body.classList.toggle('viewing-frozen', !isLive);
  document.body.classList.toggle('viewing-final', !!isFinal);
  const panelReady = document.getElementById('panel-ready');
  const panelSubmitted = document.getElementById('panel-submitted');
  const panelFrozen = document.getElementById('panel-frozen');
  const panelFinal = document.getElementById('panel-final-report');
  // ready and submitted are mutually exclusive (#341): submitWithAction hides
  // the ready block, and a detour into a past tab and back must not bring
  // it back under the submitted indicator — that showed both blocks at once
  // (126px in a 120px foot) with live submit buttons under "übermittelt".
  const submitted = document.body.classList.contains('concept-submitted');
  if (panelReady) panelReady.style.display = (isLive && !isFinal && !submitted) ? 'block' : 'none';
  if (panelSubmitted) {
    panelSubmitted.style.display = (isLive && !isFinal && submitted) ? 'block' : 'none';
  }
  // 'flex', not 'block': #panel-final-report is a flex column (§ CTA foot
  // CSS) so it can hand #closeout-sheet a bounded, shrinkable height — a
  // plain 'block' display left the sheet sizing to its own content with
  // nothing to cap it, and the close-out buttons sat below the fold.
  if (panelFinal) panelFinal.style.display = isFinal ? 'flex' : 'none';
  if (panelFrozen) panelFrozen.style.display = isLive ? 'none' : 'block';
  // Frozen veil + floating bar. Every entry into a non-live tab RE-LOCKS the
  // round behind the shared content dimmer (lockFrozenView), so at most the
  // one past round on screen can be unlocked and any tab switch — to another
  // past round or back to the live one — relocks it. The bar stays up after
  // the user lifts the veil: the veil is clicked away by reflex, the bar is
  // what still tells them they are in history. On the live tab the dimmer is
  // hidden (a veil lifted on a past round must not reappear over the live one)
  // unless the live round itself is sent and waiting on Claude.
  const frozenBar = document.getElementById('frozen-bar');
  if (frozenBar) {
    frozenBar.hidden = !!isLive;
    const title = frozenBar.querySelector('[data-frozen-bar-title]');
    const tab = document.querySelector('.iteration-tab[data-iteration="' + n + '"]');
    if (title) title.textContent = tab ? (tab.dataset.tabLabel || tab.textContent.trim()) : String(n);
  }
  // A sent live round is veiled too (restoreInFlightRound() after a reload,
  // submitWithAction() before it): coming back to it from a past tab relocks
  // it like any tab switch does. Only a click/Escape lifts the veil.
  if (isLive && !submitted) hideContentDimmer(); else lockFrozenView();
  // Pinned "you are here" head: the selected tab's label — no "· aktiv"
  // suffix on the live round, an {{nav.archived}} marker on a frozen one —
  // plus, on a frozen tab, the compact "↩ zur Runde N" link back to the live
  // round. The label comes from data-tab-label when the summary line has
  // been added to the chip (buildSectionNav), otherwise from the chip text
  // itself. The reading-line parenthesis (updateHereRoundParenthesis) is
  // re-applied by the scroll spy right after this, off the fresh base.
  // The round label sits in the .panel-head row (one line with the 🕘 chip,
  // theme toggle and ✕); the sub-line stays in #panel-here — hence the
  // document-wide lookup for the label and the box-scoped one for the rest.
  const here = document.getElementById('panel-here');
  if (here) {
    const hereTab = document.querySelector('.iteration-tab[data-iteration="' + n + '"]');
    const round = document.querySelector('[data-here-round]');
    if (round) {
      const label = hereTab ? (hereTab.dataset.tabLabel || stripActiveSuffix(hereTab.textContent.trim())) : String(n);
      // Phase icon: "🧭 Runde N" while concepting, "🏁 Abschluss" on the
      // final report — the head names the phase the session is in.
      const finalTab = isFinal || (hereTab && hereTab.hasAttribute('data-final-report'));
      const phase = finalTab ? '🏁 {{final.phase}}' : '🧭 ' + label;
      round.dataset.phase = finalTab ? 'final' : 'round';
      round.dataset.hereRoundBase = phase + (isLive ? '' : ' · {{nav.archived}}');
      round.textContent = round.dataset.hereRoundBase;
    }
    // The final report drops the second head line entirely — the close-out
    // inbox is the panel body there.
    const section = here.querySelector('[data-here-section]');
    if (section && isFinal) section.hidden = true;
    const back = document.getElementById('panel-here-back');
    if (back) {
      back.hidden = !!isLive;
      back.textContent = '↩ {{panel.here_back}} ' + (activeSec ? activeSec.dataset.iteration : '');
    }
  }
  if (typeof renderPanelStatus === 'function') renderPanelStatus();
  if (typeof buildSectionNav === 'function') buildSectionNav();
  if (typeof refreshCloseout === 'function') refreshCloseout({ reset: true });
  document.dispatchEvent(new CustomEvent('iteration:changed'));
}

document.querySelectorAll('.iteration-tab').forEach(tab => {
  tab.addEventListener('click', () => showIteration(tab.dataset.iteration));
});

// A NEW live round opens at the top / first page on plain pages too (the
// design overview does the same with its own concept-last-round key and skips
// this one: body[data-overview]). Per viewer: localStorage remembers the last
// live round this page showed; the first ever visit restores as usual.
(function openNewRoundAtTop() {
  const KEY = 'rounds-last-live:' + location.pathname;
  document.addEventListener('iteration:changed', () => {
    setTimeout(() => {
      if (document.body.dataset.overview === 'true') return;
      const live = document.querySelector('section[data-iteration][data-active]');
      const vis = document.querySelector('section[data-iteration]:not([hidden])');
      if (!live || vis !== live) return;
      const now = String(live.dataset.iteration);
      let last = null;
      try { last = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
      if (typeof _guardedSetItem === 'function') _guardedSetItem(KEY, now);
      if (last && last !== now) {
        if (typeof window.showScreen === 'function') { const s = live.querySelector('.screen'); if (s && s.id) try { window.showScreen(s.id); } catch (e) { /* no design layout */ } }
        window.scrollTo(0, 0);
      }
    }, 0);
  });
})();

// The way back to the live round. Without it the only exit from a past tab is
// to spot which chip is the live one — and the live tab is not always the last
// chip (the final report is), so guessing is a real failure mode. Two entry
// points, one target: the panel's #back-to-live-btn and the floating
// #frozen-bar-back (the bar sits over the content, where the user's eyes are
// after they lift the veil — the panel link alone was too easy to miss).
function goToLiveIteration() {
  const live = document.querySelector('section[data-iteration][data-active]');
  if (live) showIteration(live.dataset.iteration);
}
document.getElementById('back-to-live-btn')?.addEventListener('click', goToLiveIteration);
document.getElementById('frozen-bar-back')?.addEventListener('click', goToLiveIteration);
document.getElementById('panel-here-back')?.addEventListener('click', goToLiveIteration);

document.addEventListener('DOMContentLoaded', () => {
  const active = document.querySelector('section[data-iteration][data-active]');
  if (active) showIteration(active.dataset.iteration);
});
```

### Reload Polling

A Claude-driven reload (next iteration / final-report append) MUST land the
user at the top of the page. Without this, the browser restores the previous
scroll position — the user submitted from the bottom of the decision panel,
sees the page "do nothing" visually, and only notices the change because the
iteration tab moved. The sessionStorage flag scopes the jump to reloads we
triggered, so manual F5 while reading still preserves scroll position.

The `counter > _bootReloadCounter` comparison is restart-safe without any
client logic: the server seeds its in-memory counter from epoch milliseconds
(#225), so a restarted bridge always reports a counter ahead of anything the
previous run handed out. An open tab sees the restart as a normal advance and
force-reloads once — the desired re-sync after Claude re-launched the bridge
mid-session.

```javascript
let _bootReloadCounter = null;
async function pollReload() {
  if (!_reloadBackoff.due(Date.now())) return;   // § Claude Connection Heartbeat: makeBackoff
  try {
    const res = await fetch('/reload' + _tabQuery, { cache: 'no-store' });
    if (!res.ok) { _reloadBackoff.fail(Date.now()); return; }
    _reloadBackoff.ok();
    const { counter } = await res.json();
    if (_bootReloadCounter === null) { _bootReloadCounter = counter; return; }
    if (counter > _bootReloadCounter) {
      // Tag the reload as Claude-driven so the fresh load jumps to top.
      try { sessionStorage.setItem('_concept_jumpTop', '1'); } catch (_) {}
      location.reload();
    }
  } catch (e) { _reloadBackoff.fail(Date.now()); /* bridge offline */ }
}
setInterval(pollReload, 3000);
document.addEventListener('DOMContentLoaded', pollReload);

// Disable the browser's scroll restoration for Claude-driven reloads and
// force scroll to top. Runs before any layout-affecting init, and again on
// `load` to win against late restorations on slower browsers.
(function () {
  let pending = false;
  try { pending = sessionStorage.getItem('_concept_jumpTop') === '1'; } catch (_) {}
  if (!pending) return;
  try { sessionStorage.removeItem('_concept_jumpTop'); } catch (_) {}
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const jump = () => window.scrollTo(0, 0);
  jump();
  document.addEventListener('DOMContentLoaded', jump);
  window.addEventListener('load', jump);
})();
```

