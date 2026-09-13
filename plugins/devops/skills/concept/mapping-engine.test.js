import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// The information-mapping engine (templates.md § Information Mapping (engine))
// is copied verbatim into every generated concept page. These tests run the
// fenced block on jsdom against small specs and pin the DOM contract (§ 5),
// the state encoding (§ 4), the single write path `setCell()` and the § 9
// payload shape that `collectMappings()` emits.

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
    expect(m.unassigned).toEqual(["status"]);                                                // status lost its only cell; every other item is somewhere across contexts
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
