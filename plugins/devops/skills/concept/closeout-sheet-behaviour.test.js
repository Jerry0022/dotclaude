import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// The close-out sheet is the last screen of a concept session and the only
// one whose single click creates GitHub issues, writes code, cuts a release
// and deletes files. Every other test in this folder greps templates.md; this
// one RUNS the reference JS on jsdom, because the failure modes that matter
// here are not spellings:
//   * an item landing in both payload buckets, or in neither,
//   * a route change re-entering the change listener it just fired,
//   * execute submitting while the ship question is unanswered,
//   * a rebuild re-attaching row 2's radios to row 1's checkbox after Claude
//     routes one item and appends another in the same rewrite.
//
// The block under test is copied VERBATIM into every generated page, so a
// defect here ships into all of them at once.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");

function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null,
    body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) {
      if (open === null) {
        open = { info: m[1].trim(), start: i + 2 };
        body = [];
      } else {
        out.push({ info: open.info, line: open.start, code: body.join("\n") });
        open = null;
      }
      continue;
    }
    if (open) body.push(lines[i]);
  }
  return out;
}
const BLOCKS = scanBlocks(md);
const SKELETON = BLOCKS.find((b) => b.info === "html" && b.code.includes('id="panel-final-report"'));

// The whole close-out block, verbatim — including the top-level wiring, so
// the listeners under test are the real ones.
const CLOSEOUT_JS = (() => {
  const start = md.indexOf('// --- Final-report close-out sheet (action: "finalize") ---');
  const end = md.indexOf("// --- Offline Submit Queue ---", start);
  expect(start, "close-out block").toBeGreaterThan(-1);
  expect(end, "offline queue marker").toBeGreaterThan(start);
  return md.slice(start, end);
})();

const localeKeys = (src) => src.replace(/\{\{([a-z_.]+)\}\}/g, "$1");

/**
 * A page whose live round is a final report.
 * `items` = [{ id, title, checked?, disabled?, body? }] rendered into the
 * [data-open-questions] block exactly as SKILL.md tells Claude to write it.
 */
function page({ items = [], closed = false, noBlock = false } = {}) {
  const dom = new JSDOM(localeKeys(SKELETON.code), {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    // A real origin, not "about:blank": sessionStorage (the accordion's
    // answered-state mirror) throws "not available for opaque origins"
    // without one — a jsdom quirk, not a product bug.
    url: "https://concept.test/",
  });
  const { window } = dom;
  const { document } = window;

  const sec = document.createElement("section");
  sec.dataset.iteration = "2";
  sec.dataset.iterationTemplate = "free";
  sec.setAttribute("data-final-report", "");
  sec.setAttribute("data-active", "");
  if (closed) sec.setAttribute("data-closed", "");
  if (!noBlock) {
    const block = document.createElement("section");
    block.setAttribute("data-open-questions", "");
    const ul = document.createElement("ul");
    ul.className = "open-questions-list";
    for (const it of items) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      if (it.id !== null) box.name = it.id;
      box.checked = it.checked !== false;
      if (it.disabled) box.disabled = true;
      box.dataset.issueTitle = it.title;
      box.dataset.issueType = it.type || "chore";
      if (it.body) box.dataset.issueBody = it.body;
      if (it.role) box.dataset.issueRole = it.role;
      const span = document.createElement("span");
      span.className = "oq-label";
      span.textContent = it.label || it.title;
      label.appendChild(box);
      label.appendChild(span);
      li.appendChild(label);
      ul.appendChild(li);
    }
    block.appendChild(ul);
    sec.appendChild(block);
  }
  document.querySelector("main").appendChild(sec);

  const posted = [];
  window.eval(
    [
      // Globals the block shares with the rest of the page engine.
      "window.STORAGE_KEY = 'concept-test';",
      "var _submittedAt = 0, _submittedReloadCounter = null, _submittedAction = null;",
      "var _bootReloadCounter = 7;",
      "window.__stub = { pending: null, warn: null, dim: false };",
      "function _guardedSetItem(k, v) { window.__stub.pending = { k, v }; }",
      "function showContentDimmer() { window.__stub.dim = true; }",
      "function hideContentDimmer() { window.__stub.dim = false; }",
      "function showSubmitWarning(m) { window.__stub.warn = m; }",
      "window.__posted = [];",
      "window.__reply = { ok: true, body: { durable: true } };",
      // What GET /decisions answers — the boot check reads it to find a
      // finalize that outlived its tab.
      "window.__decisions = {};",
      "window.fetch = async (url, opts) => {",
      "  if (!opts || opts.method !== 'POST') {",
      "    return { ok: true, json: async () => window.__decisions };",
      "  }",
      "  window.__posted.push({ url, body: JSON.parse(opts.body) });",
      "  if (window.__reply.throws) throw new Error('offline');",
      "  return { ok: window.__reply.ok, json: async () => window.__reply.body };",
      "};",
      // jsdom implements neither scrollIntoView nor layout; the sheet uses it
      // to bring the ship warning into view. Browser behaviour, not product
      // logic — stub it rather than weakening the reference code.
      "if (!window.Element.prototype.scrollIntoView) window.Element.prototype.scrollIntoView = function () {};",
      // jsdom has CSS.escape, but a page opened in an older engine may not.
      "if (!window.CSS || !window.CSS.escape) window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&') };",
      CLOSEOUT_JS,
      "window.__submitted = () => ({ at: _submittedAt, action: _submittedAction, counter: _submittedReloadCounter });",
    ].join("\n")
  );

  const api = {
    window,
    document,
    posted: window.__posted,
    sheet: () => document.getElementById("closeout-sheet"),
    render: () => window.refreshCloseout({ reset: true }),
    boxes: () => Array.from(document.querySelectorAll("[data-open-questions] input[type=checkbox]")),
    rows: () => Array.from(document.querySelectorAll("#closeout-followup-list .followup")),
    /** Click a route the way a user does: check the radio, fire `change`. */
    route: (id, value) => {
      const input = document.querySelector(`input[name="fu-${id}"][value="${value}"]`);
      expect(input, `${id} → ${value}`).toBeTruthy();
      input.checked = true;
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    ship: (value) => {
      const input = document.querySelector(`input[name="closeout-ship"][value="${value}"]`);
      expect(input, "ship " + value).toBeTruthy();
      input.checked = true;
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    // A single click on the fixed button: confirms the open accordion row and
    // advances while anything is unanswered, submits once everything is.
    execute: () => document.getElementById("closeout-execute").click(),
    // Clicks through the accordion until every visible row is answered OR it
    // gets stuck (an unanswered ship row refuses forever) — capped so a stuck
    // sheet fails the test instead of hanging it. Deliberately stops SHORT of
    // the submit click: closeoutAllAnswered() flips to true the moment the
    // last row is confirmed, so the loop's own guard condition (checked
    // BEFORE each click) exits before that same click could also submit.
    advanceAll: () => {
      let guard = 0;
      while (!window.closeoutAllAnswered() && guard++ < 10) {
        document.getElementById("closeout-execute").click();
      }
    },
    row: (kind) => document.querySelector(`.closeout-block[data-closeout-block="${kind}"]`),
    rowHead: (kind) => document.querySelector(`.closeout-block[data-closeout-block="${kind}"] [data-closeout-row]`),
    rowMark: (kind) => document.querySelector(`.closeout-block[data-closeout-block="${kind}"] [data-closeout-mark]`)?.textContent,
    // The plan is one compact line now (#closeout-plan holds the items as
    // spans, joined by CSS " · "), not an <ol> — each consequence is still
    // its own element so it can be read one at a time.
    plan: () =>
      Array.from(document.querySelectorAll("#closeout-plan .closeout-plan-item")).map((el) => ({
        kind: el.dataset.planKind,
        text: el.textContent,
      })),
    planWarnHidden: () => document.getElementById("closeout-plan-warn").hidden,
  };
  // The block wires itself on DOM-ready (an inline <script> runs while the
  // document is still parsing). Deliver the event the way a browser does.
  api.boot = () => {
    if (document.readyState === "loading") {
      document.dispatchEvent(new window.Event("DOMContentLoaded"));
    } else {
      window.wireCloseout();
    }
  };
  api.boot();
  return api;
}

/** A page whose bridge reports `decisions` as the current submission state. */
async function pageWithBridge(decisions, opts) {
  const p = page(opts);
  p.window.__decisions = decisions;
  // Re-run the boot check now that the bridge has an answer.
  await p.window.restoreInFlightCloseout();
  return p;
}

const ITEMS = [
  { id: "oq-saml", title: "[BUG] SAML login fails", type: "bug", body: "repro steps" },
  { id: "oq-docs", title: "[DOCS] Update README", type: "docs" },
];

describe("close-out sheet — the three routes", () => {
  test("every open point defaults to Issue: one bucket filled, the other empty", () => {
    const p = page({ items: ITEMS });
    expect(p.rows()).toHaveLength(2);
    expect(p.window.collectIssueItems().map((i) => i.id)).toEqual(["oq-saml", "oq-docs"]);
    expect(p.window.collectImplementItems()).toEqual([]);
    // …and the item shape is the one both parts of finalize consume.
    const first = p.window.collectIssueItems()[0];
    expect(first).toMatchObject({
      id: "oq-saml",
      title: "[BUG] SAML login fails",
      type: "bug",
      description: "repro steps",
      selected: true,
    });
  });

  test("routing one point to Jetzt umsetzen moves it, and only it", () => {
    const p = page({ items: ITEMS });
    p.route("oq-saml", "implement");
    expect(p.window.collectImplementItems().map((i) => i.id)).toEqual(["oq-saml"]);
    expect(p.window.collectIssueItems().map((i) => i.id)).toEqual(["oq-docs"]);
    // The body checkbox stays checked — the point is still open, it is just
    // being built instead of filed.
    expect(p.boxes()[0].checked).toBe(true);
  });

  test("Ignorieren unchecks the body box and drops the item from BOTH buckets", () => {
    const p = page({ items: ITEMS });
    p.route("oq-docs", "ignore");
    expect(p.boxes()[1].checked).toBe(false);
    expect(p.window.collectIssueItems().map((i) => i.id)).toEqual(["oq-saml"]);
    expect(p.window.collectImplementItems()).toEqual([]);
    // The row stays on screen so the choice is reversible.
    expect(p.rows()).toHaveLength(2);
  });

  test("the buckets can never overlap, whatever the user clicks", () => {
    const p = page({ items: ITEMS });
    for (const seq of [["issue", "implement"], ["implement", "ignore"], ["ignore", "issue"]]) {
      p.route("oq-saml", seq[0]);
      p.route("oq-docs", seq[1]);
      const a = p.window.collectIssueItems().map((i) => i.id);
      const b = p.window.collectImplementItems().map((i) => i.id);
      expect(a.filter((id) => b.includes(id)), seq.join("/")).toEqual([]);
    }
  });

  test("two points sharing one name still get their own routes", () => {
    // A hand-written report repeating a checkbox `name` is the natural way to
    // write a list, and a radio group is keyed by name document-wide: one
    // click would recolour both rows, answer for both, and "Ignorieren" would
    // uncheck only one of them — leaving the other in NO bucket while it is
    // still on screen as open.
    const p = page({
      items: [
        { id: "oq", title: "[BUG] First" },
        { id: "oq", title: "[BUG] Second" },
      ],
    });
    expect(p.rows()).toHaveLength(2);
    const groups = p.rows().map((r) => r.querySelector("input").name);
    expect(new Set(groups).size, "one radio group per row").toBe(2);
    p.route(groups[1].replace(/^fu-/, ""), "implement");
    expect(p.window.collectImplementItems().map((i) => i.title)).toEqual(["[BUG] Second"]);
    expect(p.window.collectIssueItems().map((i) => i.title)).toEqual(["[BUG] First"]);
  });

  test("a nameless point is routed like any other, not silently filed", () => {
    // followUpRoute('') used to answer with the default without reading the
    // DOM, so a nameless row always became an issue no matter what the user
    // clicked — the silent downgrade SKILL.md forbids for the implement path.
    const p = page({ items: [{ id: null, title: "[CHORE] Nameless" }] });
    const group = p.rows()[0].querySelector("input").name;
    p.route(group.replace(/^fu-/, ""), "implement");
    expect(p.window.collectImplementItems().map((i) => i.title)).toEqual(["[CHORE] Nameless"]);
    expect(p.window.collectIssueItems()).toEqual([]);
  });

  test("an item routed away and back keeps its identity", () => {
    const p = page({ items: ITEMS });
    p.route("oq-saml", "ignore");
    p.route("oq-saml", "implement");
    expect(p.boxes()[0].checked).toBe(true);
    expect(p.window.collectImplementItems().map((i) => i.id)).toEqual(["oq-saml"]);
  });

  test("a route change does not re-enter the rebuild and lose the click", () => {
    // The route handler flips the body checkbox and dispatches `change` on it;
    // the document listener then re-renders. If that rebuilt the row list, the
    // radio the user just clicked would be replaced mid-event.
    const p = page({ items: ITEMS });
    const before = p.rows()[0];
    p.route("oq-saml", "implement");
    expect(p.rows()[0], "row identity survived the re-render").toBe(before);
    expect(
      p.document.querySelector('input[name="fu-oq-saml"][value="implement"]').checked
    ).toBe(true);
  });
});

describe("close-out sheet — what the user is promised", () => {
  test("the plan names every consequence, in the order Claude executes them", () => {
    const p = page({ items: ITEMS });
    p.route("oq-saml", "implement");
    p.ship("yes");
    expect(p.plan().map((l) => l.kind)).toEqual(["issues", "implement", "ship", "files", "close"]);
    expect(p.plan()[0].text).toContain("1 ×");
    expect(p.plan()[1].text).toContain("1 ×");
  });

  test("a plan line appears only for work that will actually happen", () => {
    const p = page({ items: ITEMS });
    p.route("oq-saml", "ignore");
    p.route("oq-docs", "ignore");
    p.ship("no");
    // No issues, no implementation, no ship — but the page disposition and the
    // session end still happen, so they are still named.
    expect(p.plan().map((l) => l.kind)).toEqual(["files", "close"]);
    expect(p.document.getElementById("closeout-followups-none").hidden).toBe(false);
  });

  test("the plan is live: it re-renders on every answer", () => {
    const p = page({ items: ITEMS });
    expect(p.plan().find((l) => l.kind === "ship")).toBeUndefined();
    p.ship("yes");
    expect(p.plan().find((l) => l.kind === "ship")).toBeTruthy();
    p.ship("no");
    expect(p.plan().find((l) => l.kind === "ship")).toBeUndefined();
  });

  test("the plan is one compact line, items joined visually by CSS not by text", () => {
    const p = page({ items: ITEMS });
    p.route("oq-saml", "implement");
    p.ship("yes");
    // Each consequence is still its own element…
    const items = p.document.querySelectorAll("#closeout-plan .closeout-plan-item");
    expect(items.length).toBe(5);
    // …none of them contain a literal " · " themselves — the join is CSS
    // (.closeout-plan-item + .closeout-plan-item::before), not baked into
    // buildCloseoutPlan()'s text.
    for (const el of items) expect(el.textContent).not.toContain(" · ");
    // No heading, no <ol> — the container is a single-line host now.
    expect(p.sheet().querySelector('[data-closeout-block="plan"] h4')).toBeNull();
    expect(p.sheet().querySelector('[data-closeout-block="plan"] ol')).toBeNull();
  });

  test("the plan warn hint only shows once the click it describes can fire", () => {
    const p = page({ items: ITEMS });
    expect(p.planWarnHidden(), "unanswered ship — nothing to warn about yet").toBe(true);
    p.ship("no");
    p.advanceAll();
    expect(p.planWarnHidden(), "every row answered — the click is live").toBe(false);
  });

  test("a report with no open questions hides the block instead of rendering an empty one", () => {
    const p = page({ noBlock: true });
    const block = p.sheet().querySelector('[data-closeout-block="followups"]');
    expect(block.hidden).toBe(true);
    expect(p.plan().map((l) => l.kind)).toEqual(["files", "close"]);
  });
});

describe("close-out sheet — the single irreversible click", () => {
  test("the button cannot advance past an unanswered ship row", () => {
    const p = page({ items: ITEMS });
    p.advanceAll(); // confirms followups, then stalls on the unanswered ship row
    expect(p.posted, "nothing was sent").toHaveLength(0);
    expect(p.document.getElementById("closeout-ship-required").hidden).toBe(false);
    // …and the button stays usable, rather than looking broken.
    expect(p.document.getElementById("closeout-execute").disabled).toBe(false);
    expect(p.window.closeoutAllAnswered()).toBe(false);
  });

  test("answering the ship question clears the block and lets the submit through", async () => {
    const p = page({ items: ITEMS });
    p.advanceAll(); // stalls on ship
    p.ship("no");
    expect(p.document.getElementById("closeout-ship-required").hidden).toBe(true);
    p.advanceAll(); // confirms ship, then files (default) — now ready
    p.execute();
    await new Promise((r) => setTimeout(r, 0));
    expect(p.posted).toHaveLength(1);
  });

  test("the payload carries both buckets, the ship answer and the disposition", async () => {
    const p = page({ items: ITEMS });
    p.route("oq-saml", "implement");
    p.ship("yes");
    p.advanceAll();
    p.execute();
    await new Promise((r) => setTimeout(r, 0));
    const body = p.posted[0].body;
    expect(p.posted[0].url).toBe("/decisions");
    expect(body.action).toBe("finalize");
    expect(body.submission_id).toMatch(/^sub-/);
    expect(body.issues).toMatchObject({ create: true });
    expect(body.issues.items.map((i) => i.id)).toEqual(["oq-docs"]);
    expect(body.implement).toMatchObject({ run: true });
    expect(body.implement.items.map((i) => i.id)).toEqual(["oq-saml"]);
    expect(body.ship).toEqual({ run: true });
    expect(body.disposition).toEqual({ mode: "discard", moveTo: null });
  });

  test("a submitted sheet is frozen and cannot be fired twice", async () => {
    const p = page({ items: ITEMS });
    p.ship("no");
    p.advanceAll();
    p.execute();
    await new Promise((r) => setTimeout(r, 0));
    expect(p.sheet().dataset.frozen).toBe("true");
    expect(p.document.getElementById("closeout-execute").disabled).toBe(true);
    // Even a direct call must bail — the button is not the only way in.
    p.window.submitFinalize();
    await new Promise((r) => setTimeout(r, 0));
    expect(p.posted).toHaveLength(1);
    // The submit-state bookkeeping pollProcessedState() depends on is set.
    expect(p.window.__submitted().action).toBe("finalize");
    expect(p.window.__submitted().counter).toBe(7);
  });

  test("a bridge that answers but cannot persist hands the sheet back", async () => {
    const p = page({ items: ITEMS });
    p.window.__reply = { ok: true, body: { durable: false } };
    p.ship("no");
    p.advanceAll();
    p.execute();
    await new Promise((r) => setTimeout(r, 0));
    expect(p.sheet().dataset.frozen).toBe("false");
    expect(p.document.getElementById("closeout-execute").disabled).toBe(false);
    expect(p.window.__stub.warn, "the user is told").toBeTruthy();
    expect(p.window.__stub.pending, "and the payload is queued").toBeTruthy();
    expect(p.window.__submitted().at).toBe(0);
  });

  test("an offline bridge queues the payload and keeps the sent state", async () => {
    const p = page({ items: ITEMS });
    p.window.__reply = { throws: true };
    p.ship("no");
    p.advanceAll();
    p.execute();
    await new Promise((r) => setTimeout(r, 0));
    expect(p.window.__stub.pending, "queued for retry").toBeTruthy();
    expect(p.sheet().dataset.frozen, "still sent, not re-armed").toBe("true");
  });
});

describe("close-out sheet — the accordion", () => {
  test("collapsed rows show one line each, and exactly one is open", () => {
    const p = page({ items: ITEMS });
    for (const kind of ["followups", "ship", "files"]) {
      expect(p.rowHead(kind), kind).toBeTruthy();
    }
    const open = ["followups", "ship", "files"].filter(
      (k) => p.rowHead(k).getAttribute("aria-expanded") === "true"
    );
    expect(open).toEqual(["followups"]);
  });

  test("clicking a row head opens it and closes the others", () => {
    const p = page({ items: ITEMS });
    p.rowHead("files").click();
    expect(p.rowHead("files").getAttribute("aria-expanded")).toBe("true");
    expect(p.rowHead("followups").getAttribute("aria-expanded")).toBe("false");
    expect(p.rowHead("ship").getAttribute("aria-expanded")).toBe("false");
  });

  test("the marker flips from ○ to ✓ only once a row is confirmed", () => {
    const p = page({ items: ITEMS });
    expect(p.rowMark("followups")).toBe("○");
    expect(p.rowMark("ship")).toBe("○");
    p.execute(); // confirms the open row (followups)
    expect(p.rowMark("followups")).toBe("✓");
    expect(p.rowMark("ship")).toBe("○");
  });

  test("Weiter confirms the open row and opens the next unanswered one", () => {
    const p = page({ items: ITEMS });
    expect(p.row("followups").dataset.answered).toBe("false");
    p.execute();
    expect(p.row("followups").dataset.answered).toBe("true");
    expect(p.rowHead("ship").getAttribute("aria-expanded")).toBe("true");
  });

  test("the button reads Weiter until every row is answered, then Ausführen", () => {
    const p = page({ items: ITEMS });
    const btn = p.document.getElementById("closeout-execute");
    expect(btn.dataset.ready).toBe("false");
    expect(btn.textContent).toContain("closeout_next");
    p.ship("no");
    p.advanceAll();
    expect(btn.dataset.ready).toBe("true");
    expect(btn.textContent).toContain("closeout_execute");
  });

  test("the icon only appears once the button is ready — no '› Weiter ›'", () => {
    // The label string ("Weiter ›") already carries its own "›"; an
    // always-visible icon glyph next to it rendered "› Weiter ›".
    const p = page({ items: ITEMS });
    const btn = p.document.getElementById("closeout-execute");
    const icon = btn.querySelector("[data-closeout-btn-icon]");
    expect(icon.hidden, "icon hidden in the Weiter state").toBe(true);
    p.ship("no");
    p.advanceAll();
    expect(icon.hidden, "icon shown once ready").toBe(false);
    expect(icon.textContent).toBe("⚠");
  });

  test("re-opening an answered row does not un-answer it", () => {
    const p = page({ items: ITEMS });
    p.execute(); // confirm followups
    p.rowHead("followups").click(); // look again
    expect(p.row("followups").dataset.answered).toBe("true");
    expect(p.rowHead("followups").getAttribute("aria-expanded")).toBe("true");
  });

  test("progress reads n of total answered while the sheet is live", () => {
    const p = page({ items: ITEMS });
    // The skeleton fixture does not run the real locale substitution (that
    // happens at page-generation time, not in the browser) — supply a
    // template here the way a generated page would.
    p.sheet().dataset.labelProgress = "{n} of {total} answered";
    p.window.updateCloseoutProgress();
    const progress = () => p.document.getElementById("closeout-progress").textContent;
    expect(progress()).toBe("0 of 3 answered");
    p.execute();
    expect(progress()).toBe("1 of 3 answered");
  });

  test("answered state survives a reload within the same session", () => {
    const p = page({ items: ITEMS });
    p.execute(); // confirm followups
    expect(p.row("followups").dataset.answered).toBe("true");
    // Simulate a reload: the DOM node's own dataset is fresh (as it would be
    // on a freshly parsed page), but sessionStorage — same tab, same session
    // — is not.
    delete p.row("followups").dataset.answered;
    delete p.row("followups").dataset.open;
    p.render();
    expect(p.row("followups").dataset.answered).toBe("true");
  });

  test("freezing the sheet disables the row heads too, not just the button", () => {
    const p = page({ items: ITEMS });
    p.window.setCloseoutFrozen(true);
    for (const kind of ["followups", "ship", "files"]) {
      expect(p.rowHead(kind).disabled, kind).toBe(true);
    }
  });
});

describe("close-out sheet — a finalize that outlives its tab", () => {
  test("a reload during a running finalize comes back frozen, not re-armed", async () => {
    // The dangerous version of this: the sheet comes back ready, the user
    // clicks execute again, and the second payload carries a NEW
    // submission_id — which the replay guard cannot recognise as a duplicate.
    // A second `gh issue create` run and a second real release.
    const p = await pageWithBridge(
      { submitted: true, action: "finalize", _version: 4 },
      { items: ITEMS }
    );
    expect(p.sheet().dataset.frozen).toBe("true");
    expect(p.document.getElementById("closeout-execute").disabled).toBe(true);
    const running = p.sheet().querySelector('.hint[data-finalize-state="running"]');
    expect(running.hidden, "the user is told it is still running").toBe(false);
    // …and it re-joins the state machine, so the 5-minute recovery still runs.
    expect(p.window.__submitted().action).toBe("finalize");
  });

  test("a processed finalize does not freeze a fresh sheet", async () => {
    const p = await pageWithBridge(
      { submitted: true, action: "finalize", _processed_at: new Date().toISOString() },
      { items: ITEMS }
    );
    expect(p.sheet().dataset.frozen).not.toBe("true");
  });

  test("an iterate submission on the bridge is none of the sheet's business", async () => {
    const p = await pageWithBridge({ submitted: true, action: "iterate" }, { items: ITEMS });
    expect(p.sheet().dataset.frozen).not.toBe("true");
  });

  test("a stalled finalize stays frozen and says so — it never re-arms", () => {
    // The safety net used to hand the sheet back after 5 minutes. With the
    // default disposition the file is already deleted by then and the bridge
    // is shutting down, so a click there queues a payload nobody picks up.
    const p = page({ items: ITEMS });
    p.window.markCloseoutStalled();
    expect(p.sheet().dataset.frozen).toBe("true");
    expect(p.sheet().querySelector('.hint[data-finalize-state="stalled"]').hidden).toBe(false);
    expect(p.sheet().querySelector('.hint[data-finalize-state="running"]').hidden).toBe(true);
  });
});

describe("close-out sheet — the report Claude rewrites underneath it", () => {
  test("a routed item drops out, and a newly appended one keeps its own routes", () => {
    // Claude routes one item (adds `disabled`) and appends another in the same
    // rewrite. A count-keyed rebuild would re-attach row 1's radios to the
    // wrong checkbox and file an issue for the item the user did not pick.
    const p = page({ items: ITEMS });
    p.route("oq-docs", "implement");
    p.boxes()[0].disabled = true; // oq-saml became [Issue #12]
    const li = p.document.createElement("li");
    li.innerHTML =
      '<label><input type="checkbox" name="oq-new" data-issue-title="[CHORE] New point" checked>' +
      '<span class="oq-label">New point</span></label>';
    p.document.querySelector(".open-questions-list").appendChild(li);
    p.render();

    expect(p.rows().map((r) => r.dataset.followup)).toEqual(["oq-docs", "oq-new"]);
    // The surviving row kept the user's answer; the new one starts on Issue.
    expect(p.window.collectImplementItems().map((i) => i.id)).toEqual(["oq-docs"]);
    expect(p.window.collectIssueItems().map((i) => i.id)).toEqual(["oq-new"]);
  });

  test("a detour into an earlier round does not silently reset the routes", () => {
    // showIteration() calls refreshCloseout({ reset: true }) on every tab
    // switch. Reading an earlier iteration and coming back is the most normal
    // thing a reviewer does on a final report — and it used to move every row
    // back to Issue, with the plan above the execute button agreeing.
    const p = page({ items: ITEMS });
    p.route("oq-saml", "implement");
    p.route("oq-docs", "ignore");
    p.render();
    expect(p.window.collectImplementItems().map((i) => i.id)).toEqual(["oq-saml"]);
    expect(p.window.collectIssueItems()).toEqual([]);
    expect(p.plan().map((l) => l.kind)).toEqual(["implement", "files", "close"]);
  });

  test("once every item is routed the block disappears and the sheet still closes", () => {
    const p = page({ items: ITEMS });
    p.boxes().forEach((b) => { b.disabled = true; });
    p.render();
    expect(p.sheet().querySelector('[data-closeout-block="followups"]').hidden).toBe(true);
    expect(p.plan().map((l) => l.kind)).toEqual(["files", "close"]);
  });

  test("a closed-out report shows the outcome and no controls at all", () => {
    const p = page({ items: ITEMS, closed: true });
    for (const block of p.sheet().querySelectorAll(".closeout-block")) {
      expect(block.hidden).toBe(true);
    }
    expect(p.document.getElementById("closeout-execute").hidden).toBe(true);
    const done = p.sheet().querySelector('.hint[data-finalize-state="done"]');
    expect(done.hidden).toBe(false);
  });

  test("the done state's hand-offs head is permanently disabled and stripped of its mark/summary", () => {
    // [hidden] alone loses to .closeout-row's own `display: flex` in the
    // cascade, so a row hidden that way still LOOKED clickable (the ○ mark
    // and label kept rendering). The done branch must disable the head and
    // remove its answerable affordances instead of trying to hide it.
    const p = page({ items: ITEMS, closed: true });
    const head = p.rowHead("handoffs");
    expect(head.disabled, "permanently disabled").toBe(true);
    expect(head.hasAttribute("aria-expanded"), "no longer expandable").toBe(false);
    expect(head.querySelector("[data-closeout-mark]").hidden, "no ○/✓ mark").toBe(true);
    expect(head.querySelector("[data-closeout-summary]").hidden, "no summary").toBe(true);
  });

  test("an open point with no name and no id does not take the sheet down", () => {
    // CSS.escape('') and a keyless row are the kind of markup a hand-written
    // report produces. The sheet must degrade, not throw.
    const p = page({ items: [{ id: null, title: "[CHORE] Nameless" }, ...ITEMS] });
    expect(p.rows()).toHaveLength(3);
    expect(() => p.window.collectIssueItems()).not.toThrow();
    expect(p.window.collectIssueItems()).toHaveLength(3);
  });
});
