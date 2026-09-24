import { describe, test, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// The "Kompass" tree: the section TOC is built fresh for the LIVE round only,
// inside the panel's scroll box. The bar (`nav.iteration-tabs`) stays exactly
// as appended but is hidden — buildIterationTree()/buildRoundsChip() re-derive
// a 🕘 rounds chip + toggled list in the pinned head from it instead. The TOC
// groups around the selected variant when one is unambiguous, else falls back
// to the flat/kind-grouped list (≥2 kinds AND >12 entries).
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
  test("buildSectionNav builds the live round's TOC in place and rebinds the spy", () => {
    const fn = slice(md, "function buildSectionNav()");
    expect(fn).toContain("buildIterationTree();");
    expect(fn).toContain("installScrollSpy();");
    expect(fn).toContain("computeSelectedVariant(variantSections)");
    expect(fn).toContain("applyNavOverflow(nav, document.querySelector('.panel-nav-scroll'))");
    // One-open and the manual-close stamp are bound INSIDE the builder — the
    // nav DOM is rebuilt on every tab switch. The selected-variant node is
    // exempt from both.
    expect(fn).toContain("addEventListener('toggle'");
    expect(fn).toContain("_navManualClosedAt.set(group, Date.now())");
    expect(fn).toContain("nav-group:not(.nav-variant-open)");
    // deterministic, spy-independent open state — reset the manual-close
    // grace on every rebuild, then open pickInitialNavTarget()'s group
    // BEFORE installScrollSpy() runs at all.
    expect(fn).toContain("_navManualClosedAt = new WeakMap();");
    expect(fn).toContain("pickInitialNavTarget(navItems)");
    // opened BEFORE installScrollSpy() runs at all (the floor)…
    expect(fn.indexOf("openGroupExclusively(pickInitialNavTarget(navItems))")).toBeLessThan(fn.indexOf("installScrollSpy();"));
    // …and reconciled to a single open group again AFTER it (the settled
    // state) — never left for the accordion's own async 'toggle' listener.
    expect(fn.indexOf("installScrollSpy();")).toBeLessThan(fn.indexOf("openGroupExclusively(settledItem);"));
    expect(fn).toContain("nav.querySelectorAll('details.nav-group:not(.nav-variant-open)').forEach(g => {");
  });

  test("pickInitialNavTarget is a pure, synchronous function — no dependency on the spy having run", () => {
    const fn = fnSource("pickInitialNavTarget");
    expect(fn).toContain("classList.contains('is-active')");
    expect(fn).toContain("measured && picked");
    expect(fn).toContain("(measured && picked) ? picked : items[0];");
  });

  test("kinds derive from the eval-{id} contract + data-nav-group, thresholds are the decided ones", () => {
    const fn = slice(md, "function buildSectionNav()");
    expect(fn).toMatch(/sec\.dataset\.navGroup\s*\|\|\s*\(sec\.querySelector\(`input\[name="eval-\$\{sec\.id\}"\]`\)/);
    expect(md).toMatch(/const NAV_GROUP_MIN_KINDS = 2;/);
    expect(md).toMatch(/const NAV_GROUP_OVER_ENTRIES = 12;/);
    expect(md).toMatch(/const NAV_MANUAL_CLOSE_GRACE_MS = 4000;/);
    expect(fn).toContain("kinds.length >= NAV_GROUP_MIN_KINDS && sections.length > NAV_GROUP_OVER_ENTRIES");
    // the archive fold is gone — the bar is display:none, not a wrapper
    expect(md).not.toMatch(/const NAV_ARCHIVE_FROM/);
    expect(md).not.toContain('class="iteration-archive"');
  });

  test("stripActiveSuffix removes the authored active-suffix from the head, nowhere else", () => {
    const fn = fnSource("stripActiveSuffix");
    expect(fn).toMatch(/aktiv\|active/);
    const iterationTab = fnSource("iterationTabLabel");
    expect(iterationTab).toContain("stripActiveSuffix(tab.textContent.trim())");
    expect(fnSource("showIteration")).toContain("stripActiveSuffix(hereTab.textContent.trim())");
  });

  test("the bar no longer authors {{iteration.active_suffix}} onto new chips", () => {
    const fixture = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "build-concept-fixture.js"), "utf8");
    expect(fixture).not.toContain("{{iteration.active_suffix}}");
  });

  test("computeSelectedVariant: unambiguous include-vs-discard, else the reading-line fallback", () => {
    const fn = fnSource("computeSelectedVariant");
    expect(fn).toContain("if (variantSections.length < 2) return null;");
    expect(fn).toContain("includeCount === 1 && discardCount === variantSections.length - 1");
    expect(fn).toContain("_lastActiveSectionId");
  });

  test("buildRoundsChip renders the head's 🕘 chip + list from the (hidden) bar", () => {
    const fn = fnSource("buildRoundsChip");
    expect(fn).toContain("getElementById('panel-here-rounds')");
    expect(fn).toContain("getElementById('panel-here-rounds-list')");
    expect(fn).toContain("{{nav.archived}}");
    expect(fn).toContain("showIteration(tab.dataset.iteration)");
    // reuses the ALREADY computed .iteration-tab-summary — no duplicate calc
    expect(fn).toContain("tab.querySelector('.iteration-tab-summary')");
  });

  test("applyNavOverflow only hides the tail when the scroll box actually overflows", () => {
    const fn = fnSource("applyNavOverflow");
    expect(fn).toContain("scrollBox.scrollHeight <= scrollBox.clientHeight");
    expect(fnSource("makeNavMoreToggle")).toContain("{{nav.more_entries}}");
    // The final report defers to the 3-entry window BEFORE the overflow
    // measurement — it must never fall through to the tail cut there.
    const branch = fn.indexOf("document.body.classList.contains('viewing-final')");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(fn.indexOf("scrollBox.scrollHeight <= scrollBox.clientHeight"));
    expect(fn.slice(branch)).toMatch(/applyNavWindow\(nav, nav\.querySelector\('\.section-nav-item\.is-active'\)\);\s*return;/);
    // The window follows the reading line; a hand-expanded list does not
    // re-window; a rebuild starts windowed again.
    expect(fnSource("setActiveNavItem")).toContain("applyNavWindow(nav, item)");
    expect(fnSource("applyNavWindow")).toMatch(/^function applyNavWindow\(nav, activeItem\) \{\s*if \(nav\.dataset\.navExpanded === 'true'\) return;/);
    expect(fnSource("makeNavMoreToggle")).toContain("nav.dataset.navExpanded = 'true'");
    expect(slice(md, "function buildSectionNav()")).toContain("delete nav.dataset.navExpanded;");
    expect(md).toContain("const NAV_WINDOW_MAX = 3;");
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
    expect(fnSource("setActiveNavItem")).toContain("updateHereRoundParenthesis(item)");
  });

  test("updateHereRoundParenthesis only appends the variant label under a data-variant reading line", () => {
    const fn = fnSource("updateHereRoundParenthesis");
    expect(fn).toContain("item.hasAttribute('data-variant')");
    expect(fn).toContain("hereRoundBase");
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
    // Both panel skeletons carry the rounds chip + its list.
    const skeletons = HTML_BLOCKS.filter((b) => b.code.includes('class="panel-cta"'));
    for (const b of skeletons) {
      expect(b.code, `html block at line ${b.line}`).toContain('id="panel-here-rounds"');
      expect(b.code, `html block at line ${b.line}`).toContain('id="panel-here-rounds-list"');
    }
  });

  test("locale, gate, rules and SKILL carry the tree", () => {
    for (const key of [
      "panel.archive_summary", "nav.summary_entries", "nav.summary_discarded",
      "nav.group_context", "nav.group_variants", "nav.rounds_chip",
      "nav.archived", "nav.other_variants", "nav.more_entries",
    ]) {
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
    expect(skill).toContain("`buildSectionNav()` moves");
    expect(skill).toContain("#section-nav");
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
    md.match(/const NAV_GROUP_MIN_KINDS = 2;[\s\S]*?let _navGeneration = 0;/)[0],
    fnSource("stripActiveSuffix"),
    fnSource("iterationTabLabel"),
    fnSource("buildIterationTree"),
    fnSource("buildRoundsChip"),
    fnSource("computeSelectedVariant"),
    fnSource("applyNavOverflow"),
    fnSource("makeNavMoreToggle"),
    "const NAV_WINDOW_MAX = 3;",
    fnSource("applyNavWindow"),
    fnSource("pickInitialNavTarget"),
    slice(md, "function buildSectionNav()"),
    fnSource("openNavGroupFor"),
    fnSource("updateSectionNavState"),
    fnSource("installScrollSpy"),
    fnSource("setActiveNavItem"),
    fnSource("updateHereRoundParenthesis"),
    fnSource("nearestScrollBox"),
    fnSource("revealNavItem"),
    fnSource("updateScrollSpy"),
    "window.showIteration = function(n) { window.__showIterationCalledWith = String(n); };",
    // lexical declarations of an indirect eval are not window properties —
    // hand the manual-close map out for the grace-period test
    // _navManualClosedAt is reassigned (reset) on every buildSectionNav()
    // rebuild — expose a live getter, not a one-time snapshot, or this goes
    // stale the moment a test's page() build runs even once.
    "window.__getNavClosedAt = () => _navManualClosedAt;",
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
  test("smallest case: one round, three sections — flat TOC, no summary, no groups", () => {
    const p = page([R(1, { live: true, selected: true })]);
    p.window.buildSectionNav();
    const tab = p.bar.querySelector(".iteration-tab");
    expect(p.document.querySelectorAll(".section-nav-item").length).toBe(3);
    expect(p.document.querySelector(".iteration-tab-summary")).toBeNull();
    expect(p.document.querySelector(".nav-group")).toBeNull();
    expect(tab.dataset.tabLabel).toBe("Iteration 1");
    // no rounds chip when there are no previous rounds
    expect(p.document.getElementById("panel-here-rounds").hidden).toBe(true);
  });

  test("the TOC rebuilds for the live round only; other chips get summaries consumed by the rounds list", () => {
    const p = page([R(1, { entries: 14, kinds: 5, discard: 3 }), R(2, { live: true, selected: true })]);
    p.window.buildSectionNav();
    const [t1, t2] = p.bar.querySelectorAll(".iteration-tab");
    expect(t1.querySelector(".iteration-tab-summary").textContent).toBe("14 nav.summary_entries · 3 nav.summary_discarded");
    expect(t2.querySelector(".iteration-tab-summary")).toBeNull();
    // the label is stamped BEFORE the summary is appended
    expect(t1.dataset.tabLabel).toBe("Iteration 1");
    // round 2 is live: only its 0 sections show — R(2) uses the default 3 entries
    expect(p.document.querySelectorAll(".section-nav-item").length).toBe(3);

    // the rounds chip shows the ONE previous round, with its summary and tag
    const chip = p.document.getElementById("panel-here-rounds");
    expect(chip.hidden).toBe(false);
    expect(chip.querySelector("[data-here-rounds-count]").textContent).toBe("1");
    const row = p.document.querySelector(".panel-here-rounds-item");
    expect(row.querySelector(".panel-here-rounds-label").textContent).toBe("Iteration 1");
    expect(row.querySelector(".panel-here-rounds-summary").textContent).toBe("14 nav.summary_entries · 3 nav.summary_discarded");
    expect(row.querySelector(".panel-here-rounds-tag").textContent).toBe("nav.archived");

    p.select(1);
    expect(t1.querySelector(".iteration-tab-summary")).toBeNull();
    expect(t2.querySelector(".iteration-tab-summary").textContent).toBe("3 nav.summary_entries");
    // the frozen round's TOC shows its own sections now
    expect(p.document.querySelectorAll(".section-nav-item").length).toBe(14);
    expect(p.document.querySelectorAll(".section-nav-item[data-variant]").length).toBe(5);
    // no previous rounds ahead of round 1
    expect(p.document.getElementById("panel-here-rounds").hidden).toBe(true);
  });

  test("clicking a rounds-list row drives showIteration() with the row's round", () => {
    const p = page([R(1, { entries: 5 }), R(2, { live: true, selected: true })]);
    p.window.buildSectionNav();
    const row = p.document.querySelector(".panel-here-rounds-item");
    row.dispatchEvent(new p.window.MouseEvent("click", { bubbles: true }));
    expect(p.window.__showIterationCalledWith).toBe("1");
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

  test("groups only when ≥2 kinds AND >12 entries — the fallback path with no unambiguous variant", () => {
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

  test("the head strips the authored active suffix from the live round's label", () => {
    const p = page([R(1, { live: true, selected: true, label: "Iteration 1 · aktiv" })]);
    p.window.buildIterationTree();
    const tab = p.bar.querySelector(".iteration-tab");
    expect(tab.dataset.tabLabel).toBe("Iteration 1");
    // the English form and the older parenthesis form are both covered
    expect(p.window.stripActiveSuffix("Iteration 4 · active")).toBe("Iteration 4");
    expect(p.window.stripActiveSuffix("Iteration 4 (aktiv)")).toBe("Iteration 4");
    expect(p.window.stripActiveSuffix("Iteration 4")).toBe("Iteration 4");
  });

  test("the group containing the active (reading-line) entry is open right after buildSectionNav() — every rebuild, not just via the async spy", () => {
    const p = page([R(1, { live: true, selected: true, entries: 13, kinds: 5 })]);
    p.window.buildSectionNav();
    const activeItem = p.document.querySelector(".section-nav-item.is-active");
    expect(activeItem).not.toBeNull();
    const activeGroup = activeItem.closest("details.nav-group");
    expect(activeGroup).not.toBeNull();
    expect(activeGroup.open, "the group holding the reading line must be open on load").toBe(true);
    // …and it survives a synchronous re-check even before the 'toggle' event
    // (a queued task) has had a chance to fire.
    expect([...p.document.querySelectorAll("details.nav-group")].filter((g) => g.open).length).toBe(1);
  });

  test("a group opens even when the spy has not (yet) marked anything .is-active — buildSectionNav does not depend on it", () => {
    const p = page([R(1, { live: true, selected: true, entries: 13, kinds: 5 })]);
    // Simulate an async / not-yet-run spy (IntersectionObserver, or a first
    // getBoundingClientRect() read that predates layout): stub it to a no-op
    // so nothing gets .is-active from the spy's own pass.
    const realSpy = p.window.installScrollSpy;
    p.window.installScrollSpy = () => {};
    p.window.buildSectionNav();
    expect(p.document.querySelector(".section-nav-item.is-active"), "nothing marked active by the (stubbed) spy").toBeNull();
    const openGroups = [...p.document.querySelectorAll("details.nav-group")].filter((g) => g.open);
    expect(openGroups.length, "buildSectionNav() must still open exactly one group").toBe(1);
    p.window.installScrollSpy = realSpy;
  });

  test("with every rect at (0, 0) — jsdom's default, no layout to read — the FIRST group ends up open, not an arbitrary one", () => {
    const p = page([R(1, { live: true, selected: true, entries: 13, kinds: 5 })]);
    const realSpy = p.window.installScrollSpy;
    p.window.installScrollSpy = () => {};   // isolate pickInitialNavTarget from the spy's own fallback
    p.window.buildSectionNav();
    const groups = [...p.document.querySelectorAll("details.nav-group")];
    // kinds appear in section order — variants (sections 0-4) before context
    // (sections 5-12) — so the FIRST group is "variants".
    expect(groups[0].dataset.navGroup).toBe("variants");
    expect(groups[0].open).toBe(true);
    expect(groups[1].open).toBe(false);
    p.window.installScrollSpy = realSpy;
  });

  test("a stale 'toggle' event queued by an EARLIER buildSectionNav() generation, firing late, must not close the CURRENT tree's open group", async () => {
    // Reproduces the real boot defect: nav.innerHTML = '' detaches a build's
    // groups but cannot cancel a 'toggle' event already queued on one of
    // them. If that group was ever set open=true during ITS OWN build (a
    // real transition — every fresh group starts closed), the event is
    // still pending when the NEXT buildSectionNav() call runs synchronously
    // right after (exactly what the boot sequence does: a direct
    // DOMContentLoaded listener, then showIteration() from a second one).
    // Without the generation guard, that stale event's handler reads its
    // own (frozen, still `true`) `.open`, passes the "am I open" check, and
    // closes whatever is open in the LIVE tree via the shared `nav`
    // reference — a group that has nothing to do with it.
    const p = page([R(1, { live: true, selected: true, entries: 13, kinds: 5 })]);
    const flush = () => new Promise((r) => setTimeout(r, 0));

    p.window.buildSectionNav();   // generation 1 — opens some group; a real
                                   // false→true transition queues its 'toggle'.
    const staleGroup = [...p.document.querySelectorAll("details.nav-group")].find((g) => g.open);
    expect(staleGroup, "generation 1 must have opened exactly one group").not.toBeUndefined();

    p.window.buildSectionNav();   // generation 2, synchronously — replaces the
                                   // tree before generation 1's queued event fires.
    const currentGroup = [...p.document.querySelectorAll("details.nav-group")].find((g) => g.open);
    expect(currentGroup, "generation 2 must also have opened exactly one group").not.toBeUndefined();
    expect(p.document.body.contains(staleGroup), "generation 1's group is now detached").toBe(false);

    // Two ticks — the same margin the real-boot test now requires — for
    // generation 1's stale event (and anything it queues) to fully drain.
    await flush();
    await flush();

    const liveGroups = [...p.document.querySelectorAll("details.nav-group")];
    expect(liveGroups.includes(currentGroup)).toBe(true);
    const stillOpen = liveGroups.filter((g) => g.open);
    expect(stillOpen.length, "groups: " + liveGroups.map((g) => g.dataset.navGroup + ":" + g.open).join(", ")).toBe(1);
    expect(stillOpen[0] === currentGroup, "the CURRENT generation's open group must survive the stale event").toBe(true);
  });

  test("pickInitialNavTarget: .is-active wins outright; a measured rect beats the (0,0) default; otherwise the first item", () => {
    const p = page([R(1, { live: true, selected: true, entries: 4 })]);
    p.window.buildSectionNav();
    const items = [...p.document.querySelectorAll(".section-nav-item")];
    // buildSectionNav()'s own spy pass already marked one item .is-active
    // (jsdom's zero-rect default picks the LAST entry) — clear it so this
    // test can isolate pickInitialNavTarget's "nothing to go on" fallback.
    items.forEach((i) => i.classList.remove("is-active"));
    // nothing measured (jsdom default) → first item
    expect(p.window.pickInitialNavTarget(items)).toBe(items[0]);
    // an .is-active item, however it got there, wins outright
    items[2].classList.add("is-active");
    expect(p.window.pickInitialNavTarget(items)).toBe(items[2]);
    items[2].classList.remove("is-active");
    // a real (non-zero) rect is honoured over the "no signal" fallback — the
    // other sections stay far below the reading line so only item[1] qualifies
    items.forEach((it, i) => {
      const sec = p.document.getElementById(it.dataset.sectionId);
      sec.getBoundingClientRect = () => (i === 1 ? { top: 10, bottom: 40 } : { top: 9999, bottom: 10040 });
    });
    expect(p.window.pickInitialNavTarget(items)).toBe(items[1]);
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

  test("the selected variant renders open with nested sub-sections; the rest collapse into one row", () => {
    const p = page([R(1, { live: true, selected: true, entries: 3, kinds: 3, discard: 2 })]);
    // R(1) makes sections 0,1,2 variants; discard=2 marks 0 and 1 discard, 2 include.
    p.window.buildSectionNav();
    const openNode = p.document.querySelector("details.nav-variant-open");
    expect(openNode).not.toBeNull();
    expect(openNode.open).toBe(true);
    const otherRow = p.document.querySelector("details.nav-other-variants");
    expect(otherRow).not.toBeNull();
    expect(otherRow.querySelector(".nav-group-name").textContent).toBe("nav.other_variants · 2 · 2 nav.summary_discarded");
    // one-open never applies to the selected-variant node
    otherRow.open = true;
    openNode.dispatchEvent(new p.window.Event("toggle"));
    expect(openNode.open).toBe(true);
  });

  test("one-open among the (non-variant-open) groups; a manual close is honoured by the spy for 4 s, then a NEW active entry reopens", async () => {
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
    p.window.__getNavClosedAt().set(variants, Date.now() - 5000);
    p.window.openNavGroupFor(item);
    expect(variants.open).toBe(true);
    await flush();
    expect(context.open, "the accordion closed the other one").toBe(false);
  });

  test("the spy writes the 'you are here' breadcrumb and the head's parenthesis, only for a variant entry", () => {
    const p = page([R(1, { live: true, selected: true, entries: 4, kinds: 1 })]);
    p.window.buildSectionNav();
    const here = p.document.querySelector("[data-here-section]");
    expect(here.hidden).toBe(false);
    const round = p.document.querySelector("[data-here-round]");
    round.textContent = "Iteration 1";
    delete round.dataset.hereRoundBase;
    const contextItem = p.document.querySelector(".section-nav-item:not([data-variant])");
    p.window.setActiveNavItem(contextItem);
    expect(round.textContent).toBe("Iteration 1");
    const variantItem = p.document.querySelector(".section-nav-item[data-variant]");
    p.window.setActiveNavItem(variantItem);
    expect(round.textContent).toBe("Iteration 1 (" + variantItem.querySelector(".section-nav-label").textContent + ")");
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

  test("+N weitere only renders when the scroll box actually overflows", () => {
    const p = page([R(1, { live: true, selected: true, entries: 4 })]);
    p.window.buildSectionNav();
    // jsdom reports 0/0 for scrollHeight/clientHeight → never overflows
    expect(p.document.querySelector(".nav-more-toggle")).toBeNull();

    const nav = p.document.getElementById("section-nav");
    const box = p.document.querySelector(".panel-nav-scroll");
    Object.defineProperty(box, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 200, configurable: true });
    p.window.applyNavOverflow(nav, box);
    const toggle = p.document.querySelector(".nav-more-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toMatch(/^\+\d+ nav\.more_entries$/);
    const hiddenItems = nav.querySelectorAll("[data-nav-overflow-hidden]");
    expect(hiddenItems.length).toBeGreaterThan(0);
    toggle.dispatchEvent(new p.window.MouseEvent("click", { bubbles: true }));
    expect(nav.querySelectorAll("[data-nav-overflow-hidden]").length).toBe(0);
    expect(p.document.querySelector(".nav-more-toggle")).toBeNull();
  });

  test("final report: the TOC is a 3-entry window around the reading line, not a tail cut", () => {
    const p = page([R(1, { live: true, selected: true, entries: 6 })]);
    p.document.body.classList.add("viewing-final");
    p.window.buildSectionNav();
    const nav = p.document.getElementById("section-nav");
    const visible = () => [...nav.children].filter((el) => !el.hidden && !el.classList.contains("nav-more-toggle")).map((el) => el.dataset.sectionId);
    const ids = [...nav.querySelectorAll(".section-nav-item")].map((el) => el.dataset.sectionId);
    // Windowed right after the build, whichever entry the spy settled on.
    expect(visible().length).toBeLessThanOrEqual(3);
    expect(nav.querySelector(".nav-more-toggle")).not.toBeNull();
    // At the first entry: current + next only — never three-from-the-top.
    p.window.setActiveNavItem(nav.querySelector(`[data-section-id="${ids[0]}"]`));
    expect(visible()).toEqual(ids.slice(0, 2));
    expect(nav.querySelector(".nav-more-toggle").textContent).toBe("+4 nav.more_entries");
    // The window follows the reading line: previous + current + next.
    p.window.setActiveNavItem(nav.querySelector(`[data-section-id="${ids[3]}"]`));
    expect(visible()).toEqual(ids.slice(2, 5));
    expect(nav.querySelector(".nav-more-toggle").textContent).toBe("+3 nav.more_entries");
    // At the last entry: previous + current.
    p.window.setActiveNavItem(nav.querySelector(`[data-section-id="${ids[5]}"]`));
    expect(visible()).toEqual(ids.slice(4, 6));
    // Expanded by hand stays expanded across reading-line changes …
    nav.querySelector(".nav-more-toggle").dispatchEvent(new p.window.MouseEvent("click", { bubbles: true }));
    expect(visible()).toEqual(ids);
    p.window.setActiveNavItem(nav.querySelector(`[data-section-id="${ids[1]}"]`));
    expect(visible()).toEqual(ids);
    expect(nav.querySelector(".nav-more-toggle")).toBeNull();
    // … but a rebuild starts windowed again.
    p.window.buildSectionNav();
    expect(visible().length).toBeLessThanOrEqual(3);
    expect(nav.querySelector(".nav-more-toggle")).not.toBeNull();
    // Outside the final report the window never applies.
    p.document.body.classList.remove("viewing-final");
    p.window.buildSectionNav();
    expect(visible()).toEqual(ids);
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
