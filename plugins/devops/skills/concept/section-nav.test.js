import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// The "Kompass" tree: iteration chips and the section TOC are ONE tree at
// runtime. The selected chip's body is #section-nav (moved there by
// buildSectionNav), every other chip carries a generated summary, the chips
// before the live one fold into an archive from 4 previous rounds upward, and
// the TOC groups itself only when ≥2 kinds meet AND the round has >12 entries.
//
// Everything below RUNS the reference JS out of templates.md on jsdom —
// grouping derived from an attribute that does not exist, a spy that closes
// groups, or a hidden entry dragging the scroll box are all single-line
// defects that a grep cannot see.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");
const iterRules = fs.readFileSync(path.join(DK, "iteration-rules.md"), "utf8");
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");

function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null, body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) {
      if (open === null) { open = { info: m[1].trim(), start: i + 2 }; body = []; }
      else { out.push({ info: open.info, line: open.start, code: body.join("\n") }); open = null; }
      continue;
    }
    if (open) body.push(lines[i]);
  }
  return out;
}
const BLOCKS = scanBlocks(md);
const HTML_BLOCKS = BLOCKS.filter((b) => b.info === "html");

function fnSource(name) {
  const m = md.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  if (!m) throw new Error("function " + name + " not found in templates.md");
  return m[0];
}
/** Brace-balanced slice from `marker`. */
function slice(src, marker) {
  const start = src.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced braces after " + marker);
}
const localeKeys = (src) => src.replace(/\{\{([a-z_.]+)\}\}/g, "$1");

// ── Source contracts ──

describe("Kompass tree — source contracts", () => {
  test("#section-nav is inserted after the selected chip, inside buildSectionNav", () => {
    const fn = slice(md, "function buildSectionNav()");
    expect(fn).toContain("buildIterationTree();");
    expect(fn).toContain(".iteration-tab[aria-selected=\"true\"]");
    expect(fn).toContain("insertAdjacentElement('afterend', nav)");
    expect(fn).toContain("installScrollSpy();");
    // One-open and the manual-close stamp are bound INSIDE the builder — the
    // nav DOM is rebuilt on every tab switch.
    expect(fn).toContain("addEventListener('toggle'");
    expect(fn).toContain("_navManualClosedAt.set(group, Date.now())");
  });

  test("kinds derive from the eval-{id} contract + data-nav-group, thresholds are the decided ones", () => {
    const fn = slice(md, "function buildSectionNav()");
    expect(fn).toMatch(/sec\.dataset\.navGroup\s*\|\|\s*\(sec\.querySelector\(`input\[name="eval-\$\{sec\.id\}"\]`\)/);
    expect(md).toMatch(/const NAV_ARCHIVE_FROM = 4;/);
    expect(md).toMatch(/const NAV_GROUP_MIN_KINDS = 2;/);
    expect(md).toMatch(/const NAV_GROUP_OVER_ENTRIES = 12;/);
    expect(md).toMatch(/const NAV_MANUAL_CLOSE_GRACE_MS = 4000;/);
    expect(fn).toContain("kinds.length >= NAV_GROUP_MIN_KINDS && sections.length > NAV_GROUP_OVER_ENTRIES");
  });

  test("the spy opens, never closes; revealNavItem has the zero-rect guard first", () => {
    const open = fnSource("openNavGroupFor");
    expect(open).toContain("group.open = true");
    expect(open).not.toMatch(/\.open = false/);
    expect(open).toContain("NAV_MANUAL_CLOSE_GRACE_MS");
    const reveal = fnSource("revealNavItem");
    const guard = reveal.indexOf("if (item.getClientRects().length === 0) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(reveal.indexOf("nearestScrollBox("));
    expect(fnSource("setActiveNavItem")).toContain("openNavGroupFor(item)");
    expect(fnSource("setActiveNavItem")).toContain("[data-here-section]");
  });

  test("the markup stays a flat chip list — no hand-built tree in any skeleton", () => {
    for (const b of HTML_BLOCKS) {
      const where = `html block at line ${b.line}`;
      expect(b.code, where).not.toContain('class="iteration-tab-summary"');
      expect(b.code, where).not.toContain('class="iteration-archive"');
      expect(b.code, where).not.toContain('class="nav-group"');
    }
    // The orphaned "Entscheidungen" heading between chips and TOC is gone.
    const sidebar = HTML_BLOCKS.find((b) => b.code.includes('id="panel-final-report"'));
    expect(sidebar.code).not.toContain("<h3>{{panel.heading}}</h3>");
  });

  test("locale, gate, rules and SKILL carry the tree", () => {
    for (const key of ["panel.archive_summary", "nav.summary_entries", "nav.summary_discarded", "nav.group_context", "nav.group_variants"]) {
      const row = md.split("\n").find((l) => l.startsWith("| `" + key + "`"));
      expect(row, key).toBeDefined();
      expect(row.split("|").map((s) => s.trim()).filter(Boolean).length, key).toBe(3);
    }
    expect(gate).toMatch(/\| 59 \| `buildIterationTree`/);
    expect(gate).toMatch(/\| 60 \| `NAV_GROUP_OVER_ENTRIES`/);
    expect(gate).toMatch(/\| 61 \| `data-here-section`/);
    expect(gate).toMatch(/\| 40 \| `revealNavItem` — AND `getClientRects\(\)\.length === 0`/);
    expect(iterRules).toContain("## The panel tree");
    expect(iterRules).toMatch(/7\. ☐ The new chip is ONE plain/);
    expect(skill).toContain("`buildSectionNav()` moves `#section-nav` under the");
  });
});

// ── Behavioural: the reference JS on jsdom ──

/**
 * Builds a page from the sidebar skeleton with `rounds` iterations. Each
 * round is { n, entries, discard, kinds, live, selected, flag } — entries
 * become <section id data-nav-label>, `kinds` = number of variant sections
 * among them (with eval-{id} radios), `discard` = how many of those are
 * checked "discard", `navGroup` = an override applied to entry #0.
 */
function page(rounds) {
  const sidebar = HTML_BLOCKS.find((b) => b.code.includes('id="panel-final-report"'));
  const dom = new JSDOM(localeKeys(sidebar.code), { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const main = document.querySelector("main");
  const bar = document.querySelector(".iteration-tabs");
  for (const r of rounds) {
    const sec = document.createElement("section");
    sec.dataset.iteration = String(r.n);
    sec.id = "iter-" + r.n;
    if (r.live) sec.setAttribute("data-active", "");
    else sec.hidden = true;
    if (r.flag) sec.setAttribute(r.flag, "");
    for (let i = 0; i < (r.entries || 0); i++) {
      const s = document.createElement("section");
      s.id = `r${r.n}-s${i}`;
      s.dataset.navLabel = `Round ${r.n} · Section ${i}`;
      if (i === 0 && r.navGroup) s.dataset.navGroup = r.navGroup;
      if (i < (r.kinds || 0)) {
        for (const v of ["include", "discard"]) {
          const inp = document.createElement("input");
          inp.type = "radio"; inp.name = "eval-" + s.id; inp.value = v;
          if (v === "discard" && i < (r.discard || 0)) inp.checked = true;
          if (v === "include" && i >= (r.discard || 0)) inp.checked = true;
          s.appendChild(inp);
        }
      }
      sec.appendChild(s);
    }
    main.appendChild(sec);
    const tab = document.createElement("button");
    tab.className = "iteration-tab";
    tab.setAttribute("role", "tab");
    tab.dataset.iteration = String(r.n);
    tab.setAttribute("aria-selected", r.selected ? "true" : "false");
    if (r.flag) tab.setAttribute(r.flag, "");
    tab.textContent = r.label || `Iteration ${r.n}`;
    bar.appendChild(tab);
  }
  window.eval(localeKeys([
    "let scrollSpyEntries = []; let scrollSpyFrame = 0;",
    md.match(/const NAV_ARCHIVE_FROM = 4;[\s\S]*?const _navManualClosedAt = new WeakMap\(\);/)[0],
    fnSource("iterationTabLabel"),
    fnSource("buildIterationTree"),
    slice(md, "function buildSectionNav()"),
    fnSource("openNavGroupFor"),
    fnSource("updateSectionNavState"),
    fnSource("installScrollSpy"),
    fnSource("setActiveNavItem"),
    fnSource("nearestScrollBox"),
    fnSource("revealNavItem"),
    fnSource("updateScrollSpy"),
    // lexical declarations of an indirect eval are not window properties —
    // hand the manual-close map out for the grace-period test
    "window.__navClosedAt = _navManualClosedAt;",
  ].join("\n")));
  const select = (n) => {
    for (const s of document.querySelectorAll("section[data-iteration]")) s.hidden = s.dataset.iteration !== String(n);
    for (const t of document.querySelectorAll(".iteration-tab")) t.setAttribute("aria-selected", t.dataset.iteration === String(n) ? "true" : "false");
    window.buildSectionNav();
  };
  return { window, document, bar, select };
}

const R = (n, o = {}) => ({ n, entries: 3, ...o });

describe("Kompass tree — behaviour (reference JS on jsdom)", () => {
  test("smallest case: one round, three sections — one open node, no summary, no archive, no groups", () => {
    const p = page([R(1, { live: true, selected: true })]);
    p.window.buildSectionNav();
    const tab = p.bar.querySelector(".iteration-tab");
    expect(tab.nextElementSibling.id).toBe("section-nav");
    expect(p.document.querySelectorAll(".section-nav-item").length).toBe(3);
    expect(p.document.querySelector(".iteration-tab-summary")).toBeNull();
    expect(p.document.querySelector(".iteration-archive")).toBeNull();
    expect(p.document.querySelector(".nav-group")).toBeNull();
    expect(tab.dataset.tabLabel).toBe("Iteration 1");
  });

  test("#section-nav follows the selected chip across switches; other chips get summaries", () => {
    const p = page([R(1, { entries: 14, kinds: 5, discard: 3 }), R(2, { live: true, selected: true })]);
    p.window.buildSectionNav();
    const [t1, t2] = p.bar.querySelectorAll(".iteration-tab");
    expect(t2.nextElementSibling.id).toBe("section-nav");
    expect(t1.querySelector(".iteration-tab-summary").textContent).toBe("14 nav.summary_entries · 3 nav.summary_discarded");
    expect(t2.querySelector(".iteration-tab-summary")).toBeNull();
    // the label is stamped BEFORE the summary is appended
    expect(t1.dataset.tabLabel).toBe("Iteration 1");
    p.select(1);
    expect(t1.nextElementSibling.id).toBe("section-nav");
    expect(t1.querySelector(".iteration-tab-summary")).toBeNull();
    expect(t2.querySelector(".iteration-tab-summary").textContent).toBe("3 nav.summary_entries");
    // the frozen round's TOC shows its own sections
    expect(p.document.querySelectorAll(".section-nav-item").length).toBe(14);
    expect(p.document.querySelectorAll(".section-nav-item[data-variant]").length).toBe(5);
  });

  test("reality-check and final-report chips keep their glyph labels — no summary", () => {
    const p = page([
      R(1), R(2, { flag: "data-reality-check", label: "Reality check" }),
      R(3, { live: true, selected: true, flag: "data-final-report", label: "Final report" }),
    ]);
    p.window.buildSectionNav();
    const tabs = p.bar.querySelectorAll(".iteration-tab");
    expect(tabs[0].querySelector(".iteration-tab-summary")).not.toBeNull();
    expect(tabs[1].querySelector(".iteration-tab-summary")).toBeNull();
    expect(tabs[2].querySelector(".iteration-tab-summary")).toBeNull();
    p.select(2);
    expect(tabs[2].querySelector(".iteration-tab-summary")).toBeNull();
  });

  test("archive: nothing below 4 previous rounds, a fold from 4 — closed on the live tab, open on a frozen one", () => {
    const three = page([R(1), R(2), R(3), R(4, { live: true, selected: true })]);
    three.window.buildSectionNav();
    expect(three.document.querySelector(".iteration-archive")).toBeNull();

    const four = page([R(1), R(2), R(3), R(4), R(5, { live: true, selected: true })]);
    four.window.buildSectionNav();
    const archive = four.bar.querySelector("details.iteration-archive");
    expect(archive).not.toBeNull();
    expect(archive.querySelector("summary").textContent).toBe("4 panel.archive_summary");
    expect([...archive.querySelectorAll(":scope > .iteration-tab")].map((t) => t.dataset.iteration)).toEqual(["1", "2", "3", "4"]);
    expect(archive.open).toBe(false);
    // the live chip stays outside, first thing after the archive
    expect(archive.nextElementSibling.dataset.iteration).toBe("5");
    // the nav sits right after the live chip, outside the archive
    expect(four.document.getElementById("section-nav").previousElementSibling.dataset.iteration).toBe("5");

    four.select(2);
    const archive2 = four.bar.querySelector("details.iteration-archive");
    expect(four.bar.querySelectorAll("details.iteration-archive").length, "rebuilt, not nested").toBe(1);
    expect(archive2.open).toBe(true);
    const nav = four.document.getElementById("section-nav");
    expect(nav.previousElementSibling.dataset.iteration).toBe("2");
    expect(archive2.contains(nav)).toBe(true);

    four.select(5);
    expect(four.bar.querySelector("details.iteration-archive").open).toBe(false);
    expect(four.bar.querySelectorAll(".iteration-tab").length).toBe(5);
  });

  test("the final report is the live chip: everything before it folds, the report itself never does", () => {
    const p = page([R(1), R(2), R(3), R(4), R(5, { live: true, selected: true, flag: "data-final-report", label: "Final report" })]);
    p.window.buildSectionNav();
    const archive = p.bar.querySelector("details.iteration-archive");
    expect(archive.querySelectorAll(":scope > .iteration-tab").length).toBe(4);
    expect(archive.contains(p.bar.querySelector('[data-final-report]'))).toBe(false);
  });

  test("groups only when ≥2 kinds AND >12 entries", () => {
    const flat12 = page([R(1, { live: true, selected: true, entries: 12, kinds: 6 })]);
    flat12.window.buildSectionNav();
    expect(flat12.document.querySelector(".nav-group"), "12 entries, 2 kinds → flat").toBeNull();

    const oneKind = page([R(1, { live: true, selected: true, entries: 20, kinds: 20 })]);
    oneKind.window.buildSectionNav();
    expect(oneKind.document.querySelector(".nav-group"), "20 variants, 1 kind → flat").toBeNull();

    const grouped = page([R(1, { live: true, selected: true, entries: 13, kinds: 5 })]);
    grouped.window.buildSectionNav();
    const groups = [...grouped.document.querySelectorAll("details.nav-group")];
    expect(groups.map((g) => g.dataset.navGroup)).toEqual(["variants", "context"]);
    expect(groups.map((g) => g.querySelector(".nav-group-name").textContent)).toEqual(["nav.group_variants", "nav.group_context"]);
    expect(groups.map((g) => g.querySelector(".nav-group-count").textContent)).toEqual(["5", "8"]);
    expect(grouped.document.querySelectorAll(".nav-group .section-nav-item").length).toBe(13);
    // exactly one open
    expect(groups.filter((g) => g.open).length).toBe(1);
  });

  test("data-nav-group is an override: its value is the group name", () => {
    const p = page([R(1, { live: true, selected: true, entries: 13, kinds: 5, navGroup: "Screens" })]);
    p.window.buildSectionNav();
    const groups = [...p.document.querySelectorAll("details.nav-group")];
    expect(groups.map((g) => g.dataset.navGroup)).toEqual(["Screens", "variants", "context"]);
    expect(groups[0].querySelector(".nav-group-name").textContent).toBe("Screens");
    expect(groups[0].querySelectorAll(".section-nav-item").length).toBe(1);
    // …and an override alone can bring a round to two kinds
    const two = page([R(1, { live: true, selected: true, entries: 13, kinds: 0, navGroup: "Screens" })]);
    two.window.buildSectionNav();
    expect(two.document.querySelectorAll("details.nav-group").length).toBe(2);
  });

  test("one-open among the groups; a manual close is honoured by the spy for 4 s, then a NEW active entry reopens", async () => {
    const p = page([R(1, { live: true, selected: true, entries: 13, kinds: 5 })]);
    p.window.buildSectionNav();
    const [variants, context] = p.document.querySelectorAll("details.nav-group");
    const flush = () => new Promise((r) => setTimeout(r, 0));   // toggle events are queued tasks
    await flush();
    // jsdom's spy picks the LAST entry (every rect is 0 → all above the
    // reading line), which lives in "context".
    expect(context.open).toBe(true);
    expect(variants.open).toBe(false);

    // user opens the other group → accordion closes the first
    variants.open = true;
    await flush();
    expect(variants.open).toBe(true);
    expect(context.open).toBe(false);

    // user closes it deliberately (click on its summary, then the default
    // action) → the spy may not reopen it for 4 s
    variants.querySelector("summary").dispatchEvent(new p.window.MouseEvent("click", { bubbles: true }));
    variants.open = false;
    await flush();
    const item = variants.querySelector(".section-nav-item");
    p.window.openNavGroupFor(item);
    expect(variants.open, "closed on purpose → stays closed").toBe(false);
    // …after the grace period the same call opens it again
    p.window.__navClosedAt.set(variants, Date.now() - 5000);
    p.window.openNavGroupFor(item);
    expect(variants.open).toBe(true);
    await flush();
    expect(context.open, "the accordion closed the other one").toBe(false);
  });

  test("the spy writes the 'you are here' breadcrumb", () => {
    const p = page([R(1, { live: true, selected: true, entries: 4 })]);
    p.window.buildSectionNav();
    const here = p.document.querySelector("[data-here-section]");
    expect(here.hidden).toBe(false);
    expect(here.textContent).toBe("› Round 1 · Section 3");
    p.window.setActiveNavItem(p.document.querySelector(".section-nav-item"));
    expect(here.textContent).toBe("› Round 1 · Section 0");
  });

  test("a hidden entry cannot drag the scroll box: revealNavItem returns before measuring", () => {
    const p = page([R(1, { live: true, selected: true, entries: 13, kinds: 5 })]);
    p.window.buildSectionNav();
    const closed = [...p.document.querySelectorAll("details.nav-group")].find((g) => !g.open);
    const item = closed.querySelector(".section-nav-item");
    let measured = 0;
    item.getBoundingClientRect = () => { measured++; return { top: 0, bottom: 0 }; };
    p.window.revealNavItem(item);
    expect(measured).toBe(0);
  });

  test("the chip's stamped label survives the summary — frozen bar and head read it, not the summary", () => {
    const p = page([R(1, { entries: 5 }), R(2, { live: true, selected: true })]);
    p.window.buildSectionNav();
    const t1 = p.bar.querySelector('.iteration-tab[data-iteration="1"]');
    expect(t1.textContent).toContain("nav.summary_entries");
    expect(t1.dataset.tabLabel).toBe("Iteration 1");
    expect(fnSource("showIteration")).toContain("tab.dataset.tabLabel || tab.textContent.trim()");
    expect(fnSource("renderPanelStatus")).toContain("tab.dataset.tabLabel || tab.textContent.trim()");
  });
});
