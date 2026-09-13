import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { md, scanBlocks, page, mappingSection, VEHICLE_SPEC } from "./mapping-harness.js";

// The information-mapping engine (templates.md § Information Mapping (engine))
// is wired into the page's shared systems: persistence renders it before
// restoreState() and refreshes it after, all three collectDecisions branches
// emit `mappings`, the ☰ design nav nests `data-view-for` views under their
// design and the section TOC mirrors the mapping progress. Static contracts
// over the reference source plus jsdom runs of the touched functions.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fn = name => {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error(name);
  return m[0];
};
const CSS_STUB = "if (typeof CSS === 'undefined') window.CSS = { escape: s => s };";   // jsdom has no CSS.escape
const FROZEN_SUBMITTED = { cells: { "card@phone": [["vin", "card.header"], ["status", "card.badge"]], "card@desktop": [] }, order: {}, adhoc: [], slotNotes: {} };
// A frozen, hidden earlier round holding its own (submitted) mapping — what a
// concept page looks like once the mapping has been through one iteration.
const prependFrozenRound = (p, extra = "") => {
  const frozen = p.document.createElement("section");
  frozen.dataset.iteration = "2"; frozen.hidden = true;
  frozen.innerHTML = mappingSection("veh_old", { ...VEHICLE_SPEC, submitted: FROZEN_SUBMITTED }) + extra;
  p.document.querySelector("main").prepend(frozen);
  return frozen;
};

describe("mapping integration — engine hooks in the shared systems", () => {
  test("renderMappings is the first call of the persistence DOMContentLoaded handler", () => {
    const anchor = md.indexOf("// Inject missing per-decision comment slots BEFORE restoring state");
    expect(anchor).toBeGreaterThan(-1);
    const start = md.lastIndexOf("document.addEventListener('DOMContentLoaded', () => {", anchor);
    expect(start).toBeGreaterThan(-1);
    const handler = md.slice(start, anchor + 400);
    const i = handler.indexOf("renderMappings()"), j = handler.indexOf("ensureCommentSlots()"), k = handler.indexOf("restoreState()");
    expect(i).toBeGreaterThan(-1); expect(i).toBeLessThan(j); expect(j).toBeLessThan(k);
  });
  test("restoreState ends with refreshMappings", () => {
    const src = fn("restoreState");
    expect(src.trimEnd().endsWith("if (typeof refreshMappings === 'function') refreshMappings();\n}")).toBe(true);
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
    const ui = fn("buildDesignUI");
    expect(ui).toContain("allViews.filter(v => v.dataset.viewFor === d.dataset.design)");
    expect(ui).toContain("!allDesigns.some(d => d.dataset.design === v.dataset.viewFor)");
    expect(fn("buildSectionNav")).toContain("data-mapping-nav");
    expect(fn("updateSectionNavState")).toContain("mappingProgress");
  });
  test("the frozen-tab pointer-events rule documents why mapping controls are buttons", () => {
    const at = md.indexOf("section[data-iteration]:not([data-active]) input,");
    expect(at).toBeGreaterThan(-1);
    const before = md.slice(at - 400, at);
    expect(before).toMatch(/\/\*[^*]*(mapping|Mapping)[^*]*button[^*]*\*\//);
  });
  test("refreshMappings ends by mirroring the TOC state", () => {
    const src = md.slice(md.indexOf("  function refreshMappings(root) {"), md.indexOf("  // --- payload (§ Payload)"));
    expect(src).toContain("if (typeof updateSectionNavState === 'function') updateSectionNavState();");
  });
  test("the TOC mirror has a muted state-mapping rule and a warning has-violations rule", () => {
    expect(md).toContain(".section-nav-state.state-mapping { color: var(--text-secondary); }");
    expect(md).toContain(".section-nav-state.state-mapping.has-violations { color: var(--warning-color); }");
    expect(fn("updateSectionNavState")).toContain("classList.toggle('has-violations', p.violations > 0)");
  });
  test("jsdom: a free round with a mapping restores, refreshes and ships mappings[] through the free branch", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] });
    p.window.eval([
      CSS_STUB,
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
  test("jsdom: the free branch never ships a frozen round's mapping, its note or its sections", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] });
    p.window.eval([
      CSS_STUB,
      "function resolveIterationTemplate() { return 'free'; }",
      "function attachmentsFor() { return []; }",
      fn("collectAllFormFields"), fn("collectFreeDecisions"), fn("collectDecisions"),
    ].join("\n"));
    prependFrozenRound(p, '<section id="old" data-nav-label="Old"><input type="radio" name="eval-old" value="discard" checked>'
      + '<textarea data-comment="map-old-note">stale</textarea></section>');
    p.document.querySelector('[data-comment="map-veh_old-note"]').value = "frozen note";
    p.window.renderMappings();
    expect(p.section("veh_old").dataset.mapRendered).toBe("true");                                    // the frozen mapping IS rendered …
    expect(p.document.getElementById("map-veh_old-cells-card@phone").value).toBe("vin>card.header status>card.badge");
    const payload = p.window.collectDecisions("iterate");
    expect(payload.comments).toEqual([]);                                                               // … but nothing of it is collected
    expect(payload.decisions.map(d => d.id)).not.toContain("old");
    expect(payload.mappings.map(m => m.id)).toEqual(["veh"]);
  });
  test("jsdom: the TOC mirror reads a/t · v ⚠ from mappingProgress and follows every cell change", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] });
    p.window.eval(fn("updateSectionNavState"));
    const link = p.document.createElement("a");
    link.className = "section-nav-item"; link.dataset.sectionId = "veh"; link.setAttribute("data-mapping-nav", "");
    link.innerHTML = '<span class="section-nav-label">veh</span><span class="section-nav-state"></span>';
    p.document.body.appendChild(link);
    p.window.renderMappings();                                                 // a first visit has no stored blob → no refreshMappings()
    const state = link.querySelector(".section-nav-state");
    expect(state.textContent).toMatch(/^\d+\/6/);                              // render alone fills a TOC built before it
    const mirror = q => `${q.assigned}/${q.total}` + (q.violations ? ` · ${q.violations} ⚠` : "");
    const prog = p.window.mappingProgress(p.section("veh"));
    expect(prog.total).toBe(6);
    expect(state.textContent).toBe(mirror(prog));
    expect(state.classList.contains("state-mapping")).toBe(true);
    expect(state.classList.contains("has-violations")).toBe(prog.violations > 0);
    p.window.setCell("veh", "plate", "card.header", "phone", false);           // header@phone min 1 → one more violation
    p.window.setCell("veh", "model", "card.header", "phone", false);
    const after = p.window.mappingProgress(p.section("veh"));
    expect(after.violations).toBeGreaterThan(prog.violations);
    expect(state.textContent).toBe(mirror(after));
    expect(state.textContent).toMatch(/ · \d+ ⚠$/);
    expect(state.classList.contains("has-violations")).toBe(true);
    // a restore path (value only, then refreshMappings) re-mirrors too
    p.document.getElementById("map-veh-cells-card@phone").value = "plate>card.header status>card.badge mileage>card.line1";
    p.window.refreshMappings();
    const restored = p.window.mappingProgress(p.section("veh"));
    expect(restored.assigned).not.toBe(after.assigned);
    expect(state.textContent).toBe(mirror(restored));
  });
  test("the single-design collapse keeps the switcher visible when view segments exist", () => {
    const at = md.indexOf('body[data-single-design="true"] .design-switcher');
    expect(at).toBeGreaterThan(-1);
    const rule = md.slice(at, md.indexOf("{", at));
    expect(rule).toContain('.design-switcher:not(:has(.view-switch-item))');
    expect(rule).toContain('body[data-single-design="true"] .screen-nav-design-heading');
    expect(rule).toContain('body[data-single-design="true"] .feedback-section:has([data-design-comment])');
    expect(rule).toContain('body[data-single-design="true"] .feedback-divider:has(+ .feedback-section [data-design-comment])');
  });
  test("jsdom: buildSectionNav + the mirror resolve the mapping in the VISIBLE round, never a hidden one", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] });
    p.window.eval([
      "const NAV_GROUP_MIN_KINDS = 2, NAV_GROUP_OVER_ENTRIES = 99; const _navManualClosedAt = new Map();",
      "function buildIterationTree() {} function installScrollSpy() {}",
      fn("buildSectionNav"), fn("updateSectionNavState"),
    ].join("\n"));
    const nav = p.document.createElement("nav"); nav.id = "section-nav"; p.document.body.appendChild(nav);
    prependFrozenRound(p);
    p.window.renderMappings();
    p.window.buildSectionNav();
    const links = [...nav.querySelectorAll(".section-nav-item[data-mapping-nav]")].map(a => a.dataset.sectionId);
    expect(links).toEqual(["veh"]);                                             // nav is built from the visible round only
    const state = nav.querySelector('.section-nav-item[data-mapping-nav] .section-nav-state');
    const mirror = q => `${q.assigned}/${q.total}` + (q.violations ? ` · ${q.violations} ⚠` : "");
    const live = p.window.mappingProgress(p.section("veh"));
    const old = p.window.mappingProgress(p.section("veh_old"));
    expect(live.assigned).not.toBe(old.assigned);                               // the two rounds are distinguishable
    expect(state.textContent).toBe(mirror(live));
    // the mirror resolves through the visible round: a mapping id the visible round does not hold is left alone
    const stray = p.document.createElement("a");
    stray.className = "section-nav-item"; stray.dataset.sectionId = "veh_old"; stray.setAttribute("data-mapping-nav", "");
    stray.innerHTML = '<span class="section-nav-state">untouched</span>';
    nav.appendChild(stray);
    p.window.updateSectionNavState();
    expect(stray.querySelector(".section-nav-state").textContent).toBe("untouched");
    expect(state.textContent).toBe(mirror(live));
  });
});

describe("mapping reference docs", () => {
  const jsSource = scanBlocks(md).filter(b => /^(javascript|js)$/.test(b.info)).map(b => b.code).join("\n");
  test("every MAP_LOCALE key has a locale row and every map.* row has a MAP_LOCALE entry", () => {
    const obj = /const MAP_LOCALE = \{([\s\S]*?)\};/.exec(jsSource); expect(obj).not.toBeNull();
    const runtime = new Map(); const entryRe = /([a-z_]+):\s*'\{\{map\.([a-z_]+)\}\}'/g; let e;
    while ((e = entryRe.exec(obj[1]))) runtime.set(e[1], e[2]);
    expect(runtime.size).toBeGreaterThan(20);
    for (const [k, tok] of runtime) expect(tok).toBe(k);
    const rows = new Set(); const rowRe = /^\| `map\.([a-z_]+)`\s+\|(.*)\|(.*)\|\s*$/gm; let r;
    while ((r = rowRe.exec(md))) {
      rows.add(r[1]);
      // map.* cells are substituted verbatim into single-quoted JS string
      // literals in MAP_LOCALE — an apostrophe, backtick or backslash would
      // break the engine block's <script> fence (see § UI Locale).
      for (const cell of [r[2], r[3]]) expect(/['`\\]/.test(cell), `map.${r[1]} cell "${cell.trim()}" contains a forbidden character`).toBe(false);
    }
    for (const k of runtime.keys()) expect(rows.has(k), `locale row for map.${k}`).toBe(true);
    for (const k of rows) expect(runtime.has(k), `MAP_LOCALE entry for ${k}`).toBe(true);
  });
  test("view kind mapping, free-round block, schema and data-view-for are documented", () => {
    expect(md).toContain("### View kind `mapping`");
    expect(md).toContain("## Mapping block (optional)");
    expect(md).toContain('data-view-kind="mapping"');
    expect(md).toContain('data-view-for="');
    const schema = md.slice(md.indexOf("## Decision schema\n\nThe design submit payload"), md.indexOf("## collectDecisions (design branch)"));
    expect(schema).toMatch(/"mappings": \[\s*\{/);
    expect(schema).toContain('"design": "card_a"');
    const free = md.slice(md.indexOf("# Template: free"), md.indexOf("# Shared Systems (all templates)"));
    expect(free).toContain('"mappings"');
  });
  test("engine block parses after en and de locale substitution", () => {
    const rowRe = /^\| `(map\.[a-z_]+)`\s+\|(.+)\|(.+)\|\s*$/gm; const en = new Map(), de = new Map(); let r;
    while ((r = rowRe.exec(md))) { en.set(r[1], r[2].trim()); de.set(r[1], r[3].trim()); }
    for (const [locale, table] of [["en", en], ["de", de]]) {
      const substituted = jsSource.replace(/\{\{(map\.[a-z_]+)\}\}/g, (whole, key) => table.get(key) ?? whole);
      expect(() => new vm.Script(substituted, { filename: `engine-${locale}.js` }), locale).not.toThrow();
    }
  });
});

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
