import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";

// AUD-018 — the DESIGN template's screen-nav built its rows with innerHTML
// from `dataset.navLabel`. `dataset` hands back the DECODED attribute, so a
// label Claude escaped correctly (`data-nav-label="Login &lt;img …&gt;"`) was
// parsed as markup a second time: a script sink on the localhost concept page.
// buildDesignUI() now builds label + note marker as DOM nodes (navRowLabel /
// navRowMarker), exactly like buildSectionNav().
//
// Runs buildDesignUI() verbatim out of the templates reference on jsdom.

const md = readTemplates();

/** Brace-balanced slice from `marker` (the helpers sit indented in the layout IIFE). */
function slice(marker) {
  const start = md.indexOf(marker);
  if (start < 0) throw new Error(marker + " not found in templates.md");
  let i = md.indexOf("{", start), depth = 0;
  for (; i < md.length; i++) {
    if (md[i] === "{") depth++;
    else if (md[i] === "}" && --depth === 0) return md.slice(start, i + 1);
  }
  throw new Error("unbalanced braces after " + marker);
}

const EVIL = "Login &lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;";
const EVIL_TEXT = 'Login <img src=x onerror="window.__pwned=1">';

function build() {
  const dom = new JSDOM(
    `<body>
      <main>
        <section data-iteration="1" data-active>
          <div data-design="a" data-design-active="true" data-nav-label="${EVIL}">
            <section data-screen id="s1" data-nav-label="${EVIL}"></section>
          </div>
          <div data-view="v1" data-nav-label="${EVIL}"></div>
        </section>
      </main>
      <div id="design-switcher"></div>
      <nav id="screen-nav"></nav>
      <div id="dock"></div>
    </body>`,
    { runScripts: "outside-only", url: "https://concept.test/" }
  );
  const { window } = dom;
  window.eval(
    [
      "const designs = () => [...document.querySelectorAll('[data-design]')];",
      "const activeDesign = () => designs()[0];",
      "const views = () => [...document.querySelectorAll('[data-view]')];",
      "const dock = document.getElementById('dock');",
      "function showDesign() {} function showView() {} function showScreen() {} function closePanel() {}",
      "function buildDesignTextareas() {} function buildScreenTextareas() {} function buildViewTextareas() {}",
      "function updateScreenScope() {} function liveIterationId() { return '1'; }",
      slice("  function navRowLabel("),
      slice("  function navRowMarker("),
      slice("  function buildDesignUI("),
      "buildDesignUI();",
    ].join("\n")
  );
  return window;
}

describe("screen-nav labels stay text (AUD-018)", () => {
  test("an entity-encoded <img> label creates no element", () => {
    const w = build();
    const nav = w.document.getElementById("screen-nav");
    expect(nav.querySelectorAll("img").length).toBe(0);
    expect(w.document.querySelectorAll("img").length).toBe(0);
    expect(w.__pwned).toBeUndefined();
    const heading = nav.querySelector(".screen-nav-design-heading");
    const screen = nav.querySelector(".screen-nav-item");
    const view = nav.querySelector(".screen-nav-view-item");
    expect(heading.firstElementChild.textContent).toBe(EVIL_TEXT);
    expect(view.firstElementChild.textContent).toBe(EVIL_TEXT);
    expect(screen.firstElementChild.textContent).toBe("1." + EVIL_TEXT);
    expect(screen.querySelector(".screen-idx").textContent).toBe("1.");
  });

  test("the note markers keep their data-* hooks", () => {
    const w = build();
    const nav = w.document.getElementById("screen-nav");
    expect(nav.querySelector('.has-notes[data-design-note-marker="a"]')).not.toBeNull();
    expect(nav.querySelector('.has-notes[data-view-note-marker="v1"]')).not.toBeNull();
    expect(nav.querySelector(".screen-nav-item .has-notes[data-note-marker]")).not.toBeNull();
  });

  test("no navLabel reaches an innerHTML template anywhere in the engine", () => {
    const sinks = md.split("\n").filter(l => /innerHTML\s*=.*navLabel/.test(l));
    expect(sinks).toEqual([]);
  });
});
