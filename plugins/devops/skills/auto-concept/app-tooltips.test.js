import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";

// App tooltips (ui-defaults.md R0/R1, templates-utilities.md § App Tooltips): every
// hover hint is `data-tip`, rendered in the page's own tokens with two delay
// tiers — Info 1500 ms by default, Label 500 ms only for an icon-only control,
// cut-off text or a disabled control — and a native `title` never survives,
// because the OS tooltip ignores the theme, the delay and keyboard focus.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = readTemplates();
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");
const section = md.slice(md.indexOf("## App Tooltips"), md.indexOf("## Theme Toggle"));
const js = /```javascript\n([\s\S]*?)```/.exec(section)[1];
const css = /```css\n([\s\S]*?)```/.exec(section)[1];

// A page with a hand-driven clock: every setTimeout is recorded with its
// delay instead of running, so a test reads the tier the engine picked.
function page(body) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`, { runScripts: "outside-only" });
  const w = dom.window;
  const timers = new Map();
  let seq = 0;
  let now = 1_000_000;
  w.setTimeout = (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; };
  w.clearTimeout = (id) => { timers.delete(id); };
  w.Date.now = () => now;
  w.eval(js);
  const d = w.document;
  return {
    d,
    pending: () => [...timers.values()].map((t) => t.ms),
    flush: () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } },
    advance: (ms) => { now += ms; },
    tip: () => d.getElementById("app-tip"),
    over: (el) => el.dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true })),
    out: (el, to) => el.dispatchEvent(new w.MouseEvent("pointerout", { bubbles: true, relatedTarget: to || null })),
    key: (k) => d.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true })),
    tick: () => new Promise((resolve) => globalThis.setTimeout(resolve, 0)),
  };
}

describe("app tooltips — no native title", () => {
  test("a title in the markup is moved to data-tip at boot", async () => {
    const p = page('<button id="b" title="Saves the draft">Save</button>');
    await p.tick(); // boot waits for DOMContentLoaded while the page is still loading
    const b = p.d.getElementById("b");
    expect(b.hasAttribute("title")).toBe(false);
    expect(b.dataset.tip).toBe("Saves the draft");
  });

  test("a title written later is adopted too, and an empty control keeps a name", async () => {
    const p = page("<main></main>");
    const icon = p.d.createElement("button");
    icon.setAttribute("title", "Close panel");
    p.d.querySelector("main").appendChild(icon);
    await p.tick();
    expect(icon.hasAttribute("title")).toBe(false);
    expect(icon.dataset.tip).toBe("Close panel");
    expect(icon.getAttribute("aria-label")).toBe("Close panel");
  });

  test("the templates emit no title attribute and set none from script", () => {
    expect(md).not.toMatch(/\stitle="/);
    expect(md).not.toMatch(/\b[A-Za-z_$][\w$]*\.title\s*=(?!=)/);
    expect(md).not.toMatch(/setAttribute\('title'/);
  });
});

describe("app tooltips — two delay tiers", () => {
  test("Info is the default: 1500 ms", () => {
    const p = page('<button id="b" data-tip="Saves the draft">Save</button>');
    p.over(p.d.getElementById("b"));
    expect(p.pending()).toEqual([1500]);
    p.flush();
    expect(p.tip().hidden).toBe(false);
    expect(p.tip().textContent).toBe("Saves the draft");
    expect(p.d.getElementById("b").getAttribute("aria-describedby")).toBe("app-tip");
  });

  test.each([
    ["an icon-only control", '<button id="b" data-tip="Maximise">⤢</button>'],
    ["a disabled control", '<button id="b" disabled data-tip="Needs a name first">Go</button>'],
  ])("Label for %s: 500 ms", (_, html) => {
    const p = page(html);
    p.over(p.d.getElementById("b"));
    expect(p.pending()).toEqual([500]);
  });

  test("data-tip-tier overrides the detection", () => {
    const p = page('<button id="b" data-tip-tier="info" data-tip="Close">✕</button>');
    p.over(p.d.getElementById("b"));
    expect(p.pending()).toEqual([1500]);
  });

  test("the next tooltip opens instantly within 300 ms, then the tier applies again", () => {
    const p = page('<button id="a" data-tip="First">A</button><button id="b" data-tip="Second">B</button>');
    const [a, b] = [p.d.getElementById("a"), p.d.getElementById("b")];
    p.over(a); p.flush();
    p.out(a, b); p.over(b);
    expect(p.pending()).toEqual([0]);
    p.flush();
    expect(p.tip().textContent).toBe("Second");
    p.key("Escape");
    p.advance(400);
    p.over(a);
    expect(p.pending()).toEqual([1500]);
  });

  test("keyboard focus opens instantly, focus from a click does not, Escape closes", () => {
    const p = page('<button id="b" data-tip="Saves the draft">Save</button><button id="c">Other</button>');
    const b = p.d.getElementById("b");
    b.dispatchEvent(new p.d.defaultView.MouseEvent("pointerdown", { bubbles: true }));
    b.focus();
    expect(p.pending(), "a click's focus waits for the hover delay").toEqual([]);
    p.d.getElementById("c").focus();
    p.key("Tab");
    b.focus();
    expect(p.pending()).toEqual([0]);
    p.flush();
    expect(p.tip().hidden).toBe(false);
    p.key("Escape");
    expect(p.tip().hidden).toBe(true);
    expect(p.d.getElementById("b").hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("app tooltips — app style and gate", () => {
  test("the bubble is drawn from the page tokens", () => {
    for (const token of ["--panel-bg", "--text-color", "--border-color"]) {
      expect(css).toContain(`var(${token}`);
    }
    expect(css).toMatch(/prefers-reduced-motion/);
  });

  test("gate 48b requires the engine", () => {
    const row = gate.split("\n").find((l) => l.startsWith("| 48b |"));
    expect(row).toContain("wireAppTooltips");
    expect(row).toContain(".app-tip");
  });
});
