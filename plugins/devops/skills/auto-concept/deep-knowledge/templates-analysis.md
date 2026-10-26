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

**Wave status.** This part is the contract and the collect code (wave 1).
Visual CSS, the stepper, the level choreography and the palette renderers are
wave 2 (frontend) and are marked TODO below; nothing here depends on them to
collect, bake, freeze or gate a page.

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

## Styling, stepper, choreography (TODO — wave 2, frontend)

TODO: CSS for Full + Lite (briefing, 66/33 stage, levels, option cards,
stepper, review, next-round card) as a `css` block in this part.

TODO: JS for the stepper (segments per topic, one dot per decision, tooltips),
the L1/L2/L3 accordion choreography (≈ 1 s the first two times, then ≈ 0.3 s,
localStorage count in try/catch, `prefers-reduced-motion`), the 3 s
touched timer that writes `dm-{id}-touched`, hotkeys, the `CONCEPT_VIZ`
registry, the order / slider widgets that write their hidden / range control,
and the Lite progress dots. Contract for that code: it only ever writes the
named controls above (and `data-comment` notes) — collect, bake and freeze
need nothing else.
