// Etappen (stages) engine UI — concept 20261028-1650-varianten-struktur,
// rounds 5–6. Runs the reference JS from templates-stages-js.md (plus the
// real showIteration / submitWithAction) on jsdom. The build side injects
// #concept-stages and data-stage; the engine only reads them.
import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";

const md = readTemplates();
const jsSource = [...md.matchAll(/```(?:javascript|js)\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
const localeKeys = (src) => src.replace(/\{\{([a-z_.]+)\}\}/g, "$1");

function fnSource(name) {
  const m = jsSource.match(new RegExp("(?:async )?function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found");
  return m[0];
}
function stagesBlock() {
  const start = jsSource.indexOf("// ── Etappen (stages)");
  const end = jsSource.indexOf("})();", jsSource.indexOf("(function bootStages()"));
  if (start < 0 || end < 0) throw new Error("stages block not found");
  return jsSource.slice(start, end + 5);
}

const STAGES = [
  { id: "A", name: "Use Cases" },
  { id: "B", name: "Struktur" },
  { id: "C", name: "Visuelles Design" },
];

// rounds: [{ n, stage, live, toc: [labels] }]
function page({ stages = STAGES, current = "B", rounds, title = "Hub-Navigation der App", show } = {}) {
  const meta = stages
    ? `<script type="application/json" id="concept-stages">${JSON.stringify({ stages, current, icon: "🧭", title })}</script>`
    : "";
  const secs = rounds.map((r) => `<section data-iteration="${r.n}" data-iteration-template="decision"
      ${r.stage ? `data-stage="${r.stage}"` : ""} ${r.live ? "data-active" : "hidden"}>
      ${(r.toc || []).map((l, i) => `<section id="r${r.n}-s${i}" data-nav-label="${l}"></section>`).join("")}
    </section>`).join("");
  const tabs = rounds.map((r) => `<button class="iteration-tab" data-iteration="${r.n}" ${r.live ? 'aria-selected="true"' : ""}>Runde ${r.n}</button>`).join("");
  const dom = new JSDOM(`<!doctype html><html data-template="decision"><head><title>👉 Hub-Navigation der App</title></head><body>
    ${meta}
    <aside class="concept-decision-panel" id="decision-panel">
      <div class="panel-head"><span class="panel-here-round" data-here-round></span>
        <span class="panel-here-right"><button id="panel-here-back" hidden></button>
          <button id="panel-here-rounds" hidden></button></span></div>
      <div class="panel-here" id="panel-here"><span data-here-section></span></div>
      <div class="panel-nav-scroll"><nav class="iteration-tabs">${tabs}</nav>
        <nav class="section-nav" id="section-nav"></nav></div>
      <div class="panel-status" id="panel-status">
        <div class="journey" id="journey" data-phase="you">
          <span class="jr-toggle jr-round"><button id="submit-iterate-btn">👉 Zur nächsten Runde</button></span>
          <i class="jr-wire jr-wire-a"></i><span class="jr-toggle jr-impl"><button id="jr-lock">🔒</button></span>
          <i class="jr-wire jr-fold"></i><span class="jr-node jr-fold">🤖</span><i class="jr-wire"></i><span class="jr-node">🏁</span>
        </div>
      </div>
    </aside>
    <div id="panel-ready"></div><div id="panel-submitted"></div>
    <div id="content-dimmer" hidden></div><div id="frozen-bar" hidden><strong data-frozen-bar-title></strong></div>
    <script type="application/json" id="concept-decisions"></script>
    <main>${secs}</main></body></html>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  window.eval(localeKeys([
    "var submitted = [];",
    "function hideContentDimmer() {}",
    "function lockFrozenView() {}",
    "function journeyPhase() { return 'you'; }",
    "function submitWithAction(action, extra) { submitted.push([action, extra]); }",
    fnSource("stripActiveSuffix"),
    fnSource("resolveIterationTemplate"),
    fnSource("applyIterationTemplate"),
    fnSource("showIteration"),
    stagesBlock(),
  ].join("\n")));
  if (window.document.readyState === "loading") window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  const live = rounds.find((r) => r.live);
  window.showIteration(String(show || live.n));
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  return { window, $, $$ };
}

const STAGED = [
  { n: 1, stage: "A", toc: ["Ausgangslage", "UC 1 · Anmelden"] },
  { n: 2, stage: "A", toc: ["Rückblick Runde 1", "UC 4 · Offline lesen"] },
  { n: 3, stage: "B", toc: ["Hub"] },
  { n: 4, stage: "B", live: true, toc: ["Hub", "Übergang"] },
];

describe("Etappen — staged concept", () => {
  test("structure button + tab row, the current Etappe open", () => {
    const p = page({ rounds: STAGED });
    const btn = p.$("#stage-struct");
    expect(btn, "structure button rendered").toBeTruthy();
    expect(btn.hasAttribute("title")).toBe(false);
    expect(btn.dataset.tip).toBe("stage.kind_doc\nstage.label B · iteration.tab 4");
    expect(btn.querySelectorAll(".stage-gly u").length).toBe(3);
    const tabs = p.$$("#stage-tabs .stage-tab");
    expect(tabs.map((t) => t.dataset.stageId)).toEqual(["A", "B", "C"]);
    expect(tabs.map((t) => t.dataset.state)).toEqual(["done", "now", "ahead"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[0].tabIndex).toBe(-1);
    expect(p.$("#stage-tabs").previousElementSibling.id, "directly under the head block").toBe("panel-here");
    expect(p.$(".panel-nav-scroll").dataset.stageView).toBeUndefined();
    expect(p.$("#stage-pane").hidden).toBe(true);
    // The current Etappe's earlier round sits behind its own 🕘.
    expect(p.$("#stage-cur-older .stage-older-btn")).toBeTruthy();
    expect(p.window.document.body.hasAttribute("data-staged")).toBe(true);
  });

  test("head names the concept; the round moves into the nav", () => {
    const p = page({ rounds: STAGED });
    expect(p.$("[data-here-round]").textContent).toBe("🧭 Hub-Navigation der App");
    expect(p.$("[data-here-round]").dataset.tip).toBe("🧭 Hub-Navigation der App");
    const row = p.$("#panel-round-row");
    expect(row.hidden).toBe(false);
    expect(row.textContent).toBe("iteration.tab 4");
  });

  test("tabs: arrow keys move focus, Enter opens", () => {
    const p = page({ rounds: STAGED });
    const tabs = () => p.$$("#stage-tabs .stage-tab");
    tabs()[1].focus();
    const key = (k) => p.window.document.activeElement.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("ArrowLeft");
    expect(p.window.document.activeElement.dataset.stageId).toBe("A");
    key("Enter");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(p.$(".panel-nav-scroll").dataset.stageView).toBe("other");
  });

  test("finished Etappe: newest round's TOC + 🕘 for the earlier ones", () => {
    const p = page({ rounds: STAGED });
    p.$$("#stage-tabs .stage-tab")[0].click();
    const pane = p.$("#stage-pane");
    expect(pane.hidden).toBe(false);
    const top = pane.querySelector(":scope > .stage-round");
    expect(top.textContent).toBe("iteration.tab 2");
    expect([...pane.querySelectorAll(":scope > .stage-toc .stage-ti")].map((b) => b.textContent))
      .toEqual(["Rückblick Runde 1", "UC 4 · Offline lesen"]);
    expect(pane.textContent, "no counters").not.toMatch(/summary_entries|Einträge/);
    const older = pane.querySelector(".stage-older-btn");
    expect(older.getAttribute("aria-expanded")).toBe("false");
    expect(older.querySelector(".stage-older-chip").textContent.trim()).toBe("🕘 1");
    expect(pane.querySelector(".stage-older").hidden).toBe(true);
    older.click();
    expect(older.getAttribute("aria-expanded")).toBe("true");
    expect(pane.querySelector(".stage-older .stage-round").textContent).toBe("iteration.tab 1");
    // A jump goes through showIteration: round 1 becomes the visible (frozen) round.
    pane.querySelector(".stage-older .stage-round").click();
    expect(p.$('section[data-iteration="1"]').hidden).toBe(false);
  });

  test("an Etappe not reached yet shows one quiet line", () => {
    const p = page({ rounds: STAGED });
    p.$$("#stage-tabs .stage-tab")[2].click();
    expect(p.$("#stage-pane .stage-ahead").textContent).toBe("stage.ahead");
  });

  test("frozen round keeps today's head", () => {
    const p = page({ rounds: STAGED, show: 1 });
    expect(p.$("[data-here-round]").textContent).toBe("🧭 Runde 1 · nav.archived");
    expect(p.$("[data-here-round]").dataset.phase).toBe("round");
    expect(p.$("#panel-round-row").hidden).toBe(true);
    expect(p.$$("#stage-tabs .stage-tab")[0].getAttribute("aria-selected"), "the viewed round's Etappe").toBe("true");
  });

  test("Nächste Etappe › replaces 🔒 · 🤖 · 🏁 and submits next-stage", () => {
    const p = page({ rounds: STAGED });
    const btn = p.$("#jr-next-stage");
    expect(btn).toBeTruthy();
    expect(p.window.document.body.hasAttribute("data-stage-next")).toBe(true);
    expect(btn.previousElementSibling.classList.contains("jr-wire-a")).toBe(true);
    expect(btn.textContent).toBe("stage.next ›");
    expect(btn.dataset.tip).toBe("stage.next_tip".replace("{next}", "C"));
    btn.click();
    expect(p.window.eval("submitted")).toEqual([["next-stage", { stage: "B", next: "C" }]]);
  });

  test("last Etappe: the journey row is exactly today's", () => {
    const rounds = [{ n: 1, stage: "A" }, { n: 2, stage: "B" }, { n: 3, stage: "C", live: true }];
    const p = page({ rounds, current: "C" });
    expect(p.$("#jr-next-stage")).toBeNull();
    expect(p.window.document.body.hasAttribute("data-stage-next")).toBe(false);
    expect(p.$("#jr-lock")).toBeTruthy();
  });
});

describe("Etappen — concept without stages", () => {
  const rounds = [{ n: 1 }, { n: 2, live: true, toc: ["Kontext"] }];
  test("no tab row, no structure button, no next-stage station", () => {
    const p = page({ stages: null, rounds });
    expect(p.$("#stage-tabs")).toBeNull();
    expect(p.$("#stage-struct")).toBeNull();
    expect(p.$("#stage-pane")).toBeNull();
    expect(p.$("#jr-next-stage")).toBeNull();
    expect(p.window.document.body.hasAttribute("data-staged")).toBe(false);
  });
  test("head shows icon + concept title (from the page title), round row in the nav", () => {
    const p = page({ stages: null, rounds });
    expect(p.$("[data-here-round]").textContent).toBe("🧭 Hub-Navigation der App");
    expect(p.$("#panel-round-row").textContent).toBe("iteration.tab 2");
  });
});

describe("Etappen — submit path", () => {
  test("submitWithAction merges {stage, next} into the payload", async () => {
    const dom = new JSDOM(`<!doctype html><body><script type="application/json" id="concept-decisions"></script>
      <div id="panel-ready"></div><div id="panel-submitted"></div></body>`, { runScripts: "outside-only", url: "http://localhost/" });
    const w = dom.window;
    w.eval(localeKeys([
      "var _submitInFlight = false, _submittedAt = 0, _userInteracted = true, _bootReloadCounter = 1, _submittedReloadCounter = null, _submittedAction = null, STORAGE_KEY = 'k';",
      "function collectDecisions(action) { return { submitted: true, action: action, iteration: '4' }; }",
      "function showContentDimmer() {} function resetStatusSteps() {} function showSubmitWarning() {} function _guardedSetItem() {}",
      "window.fetch = () => new Promise(() => {});",
      fnSource("submitWithAction"),
    ].join("\n")));
    w.submitWithAction("next-stage", { stage: "B", next: "C" });
    const sent = JSON.parse(w.document.getElementById("concept-decisions").textContent);
    expect(sent).toMatchObject({ action: "next-stage", stage: "B", next: "C", iteration: "4" });
    expect(w.eval("_submittedAction")).toBe("next-stage");
  });
});
