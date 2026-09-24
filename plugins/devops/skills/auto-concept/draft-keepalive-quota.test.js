import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// Gate 65 — the draft mirror went dark mid-round while the bridge kept
// answering 200. Seen live: `drafts/<slug>.jsonl` stopped at rev 33 — 67 566
// bytes, just past 64 KiB — while the user typed five more notes, and the page
// said "die Bridge ist nicht erreichbar" / "getrennt" until the round was
// submitted. `curl` could still POST /draft; the page's requests never left
// the browser.
//
// Mechanism, measured in Chromium one variable at a time: a `keepalive`
// request's body stays booked against a 64 KiB per-page quota until its
// response COMPLETES, and a `Cache-Control: no-store` response whose body
// nobody reads never completes. The old flushDraft posted with keepalive and
// never read the answer, so every autosave pinned its payload for good.
//
// The model below implements exactly that rule, runs the REAL engine functions
// from templates.md against it — and, so it cannot pass vacuously, runs the
// pre-fix flushDraft against the same model and watches it die.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const md = fs.readFileSync(path.join(__dirname, "deep-knowledge", "templates.md"), "utf8");

function fnSource(name) {
  const m = md.match(new RegExp("(?:async )?function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found in templates.md");
  return m[0];
}

/** Fenced code blocks only — the prose quotes the old `keepalive: true` call. */
function scanBlocks(src) {
  const out = [];
  let open = null, body = [];
  for (const line of src.split("\n")) {
    const m = /^```(.*)$/.exec(line);
    if (m) {
      if (open === null) { open = m[1].trim(); body = []; }
      else { out.push({ info: open, code: body.join("\n") }); open = null; }
      continue;
    }
    if (open !== null) body.push(line);
  }
  return out;
}

// The pre-fix flush, verbatim from the engine that shipped the incident.
const LEGACY_FLUSH = `async function flushDraft() {
  if (_draftTimer) { clearTimeout(_draftTimer); _draftTimer = null; }
  if (!DRAFT_ENABLED) return;
  const cleared = _takeCleared();
  try {
    const res = await fetch('/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: _draftPayload(cleared),
      keepalive: true,
    });
    if (!res.ok) _returnCleared(cleared);
    _setDraftHealth(res.ok);
  } catch (e) {
    _returnCleared(cleared);
    _setDraftHealth(false);
  }
}`;

const QUOTA = 64 * 1024;

// Chromium's keepalive accounting against a bridge that answers `no-store`:
// a keepalive body is booked on send and released only when the response body
// is consumed; over the quota the request is refused before it is sent.
function chromiumModel({ status = 200 } = {}) {
  const net = { inflight: 0, sent: 0, refused: 0, requests: [] };
  const fetch = (url, init = {}) => {
    const body = init.body === undefined ? "" : String(init.body);
    const bytes = Buffer.byteLength(body);
    if (init.keepalive) {
      if (net.inflight + bytes > QUOTA) {
        net.refused++;
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      net.inflight += bytes;
    }
    net.sent++;
    net.requests.push({ url, keepalive: !!init.keepalive, bytes });
    let released = !init.keepalive;
    const release = () => { if (!released) { released = true; net.inflight -= bytes; } };
    const text = JSON.stringify({ ok: status < 400, durable: status < 400, rev: net.sent });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text() { release(); return Promise.resolve(text); },
      json() { release(); return Promise.resolve(JSON.parse(text)); },
      body: { cancel() { release(); return Promise.resolve(); } },
    });
  };
  return { fetch, net };
}

// ~2.4 KB per autosave — the size of the incident's blobs (50 keys, a dozen
// notes). 27 of them fit under the quota, the 28th does not.
function realisticState() {
  const s = { _savedAt: 1, _pageVersion: "v1", theme: "dark", _userInteracted: true };
  for (let i = 1; i <= 12; i++) {
    s[`input:eval-i1-k${i}:include`] = true;
    s[`input:eval-i1-k${i}:discard`] = false;
    s[`text:i1:i1-k${i}-note`] = "Notiz " + i + " " + "x".repeat(120);
  }
  return s;
}

function engine({ flushSource, status = 200, conn = "connected", beacon = false } = {}) {
  const model = chromiumModel({ status });
  const strip = { hidden: false, textContent: "", className: "", setAttribute() {} };
  const phases = [];
  const timers = [];
  const store = { "concept-state-probe": JSON.stringify(realisticState()) };
  const ctx = {
    fetch: model.fetch,
    Blob: class { constructor(parts) { this.parts = parts; } },
    navigator: { sendBeacon: () => beacon },
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    document: {
      querySelector: () => ({ dataset: { iteration: "1" } }),
      documentElement: { dataset: { pageVersion: "v1" } },
      getElementById: (id) => (id === "connection-status" ? { dataset: { state: conn } } : null),
      createElement: () => strip,
      body: { appendChild() {} },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    _setDraftPhase: (p) => phases.push(p),
  };
  vm.createContext(ctx);
  vm.runInContext(
    [
      "const STORAGE_KEY = 'concept-state-probe';",
      "const DRAFT_SLUG = 'probe';",
      "const DRAFT_ENABLED = true;",
      md.match(/const DRAFT_RETRY_MS = \d+;/)[0],
      "let _draftTimer = null; let _draftCleared = []; let _draftFailures = 0;",
      "let _draftStripEl = null; let _draftRetryTimer = null;",
      fnSource("_readStoredState"),
      fnSource("_draftPayload"),
      fnSource("_takeCleared"),
      fnSource("_returnCleared"),
      fnSource("_draftStripText"),
      fnSource("_setDraftHealth"),
      fnSource("_drainDraftResponse"),
      flushSource || fnSource("flushDraft"),
      fnSource("flushDraftBeacon"),
      "this.state = () => ({ failures: _draftFailures, strip: _draftStripEl, cleared: _draftCleared.slice() });",
      "this.clear = (k) => { _draftCleared.push(k); };",
    ].join("\n"),
    ctx,
  );
  const flush = () => vm.runInContext("flushDraft()", ctx);
  const beaconFlush = () => vm.runInContext("flushDraftBeacon()", ctx);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { ctx, net: model.net, strip, phases, flush, beaconFlush, settle, state: () => ctx.state() };
}

describe("draft mirror — Chromium keepalive quota (gate 65)", () => {
  test("the model reproduces the incident: the pre-fix flush dies after ~27 autosaves and never recovers", async () => {
    const e = engine({ flushSource: LEGACY_FLUSH });
    for (let i = 0; i < 60; i++) await e.flush();
    const perSave = e.net.requests[0].bytes;
    expect(perSave).toBeGreaterThan(2000);
    expect(e.net.sent).toBe(Math.floor(QUOTA / perSave));
    expect(e.net.sent).toBeLessThan(30);
    expect(e.net.refused, "every later autosave refused inside the browser").toBe(60 - e.net.sent);
    expect(e.state().failures).toBe(60 - e.net.sent);
    expect(e.strip.hidden).toBe(false);
  });

  test("the shipped flush mirrors 300 autosaves (~700 KB) without a single refusal", async () => {
    const e = engine();
    for (let i = 0; i < 300; i++) await e.flush();
    expect(e.net.refused).toBe(0);
    expect(e.net.sent).toBe(300);
    expect(e.net.inflight, "every response was read to the end").toBe(0);
    expect(e.state().failures).toBe(0);
    expect(e.state().strip, "the strip is never even created").toBeNull();
  });

  test("the live autosave never asks for keepalive", async () => {
    const e = engine();
    for (let i = 0; i < 5; i++) await e.flush();
    expect(e.net.requests.every((r) => r.keepalive === false)).toBe(true);
    expect(fnSource("flushDraft")).not.toMatch(/keepalive/);
    expect(fnSource("flushDraft")).toContain("await _drainDraftResponse(res)");
  });

  test("the teardown fallback keeps keepalive but drains, so a page that lives on is not starved", async () => {
    // `visibilitychange` → hidden runs flushDraftBeacon on a page that stays
    // open; with the beacon refused, its fetch fallback is the one that runs.
    const e = engine({ beacon: false });
    for (let i = 0; i < 200; i++) { e.beaconFlush(); await e.settle(); }
    expect(e.net.requests.every((r) => r.keepalive === true)).toBe(true);
    expect(e.net.refused).toBe(0);
    expect(e.net.sent).toBe(200);
    expect(e.net.inflight).toBe(0);
    // …and the live autosave still works afterwards.
    await e.flush();
    expect(e.state().failures).toBe(0);
  });

  test("an accepted beacon sends nothing through fetch", () => {
    const e = engine({ beacon: true });
    e.beaconFlush();
    expect(e.net.sent).toBe(0);
  });

  test("sendTabBye's keepalive fallback drains its answer too", () => {
    const src = fnSource("sendTabBye");
    expect(src).toMatch(/keepalive: true \}\)\s*\n\s*\.then\(r => r\.text\(\)/);
  });

  test("keepalive appears only on the two teardown fallbacks", () => {
    const code = scanBlocks(md).map((b) => b.code).join("\n");
    const hits = code.split("\n").filter((l) => /keepalive:\s*true/.test(l));
    expect(hits.length).toBe(2);
    expect(fnSource("flushDraftBeacon")).toMatch(/keepalive: true,\s*\n\s*\}\)\.then\(_drainDraftResponse/);
    expect(fnSource("sendTabBye")).toMatch(/keepalive: true/);
  });
});

describe("draft mirror — the strip names the failure truthfully", () => {
  test("a refusal (HTTP 507) hands the cleared keys back and says the bridge did not store them", async () => {
    const e = engine({ status: 507 });
    e.ctx.clear("text:i1:gone");
    for (let i = 0; i < 3; i++) await e.flush();
    expect(e.state().failures).toBe(3);
    expect(e.strip.hidden).toBe(false);
    expect(e.strip.textContent).toBe("{{state.draft_save_failed}}");
    expect(e.state().cleared).toEqual(["text:i1:gone"]);
  });

  test("unreachable while the heartbeat does not vouch for the bridge → 'unreachable'", () => {
    const e = engine({ conn: "disconnected" });
    expect(vm.runInContext("_draftStripText('unreachable')", e.ctx)).toBe("{{state.draft_local_only}}");
    const f = engine({ conn: "connecting" });
    expect(vm.runInContext("_draftStripText('unreachable')", f.ctx)).toBe("{{state.draft_local_only}}");
  });

  test("a transport error under a CONNECTED heartbeat is not 'unreachable' — the bridge answers", () => {
    const e = engine({ conn: "connected" });
    expect(vm.runInContext("_draftStripText('unreachable')", e.ctx)).toBe("{{state.draft_save_failed}}");
    expect(vm.runInContext("_draftStripText('refused')", e.ctx)).toBe("{{state.draft_save_failed}}");
  });

  test("both strip strings exist in the locale table, en and de", () => {
    for (const key of ["state.draft_local_only", "state.draft_save_failed"]) {
      const row = md.split("\n").find((l) => l.startsWith("| `" + key + "`"));
      expect(row, key).toBeDefined();
      expect(row.split("|").map((s) => s.trim()).filter(Boolean).length, key).toBe(3);
    }
  });
});
