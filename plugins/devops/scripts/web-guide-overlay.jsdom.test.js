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
    expect(a.api().version).toBe("1.13.0");
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
    const a = page({ pageScript: 'window.claudeGuide = { version: "1.13.0" };' });
    expect(a.result).toBe("already-injected");
    expect(a.w.document.querySelector("[id^=wg-host-]")).toBeNull();
  });

  test("a page-defined configurable global of another version is replaced", () => {
    const a = page({ pageScript: 'window.claudeGuide = { version: "0.0.1", destroy: function () {} };' });
    expect(a.result).toBe("injected");
    expect(a.api().version).toBe("1.13.0");
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
    a.api().destroy(TOKEN);
    expect(a.w.document.querySelector("[id^=wg-host-]")).toBeNull();
    expect(a.api().state().destroyed).toBe(true);
    a.api().setStep(STEP, TOKEN);
    expect(a.w.document.querySelector("[id^=wg-host-]")).not.toBeNull();
  });

  // Finding 7: destroy() requires the channel token, same as setStep/wait —
  // a page script (which never has the token) can no longer wipe the
  // overlay's queued answers/state out from under Claude.
  test("destroy() without the token is refused; the overlay stays mounted", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    expect(a.api().destroy()).toBe("bad-token");
    expect(a.w.document.querySelector("[id^=wg-host-]")).not.toBeNull();
    expect(a.api().state().destroyed).toBe(false);
    expect(a.api().destroy(TOKEN)).toBe("ok");
    expect(a.api().state().destroyed).toBe(true);
  });

  // Finding 7: a page cannot intercept the token via a setter it defines on
  // Object.prototype for the field name "token" — outgoing events are built
  // with Object.create(null) + Object.defineProperty, which never invokes an
  // inherited setter.
  test("a page setter on Object.prototype for 'token' never sees it", async () => {
    const a = page();
    let seen = null;
    a.w.Object.defineProperty(a.w.Object.prototype, "token", {
      configurable: true,
      set(v) { seen = v; },
      get() { return undefined; },
    });
    try {
      a.api().setStep(STEP, TOKEN);
      btn(a, "Weiter").click();
      const ev = await a.api().wait(1000, TOKEN);
      expect(ev.token).toBe(TOKEN);
      expect(seen).toBeNull();
    } finally {
      delete a.w.Object.prototype.token;
    }
  });

  // Finding 7: `payload wait`'s eval snippet serializes through
  // claudeGuide.stringify() — the native JSON.stringify captured at
  // injection time — so a page that patches the GLOBAL JSON.stringify after
  // injection never sees the token (or any other event field) go through it.
  test("a patched JSON.stringify after injection never sees the token", async () => {
    const a = page();
    // The overlay itself still calls the (now patched) global JSON.stringify
    // for unrelated internal bookkeeping (saveState/saveQueue) — that is not
    // what Finding 7 protects. What must never happen is the TOKEN reaching
    // that patched function through the channel's own serialization path.
    let sawToken = false;
    const realStringify = a.w.JSON.stringify;
    a.w.JSON.stringify = function (...args) {
      const out = realStringify.apply(a.w.JSON, args);
      if (typeof out === "string" && out.includes(TOKEN)) sawToken = true;
      return out;
    };
    try {
      a.api().setStep(STEP, TOKEN);
      btn(a, "Weiter").click();
      const ev = await a.api().wait(1000, TOKEN);
      const serialized = a.api().stringify(ev); // channel's own serialization: native, never the patched global
      expect(serialized).toContain(TOKEN);
      expect(sawToken).toBe(false); // the patched global never saw the token
    } finally {
      a.w.JSON.stringify = realStringify;
    }
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
    // Fix 9: the failure message now names a next step, not a dead end.
    expect(copy.textContent).toBe("Kopieren fehlgeschlagen – Wert markieren und mit Strg+C kopieren");
  });

  test("text inputs carry a visible label tied to the field", () => {
    const a = page();
    a.api().setStep(SECRET_STEP, TOKEN);
    const label = a.shadow().querySelector("label.lbl");
    expect(label.textContent).toBe("GitHub-Token");
    expect(a.shadow().getElementById(label.htmlFor)).toBe(a.shadow().querySelector("input.f"));
  });
});

describe("harden pass: focus hand-off, labelled options, live status", () => {
  const key = (p, target, k) => target.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: k, bubbles: true, composed: true, cancelable: true }));

  test("collapsing by Escape or – hands keyboard focus to the FAB, » to the edge tab", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    key(a, btn(a, "Weiter"), "Escape");
    expect(a.shadow().activeElement).toBe(a.shadow().querySelector("button.fab"));

    const b = page();
    b.api().setStep(STEP, TOKEN);
    b.shadow().querySelector('button.collapse[aria-label="Einklappen"]').click();
    expect(b.shadow().activeElement).toBe(b.shadow().querySelector("button.fab"));

    const c = page();
    c.api().setStep(STEP, TOKEN);
    c.shadow().querySelector('button.collapse[aria-label="Guide ausblenden"]').click();
    expect(c.shadow().activeElement).toBe(c.shadow().querySelector("button.edgetab"));
  });

  test("choice options point back at their question", () => {
    const a = page();
    a.api().setStep({ ...STEP, input: { type: "choice", name: "region", label: "Welche Region?", options: ["EU", "US"] } }, TOKEN);
    const question = [...a.shadow().querySelectorAll("p.lbl")].find((el) => el.textContent === "Welche Region?");
    expect(question.id).toMatch(/^wg-q-/);
    for (const option of ["EU", "US"]) expect(btn(a, option).getAttribute("aria-describedby")).toBe(question.id);
  });

  test("the status line is a live region, and a send after a lost secret shows the spinner again", () => {
    const a = page();
    a.api().setStep(SECRET_STEP, TOKEN);
    const input = a.shadow().querySelector("input.f");
    input.value = "ghp_SECRET";
    input.dispatchEvent(new a.w.Event("input", { bubbles: true, composed: true }));
    btn(a, "Weiter").click();

    const b = page({ session: session(a) });
    expect(b.shadow().querySelector(".status").getAttribute("role")).toBe("status");
    const spin = b.shadow().querySelector(".spin");
    expect(spin.style.display).toBe("none");
    const again = b.shadow().querySelector("input.f");
    again.value = "ghp_AGAIN";
    again.dispatchEvent(new b.w.Event("input", { bubbles: true, composed: true }));
    btn(b, "Weiter").click();
    expect(spin.style.display).toBe("");
  });
});

describe("polish pass: a same-step re-send after a delivered click", () => {
  test("re-arms the step instead of leaving it stuck in the sent state", async () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Weiter").click();
    const ev = await a.api().wait(0, TOKEN); // delivered: nothing queued any more
    expect(ev).toMatchObject({ type: "next", stepId: "3" });
    expect(btn(a, "Weiter").disabled).toBe(true); // still shows "sent"
    expect(a.api().setStep(STEP, TOKEN)).toBe("ok"); // Claude asks again (SKILL.md 5c)
    expect(btn(a, "Weiter").disabled).toBe(false);
    expect(a.shadow().querySelector(".status").textContent).toContain("bitte noch einmal");
  });

  test("an unchanged re-send while the click is still queued keeps the sent state", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Weiter").click(); // nobody listening: queued
    expect(a.api().setStep(STEP, TOKEN)).toBe("ok");
    expect(btn(a, "Weiter").disabled).toBe(true);
    expect(a.api().state().queued).toBe(1);
  });
});

describe("the status line says what was sent (web-guide deep check)", () => {
  const status = (p) => p.shadow().querySelector(".status").textContent;

  test("a help question and a confirmed abort each get their own promise", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Ich komme nicht weiter").click();
    a.shadow().querySelector("textarea.f").value = "Ich finde den Button nicht";
    btn(a, "Senden").click();
    expect(status(a)).toContain("Frage gesendet");

    const b = page();
    b.api().setStep(STEP, TOKEN);
    btn(b, "Abbrechen").click();
    btn(b, "Wirklich abbrechen?").click();
    expect(status(b)).toContain("Abbruch gesendet");
  });

  test("a plain Weiter says it was sent", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Weiter").click();
    expect(status(a)).toContain("Gesendet");
  });
});

describe("a click that reached a wait() nobody read (interrupted turn)", () => {
  test("state() shows it as sent with nothing queued, so the skill can re-arm the step", async () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    const lost = a.api().wait(30000, TOKEN); // the calling turn dies; nobody reads this promise
    btn(a, "Weiter").click();
    await lost;
    const st = a.api().state();
    expect(st).toMatchObject({ stepId: "3", queued: 0, sent: true, lastDeliveredStepId: "3" });
    a.api().setStep(STEP, TOKEN); // SKILL.md: resume → re-send the same step
    expect(btn(a, "Weiter").disabled).toBe(false);
    expect(a.api().state().sent).toBe(false);
    expect(a.shadow().querySelector(".status").textContent).toContain("bitte noch einmal");
  });
});

// #530 robustness pass.
describe("#530: Trusted Types (Fix 1)", () => {
  test("injects and renders bold/code text even when Element.prototype.innerHTML throws", () => {
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
      url: "https://console.cloud.google.test/",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    const w = dom.window;
    // Simulate a Trusted-Types-enforcing page: ANY string assignment to
    // innerHTML throws a TypeError, on every Element subclass.
    for (const proto of [w.Element.prototype, w.HTMLElement.prototype]) {
      const desc = Object.getOwnPropertyDescriptor(proto, "innerHTML");
      if (!desc) continue;
      Object.defineProperty(proto, "innerHTML", {
        configurable: true,
        get: desc.get,
        set() { throw new TypeError("This document requires 'TrustedHTML' assignment."); },
      });
    }
    let shadow = null;
    const orig = w.Element.prototype.attachShadow;
    w.Element.prototype.attachShadow = function (o) { shadow = orig.call(this, o); return shadow; };
    const result = w.eval(TOKENED);
    w.Element.prototype.attachShadow = orig;

    expect(result).toBe("injected");
    w.claudeGuide.setStep({ ...STEP, text: "Klicke **Generate token**, dann `Weiter`." }, TOKEN);
    const bold = [...shadow.querySelectorAll("b")].find((el) => el.textContent === "Generate token");
    const code = [...shadow.querySelectorAll("code")].find((el) => el.textContent === "Weiter");
    expect(bold).toBeTruthy();
    expect(code).toBeTruthy();
  });
});

describe("#530: state preserved across a re-render (Fix 2)", () => {
  test("collapsing and expanding keeps a typed value and checklist ticks", () => {
    const a = page();
    a.api().setStep({
      ...STEP,
      input: { type: "text", name: "n", label: "Name" },
      checklist: ["Scope gesetzt", "Ablaufdatum gewählt"],
    }, TOKEN);
    const input = a.shadow().querySelector("input.f");
    input.value = "mein-wert";
    input.dispatchEvent(new a.w.Event("input", { bubbles: true, composed: true }));
    const boxes = a.shadow().querySelectorAll('input[type="checkbox"]');
    boxes[1].checked = true;
    boxes[1].dispatchEvent(new a.w.Event("change", { bubbles: true }));

    a.shadow().querySelector('button.collapse[aria-label="Einklappen"]').click(); // collapse
    const fab = a.shadow().querySelector("button.fab");
    fab.dispatchEvent(new a.w.MouseEvent("click", { bubbles: true, detail: 0 })); // expand

    expect(a.shadow().querySelector("input.f").value).toBe("mein-wert");
    expect([...a.shadow().querySelectorAll('input[type="checkbox"]')][1].checked).toBe(true);
  });

  test("the help box (open state and typed text) survives a collapse/expand", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Ich komme nicht weiter").click();
    a.shadow().querySelector("textarea.f").value = "Wo finde ich den Button?";
    a.shadow().querySelector("textarea.f").dispatchEvent(new a.w.Event("input", { bubbles: true, composed: true }));

    const key = (p, target, k) => target.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: k, bubbles: true, composed: true, cancelable: true }));
    key(a, a.shadow().querySelector("textarea.f"), "Escape"); // collapse
    a.shadow().querySelector("button.fab").dispatchEvent(new a.w.MouseEvent("click", { bubbles: true, detail: 0 })); // expand

    const textarea = a.shadow().querySelector("textarea.f");
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe("Wo finde ich den Button?");
  });

  test("state().sent is false after a re-arm even with a required, empty field", () => {
    const a = page();
    a.api().setStep(SECRET_STEP, TOKEN); // secret is implicitly required, starts empty
    expect(a.api().state().sent).toBe(false); // Fix 5/2: the old heuristic false-positived here
    expect(btn(a, "Weiter").disabled).toBe(true); // still correctly disabled by validation
  });
});

describe("#530: panel position clamps to the viewport (Fix 3)", () => {
  test("a small viewport with the FAB near the top-left keeps the panel fully on screen", () => {
    const a = page();
    Object.defineProperty(a.w, "innerWidth", { value: 400, configurable: true });
    Object.defineProperty(a.w, "innerHeight", { value: 400, configurable: true });
    a.api().setStep(STEP, TOKEN);
    const fab = a.shadow().querySelector("button.fab");
    fab.dispatchEvent(new a.w.PointerEvent("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
    fab.dispatchEvent(new a.w.PointerEvent("pointermove", { clientX: -318, clientY: -318, bubbles: true }));
    fab.dispatchEvent(new a.w.PointerEvent("pointerup", { pointerId: 1, bubbles: true }));

    const panel = a.shadow().querySelector(".panel");
    const top = parseFloat(panel.style.top);
    const maxH = parseFloat(panel.style.maxHeight);
    const right = parseFloat(panel.style.right);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + maxH).toBeLessThanOrEqual(400 - 8 + 0.5);
    expect(right).toBeGreaterThanOrEqual(8);
    expect(400 - right - 340).toBeGreaterThanOrEqual(8 - 0.5); // left edge inside the viewport margin
  });

  // Live check: with the FAB in its default bottom-right spot the panel was
  // pinned to the top of the window, far away from the FAB it belongs to.
  test("with the FAB at the bottom the panel sits right above it and grows upwards", () => {
    const a = page();
    Object.defineProperty(a.w, "innerWidth", { value: 1100, configurable: true });
    Object.defineProperty(a.w, "innerHeight", { value: 640, configurable: true });
    a.api().setStep(STEP, TOKEN);
    const panel = a.shadow().querySelector(".panel");
    // FAB: bottom 24 + 56 high → its top edge at 560; the panel ends 12 px above.
    expect(panel.style.top).toBe("");
    expect(panel.style.bottom).toBe("92px");
    expect(parseFloat(panel.style.maxHeight)).toBe(640 - 80 - 12 - 8);
  });
});

describe("#530: the done step (Fix 4)", () => {
  test("the hint names Fertig, and Fertig shows the same sent status as any other step", () => {
    const a = page();
    a.api().setStep({ id: "9", index: 6, total: 6, title: "Fertig", text: "Alles erledigt.", done: true }, TOKEN);
    const hint = [...a.shadow().querySelectorAll("p.x")].find((el) => el.textContent.indexOf("kannst du den Tab schließen") !== -1);
    expect(hint.textContent).toBe("Klicke Fertig — danach kannst du den Tab schließen.");
    expect(hint.querySelector("b").textContent).toBe("Fertig");
    btn(a, "Fertig").click();
    expect(a.shadow().querySelector(".status").textContent).toContain("Gesendet");
    expect(btn(a, "Fertig").disabled).toBe(true);
  });
});

describe("#530: secret/confirm required + trimmed (Fix 5)", () => {
  test("a secret typed as only whitespace cannot be sent, and a real value is trimmed", async () => {
    const a = page();
    a.api().setStep(SECRET_STEP, TOKEN);
    const input = a.shadow().querySelector("input.f");
    input.value = "   ";
    input.dispatchEvent(new a.w.Event("input", { bubbles: true, composed: true }));
    expect(btn(a, "Weiter").disabled).toBe(true);

    input.value = "  ghp_SECRET  ";
    input.dispatchEvent(new a.w.Event("input", { bubbles: true, composed: true }));
    expect(btn(a, "Weiter").disabled).toBe(false);
    btn(a, "Weiter").click();
    const ev = await a.api().wait(0, TOKEN);
    expect(Buffer.from(ev.value, "base64").toString()).toBe("ghp_SECRET");
  });

  test("a confirm checkbox is required even without input.required", () => {
    const a = page();
    a.api().setStep({ ...STEP, input: { type: "confirm", name: "ack", label: "Verstanden" } }, TOKEN);
    expect(btn(a, "Weiter").disabled).toBe(true);
    a.shadow().querySelector('input[type="checkbox"]').click();
    expect(btn(a, "Weiter").disabled).toBe(false);
  });
});

describe("#530: CSP without 'unsafe-inline' (Fix 6)", () => {
  test("prefers adoptedStyleSheets when constructable stylesheets are available", () => {
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
      url: "https://site.example/",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    const w = dom.window;
    if (typeof w.CSSStyleSheet !== "function" || !("adoptedStyleSheets" in w.ShadowRoot.prototype)) return; // engine has no support
    let shadow = null;
    const orig = w.Element.prototype.attachShadow;
    w.Element.prototype.attachShadow = function (o) { shadow = orig.call(this, o); return shadow; };
    const result = w.eval(TOKENED);
    w.Element.prototype.attachShadow = orig;
    expect(result).toBe("injected");
    expect(shadow.adoptedStyleSheets.length).toBe(1);
    expect(shadow.querySelector("style")).toBeNull(); // no <style> fallback element was used
  });
});

describe("#530: a same-id resend with changed content (Fix 7)", () => {
  test("a genuinely new step undocks the edge tab", () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    a.shadow().querySelector('button.collapse[aria-label="Guide ausblenden"]').click();
    expect(a.api().state().edgeTab).toBe(true);
    a.api().setStep({ ...STEP, id: "5" }, TOKEN); // a genuinely new step
    expect(a.api().state().edgeTab).toBe(false);
  });

  test("the same id with different text shows the 'updated' status until the next action", async () => {
    const a = page();
    a.api().setStep(STEP, TOKEN);
    btn(a, "Ich komme nicht weiter").click();
    a.shadow().querySelector("textarea.f").value = "Wo genau?";
    btn(a, "Senden").click();
    await a.api().wait(0, TOKEN); // Claude drains the help event before answering it
    a.api().setStep({ ...STEP, text: "Der Button heißt jetzt **Neuen Token erzeugen**." }, TOKEN); // same id, answered
    expect(a.shadow().querySelector(".status").textContent).toContain("Hinweis aktualisiert");
    btn(a, "Weiter").click(); // the next user action clears it
    expect(a.shadow().querySelector(".status").textContent).not.toContain("Hinweis aktualisiert");
  });
});

describe("#530: heartbeat thresholds (Fix 8)", () => {
  test("HEARTBEAT_STALE_MS is 45s and a delivered-but-unanswered click gets its own message after 90s", () => {
    expect(SRC).toMatch(/HEARTBEAT_STALE_MS\s*=\s*45000/);
    expect(SRC).toMatch(/DELIVERED_STALE_MS\s*=\s*90000/);
    expect(SRC).toMatch(/Claude braucht länger/);
  });
});
