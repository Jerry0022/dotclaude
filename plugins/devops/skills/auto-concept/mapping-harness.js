import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";

// Shared jsdom harness for the information-mapping engine
// (templates-mapping.md § Information Mapping (engine)). Not a test file on purpose:
// vitest collects `plugins/**/*.test.js`, so importing this module from
// several suites does not re-register anyone's tests.

export const md = readTemplates();

export function scanBlocks(src) {            // same line scanner as panel-anatomy.test.js
  const lines = src.split("\n"); const out = []; let open = null, body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) { if (open === null) { open = { info: m[1].trim(), start: i + 2 }; body = []; }
             else { out.push({ info: open.info, line: open.start, code: body.join("\n") }); open = null; } continue; }
    if (open) body.push(lines[i]);
  }
  return out;
}
export const ENGINE = scanBlocks(md).find(b => /^(javascript|js)$/.test(b.info) && b.code.includes("Information mapping engine"));
// Locale tokens become their key; `tab_open` / `spec_error` keep their real placeholder so the
// rendered text carries the count / the error as in production.
export const PLACEHOLDERS = { "map.tab_open": "{n} map.tab_open", "map.spec_error": "map.spec_error: {error}" };
export const localeKeys = s => s.replace(/\{\{([a-z_.]+)\}\}/g, (_, k) => PLACEHOLDERS[k] || k);

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

// One `section[data-mapping]` exactly as § 5 wants it in the page: spec script + note slot.
export const mappingSection = (id, spec) =>
  `<section data-mapping="${id}" id="${id}" data-nav-label="${id}"><script type="application/json" data-mapping-spec>${JSON.stringify(spec)}</script>
     <textarea data-comment="map-${id}-note"></textarea></section>`;

// `url` gives the document a real origin — jsdom refuses localStorage on the
// default opaque one — for tests that run the persistence block's saveState().
export function page({ specs, active = true, frozen = false, url } = {}) {
  const sections = specs.map(([id, spec]) => mappingSection(id, spec)).join("");
  const html = `<!doctype html><html><body><main><section data-iteration="3" data-iteration-template="free"${active && !frozen ? " data-active" : " hidden"}>${sections}</section></main></body></html>`;
  const dom = new JSDOM(html, { runScripts: "outside-only", ...(url ? { url } : {}) });
  const { window } = dom;
  window.eval("var _userInteracted = false;");
  window.eval(localeKeys(ENGINE.code));
  return { window, document: window.document, section: id => window.document.getElementById(id) };
}
export const cells = (doc, id, key) => doc.getElementById(`map-${id}-cells-${key}`).value.split(" ").filter(Boolean).sort();
export const box = (doc, item, target, ctx) => [...doc.querySelectorAll(`input[data-map-cell="${item}>${target}"]`)]
  .find(i => (i.closest("[data-map-matrix]").dataset.mapMatrix.split("@")[1] || null) === ctx);
