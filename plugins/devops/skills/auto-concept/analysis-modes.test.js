import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { readTemplates, templateParts } from "./templates-source.js";
import cb from "../../scripts/concept-build.js";
import analysis from "../../hooks/lib/concept-gate-analysis.js";

// Analysis presentation (Full + Lite) and the seven decision modes:
// templates-analysis.md is the contract. These tests run the engine's own
// collectModeDecision() on jsdom, push the answers through concept-build's
// bake, and check the gate rules A1-A8 and the independent build fix.

const md = readTemplates();
const { findAnalysisIssues } = analysis;
const fn = name => {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error(name);
  return m[0];
};
const ENGINE = [fn("collectAllFormFields"), fn("collectModeDecision"), fn("collectModeDecisions")].join("\n");
const domOf = html => {
  const w = new JSDOM(`<body>${html}</body>`, { runScripts: "outside-only" }).window;
  w.eval(ENGINE);
  return w;
};

const opt = (id, name, v, checked) => `<label data-opt="${v}"><input type="radio" name="${name}" value="${v}"${checked ? " checked" : ""}></label>`;
const decision = (id, mode, rec, inner, extra = "") => `<section id="${id}" data-nav-label="${id}" data-decision="${id}" data-decision-mode="${mode}" data-label="L-${id}" data-rec="${rec}" data-applies-to="all" data-finding="f-${id}" ${extra}>
  <h3 data-question>Question ${id}?</h3>${inner}
  <textarea data-comment="${id}-note"></textarea>
  <input type="hidden" name="dm-${id}-touched" value="">
  <input type="hidden" name="dm-${id}-issue" value="">
  <input type="hidden" name="dm-${id}-epic" value="">
</section>`;

const MODES = {
  s: decision("s", "single", "b", opt("s", "dm-s", "a") + opt("s", "dm-s", "b", true) + opt("s", "dm-s", "c")),
  m: decision("m", "multi", "x z", ["x", "y", "z"].map(o => `<input type="checkbox" name="dm-m.${o}"${o !== "y" ? " checked" : ""}>`).join("")),
  y: decision("y", "yesnoalt", "yes", opt("y", "dm-y", "yes", true) + opt("y", "dm-y", "no") + opt("y", "dm-y", "alt") + '<input type="text" name="dm-y-alt" value="">'),
  r: decision("r", "slider", "40", '<input type="range" name="dm-r" min="0" max="100" step="5" value="40">'),
  o: decision("o", "order", "a,b,c", '<input type="hidden" name="dm-o" value="a,b,c">'),
  v: decision("v", "verify", "ok", opt("v", "dm-v", "ok", true) + opt("v", "dm-v", "partial") + opt("v", "dm-v", "wrong") + '<input type="text" name="dm-v-fix" value="">'),
  w: decision("w", "wording", "s1", `<label><input type="radio" name="dm-w" value="s1" data-text="Quick wins" checked></label><label><input type="radio" name="dm-w" value="s2" data-text="Fast lane"></label><label><input type="radio" name="dm-w" value="custom"></label><input type="text" name="dm-w-text" value="">`),
};
const ALL = Object.values(MODES).join("\n");
const byId = (w, id) => w.collectModeDecision(w.document.querySelector(`[data-decision="${id}"]`));

describe("contract part is registered in the engine reference", () => {
  test("templates.md lists templates-analysis.md and the joined engine carries the collect code", () => {
    expect(templateParts()).toContain("templates-analysis.md");
    expect(md).toContain("function collectModeDecision(el)");
    expect(md).toContain("data-analysis-briefing");
  });
  test("the three payload branches dispatch mode decisions to collectModeDecision", () => {
    const dec = fn("collectDecisionDecisions");
    expect(dec).toContain("collectModeDecision(el)");
    expect(md.match(/typeof collectModeDecision === 'function'/g).length).toBeGreaterThanOrEqual(3);
  });
});

describe("collectModeDecision — one typed value per mode", () => {
  const w = domOf(ALL);
  test("untouched preselection reports the recommendation as value, untouched: true, deviates: false", () => {
    expect(byId(w, "s")).toMatchObject({ mode: "single", value: "b", rec: "b", deviates: false, untouched: true, note: "", issue: false });
    expect(byId(w, "m").value).toEqual(["x", "z"]);
    expect(byId(w, "y").value).toEqual({ answer: "yes", alt: "" });
    expect(byId(w, "r").value).toBe(40);
    expect(byId(w, "o").value).toEqual(["a", "b", "c"]);
    expect(byId(w, "v")).toMatchObject({ value: "ok", fix: "" });
    expect(byId(w, "w")).toMatchObject({ value: "Quick wins", choice: "s1" });
    for (const id of Object.keys(MODES)) expect(byId(w, id)).toMatchObject({ deviates: false, untouched: true, finding: `f-${id}`, appliesTo: "all" });
  });
  test("changed answers: deviates, typed shapes, note, issue + epic, touched", () => {
    const w2 = domOf(ALL);
    const q = s => w2.document.querySelector(s);
    q('[name="dm-s"][value="c"]').checked = true;
    q('[name="dm-m.y"]').checked = true;
    q('[name="dm-y"][value="alt"]').checked = true; q('[name="dm-y-alt"]').value = "  only on Fridays ";
    q('[name="dm-r"]').value = "65";
    q('[name="dm-o"]').value = "c,a,b";
    q('[name="dm-v"][value="partial"]').checked = true; q('[name="dm-v-fix"]').value = "it is 3, not 5";
    q('[name="dm-w"][value="custom"]').checked = true; q('[name="dm-w-text"]').value = "My own name";
    q('[data-comment="s-note"]').value = " because ";
    q('[name="dm-s-touched"]').value = "1";
    q('[name="dm-s-issue"]').value = "1"; q('[name="dm-s-epic"]').value = "Cache";
    expect(w2.collectModeDecisions(w2.document)).toEqual([
      expect.objectContaining({ id: "s", value: "c", deviates: true, untouched: false, note: "because", issue: true, epic: "Cache" }),
      expect.objectContaining({ id: "m", value: ["x", "y", "z"], deviates: true }),
      expect.objectContaining({ id: "y", value: { answer: "alt", alt: "only on Fridays" }, deviates: true }),
      expect.objectContaining({ id: "r", value: 65, deviates: true }),
      expect.objectContaining({ id: "o", value: ["c", "a", "b"], deviates: true }),
      expect.objectContaining({ id: "v", value: "partial", fix: "it is 3, not 5", deviates: true }),
      expect.objectContaining({ id: "w", value: "My own name", choice: "custom", deviates: true }),
    ]);
  });
  test("an empty slider reports null, a legacy bi-state group is left to the legacy collector", () => {
    const w3 = domOf(decision("e", "slider", "1", '<input type="range" name="dm-e" value="">') + '<div data-decision="legacy"><input type="radio" name="eval-legacy" value="include" checked></div>');
    expect(w3.collectModeDecisions(w3.document).map(d => d.id)).toEqual(["e"]);
  });
});

describe("bake restores every mode into the frozen round", () => {
  const temps = [];
  afterAll(() => temps.forEach(d => fs.rmSync(d, { recursive: true, force: true })));
  const fragment = `<section data-iteration="1" data-iteration-template="decision" data-analysis="full" data-active>\n${ALL}\n</section>`;

  function answered() {
    const w = domOf(fragment);
    const q = s => w.document.querySelector(s);
    q('[name="dm-s"][value="c"]').checked = true;
    q('[name="dm-m.y"]').checked = true; q('[name="dm-m.x"]').checked = false;
    q('[name="dm-y"][value="alt"]').checked = true; q('[name="dm-y-alt"]').value = "later";
    q('[name="dm-r"]').value = "65";
    q('[name="dm-o"]').value = "c,a,b";
    q('[name="dm-v"][value="wrong"]').checked = true; q('[name="dm-v-fix"]').value = "nope";
    q('[name="dm-w"][value="custom"]').checked = true; q('[name="dm-w-text"]').value = "Own";
    q('[data-comment="o-note"]').value = "order note";
    q('[name="dm-o-touched"]').value = "1"; q('[name="dm-s-touched"]').value = "1";
    q('[name="dm-s-issue"]').value = "1"; q('[name="dm-s-epic"]').value = "E";
    return { w, payload: { decisions: w.collectModeDecisions(w.document), allFields: w.collectAllFormFields(w.document) } };
  }

  test("via allFields: bake then collect gives the same typed decisions", () => {
    const { w, payload } = answered();
    const { html } = cb.bake(fragment, payload);
    expect(html).toContain("data-baked");
    expect(domOf(html).collectModeDecisions(domOf(html).document)).toEqual(w.collectModeDecisions(w.document));
  });

  test("via typed decisions only (no allFields): the same values come back", () => {
    const { w, payload } = answered();
    const { html, notes } = cb.bake(fragment, { decisions: payload.decisions });
    expect(notes).toEqual([]);
    const d2 = domOf(html);
    expect(d2.collectModeDecisions(d2.document)).toEqual(w.collectModeDecisions(w.document));
  });

  test("untouched stays untouched; freezing disables the controls and keeps the values", () => {
    const { html } = cb.bake(fragment, { decisions: domOf(fragment).collectModeDecisions(domOf(fragment).document) });
    const d = domOf(html);
    expect(d.collectModeDecisions(d.document).every(x => x.untouched && !x.deviates)).toBe(true);
    const frozen = cb.freezeFragment(html);
    const f = domOf(frozen);
    expect(f.document.querySelector('[name="dm-r"]').disabled).toBe(true);
    expect(f.collectModeDecisions(f.document).map(x => x.value)).toEqual(d.collectModeDecisions(d.document).map(x => x.value));
  });

  test("end to end: a built Full page keeps its answers across a frozen round and passes the gate", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-modes-"));
    temps.push(root);
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
    const dir = path.join(root, "docs", "concepts", "20261013-1200-analysis");
    const home = path.join(root, "home");
    cb.init(dir, { title: "T", subtitle: "Sub", locale: "en", mode: "decision" });
    fs.mkdirSync(path.join(dir, "rounds"), { recursive: true });
    fs.writeFileSync(path.join(dir, "rounds", "01.html"), fullRound(1));
    const first = cb.build(dir, { home });
    expect(first.problems, first.gate).toEqual([]);
    expect(first.ok, first.gate).toBe(true);
    const { payload } = answered();
    cb.bakeRound(dir, 1, payload);
    fs.writeFileSync(path.join(dir, "rounds", "02.html"), fullRound(2));
    const second = cb.build(dir, { home });
    expect(second.ok, second.gate).toBe(true);
    const frozen = new JSDOM(second.html).window.document.querySelector('section[data-iteration="1"]');
    expect(frozen.querySelector('[name="dm-r"]').getAttribute("value")).toBe("65");
    expect(frozen.querySelector('[name="dm-s"][value="c"]').hasAttribute("checked")).toBe(true);
  });
});

const briefing = `<section id="briefing" data-analysis-briefing data-nav-label="Briefing">
  <p data-briefing-what>We measured the hooks.</p><p data-briefing-why>They cost tokens.</p>
  <div data-briefing-potential data-viz="kpi" data-viz-spec='{"value":"51 M"}'>≈ 51 M Tokens</div></section>`;
function fullRound(n, body = ALL, attrs = "") {
  return `<section data-iteration="${n}" data-iteration-template="decision" data-analysis="full" ${n === 1 ? "" : ""}${attrs}>${briefing}<section id="t1" data-topic data-nav-label="Topic">${body}</section></section>`;
}

describe("gate rules A1-A8", () => {
  const kinds = (r, key) => r[key].map(i => i.kind);
  test("a well-formed Full page is clean", () => {
    const r = findAnalysisIssues(fullRound(1));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  test("A1 Full without briefing / without what, why, potential fails", () => {
    expect(kinds(findAnalysisIssues(`<section data-iteration="1" data-analysis="full">${MODES.s}</section>`), "errors")).toContain("briefing-missing");
    const partial = `<section data-iteration="1" data-analysis="full"><section data-analysis-briefing><p data-briefing-what>x</p></section>${MODES.s}</section>`;
    expect(kinds(findAnalysisIssues(partial), "errors")).toEqual(expect.arrayContaining(["briefing-why", "briefing-potential"]));
  });
  test("A2 a decision without data-rec or without the recommendation preselected fails, per mode", () => {
    expect(kinds(findAnalysisIssues(MODES.s.replace(' data-rec="b"', "")), "errors")).toContain("decision-rec");
    expect(kinds(findAnalysisIssues(MODES.s.replace(" checked", "")), "errors")).toContain("decision-preselect");
    expect(kinds(findAnalysisIssues(MODES.s.replace('data-rec="b"', 'data-rec="a"')), "errors")).toContain("decision-preselect");
    expect(kinds(findAnalysisIssues(MODES.m.replace(' checked', "")), "errors")).toContain("decision-preselect");
    expect(kinds(findAnalysisIssues(MODES.r.replace('value="40"', 'value="50"')), "errors")).toContain("decision-preselect");
    expect(kinds(findAnalysisIssues(MODES.o.replace('value="a,b,c"', 'value="c,b,a"')), "errors")).toContain("decision-preselect");
    for (const m of Object.values(MODES)) expect(findAnalysisIssues(m).errors, m).toEqual([]);
  });
  test("A3 unknown mode fails", () => {
    expect(kinds(findAnalysisIssues(MODES.s.replace('"single"', '"triple"')), "errors")).toContain("decision-mode");
  });
  test("A4 more than 3 topics or 7 decisions per topic warns", () => {
    const topic = (i, n) => `<section id="t${i}" data-topic data-nav-label="T${i}">${Array.from({ length: n }, (_, k) => MODES.s.replace(/"s"/g, `"s${i}_${k}"`).replace(/dm-s/g, `dm-s${i}_${k}`).replace(/s-note/g, `s${i}_${k}-note`)).join("")}</section>`;
    const page = n => `<section data-iteration="1" data-analysis="full">${briefing}${n.map((c, i) => topic(i, c)).join("")}</section>`;
    expect(kinds(findAnalysisIssues(page([1, 1, 1, 1])), "warnings")).toContain("topics-max");
    expect(kinds(findAnalysisIssues(page([8])), "warnings")).toContain("topic-decisions-max");
    expect(findAnalysisIssues(page([7, 7, 7])).warnings).toEqual([]);
  });
  test("A5 Lite above five decisions warns", () => {
    const q = k => MODES.s.replace(/"s"/g, `"q${k}"`).replace(/dm-s/g, `dm-q${k}`).replace(/s-note/g, `q${k}-note`);
    expect(kinds(findAnalysisIssues(`<section data-analysis="lite">${[1, 2, 3, 4, 5, 6].map(q).join("")}</section>`), "warnings")).toContain("lite-max");
    expect(findAnalysisIssues(`<section data-analysis="lite">${[1, 2, 3, 4, 5].map(q).join("")}</section>`).warnings).toEqual([]);
  });
  test("A6 a quantitative finding without a visual warns; with a palette visual it does not", () => {
    const l3 = inner => MODES.s.replace("</h3>", `</h3><div data-alevel="3" data-title="x"><div data-slot="long">${inner}</div></div>`);
    expect(kinds(findAnalysisIssues(l3("<p>Saves 31 M tokens, 80 % of hits.</p>")), "warnings")).toContain("finding-visual");
    expect(kinds(findAnalysisIssues(l3('<div data-viz="text"></div><p>Saves 31 M tokens.</p>')), "warnings")).toContain("finding-visual");
    expect(findAnalysisIssues(l3('<div data-viz="bar" data-viz-spec="{}"></div><p>Saves 31 M tokens.</p>')).warnings).toEqual([]);
    expect(findAnalysisIssues(l3("<p>Hooks run before the tool.</p>")).warnings).toEqual([]);
  });
  test("A7 three bi-states in one section on an analysis page warn", () => {
    const bi = k => `<div data-decision="b${k}" data-label="B${k}"><input type="radio" name="eval-b${k}" value="include" checked></div>`;
    expect(kinds(findAnalysisIssues(`${MODES.s}<section id="x" data-nav-label="X">${bi(1)}${bi(2)}${bi(3)}</section>`), "warnings")).toContain("bistate-choice");
    expect(findAnalysisIssues(`${MODES.s}<section id="x" data-nav-label="X">${bi(1)}${bi(2)}</section>`).warnings).toEqual([]);
  });
  test("A8 timing as a decision warns (label or question)", () => {
    expect(kinds(findAnalysisIssues(MODES.s.replace('data-label="L-s"', 'data-label="In welcher Welle umsetzen?"')), "warnings")).toContain("timing-decision");
    expect(kinds(findAnalysisIssues(MODES.s.replace("Question s?", "Wann umsetzen?")), "warnings")).toContain("timing-decision");
    expect(findAnalysisIssues(MODES.s).warnings).toEqual([]);
  });
  test("engine script strings and comments never count as markup; legacy pages are not applicable", () => {
    const page = `<!-- <section data-analysis="full"> --><script>const s = '<section data-analysis="full" data-decision-mode="single">';</script>`;
    expect(findAnalysisIssues(page)).toEqual({ errors: [], warnings: [] });
    expect(findAnalysisIssues('<section data-decision="v1"></section>')).toEqual({ errors: [], warnings: [] });
  });
});

describe("independent fix: mixed / design pages keep the page title and subtitle", () => {
  test("the design skeleton carries a header (hidden only while a design tab is visible)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-header-"));
    try {
      fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
      const dir = path.join(root, "docs", "concepts", "20261013-1200-hdr");
      cb.init(dir, { title: "Title <1>", subtitle: "Sub line", locale: "en", mode: "mixed" });
      fs.mkdirSync(path.join(dir, "rounds"), { recursive: true });
      fs.writeFileSync(path.join(dir, "rounds", "01.html"), fullRound(1));
      const page = cb.assemble({ page: JSON.parse(fs.readFileSync(path.join(dir, "page.json"), "utf8")), head: "", fragments: [{ n: 1, html: fullRound(1) }] });
      const d = new JSDOM(page.html).window.document;
      expect(d.querySelector(".concept-layout.design")).not.toBeNull();
      expect(d.querySelector("[data-page-header] h1").textContent).toBe("Title <1>");
      expect(d.querySelector("[data-page-header] .subtitle").textContent).toBe("Sub line");
      expect(page.html).toContain('html[data-template="design"] [data-page-header] { display: none; }');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
