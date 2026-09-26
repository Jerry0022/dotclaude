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

  test("a reachable bridge with nothing pending outranks a stale local copy (AUD-020)", async () => {
    // The copy is a payload that never arrived (or was already processed).
    // Veiling the round over it promised "Claude arbeitet" for a round Claude
    // never received; the heartbeat's retry delivers it instead.
    const p = await page({ decisions: { submitted: false }, pending: { submitted: true, action: "iterate", iteration: "3" } });
    expect(p.veiled()).toBe(false);
    expect(p.sent()).toBe(false);
    expect(p.ready()).toBe("block");
    expect(p.window.__state().at).toBe(0);
    expect(p.window.localStorage.getItem("concept-test-pending"), "the copy stays queued for the retry").not.toBeNull();
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

// AUD-020 (b): the retry now runs on every connected heartbeat, also while the
// submitted panel is up — so it has to be idempotent.
function retryPage({
  submitInFlight = false,
  pending = { submitted: true, action: "iterate", iteration: "3" },
  decisions = {},
  timeoutMs = null,
} = {}) {
  const dom = new JSDOM("<body></body>", { runScripts: "outside-only", url: "https://concept.test/" });
  const { window } = dom;
  window.__posts = [];
  window.__release = [];
  window.__decisions = decisions;
  window.localStorage.setItem("concept-test-pending", JSON.stringify(pending));
  const deadline = md.match(/const PENDING_RETRY_TIMEOUT_MS = \d+;/)[0];
  window.eval(
    [
      "window.STORAGE_KEY = 'concept-test';",
      `var _submitInFlight = ${submitInFlight};`,
      // Every POST hangs until the test releases it (or the attempt's deadline
      // aborts it) — a slow bridge outliving the 5 s heartbeat is exactly when
      // a second beat would re-POST.
      "window.fetch = (url, opts) => { if (!opts || opts.method !== 'POST') return Promise.resolve({ ok: true, json: async () => window.__decisions }); window.__posts.push(opts.body); return new Promise((r, j) => { window.__release.push(() => r({ ok: true, json: async () => ({ durable: true }) })); if (opts.signal) opts.signal.addEventListener('abort', () => j(new Error('aborted'))); }); };",
      md.match(/let _pendingRetryInFlight = false;/)[0],
      timeoutMs == null ? deadline : deadline.replace(/\d+/, String(timeoutMs)),
      fnSource("retryPendingSubmission"),
      fnSource("_deliverPending"),
    ].join(";\n")
  );
  return window;
}

describe("the offline queue is retried idempotently", () => {
  test("two heartbeats during one slow POST deliver the payload once", async () => {
    const w = retryPage();
    const first = w.retryPendingSubmission();
    await w.retryPendingSubmission();
    expect(w.__posts.length).toBe(1);
    w.__release.forEach(f => f());
    await first;
    expect(w.localStorage.getItem("concept-test-pending"), "cleared on the durable ack").toBeNull();
    await w.retryPendingSubmission();
    expect(w.__posts.length, "nothing left to re-send").toBe(1);
  });

  test("never beside submitWithAction()'s own POST", async () => {
    const w = retryPage({ submitInFlight: true });
    await w.retryPendingSubmission();
    expect(w.__posts.length).toBe(0);
  });

  test("a round the bridge already holds is dropped, not POSTed a second time", async () => {
    const sent = { submitted: true, action: "iterate", iteration: "3", submission_id: "sub-a" };
    const w = retryPage({ pending: sent, decisions: { ...sent, _version: 7 } });
    await w.retryPendingSubmission();
    expect(w.__posts.length).toBe(0);
    expect(w.localStorage.getItem("concept-test-pending")).toBeNull();
  });

  test("a different submission on the bridge does not swallow the queued one", async () => {
    const w = retryPage({
      pending: { submitted: true, action: "iterate", iteration: "3", submission_id: "sub-b" },
      decisions: { submitted: true, action: "iterate", iteration: "3", submission_id: "sub-a" },
    });
    const run = w.retryPendingSubmission();
    await new Promise(r => setTimeout(r, 0));
    expect(w.__posts.length).toBe(1);
    w.__release.forEach(f => f());
    await run;
    expect(w.localStorage.getItem("concept-test-pending")).toBeNull();
  });

  test("a bridge that never answers releases the retry at the deadline", async () => {
    const w = retryPage({ timeoutMs: 20 });
    await w.retryPendingSubmission();
    expect(w.__posts.length).toBe(1);
    expect(w.localStorage.getItem("concept-test-pending"), "kept — nothing confirmed it").not.toBeNull();
    await w.retryPendingSubmission();
    expect(w.__posts.length, "the next heartbeat is not locked out").toBe(2);
  });

  test("every submitted round carries a submission_id", () => {
    const fn = fnSource("submitWithAction");
    const id = fn.indexOf("data.submission_id = newSubmissionId();");
    expect(id).toBeGreaterThan(-1);
    expect(id, "attached before the POST body is built").toBeLessThan(fn.indexOf("body: JSON.stringify(data)"));
  });

  test("the connected heartbeat retries ahead of the submitted-panel return", () => {
    const fn = fnSource("checkClaudeConnection");
    const retry = fn.indexOf("if (isConnected) retryPendingSubmission();");
    const bail = fn.indexOf("if (panelSubmitted && panelSubmitted.style.display !== 'none') return;");
    expect(retry).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(-1);
    expect(retry).toBeLessThan(bail);
    expect(fn.indexOf("retryPendingSubmission();", bail), "no second, unreachable call").toBe(-1);
  });
});
