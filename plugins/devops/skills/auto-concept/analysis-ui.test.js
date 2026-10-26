import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";
import fixture from "../../scripts/build-concept-fixture.js";

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

describe("CONCEPT_VIZ palette", () => {
  const draw = (type, spec, size) => {
    const { w, ca, doc } = page('<div id="host"></div>');
    const el = doc.createElement("div");
    el.setAttribute("data-viz", type);
    el.setAttribute("data-viz-spec", typeof spec === "string" ? spec : JSON.stringify(spec));
    el.textContent = "authored fallback";
    doc.body.appendChild(el);
    ca.renderViz(doc.body, size || "long");
    return { el, w };
  };
  test("registers the eight core types", () => {
    const { w } = page("");
    for (const t of ["text", "kpi", "bar", "bars", "spark", "donut", "compare", "flow"]) expect(typeof w.CONCEPT_VIZ[t], t).toBe("function");
  });
  test("every core type renders from its spec", () => {
    expect(draw("kpi", { value: "51 M", unit: "Tokens", delta: "-12 %" }).el.querySelector(".an-kpi-v").textContent).toBe("51 M");
    expect(draw("bar", { value: 80, max: 100, unit: "%", label: "hits" }).el.querySelector(".an-bar-t > i").style.width).toBe("80%");
    expect(draw("bars", { items: [{ label: "A", value: 30 }, { label: "B", value: 15 }], unit: "M" }).el.querySelectorAll(".an-bars > div")).toHaveLength(2);
    expect(draw("bars", { items: [1, 2, 3, 4, 5].map(i => ({ label: "i" + i, value: i })) }, "short").el.querySelectorAll(".an-bars > div")).toHaveLength(3);
    expect(draw("spark", { points: [3, 5, 4, 8], label: "tokens" }).el.querySelector("svg path")).not.toBeNull();
    expect(draw("donut", { parts: [{ label: "a", value: 60 }, { label: "b", value: 40 }] }).el.querySelectorAll("li")).toHaveLength(2);
    expect(draw("compare", { before: { label: "was", value: 10 }, after: { label: "now", value: 4 }, unit: "s" }).el.querySelector(".an-cmp-d").textContent).toBe("-60 %");
    expect(draw("flow", { steps: [{ label: "a", value: "1" }, { label: "b" }] }).el.querySelectorAll(".an-flow > span")).toHaveLength(2);
    expect(draw("text", { text: "one\n- two\n- three" }).el.querySelectorAll("li")).toHaveLength(2);
  });
  test("unknown type renders spec.text; an unparsable spec keeps the authored text", () => {
    const kept = draw("hologram", { text: "plain words" }).el;
    expect(kept.textContent).toBe("authored fallback");   // non-empty custom markup is left alone
    const { w, ca, doc } = page("");
    const bare = doc.createElement("div");
    bare.setAttribute("data-viz", "hologram");
    bare.setAttribute("data-viz-spec", '{"text":"plain words"}');
    doc.body.appendChild(bare);
    ca.renderViz(doc.body);
    expect(bare.textContent).toBe("plain words");
    expect(w.CONCEPT_VIZ.hologram).toBeUndefined();
    expect(draw("kpi", "{not json").el.textContent).toBe("authored fallback");
  });
  test("spec values are escaped", () => {
    const { el } = draw("kpi", { value: "<img src=x onerror=alert(1)>" });
    expect(el.querySelector("img")).toBeNull();
  });
});

describe("touched tracking", () => {
  test("a stage open for 3 s writes dm-{id}-touched = 1 and fires change", () => {
    const { doc, ca, timers } = page(LITE);
    const inst = ca.instances[0];
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec"));
    const c = doc.querySelector('[name="dm-q1-touched"]');
    expect(c.value).toBe("");
    let changes = 0;
    c.addEventListener("change", () => changes++);
    const t = timers.filter(x => x.ms === ca.TOUCH_MS).pop();
    expect(t).toBeTruthy();
    t.f();
    expect(c.value).toBe("1");
    expect(changes).toBe(1);
    expect(doc.defaultView.collectModeDecision(doc.querySelector("#q1")).untouched).toBe(false);
  });
  test("a change in the stage touches it at once; leaving early leaves it untouched", () => {
    const { doc, ca } = page(LITE);
    const inst = ca.instances[0];
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec"));
    expect(doc.querySelector('[name="dm-q2-touched"]').value).toBe("");
    const b = doc.querySelector('input[name="dm-q1"][value="b"]');
    b.checked = true;
    b.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
    expect(doc.querySelector('[name="dm-q1-touched"]').value).toBe("1");
    ca.step(inst, 1);
    expect(doc.querySelector('[name="dm-q2-touched"]').value).toBe("");
  });
  test("no timer for a baked (frozen) round", () => {
    const { ca, timers } = page('<div data-baked>' + LITE + "</div>");
    const inst = ca.instances[0];
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec"));
    expect(timers.filter(x => x.ms === ca.TOUCH_MS)).toHaveLength(0);
  });
});

describe("choreography duration", () => {
  test("about 1 s the first two times per page, 0.3 s afterwards, count in localStorage", () => {
    const { ca, w } = page(LITE);
    expect(ca.transMs()).toBe(1000);
    const inst = ca.instances[0];
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec"));   // L3 slides in: counted
    ca.go(inst, inst.stages.findIndex(s => s.kind === "dec") + 1);   // next decision: a fresh L3 slides in again
    expect(Number(w.localStorage.getItem(Object.keys(w.localStorage).find(k => k.startsWith("concept-an-transitions"))))).toBeGreaterThanOrEqual(2);
    expect(ca.transMs()).toBe(300);
  });
  test("a broken localStorage never throws", () => {
    const { ca, w } = page("");
    w.Storage.prototype.getItem = () => { throw new Error("denied"); };
    expect(() => ca.transMs()).not.toThrow();
  });
  test("the stylesheet honours prefers-reduced-motion", () => {
    expect(CSS).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
  });
});

describe("keyboard and widgets", () => {
  test("Enter / Shift+Enter walk the stages", () => {
    const { w, doc, ca } = page(LITE);
    const inst = ca.instances[0];
    const stage = inst.stages[inst.idx].el;
    const press = (key, shiftKey) => stage.dispatchEvent(new w.KeyboardEvent("keydown", { key, shiftKey: !!shiftKey, bubbles: true, cancelable: true }));
    expect(inst.stages[inst.idx].kind).toBe("start");
    press("Enter");
    expect(inst.stages[inst.idx].kind).toBe("dec");
    press("2");                                                  // option 2 of the focused decision
    expect(doc.querySelector('input[name="dm-q1"][value="b"]').checked).toBe(true);
    press("Enter", true);
    expect(inst.stages[inst.idx].kind).toBe("start");
  });
  test("the recommended option is badged, preselected and carries its reason", () => {
    const { doc } = page(LITE);
    const o = doc.querySelector('[data-decision="q1"] [data-opt="a"]');
    expect(o.querySelector("input").checked).toBe(true);
    expect(o.querySelector(".an-badge").getAttribute("data-tip")).toContain("because");
    expect(o.getAttribute("data-tip-key")).toBe("1");
  });
  test("ONE note field per decision and the issue link writes the named controls", () => {
    const { doc, ca } = page(LITE);
    const q1 = doc.querySelector("#q1");
    expect(q1.querySelectorAll("textarea")).toHaveLength(1);
    const link = [...q1.querySelectorAll("button.an-link")].find(b => /issue/i.test(b.textContent));
    link.click();
    expect(doc.querySelector('[name="dm-q1-issue"]').value).toBe("1");
    const epic = q1.querySelector(".an-epic");
    epic.value = "Perf";
    epic.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
    expect(doc.querySelector('[name="dm-q1-epic"]').value).toBe("Perf");
    expect(ca.instances[0].decs.length).toBe(2);
  });
  test("the order widget renders from the hidden control and writes it back", () => {
    const { doc } = page(LITE);
    const items = () => [...doc.querySelectorAll("#q2 .an-oi")].map(li => li.dataset.id);
    expect(items()).toEqual(["x", "y"]);
    doc.querySelector("#q2 .an-oi .an-ob button:last-child").click();   // move x down
    expect(doc.querySelector('[name="dm-q2"]').value).toBe("y,x");
    expect(items()).toEqual(["y", "x"]);
    expect(doc.defaultView.collectModeDecision(doc.querySelector("#q2")).value).toEqual(["y", "x"]);
  });
});

describe("section nav state for mode decisions", () => {
  test("shows open / decided / issue dots instead of include / discard", () => {
    const { w, doc } = page(LITE);
    w.eval(fn("updateSectionNavState"));
    const nav = doc.getElementById("section-nav");
    nav.innerHTML = '<a class="section-nav-item" data-variant data-section-id="q1"><span class="section-nav-state"></span></a>';
    const state = () => nav.querySelector(".section-nav-state");
    w.updateSectionNavState();
    expect(state().className).toBe("section-nav-state state-open");
    expect(state().textContent).toContain("○");
    doc.querySelector('[name="dm-q1-touched"]').value = "1";
    w.updateSectionNavState();
    expect(state().className).toBe("section-nav-state state-decided");
    doc.querySelector('[name="dm-q1-issue"]').value = "1";
    w.updateSectionNavState();
    expect(state().className).toBe("section-nav-state state-issue");
  });
});

describe("palette and stage CSS", () => {
  test("every analysis rule is namespaced; topic colours avoid red / green / orange", () => {
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/(?:^|[};])\s*([^{};@]+)\{/g)].map(m => m[1].trim()).filter(s => s && !/^(from|to|\d+%)/.test(s));
    const splitTop = s => { const out = []; let d = 0, cur = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(cur.trim()); cur = ""; } else cur += ch; } out.push(cur.trim()); return out; };
    const offenders = rules.flatMap(splitTop).filter(s => s && !/(\.an-|data-analysis|\.section-nav-state|\[data-viz\]|section\[data-view\])/.test(s));
    expect(offenders.filter(s => !/^\.(app-|panel|concept|feedback)/.test(s) || true)).toEqual([]);
    const colors = UI.match(/const TOPIC_COLORS = \[([^\]]+)\]/)[1].match(/#[0-9a-f]{6}/gi);
    for (const hex of colors) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      const hue = (() => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; })();
      expect(hue >= 170 && hue <= 330, hex + " hue " + Math.round(hue)).toBe(true);
    }
  });
  test("the design view kind analysis is styled and the engine stays one instance per root", () => {
    expect(CSS).toContain('section[data-view][data-view-kind="analysis"]');
    const { ca, doc } = page(LITE);
    ca.init(doc);
    expect(ca.instances).toHaveLength(1);
  });
});
