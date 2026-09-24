import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// The final report's "Offene Punkte" list drifted into a closing ritual: every
// report ended with a handful of follow-ups, and too many of them were either
// the obvious next step of the scope the user had just approved ("phase 4"
// after they clicked implement on phases 1-4) or a generic nudge nobody asked
// for. Each row asks the user for a decision they did not ask to make.
//
// The fix is an admission gate with exactly two origins — a point the user
// parked during the concept, or something found on the way that has nothing
// to do with the scope — declared per item as `data-oq-origin`, rendered as a
// tag on the sheet row, and enforced by the validation gate. The default is
// no section at all. These invariants live in prose and in reference code
// Claude copies verbatim, so a test is the only thing that keeps them true.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");
const reality = fs.readFileSync(path.join(DK, "reality-check.md"), "utf8");

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
const htmlSource = BLOCKS.filter((b) => b.info === "html").map((b) => b.code).join("\n");
const cssSource = BLOCKS.filter((b) => b.info === "css").map((b) => b.code).join("\n");
const SKELETON = BLOCKS.find((b) => b.info === "html" && b.code.includes('id="panel-final-report"'));

const CLOSEOUT_JS = (() => {
  const start = md.indexOf('// --- Final-report close-out sheet (action: "finalize") ---');
  const end = md.indexOf("// --- Offline Submit Queue ---", start);
  expect(start, "close-out block").toBeGreaterThan(-1);
  expect(end, "offline queue marker").toBeGreaterThan(start);
  return md.slice(start, end);
})();

const localeKeys = (src) => src.replace(/\{\{([a-z_.]+)\}\}/g, "$1");

describe("open points — the admission gate in prose", () => {
  test("SKILL.md names the gate, its two origins, and the no-section default", () => {
    expect(skill).toContain("Open points section — admission gate (default: no section)");
    expect(skill).toContain('`data-oq-origin`');
    expect(skill).toMatch(/\| Deferred by the user \| `deferred` \|/);
    expect(skill).toMatch(/\| Found on the way \| `found` \|/);
    expect(skill).toContain("omit the section entirely");
  });

  test("approved scope can never become an open point — it is built or reported as a shortfall", () => {
    expect(skill).toContain("**Never an open point**");
    expect(skill).toContain("**Anything in the approved scope.**");
    expect(skill).toContain("**The approved scope is built in full.**");
    expect(skill).toContain("nicht umgesetzt, weil");
    // The self-check that catches the "of course phase 4 is next" row.
    expect(skill).toContain("would the user be surprised to see this");
  });

  test("the report structure no longer invites recommendations", () => {
    expect(skill).not.toContain("recommendations for follow-up work");
    expect(skill).not.toContain("future improvements");
    expect(skill).not.toContain("**Nächste Schritte**");
    // What replaced it is a hand-off list for steps only the user can take.
    expect(skill).toContain("**Danach von Hand**");
    expect(skill).toContain("Never a place for recommendations");
    expect(reality).not.toContain("Nächste Schritte");
  });

  test("a question found during implementation is not auto-routed to an issue any more", () => {
    expect(reality).not.toContain("routed to a follow-up issue via the close-out sheet");
    expect(reality).toContain("only if it passes the\nadmission gate");
  });

  test("the validation gate enforces the origin on every open point of a final report", () => {
    const row = gate.split("\n").find((l) => l.startsWith("| 33b | "));
    expect(row, "gate row 33b").toBeTruthy();
    expect(row).toContain('`data-oq-origin="deferred"` or `data-oq-origin="found"`');
    expect(row).toContain("Hard fail on the final-report section");
    expect(row).toContain("no `[data-open-questions]` block passes");
    expect(gate).toContain("`data-oq-origin` missing on an open point");
  });
});

describe("open points — the origin in the reference markup", () => {
  test("every example open point declares an admissible origin", () => {
    const inputs = htmlSource.match(/<input[^>]*data-issue-title=[^>]*>/g) || [];
    expect(inputs.length, "example open points").toBeGreaterThanOrEqual(4);
    for (const el of inputs) {
      expect(el, el).toMatch(/data-oq-origin="(deferred|found)"/);
    }
    // Both origins are shown, so the author sees what each one looks like.
    expect(htmlSource).toContain('data-oq-origin="found"');
    expect(htmlSource).toContain('data-oq-origin="deferred"');
  });

  test("the attribute table lists data-oq-origin as mandatory", () => {
    expect(md).toContain("The first four attributes are MANDATORY");
    expect(md).toMatch(/\| `data-oq-origin` \| yes \|/);
  });

  test("the sheet carries both origin labels through the locale, never hard-coded", () => {
    expect(md).toMatch(/\| `final\.origin_deferred`\s+\| deferred by you\s+\| bewusst vertagt \|/);
    expect(md).toMatch(/\| `final\.origin_found`\s+\| found on the way\s+\| unterwegs gefunden \|/);
    expect(SKELETON.code).toContain('data-label-origin-deferred="{{final.origin_deferred}}"');
    expect(SKELETON.code).toContain('data-label-origin-found="{{final.origin_found}}"');
    expect(cssSource).toContain(".closeout-sheet .followup-origin {");
  });
});

/**
 * A page whose live round is a final report with the given open points,
 * running the reference close-out JS on jsdom.
 */
function page(items, { handoffs = [], closed = false } = {}) {
  const dom = new JSDOM(localeKeys(SKELETON.code), { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const sec = document.createElement("section");
  sec.dataset.iteration = "2";
  sec.dataset.iterationTemplate = "free";
  sec.setAttribute("data-final-report", "");
  sec.setAttribute("data-active", "");
  if (closed) sec.setAttribute("data-closed", "");
  if (handoffs.length) {
    const ho = document.createElement("section");
    ho.id = "handoffs";
    ho.dataset.navLabel = "final.handoffs";
    ho.setAttribute("data-handoffs", "");
    const ol = document.createElement("ol");
    for (const text of handoffs) {
      const li = document.createElement("li");
      li.innerHTML = text;
      ol.appendChild(li);
    }
    ho.appendChild(ol);
    sec.appendChild(ho);
  }
  const block = document.createElement("section");
  block.setAttribute("data-open-questions", "");
  const ul = document.createElement("ul");
  for (const it of items) {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.name = it.id;
    box.checked = true;
    box.dataset.issueTitle = it.title;
    box.dataset.issueType = "chore";
    if (it.origin !== undefined) box.dataset.oqOrigin = it.origin;
    const span = document.createElement("span");
    span.className = "oq-label";
    span.textContent = it.title;
    label.appendChild(box);
    label.appendChild(span);
    li.appendChild(label);
    ul.appendChild(li);
  }
  block.appendChild(ul);
  sec.appendChild(block);
  document.querySelector("main").appendChild(sec);
  window.eval(
    [
      "window.STORAGE_KEY = 'concept-test';",
      "var _submittedAt = 0, _submittedReloadCounter = null, _submittedAction = null;",
      "var _bootReloadCounter = 7;",
      "function _guardedSetItem() {}",
      "function showContentDimmer() {}",
      "function hideContentDimmer() {}",
      "function showSubmitWarning() {}",
      "window.fetch = async () => ({ ok: true, json: async () => ({}) });",
      "if (!window.Element.prototype.scrollIntoView) window.Element.prototype.scrollIntoView = function () {};",
      "if (!window.CSS || !window.CSS.escape) window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&') };",
      CLOSEOUT_JS,
    ].join("\n")
  );
  if (document.readyState === "loading") document.dispatchEvent(new window.Event("DOMContentLoaded"));
  else window.wireCloseout();
  window.refreshCloseout({ reset: true });
  return document;
}

describe("open points — the origin tag on the sheet row", () => {
  test("a deferred point and a found point each get their own tag, from the locale", () => {
    const doc = page([
      { id: "oq-a", title: "[FEATURE] Rate-limit", origin: "deferred" },
      { id: "oq-b", title: "[BUG] SAML", origin: "found" },
    ]);
    const tags = Array.from(doc.querySelectorAll("#closeout-followup-list .followup .followup-origin"));
    expect(tags.map((t) => t.dataset.origin)).toEqual(["deferred", "found"]);
    expect(tags.map((t) => t.textContent)).toEqual(["final.origin_deferred", "final.origin_found"]);
    // Context, not a choice: the three routes are untouched.
    for (const row of doc.querySelectorAll("#closeout-followup-list .followup")) {
      expect(row.querySelectorAll(".followup-routes input[type=radio]").length).toBe(3);
    }
  });

  test("a row without an admissible origin renders no tag rather than a made-up one", () => {
    const doc = page([
      { id: "oq-x", title: "[CHORE] Phase 4" },
      { id: "oq-y", title: "[CHORE] Something", origin: "scope" },
    ]);
    expect(doc.querySelectorAll("#closeout-followup-list .followup").length).toBe(2);
    expect(doc.querySelectorAll("#closeout-followup-list .followup-origin").length).toBe(0);
  });

  test("the tag sits between the title and the routes", () => {
    const doc = page([{ id: "oq-a", title: "[BUG] SAML", origin: "found" }]);
    const row = doc.querySelector("#closeout-followup-list .followup");
    const classes = Array.from(row.children).map((c) => c.className);
    expect(classes).toEqual(["followup-title", "followup-origin", "followup-routes"]);
  });
});

// The steps the user has to take by hand after the merge used to be one more
// paragraph in the report body — visually gone the moment the reader scrolled,
// and absent from the panel where the close-out happens. They are now a
// painted section, a marked TOC entry, and a sheet block that outlives the
// close-out.
describe("hand-offs — what the user still has to do by hand", () => {
  const STEPS = ["Set the cron to <code>0,20,40 * * * *</code>", "Watch the first run"];

  test("the sheet mirrors the report's hand-off list, with a count", () => {
    const doc = page([], { handoffs: STEPS });
    const block = doc.querySelector('[data-closeout-block="handoffs"]');
    expect(block.hidden).toBe(false);
    const items = Array.from(doc.querySelectorAll("#closeout-handoffs-list li")).map((li) => li.textContent);
    expect(items).toEqual(["Set the cron to 0,20,40 * * * *", "Watch the first run"]);
    expect(doc.getElementById("closeout-handoffs-count").textContent).toBe("(2)");
  });

  test("no hand-offs, no block — the normal case renders nothing", () => {
    const doc = page([{ id: "oq-a", title: "[BUG] SAML", origin: "found" }]);
    expect(doc.querySelector('[data-closeout-block="handoffs"]').hidden).toBe(true);
    expect(doc.querySelectorAll("#closeout-handoffs-list li").length).toBe(0);
  });

  test("after the close-out the hand-offs are the only block left on the sheet", () => {
    const doc = page([{ id: "oq-a", title: "[BUG] SAML", origin: "found" }], { handoffs: STEPS, closed: true });
    const visible = Array.from(doc.querySelectorAll(".closeout-block"))
      .filter((el) => !el.hidden)
      .map((el) => el.dataset.closeoutBlock);
    expect(visible).toEqual(["handoffs"]);
    const btn = doc.getElementById("closeout-execute");
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(true);
    expect(btn.dataset.finalizeState).toBe("done");
    expect(doc.querySelectorAll("#closeout-handoffs-list li").length).toBe(2);
  });

  test("a closed report without hand-offs shows the done state and nothing else", () => {
    const doc = page([], { closed: true });
    const visible = Array.from(doc.querySelectorAll(".closeout-block")).filter((el) => !el.hidden);
    expect(visible).toEqual([]);
  });

  test("the TOC marks the hand-offs entry and the body paints the section", () => {
    const nav = md.slice(md.indexOf("function buildSectionNav()"), md.indexOf("function buildSectionNav()") + 4000);
    expect(nav).toContain("if (sec.hasAttribute('data-handoffs')) link.setAttribute('data-handoffs', '');");
    expect(cssSource).toContain(".section-nav-item[data-handoffs] .section-nav-label {");
    expect(cssSource).toContain("section[data-handoffs] {");
    expect(cssSource).toContain(".closeout-sheet .closeout-handoffs {");
  });

  test("the reference report shows the section with its locale label, in the TOC", () => {
    expect(htmlSource).toContain('<section id="handoffs" data-nav-label="{{final.handoffs}}" data-handoffs>');
    expect(md).toMatch(/\| `final\.handoffs`\s+\| By hand, afterwards\s+\| Danach von Hand \|/);
    expect(SKELETON.code).toContain('data-closeout-block="handoffs"');
    expect(SKELETON.code).toContain('id="closeout-handoffs-list"');
  });

  test("SKILL.md and the gate carry the rule", () => {
    expect(skill).toContain("`renderHandoffs`");
    expect(skill).toContain("is the only block that stays visible");
    const row = gate.split("\n").find((l) => l.startsWith("| 37b | "));
    expect(row, "gate row 37b").toBeTruthy();
    expect(row).toContain("`closeout-handoffs-list`");
    expect(row).toContain("A report without the section passes");
  });
});
