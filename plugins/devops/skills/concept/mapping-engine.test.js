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

describe("mapping engine — matrix interaction (review additions)", () => {
  test("a real click on a cell writes exactly one pair; a refused write leaves box and state untouched", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const cb = box(p.document, "vin", "card.footer", "phone");
    expect(cb.checked).toBe(false);
    cb.checked = true;                                                                       // what the browser does before `change`
    cb.dispatchEvent(new p.window.Event("change", { bubbles: true }));
    expect(cells(p.document, "veh", "card@phone")).toContain("vin>card.footer");
    expect(cb.checked).toBe(true);                                                           // no double toggle
    const before = p.document.getElementById("map-veh-cells-card@phone").value;
    expect(p.window.setCell("veh", "vin", "card.nowhere", "phone", true)).toBe(false);
    expect(p.document.getElementById("map-veh-cells-card@phone").value).toBe(before);
    expect(cb.checked).toBe(true);
  });
  test("arrow keys, Home and End move focus between cells and keep exactly one tabindex=0 per table", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const table = p.document.querySelector('[data-map-matrix="card@phone"] table');
    const key = (target, k) => target.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
    const entry = box(p.document, "plate", "card.header", "phone");
    expect(entry.tabIndex).toBe(0);
    key(entry, "ArrowRight");
    expect(p.document.activeElement).toBe(box(p.document, "plate", "card.badge", "phone"));
    key(p.document.activeElement, "ArrowDown");
    expect(p.document.activeElement).toBe(box(p.document, "model", "card.badge", "phone"));
    key(p.document.activeElement, "End");
    expect(p.document.activeElement).toBe(box(p.document, "model", "card.history", "phone"));
    key(p.document.activeElement, "Home");
    expect(p.document.activeElement).toBe(box(p.document, "model", "card.header", "phone"));
    expect(table.querySelectorAll('input[data-map-cell][tabindex="0"]').length).toBe(1);
    expect(p.document.activeElement.tabIndex).toBe(0);
    const toggle = table.querySelector('tr.map-group-row[data-group="Identity"] .map-group-toggle');
    toggle.click();                                                                          // collapses the group holding the entry point
    expect(toggle.querySelector('.map-group-glyph').textContent).toBe("▸");
    expect(table.querySelectorAll('input[data-map-cell][tabindex="0"]').length).toBe(1);
    expect(table.querySelector('input[data-map-cell][tabindex="0"]').closest("tr").hidden).toBe(false);
  });
});

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
  test("status line names the armed item / slot; Esc stops propagation only when it disarmed something", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    const section = p.document.querySelector('[data-mapping="veh"]');
    const status = section.querySelector('.map-schema[data-map-ctx="phone"] .map-status');
    const esc = () => {                                                                      // true when the key reached the document
      let reached = false; const spy = () => { reached = true; };
      p.document.addEventListener("keydown", spy);
      section.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      p.document.removeEventListener("keydown", spy);
      return reached;
    };
    expect(status.textContent).toBe("");
    expect(esc()).toBe(true);
    p.document.querySelector('.map-item-chip[data-item="mileage"]').click();
    expect(status.textContent).toBe("map.armed_item");                                       // token, {label} substituted by fmt at runtime
    expect(esc()).toBe(false);
    expect(status.textContent).toBe("");
    p.document.querySelector('.map-slot[data-map-target="card.badge"] .map-slot-label').click();
    expect(p.document.querySelector('.map-slot[data-map-target="card.badge"]').classList.contains("is-armed")).toBe(true);
    expect(status.textContent).toBe("map.armed_slot");
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
  test("Alt+ArrowRight on a chip of an ordered slot rewrites the order input and keeps the chip focused", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    p.window.setCell("veh", "holder", "card.line1", "phone", true);                        // appended after the proposed "mileage"
    const order = p.document.getElementById("map-veh-order-card.line1@phone");
    expect(order.value).toBe("mileage,holder");
    const slot = p.document.querySelector('.map-schema[data-map-ctx="phone"] .map-slot[data-map-target="card.line1"]');
    const chip = slot.querySelector('.map-chip[data-item="mileage"]');
    chip.focus();
    chip.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    expect(order.value).toBe("holder,mileage");
    expect(order.dataset.touched).toBe("true");
    expect([...slot.querySelectorAll(".map-chip")].map(c => c.dataset.item)).toEqual(["holder", "mileage"]);
    expect(p.document.activeElement.dataset.item).toBe("mileage");
    expect(p.window.collectMappings(p.document)[0].order["card.line1@phone"]).toEqual(["holder", "mileage"]);
  });
  test("frozen section: chips never arm, palette collapse and tabs work in memory, the readonly ui input is never written", () => {
    const submitted = { cells: { "card@phone": [["plate", "card.header"]], "card@desktop": [] }, order: {}, adhoc: [], slotNotes: {} };
    const p = page({ specs: [["veh", { ...VEHICLE_SPEC, submitted }]], frozen: true }); p.window.renderMappings();
    const s = p.section("veh");
    const ui = p.document.getElementById("map-veh-ui");
    const before = ui.value;
    const chip = s.querySelector('.map-schema[data-map-ctx="phone"] .map-item-chip[data-item="holder"]');
    chip.click();
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(s.querySelector('.map-schema[data-map-ctx="phone"] .map-status').textContent).toBe("");
    s.querySelector('.map-slot[data-map-target="card.footer"] .map-slot-label').click();
    expect(s.querySelector('.map-slot[data-map-target="card.footer"]').classList.contains("is-armed")).toBe(false);
    s.querySelector('.map-tab[data-map-tab="card@desktop"]').click();
    expect(s.querySelector('.map-schema[data-map-ctx="desktop"]').hidden).toBe(false);
    s.querySelector('.map-view-btn[data-map-mode="matrix"]').click();
    expect(s.querySelector('[data-map-matrix="card@desktop"]').hidden).toBe(false);
    expect(s.querySelector('[data-map-matrix="card@phone"]').hidden).toBe(true);
    expect(ui.value).toBe(before);
    expect(ui.dataset.touched).toBeUndefined();
    const collapse = s.querySelector('.map-schema[data-map-ctx="desktop"] .map-palette-collapse');
    collapse.click();
    expect(collapse.getAttribute("aria-expanded")).toBe("false");
    expect(s.querySelector('.map-schema[data-map-ctx="desktop"] .map-groups').hidden).toBe(true);
  });
  test("ad-hoc cap: the 21st item is refused and the button is disabled; labels are trimmed to 60 chars", () => {
    const p = page({ specs: [["veh", VEHICLE_SPEC]] }); p.window.renderMappings();
    let n = 0; p.window.prompt = () => "  Item " + (++n) + " " + "x".repeat(80);
    for (let i = 0; i < 25; i++) p.document.querySelector('[data-mapping="veh"] .map-add-item').click();
    const labels = JSON.parse(p.document.getElementById("map-veh-adhoc").value);
    expect(labels.length).toBe(20);
    expect(labels[0].length).toBe(60); expect(labels[0].startsWith("Item 1 ")).toBe(true);
    expect(p.document.querySelector('[data-mapping="veh"] .map-add-item').disabled).toBe(true);
    expect(p.document.querySelectorAll('[data-map-matrix="card@phone"] tr.map-item-row[data-group="__adhoc"]').length).toBe(20);
    expect(p.document.querySelector('[data-mapping="veh"] .map-tools-status').textContent).toBe("");
    p.window.prompt = () => "item 3 " + "x".repeat(53);                                     // case-insensitive duplicate → hint
    p.document.querySelector('[data-mapping="veh"] .map-add-item').click();
    expect(JSON.parse(p.document.getElementById("map-veh-adhoc").value).length).toBe(20);
  });
  test("mixed elements + axes: axis tabs force the matrix view without touching mode=; element tabs restore the schematic", () => {
    const spec = { ...VEHICLE_SPEC, axes: TRAINS_SPEC.axes.map(a => ({ ...a, itemTargets: "any" })), context: undefined,
                   proposal: VEHICLE_SPEC.proposal.filter(p => p[2] === "phone").map(p => [p[0], p[1]]), proposalOrder: { "card.line1": ["mileage"] } };
    const p = page({ specs: [["mix", spec]] }); p.window.renderMappings();
    const s = p.section("mix");
    expect([...s.querySelectorAll(".map-tab")].map(t => t.dataset.mapTab)).toEqual(["card", "train", "owner"]);
    expect(s.querySelector(".map-tabs-label").textContent).toBe("map.axis");
    expect(s.querySelector(".map-copy")).toBeNull();                                        // no context → nothing to copy
    s.querySelector('.map-tab[data-map-tab="train"]').click();
    expect(s.querySelector('[data-map-matrix="train"]').hidden).toBe(false);
    expect(s.querySelector('.map-schema').hidden).toBe(true);
    expect(s.querySelector('.map-view-btn[data-map-mode="matrix"]').getAttribute("aria-pressed")).toBe("true");
    expect(p.document.getElementById("map-mix-ui").value).toBe("mode=schema;tab=train");
    s.querySelector('.map-tab[data-map-tab="card"]').click();
    expect(s.querySelector('.map-schema').hidden).toBe(false);
    expect(s.querySelector('[data-map-matrix="train"]').hidden).toBe(true);
    p.window.confirm = () => true;
    p.window.setCell("mix", "vin", "train.r1", null, true);                                  // reset targets the ACTIVE tab only
    s.querySelector(".map-reset").click();
    expect(box(p.document, "vin", "train.r1", null).checked).toBe(true);
    s.querySelector('.map-tab[data-map-tab="train"]').click(); s.querySelector(".map-reset").click();
    expect(box(p.document, "vin", "train.r1", null).checked).toBe(false);
    expect(box(p.document, "vin", "card.overview", null).checked).toBe(true);                 // the card matrix kept its edits-free proposal
  });
});
