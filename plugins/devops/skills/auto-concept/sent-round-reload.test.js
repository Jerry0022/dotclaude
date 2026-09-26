import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// A reload while Claude still works on the round the user just sent (iterate
// or implement) used to come back in the READY state: `concept-submitted` is
// not persisted, so the grey veil over the content was gone and the submit
// buttons were live again over a payload already in flight. The veil may be
// lifted by the user (click / Escape) — but a reload must bring it back for
// as long as the live round is the one that was sent.
//
// restoreInFlightRound() asks the bridge (offline: the local -pending queue)
// and restores the sent state only for a payload that names the LIVE round:
// Claude posts /reload BEFORE /reset, so the next round briefly loads while
// the previous payload is still pending — that load must come back clear.
//
// Runs the reference functions from templates.md verbatim on jsdom.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const md = fs.readFileSync(path.join(__dirname, "deep-knowledge", "templates.md"), "utf8");

function fnSource(name) {
  const m = md.match(new RegExp("(async )?function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found in templates.md");
  return m[0];
}

async function page({ decisions = { submitted: false }, pending = null, bridgeDown = false, live = "3", viewingFrozen = false } = {}) {
  const dom = new JSDOM(
    `<body>
      <main>
        <section data-iteration="2" hidden></section>
        <section data-iteration="${live}" data-active></section>
      </main>
      <div id="panel-ready" style="display:block"></div>
      <div id="panel-submitted" style="display:none"></div>
      <div id="content-dimmer" hidden></div>
    </body>`,
    { runScripts: "outside-only", url: "https://concept.test/" }
  );
  const { window } = dom;
  if (viewingFrozen) window.document.body.classList.add("viewing-frozen");
  window.__decisions = decisions;
  window.__bridgeDown = bridgeDown;
  window.__calls = [];
  if (pending) window.localStorage.setItem("concept-test-pending", JSON.stringify(pending));
  window.eval(
    [
      "window.STORAGE_KEY = 'concept-test';",
      "var _submittedAt = 0, _submittedReloadCounter = null, _submittedAction = null, _submitInFlight = false;",
      "var _bootReloadCounter = 5;",
      "window.fetch = async () => { if (window.__bridgeDown) throw new Error('offline'); return { ok: true, json: async () => window.__decisions }; };",
      "function markDockSubmitted() { window.__calls.push('dock'); }",
      "function resetStatusSteps(a) { window.__calls.push('steps:' + a); }",
      "function updateStatusSteps() { window.__calls.push('progress'); }",
      "function renderPanelStatus() { window.__calls.push('status'); }",
      fnSource("showContentDimmer"),
      fnSource("hideContentDimmer"),
      fnSource("restoreInFlightRound"),
      "window.__state = () => ({ at: _submittedAt, action: _submittedAction, counter: _submittedReloadCounter });",
    ].join("\n")
  );
  await window.restoreInFlightRound();
  const { document } = window;
  return {
    window,
    veiled: () => !document.getElementById("content-dimmer").hidden && document.body.classList.contains("content-dimmed"),
    sent: () => document.body.classList.contains("concept-submitted"),
    ready: () => document.getElementById("panel-ready").style.display,
    submitted: () => document.getElementById("panel-submitted").style.display,
  };
}

describe("a sent round survives a reload", () => {
  test("pending iterate for the live round: veil, sent panel, state machine re-joined", async () => {
    const p = await page({ decisions: { submitted: true, action: "iterate", iteration: "3" } });
    expect(p.veiled()).toBe(true);
    expect(p.sent()).toBe(true);
    expect(p.ready()).toBe("none");
    expect(p.submitted()).toBe("block");
    expect(p.window.__state().action).toBe("iterate");
    expect(p.window.__state().at).toBeGreaterThan(0);
    expect(p.window.__state().counter).toBe(5);
    expect(p.window.__calls).toEqual(expect.arrayContaining(["dock", "steps:iterate", "progress", "status"]));
  });

  test("pending implement is restored the same way", async () => {
    const p = await page({ decisions: { submitted: true, action: "implement", iteration: "3" } });
    expect(p.veiled()).toBe(true);
    expect(p.window.__state().action).toBe("implement");
  });

  test("the previous round's payload (Claude reloads before /reset) leaves the new round clear", async () => {
    const p = await page({ decisions: { submitted: true, action: "iterate", iteration: "2" } });
    expect(p.veiled()).toBe(false);
    expect(p.sent()).toBe(false);
    expect(p.ready()).toBe("block");
    expect(p.window.__state().at).toBe(0);
  });

  test("a payload without a round (older page) is never guessed at", async () => {
    const p = await page({ decisions: { submitted: true, action: "iterate" } });
    expect(p.veiled()).toBe(false);
    expect(p.ready()).toBe("block");
  });

  test("nothing pending (after /reset) comes back ready", async () => {
    const p = await page({ decisions: { submitted: false, _processed_at: "2026-09-26T08:00:00Z" } });
    expect(p.veiled()).toBe(false);
    expect(p.ready()).toBe("block");
  });

  test("offline: the local queue still knows the round was sent", async () => {
    const p = await page({ bridgeDown: true, pending: { submitted: true, action: "iterate", iteration: "3" } });
    expect(p.veiled()).toBe(true);
    expect(p.submitted()).toBe("block");
  });

  test("a finalize is left to restoreInFlightCloseout()", async () => {
    const p = await page({ decisions: { submitted: true, action: "finalize", iteration: "3" } });
    expect(p.veiled()).toBe(false);
  });

  test("reloaded onto a past tab: the sent panel stays hidden until the live tab is shown", async () => {
    const p = await page({ viewingFrozen: true, decisions: { submitted: true, action: "iterate", iteration: "3" } });
    expect(p.sent()).toBe(true);
    expect(p.ready()).toBe("none");
    expect(p.submitted()).toBe("none");
  });

  test("the payload names its round, and the restore is wired on load", () => {
    expect(fnSource("collectDecisions")).toContain("payload.iteration = (active.dataset && active.dataset.iteration) || null;");
    expect(md).toContain("document.addEventListener('DOMContentLoaded', restoreInFlightRound);");
  });
});
