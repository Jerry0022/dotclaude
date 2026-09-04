import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #297 — dock notes destroyed on reload / design switch. One symptom, two
// independent causes, both pinned here because either alone still loses text:
//
//   1. Ordering. The dock textareas are created by buildDesignUI() inside
//      wireDesignLayout()'s DOMContentLoaded handler. § State Persistence
//      registers a SEPARATE DOMContentLoaded listener that calls
//      restoreState(), and the two blocks have no guaranteed order — the
//      restore can run against a dock that does not exist yet, write
//      nothing, and never re-run. (applyDockSize() already carries a safety
//      re-call for exactly this reason; the text restore did not.)
//   2. Destruction. saveState() built `state = {}` from scratch and
//      serialised only the nodes present at save time, so the first `input`
//      event after (1) persisted a blob WITHOUT the `text:{screen-id}`
//      keys — deleting the notes rather than merely hiding them.
//
// templates.md is a reference Claude copies verbatim, so a regression here
// ships into every concept generated afterwards.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");

// Line-based fence scanner — same reason as panel-chrome.test.js /
// design-nav-guard.test.js: a lazy ```js …``` regex desynchronises on the
// first block whose body contains a fence and goes blind after it.
function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null, body = [];
  for (const line of lines) {
    const m = /^```(.*)$/.exec(line);
    if (m) {
      if (open === null) { open = m[1].trim(); body = []; }
      else { out.push({ info: open, code: body.join("\n") }); open = null; }
      continue;
    }
    if (open !== null) body.push(line);
  }
  return out;
}

const jsSource = scanBlocks(md)
  .filter((b) => /^(javascript|js)$/.test(b.info))
  .map((b) => b.code)
  .join("\n");

/** Slices a brace-balanced body starting at `marker`. */
function slice(src, marker, from = 0) {
  const start = src.indexOf(marker, from);
  expect(start, marker).toBeGreaterThan(-1);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced braces after " + marker);
}

/** The design layout's own load handler — the one that calls buildDesignUI().
 *  There are ~10 DOMContentLoaded listeners in templates.md, so it is found
 *  by its first statement rather than by ordinal. */
function designLoadHandler() {
  const anchor = jsSource.indexOf("buildDesignUI();");
  expect(anchor, "wireDesignLayout must build the design UI on load")
    .toBeGreaterThan(-1);
  const open = jsSource.lastIndexOf("document.addEventListener('DOMContentLoaded'", anchor);
  expect(open, "buildDesignUI() must be called from a DOMContentLoaded handler")
    .toBeGreaterThan(-1);
  return slice(jsSource, "document.addEventListener('DOMContentLoaded'", open);
}

/** Strips line comments. The handlers are heavily commented and those comments
 *  NAME the calls being ordered ("showScreen() ends in saveState()"), so a raw
 *  indexOf() finds the prose, not the call, and the ordering assertions below
 *  would pass or fail on where a sentence sits. */
function code(src) {
  return src.replace(/\/\/[^\r\n]*/g, "");
}

function iterationChangedHandler() {
  return slice(jsSource, "document.addEventListener('iteration:changed'");
}

describe("the dock text restore runs after the dock is built", () => {
  test("the design load handler re-invokes restoreState()", () => {
    const h = designLoadHandler();
    expect(h, "the design load handler must re-run restoreState() itself")
      .toMatch(/typeof restoreState === 'function'\)\s*restoreState\(\)/);
  });

  test("the re-restore comes AFTER buildDesignUI()", () => {
    // Ordering is the whole defect: restoring before the textareas exist is
    // exactly what the § State Persistence block already (uselessly) does.
    const h = designLoadHandler();
    expect(h.indexOf("restoreState()"), "restoreState() must follow buildDesignUI()")
      .toBeGreaterThan(h.indexOf("buildDesignUI();"));
  });

  test("the re-restore comes BEFORE anything that can call saveState()", () => {
    // Measured, not deduced: with the restore merely somewhere after
    // buildDesignUI(), the load path ran
    //   buildDesignUI() -> showScreen() -> saveState() -> restoreState()
    // and saveState() serialised the freshly rebuilt (EMPTY) textareas over
    // the stored notes. The merge cannot help — those nodes are PRESENT — so
    // the restore two lines later read a blob it had just blanked.
    const h = code(designLoadHandler());
    const restore = h.indexOf("restoreState()");
    expect(restore, "restoreState() must follow buildDesignUI()")
      .toBeGreaterThan(h.indexOf("buildDesignUI();"));
    expect(restore, "restoreState() must precede showScreen()")
      .toBeLessThan(h.indexOf("showScreen("));
    expect(restore, "restoreState() must precede primeDock()")
      .toBeLessThan(h.indexOf("primeDock()"));
  });

  test("markers are refreshed with the restored values", () => {
    // Restored text with stale ☰ dots reads as "my note is gone" just the
    // same — the panel is where the user looks for it.
    const h = designLoadHandler();
    expect(h.indexOf("updateNoteMarkers()"), "updateNoteMarkers() must follow the restore")
      .toBeGreaterThan(h.indexOf("restoreState()"));
  });

  test("the design switch / iteration rebuild restores too", () => {
    // buildDesignUI() runs a second time on iteration:changed and rebuilds
    // all three dock containers. harvestDockValues() only carries fields
    // that were on screen, so without this the rest come back blank.
    const h = iterationChangedHandler();
    expect(h, "iteration:changed must re-restore after its buildDesignUI()")
      .toMatch(/typeof restoreState === 'function'\)\s*restoreState\(\)/);
    const c = code(h);
    const restore = c.indexOf("restoreState()");
    expect(restore, "the restore must follow the rebuild")
      .toBeGreaterThan(c.indexOf("buildDesignUI();"));
    // Same ordering trap as the load path: showScreen() and primeDock() both
    // end in saveState(), against a dock buildDesignUI() has just emptied.
    expect(restore, "the restore must precede showScreen()")
      .toBeLessThan(c.indexOf("showScreen("));
    expect(restore, "the restore must precede primeDock()")
      .toBeLessThan(c.indexOf("primeDock()"));
  });

  test("the iteration restore is skipped on a frozen tab", () => {
    // applyDockFreezeState() paints the frozen blob into the same fields and
    // stashes the live values; restoring localStorage over that shows live
    // text inside a read-only frozen iteration and drops the stash.
    const h = iterationChangedHandler();
    const at = h.indexOf("restoreState()");
    expect(h.slice(Math.max(0, at - 300), at), "guard the re-restore on viewing-frozen")
      .toMatch(/viewing-frozen/);
  });
});

describe("saveState() merges instead of rebuilding from the DOM", () => {
  const body = () => slice(jsSource, "function saveState(");

  test("it seeds the blob from the stored value", () => {
    const b = body();
    expect(b, "saveState must read the previously stored blob first")
      .toMatch(/JSON\.parse\(localStorage\.getItem\(STORAGE_KEY\)/);
    const seed = b.indexOf("localStorage.getItem(STORAGE_KEY)");
    expect(seed, "the read must precede the DOM scans it merges over")
      .toBeLessThan(b.indexOf("document.querySelectorAll"));
  });

  test("the state object is no longer a from-scratch literal", () => {
    const code = body().replace(/\/\/[^\n]*/g, "");
    expect(code, "`const state = {` rebuilds the blob and deletes absent keys")
      .not.toMatch(/const state = \{/);
  });

  test("a stale or foreign-version blob is not merged forward", () => {
    // Otherwise the merge resurrects exactly the payload restoreState()
    // would have thrown away, and carries its dead keys for another TTL.
    const b = body();
    expect(b, "the merge must re-apply the TTL check").toMatch(/STATE_TTL_MS/);
    expect(b, "and the page-version check").toMatch(/_pageVersion/);
  });

  test("an untouched empty field never blanks a stored note", () => {
    // Belt and braces for the ordering above: ANY future saveState() that
    // slips in between a dock rebuild and the restore would otherwise write
    // "" over a real note. Only a field the user has actually typed into
    // (data-touched, stamped from a TRUSTED input event) may persist "" — so
    // deliberately clearing a note still works.
    const b = body();
    expect(b, "guard empty values against the stored blob")
      .toMatch(/el\.value === ''[\s\S]{0,120}dataset\.touched === undefined/);
    expect(jsSource, "data-touched must be stamped from a trusted input event")
      .toMatch(/e\.isTrusted[\s\S]{0,120}dataset\.touched = 'true'/);
    const stamp = jsSource.indexOf("dataset.touched = 'true'");
    expect(jsSource.slice(stamp, stamp + 120), "capture phase, so it runs before saveState")
      .toMatch(/\}, true\)/);
  });

  test("conditionally written keys are deleted when absent", () => {
    // Under a merge, "not written" no longer means "cleared": a stale
    // _activeView sends every later reload back into a view the user left.
    const b = body();
    expect(b, "_activeView must be deleted when no view is active")
      .toMatch(/delete state\['_activeView'\]/);
    expect(b, "_userInteracted must be deleted when the flag is false")
      .toMatch(/delete state\['_userInteracted'\]/);
  });
});

describe("the validation gate pins the invariant", () => {
  test("a P entry covers restore-after-build and the merge", () => {
    const row = gate.split("\n").find((l) => /^\|\s*P\d+\w*\s*\|/.test(l) &&
      /restoreState\(\)/.test(l) && /saveState\(\)/.test(l) && /merg/i.test(l));
    expect(row, "no P entry covers the dock persistence invariant").toBeDefined();
    expect(row, "the entry must name buildDesignUI() as the ordering anchor")
      .toMatch(/buildDesignUI\(\)/);
    expect(row, "and state that the merge must not rebuild from the DOM")
      .toMatch(/DOM/);
  });
});
