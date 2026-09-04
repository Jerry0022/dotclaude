import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// Two UX defects observed on a real multi-iteration concept page:
//
//   1. The post-submit dimmer was the only thing veiling a past round, and it
//      is click-to-dismiss. Users lift it by reflex the moment they open an
//      old tab, and then read history as the live page — after the lift,
//      nothing on screen says "earlier round" except the chip highlight in
//      the panel, and the live chip is not always the last one.
//   2. Once lifted, the veil stayed lifted across tab switches, so several
//      past rounds could be unlocked at the same time.
//
// Contract pinned here: showIteration() re-arms the dimmer (lockFrozenView)
// on EVERY entry into a non-live tab and unhides a fixed #frozen-bar with a
// back-to-live button; the live tab hides the dimmer. So at most the one past
// round on screen is unlocked, and none while the live round is shown.
//
// templates.md is a REFERENCE Claude copies verbatim into generated pages, so
// a defect here ships silently into every concept produced afterwards.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");
const iterRules = fs.readFileSync(path.join(DK, "iteration-rules.md"), "utf8");

// Line-based scanner (same reason as panel-chrome.test.js): a lazy regex
// desynchronises on the first block whose body contains a fence.
function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null, body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) {
      if (open === null) { open = { info: m[1].trim(), start: i + 2 }; body = []; }
      else { out.push({ info: open.info, line: open.start, code: body.join("\n") }); open = null; }
      continue;
    }
    if (open) body.push(lines[i]);
  }
  return out;
}
const BLOCKS = scanBlocks(md);
const HTML_BLOCKS = BLOCKS.filter((b) => b.info === "html");
const cssSource = BLOCKS.filter((b) => b.info === "css").map((b) => b.code).join("\n");

function fnSource(name) {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found in templates.md");
  return m[0];
}

describe("frozen veil + floating bar — markup", () => {
  // Every template skeleton (Common Structure, design, free) ships the
  // dimmer; each MUST ship the bar right next to it, outside any iteration
  // section, because showIteration() drives both regardless of template.
  test("every skeleton that declares #content-dimmer also declares #frozen-bar outside the iteration sections", () => {
    const skeletons = HTML_BLOCKS.filter((b) => b.code.includes('id="content-dimmer"'));
    expect(skeletons.length).toBe(3);
    for (const b of skeletons) {
      const where = `html block at line ${b.line}`;
      expect(b.code, where).toContain('id="frozen-bar"');
      expect(b.code, where).toContain("data-frozen-bar-title");
      expect(b.code, where).toContain('id="frozen-bar-back"');
      expect(b.code, where).toContain("{{frozen.bar_hint}}");
      expect(b.code, where).toContain("{{frozen.bar_back}}");
      // Page-level chrome: after the last closed section, never inside one.
      const barAt = b.code.indexOf('id="frozen-bar"');
      expect(barAt, where).toBeGreaterThan(b.code.lastIndexOf("</section>"));
      // Hidden by default — only showIteration() unhides it on a past tab.
      expect(b.code, where).toMatch(/id="frozen-bar" role="status" hidden/);
    }
  });

  test("locale table carries the bar strings in en and de", () => {
    for (const key of ["frozen.bar_hint", "frozen.bar_back"]) {
      const row = md.split("\n").find((l) => l.startsWith("| `" + key + "`"));
      expect(row, key).toBeDefined();
      const cells = row.split("|").map((s) => s.trim()).filter(Boolean);
      expect(cells.length, key).toBe(3);
    }
  });
});

describe("frozen veil + floating bar — CSS", () => {
  test("bar is fixed chrome above the dimmer and below the FABs", () => {
    const dimmer = cssSource.match(/\.content-dimmer \{([\s\S]*?)\}/);
    const bar = cssSource.match(/\n\.frozen-bar \{([\s\S]*?)\}/);
    expect(dimmer).not.toBeNull();
    expect(bar).not.toBeNull();
    const z = (rule) => Number(/z-index:\s*(\d+)/.exec(rule[1])[1]);
    expect(bar[1]).toContain("position: fixed");
    expect(z(bar)).toBeGreaterThan(z(dimmer));
    // FABs (100) and the panel must keep painting over the bar.
    expect(z(bar)).toBeLessThan(100);
    expect(cssSource).toContain(".frozen-bar[hidden] { display: none; }");
  });

  // On design pages the 0.75rem top-centre band belongs to .design-switcher.
  // The bar drops into the row below it and stays inside the switcher's
  // width band — the same geometry contract as the rest of the chrome.
  test("design template moves the bar below the switcher and caps it to the switcher's band", () => {
    const rule = cssSource.match(/html\[data-template="design"\] \.frozen-bar \{([\s\S]*?)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toContain("top: 3.75rem");
    expect(rule[1]).toMatch(/max-width:\s*min\(34vw/);
  });
});

describe("frozen veil + floating bar — JS contract", () => {
  test("showIteration relocks past rounds, hides the dimmer on the live one, and drives the bar", () => {
    const fn = fnSource("showIteration");
    expect(fn).toContain("if (isLive) hideContentDimmer(); else lockFrozenView();");
    expect(fn).toContain("frozenBar.hidden = !!isLive");
    expect(fn).toContain("[data-frozen-bar-title]");
  });

  test("lockFrozenView re-arms the shared dimmer", () => {
    const fn = fnSource("lockFrozenView");
    expect(fn).toContain("classList.add('content-dimmed')");
    expect(fn).toContain("showContentDimmer()");
  });

  test("both back-to-live entry points share one target", () => {
    expect(md).toContain("getElementById('back-to-live-btn')?.addEventListener('click', goToLiveIteration)");
    expect(md).toContain("getElementById('frozen-bar-back')?.addEventListener('click', goToLiveIteration)");
  });

  test("gate and iteration rules carry the contract", () => {
    expect(gate).toMatch(/\| 30b \| `frozen-bar`/);
    expect(gate).toContain("lockFrozenView");
    expect(iterRules).toContain("lockFrozenView");
    expect(iterRules).toContain("#frozen-bar");
  });
});

// ── Behavioural run of the reference functions against a minimal DOM stub ──
// No jsdom in this repo, and the functions only touch a handful of DOM
// surfaces, so a hand-rolled stub is enough to exercise the lock discipline
// end to end: 3 sections (3 is live), tabs, dimmer, bar.

function makeStub() {
  const mkClassList = (owner) => ({
    add: (...c) => c.forEach((x) => owner._classes.add(x)),
    remove: (...c) => c.forEach((x) => owner._classes.delete(x)),
    toggle: (c, force) => { force ? owner._classes.add(c) : owner._classes.delete(c); },
    contains: (c) => owner._classes.has(c),
  });
  const mkEl = (attrs = {}, extra = {}) => {
    const el = {
      hidden: false, dataset: {}, style: {}, textContent: "", _attrs: {}, _classes: new Set(),
      hasAttribute: (a) => a in el._attrs,
      setAttribute: (a, v) => { el._attrs[a] = v; },
      addEventListener: () => {},
      ...extra,
    };
    el.classList = mkClassList(el);
    for (const [k, v] of Object.entries(attrs)) {
      el._attrs[k] = v;
      if (k.startsWith("data-")) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    return el;
  };
  const sections = [1, 2, 3].map((n) => mkEl({ "data-iteration": String(n), "data-iteration-template": "decision" }));
  sections[2]._attrs["data-active"] = "";
  const tabs = [1, 2, 3].map((n) => mkEl({ "data-iteration": String(n) }, { textContent: `  Iteration ${n}  ` }));
  const dimmer = mkEl(); dimmer.hidden = true;
  const title = mkEl();
  const bar = mkEl(); bar.hidden = true;
  bar.querySelector = (sel) => (sel === "[data-frozen-bar-title]" ? title : null);
  const byId = { "content-dimmer": dimmer, "frozen-bar": bar };
  const body = mkEl();
  const documentElement = mkEl();
  const document = {
    body, documentElement,
    getElementById: (id) => byId[id] || null,
    querySelectorAll: (sel) => (sel === "section[data-iteration]" ? sections : sel === ".iteration-tab" ? tabs : []),
    querySelector: (sel) => {
      if (sel === "section[data-iteration][data-active]") return sections.find((s) => "data-active" in s._attrs) || null;
      const m = /^\.iteration-tab\[data-iteration="(\d+)"\]$/.exec(sel);
      if (m) return tabs.find((t) => t.dataset.iteration === m[1]) || null;
      return null;
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
  };
  return { document, sections, tabs, dimmer, bar, title, body };
}

function loadRuntime() {
  const stub = makeStub();
  const ctx = {
    document: stub.document,
    CustomEvent: function CustomEvent(type) { this.type = type; },
    console,
  };
  vm.createContext(ctx);
  const src = [
    fnSource("showContentDimmer"),
    fnSource("hideContentDimmer"),
    fnSource("lockFrozenView"),
    fnSource("resolveIterationTemplate"),
    fnSource("applyIterationTemplate"),
    fnSource("showIteration"),
    "globalThis.showIteration = showIteration;",
  ].join("\n");
  new vm.Script(src, { filename: "templates.md#tab-switch" }).runInContext(ctx);
  return { ...stub, showIteration: ctx.showIteration };
}

describe("frozen veil + floating bar — behaviour (reference JS on a DOM stub)", () => {
  const veiled = (r) => !r.dimmer.hidden && r.body.classList.contains("content-dimmed");

  test("live tab: bar hidden, no veil", () => {
    const r = loadRuntime();
    r.showIteration("3");
    expect(r.bar.hidden).toBe(true);
    expect(veiled(r)).toBe(false);
    expect(r.body.classList.contains("viewing-frozen")).toBe(false);
  });

  test("entering a past tab veils it and shows the bar with that tab's label", () => {
    const r = loadRuntime();
    r.showIteration("3");
    r.showIteration("1");
    expect(veiled(r)).toBe(true);
    expect(r.bar.hidden).toBe(false);
    expect(r.title.textContent).toBe("Iteration 1");
    expect(r.body.classList.contains("viewing-frozen")).toBe(true);
  });

  test("lifting the veil then switching to another past tab relocks — at most one unlocked", () => {
    const r = loadRuntime();
    r.showIteration("1");
    // user clicks the dimmer away (hideContentDimmer is what the click does)
    r.dimmer.hidden = true; r.body.classList.remove("content-dimmed");
    expect(veiled(r)).toBe(false);
    r.showIteration("2");
    expect(veiled(r)).toBe(true);
    expect(r.title.textContent).toBe("Iteration 2");
    // and going back to the first past round veils it again too
    r.dimmer.hidden = true; r.body.classList.remove("content-dimmed");
    r.showIteration("1");
    expect(veiled(r)).toBe(true);
  });

  test("returning to the live tab hides the veil and the bar", () => {
    const r = loadRuntime();
    r.showIteration("2");
    expect(veiled(r)).toBe(true);
    r.showIteration("3");
    expect(veiled(r)).toBe(false);
    expect(r.bar.hidden).toBe(true);
  });

  test("a final-report live tab behaves like any live tab", () => {
    const r = loadRuntime();
    r.sections[2]._attrs["data-final-report"] = "";
    r.showIteration("1");
    r.showIteration("3");
    expect(r.body.classList.contains("viewing-final")).toBe(true);
    expect(veiled(r)).toBe(false);
    expect(r.bar.hidden).toBe(true);
  });
});
