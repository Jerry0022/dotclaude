import { describe, test, expect } from "vitest";
import {
  REQUIRED,
  isConceptHtml,
  findMissing,
  findForbidden,
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
  <div class="connection-warning"></div></div>
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
