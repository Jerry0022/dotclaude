import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";

// The panel head names the PHASE the session is in: "🧭 Runde N" while
// concepting, "🏁 Abschluss" on the final report (user request in the
// close-out concept, round 3). Runs the reference showIteration() on jsdom.

const md = readTemplates();

function fnSource(name) {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found");
  return m[0];
}
const localeKeys = (src) => src.replace(/\{\{([a-z_.]+)\}\}/g, "$1");

function page({ final = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="panel-head"><span class="panel-here-round" data-here-round></span>
      <button id="panel-here-back" hidden></button></div>
    <div id="panel-here"><span data-here-section></span></div>
    <nav class="iteration-tabs">
      <button class="iteration-tab" data-iteration="1">Runde 1</button>
      <button class="iteration-tab" data-iteration="2" ${final ? "data-final-report" : ""}>${final ? "🏁 Abschlussbericht" : "Runde 2"}</button>
    </nav>
    <div id="panel-ready"></div><div id="panel-submitted"></div><div id="panel-frozen"></div><div id="panel-final-report"></div>
    <div id="content-dimmer" hidden></div><div id="frozen-bar" hidden><strong data-frozen-bar-title></strong></div>
    <main>
      <section data-iteration="1" data-iteration-template="free"></section>
      <section data-iteration="2" data-iteration-template="free" data-active ${final ? "data-final-report" : ""}></section>
    </main></body></html>`, { runScripts: "outside-only" });
  const { window } = dom;
  window.eval(localeKeys([
    "function hideContentDimmer() {}",
    "function lockFrozenView() {}",
    fnSource("stripActiveSuffix"),
    fnSource("resolveIterationTemplate"),
    fnSource("applyIterationTemplate"),
    fnSource("showIteration"),
  ].join("\n")));
  return { window, round: () => window.document.querySelector("[data-here-round]") };
}

describe("panel head — phase icon", () => {
  test("a normal live round reads 🧭 Runde N", () => {
    const p = page();
    p.window.showIteration("2");
    expect(p.round().textContent).toBe("🧭 Runde 2");
    expect(p.round().dataset.phase).toBe("round");
  });

  test("an earlier round keeps the compass and the archived marker", () => {
    const p = page();
    p.window.showIteration("1");
    expect(p.round().textContent).toBe("🧭 Runde 1 · nav.archived");
  });

  test("the final report reads 🏁 Abschluss — never the tab label", () => {
    const p = page({ final: true });
    p.window.showIteration("2");
    expect(p.round().textContent).toBe("🏁 final.phase");
    expect(p.round().dataset.phase).toBe("final");
    expect(p.window.document.body.classList.contains("viewing-final")).toBe(true);
    expect(md).toMatch(/\| `final\.phase`\s+\| Close-out\s+\| Abschluss \|/);
  });
});
