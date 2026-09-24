import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { md } from "./mapping-harness.js";
import { build } from "../../scripts/build-concept-fixture.js";

// #383 — the decision template's collector spread `...getElementState(el)`
// but no reference block defined the helper, so `collectDecisions('iterate')`
// threw on every decision round. Worse, submitWithAction() set
// `_submitInFlight` BEFORE collecting and never released it on a throw, so the
// split button looked dead: first click nothing, every later click swallowed
// by the in-flight guard. Two contracts: the helper exists and the fixture's
// live round collects cleanly; a throwing collector releases the flag and
// surfaces a warning instead of wedging the button.

const fn = name => {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error(name);
  return m[0];
};
const asyncFn = name => {
  const m = md.match(new RegExp("async function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error(name);
  return m[0];
};
const CSS_STUB = "if (typeof CSS === 'undefined') window.CSS = { escape: s => s };";
const FIXTURE = { mode: 'decision', mapping: false, rounds: 3, entries: 6, locale: 'en', out: '' };
const pageOf = html => new JSDOM(html, { url: "http://localhost/fixture.html", runScripts: "outside-only" }).window;

describe("decision template — getElementState / collectDecisionDecisions (#383)", () => {
  test("the reference defines getElementState next to the collector that spreads it", () => {
    expect(() => fn("getElementState")).not.toThrow();
    expect(md.indexOf("function getElementState(")).toBeLessThan(md.indexOf("function collectDecisionDecisions("));
    expect(fn("collectDecisionDecisions")).toContain("...getElementState(el)");
  });

  test("jsdom: the decision fixture's live round collects every [data-decision] group without throwing", () => {
    const w = pageOf(build(FIXTURE));
    w.eval([
      CSS_STUB,
      "function resolveIterationTemplate() { return 'decision'; }",
      "function attachmentsFor() { return []; }",
      fn("collectAllFormFields"), fn("collectComments"), fn("getElementState"), fn("collectDecisionDecisions"), fn("collectDecisions"),
    ].join("\n"));
    const active = w.document.querySelector("section[data-iteration][data-active]");
    const groups = active.querySelectorAll("[data-decision]");
    expect(groups.length).toBeGreaterThan(0);

    // touch one group: flip its radio and write its note
    const first = groups[0];
    first.querySelector('input[value="discard"]').checked = true;
    first.querySelector('textarea[data-comment]').value = "  only for X  ";

    let payload;
    expect(() => { payload = w.collectDecisions("iterate"); }).not.toThrow();
    expect(payload.template).toBe("decision");
    expect(payload.action).toBe("iterate");
    expect(payload.decisions.length).toBe(groups.length);
    expect(payload.decisions[0]).toEqual({
      id: first.dataset.decision, label: first.dataset.label, evaluation: "discard", note: "only for X"
    });
    for (const d of payload.decisions.slice(1)) expect(d).toMatchObject({ evaluation: "include", note: "" });
    // frozen rounds never leak into the live payload
    const frozenIds = [...w.document.querySelectorAll("section[data-iteration]:not([data-active]) [data-decision]")].map(g => g.dataset.decision);
    for (const d of payload.decisions) expect(frozenIds).not.toContain(d.id);
  });

  test("getElementState: a note slot injected NEXT to the group (ensureCommentSlots) is still found; no radio → include", () => {
    const w = pageOf('<div id="host"><div data-decision="x" data-label="X"></div><textarea data-comment="x-note">next door</textarea></div>');
    w.eval(fn("getElementState"));
    expect(w.getElementState(w.document.querySelector("[data-decision]"))).toEqual({ evaluation: "include", note: "next door" });
  });
});

describe("submitWithAction — a throwing collector never wedges the button (#383)", () => {
  const boot = () => {
    const w = pageOf([
      '<div id="panel-ready"><button id="submit-iterate-btn"></button></div>',
      '<div id="panel-submitted" style="display:none"></div>',
      '<div id="concept-decisions"></div>',
    ].join(""));
    w.eval([
      "var _submitInFlight = false, _submittedAt = 0, _userInteracted = true;",
      "var calls = 0;",
      // The page logs the collector's throw on purpose; capture it instead of
      // letting it reach the runner's stderr as a stray ReferenceError trace.
      "var logged = []; console.error = function () { logged.push(Array.prototype.join.call(arguments, ' ')); };",
      "function collectDecisions() { calls++; throw new ReferenceError('getElementState is not defined'); }",
      fn("showSubmitWarning"),
      asyncFn("submitWithAction"),
    ].join("\n"));
    return w;
  };

  test("the reference wraps collectDecisions() in try/catch and releases _submitInFlight on throw", () => {
    const src = asyncFn("submitWithAction");
    const at = src.indexOf("data = collectDecisions(action);");
    expect(at).toBeGreaterThan(-1);
    const around = src.slice(src.lastIndexOf("try {", at), src.indexOf("}", src.indexOf("catch", at)) + 1);
    expect(around).toContain("_submitInFlight = false;");
    expect(around).toContain("showSubmitWarning(");
  });

  test("jsdom: first click surfaces a warning, second click reaches the collector again (not swallowed by the guard)", async () => {
    const w = boot();
    await w.submitWithAction("iterate");
    expect(w.eval("_submitInFlight")).toBe(false);
    expect(w.eval("calls")).toBe(1);
    expect(w.eval("logged")).toEqual([expect.stringContaining("collectDecisions failed")]);
    const strip = w.document.querySelector("#panel-ready .submit-warning");
    expect(strip).not.toBeNull();
    expect(strip.textContent).toContain("getElementState is not defined");
    expect(w.document.getElementById("panel-submitted").style.display).toBe("none");   // never flipped to "submitted"

    await w.submitWithAction("iterate");
    expect(w.eval("calls")).toBe(2);                                                    // the guard did not eat the retry
  });
});
