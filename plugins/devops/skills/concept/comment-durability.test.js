import { describe, test, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// Behavioural proof for "a comment is never lost". The other concept tests
// grep templates.md for the right shapes; this one RUNS the persistence engine
// exactly as generated pages run it — same source text, real DOM, real
// localStorage — and reproduces the reported losses:
//
//   * submit, click an older iteration tab, click back → the round the user
//     was still waiting on came home with an empty feedback dock;
//   * browse a frozen tab (allowed — it is how you re-read a past round) →
//     the frozen round's answers were persisted over the live round's;
//   * Claude stops answering (usage limit) → the five-minute safety net
//     recovered the panel by deleting every comment on the page;
//   * leave the tab open overnight → the TTL deleted them instead.
//
// Every one of those is a single line of JS, which is exactly why they need a
// test that executes rather than one that reads.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");

/** The first fenced js block after `heading`. */
function blockAfter(heading) {
  const at = md.indexOf(heading);
  expect(at, heading).toBeGreaterThan(-1);
  const open = md.indexOf("```javascript", at);
  expect(open, `js fence after ${heading}`).toBeGreaterThan(-1);
  const start = md.indexOf("\n", open) + 1;
  const close = md.indexOf("\n```", start);
  expect(close, `closing fence after ${heading}`).toBeGreaterThan(-1);
  return md.slice(start, close);
}

// Locale placeholders are substituted by Claude when it writes the page; the
// engine itself never sees `{{…}}`.
function delocalize(src) {
  return src.replace(/\{\{[a-z_.]+\}\}/g, "TEXT");
}

const PERSISTENCE_JS = delocalize(blockAfter("## State Persistence (localStorage + TTL)"));
const PANEL_RESET_JS = delocalize(blockAfter("## Panel State Reset"));

const PAGE_VERSION = "20260905-1200";

// The two blocks under test call into siblings that live in other sections of
// templates.md (the dimmer, the submit block's module-level flags). Stubbing
// them keeps the test about persistence instead of about the whole page —
// `var` so the test can reach them from outside the script.
const PRELUDE = `
function hideContentDimmer() {}
function showContentDimmer() {}
var _dockUnmarked = false;
function unmarkDockSubmitted() { _dockUnmarked = true; }
var _submittedAt = 0, _submittedReloadCounter = null, _submitInFlight = false;
var _submittedAction = null;
var _userInteracted = false;
`;

/**
 * A page with the two things every reported loss involved: a frozen round that
 * still carries its submitted answers in the HTML, and a live round sharing a
 * feedback dock that lives OUTSIDE both of them.
 */
function buildDom({ storage = null, ttlHoursAgo = null, pageVersion = PAGE_VERSION } = {}) {
  const html = `<!doctype html>
<html data-page-version="${pageVersion}" data-template="design">
<body>
  <section data-iteration="1" hidden>
    <textarea data-comment="d-auth-note" readonly>Runde 1: bitte SSO prüfen</textarea>
    <input type="radio" name="d-auth" value="yes" checked disabled>
  </section>
  <section data-iteration="2" data-active>
    <textarea data-comment="d-auth-note"></textarea>
    <input type="radio" name="d-auth" value="yes">
    <input type="radio" name="d-auth" value="no">
  </section>
  <div id="feedback-dock">
    <textarea data-comment="general"></textarea>
    <textarea data-comment="d1-s1" data-screen-comment="d1-s1"></textarea>
  </div>
  <div id="panel-ready"></div>
  <div id="panel-submitted"></div>
  <button id="submit-iterate-btn"></button>
  <button id="submit-implement-btn"></button>
  <script>${PRELUDE}\n${PERSISTENCE_JS}\n${PANEL_RESET_JS}</script>
</body></html>`;

  const beacons = [];
  const posts = [];
  let draftResponse = { ok: true, found: false, recovered: {} };

  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:8765/docs/concepts/2026-09-05-demo.html",
    runScripts: "dangerously",
    beforeParse(window) {
      if (storage) {
        const blob = { ...storage };
        if (ttlHoursAgo !== null) blob._savedAt = Date.now() - ttlHoursAgo * 3600_000;
        window.localStorage.setItem("concept-state-2026-09-05-demo", JSON.stringify(blob));
      }
      window.fetch = (url, init) => {
        if (String(url).startsWith("/draft?")) {
          return Promise.resolve({
            ok: true, status: 200, json: () => Promise.resolve(draftResponse),
          });
        }
        posts.push({ url: String(url), body: init && init.body });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      };
      window.navigator.sendBeacon = (url, blob) => {
        beacons.push({ url, blob });
        return true;
      };
      // Never real: the engine is expected to keep working when the mirror is
      // unreachable, and these tests must not hit the network.
      window.__setDraftResponse = r => { draftResponse = r; };
    },
  });

  const { window } = dom;
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  return { dom, window, beacons, posts, setDraft: r => window.__setDraftResponse(r) };
}

const KEY = "concept-state-2026-09-05-demo";
const readBlob = window_ => JSON.parse(window_.localStorage.getItem(KEY) || "{}");

/** Type into a field the way a person does: a TRUSTED-looking input event. */
function type(window_, el, value) {
  el.value = value;
  el.dispatchEvent(new window_.Event("input", { bubbles: true }));
}

// jsdom dispatches synthetic events with isTrusted=false, which the engine
// deliberately ignores for the `data-touched` stamp (a restore must not count
// as user input). Real typing sets it; this is the honest stand-in.
function typeAsUser(window_, el, value) {
  el.dataset.touched = "true";
  type(window_, el, value);
}

describe("comment durability — the live round's text", () => {
  test("is persisted under the LIVE round's namespace", () => {
    const { window } = buildDom();
    const live = window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]');
    typeAsUser(window, live, "Runde 2: OAuth statt SSO");
    const blob = readBlob(window);
    expect(blob["text:i2:d-auth-note"]).toBe("Runde 2: OAuth statt SSO");
    // The same id in round 1 means a different note and must not be touched.
    expect(blob["text:i1:d-auth-note"]).toBeUndefined();
    expect(blob["text:d-auth-note"]).toBeUndefined();
  });

  test("is not overwritten by a frozen round's submitted answers", () => {
    // The exact reported path: browse an old tab (its textarea is in the DOM
    // and full of round 1's text) and every showScreen() ends in saveState().
    const { window } = buildDom();
    const live = window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]');
    typeAsUser(window, live, "Runde 2 Text");
    window.document.body.classList.add("viewing-frozen");
    window.saveState();
    expect(readBlob(window)["text:i2:d-auth-note"]).toBe("Runde 2 Text");
  });

  test("is not overwritten by the dock while a frozen tab is on screen", () => {
    // applyDockFreezeState() paints the frozen round's submitted comments into
    // the SHARED dock. Persisting those writes round 1 over round 2.
    const { window } = buildDom();
    const dockField = window.document.querySelector('#feedback-dock [data-comment="d1-s1"]');
    typeAsUser(window, dockField, "meine echte Notiz");
    expect(readBlob(window)["text:i2:d1-s1"]).toBe("meine echte Notiz");

    window.document.body.classList.add("viewing-frozen");
    dockField.value = "Runde 1 eingefrorener Text";
    window.saveState();
    expect(readBlob(window)["text:i2:d1-s1"]).toBe("meine echte Notiz");

    // …and coming back to the live tab still persists normally.
    window.document.body.classList.remove("viewing-frozen");
    typeAsUser(window, dockField, "meine echte Notiz, ergänzt");
    expect(readBlob(window)["text:i2:d1-s1"]).toBe("meine echte Notiz, ergänzt");
  });

  test("never lands in a frozen section's fields on restore", () => {
    const { window } = buildDom({
      storage: { _pageVersion: PAGE_VERSION, "text:i2:d-auth-note": "gehört zu Runde 2" },
    });
    expect(window.document.querySelector('[data-iteration="1"] [data-comment="d-auth-note"]').value)
      .toBe("Runde 1: bitte SSO prüfen");
    expect(window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]').value)
      .toBe("gehört zu Runde 2");
  });

  test("survives a panel reset — including the usage-limit safety net", () => {
    const { window } = buildDom();
    const live = window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]');
    const dockField = window.document.querySelector('#feedback-dock [data-comment="general"]');
    window._userInteracted = true;
    typeAsUser(window, live, "stundenlange Arbeit");
    typeAsUser(window, dockField, "und noch mehr davon");
    expect(readBlob(window)._userInteracted, "flag set before the reset").toBe(true);

    // pollProcessedState() calls this after PROCESSED_SAFETY_MS with no reload
    // — i.e. exactly when Claude is stuck on a usage limit — and it also runs
    // when the bridge answered 507. It used to remove the whole key.
    window.restorePanelToReady();

    const blob = readBlob(window);
    expect(blob["text:i2:d-auth-note"]).toBe("stundenlange Arbeit");
    expect(blob["text:i2:general"]).toBe("und noch mehr davon");
    // The panel flag it IS supposed to clear is gone.
    expect(blob._userInteracted).toBeUndefined();
    // …and the dock is editable again: a ready panel over a read-only comment
    // surface would let the user re-submit but not change anything first.
    expect(window._dockUnmarked).toBe(true);
  });

  test("survives the 24h TTL instead of being deleted by it", () => {
    const { window } = buildDom({
      storage: {
        _pageVersion: PAGE_VERSION,
        "text:i2:d-auth-note": "über Nacht liegen gelassen",
        "input:d-auth:yes": true,
      },
      ttlHoursAgo: 30,
    });
    const blob = readBlob(window);
    expect(blob["text:i2:d-auth-note"]).toBe("über Nacht liegen gelassen");
    // The genuinely stale half IS dropped — only typed work is carried over.
    expect(blob["input:d-auth:yes"]).toBeUndefined();
    expect(blob._carriedOver).toBe(true);
    // And it is back in the field, with a strip saying so.
    expect(window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]').value)
      .toBe("über Nacht liegen gelassen");
    expect(window.document.querySelector(".recovered-notes-strip")).toBeTruthy();
    // The untouched original is kept sideways, never dropped.
    expect(window.localStorage.getItem(KEY + "-archive")).toContain("input:d-auth:yes");
  });

  test("survives a page-version change instead of being deleted by it", () => {
    const { window } = buildDom({
      storage: { _pageVersion: "an-older-generation", "text:i2:d-auth-note": "noch nicht abgeschickt" },
    });
    expect(readBlob(window)["text:i2:d-auth-note"]).toBe("noch nicht abgeschickt");
    expect(window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]').value)
      .toBe("noch nicht abgeschickt");
  });

  test("keeps being saved after a storage quota error, and says so", () => {
    const { window } = buildDom();
    // Patched on the prototype: jsdom's localStorage is a Proxy that turns an
    // own-property assignment into a STORED ITEM called "setItem".
    const proto = window.Storage.prototype;
    const real = proto.setItem;
    let calls = 0;
    proto.setItem = function (k, v) {
      if (calls++ === 0) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      return real.call(this, k, v);
    };
    const live = window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]');
    // Must not throw out of the input handler — that is what used to kill all
    // further persistence for the rest of the page, silently.
    expect(() => typeAsUser(window, live, "erste")).not.toThrow();
    expect(window.document.querySelector(".persist-warning-banner")).toBeTruthy();
    typeAsUser(window, live, "zweite");
    expect(readBlob(window)["text:i2:d-auth-note"]).toBe("zweite");
  });
});

describe("comment durability — the bridge mirror", () => {
  test("posts the blob to /draft after typing", async () => {
    const { window, posts } = buildDom();
    const live = window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]');
    typeAsUser(window, live, "geht an die Bridge");
    await new Promise(r => setTimeout(r, 1300));
    const draft = posts.filter(p => p.url === "/draft").pop();
    expect(draft, "a POST /draft after the debounce").toBeTruthy();
    const body = JSON.parse(draft.body);
    expect(body.slug).toBe("2026-09-05-demo");
    expect(body.page_version).toBe(PAGE_VERSION);
    expect(body.iteration).toBe("2");
    expect(body.state["text:i2:d-auth-note"]).toBe("geht an die Bridge");
  });

  test("reports a DELIBERATE clear so it is not resurrected", async () => {
    const { window, posts } = buildDom();
    const live = window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]');
    typeAsUser(window, live, "erst tippen");
    typeAsUser(window, live, "");
    await new Promise(r => setTimeout(r, 1300));
    const body = JSON.parse(posts.filter(p => p.url === "/draft").pop().body);
    expect(body.cleared).toContain("text:i2:d-auth-note");
  });

  test("flushes on pagehide, so a closed tab cannot outrun the last write", () => {
    const { window, beacons } = buildDom();
    const live = window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]');
    typeAsUser(window, live, "letzter Satz vor dem Schließen");
    window.dispatchEvent(new window.Event("pagehide"));
    expect(beacons.length).toBeGreaterThan(0);
    expect(beacons[beacons.length - 1].url).toBe("/draft");
  });

  test("restores a note that exists ONLY on the bridge", async () => {
    // localStorage wiped (new profile, private window, cleared site data, or
    // a page bug) — the durable copy is all that is left.
    const { window, setDraft } = buildDom();
    setDraft({
      ok: true, found: true, rev: 7, state: {},
      recovered: { "text:i2:d-auth-note": "nur noch auf der Platte" },
    });
    await window.hydrateDraftFromBridge();
    expect(readBlob(window)["text:i2:d-auth-note"]).toBe("nur noch auf der Platte");
    expect(window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]').value)
      .toBe("nur noch auf der Platte");
  });

  test("never overwrites newer local text with the bridge's older copy", async () => {
    const { window, setDraft } = buildDom();
    const live = window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]');
    typeAsUser(window, live, "das Neueste, gerade getippt");
    setDraft({
      ok: true, found: true, rev: 3, state: {},
      recovered: { "text:i2:d-auth-note": "eine ältere Fassung" },
    });
    await window.hydrateDraftFromBridge();
    expect(readBlob(window)["text:i2:d-auth-note"]).toBe("das Neueste, gerade getippt");
    expect(live.value).toBe("das Neueste, gerade getippt");
  });

  test("fills a field the local blob has EMPTY — the shape of every past bug", async () => {
    const { window, setDraft } = buildDom({
      storage: { _pageVersion: PAGE_VERSION, "text:i2:d-auth-note": "" },
    });
    setDraft({
      ok: true, found: true, rev: 4, state: {},
      recovered: { "text:i2:d-auth-note": "war nur scheinbar weg" },
    });
    await window.hydrateDraftFromBridge();
    expect(window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]').value)
      .toBe("war nur scheinbar weg");
  });

  test("degrades to local-only when the bridge is unreachable", async () => {
    const { window } = buildDom();
    window.fetch = () => Promise.reject(new Error("ECONNREFUSED"));
    const live = window.document.querySelector('[data-iteration="2"] [data-comment="d-auth-note"]');
    typeAsUser(window, live, "Bridge tot, tippe trotzdem");
    await window.flushDraft();
    await window.flushDraft();
    await window.flushDraft();
    // The text is still safe locally, and the user is told where it lives.
    expect(readBlob(window)["text:i2:d-auth-note"]).toBe("Bridge tot, tippe trotzdem");
    expect(window.document.querySelector(".draft-offline-strip")).toBeTruthy();
    expect(window.document.querySelector(".draft-offline-strip").hidden).toBe(false);
  });

  test("treats a 507 (bridge could not reach disk) as a failure, not a success", async () => {
    const { window } = buildDom();
    window.fetch = () => Promise.resolve({ ok: false, status: 507, json: () => Promise.resolve({}) });
    await window.flushDraft();
    await window.flushDraft();
    await window.flushDraft();
    expect(window.document.querySelector(".draft-offline-strip")).toBeTruthy();
  });
});

describe("comment durability — source-level invariants", () => {
  // Cheap to violate, expensive to notice: a future edit that reintroduces any
  // of these puts the whole guarantee back where it was.
  // Comments quote the old, deleted code on purpose (that is why the rule
  // exists) — the checks below must read the code, not the explanation.
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const engine = strip(PERSISTENCE_JS + "\n" + PANEL_RESET_JS);

  test("nothing deletes the state key", () => {
    const offenders = engine.match(/removeItem\([^)]*\)/g) || [];
    const bad = offenders.filter(o => !o.includes("-archive") && !o.includes("-pending"));
    expect(bad, "localStorage.removeItem on the state key").toEqual([]);
    expect(engine).not.toMatch(/removeItem\(\s*['"]concept-state-['"]\s*\+/);
  });

  test("every setItem goes through the guard", () => {
    const bare = (engine.match(/localStorage\.setItem\(/g) || []).length;
    // Exactly one: the one inside _guardedSetItem itself.
    expect(bare).toBe(1);
  });

  test("the frozen exclusions are in persistable()", () => {
    expect(engine).toMatch(/section\[data-iteration\]:not\(\[data-active\]\)/);
    expect(engine).toMatch(/viewing-frozen/);
    expect(engine).toMatch(/#feedback-dock/);
  });

  test("the submit path marks the dock instead of emptying it", () => {
    const submit = md.slice(md.indexOf("async function submitWithAction"));
    expect(submit.slice(0, 2000)).toMatch(/markDockSubmitted/);
    expect(md).not.toMatch(/if \(typeof clearDock === 'function'\) clearDock\(\);/);
  });
});
