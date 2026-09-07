import { describe, test, expect } from "vitest";
import {
  REQUIRED,
  isConceptHtml,
  findMissing,
  findForbidden,
  findStructural,
  evaluate,
  buildBlockReason,
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
