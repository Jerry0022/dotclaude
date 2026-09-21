import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../scripts/build-concept-fixture.js";
import { evaluate } from "../../hooks/lib/concept-gate.js";

// #399 — the 💬 feedback dock is page chrome in EVERY template. It used to
// exist only in the design skeleton and be wired only inside the design
// layout IIFE (which returns early on a page without a design round), so a
// decision/free page had no home for a general note, and a design concept
// lost the dock — with whatever was typed into it — the moment a document
// round (reality check, final report) was on screen.
//
// These tests boot the ASSEMBLED fixture pages (build-concept-fixture.js,
// always current templates.md) with every inline script running for real,
// the way nav-boot.test.js does — a decision page, a free page and a design
// page whose frozen history is made of decision rounds (the mixed concept).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gate = fs.readFileSync(path.join(__dirname, "deep-knowledge", "validation-gate.md"), "utf8");

const BASE = { rounds: 3, entries: 6, locale: "en", out: "", designs: 1 };
const DECISION = { ...BASE, mode: "decision", mapping: false };
const FREE = { ...BASE, mode: "decision", mapping: true };          // --mapping turns the live round into a free round
const DESIGN = { ...BASE, mode: "design", mapping: false, designs: 2 };

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Boot a page; `mutate(html)` may edit the markup before it is parsed. */
async function boot(opts, mutate = (h) => h) {
  const html = mutate(build(opts));
  const errors = [];
  const vc = new VirtualConsole();
  // jsdom cannot parse color-mix()/:has() stylesheets and implements no
  // layout — those are not script defects. Everything else is.
  vc.on("jsdomError", (e) => {
    if (!/Could not parse CSS|Not implemented/.test(String(e.message))) errors.push(String(e.message) + (e.detail?.stack ? "\n" + e.detail.stack : ""));
  });
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
    virtualConsole: vc,
    // CSS.escape is used by the collectors and the nav; jsdom has no CSS namespace.
    beforeParse(w) { w.CSS = { escape: (s) => s }; },
  });
  const { window } = dom;
  window.fetch = () => Promise.reject(new Error("no network in jsdom"));
  await new Promise((resolve) => {
    if (window.document.readyState === "complete") return resolve();
    window.addEventListener("load", resolve);
  });
  await tick();
  await tick();
  const { document } = window;
  return {
    window, document, errors,
    dock: document.getElementById("feedback-dock"),
    fab: document.getElementById("feedback-toggle"),
    general: document.querySelector('#feedback-dock textarea[data-comment="general"]'),
    type(el, text) { el.value = text; el.dispatchEvent(new window.Event("input", { bubbles: true })); },
    async goTo(n) {
      document.querySelector(`.iteration-tab[data-iteration="${n}"]`).click();
      await tick(); await tick();
    },
    storage() {
      const key = Object.keys(window.localStorage).find((k) => k.startsWith("concept"));
      return key ? JSON.parse(window.localStorage.getItem(key)) : {};
    },
  };
}

describe.each([
  ["decision", DECISION, "decision"],
  ["free", FREE, "free"],
])("%s page — the dock is page chrome", (_, opts, template) => {
  test("boots with exactly one 💬 FAB and one dock holding the general section only, no script errors", async () => {
    const p = await boot(opts);
    expect(p.errors, p.errors.join("\n---\n")).toEqual([]);
    expect(p.document.querySelectorAll("#feedback-dock").length).toBe(1);
    expect(p.document.querySelectorAll("#feedback-toggle").length).toBe(1);
    expect(p.document.querySelectorAll(".feedback-fab").length).toBe(1);
    expect(p.document.querySelectorAll("#feedback-dock .feedback-section").length, "general section only").toBe(1);
    expect(p.general, "general textarea").not.toBeNull();
    expect(p.general.hasAttribute("data-attachable"), "attachments stay on").toBe(true);
    expect(p.document.querySelector('#feedback-dock .attach-slot[data-attach-slot="general"]')).not.toBeNull();
    expect(p.document.querySelector("#feedback-dock #screen-textareas")).toBeNull();
    expect(p.document.querySelector("#feedback-dock #design-textareas")).toBeNull();
    expect(p.dock.dataset.open, "closed by default (P11)").toBe("false");
    expect(p.dock.dataset.size, "a document round is always compact").toBe("compact");
    expect(p.document.querySelector("section[data-iteration][data-active]").dataset.iterationTemplate).toBe(template);
  });

  test("opens, closes, maximises, persists its size, and openPanel() still closes it (P13e)", async () => {
    const p = await boot(opts);
    p.fab.click();
    expect(p.dock.dataset.open, "💬 opens").toBe("true");
    expect(p.fab.getAttribute("aria-expanded")).toBe("true");
    expect(p.fab.hasAttribute("data-untouched"), "the pulse ends on first open").toBe(false);
    p.fab.click();
    expect(p.dock.dataset.open, "💬 toggles closed").toBe("false");
    p.fab.click();
    p.document.getElementById("feedback-close").click();
    expect(p.dock.dataset.open, "− minimises").toBe("false");

    p.fab.click();
    p.document.getElementById("feedback-maximize").click();
    expect(p.dock.dataset.userMaximized, "⤢ maximises").toBe("true");
    expect(p.dock.dataset.open, "…without closing").toBe("true");
    expect(p.dock.dataset.size, "…and without touching the automatic size").toBe("compact");
    expect(p.document.getElementById("feedback-maximize").getAttribute("aria-pressed")).toBe("true");
    expect(p.storage().dockMaximized, "the choice is persisted").toBe(true);
    // A reload restores it through restoreState() → window.applyDockSize().
    p.dock.dataset.userMaximized = "false";
    p.window.restoreState();
    expect(p.dock.dataset.userMaximized, "restored on reload").toBe("true");
    expect(p.document.getElementById("feedback-maximize").getAttribute("aria-pressed")).toBe("true");

    // The dock ceiling rule: ☰ folds the dock away, and the dock's own open
    // path closes the panel again.
    p.document.getElementById("panel-toggle").click();
    expect(p.document.getElementById("decision-panel").classList.contains("open")).toBe(true);
    expect(p.dock.dataset.open, "openPanel → closeDock(true)").toBe("false");
    p.fab.click();
    expect(p.dock.dataset.open).toBe("true");
    expect(p.document.getElementById("decision-panel").classList.contains("open"), "openDock → closePanel").toBe(false);
    expect(p.errors, p.errors.join("\n---\n")).toEqual([]);
  });

  test("the payload carries the general note in the unified shape, next to the inline items", async () => {
    const p = await boot(opts);
    const inline = p.document.querySelector("section[data-iteration][data-active] textarea[data-comment]");
    expect(inline, "an inline note on the live round").not.toBeNull();
    p.type(p.general, "  the general note  ");
    p.type(inline, "an inline note");
    const payload = p.window.collectDecisions("iterate");
    expect(payload.template).toBe(template);
    expect(payload.comments.general).toEqual({ text: "the general note", attachments: [] });
    expect(payload.comments.items).toEqual([{ id: inline.dataset.comment, text: "an inline note", attachments: [] }]);
    expect(Array.isArray(payload.comments), "no array shape left").toBe(false);
    // Empty is still the same shape — a consumer never branches.
    p.type(p.general, "");
    p.type(inline, "");
    expect(p.window.collectDecisions("iterate").comments).toEqual({ general: { text: "", attachments: [] }, items: [] });
  });

  test("a frozen tab shows the frozen round's general note read-only and hands the live note back", async () => {
    // Round 1 froze with the unified object, round 2 (an older page) with a
    // bare string — applyDockFreezeState() reads both without an adapter.
    const p = await boot(opts, (html) => html
      .replace(/(<section[^>]*data-iteration="1"[^>]*>)/, '$1<script type="application/json" data-frozen-feedback>{"general":{"text":"round one note","attachments":[]}}</script>')
      .replace(/(<section[^>]*data-iteration="2"[^>]*>)/, '$1<script type="application/json" data-frozen-feedback>{"general":"round two note"}</script>'));
    p.type(p.general, "live note");
    await p.goTo(1);
    expect(p.document.body.classList.contains("viewing-frozen")).toBe(true);
    expect(p.general.readOnly, "read-only on a frozen tab").toBe(true);
    expect(p.general.value).toBe("round one note");
    await p.goTo(2);
    expect(p.general.readOnly).toBe(true);
    expect(p.general.value, "legacy string blob").toBe("round two note");
    p.document.getElementById("back-to-live-btn").click();
    await tick(); await tick();
    expect(p.document.body.classList.contains("viewing-frozen")).toBe(false);
    expect(p.general.readOnly, "editable again").toBe(false);
    expect(p.general.value, "the live note came back").toBe("live note");
    // …and the frozen paint never reached storage under the live namespace.
    const live = p.document.querySelector("section[data-iteration][data-active]").dataset.iteration;
    const stored = Object.entries(p.storage()).filter(([k]) => k.startsWith(`text:i${live}:`) && /general/.test(k));
    expect(stored.map(([, v]) => v)).toEqual(["live note"]);
    expect(p.errors, p.errors.join("\n---\n")).toEqual([]);
  });

  test("markDockSubmitted() makes the general note read-only; the reset re-arms it", async () => {
    const p = await boot(opts);
    p.type(p.general, "sent");
    p.window.markDockSubmitted();
    expect(p.general.readOnly).toBe(true);
    expect(p.dock.dataset.submitted).toBe("true");
    // A detour into a frozen tab and back keeps it read-only.
    await p.goTo(1);
    p.document.getElementById("back-to-live-btn").click();
    await tick(); await tick();
    expect(p.general.readOnly, "still the record of what was sent").toBe(true);
    expect(p.general.value).toBe("sent");
    p.window.unmarkDockSubmitted();
    expect(p.general.readOnly).toBe(false);
  });

  test("the built fixture passes the deterministic gate", () => {
    const html = build(opts);
    expect(html).toContain('id="feedback-dock"');
    expect(html).toContain('id="feedback-toggle"');
    const r = evaluate("docs/concepts/fixture.html", html);
    expect(r.applicable).toBe(true);
    expect(r.ok, JSON.stringify({ missing: r.missing, stale: r.stale, structural: r.structural, collisions: r.collisions })).toBe(true);
  });
});

describe("design page — no regression, and the dock survives a document round of the same concept", () => {
  test("one dock, one FAB, the four rows, screen navigation and per-screen notes work as before", async () => {
    const p = await boot(DESIGN);
    expect(p.errors, p.errors.join("\n---\n")).toEqual([]);
    expect(p.document.querySelectorAll("#feedback-dock").length).toBe(1);
    expect(p.document.querySelectorAll("#feedback-toggle").length).toBe(1);
    expect(p.document.querySelectorAll("#feedback-dock .feedback-section").length, "screen · design · view · general").toBe(4);
    expect(p.dock.dataset.size, "two designs → wide").toBe("wide");
    const screens = [...p.document.querySelectorAll("#screen-textareas textarea[data-screen-comment]")];
    expect(screens.length, "one textarea per screen of every design").toBeGreaterThan(1);
    const designs = [...p.document.querySelectorAll("#design-textareas textarea[data-design-comment]")];
    expect(designs.length).toBe(2);
    // Navigate to the second screen of the active design through the panel.
    const active = p.document.querySelector("section[data-design][data-design-active='true']");
    const second = active.querySelectorAll("section[data-screen]")[1];
    expect(second, "a second screen in the active design").toBeTruthy();
    p.window.showScreen(second.id);
    const visible = screens.filter((t) => !t.hidden);
    expect(visible.length, "exactly one screen textarea shown").toBe(1);
    expect(visible[0].dataset.screenComment).toBe(second.id);
    p.type(visible[0], "screen note");
    p.type(designs.find((d) => !d.hidden), "design note");
    p.type(p.general, "general note");
    const payload = p.window.collectDecisions("iterate");
    expect(payload.template).toBe("design");
    expect(payload.comments.general).toEqual({ text: "general note", attachments: [] });
    expect(payload.comments.screens).toEqual({ [second.id]: "screen note" });
    expect(payload.comments.designs).toEqual({ [active.dataset.design]: "design note" });
    expect(payload.comments.views).toEqual({});
    expect(payload.comments.items.map((i) => i.id).sort()).toEqual([`design-${active.dataset.design}`, second.id].sort());
    expect(payload.comments.items.every((i) => Array.isArray(i.attachments))).toBe(true);
  });

  test("a frozen DECISION round of a design concept still primes the dock: read-only there, live notes back afterwards", async () => {
    // The fixture's frozen history is made of decision rounds — exactly the
    // mixed concept (#399): the design IIFE's iteration:changed handler used
    // to return before primeDock() when the round had no design, which was
    // harmless only while the dock was hidden on document rounds.
    const p = await boot(DESIGN, (html) => html
      .replace(/(<section[^>]*data-iteration="1"[^>]*>)/, '$1<script type="application/json" data-frozen-feedback>{"general":{"text":"round one note","attachments":[]}}</script>'));
    const screenTa = [...p.document.querySelectorAll("#screen-textareas textarea")].find((t) => !t.hidden);
    p.type(screenTa, "screen note");
    p.type(p.general, "live general");
    await p.goTo(1);
    expect(p.document.documentElement.dataset.template, "the projection follows the tab").toBe("decision");
    expect(p.general.readOnly, "read-only on the frozen decision tab").toBe(true);
    expect(p.general.value).toBe("round one note");
    expect(p.dock.dataset.size, "compact while a document round is on screen").toBe("compact");
    p.document.getElementById("back-to-live-btn").click();
    await tick(); await tick();
    expect(p.document.documentElement.dataset.template).toBe("design");
    expect(p.general.readOnly).toBe(false);
    expect(p.general.value, "the live general note came back").toBe("live general");
    const back = [...p.document.querySelectorAll("#screen-textareas textarea")].find((t) => t.dataset.screenComment === screenTa.dataset.screenComment);
    expect(back.value, "the per-screen note came back").toBe("screen note");
    expect(p.dock.dataset.size).toBe("wide");
    expect(p.errors, p.errors.join("\n---\n")).toEqual([]);
  });

  test("the gate keeps P14b: restoreState() right after buildDesignUI(), before primeDock()", () => {
    expect(gate).toMatch(/\| P14b \|/);
    const md = fs.readFileSync(path.join(__dirname, "deep-knowledge", "templates.md"), "utf8");
    const from = md.indexOf("function wireDesignLayout()");
    const load = md.indexOf("document.addEventListener('DOMContentLoaded', () => {\n    buildDesignUI();", from);
    expect(load).toBeGreaterThan(from);
    const body = md.slice(load, md.indexOf("requestAnimationFrame(applyViewport);", load)).replace(/\/\/[^\n]*/g, "");
    expect(body.indexOf("restoreState()")).toBeGreaterThan(body.indexOf("buildDesignUI();"));
    expect(body.indexOf("restoreState()")).toBeLessThan(body.indexOf("primeDock()"));
  });
});

describe("validation gate — the dock patterns are template-independent", () => {
  const phase1 = gate.slice(gate.indexOf("## Phase 1 — Shared patterns"), gate.indexOf("## Engine drift on iteration append"));
  const designOnly = gate.slice(gate.indexOf("### Template: design"), gate.indexOf("### Frozen/Active Mismatch"));

  test.each(["P1", "P2", "P5", "P11", "P12", "P13", "P13b", "P13c", "P13d", "P13e"])("%s sits in the all-templates block, not under § Template: design", (id) => {
    expect(phase1).toMatch(new RegExp("^\\| " + id + " \\|", "m"));
    expect(designOnly).not.toMatch(new RegExp("^\\| " + id + " \\|", "m"));
  });

  test.each(["P3", "P4", "P10", "P14", "P15", "P16", "P17", "P18"])("%s stays design-only", (id) => {
    expect(designOnly).toMatch(new RegExp("^\\| " + id + " \\|", "m"));
    expect(phase1).not.toMatch(new RegExp("^\\| " + id + " \\|", "m"));
  });

  test("legacy pages are tolerated through the data-page-version path, new pages are required to carry the dock", () => {
    const block = phase1.slice(phase1.indexOf("| P1 |") - 1500, phase1.indexOf("**Failure for 21 / 22:**"));
    expect(block).toMatch(/data-page-version/);
    expect(block).toMatch(/#399/);
  });
});
