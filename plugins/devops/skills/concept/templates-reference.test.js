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

  // The double-wiring defect this pins: initCommentAttachments() used to
  // match textarea[data-comment], which is a superset of the attachable
  // fields (plain comment-only textareas carry data-comment too, and
  // several attachable fields carry BOTH data-comment and data-attachable).
  // Matching on data-comment either wires a second bar onto an already-slot
  // ted field or wires one onto a field that was never meant to take a
  // file. The marker must be data-attachable, exclusively.
  test("initCommentAttachments matches data-attachable, not data-comment", () => {
    const fnMatch = md.match(/function initCommentAttachments\(\) \{[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch[0];
    expect(body).toContain("querySelectorAll('textarea[data-attachable]')");
    expect(body).not.toContain("querySelectorAll('textarea[data-comment]')");
  });

  // A QuotaExceededError from an unguarded localStorage.setItem throws out
  // of every change/input handler and silently kills all further
  // persistence — every call site in the reference (state save + both
  // submit-queue "-pending" writes) MUST go through the guard.
  test("every localStorage.setItem call site is guarded", () => {
    const rawCalls = jsBlocks.flatMap((b) => b.code.match(/localStorage\.setItem\(/g) || []);
    const guardDef = md.match(/function _guardedSetItem\(key, value\) \{[\s\S]*?\n\}/);
    expect(guardDef).not.toBeNull();
    const guardOwnCalls = (guardDef[0].match(/localStorage\.setItem\(/g) || []).length;
    // Every raw call outside the guard's own body must be zero — i.e. the
    // only literal localStorage.setItem( calls in the whole reference are
    // the ones inside _guardedSetItem itself.
    expect(rawCalls.length).toBe(guardOwnCalls);
  });

  test("every id the JS looks up is declared in the reference markup", () => {
    const used = new Set();
    const re = /getElementById\(['"]([A-Za-z0-9_-]+)['"]\)/g;
    let m;
    while ((m = re.exec(md))) used.add(m[1]);
    expect(used.size).toBeGreaterThan(0);

    // Ids the JS CREATES are exempt, and derived rather than listed: a
    // `getElementById(x)` paired with a `node.id = x` in the same reference is
    // an idempotence guard ("inject this once"), not a lookup of a mount the
    // markup owes. Deriving it keeps the exemption honest — delete the
    // creating assignment and the id lands back in `undeclared`.
    const created = new Set();
    const jsSource = jsBlocks.map((b) => b.code).join("\n");
    const idRe = /\.id\s*=\s*['"]([A-Za-z0-9_-]+)['"]/g;
    let c;
    while ((c = idRe.exec(jsSource))) created.add(c[1]);

    const undeclared = [...used]
      .filter((id) => !(id in OPTIONAL_IDS))
      .filter((id) => !created.has(id))
      .filter((id) => !htmlSource.includes(`id="${id}"`));

    // A missing mount point does not throw — the JS null-guards its lookups —
    // so the segment simply never appears. Nothing surfaces that at runtime.
    expect(undeclared).toEqual([]);
  });
});

// #343 — the upload-failure tooltip is the one string composed at RUNTIME
// (`rec.error` is only known in the browser), so the generation-time
// {{attach.*}} swap cannot reach it. The engine carries a runtime table
// instead; these tests pin that the table, the locale rows and the bridge's
// error taxonomy agree, so a failed upload never shows a raw token.
describe("attachment tooltip locale (#343)", () => {
  const jsSource = jsBlocks.map((b) => b.code).join("\n");

  // ATTACH_LOCALE = { key: '{{attach.key}}', ... } — parsed from the engine.
  const objMatch = /const ATTACH_LOCALE = \{([\s\S]*?)\};/.exec(jsSource);
  const runtimeKeys = new Map();
  if (objMatch) {
    const entryRe = /^\s*([a-z_]+):\s*'\{\{attach\.([a-z_]+)\}\}'/gm;
    let e;
    while ((e = entryRe.exec(objMatch[1]))) runtimeKeys.set(e[1], e[2]);
  }

  // The locale table rows: | `attach.<key>` | en | de |
  const tableKeys = new Set();
  const rowRe = /^\| `attach\.([a-z_]+)`\s+\|/gm;
  let r;
  while ((r = rowRe.exec(md))) tableKeys.add(r[1]);

  test("ATTACH_LOCALE exists and every value is the matching {{attach.<key>}} token", () => {
    expect(objMatch).not.toBeNull();
    expect(runtimeKeys.size).toBeGreaterThan(0);
    for (const [key, token] of runtimeKeys) expect(token).toBe(key);
  });

  test("no tooltip is composed from a runtime token any more", () => {
    expect(jsSource).not.toContain("'{{attach.' +");
    expect(jsSource).toContain("attachStatusText(rec)");
    expect(jsSource).toContain("ATTACH_LOCALE[rec.error] || ATTACH_LOCALE.error_generic");
  });

  test("every runtime key has a locale row, and every error_/uploading row has a runtime key", () => {
    for (const key of runtimeKeys.keys()) expect(tableKeys.has(key), `locale row for attach.${key}`).toBe(true);
    for (const key of tableKeys) {
      if (key === "uploading" || key.startsWith("error_")) {
        expect(runtimeKeys.has(key), `ATTACH_LOCALE entry for ${key}`).toBe(true);
      }
    }
  });

  test("every reason the bridge documents maps to a runtime key (client-bug 400s excepted)", () => {
    const bridgeMd = fs.readFileSync(path.join(__dirname, "deep-knowledge", "bridge-server.md"), "utf8");
    // | 413    | `too_large`           | ... — the error-response table.
    const reasonRe = /^\s*\|\s*\d{3}\s*\|\s*`([a-z_]+)`\s*\|/gm;
    const reasons = new Set();
    let m;
    while ((m = reasonRe.exec(bridgeMd))) reasons.add(m[1]);
    expect(reasons.has("too_large")).toBe(true); // the table was found
    // A malformed request the page itself sent is a client bug, not a state
    // the reviewer can act on — error_generic is the right text for those.
    const clientBugs = new Set(["bad_json", "bad_base64", "bad_content_length"]);
    for (const reason of reasons) {
      if (clientBugs.has(reason)) continue;
      expect(runtimeKeys.has("error_" + reason), `ATTACH_LOCALE.error_${reason}`).toBe(true);
    }
    // The client-side reasons the engine produces itself.
    expect(runtimeKeys.has("error_offline")).toBe(true);
    expect(runtimeKeys.has("error_generic")).toBe(true);
    // The old misnamed key is gone — the bridge says quota_exceeded.
    expect(tableKeys.has("error_quota")).toBe(false);
  });
});
