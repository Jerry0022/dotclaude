import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.join(__dirname, "web-guide-overlay.js");
const SRC = fs.readFileSync(SRC_PATH, "utf8");
const MAX_BYTES = 20 * 1024;
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
    removeEventListener() {},
    click() { (listeners.click || []).forEach((fn) => fn({ type: "click" })); },
    focus() {},
    attachShadow() {
      const sr = makeElement("shadow-root");
      this.shadowRoot = sr;
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
  return el.shadowRoot ? kids.concat(el.shadowRoot) : kids;
}

function findAll(root, pred, out = []) {
  for (const c of childrenOf(root)) {
    if (pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}

function findById(root, id) {
  return findAll(root, (e) => e.id === id)[0] || null;
}

function makeSandbox({ setTimeoutFn, clearTimeoutFn } = {}) {
  const docListeners = {};
  const documentElement = makeElement("html");
  const sessionStorage = makeStore();
  const localStorage = makeStore();
  const document = {
    documentElement,
    createElement: makeElement,
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    getElementById: (id) => findById(documentElement, id),
    _dispatch(type, evt) { (docListeners[type] || []).forEach((fn) => fn(evt || {})); },
  };
  const window = {
    innerWidth: 1280,
    innerHeight: 800,
    location: { href: "https://example.test/page" },
    addEventListener() {},
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
    console,
  };
  vm.createContext(sandbox);
  return sandbox;
}

function run(sandbox) {
  const script = new vm.Script(SRC, { filename: "web-guide-overlay.js" });
  return script.runInContext(sandbox);
}

describe("web-guide-overlay — shape", () => {
  test("source is at most 20 KB", () => {
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

  test("defines VERSION, setStep/wait/state/destroy, and touches sessionStorage", () => {
    expect(SRC).toMatch(/VERSION\s*=\s*["']1\.0\.0["']|["']1\.0\.0["']/);
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
    expect(sandbox.window.claudeGuide.version).toBe("1.0.0");
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
    expect(s).toMatchObject({ version: "1.0.0", stepId: null, queued: 0 });
    expect(s.url).toBe("https://example.test/page");
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
    const host = sandbox.document.getElementById("wg-host");
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
    const host = sandbox.document.getElementById("wg-host");
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
    const host = sandbox.document.getElementById("wg-host");
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
    const host = sandbox.document.getElementById("wg-host");
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

  test("destroy() removes the host and the global", () => {
    run(sandbox);
    sandbox.window.claudeGuide.destroy();
    expect(sandbox.window.claudeGuide).toBeUndefined();
    expect(sandbox.document.getElementById("wg-host")).toBeNull();
  });
});
