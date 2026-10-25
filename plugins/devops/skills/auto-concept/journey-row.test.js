// Journey row + status line + status toast (concept 2026-10-23 chrome polish,
// sections A and B). The panel foot is one row — round toggle, lock, 🤖, 🏁 —
// plus one status line; the toast is the same pill. These tests run the
// reference JS from the templates on jsdom.
import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";

const md = readTemplates();
const jsSource = [...md.matchAll(/```(?:javascript|js)\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
const cssSource = [...md.matchAll(/```css\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");

function fnSource(name) {
  const m = jsSource.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found");
  return m[0];
}
function constLine(name) {
  const m = jsSource.match(new RegExp("^(?:const|let) " + name + "\\b[^\\n]*", "m"));
  if (!m) throw new Error(name + " not found");
  return m[0];
}
// {{panel.x}} → "panel.x" so assertions can name the key.
const localeKeys = (src) => src.replace(/\{\{([a-z_.]+)\}\}/g, "$1");

function page({ round = "3", conn = "connected" } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <section data-iteration="${round}" data-active></section>
    <div class="panel-status" id="panel-status" data-status="connecting">
      <div id="connection-status" class="status-line" data-state="${conn}">
        <span class="status-glyph"></span><span class="conn-label"></span>
      </div>
      <details class="status-detail" id="status-detail" hidden>
        <summary><span class="status-dots" id="status-dots"></span></summary>
        <ol class="status-steps" id="status-steps">
          <li data-step="submitted" data-state="done"><span class="step-icon"></span><span class="step-label">Übermittelt</span></li>
          <li data-step="received" data-state="active"><span class="step-icon"></span><span class="step-label">In Arbeit</span></li>
          <li data-step="reality-check" data-state="pending" hidden><span class="step-icon"></span><span class="step-label">RC</span></li>
          <li data-step="implemented" data-state="pending" hidden><span class="step-icon"></span>
            <span class="step-label" data-state-label="active">läuft</span></li>
        </ol>
      </details>
    </div>
    <div class="panel-cta"><div id="panel-ready">
      <div class="submit-split">
        <button id="submit-iterate-btn" class="primary submit-btn"><span class="submit-label">Next</span></button>
        <button type="button" id="submit-menu-btn"></button>
      </div>
      <div id="submit-menu" class="submit-menu" role="menu" hidden>
        <button id="submit-implement-btn" class="implement-btn" role="menuitem">impl</button>
      </div>
    </div></div>
  </body>`, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  window.eval(localeKeys([
    "var _submittedAt = 0, _submittedAction = null, _draftPhase = 'saved', STORAGE_KEY = 'concept-state-t';",
    "function _guardedSetItem(k, v) { localStorage.setItem(k, v); }",
    constLine("_JR_CHK"),
    "let _journeyUnlocked = false, _journeyProgress = null, _journeyDone = false;",
    "let _toastShow = false, _toastMode = null, _toastDoneMs = 0, _toastDoneTimer = null;",
    ...["_jrEl", "buildRunBar", "journeyCounter", "paintRunBar", "journeyPhase", "mountJourney",
      "setJourneyUnlocked", "renderJourney", "renderPanelStatus", "renderStatusDots", "_stepEl", "_setStep",
      "resetStatusSteps", "updateStatusSteps", "_liveRound", "_ensureStatusToast", "renderSubmittedToast",
      "refreshStatusToast", "maybeShowNewRoundToast"].map(fnSource),
  ].join("\n")));
  window.mountJourney();
  const $ = (s) => window.document.querySelector(s);
  const submit = (action) => {
    window.eval(`_submittedAt = Date.now(); _submittedAction = '${action}'; resetStatusSteps('${action}'); renderPanelStatus();`);
  };
  return { window, $, submit };
}

describe("journey row — markup and phases", () => {
  test("mount adopts both submit buttons, retires the split + menu, keeps their ids", () => {
    const p = page();
    const row = p.$("#journey");
    expect(row).toBeTruthy();
    expect(row.parentElement.id).toBe("panel-status");
    expect(row.nextElementSibling.id, "row sits above the status line").toBe("connection-status");
    expect(p.$(".jr-round #submit-iterate-btn")).toBeTruthy();
    expect(p.$(".jr-impl #submit-implement-btn")).toBeTruthy();
    expect(p.$("#submit-implement-btn").hasAttribute("role")).toBe(false);
    expect(p.$(".submit-split").hidden).toBe(true);
    expect(p.$("#submit-menu").hidden).toBe(true);
    // round toggle, wire, lock toggle, wire, 🤖, wire, 🏁
    expect(row.children.length).toBe(7);
    expect(row.lastElementChild.textContent).toBe("🏁");
    expect(row.lastElementChild.dataset.tip).toBe("panel.journey_finish");
    expect(p.$("#jr-lock").dataset.tip).toBe("panel.journey_lock");
    expect(row.dataset.phase).toBe("you");
    expect(p.window.document.body.dataset.journey).toBe("you");
  });

  test("lock unlocks, ↩ reverts; faces swap via [data-on]", () => {
    const p = page();
    const on = (s) => p.$(s).hasAttribute("data-on");
    expect(on(".jr-face-full") && on(".jr-face-lock")).toBe(true);
    p.$("#jr-lock").click();
    expect(p.$("#journey").dataset.phase).toBe("unlock");
    expect(on(".jr-face-mini") && on(".jr-face-impl")).toBe(true);
    expect(on(".jr-face-full") || on(".jr-face-lock")).toBe(false);
    expect(p.$("#jr-back").tabIndex).toBe(0);
    p.$("#jr-back").click();
    expect(p.$("#journey").dataset.phase).toBe("you");
    p.$("#jr-lock").click();
    p.$("#journey").dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(p.$("#journey").dataset.phase, "Escape reverts").toBe("you");
  });

  test("iterate submit → rethinking: ✓ + bar with x/y from the visible steps, lock disabled", () => {
    const p = page();
    p.submit("iterate");
    expect(p.$("#journey").dataset.phase).toBe("rethinking");
    expect(p.$("#submit-iterate-btn").hidden).toBe(true);
    expect(p.$(".jr-round-run").hidden).toBe(false);
    expect(p.$(".jr-round-run .jr-count").textContent).toBe("1/2");
    expect(p.$(".jr-round-run .jr-count").dataset.tip).toBe("panel.journey_step");
    expect(p.$("#jr-lock").disabled).toBe(true);
    p.window._setStep("received", "done", "✓");
    expect(p.$(".jr-round-run .jr-count").textContent).toBe("2/2");
  });

  test("unlock cannot be toggled while a round is in flight", () => {
    const p = page();
    p.submit("iterate");
    p.window.setJourneyUnlocked(true);
    expect(p.$("#journey").dataset.phase).toBe("rethinking");
  });

  test("implement submit → implementing: indeterminate without progress, n/m with it", () => {
    const p = page();
    p.$("#jr-lock").click();
    p.submit("implement");
    expect(p.$("#journey").dataset.phase).toBe("implementing");
    const run = p.$(".jr-impl-run");
    expect(run.hasAttribute("data-indeterminate")).toBe(true);
    expect(run.querySelector(".jr-count").textContent).toBe("");
    p.window.updateStatusSteps({ _picked_up_at: "t", _progress: { done: 3, total: 7 } });
    expect(run.hasAttribute("data-indeterminate")).toBe(false);
    expect(run.querySelector(".jr-count").textContent).toBe("3/7");
    expect(run.querySelector(".jr-run-done").style.width).toBe("43%");
    p.window.updateStatusSteps({ _phase: "implemented", _progress: { done: 7, total: 7 } });
    expect(run.querySelector(".jr-count").textContent).toBe("7/7");
    expect(p.$(".jr-wire-a").hasAttribute("data-ok")).toBe(true);
    expect(p.$("#jr-back").disabled, "the done mini toggle is not a button any more").toBe(true);
  });
});

describe("status line — turn + save state", () => {
  const line = (p) => [p.$(".status-glyph").textContent, p.$(".status-turn").textContent, p.$(".conn-label").textContent];
  test("user's turn: 👉 Du bist dran · gespeichert / verbinde… when away", () => {
    const p = page();
    p.window.renderPanelStatus();
    expect(line(p)).toEqual(["👉", "panel.turn_you", "panel.status_saved"]);
    expect(p.$("#panel-status").dataset.turn).toBe("you");
    p.$("#connection-status").dataset.state = "disconnected";
    p.window.renderPanelStatus();
    expect(p.$("#panel-status").dataset.status).toBe("local-only");
    expect(line(p)[2]).toBe("panel.status_local_only");
  });
  test("rethinking / implementing read 🤖 überdenkt | setzt um · gespeichert", () => {
    const p = page();
    p.submit("iterate");
    expect(line(p)).toEqual(["🤖", "panel.turn_rethinking", "panel.status_working"]);
    expect(p.$("#panel-status").dataset.turn).toBe("rethinking");
    p.submit("implement");
    expect(line(p)).toEqual(["🤖", "panel.turn_implementing", "panel.status_working"]);
    p.$("#connection-status").dataset.state = "disconnected";
    p.window.renderPanelStatus();
    expect(line(p)[2]).toBe("panel.status_reconnecting");
  });
});

describe("status toast — the same pill", () => {
  test("in flight: caption Runde n + the run bar, no open button", () => {
    const p = page({ round: "3" });
    p.submit("iterate");
    const t = p.$("#submitted-toast");
    expect(t.hidden).toBe(false);
    expect(t.tagName).toBe("DIV");
    expect(t.querySelector("button")).toBeNull();
    expect(t.querySelector(".jr-toast-cap").textContent).toBe("panel.toast_round".replace("{n}", "3"));
    expect(t.querySelector(".jr-run").hidden).toBe(false);
    expect(t.querySelector(".jr-count").textContent).toBe("1/2");
    expect(t.querySelector(".jr-float").hidden).toBe(true);
  });
  test("disconnected while 🤖 runs: dimmed bar + floating verbinde…", () => {
    const p = page();
    p.submit("implement");
    p.$("#connection-status").dataset.state = "disconnected";
    p.window.renderPanelStatus();
    const t = p.$("#submitted-toast");
    expect(t.querySelector(".jr-run").hasAttribute("data-paused")).toBe(true);
    expect(t.querySelector(".jr-float").hidden).toBe(false);
  });
  test("disconnected on the user's turn: bright blue pill 'Du bist dran · alles gespeichert' + verbinde…", () => {
    const p = page({ conn: "disconnected" });
    p.window.renderPanelStatus();
    const t = p.$("#submitted-toast");
    expect(t.hidden).toBe(false);
    expect(t.dataset.mode).toBe("you");
    expect(t.querySelector(".jr-run").hidden).toBe(true);
    expect(t.querySelector(".jr-toast-you").textContent).toContain("panel.toast_all_saved");
    expect(t.querySelector(".jr-float").hidden).toBe(false);
    p.$("#connection-status").dataset.state = "connected";
    p.window.renderPanelStatus();
    expect(t.hidden, "reconnected on the user's turn: no toast").toBe(true);
  });
  test("a later round than the last one seen shows 'Neue Runde'; the same round does not", () => {
    const p = page({ round: "4" });
    p.window.localStorage.setItem("jr-last-round:concept-state-t", "3");
    p.window.maybeShowNewRoundToast();
    const t = p.$("#submitted-toast");
    expect(t.hidden).toBe(false);
    expect(t.querySelector(".jr-toast-cap").textContent).toBe("panel.toast_new_round");
    const q = page({ round: "4" });
    q.window.localStorage.setItem("jr-last-round:concept-state-t", "4");
    q.window.maybeShowNewRoundToast();
    expect(q.$("#submitted-toast")).toBeNull();
  });
});

describe("journey CSS contracts", () => {
  test("unlock animates flex + opacity, never transform-scales the toggles", () => {
    expect(cssSource).toMatch(/\.jr-toggle \{[^}]*transition: flex-grow/);
    expect(cssSource).not.toMatch(/\.jr-(toggle|round|impl|face)[^{]*\{[^}]*scaleX/);
    expect(cssSource).toMatch(/\.journey\.jr-build > \* \{ animation: jr-in/);
  });
  test("every new animation has a reduced-motion fallback", () => {
    const rm = cssSource.slice(cssSource.lastIndexOf("@media (prefers-reduced-motion: reduce) {\n  .jr-toggle"));
    for (const sel of [".jr-toggle", ".jr-face", ".jr-shine", ".jr-bot", ".journey.jr-build > *", ".jr-toast", ".jr-float"]) {
      expect(rm, sel).toContain(sel);
    }
  });
  test("the old green box is gone; the dots are no longer drawn", () => {
    expect(cssSource).toMatch(/#panel-submitted \{ display: none !important; \}/);
    expect(cssSource).toMatch(/\.panel-status \.status-detail \{ display: none !important; \}/);
  });
});

describe("journey strings — both locales, final wording", () => {
  const rows = md.split("\n").filter((l) => /^\| `panel\.(journey_|turn_|toast_|submit_i|status_)/.test(l));
  test("no Claude/AI and no 'Iteration' in the new strings", () => {
    for (const r of rows) {
      expect(r, r).not.toMatch(/\bClaude\b|\bAI\b|\bKI\b/);
      expect(r, r).not.toMatch(/Iteration/);
    }
  });
  test("both locales present for the new keys", () => {
    for (const key of ["panel.turn_you", "panel.journey_lock", "panel.journey_back", "panel.journey_req",
      "panel.toast_round", "panel.toast_new_round", "panel.toast_all_saved", "panel.submit_implement_sub"]) {
      const row = rows.find((l) => l.startsWith("| `" + key + "`"));
      expect(row, key).toBeDefined();
      expect(row.split("|").map((s) => s.trim()).filter(Boolean).length, key).toBe(3);
    }
    expect(rows.find((l) => l.startsWith("| `panel.turn_you`"))).toContain("Du bist dran");
    expect(rows.find((l) => l.startsWith("| `panel.submit_iterate`"))).toContain("Zur nächsten Runde");
  });
});

describe("browser tab title carries the live status", () => {
  function tabPage(sectionAttrs, js) {
    const dom = new JSDOM(`<!doctype html><head><title>Wetter-Widget</title></head><body>
      <section data-iteration="2" ${sectionAttrs}></section></body>`, { runScripts: "outside-only", url: "http://localhost/" });
    dom.window.eval([
      "var _submittedAt = 0, _submittedAction = null;",
      constLine("TAB_GLYPHS"),
      "let _baseTabTitle = null;",
      fnSource("renderTabTitle"),
      js,
    ].join("\n"));
    return dom.window.document.title;
  }
  test("👉 your turn, ⏳ rethinking, 🛠️ implementing — no 'Concept —' prefix", () => {
    expect(tabPage("data-active", "renderTabTitle();")).toBe("👉 Wetter-Widget");
    expect(tabPage("data-active", "_submittedAt = 1; _submittedAction = 'iterate'; renderTabTitle();")).toBe("⏳ Wetter-Widget");
    expect(tabPage("data-active", "_submittedAt = 1; _submittedAction = 'implement'; renderTabTitle();")).toBe("🛠️ Wetter-Widget");
  });
  test("🏁 on an open final report, ✅ once it is closed", () => {
    expect(tabPage("data-active data-final-report", "renderTabTitle();")).toBe("🏁 Wetter-Widget");
    expect(tabPage("data-active data-final-report data-closed", "renderTabTitle();")).toBe("✅ Wetter-Widget");
  });
  test("re-rendering never stacks glyphs, and an old 'Concept —' title is cleaned", () => {
    expect(tabPage("data-active", "renderTabTitle(); _submittedAt = 1; renderTabTitle(); _submittedAt = 0; renderTabTitle();"))
      .toBe("👉 Wetter-Widget");
    expect(tabPage("data-active", "document.title = 'Concept — Wetter-Widget'; renderTabTitle();")).toBe("👉 Wetter-Widget");
  });
  test("renderPanelStatus drives it, so a background tab follows the poll", () => {
    expect(fnSource("renderPanelStatus")).toContain("renderTabTitle()");
  });
});

describe("old rounds and the final report", () => {
  test("a frozen round says its state once: the status line, not a second 🕘 indicator", () => {
    expect(cssSource).toMatch(/#panel-frozen \.frozen-indicator \{ display: none; \}/);
  });

  test("the final report shows the finished journey row on top of its panel", () => {
    const dom = new JSDOM(`<!doctype html><body class="viewing-final panel-open">
      <div id="panel-final-report"><div class="closeout-sheet"></div></div></body>`,
      { runScripts: "outside-only", url: "http://localhost/" });
    const { window } = dom;
    window.eval(localeKeys([
      "var STORAGE_KEY = 'concept-state-t';",
      constLine("_JR_CHK"),
      fnSource("_jrEl"),
      fnSource("mountFinalJourney"),
      fnSource("maybeBuildFinalJourney"),
      "mountFinalJourney(); maybeBuildFinalJourney();",
    ].join("\n")));
    const row = window.document.querySelector("#panel-final-report > .journey-final");
    expect(row).not.toBeNull();
    expect(row.dataset.phase).toBe("done");
    expect(row.querySelectorAll(".jr-dot .jr-chk").length).toBe(2);
    expect(row.querySelector(".jr-run-done").style.width).toBe("100%");
    expect(row.querySelector(".jr-finish").textContent).toBe("🏁");
    expect(row.classList.contains("jr-build")).toBe(true);
    // Once per page: a second open does not rebuild.
    row.classList.remove("jr-build");
    window.eval("maybeBuildFinalJourney();");
    expect(row.classList.contains("jr-build")).toBe(false);
    expect(cssSource).toContain("body.viewing-final .journey:not(.journey-final)");
  });
});
