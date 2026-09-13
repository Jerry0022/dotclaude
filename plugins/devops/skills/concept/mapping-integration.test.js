import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { page, VEHICLE_SPEC } from "./mapping-engine.test.js";

// The information-mapping engine (templates.md § Information Mapping (engine))
// is wired into the page's shared systems: persistence renders it before
// restoreState() and refreshes it after, all three collectDecisions branches
// emit `mappings`, the ☰ design nav nests `data-view-for` views under their
// design and the section TOC mirrors the mapping progress. Static contracts
// over the reference source plus jsdom runs of the touched functions.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const md = fs.readFileSync(path.join(__dirname, "deep-knowledge", "templates.md"), "utf8");
const fn = name => {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error(name);
  return m[0];
};

describe("mapping integration — engine hooks in the shared systems", () => {
  test("renderMappings is the first call of the persistence DOMContentLoaded handler", () => {
    const handler = md.slice(md.indexOf("// Inject missing per-decision comment slots BEFORE restoring state") - 200);
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
    expect(fn("buildDesignUI")).toContain("dataset.viewFor");
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
  test("jsdom: a free round with a mapping restores, refreshes and ships mappings[] through the free branch", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] });                      // harness exported by mapping-engine.test.js
    p.window.eval([
      "if (typeof CSS === 'undefined') window.CSS = { escape: s => s };",   // jsdom has no CSS.escape
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
  test("jsdom: the free branch never ships a frozen round's mapping note or sections", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] });
    p.window.eval([
      "if (typeof CSS === 'undefined') window.CSS = { escape: s => s };",   // jsdom has no CSS.escape
      "function resolveIterationTemplate() { return 'free'; }",
      "function attachmentsFor() { return []; }",
      fn("collectAllFormFields"), fn("collectFreeDecisions"), fn("collectDecisions"),
    ].join("\n"));
    const frozen = p.document.createElement("section");
    frozen.dataset.iteration = "2"; frozen.hidden = true;
    frozen.innerHTML = '<section id="old" data-nav-label="Old"><input type="radio" name="eval-old" value="discard" checked>'
      + '<textarea data-comment="map-old-note">stale</textarea></section>';
    p.document.querySelector("main").prepend(frozen);
    p.window.renderMappings();
    const payload = p.window.collectDecisions("iterate");
    expect(payload.comments).toEqual([]);
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
    expect(state.className).toBe("section-nav-state state-mapping");
    p.window.setCell("veh", "plate", "card.header", "phone", false);           // header@phone min 1 → one more violation
    p.window.setCell("veh", "model", "card.header", "phone", false);
    const after = p.window.mappingProgress(p.section("veh"));
    expect(after.violations).toBeGreaterThan(prog.violations);
    expect(state.textContent).toBe(mirror(after));
    expect(state.textContent).toMatch(/ · \d+ ⚠$/);
    // a restore path (value only, then refreshMappings) re-mirrors too
    p.document.getElementById("map-veh-cells-card@phone").value = "plate>card.header status>card.badge mileage>card.line1";
    p.window.refreshMappings();
    const restored = p.window.mappingProgress(p.section("veh"));
    expect(restored.assigned).not.toBe(after.assigned);
    expect(state.textContent).toBe(mirror(restored));
  });
});
