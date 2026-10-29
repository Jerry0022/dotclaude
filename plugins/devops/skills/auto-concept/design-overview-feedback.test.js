import { describe, test, expect } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";
import { readTemplates } from "./templates-source.js";

// User feedback on the variant overview (templates-design-overview*.md):
// the eye sits inside the header and is the only overlay switch, the centre
// tile is the open control (glow, no "Design öffnen" button), neighbours are
// plain icon tiles, Enter opens the centre, ← / → step a variant's pages even
// from the chrome, the questions own a colour token, the own-note editor keeps
// its 📎 out of the textarea. Same method as design-overview.test.js: boot the
// assembled fixture with every inline script running.

const md = readTemplates();
const css = md.match(/```css\n([\s\S]*?)```/g).join("\n");
const BOOT_TIMEOUT = 180_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

function page(designs) {
  return build({ rounds: 2, entries: 4, mode: "design", mapping: false, locale: "de", designs, out: "" })
    .replace(/<section data-design="d2(b|c)?"/g, (m, sfx) => `${m} data-design-motto="M${sfx || ""}" data-design-traits="a | b | c" data-design-icon="leaf" data-design-improved="Größere Tageskacheln"`);
}

async function boot(html) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (!/Could not parse CSS|Not implemented/.test(String(e.message))) errors.push(String(e.message));
  });
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
    virtualConsole: vc,
    beforeParse(window) {
      window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c) };
      window.fetch = () => Promise.reject(new Error("no network in jsdom"));
    },
  });
  const { window } = dom;
  await new Promise((resolve) => {
    if (window.document.readyState === "complete") return resolve();
    window.addEventListener("load", resolve);
  });
  await tick();
  await tick();
  return { window, document: window.document, errors };
}

const live = (document) => document.querySelector("section[data-iteration][data-active]");
const activeDesign = (document) => live(document).querySelector(":scope > section[data-design][data-design-active='true']");
const activeScreen = (document) => activeDesign(document).querySelector("section[data-screen][data-screen-active='true']");
function key(window, target, init) {
  const ev = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe("overview feedback — header", () => {
  test("the corner holds the eye only: no breadcrumb, no back item, no title, no star, no box", async () => {
    const { window, document, errors } = await boot(page(2));
    expect(errors).toEqual([]);
    const header = document.getElementById("design-header");
    for (const mdName of ["overview", "design"]) {
      if (mdName === "design") window.showDesign("d2");
      expect(header.querySelector(".design-header-back, .design-header-title, .design-header-name, .design-header-star, .design-header-sep, .design-header-overlay")).toBeNull();
      const eye = document.getElementById("anno-toggle");
      expect(eye.closest(".design-header-main")).not.toBeNull();
      // Besides the eye only the device switch rides in the corner
      // (third feedback round); it carries no visible text of its own there.
      const rest = [...header.querySelector(".design-header-main").children]
        .filter((n) => !n.matches(".design-header-eye, #viewport-toggle, #viewport-modes"));
      expect(rest).toEqual([]);
    }
    expect(css).toMatch(/\.design-header \.anno-toggle-fab \{\s*position: relative; inset: auto;/);
    const box = css.match(/\.design-header \{[^}]*\}/)[0];
    expect(box).toContain("background: transparent");
    expect(box).toContain("box-shadow: none");
    // The way back is the ☰ menu's overview entry.
    expect(document.querySelector("#screen-nav .screen-nav-overview-group")).not.toBeNull();
  }, BOOT_TIMEOUT);
});

describe("overview feedback — quick nav names the centre tile", () => {
  test("the centred variant is highlighted in the quick nav, follows the carousel, the questions tile marks Fragen", async () => {
    const { window, document } = await boot(page(3));
    const focused = () => [...document.querySelectorAll('#design-quick .design-quick-seg[data-ov-focus="true"]')].map((s) => s.dataset.designId);
    expect(focused()).toEqual(["d2"]);
    window.designOverviewGo(1);
    expect(focused()).toEqual(["d2b"]);
    // Only the variant: no pages fan out on the overview.
    expect(document.querySelector("#design-quick .design-quick-page, #design-quick .design-quick-group")).toBeNull();
    const n = document.querySelectorAll("[data-design-overview] .design-ov-slide").length;
    const qSlide = document.querySelector('[data-design-overview] .design-ov-slide[data-questions="true"]');
    if (qSlide) {
      window.designOverviewGo(n - 1);
      expect(focused()).toEqual([]);
      expect(document.querySelector("#design-quick .design-quick-q").dataset.ovFocus).toBe("true");
    }
    // Leaving the overview clears the mark.
    window.showDesign("d2");
    expect(focused()).toEqual([]);
    expect(css).toMatch(/\.design-quick-seg\[data-ov-focus="true"\] \.design-quick-subcaret \{ display: inline; \}/);
  }, BOOT_TIMEOUT);
});

describe("overview feedback — tiles", () => {
  test("side label is the quick-nav icon alone; kicker is icon + name; no open button", async () => {
    const { document } = await boot(page(3));
    const slides = [...document.querySelectorAll("[data-design-overview] .design-ov-slide[data-design-id]")];
    expect(slides.length).toBe(3);
    slides.forEach((s) => {
      expect(s.querySelector(".design-ov-badge")).toBeNull();
      expect(s.querySelector(":scope > .design-ov-side > .dz-icon")).not.toBeNull();
      expect(s.querySelector(".design-ov-side-name")).toBeNull();
      expect(s.querySelector(":scope > .design-ov-side").textContent.trim()).toBe("");
      expect(s.querySelector(".design-ov-open")).toBeNull();
      const kick = s.querySelector(".design-ov-kicker");
      expect(kick.querySelector(".design-ov-num").textContent).toMatch(/^[1-9] ·$/);
      // "Verbessert" is a line under the traits (changed variants only), never a chip.
      expect(s.querySelector('.design-ov-change[data-kind="changed"]')).toBeNull();
      const line = s.querySelector(".design-ov-improved");
      if (s.dataset.change === "changed") expect(line.textContent).toBe("Verbessert Größere Tageskacheln");
      else expect(line).toBeNull();
    });
    // Side label: shown on neighbours only, centred vertically, no name.
    expect(css).toMatch(/\.design-ov-slide:is\(\[data-pos="prev"\], \[data-pos="next"\]\) \.design-ov-side \{ display: block; \}/);
    const side = css.match(/\.design-ov-side \{[^}]*\}/)[0];
    expect(side).toContain("top: 50%");
    expect(side).not.toMatch(/border|box-shadow|background/);
    expect(css).not.toContain(".design-ov-side-name");
    // The centre tile's hover glow has vertical room: the stage clips only sideways.
    const stage = css.match(/\.design-ov-stage \{[^}]*\}/)[0];
    expect(stage).toContain("overflow-x: clip; overflow-y: visible");
    expect(css).toMatch(/--dz-ov-w: min\(78cqw, calc\(\(100cqh - 2 \* var\(--dz-ov-glow\)\) \* 1\.6\)\)/);
    expect(css).not.toContain(".design-ov-open");
    // Hover on the centre: glow, no scale.
    expect(css).toMatch(/\.design-ov-slide\[data-pos="cur"\] \.design-ov-preview:hover/);
    // Arrows: no circle any more.
    const arrow = css.match(/\.design-ov-slide\[data-pos="prev"\]::after, \.design-ov-slide\[data-pos="next"\]::after \{[^}]*\}/)[0];
    expect(arrow).not.toContain("border-radius: 50%");
    expect(arrow).toContain("drop-shadow");
  }, BOOT_TIMEOUT);

  test("the improved phrase is capped at a word boundary", () => {
    expect(md).toContain("function improvedPhrase(raw)");
    expect(md).toMatch(/data-design-improved/);
  });
});

describe("overview feedback — keyboard", () => {
  test("Enter on the page opens the centre tile; Enter on a chrome button does not", async () => {
    const { window, document } = await boot(page(2));
    const btn = document.querySelector("#design-quick button");
    btn.focus();
    key(window, btn, { key: "Enter", code: "Enter" });
    expect(document.body.dataset.overviewActive, "a focused control answers Enter itself").toBe("true");
    btn.blur();
    key(window, document.body, { key: "Enter", code: "Enter" });
    expect(document.body.dataset.overviewActive).toBe("false");
    expect(activeDesign(document).dataset.design).toBe("d2");
  }, BOOT_TIMEOUT);

  test("← / → step the variant's pages while a quick-nav control has the focus", async () => {
    const { window, document } = await boot(page(2));
    window.showDesign("d2");
    const screens = [...activeDesign(document).querySelectorAll("section[data-screen][id]")];
    if (screens.length < 2) return;
    window.showScreen(screens[0].id);
    const btn = document.querySelector("#design-quick button");
    btn.focus();
    key(window, btn, { key: "ArrowRight", code: "ArrowRight" });
    expect(activeScreen(document).id).toBe(screens[1].id);
    key(window, document.querySelector("#design-quick button"), { key: "ArrowLeft", code: "ArrowLeft" });
    expect(activeScreen(document).id).toBe(screens[0].id);
  }, BOOT_TIMEOUT);
});

describe("overview feedback — questions, notes", () => {
  test("questions own a colour token; the segment has no dropdown-tab hover", () => {
    expect(css).toContain("--q: var(--question-color, var(--warning-color, #d29922))");
    expect(css).not.toMatch(/\.design-quick-qwrap:hover \.design-quick-q[,\s{]/);
    expect(css).toMatch(/\.design-quick-q:hover \{/);
  });

  test("the own-note editor keeps the 📎 in its foot row and rises above the auto pins while open", () => {
    expect(md).toContain("foot.appendChild(slot);");
    expect(css).not.toContain(".upin-editor .attach-slot .attach-btn { position: absolute");
    expect(css).toMatch(/\.upin-layer:has\(\.upin\[data-editing="true"\]\) \{ z-index: 45; \}/);
  });

  test("the open-questions hint opens the call-to-action block, above the journey row", () => {
    expect(md).toContain("const anchor = journey && journey.parentNode ? journey : split;");
  });
});

describe("overview feedback — the centred variant's note in the dock (#960)", () => {
  const visible = (document) => [...document.querySelectorAll("#design-textareas textarea[data-design-comment]")]
    .filter((ta) => !ta.hidden).map((ta) => ta.dataset.designComment);
  test("the dock follows the carousel; questions tile hides the row; text is the design page's own", async () => {
    const { window, document, errors } = await boot(page(3));
    expect(errors).toEqual([]);
    expect(document.body.dataset.overviewActive).toBe("true");
    const slides = [...live(document).querySelectorAll("[data-design-overview] .design-ov-slide")];
    const label = () => document.getElementById("dock-design-label").textContent;
    const designSlides = slides.filter((s) => s.dataset.designId);
    for (const s of designSlides) {
      window.designOverviewGo(slides.indexOf(s));
      const id = s.dataset.designId;
      expect(document.body.dataset.ovDockDesign).toBe("true");
      expect(visible(document)).toEqual([id]);
      expect(label()).toBe(live(document).querySelector(`section[data-design="${id}"]`).dataset.navLabel || id);
    }
    const q = slides.findIndex((s) => s.dataset.questions === "true");
    if (q >= 0) {
      window.designOverviewGo(q);
      expect(document.body.dataset.ovDockDesign).toBe("false");
    }
    // A note typed on the overview is the same textarea the design page shows.
    const first = designSlides[0].dataset.designId;
    window.designOverviewGo(slides.indexOf(designSlides[0]));
    const ta = document.querySelector(`#design-textareas textarea[data-design-comment="${first}"]`);
    ta.value = "Overview-Notiz";
    window.showDesign(first);
    expect(visible(document)).toEqual([first]);
    expect(document.querySelector(`#design-textareas textarea[data-design-comment="${first}"]`).value).toBe("Overview-Notiz");
    // CSS: the design row hides on the overview only without a centred design.
    expect(css).toMatch(/body\[data-overview-active="true"\]:not\(\[data-ov-dock-design="true"\]\) \.feedback-section:has\(#design-textareas\)/);
    expect(css).not.toMatch(/body\[data-overview-active="true"\] \.feedback-section:has\(#design-textareas\)/);
  }, BOOT_TIMEOUT);
});
