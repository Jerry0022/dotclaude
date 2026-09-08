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
    execute: () => document.getElementById("closeout-execute").click(),
    plan: () =>
      Array.from(document.querySelectorAll("#closeout-plan li")).map((li) => ({
        kind: li.dataset.planKind,
        text: li.textContent,
      })),
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

  test("a report with no open questions hides the block instead of rendering an empty one", () => {
    const p = page({ noBlock: true });
    const block = p.sheet().querySelector('[data-closeout-block="followups"]');
    expect(block.hidden).toBe(true);
    expect(p.plan().map((l) => l.kind)).toEqual(["files", "close"]);
  });
});

describe("close-out sheet — the single irreversible click", () => {
  test("execute refuses to submit while the ship question is unanswered", () => {
    const p = page({ items: ITEMS });
    p.execute();
    expect(p.posted, "nothing was sent").toHaveLength(0);
    expect(p.document.getElementById("closeout-ship-required").hidden).toBe(false);
    // …and the button stays usable, rather than looking broken.
    expect(p.document.getElementById("closeout-execute").disabled).toBe(false);
  });

  test("answering the ship question clears the block and lets the submit through", async () => {
    const p = page({ items: ITEMS });
    p.execute();
    p.ship("no");
    expect(p.document.getElementById("closeout-ship-required").hidden).toBe(true);
    p.execute();
    await new Promise((r) => setTimeout(r, 0));
    expect(p.posted).toHaveLength(1);
  });

  test("the payload carries both buckets, the ship answer and the disposition", async () => {
    const p = page({ items: ITEMS });
    p.route("oq-saml", "implement");
    p.ship("yes");
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
    p.execute();
    await new Promise((r) => setTimeout(r, 0));
    expect(p.window.__stub.pending, "queued for retry").toBeTruthy();
    expect(p.sheet().dataset.frozen, "still sent, not re-armed").toBe("true");
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

  test("an open point with no name and no id does not take the sheet down", () => {
    // CSS.escape('') and a keyless row are the kind of markup a hand-written
    // report produces. The sheet must degrade, not throw.
    const p = page({ items: [{ id: null, title: "[CHORE] Nameless" }, ...ITEMS] });
    expect(p.rows()).toHaveLength(3);
    expect(() => p.window.collectIssueItems()).not.toThrow();
    expect(p.window.collectIssueItems()).toHaveLength(3);
  });
});
