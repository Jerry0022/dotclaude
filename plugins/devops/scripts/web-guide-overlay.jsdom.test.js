// Audit regressions for the overlay in a real DOM (jsdom): AUD-C007 (hostile
// page), C008 (same-step re-send after a reload), C036 (panel keys), C037
// (secret never in storage), C062 (empty options), C063 (clipboard), C064
// (visible labels). The fake-DOM suite in web-guide-overlay.test.js covers
// the timer-driven heartbeat (C038).
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const { withToken } = require("./web-guide.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, "web-guide-overlay.js"), "utf8");
const TOKEN = "0123456789abcdef0123456789abcdef";
const TOKENED = withToken(SRC, TOKEN);

const STEP = { id: "3", index: 3, total: 6, title: "Token erzeugen", text: "Klicke auf **Generate token**, dann Weiter." };
const SECRET_STEP = {
  id: "4", index: 4, total: 6, title: "Token eintragen", text: "Token einfügen.",
  input: { type: "secret", name: "github_token", label: "GitHub-Token", required: true },
};

function page({ session, pageScript, src = TOKENED } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body><input id=site></body></html>", {
    url: "https://site.example/settings/tokens",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  if (session) for (const [k, v] of Object.entries(session)) if (v !== null) w.sessionStorage.setItem(k, v);
  if (pageScript) w.eval(pageScript);
  let shadow = null;
  const orig = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (o) { shadow = orig.call(this, o); return shadow; };
  const result = w.eval(src);
  w.Element.prototype.attachShadow = orig;
  return { w, result, shadow: () => shadow, api: () => w.claudeGuide };
}

const btn = (p, text) => [...p.shadow().querySelectorAll("button")].find((b) => b.textContent === text);
const session = (p) => ({ __wg: p.w.sessionStorage.getItem("__wg"), "__wg.queue": p.w.sessionStorage.getItem("__wg.queue") });

describe("AUD-C008: the skill's recovery keeps a queued submit", () => {
  test("reload + re-inject + same-step setStep still delivers the click", async () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Weiter").click(); // nobody listening
    const b = page({ session: session(a) });
    expect(b.result).toBe("injected");
    expect(btn(b, "Weiter").disabled).toBe(true); // restored panel stays in its "sent" state
    expect(b.api().setStep(STEP, TOKEN)).toBe("ok");
    expect(b.api().state().queued).toBe(1);
    const ev = await b.api().wait(1000, TOKEN);
    expect(ev).toMatchObject({ type: "next", stepId: "3", restored: true, token: TOKEN });
  });

  test("a new step still drops the old step's queued events", async () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Weiter").click();
    a.api().setStep({ ...STEP, id: "4", index: 4 }, TOKEN);
    expect(a.api().state().queued).toBe(0);
  });

  test("Senden in the help box fires one event, then is disabled", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Ich komme nicht weiter").click();
    const send = btn(a, "Senden");
    send.click();
    send.click();
    expect(send.disabled).toBe(true);
    expect(a.api().state().queued).toBe(1);
  });
});

describe("AUD-C007: the hosting page cannot own the channel", () => {
  test("the global is frozen, non-writable and non-configurable", () => {
    const a = page();
    const d = Object.getOwnPropertyDescriptor(a.w, "claudeGuide");
    expect(d.writable).toBe(false);
    expect(d.configurable).toBe(false);
    expect(Object.isFrozen(a.api())).toBe(true);
    a.w.eval('window.claudeGuide = { version: "x" }; try { window.claudeGuide.wait = function () {}; } catch (e) {}');
    expect(a.api().version).toBe("1.10.0");
    expect(a.api().wait.length).toBe(2);
  });

  test("setStep/wait without the token are refused and cannot supersede Claude's wait", async () => {
    const a = page();
    expect(a.api().setStep(STEP)).toBe("bad-token");
    a.api().setStep(STEP, TOKEN);
    const claude = a.api().wait(5000, TOKEN);
    const pageWait = await a.api().wait(5000);
    expect(pageWait).toEqual({ type: "bad-token" });
    btn(a, "Weiter").click();
    expect(await claude).toMatchObject({ type: "next", stepId: "3", token: TOKEN });
  });

  test("a page-predefined non-configurable global blocks injection", () => {
    const a = page({ pageScript: 'Object.defineProperty(window, "claudeGuide", { value: {}, configurable: false });' });
    expect(a.result).toBe("blocked");
  });

  test("a page-predefined same-version global yields already-injected (hostile on a fresh document)", () => {
    const a = page({ pageScript: 'window.claudeGuide = { version: "1.10.0" };' });
    expect(a.result).toBe("already-injected");
    expect(a.w.document.querySelector("[id^=wg-host-]")).toBeNull();
  });

  test("a page-defined configurable global of another version is replaced", () => {
    const a = page({ pageScript: 'window.claudeGuide = { version: "0.0.1", destroy: function () {} };' });
    expect(a.result).toBe("injected");
    expect(a.api().version).toBe("1.10.0");
  });

  test("the token never reaches page-readable storage", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Weiter").click();
    expect(JSON.stringify(session(a))).not.toContain(TOKEN);
  });

  test("destroy() unmounts; a later setStep mounts again", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    a.api().destroy();
    expect(a.w.document.querySelector("[id^=wg-host-]")).toBeNull();
    expect(a.api().state().destroyed).toBe(true);
    a.api().setStep(STEP, TOKEN);
    expect(a.w.document.querySelector("[id^=wg-host-]")).not.toBeNull();
  });
});

describe("AUD-C036: panel keys work, page hotkeys stay blind", () => {
  function key(p, target, k) {
    const ev = new p.w.KeyboardEvent("keydown", { key: k, bubbles: true, composed: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
  }

  test("Enter in the input submits; the page's document listener never sees it", async () => {
    const a = page({ pageScript: "window.__seen = []; document.addEventListener('keydown', function (e) { window.__seen.push(e.key); });" });
    a.api().setStep({ ...STEP, input: { type: "text", name: "token_name", label: "Name" } }, TOKEN);
    const input = a.shadow().querySelector("input.f");
    input.focus();
    input.value = "web-guide-test";
    input.dispatchEvent(new a.w.Event("input", { bubbles: true, composed: true }));
    key(a, input, "Enter");
    expect(await a.api().wait(0, TOKEN)).toMatchObject({ type: "next", name: "token_name", value: "web-guide-test" });
    expect(a.w.__seen).toEqual([]);
  });

  test("Escape inside the panel collapses it", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    expect(a.api().state().collapsed).toBe(false);
    key(a, btn(a, "Weiter"), "Escape");
    expect(a.api().state().collapsed).toBe(true);
  });

  test("the FAB toggles on a keyboard click (detail 0)", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    const fab = a.shadow().querySelector("button.fab");
    fab.dispatchEvent(new a.w.MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(a.api().state().collapsed).toBe(true);
    fab.dispatchEvent(new a.w.MouseEvent("click", { bubbles: true, detail: 1 })); // pointer click: makeDraggable's job
    expect(a.api().state().collapsed).toBe(true);
  });
});

describe("AUD-C037: a secret is never persisted", () => {
  test("a secret submitted with no waiter stays in memory only, and a reload asks again", async () => {
    const a = page();
    a.api().setStep(SECRET_STEP, TOKEN);
    const input = a.shadow().querySelector("input.f");
    input.value = "ghp_SECRET";
    input.dispatchEvent(new a.w.Event("input", { bubbles: true, composed: true }));
    btn(a, "Weiter").click();
    const stored = JSON.stringify(session(a));
    expect(stored).not.toMatch(/ghp_SECRET|Z2hwX1NFQ1JFVA/);
    expect(stored).toContain("secretDropped");

    const b = page({ session: session(a) });
    expect(b.api().state().queued).toBe(0);
    expect(btn(b, "Weiter").disabled).toBe(true); // required + empty field
    expect(b.shadow().querySelector(".status").textContent).toContain("erneut eingeben");

    const ev = await a.api().wait(0, TOKEN); // same document: the value is still there
    expect(Buffer.from(ev.value, "base64").toString()).toBe("ghp_SECRET");
  });
});

describe("AUD-C062/C063/C064", () => {
  test("a restored text step with options: [] still renders", () => {
    const step = { ...STEP, input: { type: "text", name: "n", label: "Name", options: [] } };
    const saved = JSON.stringify({ step, collapsed: false, edgeTab: false, ts: Date.now() });
    const a = page({ session: { __wg: saved } });
    expect(a.api().state().stepId).toBe("3");
  });

  test("no Kopiert! when the clipboard write fails", async () => {
    const a = page(); // jsdom has no navigator.clipboard
    a.api().setStep({ ...STEP, copy: [{ value: "v" }] }, TOKEN);
    const copy = btn(a, "Kopieren");
    copy.click();
    await Promise.resolve();
    expect(copy.textContent).toBe("Kopieren fehlgeschlagen");
  });

  test("text inputs carry a visible label tied to the field", () => {
    const a = page();
    a.api().setStep(SECRET_STEP, TOKEN);
    const label = a.shadow().querySelector("label.lbl");
    expect(label.textContent).toBe("GitHub-Token");
    expect(a.shadow().getElementById(label.htmlFor)).toBe(a.shadow().querySelector("input.f"));
  });
});
