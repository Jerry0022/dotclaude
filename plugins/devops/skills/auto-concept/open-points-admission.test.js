import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSkill } from "./skill-source.js";
import { JSDOM } from "jsdom";
import { readTemplates } from "./templates-source.js";

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
const md = readTemplates();
const skill = readSkill();
const gate = ["validation-gate.md", "validation-gate-phase2.md"].map((f) => fs.readFileSync(path.join(DK, f), "utf8")).join("");
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
    expect(skill).toContain("**🧪 / 👉 data lists**");
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

describe("open points — the origin and pre-selection in the reference markup", () => {
  test("every example Fund declares an admissible origin, a route default and a reason — and is no checkbox", () => {
    const funde = htmlSource.match(/<li[^>]*data-issue-title=[^>]*>/g) || [];
    expect(funde.length, "example Funde").toBeGreaterThanOrEqual(4);
    for (const el of funde) {
      expect(el, el).toMatch(/data-oq-origin="(deferred|found)"/);
      expect(el, el).toMatch(/data-route-default="(now|issue|ignore)"/);
      expect(el, el).toMatch(/data-route-reason="[^"]+"/);
    }
    expect(htmlSource).not.toMatch(/<input[^>]*data-issue-title=/);
    const report = htmlSource.slice(htmlSource.indexOf("data-final-report data-active"));
    expect(report.slice(0, 9000)).not.toContain('type="checkbox"');
  });

  test("the attribute table lists origin, route default and reason as mandatory", () => {
    expect(md).toMatch(/\| `data-oq-origin` \| yes \|/);
    expect(md).toMatch(/\| `data-route-default` \| yes \|/);
    expect(md).toMatch(/\| `data-route-reason` \| yes \|/);
    expect(md).toMatch(/\| `data-routed` \| set by Claude \|/);
  });

  test("the sheet carries both origin labels through the locale, never hard-coded", () => {
    expect(md).toMatch(/\| `final\.origin_deferred`\s+\| deferred by you\s+\| bewusst vertagt \|/);
    expect(md).toMatch(/\| `final\.origin_found`\s+\| found on the way\s+\| unterwegs gefunden \|/);
    expect(SKELETON.code).toContain('data-label-origin-deferred="{{final.origin_deferred}}"');
    expect(SKELETON.code).toContain('data-label-origin-found="{{final.origin_found}}"');
    expect(cssSource).toContain(".closeout-sheet .closeout-route-origin {");
  });
});

/**
 * A page whose live round is a final report with the given Funde and
 * hand-offs, running the reference close-out JS on jsdom.
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
    ho.setAttribute("data-handoffs", "");
    ho.hidden = true;
    const ul = document.createElement("ul");
    handoffs.forEach((text, i) => {
      const li = document.createElement("li");
      li.dataset.todoId = "h" + (i + 1);
      li.dataset.crit = "high";
      li.innerHTML = text;
      ul.appendChild(li);
    });
    ho.appendChild(ul);
    sec.appendChild(ho);
  }
  const block = document.createElement("details");
  block.setAttribute("data-open-questions", "");
  const ul = document.createElement("ul");
  for (const it of items) {
    const li = document.createElement("li");
    li.dataset.oqId = it.id;
    li.dataset.issueTitle = it.title;
    li.dataset.issueType = "chore";
    li.dataset.routeDefault = "issue";
    if (it.origin !== undefined) li.dataset.oqOrigin = it.origin;
    const span = document.createElement("span");
    span.className = "oq-label";
    span.textContent = it.title;
    li.appendChild(span);
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
      "if (!window.CSS || !window.CSS.escape) window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_') };",
      CLOSEOUT_JS,
    ].join("\n")
  );
  if (document.readyState === "loading") document.dispatchEvent(new window.Event("DOMContentLoaded"));
  else window.wireCloseout();
  window.refreshCloseout({ reset: true });
  return document;
}

const originIn = (doc, key) => {
  doc.querySelector(`#closeout-decide-list [data-route-open="${key}"]`).click();
  const el = doc.querySelector("#closeout-route-sheet [data-route-origin]");
  const out = { hidden: el.hidden, text: el.textContent };
  doc.querySelector("#closeout-route-sheet [data-route-close]").click();
  return out;
};

describe("open points — the origin tag in the bottom sheet", () => {
  test("a deferred Fund and a found Fund each get their own tag, from the locale", () => {
    const doc = page([
      { id: "oq-a", title: "[FEATURE] Rate-limit", origin: "deferred" },
      { id: "oq-b", title: "[BUG] SAML", origin: "found" },
    ]);
    expect(originIn(doc, "oq-a")).toEqual({ hidden: false, text: "final.origin_deferred" });
    expect(originIn(doc, "oq-b")).toEqual({ hidden: false, text: "final.origin_found" });
    // Context, not a choice: the three tiles are untouched.
    expect(doc.querySelectorAll("#closeout-route-sheet [data-route-tile]").length).toBe(3);
  });

  test("a Fund without an admissible origin shows no tag rather than a made-up one", () => {
    const doc = page([
      { id: "oq-x", title: "[CHORE] Phase 4" },
      { id: "oq-y", title: "[CHORE] Something", origin: "scope" },
    ]);
    expect(doc.querySelectorAll("#closeout-decide-list [data-route-open]").length).toBe(2);
    expect(originIn(doc, "oq-x").hidden).toBe(true);
    expect(originIn(doc, "oq-y").hidden).toBe(true);
  });
});

// The steps the user has to take by hand after the merge are the 👉 group:
// in the panel where the close-out happens, with a mode each, and still there
// after the close-out.
describe("hand-offs — 👉 Du machst danach", () => {
  const STEPS = ["Set the cron to <code>0,20,40 * * * *</code>", "Watch the first run"];

  test("the 👉 group mirrors the report's hand-off list, with a count", () => {
    const doc = page([], { handoffs: STEPS });
    const group = doc.querySelector('[data-closeout-group="handoffs"]');
    expect(group.hidden).toBe(false);
    const items = Array.from(doc.querySelectorAll("#closeout-handoffs-list .closeout-todo-title")).map((el) => el.textContent);
    expect(items).toEqual(["Set the cron to 0,20,40 * * * *", "Watch the first run"]);
    expect(group.querySelector("[data-closeout-count]").textContent).toBe("2");
  });

  test("no hand-offs, no group — the normal case renders nothing", () => {
    const doc = page([{ id: "oq-a", title: "[BUG] SAML", origin: "found" }]);
    expect(doc.querySelector('[data-closeout-group="handoffs"]').hidden).toBe(true);
  });

  test("after the close-out the 👉 items stay; the 🧭 group and the buttons do not", () => {
    const doc = page([{ id: "oq-a", title: "[BUG] SAML", origin: "found" }], { handoffs: STEPS, closed: true });
    const visible = Array.from(doc.querySelectorAll("[data-closeout-group]"))
      .filter((el) => !el.hidden)
      .map((el) => el.dataset.closeoutGroup);
    expect(visible).toEqual(["handoffs"]);
    expect(doc.getElementById("closeout-ship").hidden).toBe(true);
    expect(doc.getElementById("closeout-close").hidden).toBe(false);
    expect(doc.querySelectorAll("#closeout-handoffs-list .closeout-todo").length).toBe(2);
  });

  test("a closed report without hand-offs shows the done button and no group", () => {
    const doc = page([], { closed: true });
    expect(Array.from(doc.querySelectorAll("[data-closeout-group]")).filter((el) => !el.hidden)).toEqual([]);
    expect(doc.getElementById("closeout-close").hidden).toBe(false);
  });

  test("the reference report carries 🧪/👉 as data lists with criticality and guidability", () => {
    expect(htmlSource).toContain('<section data-handoffs hidden aria-label="{{final.group_handoffs}}">');
    expect(htmlSource).toContain('<section data-tests hidden aria-label="{{final.group_tests}}">');
    expect(htmlSource).toMatch(/<li data-todo-id="[^"]+" data-crit="(low|mid|high)" data-guide="(web|desktop|)">/);
    expect(md).toMatch(/\| `final\.group_handoffs`\s+\| You do afterwards\s+\| Du machst danach \|/);
    expect(SKELETON.code).toContain('id="closeout-handoffs-list"');
    expect(SKELETON.code).toContain('id="closeout-tests-list"');
  });

  test("the gate carries the rule", () => {
    const row = gate.split("\n").find((l) => l.startsWith("| 37b | "));
    expect(row, "gate row 37b").toBeTruthy();
    expect(row).toContain("`closeout-handoffs-list`");
    expect(row).toContain("A report without the section passes");
  });
});
