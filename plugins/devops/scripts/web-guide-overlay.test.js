import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.join(__dirname, "web-guide-overlay.js");
const SRC = fs.readFileSync(SRC_PATH, "utf8");
// Raw-source budget. This is an anti-bloat guard, not a hard technical limit:
// `web-guide.js payload inject` strips comments/whitespace (leanSource())
// before the source ever reaches a transcript, so growth here doesn't scale
// injection cost 1:1. Raised from 24 KB for #513/#514's new fields (location,
// copy[], checklist[], heartbeat, sessionStorage-persisted queue, FAB icon).
const MAX_BYTES = 34 * 1024;
const MAX_LINE_LENGTH = 200;

// ---- minimal fake DOM, just enough to execute the overlay source ----

function makeStore() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    _data: data,
  };
}

function makeElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag || "").toUpperCase(),
    children: [],
    style: {},
    attrs: {},
    parentNode: null,
    value: "",
    checked: false,
    type: "",
    rows: 0,
    placeholder: "",
    disabled: false,
    className: "",
    id: "",
    _text: "",
    _html: "",
    appendChild(c) {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const arr = listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    click() { (listeners.click || []).forEach((fn) => fn({ type: "click" })); },
    dispatch(type, evt) { (listeners[type] || []).forEach((fn) => fn(evt || { type })); },
    focus() { this._focusCalled = true; },
    _pointerCaptures: [],
    setPointerCapture(id) { this._pointerCaptures.push(id); },
    // `opts.mode === "closed"` must NOT publish `shadowRoot` (real DOM behavior).
    // `_shadow` is an internal test-only handle so findAll() can still walk in.
    attachShadow(opts) {
      const sr = makeElement("shadow-root");
      this._shadowOpts = opts;
      this._shadow = sr;
      if (!opts || opts.mode !== "closed") this.shadowRoot = sr;
      return sr;
    },
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._html; },
    set(v) { this._html = v; this.children = []; },
  });
  Object.defineProperty(el, "textContent", {
    get() { return this._text; },
    set(v) { this._text = v; },
  });
  return el;
}

function childrenOf(el) {
  const kids = el.children || [];
  return el._shadow ? kids.concat(el._shadow) : kids;
}

function findAll(root, pred, out = []) {
  if (!root) return out;
  for (const c of childrenOf(root)) {
    if (pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}

// Host id is now random ("wg-host-" + random suffix), so tests locate it by
// prefix instead of a fixed id.
function getHost(sandbox) {
  return sandbox.document.documentElement.children.find(
    (c) => typeof c.id === "string" && c.id.indexOf("wg-host-") === 0
  );
}

function makeSandbox({ setTimeoutFn, clearTimeoutFn } = {}) {
  const docListeners = {};
  const winListeners = {}; // `${type}:${capture}` -> [fn]
  const documentElement = makeElement("html");
  const sessionStorage = makeStore();
  const localStorage = makeStore();
  const document = {
    documentElement,
    createElement: makeElement,
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    _dispatch(type, evt) { (docListeners[type] || []).forEach((fn) => fn(evt || {})); },
  };
  const window = {
    innerWidth: 1280,
    innerHeight: 800,
    location: { href: "https://example.test/page" },
    addEventListener(type, fn, capture) {
      const key = type + ":" + !!capture;
      (winListeners[key] = winListeners[key] || []).push(fn);
    },
    removeEventListener(type, fn, capture) {
      const arr = winListeners[type + ":" + !!capture];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    _dispatch(type, capture, evt) {
      (winListeners[type + ":" + !!capture] || []).forEach((fn) => fn(evt));
    },
    _listenerCount(type, capture) {
      return (winListeners[type + ":" + !!capture] || []).length;
    },
    setTimeout: setTimeoutFn || setTimeout,
    clearTimeout: clearTimeoutFn || clearTimeout,
  };
  const sandbox = {
    window,
    document,
    sessionStorage,
    localStorage,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    console,
    navigator: { clipboard: { writeText: () => {} } },
    // Pass the outer realm's Date through so fake timers (which patch it) can
    // also advance the vm sandbox's Date.now() — a vm.createContext otherwise
    // gets its own, unrelated Date built-in.
    Date,
  };
  vm.createContext(sandbox);
  return sandbox;
}

function run(sandbox) {
  const script = new vm.Script(SRC, { filename: "web-guide-overlay.js" });
  return script.runInContext(sandbox);
}

describe("web-guide-overlay — shape", () => {
  test("source is at most 24 KB", () => {
    expect(Buffer.byteLength(SRC, "utf8")).toBeLessThanOrEqual(MAX_BYTES);
  });

  // Anti-minification guard: a hand-formatted file never needs a 200+ char line.
  test("no line exceeds 200 characters", () => {
    const longLines = SRC.split("\n").filter((line) => line.length > MAX_LINE_LENGTH);
    expect(longLines).toEqual([]);
  });

  test("parses as a script", () => {
    expect(() => new vm.Script(SRC)).not.toThrow();
  });

  test("defines VERSION 1.6.0, setStep/wait/state/destroy, and touches sessionStorage", () => {
    expect(SRC).toMatch(/VERSION\s*=\s*["']1.6.0["']/);
    expect(SRC).toMatch(/window.claudeGuide\s*=/);
    expect(SRC).toMatch(/setStep\s*:/);
    expect(SRC).toMatch(/wait\s*:/);
    expect(SRC).toMatch(/state\s*:/);
    expect(SRC).toMatch(/destroy\s*:/);
    expect(SRC).toMatch(/sessionStorage/);
  });

  test("last statement is the IIFE call (self-invoking, no trailing junk)", () => {
    const trimmed = SRC.trimEnd();
    expect(trimmed.endsWith("})();")).toBe(true);
  });

  test("attaches a closed shadow root with a non-fixed host id", () => {
    expect(SRC).toMatch(/attachShadow\(\s*\{\s*mode:\s*["']closed["']\s*\}\s*\)/);
    expect(SRC).toMatch(/wg-host-/);
  });
});

describe("web-guide-overlay — execution", () => {
  let sandbox;

  beforeEach(() => {
    sandbox = makeSandbox();
  });

  test("injects, exposes window.claudeGuide with the full API", () => {
    const result = run(sandbox);
    expect(result).toBe("injected");
    expect(sandbox.window.claudeGuide).toBeTruthy();
    expect(sandbox.window.claudeGuide.version).toBe("1.6.0");
    expect(typeof sandbox.window.claudeGuide.setStep).toBe("function");
    expect(typeof sandbox.window.claudeGuide.wait).toBe("function");
    expect(typeof sandbox.window.claudeGuide.state).toBe("function");
    expect(typeof sandbox.window.claudeGuide.destroy).toBe("function");
  });

  test("is idempotent: second injection is a no-op", () => {
    const first = run(sandbox);
    const second = run(sandbox);
    expect(first).toBe("injected");
    expect(second).toBe("already-injected");
  });

  test("state() reports version, stepId, collapsed, queued, url", () => {
    run(sandbox);
    const s = sandbox.window.claudeGuide.state();
    expect(s).toMatchObject({ version: "1.6.0", stepId: null, queued: 0 });
    expect(s.url).toBe("https://example.test/page");
  });

  // Fix 1: closed shadow root, random host id.
  test("host uses a closed shadow root and a randomized id", () => {
    run(sandbox);
    const host = getHost(sandbox);
    expect(host).toBeTruthy();
    expect(host.id).not.toBe("wg-host");
    expect(host.id.indexOf("wg-host-")).toBe(0);
    expect(host._shadowOpts).toEqual({ mode: "closed" });
    expect(host.shadowRoot).toBeFalsy(); // closed: not publicly reachable
  });

  test("escapes HTML and applies only bold/code/br marks", () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({
      id: "1",
      index: 1,
      total: 2,
      title: "Step",
      text: "<script>alert(1)</script> **bold** `code` line1\nline2",
    });
    const host = getHost(sandbox);
    const texts = findAll(host, (e) => e._html && e._html.indexOf("bold") !== -1);
    expect(texts.length).toBeGreaterThan(0);
    const html = texts[0]._html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("line1<br>line2");
  });

  test("wait() delivers a queued event before waiting for a new one", async () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });
    const host = getHost(sandbox);
    const primary = findAll(host, (e) => e.tagName === "BUTTON" && e.textContent === "Weiter")[0];
    expect(primary).toBeTruthy();
    primary.click();
    const ev = await sandbox.window.claudeGuide.wait(1000);
    expect(ev.type).toBe("next");
    expect(ev.stepId).toBe("1");
  });

  test("wait() times out with {type:'timeout'} when nothing happens", async () => {
    vi.useFakeTimers();
    try {
      const sb = makeSandbox({
        setTimeoutFn: (...a) => setTimeout(...a),
        clearTimeoutFn: (...a) => clearTimeout(...a),
      });
      run(sb);
      sb.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });
      const p = sb.window.claudeGuide.wait(5000);
      await vi.advanceTimersByTimeAsync(5000);
      const ev = await p;
      expect(ev).toEqual({ type: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("drops a stale click from a step that is no longer current", async () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({ id: "1", index: 1, total: 2, title: "T1", text: "go" });
    const host = getHost(sandbox);
    const staleBtn = findAll(host, (e) => e.tagName === "BUTTON" && e.textContent === "Weiter")[0];

    // advance to step 2 before the stale button is clicked
    sandbox.window.claudeGuide.setStep({ id: "2", index: 2, total: 2, title: "T2", text: "go", done: true });

    staleBtn.click(); // click on the (now replaced) step-1 button — must be dropped
    const state = sandbox.window.claudeGuide.state();
    expect(state.queued).toBe(0);
  });

  test("never writes a secret value to storage", () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({
      id: "1",
      index: 1,
      total: 1,
      title: "Token",
      text: "Paste it",
      input: { type: "secret", name: "token", label: "Token" },
    });
    const host = getHost(sandbox);
    const secretInput = findAll(host, (e) => e.type === "password")[0];
    expect(secretInput).toBeTruthy();
    secretInput.value = "sk-super-secret-value";

    const collapseBtn = findAll(host, (e) => e.getAttribute && e.getAttribute("aria-label") === "Einklappen")[0];
    collapseBtn.click(); // triggers saveState()

    const sessionRaw = JSON.stringify(sandbox.sessionStorage._data);
    const localRaw = JSON.stringify(sandbox.localStorage._data);
    expect(sessionRaw).not.toContain("sk-super-secret-value");
    expect(localRaw).not.toContain("sk-super-secret-value");
  });

  // Fix 2: secret values leave the panel base64-encoded (UTF-8 safe).
  test("secret submit sends a base64-encoded value with encoding:'base64'", async () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({
      id: "1",
      index: 1,
      total: 1,
      title: "Token",
      text: "Paste it",
      input: { type: "secret", name: "token" },
    });
    const host = getHost(sandbox);
    const secretInput = findAll(host, (e) => e.type === "password")[0];
    secretInput.value = "geheüim-wört-ü"; // contains umlauts
    const submitBtn = findAll(host, (e) => e.tagName === "BUTTON" && e.textContent === "Weiter")[0];
    submitBtn.click();
    const ev = await sandbox.window.claudeGuide.wait(1000);
    expect(ev.encoding).toBe("base64");
    expect(ev.value).not.toBe("geheüim-wört-ü");
    const decoded = decodeURIComponent(escape(Buffer.from(ev.value, "base64").toString("binary")));
    expect(decoded).toBe("geheüim-wört-ü");
  });

  test("non-secret submit carries no encoding field", async () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({
      id: "1",
      index: 1,
      total: 1,
      title: "Name",
      text: "go",
      input: { type: "text", name: "name" },
    });
    const host = getHost(sandbox);
    const submitBtn = findAll(host, (e) => e.tagName === "BUTTON" && e.textContent === "Weiter")[0];
    submitBtn.click();
    const ev = await sandbox.window.claudeGuide.wait(1000);
    expect(ev.encoding).toBeUndefined();
  });

  // Fix 3: storage restore is validated, never throws.
  test("corrupt localStorage pos ('null') never breaks injection", () => {
    sandbox.localStorage.setItem("__wg.pos", "null");
    const result = run(sandbox);
    expect(result).toBe("injected");
    expect(sandbox.window.claudeGuide.state().stepId).toBe(null);
  });

  test("bogus sessionStorage step (options as a string) is discarded", () => {
    sandbox.sessionStorage.setItem(
      "__wg",
      JSON.stringify({
        step: {
          id: "1",
          index: 1,
          total: 1,
          title: "T",
          text: "go",
          input: { type: "choice", name: "n", options: "x" },
        },
        collapsed: false,
        ts: Date.now(),
      })
    );
    run(sandbox);
    expect(sandbox.window.claudeGuide.state().stepId).toBe(null);
  });

  test("a step older than 30 minutes is discarded", () => {
    sandbox.sessionStorage.setItem(
      "__wg",
      JSON.stringify({
        step: { id: "1", index: 1, total: 1, title: "T", text: "go" },
        collapsed: false,
        ts: Date.now() - 31 * 60 * 1000,
      })
    );
    run(sandbox);
    expect(sandbox.window.claudeGuide.state().stepId).toBe(null);
  });

  test("a valid, recent step is restored", () => {
    sandbox.sessionStorage.setItem(
      "__wg",
      JSON.stringify({
        step: { id: "1", index: 1, total: 2, title: "T", text: "go" },
        collapsed: false,
        ts: Date.now(),
      })
    );
    run(sandbox);
    expect(sandbox.window.claudeGuide.state().stepId).toBe("1");
  });

  // Fix 4: stale "Warte auf Claude…" recovery.
  // #513: heartbeat replaces the old 45s "Keine Antwort" guess. The event is
  // queued (and now sessionStorage-backed), so the UI stays disabled — no
  // false invitation to resubmit — but the label distinguishes "Claude simply
  // isn't polling right now" from a lost event.
  test("shows the heartbeat message after 10s without a poll, without re-enabling buttons", async () => {
    vi.useFakeTimers();
    try {
      const sb = makeSandbox({
        setTimeoutFn: (...a) => setTimeout(...a),
        clearTimeoutFn: (...a) => clearTimeout(...a),
      });
      run(sb);
      sb.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });
      const host = getHost(sb);
      const primary = findAll(host, (e) => e.tagName === "BUTTON" && e.textContent === "Weiter")[0];
      primary.click();
      expect(primary.disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(13000); // past a 2s heartbeat tick beyond the 10s stale mark
      expect(primary.disabled).toBe(true);
      const label = findAll(host, (e) => e._text === "Claude hört gerade nicht zu — schreib im Chat „weiter“.")[0];
      expect(label).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // #513: every wait() call is a poll — it resets the heartbeat's staleness
  // clock even when it immediately resolves from the persisted queue.
  test("wait() resets the heartbeat clock (a poll is a poll, even a queued one)", async () => {
    vi.useFakeTimers();
    try {
      const sb = makeSandbox({
        setTimeoutFn: (...a) => setTimeout(...a),
        clearTimeoutFn: (...a) => clearTimeout(...a),
      });
      run(sb);
      sb.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });
      const host = getHost(sb);
      const primary = findAll(host, (e) => e.tagName === "BUTTON" && e.textContent === "Weiter")[0];
      primary.click();
      await sb.window.claudeGuide.wait(1000); // resolves immediately from the queue, still a poll
      await vi.advanceTimersByTimeAsync(2000);
      const label = findAll(host, (e) => e._text === "Warte auf Claude…")[0];
      expect(label).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // #513: a queued event is persisted so a reload doesn't drop it.
  test("persists a queued event in sessionStorage and restores it on re-injection", () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });
    const host = getHost(sandbox);
    const primary = findAll(host, (e) => e.tagName === "BUTTON" && e.textContent === "Weiter")[0];
    primary.click();
    expect(sandbox.window.claudeGuide.state().queued).toBe(1);
    expect(sandbox.sessionStorage._data["__wg.queue"]).toBeTruthy();

    // Simulate a reload: a fresh JS context reading the SAME sessionStorage
    // (destroy() is never called on reload — the old context is just gone).
    const sb2 = makeSandbox();
    sb2.sessionStorage._data["__wg.queue"] = sandbox.sessionStorage._data["__wg.queue"];
    sb2.sessionStorage._data.__wg = sandbox.sessionStorage._data.__wg;
    run(sb2);
    expect(sb2.window.claudeGuide.state().queued).toBe(1);
  });

  // #513: the FAB carries a visible glyph, not just the step badge.
  test("the FAB has an icon glyph, not an empty circle", () => {
    run(sandbox);
    const host = getHost(sandbox);
    const icon = findAll(host, (e) => e._html && e._html.indexOf("<svg") !== -1)[0];
    expect(icon).toBeTruthy();
  });

  // Fix 5: pendingWaiter per call — timeout for A must not clear B's resolver.
  test("an overlapping wait's timeout does not orphan the next wait's resolver", async () => {
    vi.useFakeTimers();
    try {
      const sb = makeSandbox({
        setTimeoutFn: (...a) => setTimeout(...a),
        clearTimeoutFn: (...a) => clearTimeout(...a),
      });
      run(sb);
      sb.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });

      const waitA = sb.window.claudeGuide.wait(1000);
      const waitB = sb.window.claudeGuide.wait(60000);

      await vi.advanceTimersByTimeAsync(1000);
      const evA = await waitA;
      expect(evA).toEqual({ type: "timeout" });

      const host = getHost(sb);
      const primary = findAll(host, (e) => e.tagName === "BUTTON" && e.textContent === "Weiter")[0];
      primary.click();
      const evB = await waitB;
      expect(evB.type).toBe("next");
    } finally {
      vi.useRealTimers();
    }
  });

  // Fix 6: abort confirmation resets on re-render.
  test("a re-render clears the pending abort confirmation", () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });
    const host = getHost(sandbox);
    let abortBtn = findAll(host, (e) => e.tagName === "BUTTON" && e.textContent === "Abbrechen")[0];
    abortBtn.click(); // arms the confirmation

    const collapseBtn = findAll(host, (e) => e.getAttribute && e.getAttribute("aria-label") === "Einklappen")[0];
    collapseBtn.click(); // re-render via collapse — must reset the armed confirmation

    sandbox.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });
    abortBtn = findAll(getHost(sandbox), (e) => e.tagName === "BUTTON" && e.textContent === "Abbrechen")[0];
    abortBtn.click(); // single click after re-render must only arm, not fire

    const state = sandbox.window.claudeGuide.state();
    expect(state.queued).toBe(0);
  });

  // #514: location block, copy chips, checklist.
  test("renders a location block, copy chips with a working clipboard button, and a checklist", () => {
    sandbox.navigator.clipboard.writeText = vi.fn();
    run(sandbox);
    sandbox.window.claudeGuide.setStep({
      id: "1", index: 1, total: 1, title: "T", text: "go",
      location: "Account API tokens → Create Token",
      copy: [{ label: "Token name", value: "web-guide-test" }],
      checklist: ["Scope contents:read gesetzt", "Ablaufdatum gewählt"],
    });
    const host = getHost(sandbox);

    const loc = findAll(host, (e) => e._text && e._text.indexOf("Account API tokens") !== -1)[0];
    expect(loc).toBeTruthy();

    const chipCode = findAll(host, (e) => e.tagName === "CODE" && e._text === "web-guide-test")[0];
    expect(chipCode).toBeTruthy();
    const copyBtn = findAll(host, (e) => e.tagName === "BUTTON" && e._text.indexOf("Kopieren") !== -1)[0];
    copyBtn.click();
    expect(sandbox.navigator.clipboard.writeText).toHaveBeenCalledWith("web-guide-test");
    expect(copyBtn.textContent).toBe("Kopiert!");

    const checklistItems = findAll(host, (e) => e.tagName === "LI");
    expect(checklistItems.length).toBe(2);
    const checkboxes = findAll(host, (e) => e.type === "checkbox");
    expect(checkboxes.length).toBe(2);
  });

  // #514: a step without the optional fields renders exactly as before.
  test("location/copy/checklist are optional — a plain step renders unchanged", () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });
    const host = getHost(sandbox);
    expect(findAll(host, (e) => e.className === "loc").length).toBe(0);
    expect(findAll(host, (e) => e.className === "copylist").length).toBe(0);
    expect(findAll(host, (e) => e.className === "checklist").length).toBe(0);
  });

  // #514: a malformed checklist (outside 2-4 items) is rejected by sanitizeStep
  // when restored from storage — same defensive posture as every other field.
  test("a checklist outside 2-4 items is discarded on restore", () => {
    sandbox.sessionStorage.setItem(
      "__wg",
      JSON.stringify({
        step: { id: "1", index: 1, total: 1, title: "T", text: "go", checklist: ["only one"] },
        collapsed: false,
        ts: Date.now(),
      })
    );
    run(sandbox);
    expect(sandbox.window.claudeGuide.state().stepId).toBe(null);
  });

  // #516: a pointerdown that starts on the collapse button must not arm the
  // header's drag/pointer-capture — capturing on the header would route the
  // matching click away from the button in a real browser.
  test("pointerdown on the collapse button skips setPointerCapture on the draggable header", () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({ id: "1", index: 1, total: 1, title: "T", text: "go" });
    const host = getHost(sandbox);
    const collapseBtn = findAll(host, (e) => e.getAttribute && e.getAttribute("aria-label") === "Einklappen")[0];
    const head = collapseBtn.parentNode;

    head.dispatch("pointerdown", {
      type: "pointerdown", pointerId: 1, clientX: 0, clientY: 0,
      target: collapseBtn, composedPath: () => [collapseBtn, head],
    });
    expect(head._pointerCaptures).toEqual([]);
    head.dispatch("pointerup", { type: "pointerup", pointerId: 1, target: collapseBtn, composedPath: () => [collapseBtn, head] });

    // Real pointerdown/pointerup + click on the button itself (not a synthetic
    // el.click() bypassing pointer events) must still collapse the panel.
    collapseBtn.dispatch("pointerdown", { type: "pointerdown", pointerId: 2, target: collapseBtn, composedPath: () => [collapseBtn] });
    collapseBtn.dispatch("pointerup", { type: "pointerup", pointerId: 2, target: collapseBtn, composedPath: () => [collapseBtn] });
    collapseBtn.dispatch("click", { type: "click", target: collapseBtn });

    expect(sandbox.window.claudeGuide.state().collapsed).toBe(true);

    // Dragging the header itself (pointerdown target = head) still arms capture.
    head.dispatch("pointerdown", { type: "pointerdown", pointerId: 3, clientX: 0, clientY: 0, target: head, composedPath: () => [head] });
    expect(head._pointerCaptures).toEqual([3]);
  });

  // #507: a corrective/re-sent step must not pull focus out of a page field
  // the user is actively typing into.
  test("setStep does not steal focus when a page field outside the overlay is focused", () => {
    run(sandbox);
    const pageInput = sandbox.document.createElement("input");
    sandbox.document.activeElement = pageInput;

    sandbox.window.claudeGuide.setStep({
      id: "1", index: 1, total: 1, title: "T", text: "go",
      input: { type: "text", name: "n" },
    });

    const host = getHost(sandbox);
    const overlayInput = findAll(host, (e) => e.tagName === "INPUT")[0];
    expect(overlayInput._focusCalled).toBeFalsy();
    expect(pageInput._focusCalled).toBeFalsy(); // untouched, still holds focus

    // Once nothing on the page holds focus (activeElement is body/null), a
    // NEW step may focus the panel again.
    sandbox.document.activeElement = null;
    sandbox.window.claudeGuide.setStep({
      id: "2", index: 2, total: 1, title: "T2", text: "go",
      input: { type: "text", name: "n" },
    });
    const overlayInput2 = findAll(getHost(sandbox), (e) => e.tagName === "INPUT")[0];
    expect(overlayInput2._focusCalled).toBe(true);
  });

  // #507: re-sending the same step id must neither re-expand a collapsed
  // panel nor steal focus, even when the page has no active element.
  test("a same-id re-send does not steal focus even when the page is idle", () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({
      id: "1", index: 1, total: 1, title: "T", text: "go",
      input: { type: "text", name: "n" },
    });
    const firstInput = findAll(getHost(sandbox), (e) => e.tagName === "INPUT")[0];
    expect(firstInput._focusCalled).toBe(true);

    sandbox.window.claudeGuide.setStep({
      id: "1", index: 1, total: 1, title: "T", text: "go, edited",
      input: { type: "text", name: "n" },
    });
    const secondInput = findAll(getHost(sandbox), (e) => e.tagName === "INPUT")[0];
    expect(secondInput._focusCalled).toBeFalsy();
  });

  // #516: re-sending / re-injecting the same step id must not force the
  // panel open again once the user collapsed it.
  test("setStep keeps the user's collapsed state when the step id is unchanged", () => {
    run(sandbox);
    sandbox.window.claudeGuide.setStep({ id: "1", index: 1, total: 2, title: "T1", text: "go" });
    expect(sandbox.window.claudeGuide.state().collapsed).toBe(false);

    const host = getHost(sandbox);
    const collapseBtn = findAll(host, (e) => e.getAttribute && e.getAttribute("aria-label") === "Einklappen")[0];
    collapseBtn.click();
    expect(sandbox.window.claudeGuide.state().collapsed).toBe(true);

    // Same id re-sent (re-send / re-inject) — stays collapsed.
    sandbox.window.claudeGuide.setStep({ id: "1", index: 1, total: 2, title: "T1", text: "go, edited" });
    expect(sandbox.window.claudeGuide.state().collapsed).toBe(true);

    // A genuinely new step opens the panel again.
    sandbox.window.claudeGuide.setStep({ id: "2", index: 2, total: 2, title: "T2", text: "go" });
    expect(sandbox.window.claudeGuide.state().collapsed).toBe(false);
  });

  // Fix 7: capture-phase key isolation.
  test("stops keydown at the window capture phase when it targets the host", () => {
    run(sandbox);
    let sawIt = false;
    const composedPath = () => [getHost(sandbox)];
    const evt = {
      key: "a",
      composedPath,
      stopPropagation() { sawIt = true; },
    };
    sandbox.window._dispatch("keydown", true, evt);
    expect(sawIt).toBe(true);
  });

  test("does not stop propagation for events outside the host", () => {
    run(sandbox);
    let sawIt = false;
    const evt = {
      key: "a",
      composedPath: () => [{ id: "some-other-element" }],
      stopPropagation() { sawIt = true; },
    };
    sandbox.window._dispatch("keydown", true, evt);
    expect(sawIt).toBe(false);
  });

  // Fix 8: destroy() removes window/document listeners it added and clears timers.
  test("destroy() removes the host, the global, and all window listeners", () => {
    run(sandbox);
    expect(sandbox.window._listenerCount("resize", false)).toBeGreaterThan(0);
    expect(sandbox.window._listenerCount("keydown", true)).toBeGreaterThan(0);

    sandbox.window.claudeGuide.destroy();

    expect(sandbox.window.claudeGuide).toBeUndefined();
    expect(getHost(sandbox)).toBeUndefined();
    expect(sandbox.window._listenerCount("resize", false)).toBe(0);
    expect(sandbox.window._listenerCount("keydown", true)).toBe(0);
    expect(sandbox.window._listenerCount("keypress", true)).toBe(0);
    expect(sandbox.window._listenerCount("keyup", true)).toBe(0);
  });
});

describe("web-guide-overlay — app-styled FAB tooltip (ui-defaults.md R0/R1)", () => {
  test("the FAB has no native title, but a role=tooltip bubble in the overlay's own style", () => {
    expect(SRC).not.toMatch(/\.title\s*=(?!=)/);
    expect(SRC).not.toMatch(/setAttribute\("title"/);
    expect(SRC).toMatch(/fabTip\.setAttribute\("role", "tooltip"\)/);
    expect(SRC, "Label tier: the tip is the FAB's only visible name").toMatch(/setTimeout\(showFabTip, 500\)/);
    expect(SRC, "styled in both colour schemes").toMatch(/\.tip\{background:#1e1e24/);
  });

  test("the scrolling panel wears the overlay's scrollbar skin (ui-defaults.md R5)", () => {
    expect(SRC).toMatch(/\.panel\{scrollbar-width:thin;scrollbar-color:#ccc transparent\}/);
    expect(SRC, "WebKit fallback").toMatch(/\.panel::-webkit-scrollbar-thumb\{background:#ccc/);
    expect(SRC, "dark scheme").toMatch(/\.panel\{background:#1e1e24;scrollbar-color:#444 transparent\}/);
    expect(SRC, "native parts follow the scheme").toMatch(/:host\{[^}]*color-scheme:light dark/);
  });
});
