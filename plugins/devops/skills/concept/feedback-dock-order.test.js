import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Feedback dock reorder: specific -> general, top to bottom. Today's shape
// is screen -> design -> view -> general (design/screen and view are
// mutually exclusive rows, § Layout CSS view-mode swap, so the visible
// order is always "the specific row(s) that happen to be shown" followed
// by general last). General used to sit first; it moved to the end because
// it is the one field that never disappears or changes label, so its fixed
// bottom position never jumps while the rows above it swap content.
//
// This also pins the compact-fit rule: at a ~1080px-tall viewport the
// compact dock must show screen + design + general without scrolling or
// the maximise control, which requires both a taller max-height ceiling
// and trimmed section/textarea spacing (§ Layout CSS `.feedback-dock`,
// `.feedback-section`, `.feedback-section textarea`).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK = path.join(__dirname, "deep-knowledge");
const md = fs.readFileSync(path.join(DK, "templates.md"), "utf8");

function fencedBlock(src, startMarker, lang) {
  const lines = src.split("\n");
  const startIdx = lines.findIndex((l) => l.includes(startMarker));
  expect(startIdx, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
  // Walk backwards to the nearest opening fence of the requested language,
  // then forwards to its matching close — the marker sits INSIDE the block,
  // not necessarily on the fence line itself.
  let openIdx = -1;
  for (let i = startIdx; i >= 0; i--) {
    if (new RegExp("^```" + lang + "\\s*$").test(lines[i])) { openIdx = i; break; }
  }
  expect(openIdx, `no opening \`\`\`${lang} fence before marker`).toBeGreaterThanOrEqual(0);
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (/^```\s*$/.test(lines[i])) { closeIdx = i; break; }
  }
  expect(closeIdx, "no closing fence").toBeGreaterThan(openIdx);
  return lines.slice(openIdx + 1, closeIdx).join("\n");
}

describe("feedback dock — section order (specific -> general)", () => {
  const html = fencedBlock(md, 'id="feedback-dock"', "html");

  function idx(needle) {
    const i = html.indexOf(needle);
    expect(i, `not found in dock skeleton: ${needle}`).toBeGreaterThanOrEqual(0);
    return i;
  }

  test("screen row precedes the design row", () => {
    expect(idx('id="screen-textareas"')).toBeLessThan(idx('id="design-textareas"'));
  });

  test("design row precedes the view row", () => {
    expect(idx('id="design-textareas"')).toBeLessThan(idx('id="view-textareas"'));
  });

  test("view row precedes the general textarea", () => {
    expect(idx('id="view-textareas"')).toBeLessThan(idx('id="design-general-feedback"'));
  });

  test("general is the last child of the dock (no row follows it)", () => {
    const generalIdx = idx('id="design-general-feedback"');
    // Nothing with a dock-row id appears after general.
    for (const other of ['id="screen-textareas"', 'id="design-textareas"', 'id="view-textareas"']) {
      expect(html.indexOf(other)).toBeLessThan(generalIdx);
    }
    // The dock closes shortly after general's section — no trailing
    // .feedback-section between it and </aside>.
    const tail = html.slice(generalIdx);
    const nextSection = tail.indexOf('class="feedback-section"', 'class="feedback-section"'.length);
    const closeAside = tail.indexOf("</aside>");
    expect(closeAside).toBeGreaterThan(0);
    if (nextSection >= 0) expect(nextSection).toBeGreaterThan(closeAside);
  });

  test("data-comment / data-attachable / slot-key identity is unchanged by the reorder", () => {
    expect(html).toMatch(/data-comment="general"/);
    expect(html).toMatch(/id="design-general-feedback"/);
    expect(html).toMatch(/data-attach-slot="general"/);
  });
});

describe("feedback dock — compact-fit at a ~1080px-tall viewport", () => {
  const css = fencedBlock(md, ".feedback-dock {", "css");

  // selectorRe must match through the opening `{` itself (e.g.
  // /\.feedback-dock \{/) — only the body capture + closing brace are
  // added here.
  function ruleBody(selectorRe) {
    const flags = selectorRe.flags.includes("s") ? selectorRe.flags : selectorRe.flags + "s";
    const re = new RegExp(selectorRe.source + "([^}]*)\\}", flags);
    const m = re.exec(css);
    expect(m, `rule not found: ${selectorRe}`).toBeTruthy();
    return m[1];
  }

  test("compact max-height clears three stacked sections without scrolling", () => {
    const body = ruleBody(/\.feedback-dock \{/);
    const m = /max-height:\s*min\(\s*(\d+)vh\s*,\s*(\d+)px\s*\)/.exec(body);
    expect(m, "max-height: min(<vh>vh, <px>px)").toBeTruthy();
    const [, vh, px] = m.map(Number);
    // At 1080px viewport height, the vh term must not be the binding
    // constraint below a generous pixel ceiling — otherwise a tall window
    // still gets clamped back to the old cramped box.
    const atViewport = Math.min((vh / 100) * 1080, px);
    expect(atViewport).toBeGreaterThanOrEqual(700);
  });

  test("wide max-height is at least as generous as compact", () => {
    const compact = ruleBody(/\.feedback-dock \{/);
    const wide = ruleBody(/\.feedback-dock\[data-size="wide"\] \{/);
    const cM = /max-height:\s*min\(\s*(\d+)vh\s*,\s*(\d+)px\s*\)/.exec(compact);
    const wM = /max-height:\s*min\(\s*(\d+)vh\s*,\s*(\d+)px\s*\)/.exec(wide);
    expect(Number(wM[2])).toBeGreaterThanOrEqual(Number(cM[2]));
  });

  test("the two fixed widths (420 / 560) are untouched", () => {
    expect(ruleBody(/\.feedback-dock \{/)).toMatch(/width:\s*min\(420px,/);
    expect(ruleBody(/\.feedback-dock\[data-size="wide"\] \{/)).toMatch(/width:\s*min\(560px,/);
  });

  test("textarea min-height still allows 2-3 visible lines", () => {
    const body = ruleBody(/^\.feedback-section textarea \{/m);
    const m = /min-height:\s*(\d+)px/.exec(body);
    expect(m, "min-height: <px>px").toBeTruthy();
    const minHeight = Number(m[1]);
    expect(minHeight).toBeGreaterThanOrEqual(64);
    expect(minHeight).toBeLessThanOrEqual(90);
  });

  test("section + dock gaps were trimmed to make room, not left at the old values", () => {
    const dockBody = ruleBody(/\.feedback-dock \{/);
    const gapM = /gap:\s*([\d.]+)rem/.exec(dockBody);
    expect(gapM, "gap: <n>rem on .feedback-dock").toBeTruthy();
    expect(Number(gapM[1])).toBeLessThanOrEqual(1.1);
  });
});

describe("feedback dock — attach bar alignment", () => {
  const css = fencedBlock(md, ".feedback-dock {", "css");

  test("the attach bar's margin-top is zeroed inside the dock to avoid double-gapping", () => {
    expect(css).toMatch(/\.feedback-dock \.attach-bar\s*\{[^}]*margin-top:\s*0/s);
  });
});
