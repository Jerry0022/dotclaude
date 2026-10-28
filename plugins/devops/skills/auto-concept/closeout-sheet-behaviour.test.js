import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";

// The close-out sheet is the last screen of a concept session and the only
// one whose single click creates GitHub issues, writes code, cuts a release
// and deletes files. This suite RUNS the reference JS on jsdom, because the
// failure modes that matter here are not spellings:
//   * a Fund landing in both payload buckets, or in neither,
//   * a pre-selection the user cannot see deciding what gets built,
//   * a ship that was never the user's answer,
//   * a 🧪/👉 choice that does not reach the payload with its mode,
//   * a sheet that re-arms over a finalize that is still running.
//
// The block under test is copied VERBATIM into every generated page, so a
// defect here ships into all of them at once.

const md = readTemplates();

function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null,
    body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) {
      if (open === null) {
        open = { info: m[1].trim() };
        body = [];
      } else {
        out.push({ info: open.info, code: body.join("\n") });
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
 * A page whose live round is a final report, written the way
 * step5-update-page.md tells Claude to write it.
 * funde    = [{ id, title, label?, route?, reason?, origin?, body?, routed? }]
 * tests    = [{ id, text, crit?, guide?, mode? }]   → [data-tests] li
 * handoffs = same                                   → [data-handoffs] li
 */
function page({ funde = [], tests = [], handoffs = [], closed = false } = {}) {
  const dom = new JSDOM(localeKeys(SKELETON.code), {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://concept.test/",
  });
  const { window } = dom;
  const { document } = window;
  // The final-report tab shows this panel (templates-rounds.md); a hidden one cannot take focus (jsdom 30, as in browsers).
  document.getElementById("panel-final-report").style.display = "flex";

  const sec = document.createElement("section");
  sec.dataset.iteration = "2";
  sec.dataset.iterationTemplate = "free";
  sec.setAttribute("data-final-report", "");
  sec.setAttribute("data-active", "");
  if (closed) sec.setAttribute("data-closed", "");
  if (funde.length) {
    const fold = document.createElement("details");
    fold.className = "fr-fold";
    fold.setAttribute("data-open-questions", "");
    const ul = document.createElement("ul");
    for (const f of funde) {
      const li = document.createElement("li");
      if (f.id) li.dataset.oqId = f.id;
      li.dataset.issueTitle = f.title;
      li.dataset.issueType = f.type || "chore";
      if (f.body) li.dataset.issueBody = f.body;
      if (f.route) li.dataset.routeDefault = f.route;
      if (f.reason) li.dataset.routeReason = f.reason;
      li.dataset.oqOrigin = f.origin || "found";
      if (f.routed) li.setAttribute("data-routed", "");
      const label = document.createElement("span");
      label.className = "oq-label";
      label.textContent = f.label || f.title.replace(/^\[[A-Z]+\]\s*/, "");
      li.appendChild(label);
      ul.appendChild(li);
    }
    fold.appendChild(ul);
    sec.appendChild(fold);
  }
  for (const [attr, list] of [["data-tests", tests], ["data-handoffs", handoffs]]) {
    if (!list.length) continue;
    const block = document.createElement("section");
    block.setAttribute(attr, "");
    block.hidden = true;
    const ul = document.createElement("ul");
    for (const t of list) {
      const li = document.createElement("li");
      li.dataset.todoId = t.id;
      if (t.crit) li.dataset.crit = t.crit;
      if (t.guide != null) li.dataset.guide = t.guide;
      if (t.mode) li.dataset.mode = t.mode;
      li.textContent = t.text;
      ul.appendChild(li);
    }
    block.appendChild(ul);
    sec.appendChild(block);
  }
  document.querySelector("main").appendChild(sec);

  window.eval(
    [
      "window.STORAGE_KEY = 'concept-test';",
      "var _submittedAt = 0, _submittedReloadCounter = null, _submittedAction = null;",
      "var _bootReloadCounter = 7;",
      "window.__stub = { pending: null, warn: null, dim: false, closed: 0 };",
      "function _guardedSetItem(k, v) { window.__stub.pending = { k, v }; }",
      "function showContentDimmer() { window.__stub.dim = true; }",
      "function hideContentDimmer() { window.__stub.dim = false; }",
      "function showSubmitWarning(m) { window.__stub.warn = m; }",
      "window.closePanel = () => { window.__stub.closed++; };",
      "window.__posted = [];",
      "window.__reply = { ok: true, body: { durable: true } };",
      "window.__decisions = {};",
      "window.fetch = async (url, opts) => {",
      "  if (!opts || opts.method !== 'POST') {",
      "    return { ok: true, json: async () => window.__decisions };",
      "  }",
      "  window.__posted.push({ url, body: JSON.parse(opts.body) });",
      "  if (window.__reply.throws) throw new Error('offline');",
      "  return { ok: window.__reply.ok, json: async () => window.__reply.body };",
      "};",
      "if (!window.CSS || !window.CSS.escape) window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&') };",
      CLOSEOUT_JS,
      "window.__submitted = () => ({ at: _submittedAt, action: _submittedAction, counter: _submittedReloadCounter });",
    ].join("\n")
  );

  const $ = (sel) => document.querySelector(sel);
  const api = {
    window,
    document,
    posted: window.__posted,
    sheet: () => $("#closeout-sheet"),
    render: () => window.refreshCloseout({ reset: true }),
    group: (kind) => $(`[data-closeout-group="${kind}"]`),
    decideRows: () => Array.from(document.querySelectorAll("#closeout-decide-list [data-route-open]")),
    pill: (key) => $(`#closeout-decide-list [data-route-open="${key}"] [data-route-pill]`),
    todoRows: (kind) => Array.from(document.querySelectorAll(`#closeout-${kind}-list .closeout-todo`)),
    routeSheet: () => $("#closeout-route-sheet"),
    /** Tap a 🧭 row, then a tile — the way a user re-routes a Fund. */
    route: (key, value) => {
      const row = $(`#closeout-decide-list [data-route-open="${key}"]`);
      expect(row, "row " + key).toBeTruthy();
      row.click();
      const tile = $(`#closeout-route-sheet [data-route-tile="${value}"]`);
      expect(tile, "tile " + value).toBeTruthy();
      tile.click();
    },
    /** Pick one of Muss nicht / Mit Anleitung / Mach ich selbst. */
    mode: (kind, id, value) => {
      const input = $(`#closeout-${kind}-list input[data-todo-mode="${kind}:${id}"][value="${value}"]`);
      expect(input, `${kind}:${id} → ${value}`).toBeTruthy();
      input.checked = true;
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    ship: () => $("#closeout-ship"),
    noship: () => $("#closeout-noship"),
    close: () => $("#closeout-close"),
    lastPayload: () => window.__posted[window.__posted.length - 1]?.body,
  };
  if (document.readyState === "loading") {
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
  } else {
    window.wireCloseout();
  }
  return api;
}

async function pageWithBridge(decisions, opts) {
  const p = page(opts);
  p.window.__decisions = decisions;
  await p.window.restoreInFlightCloseout();
  return p;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const FUNDE = [
  { id: "oq-saml", title: "[BUG] SAML login fails", type: "bug", body: "repro steps", route: "issue", reason: "riskant" },
  { id: "oq-typo", title: "[CHORE] Fix the login hint", route: "now", reason: "kosmetisch" },
  { id: "oq-alt", title: "[CHORE] Alternative sort order", route: "ignore", reason: "nur anders" },
];

describe("🧭 Du entscheidest — pre-selected routes", () => {
  test("the authored data-route-default decides the bucket: now → implement, issue → issues, ignore → neither", () => {
    const p = page({ funde: FUNDE });
    expect(p.decideRows()).toHaveLength(3);
    expect(p.window.collectImplementItems().map((i) => i.id)).toEqual(["oq-typo"]);
    expect(p.window.collectIssueItems().map((i) => i.id)).toEqual(["oq-saml"]);
    expect(p.window.collectIssueItems()[0]).toMatchObject({
      id: "oq-saml",
      title: "[BUG] SAML login fails",
      type: "bug",
      description: "repro steps",
      selected: true,
    });
    // The pill shows the pre-selection, the chip its one-word reason.
    expect(p.pill("oq-typo").dataset.route).toBe("implement");
    expect(p.pill("oq-saml").dataset.route).toBe("issue");
    expect(p.pill("oq-alt").dataset.route).toBe("ignore");
    expect(p.decideRows()[1].querySelector(".closeout-why").textContent).toBe("kosmetisch");
  });

  test("a Fund without data-route-default falls back to 📌 Issue — nothing gets built unseen", () => {
    const p = page({ funde: [{ id: "oq-x", title: "[BUG] X" }] });
    expect(p.window.collectIssueItems().map((i) => i.id)).toEqual(["oq-x"]);
    expect(p.window.collectImplementItems()).toEqual([]);
  });

  test("a tile in the bottom sheet re-routes one Fund, and only it", () => {
    const p = page({ funde: FUNDE });
    p.route("oq-saml", "implement");
    expect(p.window.collectImplementItems().map((i) => i.id)).toEqual(["oq-saml", "oq-typo"]);
    expect(p.window.collectIssueItems()).toEqual([]);
    expect(p.pill("oq-saml").dataset.route).toBe("implement");
    // The sheet closed again and focus is back on the row.
    expect(p.routeSheet().hidden).toBe(true);
    expect(p.document.activeElement.dataset.routeOpen).toBe("oq-saml");
  });

  test("the buckets never overlap, whatever the user taps", () => {
    const p = page({ funde: FUNDE });
    for (const [a, b] of [["issue", "implement"], ["implement", "ignore"], ["ignore", "issue"]]) {
      p.route("oq-saml", a);
      p.route("oq-typo", b);
      const iss = p.window.collectIssueItems().map((i) => i.id);
      const imp = p.window.collectImplementItems().map((i) => i.id);
      expect(iss.filter((id) => imp.includes(id)), a + "/" + b).toEqual([]);
    }
  });

  test("the bottom sheet shows name, origin, description, recommendation + reason, and the current tile", () => {
    const p = page({ funde: FUNDE });
    p.decideRows()[0].click();
    const box = p.routeSheet();
    expect(box.hidden).toBe(false);
    expect(box.querySelector("[data-route-title]").textContent).toBe("SAML login fails");
    expect(box.querySelector("[data-route-origin]").textContent).toBe("final.origin_found");
    expect(box.querySelector("[data-route-body]").textContent).toBe("repro steps");
    const why = box.querySelector("[data-route-why]").textContent;
    expect(why).toContain("final.route_recommended");
    expect(why).toContain("📌 final.route_issue");
    expect(why).toContain("riskant");
    expect(box.querySelector('[data-route-tile="issue"]').getAttribute("aria-checked")).toBe("true");
    expect(p.document.activeElement.dataset.routeTile).toBe("issue");
    // Escape closes it unchanged.
    box.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(box.hidden).toBe(true);
    expect(p.window.collectIssueItems().map((i) => i.id)).toEqual(["oq-saml"]);
  });

  test("a routed Fund (data-routed) leaves the inbox; with all routed the group disappears", () => {
    const p = page({ funde: [{ ...FUNDE[0], routed: true }, FUNDE[1]] });
    expect(p.decideRows().map((r) => r.dataset.routeOpen)).toEqual(["oq-typo"]);
    p.document.querySelector('[data-oq-id="oq-typo"]').setAttribute("data-routed", "");
    p.render();
    expect(p.group("decide").hidden).toBe(true);
  });

  test("route choices live in memory only: nothing persisted, a tab switch keeps them, a reload does not", () => {
    const p = page({ funde: FUNDE });
    p.route("oq-saml", "implement");
    expect(p.window.localStorage.length).toBe(0);
    expect(p.window.sessionStorage.length).toBe(0);
    p.render(); // tab switch → refreshCloseout({ reset: true })
    expect(p.pill("oq-saml").dataset.route).toBe("implement");
    const fresh = page({ funde: FUNDE });
    expect(fresh.pill("oq-saml").dataset.route).toBe("issue");
  });

  test("a legacy report's enabled checkbox still counts; unchecked means drop", () => {
    const p = page({});
    const block = p.document.createElement("section");
    block.setAttribute("data-open-questions", "");
    block.innerHTML =
      '<label><input type="checkbox" name="oq-a" data-issue-title="[BUG] A" checked><span class="oq-label">A</span></label>' +
      '<label><input type="checkbox" name="oq-b" data-issue-title="[BUG] B"><span class="oq-label">B</span></label>' +
      '<label><input type="checkbox" name="oq-c" data-issue-title="[BUG] C" checked disabled><span class="oq-label">C</span></label>';
    p.document.querySelector("section[data-final-report]").appendChild(block);
    p.render();
    expect(p.decideRows().map((r) => r.dataset.routeOpen)).toEqual(["oq-a", "oq-b"]);
    expect(p.window.collectIssueItems().map((i) => i.id)).toEqual(["oq-a"]);
  });
});

describe("🧭 at most three rows — the rest is one Sammel-Issue", () => {
  const FIVE = [1, 2, 3, 4, 5].map((n) => ({ id: "oq-" + n, title: "[CHORE] Fund " + n, route: "now", reason: "klein" }));

  test("three Funde stay three rows, no Sammel row", () => {
    const p = page({ funde: FIVE.slice(0, 3) });
    expect(p.decideRows()).toHaveLength(3);
    expect(p.document.querySelector(".closeout-sammel")).toBeNull();
  });

  test("five Funde: two rows + one Sammel row; the payload files ONE issue for the other three", () => {
    const p = page({ funde: FIVE });
    const rows = p.decideRows();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.dataset.routeOpen)).toEqual(["oq-1", "oq-2", "__sammel"]);
    expect(rows[2].textContent).toContain("final.sammel_row");
    expect(p.window.collectImplementItems().map((i) => i.id)).toEqual(["oq-1", "oq-2"]);
    const issues = p.window.collectIssueItems();
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("__sammel");
    expect(issues[0].collected.map((i) => i.id)).toEqual(["oq-3", "oq-4", "oq-5"]);
    expect(issues[0].description).toContain("[CHORE] Fund 4");
  });

  test("the Sammel row offers Issue or Ignorieren — never a bundled build", () => {
    const p = page({ funde: FIVE });
    p.decideRows()[2].click();
    expect(p.routeSheet().querySelector('[data-route-tile="implement"]').hidden).toBe(true);
    p.routeSheet().querySelector('[data-route-tile="ignore"]').click();
    expect(p.window.collectIssueItems()).toEqual([]);
    expect(p.pill("__sammel").dataset.route).toBe("ignore");
  });
});

describe("🧪 / 👉 — criticality, then guidability", () => {
  const TESTS = [
    { id: "t-low", text: "Read the English copy", crit: "low", guide: "web" },
    { id: "t-web", text: "Try the login on a phone", crit: "mid", guide: "web" },
    { id: "t-game", text: "Watch the camera pan", crit: "mid", guide: "" },
  ];
  const HANDOFFS = [{ id: "h-secret", text: "Store the token secret", crit: "high", guide: "desktop" }];

  test("defaults: low → Muss nicht; guidable → Mit Anleitung (its kind); not guidable → Mach ich selbst", () => {
    const p = page({ tests: TESTS, handoffs: HANDOFFS });
    expect(p.window.collectTodos("tests")).toEqual([
      { id: "t-low", text: "Read the English copy", mode: "skip", guide: null },
      { id: "t-web", text: "Try the login on a phone", mode: "guide", guide: "web" },
      { id: "t-game", text: "Watch the camera pan", mode: "self", guide: null },
    ]);
    expect(p.window.collectTodos("handoffs")).toEqual([
      { id: "h-secret", text: "Store the token secret", mode: "guide", guide: "desktop" },
    ]);
    // The radios show it, and the guidance kind is named under the row.
    const web = p.todoRows("tests")[1];
    expect(web.querySelector('input[value="guide"]').checked).toBe(true);
    expect(web.querySelector("[data-guide-kind]").textContent).toBe("final.guide_web");
    expect(p.todoRows("tests")[2].querySelector("[data-guide-kind]").hidden).toBe(true);
  });

  test("Mit Anleitung on something Claude cannot walk through becomes written steps — never 'nicht führbar'", () => {
    const p = page({ tests: TESTS });
    p.mode("tests", "t-game", "guide");
    expect(p.window.collectTodos("tests")[2]).toMatchObject({ mode: "guide", guide: "inline" });
    expect(p.todoRows("tests")[2].querySelector("[data-guide-kind]").textContent).toBe("final.guide_inline");
    expect(p.sheet().textContent).not.toMatch(/nicht führbar|not guidable/i);
    expect(md).not.toMatch(/final\.[a-z_]+`\s*\|[^|\n]*\|[^|\n]*nicht führbar/);
  });

  test("the radios never persist and choosing one keeps focus on its row (no rebuild)", () => {
    const p = page({ tests: TESTS });
    const input = p.document.querySelector('input[data-todo-mode="tests:t-web"][value="self"]');
    expect(input.hasAttribute("data-no-persist")).toBe(true);
    const row = p.todoRows("tests")[1];
    p.mode("tests", "t-web", "self");
    expect(p.todoRows("tests")[1]).toBe(row);
    expect(p.window.collectTodos("tests")[1]).toMatchObject({ mode: "self", guide: null });
  });

  test("more than three: three rows, '+N weitere', and every item still in the payload", () => {
    const many = [1, 2, 3, 4, 5].map((n) => ({ id: "t" + n, text: "Check " + n, crit: "mid", guide: "" }));
    const p = page({ tests: many });
    expect(p.todoRows("tests")).toHaveLength(3);
    expect(p.document.querySelector("#closeout-tests-list .closeout-more").textContent).toBe("final.todo_more".replace("{n}", "2"));
    expect(p.window.collectTodos("tests")).toHaveLength(5);
  });

  test("criticality chip from data-crit; an empty group is not shown", () => {
    const p = page({ tests: TESTS });
    expect(p.todoRows("tests")[2].querySelector(".closeout-crit").dataset.crit).toBe("mid");
    expect(p.group("tests").hidden).toBe(false);
    expect(p.group("handoffs").hidden).toBe(true);
    expect(p.group("decide").hidden).toBe(true);
  });

  test("an inbox with nothing in it says so", () => {
    const p = page({});
    expect(p.document.getElementById("closeout-empty").hidden).toBe(false);
  });
});

describe("the two buttons are the ship answer", () => {
  test("🏁🚀 Abschließen & shippen submits finalize with ship.run true and the full payload", async () => {
    const p = page({ funde: FUNDE, tests: [{ id: "t1", text: "Look", crit: "mid", guide: "web" }], handoffs: [{ id: "h1", text: "Do", crit: "high" }] });
    p.ship().click();
    await tick();
    expect(p.posted).toHaveLength(1);
    const body = p.lastPayload();
    expect(body).toMatchObject({
      submitted: true,
      action: "finalize",
      iteration: "2",
      ship: { run: true },
      issues: { create: true },
      implement: { run: true },
      disposition: { mode: "discard", moveTo: null },
    });
    expect(body.submission_id).toMatch(/^sub-/);
    expect(body.tests).toEqual([{ id: "t1", text: "Look", mode: "guide", guide: "web" }]);
    expect(body.handoffs).toEqual([{ id: "h1", text: "Do", mode: "self", guide: null }]);
  });

  test("🏁 Nur abschließen, nicht shippen submits the same finalize with ship.run false", async () => {
    const p = page({ funde: FUNDE });
    p.noship().click();
    await tick();
    expect(p.lastPayload().action).toBe("finalize");
    expect(p.lastPayload().ship).toEqual({ run: false });
  });

  test("ready look: the ship button carries 🏁🚀 and no ⚠; no 'Weiter', no progress, no ship row", () => {
    const p = page({ funde: FUNDE });
    expect(p.ship().textContent).toContain("🏁🚀");
    expect(p.ship().textContent).toContain("final.closeout_ship_go");
    expect(p.ship().textContent).not.toContain("⚠");
    expect(p.noship().textContent).toContain("final.closeout_noship_go");
    expect(p.document.getElementById("closeout-execute")).toBeNull();
    expect(p.document.getElementById("closeout-progress")).toBeNull();
    expect(p.document.querySelector('input[name="closeout-ship"]')).toBeNull();
  });

  test("after the click the clicked button is the status and the other steps aside; a second click sends nothing", async () => {
    const p = page({ funde: FUNDE });
    p.noship().click();
    await tick();
    expect(p.sheet().dataset.frozen).toBe("true");
    expect(p.noship().dataset.finalizeState).toBe("running");
    expect(p.noship().textContent).toContain("final.closeout_running");
    expect(p.ship().hidden).toBe(true);
    p.noship().click();
    p.ship().click();
    await tick();
    expect(p.posted).toHaveLength(1);
    expect(p.window.__submitted().action).toBe("finalize");
  });

  test("a non-durable answer hands the sheet back; a transport failure queues and stays running", async () => {
    const p = page({ funde: FUNDE });
    p.window.__reply = { ok: true, body: { durable: false } };
    p.ship().click();
    await tick();
    expect(p.sheet().dataset.frozen).toBe("false");
    expect(p.ship().hidden).toBe(false);
    expect(p.noship().hidden).toBe(false);
    expect(p.ship().disabled).toBe(false);
    expect(p.window.__stub.pending.k).toBe("concept-test-pending");

    const q = page({ funde: FUNDE });
    q.window.__reply = { throws: true };
    q.ship().click();
    await tick();
    expect(q.ship().dataset.finalizeState).toBe("running");
    expect(JSON.parse(q.window.__stub.pending.v).ship.run).toBe(true);
  });

  test("offline, both buttons say the click will be queued", () => {
    const p = page({ funde: FUNDE });
    p.document.getElementById("connection-status").dataset.state = "disconnected";
    p.window.updateCloseoutButton();
    expect(p.ship().textContent).toContain("final.closeout_go_offline");
    expect(p.noship().textContent).toContain("final.closeout_go_offline");
  });
});

describe("🤖 Claude macht beim Klick", () => {
  test("the plan line counts what the click will do and follows every re-route", () => {
    const p = page({ funde: FUNDE });
    const plan = p.document.getElementById("closeout-plan");
    expect(plan.textContent).toBe("⚡ final.plan_implement · 📌 final.plan_issue");
    p.route("oq-typo", "ignore");
    expect(plan.textContent).toBe("📌 final.plan_issue");
    p.route("oq-saml", "ignore");
    expect(plan.hidden).toBe(true);
  });

  test("disposition is one line with its default, 'ändern' opens it inline, and the line follows the choice", async () => {
    const p = page({});
    const line = p.document.querySelector("[data-dispose-summary]");
    const edit = p.document.getElementById("closeout-dispose-edit");
    const set = p.document.getElementById("panel-dispose-concept");
    expect(line.textContent).toBe("final.dispose_line_discard");
    expect(set.hidden).toBe(true);
    edit.click();
    expect(set.hidden).toBe(false);
    expect(edit.getAttribute("aria-expanded")).toBe("true");
    const keep = set.querySelector('input[value="keep"]');
    keep.checked = true;
    keep.dispatchEvent(new p.window.Event("change", { bubbles: true }));
    const move = p.document.getElementById("dispose-move-to");
    move.value = "docs/decisions/";
    move.dispatchEvent(new p.window.Event("input", { bubbles: true }));
    expect(line.textContent).toBe("final.dispose_line_keep → docs/decisions/");
    p.noship().click();
    await tick();
    expect(p.lastPayload().disposition).toEqual({ mode: "keep", moveTo: "docs/decisions/" });
  });
});

describe("a finalize that outlives its tab, and the done state", () => {
  test("a reload during a running finalize comes back frozen on the button that was clicked", async () => {
    const p = await pageWithBridge({ submitted: true, action: "finalize", iteration: "2", ship: { run: true } }, { funde: FUNDE });
    expect(p.sheet().dataset.frozen).toBe("true");
    expect(p.ship().dataset.finalizeState).toBe("running");
    expect(p.noship().hidden).toBe(true);
    expect(p.window.__stub.dim).toBe(true);
    expect(p.window.__submitted().action).toBe("finalize");
  });

  test("a payload naming another round, or an iterate, is left alone", async () => {
    const a = await pageWithBridge({ submitted: true, action: "finalize", iteration: "1" }, { funde: FUNDE });
    expect(a.sheet().dataset.frozen).not.toBe("true");
    const b = await pageWithBridge({ submitted: true, action: "iterate" }, { funde: FUNDE });
    expect(b.sheet().dataset.frozen).not.toBe("true");
  });

  test("a stalled finalize stays frozen and says so — it never re-arms", () => {
    const p = page({ funde: FUNDE });
    p.window.submitFinalize(false);
    p.window.markCloseoutStalled();
    expect(p.noship().dataset.finalizeState).toBe("stalled");
    expect(p.noship().textContent).toContain("final.closeout_stalled_short");
    expect(p.document.querySelector('.hint[data-finalize-state="stalled"]').hidden).toBe(false);
    expect(p.sheet().dataset.frozen).toBe("true");
  });

  test("a 'closed' phase from the bridge ends the finalize in its done state (#932)", () => {
    const p = page({ funde: FUNDE });
    p.window.submitFinalize(true);
    expect(p.window.__submitted().action).toBe("finalize");
    p.window.noteCloseoutPhase({ _phase: "implemented" });
    expect(p.sheet().dataset.finalizeState).toBe("running");
    p.window.noteCloseoutPhase({ _phase: "closed" });
    expect(p.sheet().dataset.finalizeState).toBe("done");
    expect(p.document.getElementById("closeout-close").hidden).toBe(false);
    expect(p.document.body.classList.contains("concept-closed")).toBe(true);
    expect(p.document.body.classList.contains("concept-submitted")).toBe(false);
    // The safety net can no longer mark it stalled.
    expect(p.window.__submitted().at).toBe(0);
  });

  test("data-closed: only 🧪/👉 with the chosen mode, and one '✓ Concept abgeschlossen · schließen'", () => {
    const p = page({
      closed: true,
      funde: FUNDE,
      tests: [{ id: "t1", text: "Look", crit: "mid", guide: "web", mode: "self" }, { id: "t2", text: "Read", crit: "low", mode: "skip" }],
      handoffs: [{ id: "h1", text: "Do", crit: "high", guide: "desktop", mode: "guide" }],
    });
    expect(p.group("decide").hidden).toBe(true);
    expect(p.sheet().querySelector(".closeout-claude").hidden).toBe(true);
    expect(p.ship().hidden).toBe(true);
    expect(p.noship().hidden).toBe(true);
    expect(p.close().hidden).toBe(false);
    expect(p.close().textContent).toContain("final.closeout_done_close");
    const rows = p.todoRows("tests");
    expect(rows.map((r) => r.dataset.mode)).toEqual(["self", "skip"]);
    expect(p.sheet().querySelectorAll("#closeout-tests-list input").length).toBe(0);
    expect(p.todoRows("handoffs")[0].textContent).toContain("🖥 final.mode_guide");
    // No line about the completion card.
    expect(p.sheet().textContent).not.toMatch(/Completion Card/i);
    p.close().click();
    expect(p.window.__stub.closed).toBe(1);
  });
});
