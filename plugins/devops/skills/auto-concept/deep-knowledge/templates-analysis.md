# Concept templates, part 43 of 43: Template: analysis — Full + Lite contract, decision modes, collect

## Analysis presentation (Full + Lite) — engine fit

Analysis results and the decisions that follow from them are **not a fourth
template**. They are a content variant of the existing ones, so `decision`,
`free` and `design` stay byte-compatible and every payload branch, freeze,
bake and bridge path keeps working:

| Variant | Where it lives | Marker | Payload branch |
|---|---|---|---|
| **Full** | a whole round: `data-iteration-template="decision"` plus `data-analysis="full"` on the iteration section | `section[data-iteration][data-analysis="full"]` | `collectDecisionDecisions()` (every `[data-decision]`, mode-aware) |
| **Lite** | embedded: in a design round as a view (`data-view-kind="analysis"`), or anywhere in a `decision` / `free` round | `[data-analysis="lite"]` | the host branch (design: view decisions; free: appended) |

Rules of thumb (authoring guidance lives in `step1-templates.md`): a concept
whose content IS analysis results + decisions → Full. A few questions that
come up inside another concept (≤ 5) → Lite. More than 5 → Full.

**Wave status.** Wave 1 is the contract and the collect code; wave 2 (below,
§ Styling, § Engine UI) is the visual layer: CSS, stepper, level
choreography, decision-mode widgets and the `CONCEPT_VIZ` palette renderers.
The visual layer only enhances the authored markup — collect, bake, freeze and
the gate never depend on it.

## Markup contract

### Full

```html
<section data-iteration="1" data-iteration-template="decision" data-analysis="full" data-active>

  <!-- Briefing: Analyse -> Potential -> topics -> CTA. Required: what, why, potential. -->
  <section id="briefing" data-analysis-briefing data-nav-label="Briefing">
    <p data-briefing-what>1-2 sentences: what was analysed and found.</p>
    <p data-briefing-why>One sentence: why it matters now.</p>
    <div data-briefing-potential data-viz="kpi"
         data-viz-spec='{"value":"≈ 51 M","unit":"Tokens","label":"saved per month"}'>≈ 51 M Tokens</div>
    <!-- One chip per topic; data-share (0-100) is the topic's part of the potential
         and sets the thickness of its connector line. -->
    <a data-briefing-topic="t-cache" data-share="60">Cache</a>
    <a data-briefing-topic="t-hooks" data-share="40">Hooks</a>
    <p data-briefing-duration>≈ 6 min</p>
    <!-- L1: the overall analysis, reopenable after the briefing. -->
    <div data-alevel="1" data-title="Briefing">
      <div data-slot="short"><div data-viz="kpi" data-viz-spec='{"value":"≈ 51 M","unit":"Tokens"}'></div></div>
      <div data-slot="long">
        <div data-viz="bars" data-viz-spec='{"items":[{"label":"Cache","value":31},{"label":"Hooks","value":20}],"unit":"M"}'></div>
        <p>2-4 sentences.</p>
        <div data-evidence hidden>Belege: raw numbers, sources (opens as popup).</div>
      </div>
    </div>
  </section>

  <!-- A topic (Themenfeld): at most 3 per Full, at most 7 decisions each. -->
  <section id="t-cache" data-topic data-nav-label="Cache">
    <div data-alevel="2" data-title="Cache">
      <div data-slot="short">…</div>   <!-- L2 short = always the group's result -->
      <div data-slot="long">…</div>
    </div>

    <!-- One decision per stage. Section id = data-decision = data-nav-label's key. -->
    <section id="d-ttl" data-nav-label="Cache lifetime" data-decision="d-ttl" data-decision-mode="single"
             data-label="Cache lifetime" data-rec="short"
             data-rec-why="Measured: 80 % of hits happen within 10 min."
             data-applies-to="all hooks" data-finding="f-ttl">
      <p data-applies>Gilt für: alle Hooks</p>
      <h3 data-question>How long may a cached answer live?</h3>
      <p data-context>One sentence of background under the question.</p>
      <div data-options>
        <label data-opt="short" data-recommended>
          <input type="radio" name="dm-d-ttl" value="short" checked>
          <span data-opt-label>Expire after 10 minutes</span>
          <span data-opt-consequence>Saves ≈ 31 M tokens, answers stay fresh.</span>
        </label>
        <label data-opt="long">
          <input type="radio" name="dm-d-ttl" value="long">
          <span data-opt-label>Keep for a day</span>
          <span data-opt-consequence>Saves more, but stale answers are possible.</span>
        </label>
        <label data-opt="none">…</label>
      </div>
      <textarea data-comment="d-ttl-note" placeholder="Note (optional)"></textarea>
      <input type="hidden" name="dm-d-ttl-touched" value="">   <!-- "1" once the stage was open ≥ 3 s or edited -->
      <input type="hidden" name="dm-d-ttl-issue" value="">     <!-- "1" = "Als Issue anlegen" -->
      <input type="hidden" name="dm-d-ttl-epic" value="">      <!-- optional epic name for that issue -->
      <!-- L3: the finding this decision rests on (shown right, ≈ 33 %). -->
      <div data-alevel="3" data-title="Cache lifetime">
        <div data-slot="short">…</div>
        <div data-slot="long">
          <div data-viz="bar" data-viz-spec='{"value":80,"max":100,"label":"hits within 10 min","unit":"%"}'></div>
          <p>2-4 sentences. After deciding, this slot shows the consequence of the choice.</p>
          <div data-evidence hidden>…</div>
        </div>
      </div>
    </section>
  </section>
</section>
```

Attribute reference:

| Attribute | On | Meaning |
|---|---|---|
| `data-analysis="full\|lite"` | iteration section (Full) / any container or view (Lite) | variant marker; the gate and the engine key on it |
| `data-analysis-briefing` | one `section` per Full | the briefing screen; REQUIRED children `data-briefing-what`, `data-briefing-why`, `data-briefing-potential` (non-empty) |
| `data-briefing-topic="<topic id>"` + `data-share` | `a` in the briefing | connector target of the "Striche und Verbindungen"; share of the potential in % |
| `data-briefing-duration` | briefing | the time the CTA names |
| `data-topic` | `section[id][data-nav-label]` | a Themenfeld; ≤ 3 per Full |
| `data-alevel="1\|2\|3"` + `data-title` | block | analysis level: 1 briefing/overall, 2 topic, 3 this decision. `data-title` equals the stepper / header name exactly. Lite has L1 + L3 only |
| `data-slot="short\|long"` | child of a level | short = 1 sentence + KPI or mini graphic (formatted text only when there is no number); long = one palette display + 2-4 sentences, never scrolls |
| `data-evidence` | in a long slot | "Belege", opens as popup, never inline |
| `data-viz="<type>"` + `data-viz-spec='<json>'` | any element in a slot | palette display (below) |
| `data-decision="<id>"` + `data-decision-mode` | the decision element | id (`[a-z0-9_-]+`) and mode (below). It is also `section[id][data-nav-label]` in Full so the TOC lists it |
| `data-label` | decision | the stepper tooltip / review name |
| `data-rec` | decision | recommended option, ALWAYS preselected (value shapes below) |
| `data-rec-why` | decision | the reason, shown in the ★ tooltip |
| `data-applies-to` | decision | "Gilt für" text; the visible quiet line carries `data-applies` |
| `data-finding="<id>"` | decision | the finding it rests on (the L3 block inside) |
| `data-finding-quant="true\|false"` | decision | overrides the gate's guess whether the finding is quantitative |
| `data-question`, `data-context`, `data-options`, `data-opt`, `data-opt-label`, `data-opt-consequence`, `data-recommended` | inside a decision | question (a real question), one background sentence, option cards (outcome verb + consequence line), the ★ option |

### Lite

```html
<!-- Inside a design round: a view. In a decision / free round: the same
     section directly in the body. -->
<section data-view="q-sync" data-view-kind="analysis" data-analysis="lite" data-nav-label="Quick questions">
  <div data-alevel="1" data-title="Quick questions">…</div>          <!-- optional overall -->
  <section id="q1" data-nav-label="Sync" data-decision="q1" data-decision-mode="yesnoalt"
           data-label="Sync" data-rec="yes" data-rec-why="…" data-applies-to="…">…</section>
</section>
```

Lite is the Full stage without groups: L1 + L3, one decision at a time with
progress dots, ≤ 5 decisions. In a design round the view is a normal
`section[data-view]` (`templates-design-views.md`); its decisions are
collected by the design branch's view-decision loop, which dispatches
mode-aware decisions to `collectModeDecision()` below.

## Decision modes

Seven modes, one typed value each. A decision WITHOUT `data-decision-mode`
is the legacy include/discard bi-state (`§ Bi-State Variant Evaluation`) and
keeps its `evaluation` payload untouched.

| Mode | When Claude uses it | Control convention (inside the decision) | `data-rec` | `value` |
|---|---|---|---|---|
| `single` | one answer out of 2-5 content alternatives | `input[type=radio][name="dm-{id}"][value="{opt}"]` | option id | option id (string) |
| `multi` | several of a list apply | `input[type=checkbox][name="dm-{id}.{opt}"]` per option | space-separated option ids | option ids in document order (string[]) |
| `yesnoalt` | a proposal that can be accepted, refused, or answered differently | radios `dm-{id}` with values `yes` `no` `alt`, plus `input[type=text][name="dm-{id}-alt"]` | `yes` \| `no` \| `alt` | `{ answer, alt }` — `alt` only for `answer: "alt"` |
| `slider` | a quantity / threshold on a scale | `input[type=range][name="dm-{id}"][min][max][step][value]`; `data-unit` on the decision | number | number (`null` when empty) |
| `order` | a priority or sequence | `input[type=hidden][name="dm-{id}"]` = comma-joined ids; the sortable list is rendered from it | comma-joined ids | ids in the chosen order (string[]) |
| `verify` | Claude states something and the user confirms it | radios `dm-{id}` values `ok` `partial` `wrong`, plus `input[name="dm-{id}-fix"]` | verdict | verdict string; the correction in entry `fix` |
| `wording` | a name / phrasing, with suggestions | radios `dm-{id}` with the suggestion ids (+ `custom`), each `data-text="…"`; `input[type=text][name="dm-{id}-text"]` for `custom` | suggestion id | the final wording (string); entry `choice` = suggestion id or `custom` |

Label rules for options: outcome verbs, no polarity-only labels ("An" /
"Aus"), no double negation, one consequence line per option
(`data-opt-consequence`). Timing is never a decision (default: implement
now); the discreet "Als Issue anlegen (ggf. mit Epic)" link sets
`dm-{id}-issue` (and `dm-{id}-epic`).

Common to every decision:

- ONE note: `<textarea data-comment="{id}-note">`, inline, never a second button or an option.
- `dm-{id}-touched` (hidden): `""` until the stage was open ≥ 3 s or the user changed something, then `"1"`. A decision whose value is `""` stays **untouched**: the payload says so and the review lists it last.
- The recommendation is the preselection: the markup ships the `data-rec` option checked / the slider at the value / the order as recommended. A user who only presses "Weiter" after ≥ 3 s has decided "keep the recommendation".

## Payload

`collectDecisionDecisions()` (and the design / free branches for embedded
Lite) emit, per mode-aware decision (the legacy bi-state keeps
`{ id, label, evaluation, note }`):

```json
{ "id": "d-ttl", "label": "Cache lifetime", "mode": "single", "value": "short",
  "rec": "short", "deviates": false, "untouched": false, "note": "",
  "appliesTo": "all hooks", "finding": "f-ttl", "issue": false, "epic": "" }
```

`value` per mode: `single` `"opt"` · `multi` `["a","c"]` · `yesnoalt`
`{"answer":"alt","alt":"text"}` · `slider` `42` · `order` `["b","a","c"]` ·
`verify` `"partial"` (+ `"fix":"…"`) · `wording` `"Final text"` (+
`"choice":"s2"` or `"custom"`). `deviates` is `value !== rec` after
normalisation; `untouched` is `touched !== "1"`. In a design round the entry
also carries `view` (and `design` for a view tied to a variant). Untouched
decisions are still reported with their preselected value — Claude treats them
as "not looked at", not as "agreed".

**Bake / freeze.** Every value above lives in a named form control, so the
existing machinery carries it: `collectAllFormFields` ships it in `allFields`,
`concept-build.js bake` writes it back (radio `checked`, checkbox `checked`,
text / hidden / range `value`, textarea body) and `freeze` disables the
controls. When a payload has `decisions[]` with modes but no matching
`allFields` keys, `bake` derives the control values from the typed
`decisions[]` (`modeFields()` in `scripts/concept-build.js`); `allFields` wins
where both name a key. A frozen round therefore renders its answers exactly as
submitted.

## Collect (engine code)

`collectModeDecision(el)` is the single reader of the control convention above;
the three payload branches call it (`typeof collectModeDecision === 'function'`
guarded, so an older page is unaffected).

```javascript
function collectModeDecision(el) {
  const id = el.dataset.decision;
  const mode = el.dataset.decisionMode;
  const n = 'dm-' + id;
  const ctl = [...el.querySelectorAll('input, textarea, select')];
  const named = name => ctl.filter(c => (c.name || '') === name);
  const text = name => { const c = named(name)[0]; return c ? String(c.value || '').trim() : ''; };
  const picked = name => named(name).find(c => c.type === 'radio' && c.checked) || null;
  const noteId = id + '-note';
  const noteEl = el.querySelector('[data-comment="' + noteId + '"]')
    || (el.parentElement && el.parentElement.querySelector('[data-comment="' + noteId + '"]'));
  const rec = (el.dataset.rec || '').trim();
  const entry = { id, label: el.dataset.label || id, mode };
  let deviates = false;
  if (mode === 'multi') {
    const ids = ctl.filter(c => c.type === 'checkbox' && (c.name || '').indexOf(n + '.') === 0 && c.checked)
      .map(c => c.name.slice(n.length + 1));
    entry.value = ids;
    deviates = ids.slice().sort().join(' ') !== rec.split(/\s+/).filter(Boolean).sort().join(' ');
  } else if (mode === 'yesnoalt') {
    const p = picked(n);
    const answer = p ? p.value : '';
    entry.value = { answer, alt: answer === 'alt' ? text(n + '-alt') : '' };
    deviates = answer !== rec;
  } else if (mode === 'slider') {
    const raw = text(n);
    const num = raw === '' ? NaN : Number(raw);
    entry.value = Number.isFinite(num) ? num : null;
    deviates = entry.value !== Number(rec);
  } else if (mode === 'order') {
    const ids = text(n).split(',').map(s => s.trim()).filter(Boolean);
    entry.value = ids;
    deviates = ids.join(',') !== rec.replace(/\s+/g, '');
  } else if (mode === 'verify') {
    const p = picked(n);
    entry.value = p ? p.value : '';
    entry.fix = text(n + '-fix');
    deviates = entry.value !== rec;
  } else if (mode === 'wording') {
    const p = picked(n);
    const choice = p ? p.value : '';
    entry.choice = choice;
    entry.value = choice === 'custom' ? text(n + '-text') : (p ? (p.dataset.text || '').trim() : '');
    deviates = choice !== rec;
  } else {
    const p = picked(n);
    entry.value = p ? p.value : '';
    deviates = entry.value !== rec;
  }
  entry.rec = rec;
  entry.deviates = deviates;
  entry.untouched = text(n + '-touched') !== '1';
  entry.note = ((noteEl && noteEl.value) || '').trim();
  entry.appliesTo = el.dataset.appliesTo || '';
  entry.finding = el.dataset.finding || '';
  entry.issue = text(n + '-issue') === '1';
  entry.epic = text(n + '-epic');
  return entry;
}

function collectModeDecisions(scope) {
  return [...(scope || document).querySelectorAll('[data-decision][data-decision-mode]')].map(collectModeDecision);
}
```

## Display palette (`data-viz`)

Every graphic is `data-viz="<type>"` plus `data-viz-spec='<json>'` and is
rendered by a registry function — `window.CONCEPT_VIZ[type](el, spec, ctx)`
with `ctx = { size: "short" | "long" }` — never hand-drawn per concept. An
unknown type or an unparsable spec renders `spec.text` as formatted text (the
one pure text type, `data-viz="text"`), so a page never shows an empty slot.
The gate treats `text` as "no visual".

Core types every engine build must provide (the full ≥ 30 type catalogue with
"Nimm sie, wenn …" / "Nicht, wenn …" lines is authored in the palette guide):

| Type | Spec |
|---|---|
| `text` | `{ "text": "…" }` |
| `kpi` | `{ "value": "≈ 51 M", "unit": "Tokens", "label": "…", "delta": "-12 %" }` |
| `bar` | `{ "value": 80, "max": 100, "unit": "%", "label": "…" }` |
| `bars` | `{ "items": [ { "label": "…", "value": 31 } ], "unit": "M" }` |
| `spark` | `{ "points": [3, 5, 4, 8], "label": "…" }` |
| `donut` | `{ "parts": [ { "label": "…", "value": 60 } ] }` |
| `compare` | `{ "before": { "label": "…", "value": 10 }, "after": { "label": "…", "value": 4 }, "unit": "s" }` |
| `flow` | `{ "steps": [ { "label": "…", "value": "…" } ] }` |

## Styling (Full + Lite)

Everything is namespaced: tokens `--an-*`, classes `an-*`, and the authored
attributes only ever below `[data-analysis]`, so no rule can reach engine
chrome (gate P32 watches `<style>` blocks in rounds; this block is engine CSS
and keeps the same discipline). Dark is the default, `html[data-theme="light"]`
swaps the tokens. Status colours (green done, orange deviation, light-blue
issue) appear only in the stepper, the review and the tags; topic colours
(`--c`, assigned in JS) are never red, green or orange; analysis figures are
neutral / light blue.

```css
[data-analysis] {
  --an-bg: #0d1117; --an-s1: #151b23; --an-s2: #1b2230; --an-s3: #252d3b;
  --an-bd: rgba(240,246,252,.08); --an-bd2: rgba(240,246,252,.15);
  --an-tx: #f0f6fc; --an-tx2: #c9d1d9; --an-mu: #9198a1; --an-mu2: #6e7681;
  --an-ac: #2f81f7; --an-ac-soft: rgba(47,129,247,.14);
  --an-ok: #3fb950; --an-ok2: #7ee787; --an-warn: #d29922; --an-gold: #f2cc60;
  --an-li: #79c0ff; --an-li-soft: rgba(121,192,255,.1);
  --an-on-ac: #fff; --an-shadow: 0 12px 34px rgba(0,0,0,.35);
  --an-dur: 300ms;
  color: var(--an-tx); font-size: 14px; line-height: 1.5; text-align: left;
}
html[data-theme="light"] [data-analysis] {
  --an-bg: #ffffff; --an-s1: #f6f8fa; --an-s2: #eef1f5; --an-s3: #e1e6ec;
  --an-bd: rgba(31,35,40,.1); --an-bd2: rgba(31,35,40,.22);
  --an-tx: #1f2328; --an-tx2: #3d444d; --an-mu: #59636e; --an-mu2: #818b98;
  --an-ac: #0969da; --an-ac-soft: rgba(9,105,218,.1);
  --an-ok: #1a7f37; --an-ok2: #1a7f37; --an-warn: #9a6700; --an-gold: #9a6700;
  --an-li: #0969da; --an-li-soft: rgba(9,105,218,.08);
  --an-shadow: 0 10px 28px rgba(31,35,40,.14);
}
[data-analysis] *, [data-analysis] *::before, [data-analysis] *::after { box-sizing: border-box; }
[data-analysis] :where(p, h3, h4, ol, ul) { margin: 0; padding: 0; }
[data-analysis] :where(ol, ul) { list-style: none; }
[data-analysis] :where(button) { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; line-height: inherit; }
[data-analysis] :where(button, [tabindex], input, textarea):focus-visible { outline: 2px solid var(--an-ac); outline-offset: 2px; }
[data-analysis] kbd { display: inline-flex; align-items: center; height: 21px; padding: 0 6px; border-radius: 5px; background: var(--an-s3); font: 600 11.5px ui-monospace, Consolas, monospace; color: var(--an-tx); }

/* ---------- stage grid: stepper on top, decision 2/3, analysis 1/3 ---------- */
.an-enh { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); column-gap: 34px; align-content: start; }
.an-enh > .an-step, .an-enh > .an-lhead { grid-column: 1 / -1; }
.an-enh [data-topic] { display: contents; }
.an-enh .an-off { display: none !important; }
.an-enh > .an-stage, .an-enh [data-topic] > .an-stage { grid-column: 1; grid-row: 2; min-width: 0; padding: 26px 0 28px; outline: none; }
.an-enh > .an-ana { grid-column: 2; grid-row: 2; padding-top: 26px; }
.an-enh.an-wide-stage > .an-ana { display: none; }
.an-enh.an-wide-stage > .an-stage, .an-enh.an-wide-stage [data-topic] > .an-stage { grid-column: 1 / -1; }
.an-lite { max-width: 1160px; margin: 20px auto 74px; border-radius: 18px; background: linear-gradient(180deg, var(--an-s1), var(--an-bg)); border: 1px solid var(--an-bd2); box-shadow: var(--an-shadow); padding: 0 22px; }
.an-lite.an-enh { column-gap: 28px; }
.an-lite > .an-stage { padding: 22px 0 24px; }
.an-lite > .an-ana { padding-top: 22px; }
/* design view kind `analysis`: the view itself is the (scrolling) Lite card */
section[data-view][data-view-kind="analysis"] { overflow-y: auto; }
section[data-view].an-lite { max-width: none; margin: 0; border: 0; border-radius: 0; background: none; box-shadow: none; padding-left: max(2rem, calc((100% - 1160px) / 2)); padding-right: max(2rem, calc((100% - 1160px) / 2)); }
.an-enh[hidden], [data-analysis] [hidden] { display: none !important; }
.an-lr small { display: block; font-size: 12px; font-weight: 400; color: var(--an-mu2); }
.an-enh [data-alevel] { display: none; }
.an-stage[data-decision] { display: flex; flex-direction: column; min-height: 560px; }
.an-lite .an-stage[data-decision] { min-height: 470px; }
.an-intro, .an-start, .an-fin, .an-review, .an-list, .an-next { display: flex; flex-direction: column; }
.an-intro { min-height: 560px; }
.an-lite .an-start, .an-lite .an-fin { min-height: 470px; }
[data-analysis] .an-epic { flex: 0 1 160px; height: 30px; padding: 0 9px; border: 1px solid var(--an-bd2); border-radius: 8px; background: var(--an-s1); font-size: 12.5px; }
[data-analysis] .an-epic[hidden] { display: none; }

/* ---------- stepper (Full) / progress dots (Lite) ---------- */
.an-step { position: sticky; top: var(--an-sticky-top, 0px); z-index: 5; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 60px; padding: 8px 74px 8px 4px; border-bottom: 1px solid var(--an-bd); background: color-mix(in srgb, var(--an-bg) 88%, transparent); backdrop-filter: blur(6px); }
.an-k { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 15px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--an-mu); white-space: nowrap; }
.an-k:hover, .an-gl:hover { background: var(--an-s2); color: var(--an-tx); }
.an-k.an-on { color: var(--an-tx); background: var(--an-ac-soft); box-shadow: inset 0 0 0 1.5px var(--an-ac); }
.an-k.an-done { color: var(--an-ok2); background: rgba(63,185,80,.13); box-shadow: inset 0 0 0 1.5px rgba(63,185,80,.45); }
.an-ic { display: none; width: 18px; height: 18px; border-radius: 50%; background: var(--an-ok); color: #06210e; font-size: 12px; font-weight: 900; line-height: 18px; text-align: center; flex: none; }
.an-done > .an-ic, .an-gdone .an-ic { display: inline-block; }
.an-sep { width: 14px; height: 2px; border-radius: 2px; background: var(--an-bd2); flex: none; }
.an-sep.an-sd { background: var(--an-ok); }
.an-grp { display: inline-flex; align-items: center; gap: 4px; height: 40px; padding: 0 8px 0 6px; border-radius: 999px; }
.an-grp.an-on { background: var(--an-ac-soft); box-shadow: inset 0 0 0 1.5px var(--an-ac); }
.an-grp.an-gdone { background: rgba(63,185,80,.13); box-shadow: inset 0 0 0 1.5px rgba(63,185,80,.45); }
.an-gl { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 8px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--an-mu); white-space: nowrap; }
.an-gl > i { width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--an-li)); flex: none; }
.an-grp.an-on .an-gl { color: var(--an-tx); }
.an-grp.an-gdone .an-gl { color: var(--an-ok2); }
.an-grp.an-gdone .an-gl > i { display: none; }
.an-dots { display: inline-flex; align-items: center; }
.an-dot { display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 28px; }
.an-dot::before { content: ""; width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--an-mu2); transition: transform .12s; }
.an-dot:hover::before { transform: scale(1.4); }
.an-dot.an-s-ok::before { background: var(--an-ok); box-shadow: none; }
.an-dot.an-s-dev::before { background: var(--an-warn); box-shadow: none; }
.an-dot.an-s-iss::before { box-shadow: inset 0 0 0 2.5px var(--an-li); }
.an-dot.an-s-un::before { box-shadow: none; outline: 1.5px dashed var(--an-mu); outline-offset: -1.5px; }
.an-dot.an-cur::before { width: 14px; height: 14px; background: var(--an-tx); box-shadow: 0 0 0 4px var(--an-bd2); }
.an-lhead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--an-bd); }
.an-lhead .an-lt { font-size: 13px; font-weight: 700; color: var(--an-tx2); }
.an-lhead .an-lpr { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--an-mu); }

/* ---------- decision hierarchy ---------- */
[data-analysis] [data-applies] { font-size: 12.5px; color: var(--an-mu2); margin-bottom: 8px; }
[data-analysis] [data-question] { font-size: 31px; font-weight: 740; letter-spacing: -.024em; line-height: 1.2; max-width: 760px; color: var(--an-tx); }
.an-lite [data-question] { font-size: 25px; }
[data-analysis] [data-context] { font-size: 14px; color: var(--an-mu); line-height: 1.5; max-width: 700px; margin-top: 10px; }
.an-zone { margin-top: 26px; display: flex; flex-direction: column; gap: 14px; }
[data-analysis] [data-options] { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px 12px; padding-top: 4px; }
[data-analysis] [data-opt] { position: relative; display: flex; flex-direction: column; gap: 8px; min-height: 148px; padding: 18px 18px 16px; border-radius: 16px; background: var(--an-s1); border: 1.5px solid var(--an-bd2); cursor: pointer; transition: border-color .15s, background .15s; }
.an-lite [data-opt] { min-height: 120px; }
[data-analysis] [data-opt]::before { content: ""; width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--an-mu2); flex: none; }
[data-analysis] [data-opt].an-cb::before { border-radius: 6px; }
[data-analysis] [data-opt]:hover { border-color: var(--an-mu2); background: var(--an-s2); }
[data-analysis] [data-opt].is-on { border-color: var(--an-ac); background: linear-gradient(180deg, var(--an-ac-soft), transparent); box-shadow: 0 10px 30px rgba(31,111,235,.14); }
[data-analysis] [data-opt].is-on::before { border: 7px solid var(--an-ac); }
[data-analysis] [data-opt].an-cb.is-on::before { border: 0; background: var(--an-ac) center / 14px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M3 7.5l2.8 2.8L11 4.4' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
[data-analysis] [data-opt]:focus-within { outline: 2px solid var(--an-ac); outline-offset: 2px; }
[data-analysis] [data-opt] > input[type=radio], [data-analysis] [data-opt] > input[type=checkbox] { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
[data-analysis] [data-opt-label] { font-size: 17px; font-weight: 680; line-height: 1.3; color: var(--an-tx); }
[data-analysis] [data-opt-consequence] { font-size: 13px; color: var(--an-mu); line-height: 1.45; }
[data-analysis] [data-opt].is-on [data-opt-consequence] { color: var(--an-tx2); }
[data-analysis] [data-opt].an-rec { border-color: rgba(242,204,96,.55); }
[data-analysis] [data-opt].an-rec.is-on { border-color: var(--an-ac); }
.an-badge { position: absolute; top: -11px; right: 14px; z-index: 2; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: 999px; background: linear-gradient(180deg, #f5d36b, #e3a53a); color: #2a1a00; font-size: 11.5px; font-weight: 800; white-space: nowrap; box-shadow: 0 4px 12px rgba(227,165,58,.3); pointer-events: auto; }
.an-badge.an-bfree { position: static; align-self: flex-start; }
[data-analysis] [data-opt][data-opt="alt"] { min-height: 0; }
.an-inl { display: none; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-radius: 10px; border: 1.5px dashed var(--an-bd2); background: var(--an-s1); }
.an-inl.an-show { display: flex; }
.an-inl > span { font-size: 12.5px; color: var(--an-mu); white-space: nowrap; }
[data-analysis] input[type=text] { flex: 1; min-width: 0; height: 30px; border: 0; background: none; color: var(--an-tx); font: inherit; outline: none; }
/* slider over a bar */
.an-sl { position: relative; padding: 24px 26px 14px; border-radius: 16px; background: var(--an-s1); border: 1.5px solid var(--an-bd2); }
.an-sl-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; color: var(--an-mu); }
.an-sl-v { font-size: 28px; font-weight: 780; letter-spacing: -.02em; color: var(--an-tx); }
.an-sl-v small { font-size: 13px; color: var(--an-mu); font-weight: 500; margin-left: 6px; }
.an-sl input[type=range] { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 12px; margin: 18px 0 8px; border-radius: 6px; cursor: pointer; background: linear-gradient(90deg, var(--an-li) 0 var(--an-p, 50%), var(--an-s3) var(--an-p, 50%) 100%); }
.an-sl input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 32px; height: 32px; border-radius: 50%; background: #fff; border: 7px solid var(--an-ac); box-shadow: 0 4px 14px rgba(0,0,0,.45); }
.an-sl input[type=range]::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 7px solid var(--an-ac); }
.an-sl-rec { position: relative; height: 34px; }
.an-sl-rec .an-badge { position: absolute; top: 4px; right: auto; transform: translateX(-50%); }
/* order */
.an-ord { display: flex; flex-direction: column; gap: 8px; counter-reset: ord; }
.an-oi { display: grid; grid-template-columns: 22px 28px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 14px; background: var(--an-s1); border: 1.5px solid var(--an-bd2); cursor: grab; }
.an-oi:focus-visible { outline: 2px solid var(--an-ac); }
.an-oi.an-drag { opacity: .45; }
.an-oi::before { content: "⠿"; color: var(--an-mu2); font-size: 17px; }
.an-oi > b { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--an-s3); font-size: 12.5px; }
.an-oi .an-ol { font-size: 15px; font-weight: 650; }
.an-oi .an-ol small { display: block; font-size: 12.5px; font-weight: 400; color: var(--an-mu); }
.an-oi .an-ob { display: inline-flex; gap: 4px; }
.an-oi .an-ob button { width: 32px; height: 32px; border-radius: 9px; box-shadow: inset 0 0 0 1px var(--an-bd2); text-align: center; color: var(--an-mu); }
.an-oi .an-ob button:hover { color: var(--an-tx); background: var(--an-s3); }
/* foot: ONE note field, quiet links, Zurück / Weiter */
.an-foot { margin-top: auto; padding-top: 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.an-quiet { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1 1 320px; min-width: 0; }
.an-note { flex: 1 1 220px; min-width: 160px; max-width: 420px; height: 38px; min-height: 38px; max-height: 120px; resize: none; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--an-bd2); background: var(--an-s1); color: var(--an-tx); font: inherit; font-size: 13px; line-height: 1.4; }
.an-note::placeholder { color: var(--an-mu2); }
.an-link { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px; border-radius: 7px; font-size: 12.5px; color: var(--an-mu2); white-space: nowrap; }
.an-link:hover { color: var(--an-tx2); background: var(--an-s1); }
.an-link[aria-pressed="true"] { color: var(--an-li); }
.an-go { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.an-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 48px; padding: 0 26px; border-radius: 13px; background: linear-gradient(180deg, #3d8ffd, #1f6feb); color: #fff; font-weight: 680; font-size: 15.5px; box-shadow: 0 8px 22px rgba(31,111,235,.3), inset 0 1px 0 rgba(255,255,255,.22); white-space: nowrap; }
.an-btn:hover { filter: brightness(1.08); }
.an-btn2 { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 12px; background: var(--an-s2); color: var(--an-tx2); font-size: 14px; font-weight: 550; box-shadow: inset 0 0 0 1px var(--an-bd2); white-space: nowrap; }
.an-btn2:hover { color: var(--an-tx); background: var(--an-s3); }
.an-back { height: 44px; padding: 0 12px; display: inline-flex; align-items: center; font-size: 13.5px; color: var(--an-mu); border-radius: 10px; }
.an-back:hover { color: var(--an-tx); background: var(--an-s1); }
.an-back[disabled] { opacity: .4; pointer-events: none; }

/* ---------- briefing ---------- */
.an-brief { position: relative; display: flex; flex-direction: column; min-width: 0; }
.an-brief::before { content: attr(data-an-kicker); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--an-mu); }
[data-analysis] [data-briefing-what] { font-size: 32px; font-weight: 760; letter-spacing: -.026em; line-height: 1.18; max-width: 780px; margin-top: 8px; }
[data-analysis] [data-briefing-why] { font-size: 15px; color: var(--an-mu); margin-top: 10px; max-width: 700px; }
[data-analysis] [data-briefing-potential] { position: relative; align-self: flex-start; margin-top: 44px; padding: 14px 22px; border-radius: 16px; background: linear-gradient(135deg, var(--an-li-soft), transparent); border: 1px solid color-mix(in srgb, var(--an-li) 45%, transparent); font-size: 24px; font-weight: 780; letter-spacing: -.02em; color: var(--an-li); }
[data-analysis] [data-briefing-potential] .an-kpi-v { font-size: 38px; }
.an-chips { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-top: 56px; }
[data-analysis] [data-briefing-topic] { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 14px 15px 13px; border-radius: 14px; background: var(--an-s1); border: 1px solid var(--an-bd2); border-top: 4px solid var(--c, var(--an-li)); font-size: 16.5px; font-weight: 720; color: var(--an-tx); cursor: pointer; text-decoration: none; transition: transform .15s, background .15s; }
[data-analysis] [data-briefing-topic]:hover { background: var(--an-s2); transform: translateY(-2px); }
[data-analysis] [data-briefing-topic] em { font-style: normal; font-size: 12px; font-weight: 600; color: var(--an-mu); }
.an-conn { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 0; }
.an-conn path { fill: none; stroke-linecap: round; stroke-dasharray: var(--len, 400); stroke-dashoffset: 0; animation: an-draw calc(var(--an-dur) * 2.4) cubic-bezier(.22,.8,.24,1) both; }
.an-brief > *:not(.an-conn) { position: relative; z-index: 1; }
.an-cta { margin-top: 28px; display: flex; align-items: center; gap: 18px; padding: 16px 18px; border-radius: 18px; background: linear-gradient(120deg, var(--an-ac-soft), var(--an-li-soft)); border: 1px solid color-mix(in srgb, var(--an-li) 45%, transparent); }
.an-cta-t { flex: 1; font-size: 13.5px; color: var(--an-tx2); }
.an-cta-t b { display: block; font-size: 17px; font-weight: 720; color: var(--an-tx); }
.an-cta .an-btn { height: 56px; padding: 0 30px; font-size: 17px; border-radius: 15px; animation: an-glow 2.4s ease-in-out 1.2s infinite; }
.an-cta .an-btn.an-pressed { animation: none; }
.an-brief .an-quiet { margin-top: 14px; }

/* ---------- topic intro, list, review, next round, done ---------- */
.an-h { font-size: 28px; font-weight: 740; letter-spacing: -.02em; line-height: 1.2; }
.an-sub { font-size: 13.5px; color: var(--an-mu); margin-top: 6px; }
.an-rows { display: flex; flex-direction: column; margin-top: 22px; border-radius: 16px; border: 1px solid var(--an-bd2); overflow: hidden; background: var(--an-s1); }
.an-rw { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 14px; align-items: center; width: 100%; padding: 13px 18px; font-size: 15px; font-weight: 550; }
.an-rw:hover { background: var(--an-s2); }
.an-rw + .an-rw { border-top: 1px solid var(--an-bd); }
.an-rw small { display: block; font-size: 12.5px; color: var(--an-mu); font-weight: 400; }
.an-rw em { font-style: normal; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 999px; font-size: 12.5px; font-weight: 650; background: var(--an-ac-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--an-ac) 40%, transparent); white-space: nowrap; }
.an-st { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--an-mu2); }
.an-st.an-s-ok { background: var(--an-ok); box-shadow: none; }
.an-st.an-s-dev { background: var(--an-warn); box-shadow: none; }
.an-st.an-s-iss { box-shadow: inset 0 0 0 2.5px var(--an-li); }
.an-st.an-s-un { box-shadow: none; outline: 1.5px dashed var(--an-mu); outline-offset: -1.5px; }
.an-lst { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-top: 18px; }
.an-lg { border-radius: 14px; background: var(--an-s1); border: 1px solid var(--an-bd); border-top: 3px solid var(--c, var(--an-li)); padding: 6px 6px 8px; }
.an-lg-h { padding: 8px 10px; font-size: 13.5px; font-weight: 700; }
.an-lr { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 4px 10px; align-items: center; width: 100%; padding: 7px 10px; border-radius: 9px; font-size: 13px; color: var(--an-tx2); }
.an-lr:hover { background: var(--an-s2); }
.an-lr em { grid-column: 2; font-style: normal; font-size: 12px; color: var(--an-mu); }
.an-rv { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
.an-rg { border-radius: 14px; border: 1px solid var(--an-bd); overflow: hidden; }
.an-rg-h { display: flex; align-items: center; gap: 10px; padding: 9px 16px; background: var(--an-s1); font-size: 12px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; color: var(--an-mu); }
.an-rg-h span { margin-left: auto; font-weight: 500; letter-spacing: 0; text-transform: none; }
.an-tr { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: center; padding: 10px 16px; font-size: 13.5px; color: var(--an-tx2); border-top: 1px solid var(--an-bd); width: 100%; }
button.an-tr:hover { background: var(--an-s2); }
.an-tr b { color: var(--an-tx); font-weight: 600; }
.an-tr small { display: block; color: var(--an-mu); font-size: 12px; }
.an-tag { display: inline-flex; align-items: center; height: 24px; padding: 0 9px; border-radius: 7px; font-size: 12px; font-weight: 650; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.an-tag.an-y { color: var(--an-gold); background: rgba(210,153,34,.15); }
.an-tag.an-u { color: var(--an-mu); border: 1px dashed var(--an-bd2); }
.an-tag.an-i { color: var(--an-li); background: var(--an-li-soft); }
.an-tag.an-r { color: var(--an-tx2); background: var(--an-s2); }
.an-tag.an-r::before { content: "★ "; color: var(--an-gold); }
.an-unt { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-top: 1px solid var(--an-bd); font-size: 13px; color: var(--an-mu); }
.an-unt .an-btn2 { margin-left: auto; height: 38px; }
.an-imp { padding: 16px 18px; border-radius: 14px; background: var(--an-s1); border: 1px solid var(--an-bd); }
.an-imp h4 { font-size: 14px; font-weight: 700; margin-bottom: 10px; }
.an-send { padding: 12px 16px; border-radius: 12px; border: 1px dashed var(--an-bd2); font-size: 13px; color: var(--an-mu); line-height: 1.6; }
.an-nx { max-width: 840px; margin: 10px auto 0; }
.an-nx-c { margin-top: 14px; padding: 24px 26px; border-radius: 18px; background: var(--an-s1); border: 1px solid var(--an-bd2); box-shadow: var(--an-shadow); }
.an-nx-c ol { margin-top: 16px; display: flex; flex-direction: column; gap: 12px; counter-reset: nx; }
.an-nx-c li { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 12px; font-size: 14px; color: var(--an-tx2); counter-increment: nx; }
.an-nx-c li::before { content: counter(nx); width: 26px; height: 26px; border-radius: 50%; background: var(--an-s3); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--an-tx); }
.an-nx-f { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--an-bd); font-size: 12.5px; color: var(--an-mu); }
.an-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-top: 18px; }
.an-mini > div { padding: 10px 12px; border-radius: 12px; background: var(--an-s1); border: 1px solid var(--an-bd); font-size: 12px; color: var(--an-mu); }
.an-mini b { display: block; color: var(--an-tx); font-size: 13px; margin-bottom: 3px; }
.an-mini .an-dv { border-color: rgba(210,153,34,.45); }

/* ---------- analysis column: three levels, one long at a time ---------- */
.an-ana { display: flex; flex-direction: column; gap: 8px; min-width: 0; align-self: start; }
.an-ana-h { display: flex; justify-content: space-between; align-items: center; padding: 0 2px 2px; font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--an-mu2); }
.an-rp { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 11.5px; font-weight: 550; letter-spacing: 0; text-transform: none; color: var(--an-mu); box-shadow: inset 0 0 0 1px var(--an-bd); }
.an-rp:hover { color: var(--an-tx); box-shadow: inset 0 0 0 1px var(--an-bd2); }
.an-lvs { display: flex; flex-direction: column; gap: 8px; }
.an-lv { border-radius: 12px; background: var(--an-s1); border: 1px solid var(--an-bd); transition: border-color .2s, background .2s; }
.an-lv:hover { border-color: var(--an-bd2); }
.an-lv[data-state="long"] { border-color: color-mix(in srgb, var(--an-li) 50%, transparent); box-shadow: var(--an-shadow); background: var(--an-s2); }
.an-lv-h { display: grid; grid-template-columns: 14px minmax(0, 1fr) 12px; gap: 10px; align-items: center; width: 100%; padding: 10px 12px; }
.an-lv-i { width: 10px; height: 10px; border-radius: 50%; background: var(--an-li); justify-self: center; }
.an-lv[data-n="1"] .an-lv-i { background: none; box-shadow: inset 0 0 0 2px var(--an-tx2); }
.an-lv[data-n="3"] .an-lv-i { border-radius: 2px; transform: rotate(45deg); width: 9px; height: 9px; background: var(--an-ac); }
.an-lv-t { font-size: 12.5px; font-weight: 700; color: var(--an-tx2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.an-lv[data-state="long"] .an-lv-t { color: var(--an-tx); }
.an-lv-h::after { content: "▸"; font-size: 10px; color: var(--an-mu2); transition: transform var(--an-dur); }
.an-lv[data-state="long"] .an-lv-h::after { transform: rotate(90deg); }
.an-w { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows calc(var(--an-dur) * .5) cubic-bezier(.22,.8,.24,1), opacity calc(var(--an-dur) * .5) ease-out; }
.an-w > .an-in { overflow: hidden; min-height: 0; }
.an-w > .an-in > div { padding: 0 12px 12px 36px; }
.an-lv[data-state="short"] .an-w-s, .an-lv[data-state="long"] .an-w-l { grid-template-rows: 1fr; opacity: 1; }
.an-w-s .an-in > div { color: var(--an-mu); font-size: 13px; line-height: 1.42; }
.an-w-l .an-in > div { color: var(--an-tx2); font-size: 12.5px; line-height: 1.5; }
.an-w-l .an-in > div > * + * { margin-top: 8px; }
.an-lv.an-enter { animation: an-rise calc(var(--an-dur) * .6) cubic-bezier(.22,.8,.24,1) calc(var(--an-dur) * .3) both; }
.an-lv.an-swap { animation: an-rise calc(var(--an-dur) * .5) cubic-bezier(.22,.8,.24,1) both; }
.an-ev { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--an-li); background: var(--an-li-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--an-li) 28%, transparent); }
.an-ev:hover { background: color-mix(in srgb, var(--an-li) 18%, transparent); }
.an-cons { padding: 9px 11px; border-radius: 10px; background: var(--an-ac-soft); border: 1px solid color-mix(in srgb, var(--an-ac) 35%, transparent); color: var(--an-tx); animation: an-fade calc(var(--an-dur) * 1.2) ease-out both; }
.an-cons b { display: block; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--an-li); margin-bottom: 3px; }
.an-cons ul li + li { margin-top: 3px; }

/* ---------- evidence popup (long never scrolls, evidence does) ---------- */
.an-scrim { position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center; background: rgba(1,4,9,.62); backdrop-filter: blur(2px); animation: an-fade .25s ease-out both; }
.an-pop { width: min(640px, 90%); max-height: 86vh; overflow: auto; padding: 20px 22px; border-radius: 18px; background: var(--an-s2); color: var(--an-tx); border: 1px solid var(--an-bd2); box-shadow: 0 30px 80px rgba(0,0,0,.55); animation: an-rise .34s cubic-bezier(.22,.8,.24,1) .05s both; }
.an-pop-h { display: flex; align-items: flex-start; gap: 12px; }
.an-pop-h > div { flex: 1; }
.an-pop-t { font-size: 19px; font-weight: 720; margin-top: 3px; }
.an-pop-k { font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--an-mu); }
.an-x { width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; color: var(--an-mu); box-shadow: inset 0 0 0 1px var(--an-bd2); }
.an-x:hover { color: var(--an-tx); }
.an-pop-b { margin-top: 14px; font-size: 13.5px; color: var(--an-tx2); }
.an-pop-b > * + * { margin-top: 8px; }

/* ---------- palette (CONCEPT_VIZ) ---------- */
[data-viz] { min-width: 0; }
.an-vz-text > * + * { margin-top: 6px; }
.an-vz-text ul { padding-left: 16px; list-style: disc; }
.an-kpi { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.an-kpi-v { font-size: 26px; font-weight: 780; letter-spacing: -.02em; color: var(--an-li); }
.an-kpi-u { font-size: 13px; font-weight: 600; color: var(--an-tx2); }
.an-kpi-d { font-size: 12px; font-weight: 650; color: var(--an-li); padding: 1px 7px; border-radius: 999px; background: var(--an-li-soft); }
.an-kpi-l { flex-basis: 100%; font-size: 12px; color: var(--an-mu); }
.an-vz-short .an-kpi-v { font-size: 20px; }
.an-bar-h { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--an-mu); margin-bottom: 4px; }
.an-bar-h b { color: var(--an-tx); }
.an-bar-t { height: 10px; border-radius: 5px; background: var(--an-s3); overflow: hidden; }
.an-bar-t > i { display: block; height: 100%; border-radius: 5px; background: linear-gradient(90deg, #58a6ff, var(--an-li)); }
.an-bars { display: flex; flex-direction: column; gap: 6px; }
.an-bars > div { display: grid; grid-template-columns: minmax(60px, 34%) minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 12px; color: var(--an-tx2); }
.an-bars b { font-weight: 700; color: var(--an-tx); font-size: 12px; }
.an-vz-short .an-bars { gap: 3px; }
.an-spark svg, .an-donut svg { display: block; }
.an-spark svg { width: 100%; height: 56px; }
.an-vz-short .an-spark svg { height: 24px; }
.an-spark small, .an-donut small { font-size: 11.5px; color: var(--an-mu); }
.an-spark-l { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--an-mu); }
.an-donut { display: flex; align-items: center; gap: 12px; }
.an-donut svg { width: 72px; height: 72px; flex: none; }
.an-vz-short .an-donut svg { width: 40px; height: 40px; }
.an-donut ul { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--an-tx2); }
.an-donut li { display: flex; align-items: center; gap: 6px; }
.an-donut li i { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.an-cmp { display: flex; flex-direction: column; gap: 6px; }
.an-cmp-r { display: grid; grid-template-columns: minmax(50px, 26%) minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 12px; color: var(--an-tx2); }
.an-cmp-r.an-after .an-bar-t > i { background: var(--an-li); }
.an-cmp-r:not(.an-after) .an-bar-t > i { background: var(--an-mu2); }
.an-cmp-d { font-size: 12px; font-weight: 700; color: var(--an-li); }
.an-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.an-flow > span { padding: 5px 9px; border-radius: 9px; background: var(--an-s3); font-size: 12px; color: var(--an-tx2); }
.an-flow > span b { display: block; color: var(--an-tx); font-size: 12.5px; }
.an-flow > i { font-style: normal; color: var(--an-mu2); }

@keyframes an-rise { from { opacity: 0; transform: translateY(46px); } to { opacity: 1; transform: none; } }
@keyframes an-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes an-draw { from { stroke-dashoffset: var(--len, 400); } to { stroke-dashoffset: 0; } }
@keyframes an-glow { 0%, 100% { box-shadow: 0 10px 30px rgba(31,111,235,.4), 0 0 0 0 rgba(47,129,247,.45); } 50% { box-shadow: 0 10px 30px rgba(31,111,235,.4), 0 0 0 12px rgba(47,129,247,0); } }
@media (prefers-reduced-motion: reduce) {
  [data-analysis] *, [data-analysis] *::before, [data-analysis] *::after { animation: none !important; transition: none !important; }
}
@media (max-width: 900px) {
  .an-enh { grid-template-columns: minmax(0, 1fr); }
  .an-enh > .an-ana { grid-column: 1; grid-row: 3; padding-top: 0; }
  [data-analysis] [data-question] { font-size: 25px; }
  .an-step { padding-right: 4px; }
}

/* section-nav state for mode decisions (updateSectionNavState) */
.section-nav-state.state-open { color: var(--text-secondary, #8b949e); }
.section-nav-state.state-decided { color: var(--accent-color, #58a6ff); }
.section-nav-state.state-issue { color: var(--accent-color, #58a6ff); font-weight: 600; }
```

## Engine UI — palette, stages, stepper, choreography (JS)

One namespaced block (`window.CONCEPT_VIZ`, `window.conceptAnalysis`); it only
**enhances** the authored markup and only ever writes the named controls of the
contract (`dm-{id}`, `dm-{id}.{opt}`, `-alt`, `-fix`, `-text`, `-touched`,
`-issue`, `-epic`, the `data-comment` note). Collect, bake and freeze therefore
need nothing else. UI strings are a small de/en table keyed off
`<html lang>` (no `{{key}}` rows needed).

What the code does, in the order of the file:

1. `CONCEPT_VIZ` — the palette registry (`text kpi bar bars spark donut compare flow`),
   `renderViz(root, size)`; unknown type or bad spec renders `spec.text`.
2. `setup(root)` — one instance per `[data-analysis]`: builds the stage list
   (briefing, topic intros, decisions, review, next round, list), the sticky
   stepper (Full) / progress dots (Lite), the foot of every decision (ONE note
   field, "Als Issue anlegen" link, Zurück / Weiter) and the mode widgets
   (slider bar, sortable order, inline alt / fix / custom fields).
3. The analysis column: three levels, one long at a time, with the
   choreography (≈ 1 s the first two times per page — counter in
   `localStorage`, try/catch — then ≈ 0.3 s; `prefers-reduced-motion` → no
   motion; "↻ Übergang" replays it).
4. Touched tracking: a stage open ≥ 3 s, or any change in it, writes
   `dm-{id}-touched` = `"1"` (and fires `input` + `change`, so persistence and
   the section nav see it).
5. Keys: Enter / ⇧+Enter, ← → stages, ↑ ↓ options, 1–N options (decision has
   focus), Home / End, ⇧+1–3 topics, PgUp / PgDn levels, N note, I issue,
   L list, R replay, B evidence, U first untouched, Esc closes the popup.

```javascript
(function () {
  'use strict';
  if (window.conceptAnalysis) return;
  const DE = () => String(document.documentElement.lang || 'en').slice(0, 2) === 'de';
  const L = (de, en) => (DE() ? de : en);
  const WJ = String.fromCharCode(0x2060);
  const BS = String.fromCharCode(92);
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssEsc = s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => BS + c);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const num = x => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const fmt = n => (Math.round(num(n) * 10) / 10).toLocaleString(DE() ? 'de-DE' : 'en-US');
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function btn(cls, text) { const b = h('button', cls, text); b.type = 'button'; return b; }
  // App tooltip (templates-utilities.md): a visible name gets only its keycap.
  function tip(el, text, key) {
    if (key) {
      el.setAttribute('data-tip-key', key);
      el.setAttribute('aria-keyshortcuts', key.replace('⇧+', 'Shift+').replace('Pos1', 'Home').replace('Ende', 'End'));
    }
    if (text) el.setAttribute('data-tip', text);
    else if (key) { el.setAttribute('data-tip', WJ); el.setAttribute('data-tip-key-only', 'true'); }
  }

  /* ================= 1. palette: CONCEPT_VIZ ================= */
  const VIZ = (window.CONCEPT_VIZ = window.CONCEPT_VIZ || {});
  const SEG = ['#79c0ff', '#58a6ff', '#a5d6ff', '#388bfd', '#b6e3ff', '#8cb4ff'];
  const list = (a) => (Array.isArray(a) ? a : []);
  VIZ.text = (el, s) => {
    el.textContent = '';
    el.classList.add('an-vz-text');
    let ul = null;
    String(s.text == null ? '' : s.text).split(/\n+/).filter(l => l.trim()).forEach(line => {
      const m = /^\s*[-•]\s+(.*)$/.exec(line);
      if (m) { if (!ul) { ul = h('ul'); el.appendChild(ul); } ul.appendChild(h('li', '', m[1])); }
      else { ul = null; el.appendChild(h('p', '', line.trim())); }
    });
  };
  VIZ.kpi = (el, s) => {
    el.innerHTML = '<span class="an-kpi"><b class="an-kpi-v">' + esc(s.value) + '</b>'
      + (s.unit ? '<span class="an-kpi-u">' + esc(s.unit) + '</span>' : '')
      + (s.delta ? '<span class="an-kpi-d">' + esc(s.delta) + '</span>' : '')
      + (s.label ? '<span class="an-kpi-l">' + esc(s.label) + '</span>' : '') + '</span>';
  };
  VIZ.bar = (el, s) => {
    const max = num(s.max) || 100, v = num(s.value);
    el.innerHTML = '<div class="an-bar"><div class="an-bar-h"><span>' + esc(s.label || '') + '</span><b>' + esc(fmt(v) + (s.unit ? ' ' + s.unit : '')) + '</b></div>'
      + '<div class="an-bar-t" role="img" aria-label="' + esc(fmt(v) + ' / ' + fmt(max)) + '"><i style="width:' + clamp(v / max * 100, 0, 100) + '%"></i></div></div>';
  };
  VIZ.bars = (el, s, ctx) => {
    const items = list(s.items), top = ctx && ctx.size === 'short' ? 3 : items.length;
    const max = Math.max.apply(null, items.map(i => num(i.value)).concat([1]));
    el.innerHTML = '<div class="an-bars">' + items.slice(0, top).map(i =>
      '<div><span>' + esc(i.label) + '</span><div class="an-bar-t"><i style="width:' + clamp(num(i.value) / max * 100, 0, 100) + '%"></i></div><b>'
      + esc(fmt(i.value) + (s.unit ? ' ' + s.unit : '')) + '</b></div>').join('') + '</div>';
  };
  VIZ.spark = (el, s, ctx) => {
    const pts = list(s.points).map(num);
    if (pts.length < 2) { VIZ.text(el, { text: s.label || '' }); return; }
    const W = 200, H = 48, lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), span = hi - lo || 1;
    const xy = pts.map((p, i) => [4 + i * (W - 8) / (pts.length - 1), H - 5 - (p - lo) / span * (H - 12)]);
    const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = xy[xy.length - 1];
    el.innerHTML = '<div class="an-spark"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(s.label || '') + '">'
      + '<path d="' + d + ' L' + last[0] + ' ' + H + ' L4 ' + H + ' Z" fill="#79c0ff" opacity=".14"/>'
      + '<path d="' + d + '" fill="none" stroke="#79c0ff" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'
      + '<circle cx="' + last[0] + '" cy="' + last[1].toFixed(1) + '" r="3" fill="#79c0ff"/></svg>'
      + (ctx && ctx.size === 'short' ? '' : '<div class="an-spark-l"><span>' + esc(s.label || '') + '</span><span>' + esc(fmt(pts[0]) + ' → ' + fmt(pts[pts.length - 1])) + '</span></div>') + '</div>';
  };
  VIZ.donut = (el, s) => {
    const parts = list(s.parts), total = parts.reduce((a, p) => a + Math.max(0, num(p.value)), 0) || 1;
    let off = 0, arcs = '';
    parts.forEach((p, i) => {
      const pct = Math.max(0, num(p.value)) / total * 100;
      arcs += '<circle cx="21" cy="21" r="15.9155" fill="none" stroke="' + SEG[i % SEG.length] + '" stroke-width="6" stroke-dasharray="' + pct.toFixed(2) + ' ' + (100 - pct).toFixed(2) + '" stroke-dashoffset="' + (25 - off).toFixed(2) + '"/>';
      off += pct;
    });
    el.innerHTML = '<div class="an-donut"><svg viewBox="0 0 42 42" role="img" aria-label="' + esc(parts.map(p => p.label + ' ' + p.value).join(', ')) + '"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgba(128,138,150,.25)" stroke-width="6"/>' + arcs + '</svg><ul>'
      + parts.map((p, i) => '<li><i style="background:' + SEG[i % SEG.length] + '"></i>' + esc(p.label) + ' <b>' + Math.round(num(p.value) / total * 100) + ' %</b></li>').join('') + '</ul></div>';
  };
  VIZ.compare = (el, s) => {
    const a = s.before || {}, b = s.after || {}, max = Math.max(num(a.value), num(b.value), 1);
    const delta = num(a.value) ? Math.round((num(b.value) - num(a.value)) / num(a.value) * 100) : 0;
    const row = (x, cls) => '<div class="an-cmp-r ' + cls + '"><span>' + esc(x.label || '') + '</span><div class="an-bar-t"><i style="width:' + clamp(num(x.value) / max * 100, 0, 100) + '%"></i></div><b>' + esc(fmt(x.value) + (s.unit ? ' ' + s.unit : '')) + '</b></div>';
    el.innerHTML = '<div class="an-cmp">' + row(a, 'an-before') + row(b, 'an-after') + '<span class="an-cmp-d">' + (delta > 0 ? '+' : '') + delta + ' %</span></div>';
  };
  VIZ.flow = (el, s) => {
    el.innerHTML = '<div class="an-flow">' + list(s.steps).map((st, i) => (i ? '<i>→</i>' : '') + '<span>' + (st.value != null && st.value !== '' ? '<b>' + esc(st.value) + '</b>' : '') + esc(st.label) + '</span>').join('') + '</div>';
  };
  /** Render every [data-viz] below root once. size = "short" | "long". */
  function renderViz(root, size) {
    (root.matches && root.matches('[data-viz]') ? [root] : []).concat([...root.querySelectorAll('[data-viz]')]).forEach(el => {
      if (el.dataset.vizDone || el.closest('[data-alevel]')) return;   // authored level sources stay raw; the column renders clones
      let spec = null;
      try { spec = JSON.parse(el.getAttribute('data-viz-spec') || 'null'); } catch (e) { spec = null; }
      if (!spec || typeof spec !== 'object') return;          // keep the authored fallback text
      let fn = VIZ[el.getAttribute('data-viz')];
      if (!fn) {
        // Custom type: the author's own markup (inline SVG ...) stays; spec.text only fills an empty element.
        if (el.children.length || el.textContent.trim()) { el.dataset.vizDone = '1'; return; }
        fn = VIZ.text;
      }
      try { fn(el, spec, { size: size || 'long' }); } catch (e) { try { VIZ.text(el, spec); } catch (e2) { /* keep */ } }
      el.dataset.vizDone = '1';
      el.classList.add('an-vz-' + (size || 'long'));
    });
  }

  /* ================= 2. helpers over the contract ================= */
  const instances = [];
  const TOPIC_COLORS = ['#a371f7', '#39c5cf', '#7c8cff', '#c297ff', '#5ec8e5', '#9aa8ff', '#b392f0'];   // never red / green / orange
  const decId = d => d.dataset.decision;
  const ctl = (d, name) => [...d.querySelectorAll('input, textarea, select')].filter(c => (c.name || '') === name);
  const ctl1 = (d, name) => ctl(d, name)[0] || null;
  const optEl = (d, v) => [...d.querySelectorAll('[data-opt]')].find(o => o.getAttribute('data-opt') === v) || null;
  const optLabel = (d, v) => { const o = optEl(d, v); const l = o && o.querySelector('[data-opt-label]'); return l ? l.textContent.trim() : String(v); };
  const optCons = o => { const c = o && o.querySelector('[data-opt-consequence]'); return c ? c.textContent.trim() : ''; };
  const recList = d => String(d.dataset.rec || '').split(/[\s,]+/).filter(Boolean);
  const isTouched = d => { const c = ctl1(d, 'dm-' + decId(d) + '-touched'); return !!c && c.value === '1'; };
  const entryOf = d => (typeof collectModeDecision === 'function' ? collectModeDecision(d) : { id: decId(d), mode: d.dataset.decisionMode, value: '', deviates: false, untouched: !isTouched(d), issue: false });
  function stateOf(inst, d) {
    const e = entryOf(d);
    if (e.issue) return 'iss';
    if (e.untouched) return inst.visited.has(decId(d)) ? 'un' : 'open';
    return e.deviates ? 'dev' : 'ok';
  }
  function stateText(s) {
    return { ok: L('entschieden', 'decided'), dev: L('weicht von der Empfehlung ab', 'differs from the recommendation'), iss: L('Issue', 'issue'), un: L('offen, kurz gesehen', 'open, glanced at'), open: L('offen', 'open') }[s];
  }
  function valueText(d, e) {
    const m = e.mode, v = e.value, unit = d.dataset.unit ? ' ' + d.dataset.unit : '';
    if (m === 'multi') return v.length ? v.map(x => optLabel(d, x)).join(', ') : L('nichts gewählt', 'nothing picked');
    if (m === 'yesnoalt') return v.answer === 'alt' ? L('Anders: ', 'Other: ') + (v.alt || '…') : v.answer ? optLabel(d, v.answer) : '–';
    if (m === 'slider') return v == null ? '–' : fmt(v) + unit;
    if (m === 'order') return v.map(x => optLabel(d, x)).join(' → ');
    if (m === 'wording') return v || '–';
    return v ? optLabel(d, v) : '–';
  }
  function recText(d) {
    const m = d.dataset.decisionMode, r = recList(d);
    if (m === 'slider') return r[0] + (d.dataset.unit ? ' ' + d.dataset.unit : '');
    if (m === 'order') return r.map(x => optLabel(d, x)).join(' → ');
    return r.map(x => optLabel(d, x)).join(', ');
  }
  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setHidden(d, suffix, value) {
    const name = 'dm-' + decId(d) + suffix;
    let c = ctl1(d, name);
    if (!c) { c = h('input'); c.type = 'hidden'; c.name = name; d.appendChild(c); }
    if (c.value === value || c.disabled) return false;
    c.value = value;
    fire(c);
    return true;
  }
  /** Touched = open >= 3 s or changed. Idempotent; returns true when it wrote. */
  function markTouched(d) {
    const wrote = setHidden(d, '-touched', '1');
    const inst = instances.find(i => i.root.contains(d));
    if (wrote && inst) refresh(inst);
    return wrote;
  }

  /* choreography duration: slow the first two times per page */
  const CK = 'concept-an-transitions:' + (location.pathname || '/');
  function transCount() { try { return parseInt(localStorage.getItem(CK) || '0', 10) || 0; } catch (e) { return 0; } }
  function bumpTrans() { try { const v = String(transCount() + 1); if (typeof _guardedSetItem === 'function') _guardedSetItem(CK, v); else localStorage['setItem'](CK, v); } catch (e) { /* private mode */ } }
  function transMs() { return reduced() ? 0 : (transCount() < 2 ? 1000 : 300); }

  /* ================= 3. analysis column ================= */
  function levelSrc(inst, st, n) {
    if (n === 1) return inst.root.querySelector('[data-alevel="1"]');
    if (n === 2) return st.topic ? [...st.topic.children].find(c => c.getAttribute('data-alevel') === '2') || null : null;
    return st.kind === 'dec' ? st.el.querySelector('[data-alevel="3"]') : null;
  }
  function wanted(inst, st) {
    let w = {};
    if (st.kind === 'brief' || st.kind === 'start') w = { 1: 'long' };
    else if (st.kind === 'topic') w = { 1: 'short', 2: 'long' };
    else if (st.kind === 'dec') w = inst.lite ? { 1: 'short', 3: 'long' } : { 1: 'short', 2: 'short', 3: 'long' };
    const present = [1, 2, 3].filter(n => w[n] && levelSrc(inst, st, n));
    if (present.length && !present.some(n => w[n] === 'long')) w[present[present.length - 1]] = 'long';
    return w;
  }
  function slotNodes(src, kind) {
    const slot = [...src.children].find(c => c.getAttribute('data-slot') === kind);
    const box = h('div');
    if (slot) {
      const c = slot.cloneNode(true);
      c.querySelectorAll('[data-evidence]').forEach(e => e.remove());
      c.querySelectorAll('[data-viz-done]').forEach(e => e.removeAttribute('data-viz-done'));
      while (c.firstChild) box.appendChild(c.firstChild);
    }
    return box;
  }
  function buildLevel(inst, n, src) {
    const node = h('div', 'an-lv');
    node.dataset.n = String(n);
    node.dataset.state = 'short';
    node.__src = src;
    const head = btn('an-lv-h');
    head.innerHTML = '<i class="an-lv-i"></i><span class="an-lv-t"></span>';
    head.querySelector('.an-lv-t').textContent = src.dataset.title || '';
    tip(head, L('Auf- oder zuklappen · Bild↑ / Bild↓ wechselt die Stufe', 'Expand or collapse · PgUp / PgDn switches level'));
    head.setAttribute('aria-expanded', 'false');
    head.addEventListener('click', () => openLevel(inst, n));
    const ws = h('div', 'an-w an-w-s'), wl = h('div', 'an-w an-w-l');
    const is = h('div', 'an-in'), il = h('div', 'an-in');
    const short = slotNodes(src, 'short'), long = slotNodes(src, 'long');
    if (!short.childNodes.length && long.firstElementChild) short.appendChild(long.firstElementChild.cloneNode(true));
    is.appendChild(short);
    il.appendChild(long);
    if (n === 3) long.insertBefore(h('div', 'an-cons-slot'), long.firstChild);
    const ev = [...src.querySelectorAll('[data-evidence]')];
    if (ev.length) {
      const b = btn('an-ev', '🔎 ' + L('Belege', 'Evidence'));
      tip(b, '', 'B');
      b.addEventListener('click', () => openEvidence(inst, src.dataset.title || '', ev, b));
      long.appendChild(b);
    }
    ws.appendChild(is); wl.appendChild(il);
    node.append(head, ws, wl);
    renderViz(short, 'short');
    renderViz(long, 'long');
    return node;
  }
  function setState(node, state) {
    node.dataset.state = state;
    const b = node.querySelector('.an-lv-h');
    if (b) b.setAttribute('aria-expanded', state === 'long' ? 'true' : 'false');
  }
  /** Accordion: n long, every other present level short. */
  function openLevel(inst, n) {
    if (!inst.lv[n]) return;
    [1, 2, 3].forEach(k => { if (inst.lv[k]) setState(inst.lv[k], k === n ? 'long' : 'short'); });
  }
  function stepLevel(inst, dir) {
    const present = [1, 2, 3].filter(k => inst.lv[k]);
    if (!present.length) return;
    const cur = present.find(k => inst.lv[k].dataset.state === 'long');
    const i = present.indexOf(cur);
    openLevel(inst, present[clamp((i < 0 ? 0 : i) + dir, 0, present.length - 1)]);
  }
  function applyLevels(inst, st, opt) {
    opt = opt || {};
    const dur = opt.dur != null ? opt.dur : transMs();
    inst.root.style.setProperty('--an-dur', dur + 'ms');
    inst.timers.forEach(clearTimeout);
    inst.timers = [];
    const want = wanted(inst, st);
    let animated = false;
    [1, 2, 3].forEach(n => {
      const src = want[n] ? levelSrc(inst, st, n) : null;
      let node = inst.lv[n];
      if (!src) { if (node) { node.remove(); delete inst.lv[n]; } return; }
      if (node && node.__src !== src) { node.remove(); node = null; delete inst.lv[n]; }
      if (node) { setState(node, want[n]); return; }
      node = buildLevel(inst, n, src);
      inst.lv[n] = node;
      const after = [1, 2, 3].filter(k => k < n && inst.lv[k]).pop();
      if (after) inst.lvs.insertBefore(node, inst.lv[after].nextSibling); else inst.lvs.insertBefore(node, inst.lvs.firstChild);
      if (n > 1 && dur) {
        animated = true;
        setState(node, 'short');
        const cls = opt.swap && n === 3 ? 'an-swap' : 'an-enter';
        node.classList.add(cls);
        node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
        if (want[n] === 'long') inst.timers.push(setTimeout(() => setState(node, 'long'), Math.round(dur * 0.6)));
      } else setState(node, want[n]);
    });
    if (animated && !opt.replay) bumpTrans();
    updateCons(inst);
  }
  function consequenceNode(d) {
    const e = entryOf(d), box = h('div', 'an-cons');
    box.appendChild(h('b', '', L('Folge deiner Wahl', 'What your choice does')));
    const m = e.mode;
    if (m === 'multi') {
      const ul = h('ul');
      e.value.forEach(v => { const li = h('li'); li.textContent = optLabel(d, v) + (optCons(optEl(d, v)) ? ' — ' + optCons(optEl(d, v)) : ''); ul.appendChild(li); });
      box.appendChild(e.value.length ? ul : h('span', '', L('Nichts gewählt.', 'Nothing picked.')));
    } else if (m === 'slider' || m === 'order' || m === 'wording') {
      box.appendChild(h('span', '', valueText(d, e)));
    } else {
      const o = optEl(d, m === 'yesnoalt' ? e.value.answer : e.value);
      const c = optCons(o);
      box.appendChild(h('span', '', valueText(d, e) + (c ? ' — ' + c : '')));
    }
    return box;
  }
  function updateCons(inst) {
    const st = inst.stages[inst.idx], node = inst.lv[3];
    if (!node) return;
    const slot = node.querySelector('.an-cons-slot');
    if (!slot || !st || st.kind !== 'dec') return;
    const want = isTouched(st.el);
    const have = slot.firstChild && slot.firstChild.__for;
    if (!want) { slot.textContent = ''; return; }
    const n = consequenceNode(st.el);
    if (have && slot.firstChild.textContent === n.textContent) return;
    n.__for = true;
    slot.textContent = '';
    slot.appendChild(n);
  }
  function openEvidence(inst, title, nodes, opener) {
    closeEvidence(inst);
    const scrim = h('div', 'an-scrim'), pop = h('div', 'an-pop');
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true');
    const x = btn('an-x', '✕');
    tip(x, '', 'Esc');
    x.setAttribute('aria-label', L('Schließen', 'Close'));
    const head = h('div', 'an-pop-h'), hd = h('div');
    hd.append(h('div', 'an-pop-k', L('Belege', 'Evidence')), h('div', 'an-pop-t', title));
    head.append(hd, x);
    const body = h('div', 'an-pop-b');
    nodes.forEach(n => { const c = n.cloneNode(true); c.removeAttribute('hidden'); c.removeAttribute('data-evidence'); body.appendChild(c); });
    pop.append(head, body);
    scrim.appendChild(pop);
    scrim.addEventListener('click', e => { if (e.target === scrim) closeEvidence(inst); });
    x.addEventListener('click', () => closeEvidence(inst));
    inst.root.appendChild(scrim);
    inst.pop = { scrim, opener };
    x.focus({ preventScroll: true });
  }
  function closeEvidence(inst) {
    if (!inst.pop) return false;
    const { scrim, opener } = inst.pop;
    scrim.remove();
    inst.pop = null;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    return true;
  }

  /* ================= 4. instance: stages, stepper, briefing ================= */
  function setup(root) {
    if (root.__an) return root.__an;
    const lite = root.getAttribute('data-analysis') === 'lite';
    const inst = { root, lite, stages: [], groups: [], idx: 0, lv: {}, timers: [], visited: new Set(), decs: [], pop: null, maxIdx: 0, touchTimer: 0 };
    root.__an = inst;
    instances.push(inst);
    root.classList.add('an-enh');
    if (lite) root.classList.add('an-lite');
    const nodes = [...root.querySelectorAll('[data-analysis-briefing], [data-topic], [data-decision][data-decision-mode]')]
      .filter(n => n.closest('[data-analysis]') === root);
    let topicIdx = -1;
    nodes.forEach(n => {
      if (n.hasAttribute('data-analysis-briefing')) { inst.stages.push({ kind: 'brief', el: n }); inst.brief = n; return; }
      if (n.hasAttribute('data-topic')) {
        topicIdx++;
        const color = TOPIC_COLORS[topicIdx % TOPIC_COLORS.length];
        n.style.setProperty('--c', color);
        const intro = h('section', 'an-stage an-intro');
        n.insertBefore(intro, n.firstChild);
        const g = { topic: n, label: n.dataset.navLabel || n.id, color, intro, decs: [], idx: topicIdx };
        inst.groups.push(g);
        inst.stages.push({ kind: 'topic', el: intro, topic: n, group: g });
        return;
      }
      const topic = n.parentElement && n.parentElement.closest('[data-topic]');
      const g = topic ? inst.groups.find(x => x.topic === topic) : null;
      const st = { kind: 'dec', el: n, topic: topic || null, group: g };
      inst.stages.push(st);
      inst.decs.push(st);
      if (g) g.decs.push(st);
    });
    if (lite) {
      const l1 = root.querySelector('[data-alevel="1"]');
      if (l1) {
        const start = h('section', 'an-stage an-start');
        root.insertBefore(start, root.firstChild);
        inst.stages.unshift({ kind: 'start', el: start });
      }
      const done = h('section', 'an-stage an-fin');
      root.appendChild(done);
      inst.stages.push({ kind: 'done', el: done });
    } else {
      ['review', 'next', 'list'].forEach(k => {
        const el = h('section', 'an-stage an-' + k);
        root.appendChild(el);
        inst.stages.push({ kind: k, el, aux: k === 'list' });
      });
    }
    inst.seq = inst.stages.filter(s => !s.aux);
    // Aside: the three analysis levels.
    const ana = h('aside', 'an-ana');
    const ah = h('div', 'an-ana-h');
    ah.appendChild(h('span', '', L('Analyse', 'Analysis')));
    const rp = btn('an-rp', '↻ ' + L('Übergang', 'Transition'));
    tip(rp, '', 'R');
    rp.addEventListener('click', () => replay(inst));
    ah.appendChild(rp);
    inst.lvs = h('div', 'an-lvs');
    ana.append(ah, inst.lvs);
    inst.ana = ana;
    root.appendChild(ana);
    inst.decs.forEach(st => prepDecision(inst, st));
    if (inst.brief) prepBrief(inst);
    inst.groups.forEach(g => prepIntro(inst, g));
    if (lite) prepLiteStart(inst);
    buildStepper(inst);
    root.addEventListener('input', e => onEdit(inst, e));
    root.addEventListener('change', e => onEdit(inst, e));
    root.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[data-go]'); if (t) go(inst, Number(t.dataset.go)); });
    root.addEventListener('pointerdown', () => { if (!root.contains(document.activeElement)) { const st = inst.stages[inst.idx]; if (st && st.el.tabIndex === -1) st.el.focus({ preventScroll: true }); } });
    if (typeof ResizeObserver === 'function') {
      let w = 0;
      new ResizeObserver(() => { const nw = root.offsetWidth; if (nw !== w) { w = nw; drawConn(inst); armTouch(inst); } }).observe(root);
    }
    go(inst, 0, { initial: true });
    return inst;
  }
  const isWideKind = k => k === 'review' || k === 'next' || k === 'list' || k === 'done';

  function buildStepper(inst) {
    const old = inst.root.querySelector(':scope > .an-step, :scope > .an-lhead');
    if (old) old.remove();
    if (inst.lite) {
      const head = h('div', 'an-lhead');
      const l1 = inst.root.querySelector('[data-alevel="1"]');
      head.appendChild(h('div', 'an-lt', (l1 && l1.dataset.title) || inst.root.dataset.navLabel || L('Kurze Fragen', 'Quick questions')));
      const pr = h('div', 'an-lpr');
      pr.appendChild(h('span', 'an-lcount'));
      const dots = h('span', 'an-dots');
      inst.decs.forEach(st => { const b = btn('an-dot'); b.dataset.go = String(inst.stages.indexOf(st)); b.dataset.dec = decId(st.el); dots.appendChild(b); });
      pr.appendChild(dots);
      head.appendChild(pr);
      inst.root.insertBefore(head, inst.root.firstChild);
      inst.stepEl = head;
      return;
    }
    const nav = h('nav', 'an-step');
    nav.setAttribute('aria-label', L('Fortschritt', 'Progress'));
    const bk = btn('an-k'); bk.dataset.k = 'brief';
    bk.innerHTML = '<span class="an-ic">✓</span>';
    bk.appendChild(document.createTextNode(inst.brief ? (inst.brief.dataset.navLabel || 'Briefing') : 'Briefing'));
    bk.dataset.go = String(inst.stages.findIndex(s => s.kind === 'brief'));
    tip(bk, '', 'Pos1');
    if (inst.brief) nav.append(bk, h('i', 'an-sep'));
    inst.groups.forEach((g, gi) => {
      const grp = h('div', 'an-grp'); grp.style.setProperty('--c', g.color); grp.dataset.g = String(gi);
      const gl = btn('an-gl');
      gl.innerHTML = '<span class="an-ic">✓</span><i></i>';
      gl.appendChild(document.createTextNode(g.label));
      gl.dataset.go = String(inst.stages.indexOf(inst.stages.find(s => s.group === g && s.kind === 'topic')));
      tip(gl, '', '⇧+' + (gi + 1));
      const dots = h('span', 'an-dots');
      g.decs.forEach(st => { const b = btn('an-dot'); b.dataset.go = String(inst.stages.indexOf(st)); b.dataset.dec = decId(st.el); dots.appendChild(b); });
      grp.append(gl, dots);
      nav.append(grp, h('i', 'an-sep'));
    });
    const rv = btn('an-k', L('Review', 'Review')); rv.dataset.k = 'review'; rv.dataset.go = String(inst.stages.findIndex(s => s.kind === 'review'));
    tip(rv, '', 'Ende');
    const nx = btn('an-k', L('Nächste Runde', 'Next round')); nx.dataset.k = 'next'; nx.dataset.go = String(inst.stages.findIndex(s => s.kind === 'next'));
    nav.append(rv, h('i', 'an-sep'), nx);
    inst.root.insertBefore(nav, inst.root.firstChild);
    inst.stepEl = nav;
  }
  function refreshStepper(inst) {
    const cur = inst.stages[inst.idx];
    const decStates = new Map(inst.decs.map(st => [st, stateOf(inst, st.el)]));
    inst.stepEl.querySelectorAll('.an-dot').forEach(b => {
      const st = inst.decs.find(x => decId(x.el) === b.dataset.dec);
      const s = decStates.get(st);
      b.className = 'an-dot an-s-' + s + (st === cur ? ' an-cur' : '');
      tip(b, ((st.el.dataset.label || decId(st.el))) + ' · ' + stateText(s));
      b.setAttribute('aria-label', st.el.dataset.label + ' · ' + stateText(s));
      if (st === cur) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    if (inst.lite) {
      const n = inst.decs.indexOf(cur) + 1;
      const c = inst.stepEl.querySelector('.an-lcount');
      if (c) c.textContent = n ? n + ' / ' + inst.decs.length : '';
      return;
    }
    const k = inst.stepEl.querySelector('[data-k="brief"]');
    if (k) { k.classList.toggle('an-on', cur.kind === 'brief'); k.classList.toggle('an-done', inst.maxIdx > inst.stages.findIndex(s => s.kind === 'brief')); tip(k, L('Briefing · Analyse, Potential, Themenfelder', 'Briefing · analysis, potential, topics'), 'Pos1'); }
    const seps = [...inst.stepEl.querySelectorAll(':scope > .an-sep')];
    inst.groups.forEach((g, gi) => {
      const grp = inst.stepEl.querySelector('.an-grp[data-g="' + gi + '"]');
      const done = g.decs.length > 0 && g.decs.every(st => decStates.get(st) !== 'open' && decStates.get(st) !== 'un');
      grp.classList.toggle('an-gdone', done);
      grp.classList.toggle('an-on', cur.group === g);
      const sep = grp.nextElementSibling;
      if (sep) sep.classList.toggle('an-sd', done);
      const gl = grp.querySelector('.an-gl');
      const nDone = g.decs.filter(st => decStates.get(st) !== 'open' && decStates.get(st) !== 'un').length;
      tip(gl, g.label + ' · ' + nDone + '/' + g.decs.length + ' ' + L('entschieden', 'decided'), '⇧+' + (gi + 1));
    });
    void seps;
    ['review', 'next'].forEach(kd => { const b = inst.stepEl.querySelector('[data-k="' + kd + '"]'); if (b) b.classList.toggle('an-on', cur.kind === kd); });
  }

  function prepBrief(inst) {
    const b = inst.brief, root = inst.root;
    b.classList.add('an-stage', 'an-brief');
    b.tabIndex = -1;
    const what = b.querySelector('[data-briefing-what]');
    b.setAttribute('data-an-kicker', L('Analyse', 'Analysis'));
    const chipsEls = [...b.querySelectorAll('[data-briefing-topic]')];
    if (chipsEls.length) {
      const wrap = h('div', 'an-chips');
      chipsEls[0].parentNode.insertBefore(wrap, chipsEls[0]);
      chipsEls.forEach((c, i) => {
        const g = inst.groups.find(x => x.topic.id === c.getAttribute('data-briefing-topic'));
        c.style.setProperty('--c', g ? g.color : TOPIC_COLORS[i % TOPIC_COLORS.length]);
        c.setAttribute('role', 'button'); c.tabIndex = 0;
        const share = num(c.dataset.share);
        const meta = h('em', '', (g ? g.decs.length + ' ' + L('Entscheidungen', 'decisions') : '') + (share ? (g ? ' · ' : '') + Math.round(share) + ' %' : ''));
        c.appendChild(meta);
        const idx = g ? inst.stages.findIndex(s => s.group === g && s.kind === 'topic') : -1;
        c.dataset.go = String(idx);
        tip(c, '', g ? '⇧+' + (inst.groups.indexOf(g) + 1) : '');
        c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); c.click(); } });
        wrap.appendChild(c);
      });
    }
    const dur = b.querySelector('[data-briefing-duration]');
    if (dur) dur.style.display = 'none';
    const cta = h('div', 'an-cta');
    const t = h('div', 'an-cta-t');
    t.append(h('b', '', L("Los geht's", "Let's go")), document.createTextNode((dur ? dur.textContent.trim() : '') + (inst.decs.length ? (dur ? ' · ' : '') + inst.decs.length + ' ' + L('Entscheidungen', 'decisions') : '')));
    const go1 = btn('an-btn', L("Los geht's", "Let's go") + ' →');
    tip(go1, '', 'Enter');
    go1.addEventListener('click', () => { go1.classList.add('an-pressed'); go(inst, inst.stages.findIndex(s => s.kind === 'brief') + 1); });
    cta.append(t, go1);
    b.appendChild(cta);
    const q = h('div', 'an-quiet');
    q.appendChild(listLink(inst));
    b.appendChild(q);
    void what; void root;
  }
  function listLink(inst) {
    const l = btn('an-link', L('Alle als Liste', 'All as list'));
    tip(l, '', 'L');
    l.addEventListener('click', () => go(inst, inst.stages.findIndex(s => s.kind === 'list')));
    return l;
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
    const next = btn('an-btn', nextLabel || L('Weiter', 'Next'));
    tip(next, '', 'Enter');
    next.addEventListener('click', () => step(inst, 1));
    if (!opts.noBack) go2.appendChild(back);
    if (!opts.noNext) go2.appendChild(next);
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
    // Foot: ONE note field, discreet issue link, Zurück / Weiter.
    const foot = h('div', 'an-foot'), quiet = h('div', 'an-quiet');
    const note = d.querySelector('[data-comment="' + cssEsc(id + '-note') + '"]');
    if (note) {
      note.classList.add('an-note'); note.rows = 1;
      note.setAttribute('aria-label', L('Notiz zu dieser Frage', 'Note on this question'));
      tip(note, '', 'N');
      note.addEventListener('input', () => { note.style.height = 'auto'; note.style.height = Math.min(note.scrollHeight, 120) + 'px'; });
      if (note.parentNode !== quiet) quiet.appendChild(note.closest('.field-row') || note);
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
    const rv = h('div', 'an-rv');
    if (dev.length) rv.appendChild(rgroup(L('Weicht von der Empfehlung ab', 'Differs from the recommendation'), 'dev', dev.map(x => reviewRow(inst, x, [tag(valueText(x.d, x.e), 'an-y'), tag(recText(x.d), 'an-r')]))));
    else rv.appendChild(h('div', 'an-sub', L('Alles wie empfohlen.', 'Everything as recommended.')));
    if (iss.length) rv.appendChild(rgroup('Issues', 'iss', iss.map(x => reviewRow(inst, x, [tag(x.e.epic ? 'Epic: ' + x.e.epic : L('als Issue', 'as issue'), 'an-i'), h('span')]))));
    if (un.length) {
      const bar = h('div', 'an-unt');
      bar.appendChild(h('span', '', L('Nie geöffnet oder kürzer als 3 s offen — die Vorauswahl gilt.', 'Never opened or open under 3 s — the preselection stands.')));
      const jump = btn('an-btn2', L('Zum ersten Unberührten', 'Jump to the first untouched'));
      tip(jump, '', 'U');
      jump.addEventListener('click', () => firstUntouched(inst));
      bar.appendChild(jump);
      rv.appendChild(rgroup(L('Unberührt', 'Untouched'), 'un', un.map(x => reviewRow(inst, x, [tag(valueText(x.d, x.e), 'an-u'), h('span')])), bar));
    }
    const imp = impactSpec(inst, ents), box = h('div', 'an-imp');
    box.appendChild(h('h4', '', imp.title));
    const viz = h('div'); viz.setAttribute('data-viz', 'bars'); viz.setAttribute('data-viz-spec', JSON.stringify(imp.spec));
    box.appendChild(viz);
    renderViz(box, 'long');
    rv.appendChild(box);
    rv.appendChild(h('div', 'an-send', L('Absenden geht über das Panel oder das Menü unten rechts. Der 💬 Chat bleibt jederzeit offen.', 'Submit from the panel or the menu at the bottom right. The 💬 chat stays open.')));
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
    foot.appendChild(goButtons(inst, '', { noNext: true }));
    el.appendChild(foot);
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
  window.addEventListener('resize', () => instances.forEach(drawConn), { passive: true });

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
