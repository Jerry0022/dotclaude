import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readTemplates } from "./templates-source.js";

// #362 — the draft-offline strip never hid once shown. `_setDraftHealth(ok)`
// toggles `el.hidden`, but the strip's base rule sets `display: flex`, which
// outranks the UA `[hidden] { display: none }` — so after one transient blip
// (three debounced saves while the bridge was busy) the page carried a
// permanent, false "bridge unreachable" warning over a bridge answering 200.
//
// Two contracts pinned here: the CSS override every other toggled bar already
// carries, and the retry timer that clears the strip WITHOUT the user having
// to type again.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = readTemplates();
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");

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
const cssSource = scanBlocks(md).filter((b) => b.info === "css").map((b) => b.code).join("\n");

function fnSource(name) {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found in templates.md");
  return m[0];
}

describe("draft-offline strip — CSS", () => {
  test("the strip rule is display:flex and therefore needs an explicit [hidden] override", () => {
    const base = /\.draft-offline-strip,\s*\n\.recovered-notes-strip \{([\s\S]*?)\}/.exec(cssSource);
    expect(base, "base strip rule").not.toBeNull();
    expect(base[1]).toContain("display: flex");
    // The one line that was missing. Both strips, one rule, right next to the base.
    expect(cssSource).toMatch(/\.draft-offline-strip\[hidden\],\s*\n\.recovered-notes-strip\[hidden\] \{ display: none; \}/);
  });

  test("the override sits in the same block as the base rule (re-synced together)", () => {
    const block = scanBlocks(md).find((b) => b.info === "css" && b.code.includes(".draft-offline-strip,"));
    expect(block).toBeDefined();
    expect(block.code).toContain(".draft-offline-strip[hidden]");
  });
});

describe("draft-offline strip — validation gate", () => {
  test("entry 63 pins the [hidden] override and is on the engine-drift list", () => {
    const row = gate.split("\n").find((l) => l.startsWith("| 63 |"));
    expect(row, "gate row 63").toBeDefined();
    expect(row).toContain(".draft-offline-strip[hidden]");
    expect(row).toContain(".recovered-notes-strip[hidden]");
    expect(row).toContain("ENGINE entry");
    const drift = gate.slice(gate.indexOf("When any ENGINE entry"));
    expect(drift).toMatch(/63 \(strip\s*\n?`\[hidden\]` override\)/);
  });
});

describe("draft-offline strip — retry timer", () => {
  // Runs the real _setDraftHealth from templates.md against stubbed timers:
  // three failures show the strip AND arm one retry; a success hides it AND
  // disarms; while the strip is hidden no timer is ever armed.
  function harness() {
    const timers = [];
    const cleared = [];
    const phases = [];
    const flushes = { n: 0 };
    const el = { hidden: false, className: "", setAttribute() {}, textContent: "" };
    const ctx = {
      document: { createElement: () => el, body: { appendChild() {} } },
      setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms }); return id; },
      clearTimeout: (id) => cleared.push(id),
      _setDraftPhase: (p) => phases.push(p),
      flushDraft: () => { flushes.n++; },
    };
    vm.createContext(ctx);
    const consts = md.match(/const DRAFT_RETRY_MS = \d+;/);
    expect(consts, "DRAFT_RETRY_MS").not.toBeNull();
    vm.runInContext(
      [
        "let _draftFailures = 0; let _draftStripEl = null; let _draftRetryTimer = null;",
        consts[0],
        fnSource("_draftStripText"),
        fnSource("_setDraftHealth"),
      ].join("\n"),
      ctx,
    );
    const set = (ok) => vm.runInContext(`_setDraftHealth(${ok})`, ctx);
    return { set, timers, cleared, phases, flushes, el, ctx };
  }

  test("three failures show the strip and arm exactly one retry", () => {
    const h = harness();
    h.set(false); h.set(false);
    expect(h.timers.length).toBe(0);           // two blips: nothing shown, nothing armed
    h.set(false);
    expect(h.el.hidden).toBe(false);
    expect(h.timers.length).toBe(1);
    expect(h.timers[0].ms).toBe(30000);
    h.set(false);                               // a fourth failure does not stack timers
    expect(h.timers.length).toBe(1);
  });

  test("a success hides the strip and disarms the pending retry", () => {
    const h = harness();
    h.set(false); h.set(false); h.set(false);
    h.set(true);
    expect(h.el.hidden).toBe(true);
    expect(h.cleared).toEqual([h.timers[0].id]);
    expect(h.phases.at(-1)).toBe("saved");
  });

  test("the retry calls flushDraft and re-arms only if the bridge is still down", () => {
    const h = harness();
    h.set(false); h.set(false); h.set(false);
    h.timers[0].fn();                           // timer fires → flushDraft
    expect(h.flushes.n).toBe(1);
    // flushDraft's failure path reports another miss → a fresh timer is armed
    h.set(false);
    expect(h.timers.length).toBe(2);
    // …and its success path clears everything
    h.set(true);
    expect(h.el.hidden).toBe(true);
    expect(h.cleared).toContain(h.timers[1].id);
  });

  test("no timer is ever armed while the strip is hidden", () => {
    const h = harness();
    h.set(true); h.set(false); h.set(true);
    expect(h.timers.length).toBe(0);
    expect(h.cleared.length).toBe(0);
  });
});
