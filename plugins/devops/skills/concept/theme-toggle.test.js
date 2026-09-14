import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";

// The theme toggle moved out of the content column into the ☰ panel.
//
// It used to be the last child of `.concept-content > header` — a control
// sitting in the reading column of every document round, and absent from
// design rounds altogether (design mode hides that header, and the design
// skeleton never had a toggle of its own). The panel is page chrome on every
// template (§ Panel Chrome (all templates)), so a toggle in its head row is
// the same control in the same place whatever round is on screen, and the
// content column carries content only.
//
// Dark is the default; the toggle names the NEXT action (☀️ while dark) the
// way the ☰ and 💬 FABs do, and the label follows `data-theme` whoever writes
// it — the click handler or restoreState() after a reload.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");
const skill = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const gate = fs.readFileSync(path.join(DK, "validation-gate.md"), "utf8");

function scanBlocks(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null, body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) {
      if (open === null) { open = { info: m[1].trim(), start: i + 1 }; body = []; }
      else { out.push({ info: open.info, line: open.start, code: body.join("\n") }); open = null; }
      continue;
    }
    if (open) body.push(lines[i]);
  }
  return out;
}
const BLOCKS = scanBlocks(md);
const HTML = BLOCKS.filter((b) => b.info === "html");
const cssSource = BLOCKS.filter((b) => b.info === "css").map((b) => b.code).join("\n");

function sectionBlocks(heading) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  expect(start, heading).toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break; }
  }
  return BLOCKS.filter((b) => b.line > start && b.line < end);
}
const themeJs = () =>
  sectionBlocks("## Theme Toggle").filter((b) => /^(javascript|js)$/.test(b.info)).map((b) => b.code).join("\n");

/** The `<aside … id="decision-panel">…</aside>` slice of a skeleton, or null. */
function asideOf(code) {
  const m = /<aside class="concept-decision-panel overlay" id="decision-panel">[\s\S]*?<\/aside>/.exec(code);
  return m ? m[0] : null;
}
/** Every `.concept-content > header` (the document header, not .iteration-intro). */
function documentHeaders(code) {
  return Array.from(code.matchAll(/<header>[\s\S]*?<\/header>/g)).map((m) => m[0]);
}

describe("the theme toggle lives in the ☰ panel head", () => {
  const skeletons = HTML.filter((b) => asideOf(b.code) && asideOf(b.code).includes('id="panel-close"'));

  test("both full skeletons carry it inside the aside, next to ✕, in a .panel-head row", () => {
    expect(skeletons.length, "skeletons with a full decision panel").toBeGreaterThanOrEqual(2);
    for (const s of skeletons) {
      const aside = asideOf(s.code);
      expect(aside, `#theme-toggle inside the aside @${s.line}`).toContain('id="theme-toggle"');
      // The head row is the aside's first element: the toggle sits LEFT of ✕
      // on the same line, so the ✕ keeps its top-right corner.
      const head = /<div class="panel-head">[\s\S]*?<\/div>/.exec(aside);
      expect(head, `.panel-head @${s.line}`).toBeTruthy();
      expect(head[0]).toContain('id="theme-toggle"');
      expect(head[0]).toContain('id="panel-close"');
      expect(head[0].indexOf('id="theme-toggle"')).toBeLessThan(head[0].indexOf('id="panel-close"'));
      const firstTag = /<aside[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*(<[a-z]+[^>]*>)/.exec(aside)[1];
      expect(firstTag, `first element of the aside @${s.line}`).toBe('<div class="panel-head">');
    }
  });

  test("no document header carries it any more — the content column is content", () => {
    for (const b of HTML) {
      for (const h of documentHeaders(b.code)) {
        expect(h, `header @${b.line}`).not.toContain("theme-toggle");
      }
      // …and nowhere else outside the aside either.
      const outside = b.code.replace(/<aside class="concept-decision-panel overlay" id="decision-panel">[\s\S]*?<\/aside>/g, "");
      expect(outside, `#theme-toggle outside the panel @${b.line}`).not.toContain('id="theme-toggle"');
    }
  });

  test("the button names the NEXT action from the locale table, like the FABs", () => {
    for (const s of skeletons) {
      const btn = /<button[^>]*id="theme-toggle"[^>]*>[\s\S]*?<\/button>/.exec(asideOf(s.code));
      expect(btn, `@${s.line}`).toBeTruthy();
      expect(btn[0]).toContain('data-label-light="{{theme.to_light}}"');
      expect(btn[0]).toContain('data-label-dark="{{theme.to_dark}}"');
      expect(btn[0]).toMatch(/type="button"/);
      // Two glyphs, one visible per theme (CSS), both hidden from AT — the
      // label is the accessible name.
      expect(btn[0]).toMatch(/data-glyph="sun"[^>]*aria-hidden="true"[^>]*>☀️</);
      expect(btn[0]).toMatch(/data-glyph="moon"[^>]*aria-hidden="true"[^>]*>🌙</);
    }
    for (const key of ["theme.to_light", "theme.to_dark"]) {
      const row = new RegExp("^\\| `" + key.replace(".", "\\.") + "`\\s*\\|([^|]+)\\|([^|]+)\\|", "m").exec(md);
      expect(row, `locale row ${key}`).toBeTruthy();
      expect(row[1].trim().length, `${key} en`).toBeGreaterThan(0);
      expect(row[2].trim().length, `${key} de`).toBeGreaterThan(0);
    }
  });

  test("the CSS shows the glyph for the theme you would switch TO, muted until hovered", () => {
    expect(cssSource).toMatch(/\.panel-head \{[^}]*display:\s*flex/);
    expect(cssSource).toMatch(/\.panel-head \{[^}]*justify-content:\s*flex-end/);
    expect(cssSource).toMatch(/html\[data-theme="dark"\] \.theme-toggle-btn \[data-glyph="sun"\]/);
    expect(cssSource).toMatch(/html:not\(\[data-theme="dark"\]\) \.theme-toggle-btn \[data-glyph="moon"\]/);
    expect(cssSource).toMatch(/\.theme-toggle-btn \.theme-glyph \{[^}]*display:\s*none/);
    // "dezent": grey and dimmed at rest, full colour on hover / keyboard focus.
    expect(cssSource).toMatch(/\.theme-toggle-btn \{[^}]*opacity:\s*0?\.\d/);
    expect(cssSource).toMatch(/\.theme-toggle-btn \{[^}]*filter:\s*grayscale/);
    expect(cssSource).toMatch(/\.theme-toggle-btn:hover,\s*\.theme-toggle-btn:focus-visible \{[^}]*opacity:\s*1/);
  });

  test("a click flips data-theme and the label follows — also when restoreState() writes the theme", () => {
    const skeleton = HTML.find((b) => b.code.startsWith("<!DOCTYPE html>"));
    const dom = new JSDOM(skeleton.code.replace(/\{\{([a-z_.]+)\}\}/g, "$1"), {
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    const { window } = dom;
    const { document } = window;
    const html = document.documentElement;
    expect(html.getAttribute("data-theme"), "dark by default").toBe("dark");

    // § State Persistence saves on `change`/`input` only; a click on a
    // <button> fires neither, so the toggle has to call saveState() itself
    // or the chosen theme is gone on the next reload (it was: the old header
    // toggle only persisted once the user happened to type somewhere).
    let saves = 0;
    window.saveState = () => { saves++; };
    window.eval(themeJs());
    if (document.readyState === "loading") document.dispatchEvent(new window.Event("DOMContentLoaded"));

    const btn = document.getElementById("theme-toggle");
    expect(btn, "#theme-toggle").toBeTruthy();
    expect(btn.getAttribute("title"), "dark → names the switch to light").toBe("theme.to_light");
    expect(btn.getAttribute("aria-label")).toBe("theme.to_light");
    expect(saves, "boot must not write state").toBe(0);

    btn.click();
    expect(html.getAttribute("data-theme")).toBe("light");
    expect(btn.getAttribute("title")).toBe("theme.to_dark");
    expect(btn.getAttribute("aria-label")).toBe("theme.to_dark");
    expect(saves, "the click persists the choice").toBe(1);

    btn.click();
    expect(html.getAttribute("data-theme")).toBe("dark");
    expect(btn.getAttribute("title")).toBe("theme.to_light");

    // restoreState() sets data-theme directly (§ State Persistence). The
    // label must follow that write too, not only the click.
    return new Promise((resolve) => {
      html.setAttribute("data-theme", "light");
      window.setTimeout(() => {
        expect(btn.getAttribute("title"), "label follows an external data-theme write").toBe("theme.to_dark");
        resolve();
      }, 0);
    });
  });

  test("the fixture builder emits it in both modes, in the panel only", () => {
    for (const mode of ["decision", "design"]) {
      const page = build({ mode, mapping: false, rounds: 2, entries: 3, locale: "de", designs: 1, out: "" });
      const doc = new JSDOM(page).window.document;
      const btn = doc.getElementById("theme-toggle");
      expect(btn, `${mode}: #theme-toggle`).toBeTruthy();
      expect(btn.closest("#decision-panel"), `${mode}: inside the panel`).toBeTruthy();
      expect(btn.closest(".panel-head"), `${mode}: in the head row`).toBeTruthy();
      expect(btn.getAttribute("data-label-light"), `${mode}: locale substituted`).not.toContain("{{");
      expect(doc.querySelectorAll("#theme-toggle").length, `${mode}: exactly one`).toBe(1);
      const header = doc.querySelector(".concept-content > header");
      if (header) expect(header.querySelector("#theme-toggle"), `${mode}: none in the header`).toBeNull();
      expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
    }
  });
});

describe("the reference says where the toggle lives and what the default is", () => {
  test("SKILL.md: default dark, toggle in the panel, header without it", () => {
    const header = skill.slice(skill.indexOf("### Page Header"), skill.indexOf("**DO NOT** render the iteration title"));
    expect(header).not.toMatch(/[Tt]heme toggle/);
    expect(skill).toMatch(/data-theme="dark"/);
    expect(skill).toMatch(/theme toggle[^\n]*☰ panel|☰ panel[^\n]*theme toggle/i);
  });

  test("templates.md no longer calls the header the toggle's only home", () => {
    expect(md).not.toMatch(/theme toggle lives only in that header/);
    // The Layout CSS comment that used to accept "no toggle in design mode"
    // now points at the panel head instead.
    const rule = md.slice(md.indexOf("Document chrome vs. the fullscreen canvas"), md.indexOf("Frozen design iterations stay FULLY opaque"));
    expect(rule).toMatch(/panel-head|☰ panel/);
    expect(rule).not.toMatch(/gone in\s+design mode — accepted/);
  });

  test("the gate row 46 describes the header as h1 + subtitle only", () => {
    const row = /\| 46 \|[^\n]*/.exec(gate);
    expect(row, "gate 46").toBeTruthy();
    expect(row[0]).not.toContain("#theme-toggle");
  });
});
