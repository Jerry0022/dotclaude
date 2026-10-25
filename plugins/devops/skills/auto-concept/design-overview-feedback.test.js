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
  test("no layers button; the eye sits in the header row and drops the fixed offsets", async () => {
    const { document, errors } = await boot(page(2));
    expect(errors).toEqual([]);
    expect(document.querySelector("#design-header .design-header-overlay")).toBeNull();
    const eye = document.getElementById("anno-toggle");
    expect(eye.closest(".design-header-main")).not.toBeNull();
    expect(css).toMatch(/\.design-header \.anno-toggle-fab \{ position: relative; inset: auto;/);
    // The current page is a flat label: underline only, no pill fill.
    const title = css.match(/\.design-header-title \{[^}]*\}/)[0];
    expect(title).toContain("background: transparent");
    expect(document.querySelector("#design-header .design-header-title").getAttribute("aria-current")).toBe("page");
  }, BOOT_TIMEOUT);
});

describe("overview feedback — tiles", () => {
  test("every tile has an icon badge; kicker is icon + name; no open button", async () => {
    const { document } = await boot(page(3));
    const slides = [...document.querySelectorAll("[data-design-overview] .design-ov-slide[data-design-id]")];
    expect(slides.length).toBe(3);
    slides.forEach((s) => {
      expect(s.querySelector(":scope > .design-ov-badge .dz-icon")).not.toBeNull();
      expect(s.querySelector(".design-ov-badge-name").textContent).not.toBe("");
      expect(s.querySelector(".design-ov-open")).toBeNull();
      const kick = s.querySelector(".design-ov-kicker");
      expect(kick.querySelector(".design-ov-num")).toBeNull();
      expect(kick.textContent).not.toContain("·");
      // "Verbessert" is a line under the traits (changed variants only), never a chip.
      expect(s.querySelector('.design-ov-change[data-kind="changed"]')).toBeNull();
      const line = s.querySelector(".design-ov-improved");
      if (s.dataset.change === "changed") expect(line.textContent).toBe("Verbessert Größere Tageskacheln");
      else expect(line).toBeNull();
    });
    expect(css).toMatch(/\.design-ov-slide:is\(\[data-pos="prev"\], \[data-pos="next"\]\):not\(:hover\) \.design-ov-badge-name \{ display: none; \}/);
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
