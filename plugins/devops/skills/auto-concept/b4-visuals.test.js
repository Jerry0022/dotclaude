import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";
import fixture from "../../scripts/build-concept-fixture.js";

// B4: the Fertig step ends in next-round + implement (two-click unlock) through the dock's submit buttons.
// Analysis UI (templates-analysis.md § Styling / Engine UI): the CONCEPT_VIZ
// palette, touched tracking (>= 3 s open writes dm-{id}-touched), the
// choreography counter, the keyboard flow, the order widget and the TOC state
// of mode decisions — all on jsdom with the engine's own code.

const md = readTemplates();
const blocks = fixture.scanBlocks(md);
const UI = blocks.find(b => /javascript|js/.test(b.info) && b.code.includes("window.conceptAnalysis = {")).code;
const CSS = blocks.find(b => b.info === "css" && b.code.includes("--an-bg")).code;
const fn = name => {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error(name);
  return m[0];
};
const COLLECT = [fn("collectModeDecision"), fn("collectModeDecisions")].join("\n");

const opt = (id, v, label, checked) => `<label data-opt="${v}"><input type="radio" name="dm-${id}" value="${v}"${checked ? " checked" : ""}><span data-opt-label>${label}</span><span data-opt-consequence>${label} follows</span></label>`;
const tail = id => `<textarea data-comment="${id}-note"></textarea><input type="hidden" name="dm-${id}-touched" value=""><input type="hidden" name="dm-${id}-issue" value=""><input type="hidden" name="dm-${id}-epic" value="">`;
const l3 = t => `<div data-alevel="3" data-title="${t}"><div data-slot="short"><p>s</p></div><div data-slot="long"><p>l</p></div></div>`;
const decision = (id, mode, rec, inner, extra = "") =>
  `<section id="${id}" data-nav-label="${id}" data-decision="${id}" data-decision-mode="${mode}" data-label="L-${id}" data-rec="${rec}" data-rec-why="because" ${extra}><h3 data-question>Q ${id}?</h3><div data-options>${inner}</div>${tail(id)}${l3("T-" + id)}</section>`;
const LITE = `<section data-analysis="lite" data-nav-label="Lite" id="lite">
  <div data-alevel="1" data-title="Overall"><div data-slot="short"><p>x</p></div><div data-slot="long"><p>y</p></div></div>
  ${decision("q1", "single", "a", opt("q1", "a", "Alpha", true) + opt("q1", "b", "Beta"))}
  ${decision("q2", "order", "x,y", '<div data-opt="x"><span data-opt-label>X</span></div><div data-opt="y"><span data-opt-label>Y</span></div>').replace("</div>" + tail("q2"), '</div><input type="hidden" name="dm-q2" value="x,y">' + tail("q2"))}
</section>`;

function page(html, { lang = "en", store = {} } = {}) {
  const dom = new JSDOM(`<html lang="${lang}"><body>${html}<nav id="section-nav"></nav></body></html>`, {
    url: "http://localhost/concept.html", runScripts: "outside-only", pretendToBeVisual: true
  });
  const w = dom.window;
  const timers = [];
  w.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  w.clearTimeout = () => {};
  Object.entries(store).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };   // "visible"
  w.eval(COLLECT);
  w.eval(UI);
  w.conceptAnalysis.init();
  return { w, timers, ca: w.conceptAnalysis, doc: w.document };
}


describe("deselect, untouched, answered, list icon", () => {
  const radios = (doc, id) => [...doc.querySelectorAll(`#${id} [data-options] input[type=radio]`)];
  const touched = (doc, id) => doc.querySelector(`input[name="dm-${id}-touched"]`).value;
  test("clicking the selected card again clears the choice; empty note => untouched again", () => {
    const { doc, ca } = page(LITE);
    const inst = ca.instances[0];
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec"));
    const [a, b] = radios(doc, "q1");
    expect(a.checked).toBe(true);
    b.click();
    expect(touched(doc, "q1")).toBe("1");
    b.click();
    expect(radios(doc, "q1").some(r => r.checked)).toBe(false);
    expect(touched(doc, "q1")).toBe("");
    expect(doc.querySelector("#q1").classList.contains("an-stage")).toBe(true);
  });
  test("a note alone counts when nothing is picked; clearing it makes the question untouched", () => {
    const { doc, ca } = page(LITE);
    const inst = ca.instances[0];
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec"));
    const [a] = radios(doc, "q1");
    a.click();                                   // deselect the recommendation
    expect(touched(doc, "q1")).toBe("");
    const note = doc.querySelector("#q1 .an-note");
    note.value = "only a note";
    note.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
    expect(touched(doc, "q1")).toBe("1");
    note.value = "";
    note.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
    expect(touched(doc, "q1")).toBe("");
  });
  test("the 3 s dwell does not touch a deselected question", () => {
    const { doc, ca, timers } = page(LITE);
    const inst = ca.instances[0];
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec"));
    radios(doc, "q1")[0].click();
    timers.length = 0;
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec"));
    timers.filter(t => t.ms === ca.TOUCH_MS).forEach(t => t.f());
    expect(touched(doc, "q1")).toBe("");
  });
  test("a lite view is answered only when every decision is touched, never by paging through it", () => {
    const { doc, ca } = page(LITE);
    const inst = ca.instances[0];
    expect(typeof inst.root.__anAnswered).toBe("function");
    inst.root.click();
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec"));
    ca.step(inst, 1);
    ca.step(inst, -1);
    expect(inst.root.__anAnswered()).toBe(false);
    ca.markTouched(doc.getElementById("q1"));
    expect(inst.root.__anAnswered()).toBe(false);
    ca.markTouched(doc.getElementById("q2"));
    expect(inst.root.__anAnswered()).toBe(true);
  });
  test("the design overview asks the analysis view before its own interaction heuristics", () => {
    expect(md).toMatch(/function viewAnswered\(v\) \{[\s\S]*?v\.__anAnswered[\s\S]*?v\.dataset\.interacted/);
  });
  test("All as list: one icon in the header row, no text link in the bars; the lite round has the list stage", () => {
    const { doc, ca } = page(LITE);
    const inst = ca.instances[0];
    const icon = inst.stepEl.querySelector(".an-listbtn");
    expect(icon).toBeTruthy();
    expect(icon.querySelector("svg")).toBeTruthy();
    expect(doc.querySelector(".an-foot .an-link[data-tip*='list' i]")).toBeNull();
    expect(inst.root.textContent).not.toMatch(/All as list/);
    icon.click();
    expect(inst.stages[inst.idx].kind).toBe("list");
    ca.step(inst, 1);                           // aux stage: back to where it came from
    expect(inst.stages[inst.idx].kind).not.toBe("list");
  });
});

describe("Fertig step — next round / implement beside Look again", () => {
  const done = () => {
    const { w, ca, doc } = page(LITE + '<button id="submit-iterate-btn">i</button><button id="submit-implement-btn">m</button>');
    const hits = [];
    doc.getElementById("submit-iterate-btn").addEventListener("click", () => hits.push("iterate"));
    doc.getElementById("submit-implement-btn").addEventListener("click", () => hits.push("implement"));
    const inst = ca.instances[0];
    const idx = inst.stages.findIndex(s => s.kind === "done");
    ca.go(inst, idx);
    return { w, doc, hits, root: inst.root };
  };
  test("Look again stays bottom left; both actions are FAB-style pills bottom right and no Weiter button is left", () => {
    const { root } = done();
    const foot = root.querySelector(".an-fin .an-foot");
    expect(foot.querySelector(".an-quiet .an-btn2")).toBeTruthy();
    expect([...foot.querySelectorAll(".an-go .an-fabs .an-fab")].map(b => b.dataset.anAct)).toEqual(["iterate", "implement"]);
    expect(foot.querySelector(".an-btn")).toBeNull();
  });
  test("next round is one click on the dock's iterate button", () => {
    const { root, hits } = done();
    root.querySelector('[data-an-act="iterate"]').click();
    expect(hits).toEqual(["iterate"]);
  });
  test("implement needs two clicks: the first only arms, the second submits", () => {
    const { root, hits, w } = done();
    const b = root.querySelector('[data-an-act="implement"]');
    b.click();
    expect(hits).toEqual([]);
    expect(b.dataset.armed).toBe("true");
    b.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(b.dataset.armed).toBe("false");
    b.click(); b.click();
    expect(hits).toEqual(["implement"]);
    expect(b.dataset.armed).toBe("false");
  });
});

describe("one veil: re-armed by the menu, never stacked with the backdrop", () => {
  test("journey JS re-arms through lockFrozenView on panel-open; design CSS clears the dimmer while it is open", () => {
    expect(md).toMatch(/rearmVeilOnMenuOpen[\s\S]*?!wasOpen[\s\S]*?lockFrozenView\(\)/);
    expect(md).toMatch(/body\.panel-open #content-dimmer \{ background: transparent/);
  });
});
