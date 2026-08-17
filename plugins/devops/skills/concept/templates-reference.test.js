import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// The concept skill's templates reference is not documentation — Claude copies
// its fenced code blocks verbatim into every generated concept page. A defect
// in one of those blocks therefore ships into other people's projects, and the
// failure is invariably silent: a page whose JS throws at boot renders fine and
// simply ignores every click.
//
// Three defects of exactly this shape were found by review rather than by the
// suite, after the code had already been committed:
//   1. a literal closing </script> inside a JS comment, which terminates the
//      host <script> element and kills the page — valid JS, invalid embedded;
//   2. four ids the JS dereferenced unguarded, so a page missing any one of
//      them lost the entire wiring IIFE;
//   3. four indicator mount points the JS filled but the reference markup never
//      declared, so those segments never rendered at all.
// These tests pin all three classes.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE = path.join(__dirname, "deep-knowledge", "templates.md");

const md = fs.readFileSync(REFERENCE, "utf8");

function blocks(lang) {
  const out = [];
  const re = new RegExp("```(?:" + lang + ")\\n([\\s\\S]*?)```", "g");
  let m;
  while ((m = re.exec(md))) {
    out.push({ code: m[1], line: md.slice(0, m.index).split("\n").length });
  }
  return out;
}

const jsBlocks = blocks("javascript|js");
const htmlBlocks = blocks("html");
const htmlSource = htmlBlocks.map((b) => b.code).join("\n");

// Ids the JS looks up but the reference markup deliberately does not declare.
// Every entry needs a reason: an unexplained exemption is how a real hole hides
// — and both former entries were exactly that. "panel-final-report" was listed
// as "appended only once a report exists" while § Common Structure had declared
// it all along, and "panel-frozen" was listed as "rendered by the shared
// panel-state markup" when no markup anywhere rendered it: showIteration()
// toggled a panel state that did not exist, so every past-iteration tab showed
// an empty panel. The frozen block now exists; keep this map empty unless a new
// exemption can state a reason that survives being checked.
const OPTIONAL_IDS = {};

describe("concept templates reference — embedded code integrity", () => {
  test("every JS block parses", () => {
    expect(jsBlocks.length).toBeGreaterThan(0);
    const failures = [];
    for (const [i, b] of jsBlocks.entries()) {
      try {
        new vm.Script(b.code);
      } catch (e) {
        failures.push(`block ${i + 1} (line ${b.line}): ${e.message.split("\n")[0]}`);
      }
    }
    expect(failures).toEqual([]);
  });

  // Valid JS, fatal once embedded: the HTML parser ends the <script> element at
  // the literal character sequence regardless of JS string or comment context.
  test("no JS block contains a literal closing script tag", () => {
    const offenders = jsBlocks
      .filter((b) => /<\/script/i.test(b.code))
      .map((b) => `line ${b.line}`);
    expect(offenders).toEqual([]);
  });

  // showIteration() switches FOUR panel states, unconditionally. Three of them
  // were declared; the frozen one was not, so reviewing any earlier tab emptied
  // the panel's lower half with no explanation and no way back to the live tab.
  test("every panel state showIteration switches is declared and reachable", () => {
    for (const id of ["panel-ready", "panel-submitted", "panel-frozen", "panel-final-report"]) {
      expect(htmlSource, id).toContain(`id="${id}"`);
      expect(md, id).toContain(`getElementById('${id}')`);
    }
    // The frozen state is a dead end without its exit.
    expect(htmlSource).toContain('id="back-to-live-btn"');
    expect(md).toContain("getElementById('back-to-live-btn')");
  });

  test("every id the JS looks up is declared in the reference markup", () => {
    const used = new Set();
    const re = /getElementById\(['"]([A-Za-z0-9_-]+)['"]\)/g;
    let m;
    while ((m = re.exec(md))) used.add(m[1]);
    expect(used.size).toBeGreaterThan(0);

    const undeclared = [...used]
      .filter((id) => !(id in OPTIONAL_IDS))
      .filter((id) => !htmlSource.includes(`id="${id}"`));

    // A missing mount point does not throw — the JS null-guards its lookups —
    // so the segment simply never appears. Nothing surfaces that at runtime.
    expect(undeclared).toEqual([]);
  });
});
