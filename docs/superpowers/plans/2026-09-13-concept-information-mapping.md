# Concept Information Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `mapping` construct for the concept skill — Claude proposes an items → targets assignment, the user corrects it in a generated schematic view or a matrix view, and the page ships a typed `mappings[]` payload — as a view kind inside design iterations and a block inside free iterations.

**Architecture:** One engine block in `templates.md` (`renderMappings` / `refreshMappings` / `setCell` / `collectMappings` / `mappingProgress`, an IIFE like the annotation layer, always copied, early-returning without `[data-mapping]`) renders both views from a JSON spec; unnamed checkboxes are the DOM truth, one CSS-hidden text input per matrix is the persisted form on the existing `text:` path. Four existing engine functions get one-line hooks (persistence handler, `restoreState`, the three collectors, `buildDesignUI`, `buildSectionNav`); the deterministic gate gains `findMappingIssues`; SKILL.md / validation-gate.md / iteration-rules.md document the construct.

**Tech Stack:** Plain DOM JS + CSS inside `templates.md` fenced blocks (copied verbatim into generated pages), vitest + jsdom for behaviour, Node CommonJS for the gate hook, Playwright MCP for the real-browser check.

Spec: `docs/superpowers/specs/2026-09-13-concept-information-mapping-design.md` — every § reference below points there.

## Global Constraints

- Every JS block added to `templates.md` must parse standalone (`new vm.Script`), contain no literal `</script`, use no `getElementById('<static id>')` for ids the reference markup does not declare, and never call `localStorage.setItem` directly (`templates-reference.test.js`). Engine code is an IIFE; nothing top-level except the IIFE.
- User-facing strings in the engine come from a `MAP_LOCALE = { key: '{{map.key}}' }` table (the `ATTACH_LOCALE` pattern); every key gets a `| \`map.<key>\` | en | de |` row in `templates.md` § UI Locale. Runtime placeholders are `{n}`, `{label}`, `{from}`, `{to}`, `{error}`.
- Ids in a spec match `^[a-z0-9_]+$`; mapping ids are unique page-wide; target key `{src}.{part}`; matrix key `{src}` or `{src}@{ctx}`; cell encoding `item>target` space-separated, empty matrix = `-` (§ 1, § 4).
- Checkboxes are unnamed (`data-map-cell` only); state inputs are `input[type="text"].map-state` with ids `map-{m}-cells-{matrixKey}`, `map-{m}-order-{target}[@ctx]`, `map-{m}-adhoc`, `map-{m}-ui`; toggles and tabs are `<button aria-pressed>`, never radios (§ 5).
- `setCell()` is the only write path; it stamps `data-touched`, sets `_userInteracted = true` when defined, and dispatches bubbling `input` + `change` on the rewritten state inputs (§ 4).
- The renderer measures nothing; `data-dense` comes from the column count (§ 5).
- Templates.md prose: English, the existing "Rules:" bullet style; SKILL.md edits keep the existing section numbering.
- `npm test` and `npm run lint` green before every commit; commit messages per `plugins/devops/deep-knowledge/commit-conventions.md` (`feat(concept): …`, `docs(concept): …`, `test(concept): …`) ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Reading `templates.md` (530 KB) via Bash `cat`/`grep`/`sed` is blocked by the token guard on the first try — use the Read tool with `offset`/`limit`, and the Grep tool for searches. Edit with the Edit tool (exact anchors given per task).

---

## File structure

| Path | Responsibility |
|---|---|
| `plugins/devops/skills/concept/deep-knowledge/templates.md` § Shared Systems → new `## Information Mapping (engine)` (before `## collectDecisions (dispatcher)`) | engine JS block (`javascript`) + CSS block (`css`) + prose |
| `templates.md` § Views (optional) → new `### View kind \`mapping\`` (after `### View kind \`comparison\``, before `## Layout — Fullscreen…`) | the subpage markup contract |
| `templates.md` § Template: free → new `## Mapping block (optional)` (before `## Optional bi-state auto-detection`) | the free-round block contract |
| `templates.md` § Decision schema (design) / § Template: free → Decision schema | `mappings[]` + `design` |
| `templates.md` § UI Locale | `map.*` rows |
| `templates.md` § State Persistence (`DOMContentLoaded` handler + `restoreState`) | `renderMappings()` first, `refreshMappings()` last |
| `templates.md` § collectDecisions (design branch / free branch / dispatcher) | `mappings: collectMappings(active)`, `design` tagging, active-scope fix |
| `templates.md` § Layout JS `buildDesignUI()` | `data-view-for` grouping |
| `templates.md` § Section Navigation `buildSectionNav()` / `updateSectionNavState()` | progress mirror for `[data-mapping]` sections |
| `plugins/devops/skills/concept/mapping-engine.test.js` | jsdom behaviour of the engine block |
| `plugins/devops/skills/concept/mapping-integration.test.js` | hooks into persistence / collectors / nav; doc contracts |
| `plugins/devops/skills/concept/SKILL.md` | Step 1a sentence + views list, new Step 1c, Step 5b/5c additions, gate mention |
| `plugins/devops/skills/concept/deep-knowledge/validation-gate.md` | P23 widened, new M1–M10 set |
| `plugins/devops/skills/concept/deep-knowledge/iteration-rules.md` | frozen mapping rules |
| `plugins/devops/hooks/lib/concept-gate.js` (+ `.test.js`), `plugins/devops/hooks/post-tool-use/post.concept.gate.js` | deterministic M1–M4, M9 |
| `plugins/devops/scripts/build-concept-fixture.js` (+ new `build-concept-fixture.test.js`) | `--mapping` flag for real-browser checks |

Execution order: Task 1 → 2 → 3 → 4 → 5, then 6 ∥ 7 (disjoint files), then 8 → 9. All tasks run in this worktree on branch `claude/devops-information-mapping-template-010d0f`; each task commits only the files it owns.

---

### Task 1: Engine core — spec model, state encoding, matrix view, `setCell`, `collectMappings`

**Agent:** devops:core

**Files:**
- Modify: `plugins/devops/skills/concept/deep-knowledge/templates.md` — insert a new `## Information Mapping (engine)` section immediately before the line `## collectDecisions (dispatcher)` (currently line ≈ 8243), containing one intro paragraph, one `css` block placeholder comment (`/* mapping engine CSS — Task 2 */` inside a real ```css fence with the `.map-state` rule below) and one ```javascript block with the engine IIFE.
- Create: `plugins/devops/skills/concept/mapping-engine.test.js`

**Interfaces (produces):**
- `window.renderMappings(root = document)` — renders every `section[data-mapping]` under `root` not yet carrying `data-map-rendered`; idempotent.
- `window.refreshMappings(root = document)` — re-reads every state input, re-sets checkboxes, re-projects, updates counts; safe to call any time.
- `window.setCell(section, itemId, targetKey, ctx, on)` — `section` is the `[data-mapping]` element or its id string; `ctx` is `null` for context-less mappings; returns `true` when something changed.
- `window.collectMappings(scope)` — array of § 9 entries for every rendered mapping inside `scope`.
- `window.mappingProgress(section)` → `{ assigned, total, violations }` (items assigned anywhere / items / violation count).
- Internal model per section (WeakMap): `{ id, spec, items[], groups[], sources[] (elements + axes), contexts[] (or [null]), matrices[] }`, where `matrices[i] = { key, src, ctx, targets: [{ key, label, tier, row, accepts, min, max, ordered }] }`.

- [ ] **Step 1: Write the failing tests** — `mapping-engine.test.js` with the harness below and the tests for this task (schematic tests come in Task 2):

```js
import { describe, test, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const md = fs.readFileSync(path.join(__dirname, "deep-knowledge", "templates.md"), "utf8");

function scanBlocks(src) {            // same line scanner as panel-anatomy.test.js
  const lines = src.split("\n"); const out = []; let open = null, body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) { if (open === null) { open = { info: m[1].trim(), start: i + 2 }; body = []; }
             else { out.push({ info: open.info, line: open.start, code: body.join("\n") }); open = null; } continue; }
    if (open) body.push(lines[i]);
  }
  return out;
}
const ENGINE = scanBlocks(md).find(b => /^(javascript|js)$/.test(b.info) && b.code.includes("Information mapping engine"));
const localeKeys = s => s.replace(/\{\{([a-z_.]+)\}\}/g, "$1");

export const VEHICLE_SPEC = {
  items: [
    { id: "plate", label: "Licence plate", group: "Identity", required: true },
    { id: "model", label: "Model", group: "Identity" },
    { id: "vin", label: "VIN", group: "Identity" },
    { id: "status", label: "Status", group: "Status" },
    { id: "mileage", label: "Mileage", group: "Telemetry" },
    { id: "holder", label: "Holder", group: "Ownership" }
  ],
  elements: [{ id: "card", label: "List card", itemTargets: "any", parts: [
    { id: "header", label: "header", tier: "first", row: 1, min: 1 },
    { id: "badge", label: "badge", tier: "first", row: 1, accepts: "one", min: 1 },
    { id: "line1", label: "line 1", tier: "first", row: 2, min: 1, ordered: true },
    { id: "line2", label: "line 2", tier: "first", row: 3, ordered: true },
    { id: "footer", label: "footer", tier: "first", row: 4 },
    { id: "overview", label: "Tab: Overview", tier: "after", row: 1 },
    { id: "history", label: "Tab: History", tier: "after", row: 2 }
  ]}],
  context: { id: "device", label: "Context", values: [{ id: "phone", label: "Phone" }, { id: "desktop", label: "Desktop" }] },
  proposal: [["plate","card.header","phone"],["model","card.header","phone"],["status","card.badge","phone"],
             ["mileage","card.line1","phone"],["vin","card.overview","phone"],["plate","card.header","desktop"]],
  proposalOrder: { "card.line1@phone": ["mileage"] },
  slotNotes: true, adhocItems: true
};
export const TRAINS_SPEC = {
  items: [{ id: "req01", label: "REQ-01", group: "Requirements" }, { id: "rsk01", label: "RSK-01", group: "Risks" }],
  axes: [
    { id: "train", label: "Release train", itemTargets: "one", columns: [{ id: "r1", label: "R1" }, { id: "r2", label: "R2" }] },
    { id: "owner", label: "Owner", itemTargets: "min1", columns: [{ id: "web", label: "Web" }, { id: "ops", label: "Ops" }] }
  ],
  proposal: [["req01","train.r1"],["req01","owner.web"],["rsk01","train.r2"]]
};

export function page({ specs, active = true, frozen = false } = {}) {
  const sections = specs.map(([id, spec]) =>
    `<section data-mapping="${id}" id="${id}" data-nav-label="${id}"><script type="application/json" data-mapping-spec>${JSON.stringify(spec)}</script>
     <textarea data-comment="map-${id}-note"></textarea></section>`).join("");
  const html = `<!doctype html><html><body><main><section data-iteration="3" data-iteration-template="free"${active && !frozen ? " data-active" : " hidden"}>${sections}</section></main></body></html>`;
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const { window } = dom;
  window.eval("var _userInteracted = false;");
  window.eval(localeKeys(ENGINE.code));
  return { window, document: window.document, section: id => window.document.getElementById(id) };
}
const cells = (doc, id, key) => doc.getElementById(`map-${id}-cells-${key}`).value.split(" ").filter(Boolean).sort();
const box = (doc, item, target, ctx) => [...doc.querySelectorAll(`input[data-map-cell="${item}>${target}"]`)]
  .find(i => (i.closest("[data-map-matrix]").dataset.mapMatrix.split("@")[1] || null) === ctx);

describe("mapping engine — model + state", () => {
  test("engine block exists and renders one matrix per source × context", () => {
    expect(ENGINE).toBeTruthy();
    const p = page({ specs: [["veh", VEHICLE_SPEC], ["rel", TRAINS_SPEC]] });
    p.window.renderMappings();
    expect(p.document.querySelectorAll('[data-mapping="veh"] [data-map-matrix]').length).toBe(2);   // card@phone, card@desktop
    expect(p.document.querySelectorAll('[data-mapping="rel"] [data-map-matrix]').length).toBe(2);   // train, owner
    expect(p.section("veh").dataset.mapRendered).toBe("true");
    p.window.renderMappings();                                                                       // idempotent
    expect(p.document.querySelectorAll('[data-mapping="veh"] [data-map-matrix]').length).toBe(2);
  });
  test("cells are unnamed checkboxes with data-proposed; state inputs carry the proposal", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const cb = box(p.document, "plate", "card.header", "phone");
    expect(cb.checked).toBe(true); expect(cb.name).toBe(""); expect(cb.id).toBe(""); expect(cb.dataset.proposed).toBe("1");
    expect(box(p.document, "vin", "card.header", "phone").dataset.proposed).toBe("0");
    expect(cells(p.document, "veh", "card@phone")).toEqual(["mileage>card.line1","model>card.header","plate>card.header","status>card.badge","vin>card.overview"]);
    expect(p.document.getElementById("map-veh-order-card.line1@phone").value).toBe("mileage");
    expect(p.document.getElementById("map-veh-cells-card@desktop").value).toBe("plate>card.header");
    for (const el of p.document.querySelectorAll(".map-state")) expect(el.type).toBe("text");
  });
  test("an empty matrix persists as the sentinel '-'", () => {
    const p = page({ specs: [["rel", { ...TRAINS_SPEC, proposal: [] }]] }); p.window.renderMappings();
    expect(p.document.getElementById("map-rel-cells-train").value).toBe("-");
  });
  test("setCell: accepts:one swaps, itemTargets:one swaps along the row, min/max flag but never block", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC], ["rel", TRAINS_SPEC]] }); p.window.renderMappings();
    expect(p.window.setCell("veh", "model", "card.badge", "phone", true)).toBe(true);
    expect(box(p.document, "status", "card.badge", "phone").checked).toBe(false);          // swapped out
    expect(box(p.document, "model", "card.badge", "phone").checked).toBe(true);
    p.window.setCell("rel", "req01", "train.r2", null, true);
    expect(box(p.document, "req01", "train.r1", null).checked).toBe(false);                 // row swap
    p.window.setCell("veh", "plate", "card.header", "phone", false);                        // header min 1 → still allowed
    p.window.setCell("veh", "model", "card.header", "phone", false);
    expect(box(p.document, "plate", "card.header", "phone").checked).toBe(false);
    const prog = p.window.mappingProgress(p.section("veh"));
    expect(prog.violations).toBeGreaterThan(0);                                             // header empty (min 1)
  });
  test("setCell rewrites the state input, stamps data-touched, bubbles input+change and marks the user as interacted", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const seen = []; p.document.addEventListener("change", e => seen.push(e.target.id)); p.document.addEventListener("input", e => seen.push("i:" + e.target.id));
    p.window.setCell("veh", "vin", "card.footer", "phone", true);
    const st = p.document.getElementById("map-veh-cells-card@phone");
    expect(st.value.split(" ")).toContain("vin>card.footer");
    expect(st.dataset.touched).toBe("true");
    expect(seen).toContain("map-veh-cells-card@phone"); expect(seen).toContain("i:map-veh-cells-card@phone");
    expect(p.window.eval("_userInteracted")).toBe(true);
    expect(p.window.setCell("veh", "vin", "card.footer", "phone", true)).toBe(false);       // no-op returns false
  });
  test("refreshMappings re-projects a restored state string and drops unknown ids", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const st = p.document.getElementById("map-veh-cells-card@phone");
    st.value = "vin>card.header ghost>card.header vin>card.nowhere";                         // what restoreState() does: value only, no event
    p.window.refreshMappings();
    expect(box(p.document, "vin", "card.header", "phone").checked).toBe(true);
    expect(box(p.document, "plate", "card.header", "phone").checked).toBe(false);
    expect(st.value).toBe("vin>card.header");                                                // normalised back
  });
  test("collectMappings emits the § 9 shape", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    p.window.setCell("veh", "holder", "card.overview", "phone", true);
    p.window.setCell("veh", "status", "card.badge", "phone", false);
    p.document.querySelector('[data-comment="map-veh-note"]').value = "looks right";
    const [m] = p.window.collectMappings(p.document.querySelector("section[data-iteration]"));
    expect(m.id).toBe("veh"); expect(m.mode).toBe("schema"); expect(m.view).toBeUndefined();
    expect(m.assigned["card@phone"]).toContainEqual(["holder", "card.overview"]);
    expect(m.order["card.line1@phone"]).toEqual(["mileage"]);
    expect(m.diff).toContainEqual({ item: "holder", target: "card.overview", ctx: "phone", proposed: false, now: true });
    expect(m.diff).toContainEqual({ item: "status", target: "card.badge", ctx: "phone", proposed: true, now: false });
    expect(m.unassigned).toEqual([]);                                                        // every item is somewhere across contexts
    expect(m.violations).toContainEqual({ target: "card.badge", ctx: "phone", kind: "min", have: 0, want: 1 });
    expect(m.adhocItems).toEqual([]); expect(m.note).toBe("looks right"); expect(m.slotNotes).toEqual({});
  });
  test("a broken spec renders .map-error and no matrix; collectMappings skips it", () => {
    const p = page({ specs: [["bad", "{not json"]] });
    p.document.querySelector("[data-mapping-spec]").textContent = "{not json";
    p.window.renderMappings();
    expect(p.document.querySelector('[data-mapping="bad"] .map-error')).toBeTruthy();
    expect(p.document.querySelectorAll('[data-mapping="bad"] [data-map-matrix]').length).toBe(0);
    expect(p.window.collectMappings(p.document)).toEqual([]);
  });
  test("matrix DOM contract: grouped rows, two-level header with tier band, counts, Σ column, role=grid", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const table = p.document.querySelector('[data-map-matrix="card@phone"] table.map-table');
    expect(table.getAttribute("role")).toBe("grid");
    expect(table.querySelectorAll("thead tr").length).toBe(3);                               // source, tier, targets
    expect(table.querySelectorAll('thead th[data-tier="first"]').length).toBe(1);
    expect(table.querySelectorAll("tbody tr.map-group-row").length).toBe(4);
    expect(table.querySelectorAll("tbody tr.map-item-row").length).toBe(6);
    expect(table.querySelector('th[data-map-target="card.badge"] .map-col-count').textContent).toBe("1/1");
    expect(table.querySelector('tr.map-item-row[data-item="plate"] .map-sum').textContent).toBe("1");
    expect(table.dataset.dense).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run plugins/devops/skills/concept/mapping-engine.test.js` → FAIL (`ENGINE` undefined → `Cannot read properties of undefined`).

- [ ] **Step 3: Implement the engine block** in `templates.md` (new section before `## collectDecisions (dispatcher)`). Section skeleton:

````markdown
## Information Mapping (engine)

Shared, template-independent engine for `section[data-mapping]` (§ View kind `mapping`,
§ Mapping block (optional)). Copied verbatim into every page like the annotation layer;
`renderMappings()` early-returns on pages without a mapping. The matrix's checkboxes are
the DOM truth; one CSS-hidden text input per matrix is the persisted form (§ State
Persistence picks it up as `text:i{N}:map-…`). See the design spec
`docs/superpowers/specs/2026-09-13-concept-information-mapping-design.md`.

### CSS

```css
/* mapping engine CSS — Task 2 fills this block */
.map-state { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
```

### JS

```javascript
// --- Information mapping engine (§ Information Mapping) --------------------
(function () {
  const MAP_LOCALE = {
    view_schema: '{{map.view_schema}}', view_matrix: '{{map.view_matrix}}',
    tier_first: '{{map.tier_first}}', tier_after: '{{map.tier_after}}',
    items: '{{map.items}}', search: '{{map.search}}',
    filter_all: '{{map.filter_all}}', filter_unassigned: '{{map.filter_unassigned}}',
    filter_multiple: '{{map.filter_multiple}}', filter_changed: '{{map.filter_changed}}',
    reset: '{{map.reset}}', reset_confirm: '{{map.reset_confirm}}',
    copy: '{{map.copy}}', copy_confirm: '{{map.copy_confirm}}',
    add_item: '{{map.add_item}}', add_item_prompt: '{{map.add_item_prompt}}',
    add_item_duplicate: '{{map.add_item_duplicate}}', added_group: '{{map.added_group}}',
    armed_item: '{{map.armed_item}}', armed_slot: '{{map.armed_slot}}',
    summary_unassigned: '{{map.summary_unassigned}}', summary_violations: '{{map.summary_violations}}',
    summary_ok: '{{map.summary_ok}}', slot_empty_min: '{{map.slot_empty_min}}',
    slot_over_max: '{{map.slot_over_max}}', item_required: '{{map.item_required}}',
    remove: '{{map.remove}}', slot_note: '{{map.slot_note}}', context: '{{map.context}}',
    axis: '{{map.axis}}', tab_open: '{{map.tab_open}}',
    frozen_missing: '{{map.frozen_missing}}', spec_error: '{{map.spec_error}}'
  };
  const fmt = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars) ? vars[k] : '{' + k + '}');
  const ID_RE = /^[a-z0-9_]+$/;
  const MODELS = new WeakMap();      // section → model
  …
  window.renderMappings = renderMappings;
  window.refreshMappings = refreshMappings;
  window.setCell = setCell;
  window.collectMappings = collectMappings;
  window.mappingProgress = mappingProgress;
})();
```
````

Core algorithms the block must contain (write them exactly like this; the DOM builders around them follow the contract in Step 4):

```javascript
  function normalizeSpec(raw) {
    const err = msg => { throw new Error(msg); };
    const items = (raw.items || []).map(it => ({ id: it.id, label: it.label || it.id, group: it.group || '', hint: it.hint || '', required: !!it.required, adhoc: false }));
    const sources = [];
    (raw.elements || []).forEach(el => sources.push({ kind: 'element', id: el.id, label: el.label || el.id, itemTargets: el.itemTargets || 'any',
      targets: (el.parts || []).map(p => ({ key: el.id + '.' + p.id, id: p.id, label: p.label || p.id, tier: p.tier === 'after' ? 'after' : 'first',
        row: Number.isFinite(p.row) ? p.row : null, accepts: p.accepts === 'one' ? 'one' : 'many', min: p.min || 0, max: p.max || 0, ordered: !!p.ordered })) }));
    (raw.axes || []).forEach(ax => sources.push({ kind: 'axis', id: ax.id, label: ax.label || ax.id, itemTargets: ax.itemTargets || 'any',
      targets: (ax.columns || []).map(c => ({ key: ax.id + '.' + c.id, id: c.id, label: c.label || c.id, tier: 'first', row: null,
        accepts: c.accepts === 'one' ? 'one' : 'many', min: c.min || 0, max: c.max || 0, ordered: false })) }));
    if (!sources.length) err('no elements/axes');
    sources.forEach(s => { if (!s.targets.length) err('source without targets: ' + s.id); });
    const contexts = raw.context && Array.isArray(raw.context.values) && raw.context.values.length
      ? raw.context.values.map(v => ({ id: v.id, label: v.label || v.id })) : null;
    const all = [...items.map(i => i.id), ...sources.map(s => s.id), ...sources.flatMap(s => s.targets.map(t => t.id)), ...(contexts || []).map(c => c.id)];
    all.forEach(id => { if (!ID_RE.test(String(id))) err('bad id: ' + id); });
    const seen = new Set(); items.forEach(i => { if (seen.has(i.id)) err('duplicate item id: ' + i.id); seen.add(i.id); });
    const matrices = [];
    sources.forEach(s => (contexts || [null]).forEach(c => matrices.push({ key: s.id + (c ? '@' + c.id : ''), src: s, ctx: c ? c.id : null, targets: s.targets })));
    const targetKeys = new Set(sources.flatMap(s => s.targets.map(t => t.key)));
    const itemIds = new Set(items.map(i => i.id));
    (raw.proposal || []).forEach(p => { if (!itemIds.has(p[0]) || !targetKeys.has(p[1])) err('proposal references unknown id: ' + p.join(',')); });
    const groups = [...new Set(items.map(i => i.group))];
    return { items, groups, sources, contexts, matrices, targetKeys, proposal: raw.proposal || [], proposalOrder: raw.proposalOrder || {},
             submitted: raw.submitted || null, slotNotes: !!raw.slotNotes, adhocItems: !!raw.adhocItems, hasElements: sources.some(s => s.kind === 'element') };
  }
  const encodeCells = pairs => pairs.length ? pairs.map(p => p[0] + '>' + p[1]).join(' ') : '-';
  const decodeCells = str => String(str || '').trim() === '-' ? [] : String(str || '').split(/\s+/).filter(Boolean).map(t => t.split('>')).filter(p => p.length === 2);
  function matrixOf(model, targetKey, ctx) { return model.matrices.find(m => m.ctx === (ctx || null) && m.targets.some(t => t.key === targetKey)); }
  function setCell(sectionOrId, itemId, targetKey, ctx, on) {
    const section = typeof sectionOrId === 'string' ? document.querySelector('[data-mapping="' + sectionOrId + '"]') : sectionOrId;
    const model = section && MODELS.get(section); if (!model) return false;
    if (section.dataset.mapFrozen === 'true') return false;
    const matrix = matrixOf(model, targetKey, ctx); if (!matrix) return false;
    const target = matrix.targets.find(t => t.key === targetKey);
    const state = stateInput(section, model.id, 'cells', matrix.key);
    let pairs = decodeCells(state.value);
    const has = pairs.some(p => p[0] === itemId && p[1] === targetKey);
    if (on === has) return false;
    if (on) {
      if (target.accepts === 'one') pairs = pairs.filter(p => p[1] !== targetKey);                       // slot swap
      if (matrix.src.itemTargets === 'one') pairs = pairs.filter(p => p[0] !== itemId);                  // row swap
      pairs.push([itemId, targetKey]);
    } else pairs = pairs.filter(p => !(p[0] === itemId && p[1] === targetKey));
    writeState(state, encodeCells(pairs));
    if (target.ordered) syncOrder(section, model, matrix, target, pairs);
    projectMatrix(section, model, matrix);                                                              // checkboxes + counts + markers
    if (typeof refreshSchema === 'function') refreshSchema(section, model);                             // Task 2
    updateSummary(section, model);
    if (typeof updateSectionNavState === 'function') updateSectionNavState();
    return true;
  }
  function writeState(input, value) {
    input.value = value;
    input.dataset.touched = 'true';
    if (typeof _userInteracted !== 'undefined') _userInteracted = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
```

`stateInput(section, m, kind, suffix)` returns (creating on first use inside `div.map-state`) the `input[type="text"].map-state` with id `map-{m}-{kind}-{suffix}` (`kind` ∈ `cells` | `order` | `adhoc` | `ui`; `adhoc`/`ui` have no suffix). `syncOrder` keeps `map-{m}-order-{targetKey}[@ctx]` = ids of the checked items of that target in existing order, appending newcomers. `refreshMappings` = for each rendered section: decode every cells input, drop pairs with unknown item/target, re-encode (normalise), set every checkbox, recompute counts/markers/summary, then `refreshSchema` (Task 2). `collectMappings(scope)` builds the § 9 entry (`assigned` keyed by matrix key, `order` from order inputs filtered to checked items, `diff` from `checked !== data-proposed`, `unassigned` = items with zero cells across all matrices, `violations` = per matrix: target `min`/`max`/`accepts:one` (`kind: "min" | "max" | "one"`, `have`, `want`), per item `required`/`min1` (`kind: "required" | "min1"`), `adhocItems`, `note` from `[data-comment="map-{m}-note"]` in the section OR, when the section sits inside `section[data-view]`, from the dock's `[data-comment="view-{viewId}"]`, `slotNotes` from `[data-comment^="map-{m}-note-"]`, `mode` from the ui input (`schema` default when `hasElements`, else `matrix`), `view` = closest `section[data-view]`'s `data-view`, `design` = that view's `data-view-for`). Entries are omitted for sections carrying `.map-error`.

- [ ] **Step 4: Matrix DOM builder** — `renderMatrix(section, model, matrix)` produces exactly:

```html
<div class="map-matrix" data-map-matrix="card@phone" hidden>          <!-- hidden unless active tab -->
  <div class="map-scroll">
    <table class="map-table" role="grid" aria-label="List card · Phone">
      <thead>
        <tr class="map-head-src"><th class="map-corner" rowspan="3"></th><th colspan="7" class="map-src">List card</th><th class="map-sum-head" rowspan="3">Σ</th></tr>
        <tr class="map-head-tier"><th colspan="5" data-tier="first">{{map.tier_first}}</th><th colspan="2" data-tier="after">{{map.tier_after}}</th></tr>   <!-- only when both tiers occur -->
        <tr class="map-head-targets"><th data-map-target="card.header" data-tier="first"><span class="map-col-label">header</span> <span class="map-col-count">2</span></th>…</tr>
      </thead>
      <tbody>
        <tr class="map-group-row" data-group="Identity"><td colspan="9"><button type="button" class="map-group-toggle" aria-expanded="true">▾ Identity <span class="map-group-count">3</span></button></td></tr>
        <tr class="map-item-row" data-item="plate" data-group="Identity">
          <th scope="row" class="map-item-label"><span>Licence plate</span></th>
          <td class="map-cell-td"><label><input type="checkbox" data-map-cell="plate>card.header" data-proposed="1" checked><span class="map-cell"></span></label></td>
          …
          <td class="map-sum">1</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

Cell `change` (a real click) calls `setCell(section, item, target, ctx, input.checked)` — because the click already flipped the box, `setCell` must read `has` from the state string, not from the checkbox. Keyboard: `role="grid"`, roving `tabindex` on the checkboxes, arrow keys move, Space toggles via `setCell`, Home/End. Counts: `th .map-col-count` = `n` or `n/1` (accepts one), classes `is-under` (min not met) / `is-over` (max exceeded); `td.map-sum` = row count on this matrix with `is-under` when the item is `required`/`min1` and unassigned across the whole mapping. `data-dense="true"` on the table when `matrix.targets.length > 18`.

- [ ] **Step 5: Run tests** — `npx vitest run plugins/devops/skills/concept/mapping-engine.test.js plugins/devops/skills/concept/templates-reference.test.js` → PASS.

- [ ] **Step 6: Commit** — `git add plugins/devops/skills/concept/deep-knowledge/templates.md plugins/devops/skills/concept/mapping-engine.test.js && git commit -m "feat(concept): mapping engine core — spec model, matrix view, setCell, collectMappings"` (+ Co-Authored-By trailer).

---

### Task 2: Schematic view + engine CSS

**Agent:** devops:frontend

**Files:**
- Modify: `templates.md` § Information Mapping (engine) — the `css` block and the JS block (add `renderSchema`, `refreshSchema`, palette, arm-then-tap).
- Modify: `plugins/devops/skills/concept/mapping-engine.test.js` — add the `describe("mapping engine — schematic view")` block.

**Interfaces (consumes):** `setCell`, `MODELS`, `stateInput`, `decodeCells` from Task 1. **Produces:** `refreshSchema(section, model)` (internal), view toggle buttons `.map-view-btn[data-map-mode]`, ui state `mode=…;tab=…` in `map-{m}-ui`.

- [ ] **Step 1: Write the failing tests**

```js
describe("mapping engine — schematic view", () => {
  test("renders both tier columns side by side with row-grouped slots and chips in order", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const schema = p.document.querySelector('[data-mapping="veh"] .map-schema[data-map-ctx="phone"]');
    expect(schema.hidden).toBe(false);
    expect(schema.querySelectorAll('.map-tier[data-tier="first"] .map-slot').length).toBe(5);
    expect(schema.querySelectorAll('.map-tier[data-tier="after"] .map-slot').length).toBe(2);
    const row1 = schema.querySelector('.map-tier[data-tier="first"] .map-row[data-row="1"]');
    expect([...row1.querySelectorAll(".map-slot")].map(s => s.dataset.mapTarget)).toEqual(["card.header", "card.badge"]);
    expect([...schema.querySelectorAll('.map-slot[data-map-target="card.header"] .map-chip')].map(c => c.dataset.item)).toEqual(["plate", "model"]);
    expect(p.document.querySelector('[data-mapping="rel"]')).toBeNull();
  });
  test("no elements → no schematic, no toggle; elements → toggle defaults to schema and persists in the ui input", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC], ["rel", TRAINS_SPEC]] }); p.window.renderMappings();
    expect(p.document.querySelector('[data-mapping="rel"] .map-schema')).toBeNull();
    expect(p.document.querySelector('[data-mapping="rel"] .map-view-toggle')).toBeNull();
    expect(p.document.querySelector('[data-mapping="rel"] [data-map-matrix="train"]').hidden).toBe(false);
    const btnMatrix = p.document.querySelector('[data-mapping="veh"] .map-view-btn[data-map-mode="matrix"]');
    expect(btnMatrix.tagName).toBe("BUTTON"); expect(btnMatrix.getAttribute("aria-pressed")).toBe("false");
    btnMatrix.click();
    expect(p.document.getElementById("map-veh-ui").value).toMatch(/mode=matrix/);
    expect(p.document.querySelector('[data-mapping="veh"] [data-map-matrix="card@phone"]').hidden).toBe(false);
    expect(p.document.querySelector('[data-mapping="veh"] .map-schema[data-map-ctx="phone"]').hidden).toBe(true);
  });
  test("arm-then-tap: item stays armed across slots; slot-first toggles items; × removes; Esc disarms", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const chip = p.document.querySelector('.map-item-chip[data-item="holder"]');
    chip.click(); expect(chip.getAttribute("aria-pressed")).toBe("true");
    p.document.querySelector('.map-slot[data-map-target="card.footer"] .map-slot-label').click();
    p.document.querySelector('.map-slot[data-map-target="card.line2"] .map-slot-label').click();
    expect(box(p.document, "holder", "card.footer", "phone").checked).toBe(true);
    expect(box(p.document, "holder", "card.line2", "phone").checked).toBe(true);
    expect(chip.getAttribute("aria-pressed")).toBe("true");                                 // still armed
    p.document.querySelector('[data-mapping="veh"]').dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    p.document.querySelector('.map-slot[data-map-target="card.footer"] .map-slot-label').click();   // nothing armed → arms the slot
    p.document.querySelector('.map-item-chip[data-item="vin"]').click();                              // toggles vin into footer
    expect(box(p.document, "vin", "card.footer", "phone").checked).toBe(true);
    p.document.querySelector('.map-slot[data-map-target="card.footer"] .map-chip[data-item="vin"] .map-chip-remove').click();
    expect(box(p.document, "vin", "card.footer", "phone").checked).toBe(false);
  });
  test("palette: count badges, unassigned/multiple/changed filters, group collapse", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const badge = item => p.document.querySelector(`.map-item-chip[data-item="${item}"] .map-item-count`).textContent;
    expect(badge("plate")).toBe("2×"); expect(badge("holder")).toBe("○");
    p.window.setCell("veh", "holder", "card.overview", "phone", true);
    expect(badge("holder")).toBe("1×");
    p.document.querySelector('.map-filter[data-filter="changed"]').click();
    expect(p.document.querySelector('.map-item-chip[data-item="holder"]').hidden).toBe(false);
    expect(p.document.querySelector('.map-item-chip[data-item="plate"]').hidden).toBe(true);
    p.document.querySelector('.map-filter[data-filter="all"]').click();
    const toggle = p.document.querySelector('.map-palette .map-group[data-group="Identity"] .map-group-toggle');
    toggle.click(); expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(p.document.querySelector('.map-palette .map-group[data-group="Identity"] .map-group-chips').hidden).toBe(true);
  });
  test("markers: proposal dot, changed ◆, empty required slot ⚠, over-full accepts:one impossible (swap)", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    p.window.setCell("veh", "plate", "card.header", "phone", false); p.window.setCell("veh", "model", "card.header", "phone", false);
    const header = p.document.querySelector('.map-schema[data-map-ctx="phone"] .map-slot[data-map-target="card.header"]');
    expect(header.classList.contains("is-under")).toBe(true);
    expect(header.querySelectorAll(".map-chip.is-removed").length).toBe(2);                  // ghost strike-through chips
    p.window.setCell("veh", "vin", "card.header", "phone", true);
    expect(header.querySelector('.map-chip[data-item="vin"]').classList.contains("is-changed")).toBe(true);
    expect(p.document.querySelector('.map-schema[data-map-ctx="phone"] .map-slot[data-map-target="card.badge"] .map-chip').classList.contains("is-proposed")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL (`.map-schema` null).

- [ ] **Step 3: Implement** `renderSchema(section, model, ctx)` and `refreshSchema(section, model)` producing:

```html
<div class="map-schema" data-map-ctx="phone">                     <!-- one per context (or data-map-ctx="" without context); hidden unless mode=schema and tab matches -->
  <div class="map-element" data-map-element="card">
    <div class="map-element-caption">List card</div>
    <div class="map-tiers">
      <div class="map-tier" data-tier="first"><div class="map-tier-label">{{map.tier_first}}</div>
        <div class="map-row" data-row="1">
          <div class="map-slot" data-map-target="card.header" data-accepts="many">
            <button type="button" class="map-slot-label"><span>header</span> <span class="map-slot-count">2</span></button>
            <div class="map-slot-chips">
              <button type="button" class="map-chip is-proposed" data-item="plate"><span>Licence plate</span><span class="map-chip-remove" aria-label="{{map.remove}}">×</span></button>
            </div>
            <button type="button" class="map-slot-note-btn" hidden>✎</button>            <!-- Task 3 -->
          </div>
        </div>
      </div>
      <div class="map-tier" data-tier="after">…</div>                                    <!-- omitted when no part is tier after -->
    </div>
  </div>
  <div class="map-palette">
    <div class="map-palette-head"><span class="map-palette-title">{{map.items}} (6)</span><input type="search" class="map-search" placeholder="{{map.search}}">
      <div class="map-filters"><button type="button" class="map-filter" data-filter="all" aria-pressed="true">{{map.filter_all}}</button> … unassigned / multiple / changed with counts</div></div>
    <div class="map-group" data-group="Identity"><button type="button" class="map-group-toggle" aria-expanded="true">▾ Identity <span class="map-group-count">3</span></button>
      <div class="map-group-chips"><button type="button" class="map-item-chip" data-item="plate" aria-pressed="false" title="header (Phone), header (Desktop)"><span>Licence plate</span><span class="map-item-count">2×</span></button>…</div></div>
  </div>
  <div class="map-status" role="status"></div>                                           <!-- armed hint -->
</div>
```

Behaviour: one in-memory `armed` per section (`{kind:'item'|'slot', id}`). Item chip click → arm (or disarm if already armed). Slot label click → if an item is armed: `setCell(toggle)` and the item stays armed; else arm the slot (chips then toggle that slot on click). Chip × → `setCell(off)`. `keydown` listener on the section: `Escape` disarms and calls `stopPropagation()` only when something was armed; `Delete` on a focused slot chip removes it; `Alt+ArrowLeft/Right` on a slot chip of an ordered part reorders (rewrites the order input via `writeState`). Chip markers: `is-proposed` (checked and `data-proposed=1`), `is-changed` (checked and proposed 0), `is-removed` ghost chip for proposed-but-unchecked pairs (rendered from the matrix's `data-proposed` boxes). Slot classes `is-under` / `is-over` / `is-armed`. Palette counts: `○` for 0, `n×` across ALL matrices of the mapping. Filters: `unassigned` (0 cells), `multiple` (≥ 2), `changed` (any diff). Below 700 px the tiers stack (CSS).

- [ ] **Step 4: CSS block** — replace the placeholder with the full engine CSS: `.map-root`, `.map-toolbar` (flex, wrap), `.map-view-toggle` (segmented like `.eval-group`), `.map-tabs`, `.map-schema`, `.map-tiers { display:grid; grid-template-columns: 1fr 1fr; gap: 1rem }` + `@media (max-width: 700px) { .map-tiers { grid-template-columns: 1fr } }`, `.map-tier[data-tier="first"] { background: color-mix(in srgb, var(--accent-color) 10%, transparent) }`, `.map-row { display:flex; gap:.5rem }`, `.map-slot { flex:1; border:1px dashed var(--border-color); border-radius:6px; padding:.4rem }`, `.map-slot.is-armed { border-style: solid; border-color: var(--accent-color) }`, `.map-slot.is-under { border-color: var(--warning-color) }`, `.map-slot.is-over { border-color: var(--danger-color, #f85149) }`, `.map-chip`, `.map-chip.is-changed { text-decoration: underline var(--accent-color) }`, `.map-chip.is-removed { opacity:.5; text-decoration: line-through }`, `.map-palette { position: sticky; bottom: 0; background: var(--panel-bg); border-top:1px solid var(--border-color) }`, `.map-item-chip[aria-pressed="true"] { outline: 2px solid var(--accent-color) }`, `.map-scroll { overflow:auto; max-width:100%; max-height: calc(100vh - var(--map-chrome, 220px)); scroll-padding: 2.5rem 0 0 230px }`, `html:not([data-template="design"]) .map-scroll { max-height: 80vh }`, `.map-table { border-collapse: separate; border-spacing:0; width: max-content }`, `.map-table thead th { position: sticky; top:0; z-index:2; background: var(--panel-bg) }`, `.map-table tr.map-head-tier th { top: 2rem }`, `.map-table tr.map-head-targets th { top: 4rem }`, `.map-table th.map-item-label, .map-table th.map-corner { position: sticky; left:0; z-index:3; background: var(--panel-bg); min-width: 220px; text-align:left }`, `.map-cell-td label { display:block; width:28px; height:28px; margin:auto }`, `.map-cell-td input { position:absolute; opacity:0 }`, `.map-cell { display:block; width:18px; height:18px; margin:5px; border:1px solid var(--border-color); border-radius:4px }`, `.map-cell-td input:checked + .map-cell { background: var(--accent-color) }`, `.map-cell-td[data-accepts="one"] .map-cell { border-radius: 50% }`, `.map-table[data-dense="true"] tr.map-head-targets th { writing-mode: vertical-rl }`, `.map-col-count.is-under, .map-sum.is-under { color: var(--warning-color) }`, `.map-col-count.is-over { color: var(--danger-color, #f85149) }`, `.map-error { border:1px solid var(--danger-color,#f85149); color: var(--danger-color,#f85149); padding:.75rem; border-radius:6px }`, `.view-mapping { max-width: none; padding: 1rem 1.5rem }`, `.concept-content:has([data-map-wide]) { max-width: 1600px }`. No `100vw`, no `position: fixed`.

- [ ] **Step 5: Run tests** — engine test file + `templates-reference.test.js` + `panel-chrome.test.js` + `design-chrome-overlap.test.js` → PASS.

- [ ] **Step 6: Commit** — `feat(concept): mapping schematic view — tiers side by side, arm-then-tap, palette`.

---

### Task 3: Tabs, context copy, reset, ad-hoc items, slot notes, frozen mode

**Agent:** devops:core

**Files:** `templates.md` § Information Mapping (engine) JS (+ CSS for `.map-tab`, `.map-tools`, `.map-slot-notes`); `mapping-engine.test.js` — add `describe("mapping engine — tabs, tools, frozen")`.

- [ ] **Step 1: Write the failing tests**

```js
describe("mapping engine — tabs, tools, frozen", () => {
  test("multiple matrices → tab buttons with open counts; tab switch drives both views and the ui input", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const tabs = [...p.document.querySelectorAll('[data-mapping="veh"] .map-tab')];
    expect(tabs.map(t => t.dataset.mapTab)).toEqual(["card@phone", "card@desktop"]);
    expect(tabs[0].getAttribute("aria-pressed")).toBe("true");
    expect(tabs[1].querySelector(".map-tab-count").textContent).toMatch(/\d/);             // desktop has open constraints
    tabs[1].click();
    expect(p.document.getElementById("map-veh-ui").value).toMatch(/tab=card@desktop/);
    expect(p.document.querySelector('.map-schema[data-map-ctx="desktop"]').hidden).toBe(false);
    expect(p.document.querySelector('.map-schema[data-map-ctx="phone"]').hidden).toBe(true);
  });
  test("copy context clears the target first, then copies (deterministic accepts:one)", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    p.window.confirm = () => true;
    p.window.setCell("veh", "holder", "card.badge", "desktop", true);
    p.document.querySelector('[data-mapping="veh"] .map-copy[data-from="phone"][data-to="desktop"]').click();
    expect(cells(p.document, "veh", "card@desktop")).toEqual(cells(p.document, "veh", "card@phone"));
    expect(box(p.document, "holder", "card.badge", "desktop").checked).toBe(false);
  });
  test("reset restores the active matrix to the proposal after confirm; declined confirm is a no-op", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    p.window.setCell("veh", "vin", "card.header", "phone", true);
    p.window.confirm = () => false; p.document.querySelector('[data-mapping="veh"] .map-reset').click();
    expect(box(p.document, "vin", "card.header", "phone").checked).toBe(true);
    p.window.confirm = () => true; p.document.querySelector('[data-mapping="veh"] .map-reset').click();
    expect(box(p.document, "vin", "card.header", "phone").checked).toBe(false);
    expect(p.window.collectMappings(p.document)[0].diff).toEqual([]);
  });
  test("ad-hoc items: added into 'Added by you', get cells in every matrix, persist via map-{m}-adhoc, duplicates refused, cap 20", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    p.window.prompt = () => "Next inspection";
    p.document.querySelector('[data-mapping="veh"] .map-add-item').click();
    expect(JSON.parse(p.document.getElementById("map-veh-adhoc").value)).toEqual(["Next inspection"]);
    expect(p.document.querySelectorAll('input[data-map-cell^="u1>"]').length).toBe(14);      // 7 targets × 2 contexts
    expect(p.document.querySelector('.map-palette .map-group[data-group="__adhoc"] .map-item-chip[data-item="u1"]')).toBeTruthy();
    p.document.querySelector('[data-mapping="veh"] .map-add-item').click();                 // same label again
    expect(JSON.parse(p.document.getElementById("map-veh-adhoc").value)).toEqual(["Next inspection"]);
    expect(p.window.setCell("veh", "u1", "card.history", "phone", true)).toBe(true);
    expect(p.window.collectMappings(p.document)[0].adhocItems).toEqual(["Next inspection"]);
    expect(p.window.collectMappings(p.document)[0].assigned["card@phone"]).toContainEqual(["u1", "card.history"]);
    // reload path: a restored adhoc input re-creates the item before cells are projected
    const q = page({ specs: [["veh", VEHICLE_SPEC]] }); q.window.renderMappings();
    q.document.getElementById("map-veh-adhoc").value = JSON.stringify(["A", "B"]);
    q.document.getElementById("map-veh-cells-card@phone").value = "u2>card.footer";
    q.window.refreshMappings();
    expect(box(q.document, "u2", "card.footer", "phone").checked).toBe(true);
  });
  test("slot notes: ✎ reveals a data-comment textarea per target; collectMappings ships non-empty ones", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const ta = p.document.querySelector('[data-comment="map-veh-note-card.badge"]');
    expect(ta.hidden).toBe(true);
    p.document.querySelector('.map-schema[data-map-ctx="phone"] .map-slot[data-map-target="card.badge"] .map-slot-note-btn').click();
    expect(ta.hidden).toBe(false);
    ta.value = "one badge only";
    expect(p.window.collectMappings(p.document)[0].slotNotes).toEqual({ "card.badge": "one badge only" });
  });
  test("frozen section renders from submitted, disabled cells, readonly state, browsable toggle/tabs, no tools; missing submitted → banner", () => {
    const submitted = { cells: { "card@phone": [["vin", "card.header"]], "card@desktop": [] }, order: {}, adhoc: ["Late"], slotNotes: { "card.badge": "kept" } };
    const p = page({ specs: [["veh", { ...VEHICLE_SPEC, submitted }], ["veh2", VEHICLE_SPEC]], frozen: true }); p.window.renderMappings();
    const s = p.section("veh");
    expect(s.dataset.mapFrozen).toBe("true");
    expect(box(p.document, "vin", "card.header", "phone").checked).toBe(true);
    expect(box(p.document, "vin", "card.header", "phone").disabled).toBe(true);
    expect(box(p.document, "plate", "card.header", "phone").checked).toBe(false);
    expect(box(p.document, "plate", "card.header", "phone").dataset.proposed).toBe("1");      // ◆ markers survive
    expect(p.document.getElementById("map-veh-cells-card@phone").readOnly).toBe(true);
    expect(s.querySelector(".map-reset")).toBeNull(); expect(s.querySelector(".map-add-item")).toBeNull(); expect(s.querySelector(".map-copy")).toBeNull();
    expect(s.querySelector(".map-chip .map-chip-remove")).toBeNull();
    expect(p.document.querySelector('[data-comment="map-veh-note-card.badge"]').value).toBe("kept");
    s.querySelector('.map-view-btn[data-map-mode="matrix"]').click();
    expect(s.querySelector('[data-map-matrix="card@phone"]').hidden).toBe(false);
    expect(p.window.setCell("veh", "vin", "card.footer", "phone", true)).toBe(false);
    expect(p.section("veh2").querySelector(".map-error").textContent).toBe("map.frozen_missing");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** in the engine: `.map-toolbar` gains `.map-tabs` (`<span class="map-tabs-label">{{map.context}}</span>` / `{{map.axis}}` groups, `button.map-tab[data-map-tab][aria-pressed]` with `span.map-tab-count` = open violations on that matrix, `{{map.tab_open}}`), `.map-tools` (`button.map-copy[data-from][data-to]` per ordered pair of context values, `button.map-reset`, `button.map-add-item`), `.map-summary` line; `activateTab(section, key)` hides/shows `.map-matrix` and `.map-schema[data-map-ctx]` and writes `tab=` into `map-{m}-ui` (format `mode=schema;tab=card@phone`, parsed leniently); reset = `writeState(cells, encodeCells(proposal pairs of that matrix))` + order from `proposalOrder` + refresh; copy = clear target cells then `setCell` each source pair in order (through `setCell`, so swaps stay deterministic); ad-hoc = `prompt(MAP_LOCALE.add_item_prompt)`, trim, ≤ 60 chars, refuse duplicates (case-insensitive against every label) with an inline `.map-status` hint, ids `u{n}`, group `__adhoc` labelled `{{map.added_group}}`, cells appended to every matrix, persisted in `map-{m}-adhoc`; `refreshMappings` re-creates ad-hoc items from that input BEFORE decoding cells; slot notes = `div.map-slot-notes` with one `textarea[data-comment="map-{m}-note-{targetKey}"][hidden]` per target (label = target label), `✎` buttons on slots and column headers toggle `hidden`. Frozen: `section.closest('section[data-iteration]')` without `data-active` → `data-map-frozen="true"`; initialise from `spec.submitted` (`cells` per matrix key, `order`, `adhoc`, `slotNotes` values into the textareas), else render the proposal AND prepend `<div class="map-error">{{map.frozen_missing}}</div>`; every checkbox `disabled`, state inputs `readonly`, textareas `readonly`, no tools, no chip ×, no arming; toggle/tabs/collapse/search/filters keep working with in-memory ui state (never write the readonly ui input).

- [ ] **Step 4: Run tests** (engine + templates-reference) → PASS. **Step 5: Commit** — `feat(concept): mapping tabs, context copy, reset, ad-hoc items, slot notes, frozen mode`.

---

### Task 4: Integration hooks — persistence, collectors, `data-view-for`, TOC progress mirror

**Agent:** devops:core

**Files:**
- Modify `templates.md`:
  - § State Persistence `DOMContentLoaded` handler (anchor: the comment `// Inject missing per-decision comment slots BEFORE restoring state`): insert as first statement `if (typeof renderMappings === 'function') renderMappings();` with a comment referencing § Information Mapping.
  - `function restoreState()`: after the `try { … } catch (e) { /* corrupt storage — ignore */ }` block, append `if (typeof refreshMappings === 'function') refreshMappings();` (precedent `updateNoteMarkers`).
  - `collectDesignDecisions()`: before `return {…}` add `const mappings = (typeof collectMappings === 'function' && active) ? collectMappings(active) : [];` and `mappings` to the returned object; in the `decisions.push({…})` add `design: view.dataset.viewFor || undefined` (omit the key when absent — build the object then delete undefined).
  - `collectFreeDecisions()`: scope both scans to `const active = document.querySelector('section[data-iteration][data-active]') || document;` (`active.querySelectorAll(...)`), add `mappings`.
  - `collectDecisionDecisions()`: same active scoping for `[data-decision]` and `[data-comment]`; add `mappings: []`.
  - `buildDesignUI()`: in the per-design loop after the screens loop, append `.screen-nav-view-item` buttons for `allViews.filter(v => v.dataset.viewFor === d.dataset.design)`; the views group lists only `allViews.filter(v => !v.dataset.viewFor || !allDesigns.some(d => d.dataset.design === v.dataset.viewFor))` and is skipped when that list is empty.
  - `buildSectionNav()`: for `sec.hasAttribute('data-mapping')` add `link.setAttribute('data-mapping-nav', '')` and a `.section-nav-state` span; `updateSectionNavState()`: for `.section-nav-item[data-mapping-nav]` set `stateEl.textContent = a + '/' + t + (v ? ' · ' + v + ' ⚠' : '')` from `window.mappingProgress(document.getElementById(id))` (null-guarded), class `section-nav-state state-mapping`.
  - § Tab Bar CSS: add a comment line above the `pointer-events: none` rule noting that mapping controls are buttons for this reason (no CSS change).
- Create: `plugins/devops/skills/concept/mapping-integration.test.js`.

- [ ] **Step 1: Write the failing tests** (static contract tests over `templates.md` source + one jsdom test):

```js
import { describe, test, expect } from "vitest";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const md = fs.readFileSync(path.join(__dirname, "deep-knowledge", "templates.md"), "utf8");
const fn = name => { const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}")); if (!m) throw new Error(name); return m[0]; };
describe("mapping integration — engine hooks in the shared systems", () => {
  test("renderMappings is the first call of the persistence DOMContentLoaded handler", () => {
    const handler = md.slice(md.indexOf("// Inject missing per-decision comment slots BEFORE restoring state") - 200);
    const i = handler.indexOf("renderMappings()"), j = handler.indexOf("ensureCommentSlots()"), k = handler.indexOf("restoreState()");
    expect(i).toBeGreaterThan(-1); expect(i).toBeLessThan(j); expect(j).toBeLessThan(k);
  });
  test("restoreState ends with refreshMappings", () => {
    const src = fn("restoreState"); expect(src.trimEnd().endsWith("if (typeof refreshMappings === 'function') refreshMappings();\n}")).toBe(true);
  });
  test("all three collectors emit mappings; free/decision scans are scoped to the active iteration", () => {
    expect(fn("collectDesignDecisions")).toContain("mappings: collectMappings(");
    expect(fn("collectFreeDecisions")).toContain("mappings: collectMappings(");
    expect(fn("collectDecisionDecisions")).toContain("mappings: []");
    for (const name of ["collectFreeDecisions", "collectDecisionDecisions"]) {
      expect(fn(name)).toContain("section[data-iteration][data-active]");
      expect(fn(name)).not.toMatch(/document\.querySelectorAll\('\[data-comment\]'\)/);
    }
    expect(fn("collectDesignDecisions")).toContain("viewFor");
  });
  test("buildDesignUI nests data-view-for views under their design; buildSectionNav mirrors mapping progress", () => {
    expect(fn("buildDesignUI")).toContain("dataset.viewFor");
    expect(fn("buildSectionNav")).toContain("data-mapping-nav");
    expect(fn("updateSectionNavState")).toContain("mappingProgress");
  });
  test("jsdom: a free round with a mapping restores, refreshes and ships mappings[] through the free branch", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] });                      // harness exported by mapping-engine.test.js
    p.window.eval([
      "function resolveIterationTemplate() { return 'free'; }",
      "function attachmentsFor() { return []; }",
      fn("collectAllFormFields"), fn("collectFreeDecisions"), fn("collectDecisions"),
    ].join("\n"));
    p.window.renderMappings();
    const st = p.document.getElementById("map-veh-cells-card@phone");
    st.value = "vin>card.header status>card.badge";                             // what restoreState() does: value only
    p.window.refreshMappings();
    const payload = p.window.collectDecisions("iterate");
    expect(payload.template).toBe("free");
    expect(payload.mappings[0].assigned["card@phone"].sort()).toEqual([["status", "card.badge"], ["vin", "card.header"]]);
    expect(payload.allFields["map-veh-cells-card@phone"]).toBe("vin>card.header status>card.badge");   // re-encoded in decode order
    expect(Object.keys(payload.allFields).some(k => k.includes(">"))).toBe(false);                    // no checkbox leaks into allFields
    expect(payload.comments).toEqual([]);                                                               // empty note is not a comment
  });
});
```

The harness (`page`, `VEHICLE_SPEC`) is imported from `./mapping-engine.test.js` (Task 1 exports them).

- [ ] **Step 2: Run to verify failure.** **Step 3: Apply the edits** listed under Files (exact anchors above). **Step 4: Run** `npx vitest run plugins/devops/skills/concept` → PASS (every concept suite, including `section-nav.test.js`, `panel-anatomy.test.js`, `template-continuity.test.js`). **Step 5: Commit** — `feat(concept): wire the mapping engine into persistence, collectors, design nav and TOC`.

---

### Task 5: Reference documentation in templates.md — view kind, free block, schema, locale

**Agent:** devops:core

**Files:** `templates.md` — (a) new `### View kind \`mapping\`` after `### View kind \`comparison\`` (before `## Layout — Fullscreen single-screen + Overlay Panel + Feedback Dock`) with the § 2a markup and the rules (no inline note in views; `data-view-for`; `.view-mapping`); (b) new `## Mapping block (optional)` in § Template: free before `## Optional bi-state auto-detection` with the § 2b markup and rules (`data-map-wide`, progress mirror, inline note mandatory); (c) § Views (optional) rules bullet for `data-view-for` (all kinds); (d) § Decision schema (design): `mappings` key + `design` field with the § 9 JSON; § Template: free → Decision schema: `mappings` key; (e) § UI Locale rows for every `MAP_LOCALE` key (en + de); (f) § Information Mapping (engine) prose: spec field table (§ 1), DOM contract table (§ 5), load order (§ 4), freeze behaviour (§ 8). Add to `mapping-integration.test.js`: a test mirroring the `ATTACH_LOCALE` test — every `MAP_LOCALE` key has a `map.<key>` locale row and vice versa; a test that `templates.md` contains `data-view-kind="mapping"`, `## Mapping block (optional)`, `"mappings": [` inside the design schema block and `data-view-for`.

- [ ] **Step 1: Failing tests** (append to `mapping-integration.test.js`):

```js
describe("mapping reference docs", () => {
  const jsSource = scanBlocks(md).filter(b => /^(javascript|js)$/.test(b.info)).map(b => b.code).join("\n");   // scanBlocks copied from mapping-engine.test.js
  test("every MAP_LOCALE key has a locale row and every map.* row has a MAP_LOCALE entry", () => {
    const obj = /const MAP_LOCALE = \{([\s\S]*?)\};/.exec(jsSource); expect(obj).not.toBeNull();
    const runtime = new Map(); const entryRe = /([a-z_]+):\s*'\{\{map\.([a-z_]+)\}\}'/g; let e;
    while ((e = entryRe.exec(obj[1]))) runtime.set(e[1], e[2]);
    expect(runtime.size).toBeGreaterThan(20);
    for (const [k, tok] of runtime) expect(tok).toBe(k);
    const rows = new Set(); const rowRe = /^\| `map\.([a-z_]+)`\s+\|/gm; let r;
    while ((r = rowRe.exec(md))) rows.add(r[1]);
    for (const k of runtime.keys()) expect(rows.has(k), `locale row for map.${k}`).toBe(true);
    for (const k of rows) expect(runtime.has(k), `MAP_LOCALE entry for ${k}`).toBe(true);
  });
  test("view kind mapping, free-round block, schema and data-view-for are documented", () => {
    expect(md).toContain("### View kind `mapping`");
    expect(md).toContain("## Mapping block (optional)");
    expect(md).toContain('data-view-kind="mapping"');
    expect(md).toContain('data-view-for="');
    const schema = md.slice(md.indexOf("## Decision schema\n\nThe design submit payload"), md.indexOf("## collectDecisions (design branch)"));
    expect(schema).toContain('"mappings": [');
    expect(schema).toContain('"design"');
    const free = md.slice(md.indexOf("# Template: free"), md.indexOf("# Shared Systems (all templates)"));
    expect(free).toContain('"mappings"');
  });
});
```

- [ ] **Step 2: Run to verify failure.** **Step 3:** write the sections (English, existing "Rules:" style, code fences `html`/`json`) and the locale rows (en + de for every key listed in Task 1's `MAP_LOCALE`). **Step 4:** `npx vitest run plugins/devops/skills/concept` → PASS. **Step 5:** commit `docs(concept): mapping view kind, free-round block, payload schema, locale rows`.

---

### Task 6: SKILL.md, validation-gate.md, iteration-rules.md, interactive-components.md

**Agent:** devops:core (docs) — runs in parallel with Task 7 (disjoint files).

**Files & exact edits:**
- `SKILL.md` § 1a step 1 "Optional views" paragraph: `Two kinds ship as templates` → `Three kinds ship as templates: decision …, comparison …, and mapping (many items assigned to schematic UI elements / matrix targets, § Views (optional) → View kind mapping); any view may name the design it belongs to with data-view-for.` § 1a step 3 (free): append the sentence from spec § 2b. New `### 1c. If the iteration carries a mapping: author the spec` after 1b with the spec § 10 rules (proposal mandatory, id grammar, count preferences ≤ 60 / ≤ 20 / ≤ 4, tiers, `accepts: "one"`, `elements` vs `axes`, `data-view-for`). § Step 2 Localisation item 2: add "mapping engine strings (`map.*`)". § Post-Generation Validation: add "plus the conditional M-set when the page has `[data-mapping]`". § 5a: after the coverage check add "`mappings[]` (§ Information Mapping) is typed and always present — read it before `decisions[]`". § 5b `iterate` item 4 and `implement` item 1: the § 10 rules (next proposal = user's `assigned`; implement = the assignment is the spec; `unassigned`/`violations` → open questions). § 5c step 2: add "for every `[data-mapping]` in the frozen section, write `submitted` into its spec from the payload's `mappings[]` entry (`cells` = `assigned`, `order`, `adhoc` = `adhocItems`, `slotNotes`) — the deterministic gate refuses a frozen mapping without it".
- `validation-gate.md`: P23 → `data-view-kind="decision"` OR `"comparison"` OR `"mapping"`; after the P22–P30 failure paragraph add `**Mappings (conditional — only when the page contains \`data-mapping=\`):**` with the M1–M10 table from spec § 11 and the note that M1–M4, M9 are enforced by `hooks/lib/concept-gate.js`.
- `iteration-rules.md` § Freezing Design Iterations: add a bullet block "Mappings (§ Information Mapping)": controls are buttons (unaffected by the `pointer-events` rule), the renderer disables cells itself from `submitted`, Claude writes `submitted` at freeze time, a frozen mapping without it shows the banner and fails the gate; the exemption list is unchanged.
- `plugins/devops/skills/concept/deep-knowledge/interactive-components.md`: one row/paragraph pointing to the mapping construct.
- `mapping-integration.test.js`: contract tests below.

- [ ] **Step 1: Failing tests** (append to `mapping-integration.test.js`):

```js
describe("mapping skill + gate + freeze docs", () => {
  const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
  const gate = fs.readFileSync(path.join(__dirname, "deep-knowledge", "validation-gate.md"), "utf8");
  const iter = fs.readFileSync(path.join(__dirname, "deep-knowledge", "iteration-rules.md"), "utf8");
  test("SKILL.md: views list, free-round sentence, Step 1c, 5a/5b/5c handling", () => {
    expect(skill).toMatch(/Three kinds ship as templates/);
    expect(skill).toContain("### 1c.");
    expect(skill).toContain("`section[data-mapping]`");
    expect(skill).toContain("`mappings[]`");
    const step5c = skill.slice(skill.indexOf("### 5c. Update the Page"), skill.indexOf("### Final-report append"));
    expect(step5c).toContain("`submitted`");
  });
  test("validation-gate.md: P23 admits mapping, the M-set exists and names the deterministic subset", () => {
    expect(gate).toMatch(/P23 \|[^\n]*"mapping"/);
    for (const m of ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10"]) expect(gate).toContain(`| ${m} |`);
    expect(gate).toContain("concept-gate.js");
  });
  test("iteration-rules.md documents frozen mappings", () => {
    expect(iter).toContain("Mappings (§ Information Mapping)");
    expect(iter).toContain("submitted");
  });
});
```

- [ ] **Step 2: Run to verify failure.** **Step 3:** apply the edits listed under Files. **Step 4:** `npx vitest run plugins/devops/skills/concept` → PASS. **Step 5:** commit `docs(concept): mapping authoring rules, payload handling, gate M-set, freeze rules`.

---

### Task 7: Deterministic gate — `findMappingIssues`

**Agent:** devops:core — parallel with Task 6.

**Files:** `plugins/devops/hooks/lib/concept-gate.js`, `plugins/devops/hooks/lib/concept-gate.test.js`, `plugins/devops/hooks/post-tool-use/post.concept.gate.js`.

**Interfaces (produces):** `findMappingIssues(html) → Array<{kind, why, at}>` with kinds `spec-missing`, `spec-parse`, `bad-id`, `duplicate-id`, `duplicate-mapping-id`, `unknown-ref`, `ctx-mismatch`, `empty-mapping`, `frozen-without-submitted`; `evaluate()` returns `mapping: []` and `ok` requires it empty; `buildBlockReason(filePath, missing, forbidden, structural, mapping)`.

- [ ] **Step 1: Failing tests** (append to `concept-gate.test.js`):

```js
import { findMappingIssues } from "./concept-gate.js";
const spec = extra => JSON.stringify({ items: [{ id: "a", label: "A" }], axes: [{ id: "x", label: "X", columns: [{ id: "c1", label: "C1" }] }], proposal: [["a", "x.c1"]], ...extra });
const wrap = (iter, body) => `<section data-iteration="${iter.n}"${iter.active ? " data-active" : " hidden"}>${body}</section>`;
const mapping = (id, s) => `<section data-mapping="${id}" id="${id}"><script type="application/json" data-mapping-spec>${s}</script></section>`;
describe("findMappingIssues", () => {
  test("no mapping → no issues", () => { expect(findMappingIssues(VALID)).toEqual([]); });
  test("valid live mapping passes", () => { expect(findMappingIssues(wrap({ n: 1, active: true }, mapping("m1", spec())))).toEqual([]); });
  test("unparseable spec", () => { expect(findMappingIssues(wrap({ n: 1, active: true }, mapping("m1", "{nope"))).map(i => i.kind)).toEqual(["spec-parse"]); });
  test("bad id grammar and duplicate ids", () => {
    const s = JSON.stringify({ items: [{ id: "a-b" }, { id: "a-b" }], axes: [{ id: "x", columns: [{ id: "c1" }] }] });
    const kinds = findMappingIssues(wrap({ n: 1, active: true }, mapping("m1", s))).map(i => i.kind);
    expect(kinds).toContain("bad-id"); expect(kinds).toContain("duplicate-id");
  });
  test("mapping id reused across iterations", () => {
    const html = wrap({ n: 1, active: false }, mapping("m1", spec({ submitted: { cells: {} } }))) + wrap({ n: 2, active: true }, mapping("m1", spec()));
    expect(findMappingIssues(html).map(i => i.kind)).toContain("duplicate-mapping-id");
  });
  test("proposal referencing unknown ids; ctx present without context", () => {
    expect(findMappingIssues(wrap({ n: 1, active: true }, mapping("m1", spec({ proposal: [["zz", "x.c1"]] })))).map(i => i.kind)).toContain("unknown-ref");
    expect(findMappingIssues(wrap({ n: 1, active: true }, mapping("m1", spec({ proposal: [["a", "x.c1", "phone"]] })))).map(i => i.kind)).toContain("ctx-mismatch");
  });
  test("empty mapping (no elements/axes)", () => {
    expect(findMappingIssues(wrap({ n: 1, active: true }, mapping("m1", JSON.stringify({ items: [{ id: "a" }] })))).map(i => i.kind)).toContain("empty-mapping");
  });
  test("frozen iteration without submitted fails; with submitted passes", () => {
    expect(findMappingIssues(wrap({ n: 1, active: false }, mapping("m1", spec()))).map(i => i.kind)).toEqual(["frozen-without-submitted"]);
    expect(findMappingIssues(wrap({ n: 1, active: false }, mapping("m1", spec({ submitted: { cells: { x: [["a", "x.c1"]] } } }))))).toEqual([]);
  });
  test("evaluate + buildBlockReason surface mapping issues", () => {
    const html = VALID.replace("</body>", wrap({ n: 2, active: false }, mapping("m1", spec())) + "</body>");
    const r = evaluate("docs/concepts/x.html", html);
    expect(r.ok).toBe(false); expect(r.mapping.map(i => i.kind)).toEqual(["frozen-without-submitted"]);
    expect(buildBlockReason("x.html", [], [], [], r.mapping)).toContain("frozen-without-submitted");
  });
});
```

- [ ] **Step 2: Run to verify failure.** **Step 3: Implement** `findMappingIssues`: regex-walk `<section[^>]*data-iteration="(\d+)"[^>]*>` open tags (record offset + `data-active` presence) and `<section[^>]*data-mapping="([^"]+)"[^>]*>` open tags; for each mapping section find the next `<script[^>]*data-mapping-spec[^>]*>([\s\S]*?)<\/script>` after its offset (before the next `data-mapping` section) — missing → `spec-missing`; `JSON.parse` → `spec-parse`; validate: id grammar (`^[a-z0-9_]+$`) over items/elements/parts/axes/columns/context values → `bad-id`; duplicate item ids / source ids / part ids per element → `duplicate-id`; mapping id seen twice page-wide → `duplicate-mapping-id`; every `proposal` / `submitted.cells[*]` pair references known ids → `unknown-ref`; a third proposal element present without `context` (or absent with) → `ctx-mismatch`; no elements and no axes, or an element/axis without parts/columns → `empty-mapping`; enclosing iteration (nearest preceding `data-iteration` open tag) lacks `data-active` and spec has no `submitted` object → `frozen-without-submitted`. Wire into `evaluate` (`mapping`, `ok`), `buildBlockReason` (a "Mapping spec problems" block listing kind + why + the fix hint "regenerate the spec / write `submitted` when freezing"), `module.exports`, and `post.concept.gate.js` (destructure `mapping`, pass it through). **Step 4:** `npx vitest run plugins/devops/hooks` → PASS. **Step 5: Commit** — `feat(concept): deterministic gate validates mapping specs and frozen submissions`.

---

### Task 8: Fixture builder `--mapping` + real-browser verification

**Agent:** devops:qa (fixes by devops:frontend if the browser check finds defects)

**Files:** `plugins/devops/scripts/build-concept-fixture.js` (`--mapping` boolean flag: design mode adds one `section[data-view][data-view-kind="mapping"][data-view-for="d{n}"]` with the vehicle spec of `mapping-engine.test.js` to the live design round; decision mode switches the live round to a `free` round carrying one `section[data-mapping]` block with the trains spec, plus the inline note; frozen rounds get a `submitted` copy), new `plugins/devops/scripts/build-concept-fixture.test.js` (build both modes with `--mapping`, assert `data-mapping` present, `findMappingIssues(page)` empty, `findStructural(page)` empty).

- [ ] Steps: failing test → implement flag → build `--mode design --mapping --out <scratchpad>/fixture-design.html` and `--mode decision --mapping --out <scratchpad>/fixture-free.html` → open each via the Playwright MCP (`browser_navigate` on the `file://` URL, isolated profile) and verify with screenshots + `browser_snapshot`: (1) the mapping segment in the switcher opens the subpage; (2) both tier columns side by side ≥ 1000 px, stacked at 600 px; (3) matrix: header rows and item column stay sticky while scrolling inside `.map-scroll`, page has no horizontal scrollbar; (4) arm a chip, tap two slots, chips appear, counts update, Σ updates in the matrix after toggling; (5) tab switch Phone → Desktop, copy, reset with confirm; (6) reload keeps the assignment (localStorage path, file:// has no bridge); (7) a frozen round's mapping is browsable (toggle + tabs) and its cells are disabled; (8) light theme (`html[data-theme="light"]`) readable. Record findings; fix defects in the engine (Task 2/3 code) with regression tests. Commit `test(concept): mapping fixture builder flag + browser-verified engine fixes`.

---

### Task 9: Final verification

**Agent:** devops:qa

- [ ] `npm test` (full suite) — green; note the 120 s ceiling of the ship gate and report the full-suite time.
- [ ] `npm run lint` — green.
- [ ] Spec coverage checklist: walk spec § 1–§ 12 and name the task/test that covers each section; anything uncovered goes back to the owning agent.
- [ ] `git log --oneline main..HEAD` — one commit per task, conventional messages, no stray files (`git status` clean).
- [ ] Report: test counts, lint result, fixture screenshots location, open items.
