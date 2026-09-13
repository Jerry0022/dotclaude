import { describe, test, expect } from "vitest";
import {
  REQUIRED,
  isConceptHtml,
  findMissing,
  findForbidden,
  findStructural,
  evaluate,
  buildBlockReason,
  findMappingIssues,
} from "./concept-gate.js";

// A minimal but valid live-bridge concept page: contains every required
// marker, no clipboard fallback. Real pages are far larger; the gate only
// cares about these tokens.
const VALID = `<!doctype html><html data-template="decision" data-page-version="2026-06-07T10:00:00">
<body>
<script type="application/json" id="concept-decisions">{"submitted":false}</script>
<div id="panel-ready"><div class="iteration-tabs"></div>
  <button id="submit-iterate-btn">Zur nächsten Iteration</button>
  <button id="submit-implement-btn">Mit Feedback implementieren</button>
  <div id="connection-status" class="connection-pill" data-state="connecting"></div></div>
<section data-iteration="1" data-active class="concept-submitted-host"></section>
<script>function pollHeartbeat(){} async function f(){const r=await fetch('/heartbeat');const d=await r.json();d.claude_ts;}</script>
</body></html>`;

// The reported regression: a "copy the JSON, paste into chat" page with no
// live submit buttons / heartbeat.
const CLIPBOARD_FALLBACK = `<!doctype html><html lang="de"><body>
<div class="decision-panel"><button>✓ Entscheidungen übernehmen</button></div>
<p>Kopier das und füg es mir in den Chat ein (oder sag einfach „passt"):</p>
<pre id="md">## Concept-Entscheidungen</pre>
<button onclick="navigator.clipboard.writeText(document.getElementById('md').textContent)">📋 In Zwischenablage kopieren</button>
</body></html>`;

describe("isConceptHtml", () => {
  test("triggers on the canonical docs/concepts/ path ending in .html", () => {
    expect(isConceptHtml("H:/docs/concepts/2026-06-07-foo.html", "")).toBe(true);
    expect(isConceptHtml("C:\\proj\\docs\\concepts\\x.html", "")).toBe(true);
  });

  test("triggers on concept content signature even outside docs/concepts/", () => {
    expect(isConceptHtml("/tmp/page.html", '<html data-template="decision">')).toBe(true);
    expect(isConceptHtml("/tmp/page.html", '<script id="concept-decisions">')).toBe(true);
  });

  test("does NOT trigger on an unrelated concepts/ folder by path alone", () => {
    // A consumer app may have e.g. src/concepts/Foo.html — gate only on the
    // skill's canonical docs/concepts/ location (or a content signature).
    expect(isConceptHtml("src/concepts/Foo.html", "<html><body>component</body></html>")).toBe(false);
  });

  test("ignores non-html files", () => {
    expect(isConceptHtml("docs/concepts/notes.md", "concept-decisions")).toBe(false);
    expect(isConceptHtml("src/app.js", "")).toBe(false);
  });

  test("ignores ordinary html with no concept signature", () => {
    expect(isConceptHtml("public/index.html", "<html><body>hi</body></html>")).toBe(false);
  });
});

describe("findMissing", () => {
  test("valid page has no missing required markers", () => {
    expect(findMissing(VALID)).toEqual([]);
  });

  test("flags every absent required marker", () => {
    const missing = findMissing("<html></html>").map(m => m.token);
    REQUIRED.forEach(r => expect(missing).toContain(r.token));
  });

  test("flags a page that has a panel but no live submit buttons", () => {
    const html = VALID.replace(/submit-iterate-btn/g, "x").replace(/submit-implement-btn/g, "y");
    const missing = findMissing(html).map(m => m.token);
    expect(missing).toContain("submit-iterate-btn");
    expect(missing).toContain("submit-implement-btn");
  });
});

describe("findForbidden", () => {
  test("valid live page has no forbidden anti-patterns", () => {
    expect(findForbidden(VALID)).toEqual([]);
  });

  test("detects the clipboard / paste-into-chat fallback", () => {
    const hits = findForbidden(CLIPBOARD_FALLBACK).map(f => f.why);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.join(" ")).toMatch(/clipboard|Zwischenablage|Chat/i);
  });

  test("catches navigator.clipboard even without German UI text", () => {
    expect(findForbidden("<button onclick='navigator.clipboard.writeText(x)'>copy</button>").length)
      .toBeGreaterThan(0);
  });

  test("catches a detached clipboard.writeText / 'copy to clipboard' UI", () => {
    expect(findForbidden("<script>const c = navigator.clipboard; c.writeText(md);</script>").length)
      .toBeGreaterThan(0);
    expect(findForbidden("<script>clip.writeText(md)</script><button>Copy to clipboard</button>").length)
      .toBeGreaterThan(0);
  });

  // #330 — the templates' own Ctrl/Cmd+V attachment handler reads
  // ev.clipboardData. That is a paste INTO the page, not a copy OUT of it, and
  // a page generated verbatim from the reference must pass its own gate.
  test("does NOT flag the sanctioned ev.clipboardData paste handler (#330)", () => {
    const PASTE_HANDLER = `<script>
      function initCommentAttachments(ta) {
        ta.addEventListener('paste', function (ev) {
          const dt = ev.clipboardData || {};
          const files = Array.from(dt.files || []);
          if (files.length) { ev.preventDefault(); files.forEach(f => uploadAttachment(f)); }
        });
      }
    </script>`;
    expect(findForbidden(PASTE_HANDLER)).toEqual([]);
    expect(findForbidden(VALID + PASTE_HANDLER)).toEqual([]);
  });
});

// #346 — the reported regression: the opening <style> line of an older page
// was pasted INSIDE the new style block. Every marker grep passes, the CSS
// parser swallows the :root token block, the page renders white.
describe("findStructural (#346)", () => {
  const STYLED = `<!doctype html><html><head>
<style>
:root { --bg-color: #111; }
body { background: var(--bg-color); }
</style>
</head><body>
<script>const a = 1;</script>
<script type="application/json" id="concept-decisions">{}</script>
</body></html>`;

  test("a page with balanced, non-nested blocks is sound", () => {
    expect(findStructural(STYLED)).toEqual([]);
    expect(findStructural(VALID)).toEqual([]);
  });

  test("a <style> opened inside an open <style> block is reported as nested", () => {
    const nested = STYLED.replace(":root {", "<style>\n:root {");
    const kinds = findStructural(nested).map(s => s.kind);
    expect(kinds).toContain("nested-style");
    expect(kinds).toContain("unbalanced-style");
  });

  test("an unclosed <script> is reported as unclosed and unbalanced", () => {
    const unclosed = STYLED.replace(/<script>const a = 1;<\/script>[\s\S]*$/, "<script>const a = 1;\n");
    const kinds = findStructural(unclosed).map(s => s.kind);
    expect(kinds).toContain("unclosed-script");
    expect(kinds).toContain("unbalanced-script");
  });

  test("a <script> that opens inside an open <style> block is reported", () => {
    const kinds = findStructural("<style>:root{}<script>x()</script></style>").map(s => s.kind);
    expect(kinds).toContain("script-in-style");
  });

  test("a stray </style> with no open block is reported", () => {
    const kinds = findStructural("<html><body></style><p>x</p></body></html>").map(s => s.kind);
    expect(kinds).toContain("stray-close-style");
  });

  test("'<style' inside a JS string is not a tag (no false positive)", () => {
    const js = `<style>:root{--bg-color:#000}</style>
<script>
  const frame = '<style>' + css + '</style>';
  const tpl = \`<div>\${'<script'}</div>\`;
</script>`;
    expect(findStructural(js)).toEqual([]);
  });

  test("the bare word 'style' in prose or attributes is not a tag", () => {
    expect(findStructural(`<style>a{}</style><p style="color:red">style guide, restyle</p>`)).toEqual([]);
  });

  test("evaluate surfaces structural issues as their own category and fails the page", () => {
    const nestedValid = VALID.replace("<body>", "<style>\n<style>\n:root{--bg-color:#000}\n</style>\n<body>");
    const r = evaluate("docs/concepts/2026-09-07-broken.html", nestedValid);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.forbidden).toEqual([]);
    expect(r.structural.map(s => s.kind)).toContain("nested-style");
    const reason = buildBlockReason("docs/concepts/2026-09-07-broken.html", r.missing, r.forbidden, r.structural);
    expect(reason).toMatch(/Broken <style> \/ <script> structure/);
    expect(reason).toMatch(/nested-style/);
    expect(reason).toMatch(/--accent-color/);
  });

  test("buildBlockReason without the structural argument still works (older callers)", () => {
    const r = evaluate("docs/concepts/2026-06-07-haushalt.html", CLIPBOARD_FALLBACK);
    expect(() => buildBlockReason("x.html", r.missing, r.forbidden)).not.toThrow();
  });
});

describe("evaluate", () => {
  test("non-concept file → applicable false, ok true", () => {
    const r = evaluate("src/app.js", "");
    expect(r.applicable).toBe(false);
    expect(r.ok).toBe(true);
  });

  test("valid concept page → ok true", () => {
    const r = evaluate("docs/concepts/2026-06-07-foo.html", VALID);
    expect(r.applicable).toBe(true);
    expect(r.ok).toBe(true);
  });

  test("clipboard-fallback page under concepts/ → ok false (missing + forbidden)", () => {
    const r = evaluate("docs/concepts/2026-06-07-haushalt.html", CLIPBOARD_FALLBACK);
    expect(r.applicable).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.forbidden.length).toBeGreaterThan(0);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  test("panel-less page (failure mode B) → ok false", () => {
    const r = evaluate("docs/concepts/2026-06-07-x.html", "<html data-template=\"decision\"><body>just content</body></html>");
    expect(r.ok).toBe(false);
  });
});

describe("buildBlockReason", () => {
  test("names the file, lists missing + forbidden, and forbids the clipboard fallback", () => {
    const r = evaluate("docs/concepts/2026-06-07-haushalt.html", CLIPBOARD_FALLBACK);
    const reason = buildBlockReason("docs/concepts/2026-06-07-haushalt.html", r.missing, r.forbidden);
    expect(reason).toMatch(/BLOCKED/);
    expect(reason).toMatch(/2026-06-07-haushalt\.html/);
    expect(reason).toMatch(/submit-iterate-btn/);
    expect(reason).toMatch(/paste/i);
    expect(reason).toMatch(/validation-gate\.md/);
    expect(reason).toMatch(/decision panel may never be omitted/);
  });
});

// Information mapping construct (templates.md § Information Mapping (engine)
// → Spec; design spec § 11 rules M1–M4 + M9). The gate mirrors the engine's
// normalizeSpec() and complete() checks so page and hook agree.
describe("findMappingIssues", () => {
  const spec = extra => JSON.stringify({
    items: [{ id: "a", label: "A" }],
    axes: [{ id: "x", label: "X", columns: [{ id: "c1", label: "C1" }] }],
    proposal: [["a", "x.c1"]],
    ...extra,
  });
  const wrap = (iter, body) => `<section data-iteration="${iter.n}"${iter.active ? " data-active" : " hidden"}>${body}</section>`;
  const mapping = (id, s) => `<section data-mapping="${id}" id="${id}"><script type="application/json" data-mapping-spec>${s}</script></section>`;
  const live = body => wrap({ n: 1, active: true }, body);
  const frozen = body => wrap({ n: 1, active: false }, body);
  const kinds = html => findMappingIssues(html).map(i => i.kind);

  test("no mapping → no issues", () => {
    expect(findMappingIssues(VALID)).toEqual([]);
    expect(findMappingIssues("")).toEqual([]);
  });

  test("valid live mapping passes", () => {
    expect(findMappingIssues(live(mapping("m1", spec())))).toEqual([]);
  });

  test("mapping section without a spec script", () => {
    expect(kinds(live('<section data-mapping="m1" id="m1"><p>nothing</p></section>'))).toEqual(["spec-missing"]);
  });

  test("a spec belonging to the NEXT mapping does not satisfy the first", () => {
    const html = live('<section data-mapping="m1" id="m1"></section>' + mapping("m2", spec()));
    expect(kinds(html)).toEqual(["spec-missing"]);
  });

  test("unparseable spec", () => {
    expect(kinds(live(mapping("m1", "{nope")))).toEqual(["spec-parse"]);
  });

  test("bad id grammar and duplicate ids", () => {
    const s = JSON.stringify({ items: [{ id: "a-b" }, { id: "a-b" }], axes: [{ id: "x", columns: [{ id: "c1" }] }] });
    const k = kinds(live(mapping("m1", s)));
    expect(k).toContain("bad-id");
    expect(k).toContain("duplicate-id");
  });

  test("bad id grammar is checked on elements, parts, axes, columns and context values", () => {
    const s = JSON.stringify({
      items: [{ id: "a" }],
      elements: [{ id: "Card", parts: [{ id: "head er" }] }],
      axes: [{ id: "x", columns: [{ id: 7 }] }],
      context: { id: "device", values: [{ id: "Phone" }] },
    });
    const issues = findMappingIssues(live(mapping("m1", s)));
    const bad = issues.filter(i => i.kind === "bad-id").map(i => i.why).join("\n");
    expect(bad).toMatch(/Card/);
    expect(bad).toMatch(/head er/);
    expect(bad).toMatch(/7/);
    expect(bad).toMatch(/Phone/);
  });

  test("item id u{n} is reserved for ad-hoc items", () => {
    const s = spec({ items: [{ id: "u1" }], proposal: [] });
    const issues = findMappingIssues(live(mapping("m1", s)));
    expect(issues.map(i => i.kind)).toEqual(["bad-id"]);
    expect(issues[0].why).toMatch(/reserved/);
  });

  test("duplicate source ids across elements + axes, part ids per element, context values", () => {
    const s = JSON.stringify({
      items: [{ id: "a" }],
      elements: [{ id: "x", parts: [{ id: "p", label: "P" }, { id: "p", label: "P2" }] }],
      axes: [{ id: "x", columns: [{ id: "c1" }] }],
      context: { id: "d", values: [{ id: "v" }, { id: "v" }] },
    });
    const why = findMappingIssues(live(mapping("m1", s))).filter(i => i.kind === "duplicate-id").map(i => i.why);
    expect(why.length).toBe(3);
    expect(why.join("\n")).toMatch(/source id "x"/);
    expect(why.join("\n")).toMatch(/part id "p"/);
    expect(why.join("\n")).toMatch(/context value id "v"/);
  });

  test("two elements may each use the same part id", () => {
    const s = JSON.stringify({
      items: [{ id: "a" }],
      elements: [{ id: "e1", parts: [{ id: "p" }] }, { id: "e2", parts: [{ id: "p" }] }],
    });
    expect(kinds(live(mapping("m1", s)))).toEqual([]);
  });

  test("mapping id reused across iterations", () => {
    const html = frozen(mapping("m1", spec({ submitted: { cells: { x: [["a", "x.c1"]] } } })))
      + wrap({ n: 2, active: true }, mapping("m1", spec()));
    expect(kinds(html)).toEqual(["duplicate-mapping-id"]);
  });

  test("proposal referencing unknown ids; ctx present without context", () => {
    expect(kinds(live(mapping("m1", spec({ proposal: [["zz", "x.c1"]] }))))).toContain("unknown-ref");
    expect(kinds(live(mapping("m1", spec({ proposal: [["a", "x.zz"]] }))))).toContain("unknown-ref");
    expect(kinds(live(mapping("m1", spec({ proposal: [["a", "x.c1", "phone"]] }))))).toContain("ctx-mismatch");
  });

  test("context spec: proposal must carry a known ctx value", () => {
    const ctx = { context: { id: "device", values: [{ id: "phone" }, { id: "desktop" }] } };
    expect(kinds(live(mapping("m1", spec({ ...ctx, proposal: [["a", "x.c1"]] }))))).toEqual(["ctx-mismatch"]);
    expect(kinds(live(mapping("m1", spec({ ...ctx, proposal: [["a", "x.c1", "tablet"]] }))))).toEqual(["ctx-mismatch"]);
    expect(kinds(live(mapping("m1", spec({ ...ctx, proposal: [["a", "x.c1", "phone"]] }))))).toEqual([]);
  });

  test("proposalOrder: unknown / unordered target, unknown item, ctx mismatch", () => {
    const ordered = {
      elements: [{ id: "card", parts: [{ id: "line", ordered: true }, { id: "plain" }] }],
      axes: undefined,
      proposal: [["a", "card.line"]],
    };
    expect(kinds(live(mapping("m1", spec({ ...ordered, proposalOrder: { "card.line": ["a"] } }))))).toEqual([]);
    expect(kinds(live(mapping("m1", spec({ ...ordered, proposalOrder: { "card.nope": ["a"] } }))))).toEqual(["unknown-ref"]);
    expect(kinds(live(mapping("m1", spec({ ...ordered, proposalOrder: { "card.plain": ["a"] } }))))).toEqual(["unknown-ref"]);
    expect(kinds(live(mapping("m1", spec({ ...ordered, proposalOrder: { "card.line": ["a", "zz"] } }))))).toEqual(["unknown-ref"]);
    expect(kinds(live(mapping("m1", spec({ ...ordered, proposalOrder: { "card.line@phone": ["a"] } }))))).toEqual(["ctx-mismatch"]);
  });

  test("empty mapping (no elements/axes)", () => {
    expect(kinds(live(mapping("m1", JSON.stringify({ items: [{ id: "a" }] }))))).toContain("empty-mapping");
  });

  test("empty mapping: element without parts, axis without columns, context without values", () => {
    const s = JSON.stringify({
      items: [{ id: "a" }],
      elements: [{ id: "e" }],
      axes: [{ id: "x", columns: [] }],
      context: { id: "d", values: [] },
    });
    const why = findMappingIssues(live(mapping("m1", s))).filter(i => i.kind === "empty-mapping").map(i => i.why);
    expect(why.length).toBe(3);
  });

  test("frozen iteration without submitted fails; with submitted passes", () => {
    expect(kinds(frozen(mapping("m1", spec())))).toEqual(["frozen-without-submitted"]);
    expect(findMappingIssues(frozen(mapping("m1", spec({ submitted: { cells: { x: [["a", "x.c1"]] } } }))))).toEqual([]);
  });

  test("frozen: submitted.cells must carry EVERY matrix key (engine complete() rule)", () => {
    const ctx = { context: { id: "device", values: [{ id: "phone" }, { id: "desktop" }] }, proposal: [["a", "x.c1", "phone"]] };
    const partial = spec({ ...ctx, submitted: { cells: { "x@phone": [["a", "x.c1"]] } } });
    expect(kinds(frozen(mapping("m1", partial)))).toEqual(["frozen-without-submitted"]);
    const full = spec({ ...ctx, submitted: { cells: { "x@phone": [["a", "x.c1"]], "x@desktop": [] } } });
    expect(kinds(frozen(mapping("m1", full)))).toEqual([]);
    // `submitted` without a cells object counts as missing too.
    expect(kinds(frozen(mapping("m1", spec({ submitted: {} }))))).toEqual(["frozen-without-submitted"]);
    // A non-array cells entry is both a shape error and, for M9, a missing key.
    const shape = kinds(frozen(mapping("m1", spec({ submitted: { cells: { x: "a>x.c1" } } }))));
    expect(shape).toContain("unknown-ref");
    expect(shape).toContain("frozen-without-submitted");
  });

  test("live mapping needs no submitted; a mapping outside any iteration is live", () => {
    expect(kinds(live(mapping("m1", spec())))).toEqual([]);
    expect(kinds(mapping("m1", spec()))).toEqual([]);
  });

  test("the enclosing iteration is the NEAREST preceding data-iteration tag", () => {
    const html = frozen("<p>old</p>") + live(mapping("m1", spec()));
    expect(kinds(html)).toEqual([]);
    const html2 = live("<p>new</p>") + frozen(mapping("m1", spec()));
    expect(kinds(html2)).toEqual(["frozen-without-submitted"]);
  });

  test("context spec whose submitted keys lack @ctx → ctx-mismatch", () => {
    const ctx = { context: { id: "device", values: [{ id: "phone" }] }, proposal: [["a", "x.c1", "phone"]] };
    const k = kinds(frozen(mapping("m1", spec({ ...ctx, submitted: { cells: { x: [["a", "x.c1"]] } } }))));
    expect(k).toContain("ctx-mismatch");
    // and the inverse: @ctx on a spec without context
    expect(kinds(frozen(mapping("m1", spec({ submitted: { cells: { "x@phone": [["a", "x.c1"]], x: [] } } }))))).toContain("ctx-mismatch");
    // unknown context value in a submitted key
    expect(kinds(frozen(mapping("m1", spec({ ...ctx, submitted: { cells: { "x@phone": [], "x@tablet": [] } } }))))).toContain("ctx-mismatch");
  });

  test("submitted.cells pairs referencing unknown ids or an unknown source key", () => {
    expect(kinds(frozen(mapping("m1", spec({ submitted: { cells: { x: [["zz", "x.c1"]] } } }))))).toEqual(["unknown-ref"]);
    expect(kinds(frozen(mapping("m1", spec({ submitted: { cells: { x: [["a", "x.zz"]] } } }))))).toEqual(["unknown-ref"]);
    expect(kinds(frozen(mapping("m1", spec({ submitted: { cells: { x: [], y: [] } } }))))).toEqual(["unknown-ref"]);
    // a pair whose target belongs to another matrix
    const two = spec({ axes: [{ id: "x", columns: [{ id: "c1" }] }, { id: "y", columns: [{ id: "c2" }] }], submitted: { cells: { x: [["a", "y.c2"]], y: [] } } });
    expect(kinds(frozen(mapping("m1", two)))).toEqual(["unknown-ref"]);
  });

  test("submitted.cells may reference ad-hoc items u{n} declared in submitted.adhoc", () => {
    const ok = spec({ adhocItems: true, submitted: { cells: { x: [["u1", "x.c1"]] }, adhoc: ["Next inspection"] } });
    expect(kinds(frozen(mapping("m1", ok)))).toEqual([]);
    const tooMany = spec({ adhocItems: true, submitted: { cells: { x: [["u2", "x.c1"]] }, adhoc: ["Next inspection"] } });
    expect(kinds(frozen(mapping("m1", tooMany)))).toEqual(["unknown-ref"]);
  });

  test("submitted.order keys follow the proposalOrder rules", () => {
    const ordered = { elements: [{ id: "card", parts: [{ id: "line", ordered: true }] }], axes: undefined, proposal: [["a", "card.line"]] };
    const good = spec({ ...ordered, submitted: { cells: { card: [["a", "card.line"]] }, order: { "card.line": ["a"] } } });
    expect(kinds(frozen(mapping("m1", good)))).toEqual([]);
    const bad = spec({ ...ordered, submitted: { cells: { card: [["a", "card.line"]] }, order: { "card.nope": ["a"], "card.line": ["a"] } } });
    expect(kinds(frozen(mapping("m1", bad)))).toEqual(["unknown-ref"]);
  });

  // G3 — a frozen round with ordered parts needs submitted.order for every
  // ordered target key; otherwise the engine shows proposalOrder as decided.
  test("frozen: ordered targets require submitted.order for every ordered target key", () => {
    const ordered = { elements: [{ id: "card", parts: [{ id: "line", ordered: true }, { id: "plain" }] }], axes: undefined, proposal: [["a", "card.line"]] };
    const noOrder = spec({ ...ordered, submitted: { cells: { card: [["a", "card.line"]] } } });
    const issues = findMappingIssues(frozen(mapping("m1", noOrder)));
    expect(issues.map(i => i.kind)).toEqual(["frozen-without-submitted"]);
    expect(issues[0].why).toMatch(/"submitted.order" lacks ordered target key\(s\) "card.line"/);
    // an order object that lacks the key is missing too
    const emptyOrder = spec({ ...ordered, submitted: { cells: { card: [["a", "card.line"]] }, order: {} } });
    expect(kinds(frozen(mapping("m1", emptyOrder)))).toEqual(["frozen-without-submitted"]);
    // the unordered part needs no order key
    const good = spec({ ...ordered, submitted: { cells: { card: [["a", "card.line"]] }, order: { "card.line": ["a"] } } });
    expect(kinds(frozen(mapping("m1", good)))).toEqual([]);
    // live rounds never need it
    expect(kinds(live(mapping("m1", noOrder)))).toEqual([]);
    // with a context, one order key per context value
    const ctx = { context: { id: "device", values: [{ id: "phone" }, { id: "desktop" }] }, proposal: [["a", "card.line", "phone"]] };
    const cells = { "card@phone": [["a", "card.line"]], "card@desktop": [] };
    const partial = spec({ ...ordered, ...ctx, submitted: { cells, order: { "card.line@phone": ["a"] } } });
    const pi = findMappingIssues(frozen(mapping("m1", partial)));
    expect(pi.map(i => i.kind)).toEqual(["frozen-without-submitted"]);
    expect(pi[0].why).toMatch(/"card.line@desktop"/);
    const full = spec({ ...ordered, ...ctx, submitted: { cells, order: { "card.line@phone": ["a"], "card.line@desktop": [] } } });
    expect(kinds(frozen(mapping("m1", full)))).toEqual([]);
  });

  // G1 — the data-mapping value follows the id grammar and equals the section id.
  test("mapping id: grammar on data-mapping and equality with the section id", () => {
    const good = '<section data-mapping="map_1" id="map_1"><script type="application/json" data-mapping-spec>' + spec() + "</script></section>";
    expect(kinds(live(good))).toEqual([]);
    const badGrammar = '<section data-mapping="Map-1" id="Map-1"><script type="application/json" data-mapping-spec>' + spec() + "</script></section>";
    const bg = findMappingIssues(live(badGrammar));
    expect(bg.map(i => i.kind)).toEqual(["bad-id"]);
    expect(bg[0].why).toMatch(/mapping id "Map-1"/);
    const noId = '<section data-mapping="m1"><script type="application/json" data-mapping-spec>' + spec() + "</script></section>";
    const ni = findMappingIssues(live(noId));
    expect(ni.map(i => i.kind)).toEqual(["bad-id"]);
    expect(ni[0].why).toMatch(/section id must equal data-mapping/);
    expect(ni[0].why).toMatch(/no id attribute/);
    const otherId = '<section data-mapping="m1" id="m2"><script type="application/json" data-mapping-spec>' + spec() + "</script></section>";
    const oi = findMappingIssues(live(otherId));
    expect(oi.map(i => i.kind)).toEqual(["bad-id"]);
    expect(oi[0].why).toMatch(/id="m2"/);
    // id before data-mapping in the tag is fine
    const idFirst = '<section id="m1" class="x" data-mapping="m1"><script type="application/json" data-mapping-spec>' + spec() + "</script></section>";
    expect(kinds(live(idFirst))).toEqual([]);
  });

  // G2 — ≥ 1 item.
  test("a mapping without items is empty", () => {
    const issues = findMappingIssues(live(mapping("m1", spec({ items: [], proposal: [] }))));
    expect(issues.map(i => i.kind)).toEqual(["empty-mapping"]);
    expect(issues[0].why).toMatch(/no items/);
    const absent = JSON.stringify({ axes: [{ id: "x", columns: [{ id: "c1" }] }] });
    expect(kinds(live(mapping("m1", absent)))).toEqual(["empty-mapping"]);
  });

  // G4 — shapes: bare strings are not entries; non-array lists are spec errors.
  test("bare string entries are bad-id, not silently accepted", () => {
    const s = JSON.stringify({ items: ["a"], axes: [{ id: "x", columns: ["c1"] }] });
    const issues = findMappingIssues(live(mapping("m1", s)));
    expect(issues.map(i => i.kind)).toEqual(["bad-id", "bad-id"]);
    expect(issues[0].why).toMatch(/item entry "a" must be an object/);
    expect(issues[1].why).toMatch(/column \(axis "x"\) entry "c1"/);
    // and they are not treated as duplicates of each other
    expect(kinds(live(mapping("m1", JSON.stringify({ items: ["a", "a"], axes: [{ id: "x", columns: [{ id: "c1" }] }] }))))).toEqual(["bad-id", "bad-id"]);
  });

  test("a present but non-array items/elements/parts/axes/columns/context.values/proposal is spec-parse", () => {
    const cases = [
      [{ items: { id: "a" } }, '"items" must be an array'],
      [{ elements: "card" }, '"elements" must be an array'],
      [{ elements: [{ id: "card", parts: { id: "p" } }] }, '"parts" must be an array (element "card")'],
      [{ axes: {} }, '"axes" must be an array'],
      [{ axes: [{ id: "x", columns: "c1" }] }, '"columns" must be an array (axis "x")'],
      [{ context: { id: "d", values: "phone" } }, '"context.values" must be an array'],
      [{ proposal: { a: "x.c1" } }, '"proposal" must be an array'],
    ];
    for (const [extra, why] of cases) {
      const issues = findMappingIssues(live(mapping("m1", spec(extra))));
      const parse = issues.filter(i => i.kind === "spec-parse");
      expect(parse.length, why).toBe(1);
      expect(parse[0].why).toContain(why);
    }
    expect(kinds(live(mapping("m1", spec({ context: "device" }))))).toContain("spec-parse");
  });

  // G5 — the spec must sit inside the wrapper section.
  test("a spec after the wrapper's </section> does not count", () => {
    const stray = '<section data-mapping="m1" id="m1"><p>x</p></section><script type="application/json" data-mapping-spec>' + spec() + "</script>";
    expect(kinds(live(stray))).toEqual(["spec-missing"]);
    // ...even when no other mapping follows on the page at all
    const strayLast = live('<section data-mapping="m1" id="m1"></section>') + '<script data-mapping-spec>' + spec() + "</script>";
    expect(kinds(strayLast)).toEqual(["spec-missing"]);
    // inside the wrapper, after other content, is fine
    const inside = '<section data-mapping="m1" id="m1"><h3>T</h3><p>intro</p><script type="application/json" data-mapping-spec>' + spec() + "</script></section>";
    expect(kinds(live(inside))).toEqual([]);
  });

  // G6 — a context with zero values is no context (engine: contexts = null).
  test("context without values: empty-mapping only, no ctx-mismatch noise", () => {
    const s = spec({ context: { id: "d", values: [] } });
    const k = kinds(live(mapping("m1", s)));
    expect(k).toEqual(["empty-mapping"]);
    expect(k).not.toContain("ctx-mismatch");
    // a ctx-carrying proposal against such a spec IS a mismatch (no context)
    expect(kinds(live(mapping("m1", spec({ context: { id: "d", values: [] }, proposal: [["a", "x.c1", "phone"]] }))))).toContain("ctx-mismatch");
  });

  // G7 — single-quoted attribute values.
  test("single-quoted data-mapping / data-iteration / id attributes are read", () => {
    const sq = "<section data-iteration='1' data-active><section data-mapping='m1' id='m1'><script type=\"application/json\" data-mapping-spec>" + spec() + "</script></section></section>";
    expect(kinds(sq)).toEqual([]);
    const sqFrozen = "<section data-iteration='1'><section data-mapping='m1' id='m1'><script data-mapping-spec>" + spec() + "</script></section></section>";
    expect(kinds(sqFrozen)).toEqual(["frozen-without-submitted"]);
    const sqBadId = "<section data-mapping='m1' id=\"m2\"><script data-mapping-spec>" + spec() + "</script></section>";
    expect(kinds(live(sqBadId))).toEqual(["bad-id"]);
  });

  // G8 — mapping-only failures get a mapping-specific header and tail.
  test("buildBlockReason: mapping-only problems do not claim the page is not a live-bridge page", () => {
    const only = buildBlockReason("x.html", [], [], [], [{ kind: "bad-id", why: 'mapping "m1": x', at: 0 }]);
    expect(only).toMatch(/^BLOCKED: mapping spec problems in "x.html"\./);
    expect(only).not.toMatch(/not a valid live-bridge concept page/);
    expect(only).not.toMatch(/Regenerate the HTML/);
    expect(only).not.toMatch(/paste-into-chat/);
    expect(only).toMatch(/Mapping spec problems/);
    expect(only).toMatch(/bad-id: mapping "m1": x/);
    expect(only).toMatch(/fix only the mapping sections/);
    // combined with a missing marker the generic header and tail stay
    const mixed = buildBlockReason("x.html", [{ token: "t", why: "w" }], [], [], [{ kind: "bad-id", why: "y", at: 0 }]);
    expect(mixed).toMatch(/not a valid live-bridge concept page/);
    expect(mixed).toMatch(/Mapping spec problems/);
    expect(mixed).toMatch(/Regenerate the HTML/);
  });

  test("issues carry the offset of the mapping section and name the mapping", () => {
    const html = "<p>x</p>" + live(mapping("m1", "{nope"));
    const [issue] = findMappingIssues(html);
    expect(issue.at).toBe(html.indexOf('<section data-mapping="m1"'));
    expect(issue.why).toMatch(/m1/);
  });

  test("evaluate + buildBlockReason surface mapping issues", () => {
    const html = VALID.replace("</body>", wrap({ n: 2, active: false }, mapping("m1", spec())) + "</body>");
    const r = evaluate("docs/concepts/x.html", html);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.structural).toEqual([]);
    expect(r.mapping.map(i => i.kind)).toEqual(["frozen-without-submitted"]);
    const reason = buildBlockReason("x.html", [], [], [], r.mapping);
    expect(reason).toContain("frozen-without-submitted");
    expect(reason).toMatch(/Mapping spec problems/);
    expect(reason).toMatch(/Information Mapping/);
    expect(reason).toMatch(/submitted/);
    expect(reason).toMatch(/mappings\[\]/);
  });

  test("evaluate on a valid page without mappings reports mapping: []", () => {
    const r = evaluate("docs/concepts/x.html", VALID);
    expect(r.ok).toBe(true);
    expect(r.mapping).toEqual([]);
    expect(evaluate("src/app.js", "").mapping).toEqual([]);
  });
});
