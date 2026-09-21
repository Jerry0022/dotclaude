import { describe, expect, test } from "vitest";
import {
  isDesktopSession,
  buttonsFor,
  cardWidgetHtml,
  cardWidgetInstruction,
  BUTTONS,
} from "./card-widget.js";

const desktop = { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" };
const terminal = { CLAUDE_CODE_ENTRYPOINT: "cli" };

const baseModel = (over = {}) => ({
  variant: "ready",
  lang: "de",
  key: "ready",
  resultLines: ["Card zeigt jetzt drei Zeilen statt Blöcke"],
  evidence: [{ glyph: "✓", text: "3/3 Anforderungen", dim: true }],
  budget: { omitted: true, bars: [], contextHealth: "" },
  pipeline: "○ commit → ○ push → ○ PR → ○ merge · feat/x · Build abc123",
  pipelinePr: null,
  heading: "📦 Shippen?",
  context: "",
  points: ["Noch offen: Doku"],
  buttonsKey: "ready",
  ...over,
});

describe("isDesktopSession", () => {
  test("only the Desktop entrypoint counts", () => {
    expect(isDesktopSession(desktop)).toBe(true);
    expect(isDesktopSession(terminal)).toBe(false);
    expect(isDesktopSession({})).toBe(false);
  });
});

describe("buttonsFor — § 3 table, Buttons column", () => {
  test("nothing for keys with nothing to decide", () => {
    for (const key of [null, "ready-files", "test-minimal", "released-stable", "fallback"]) {
      expect(buttonsFor(key, "de")).toEqual([]);
    }
  });

  test("ready offers Ship (primary, the slash command) and Ändern, in both languages", () => {
    const de = buttonsFor("ready", "de");
    expect(de.map((a) => a.label)).toEqual(["Ship", "Ändern"]);
    expect(de[0]).toMatchObject({ prompt: "/devops:ship", primary: true });
    const en = buttonsFor("ready", "en");
    expect(en.map((a) => a.label)).toEqual(["Ship", "Change"]);
  });

  test("ready-red offers Fix and Trotzdem shippen — worded for red findings, not only red tests", () => {
    const de = buttonsFor("ready-red", "de");
    expect(de.map((a) => a.label)).toEqual(["Fix", "Trotzdem shippen"]);
    // An unmet requirement routes to ready-red too; the prompt must not claim
    // there are red tests to repair.
    for (const b of [...de, ...buttonsFor("ready-red", "en")]) {
      expect(b.prompt).not.toMatch(/^(Repariere zuerst die roten Tests|Fix the red tests first)/);
      expect(b.prompt).toMatch(/Befunde|findings/);
    }
  });

  test("ship-blocked offers Fix and Skip", () => {
    expect(buttonsFor("ship-blocked", "de").map((a) => a.label)).toEqual(["Fix", "Skip"]);
  });

  test("ship-successful-kept offers a single Weiter button", () => {
    const btns = buttonsFor("ship-successful-kept", "de");
    expect(btns).toHaveLength(1);
    expect(btns[0].label).toBe("Weiter");
    expect(btns[0].primary).toBe(true);
  });

  test("vv-unverified offers Tests laufen lassen and Trotzdem shippen", () => {
    expect(buttonsFor("vv-unverified", "de").map((a) => a.label)).toEqual(["Tests laufen lassen", "Trotzdem shippen"]);
  });

  test("every button in every language carries a tooltip and a Tabler icon name", () => {
    for (const lang of ["de", "en"]) {
      for (const key of Object.keys(BUTTONS[lang])) {
        for (const b of buttonsFor(key, lang)) {
          expect(b.tooltip.length, `${lang}/${key}/${b.label}`).toBeGreaterThan(5);
          expect(b.icon).toMatch(/^[a-z0-9-]+$/);
        }
      }
    }
  });

  test("returns copies — callers cannot mutate the table", () => {
    buttonsFor("ready", "de")[0].label = "X";
    expect(buttonsFor("ready", "de")[0].label).toBe("Ship");
  });
});

describe("cardWidgetHtml", () => {
  test("draws both blocks: result lines + evidence + pipeline, heading + points + buttons", () => {
    const html = cardWidgetHtml(baseModel(), "");
    expect(html).toContain("Card zeigt jetzt drei Zeilen");
    expect(html).toContain("3/3 Anforderungen");
    expect(html).toContain("Build abc123");
    expect(html).toContain("Shippen?");
    expect(html).toContain("Noch offen: Doku");
    expect(html.match(/<span role="button" tabindex="0"/g)).toHaveLength(2);
    expect(html).not.toContain("<button");
    expect(html).toContain('class="ti ti-rocket"');
    expect(html).toContain("sendPrompt(b.getAttribute('data-prompt'))");
    expect(html.trim().endsWith("</script>")).toBe(true);
  });

  test("no buttons when buttonsKey is null (pending/concept/batch overrides)", () => {
    const html = cardWidgetHtml(baseModel({ buttonsKey: null, heading: "⏳ Noch nicht fertig — 1 Agent arbeitet", points: [] }), "");
    expect(html).not.toMatch(/<span role="button"/);
  });

  test("budget bars render with a usage marker and a watermark when not omitted", () => {
    const html = cardWidgetHtml(baseModel({
      budget: { omitted: false, warn: false, contextHealth: "", bars: [
        { label: "5h", pct: 62, elapsedPct: 9, level: "yellow", watermark: "3 h 39 m", tooltip: "62% verbraucht" },
      ] },
    }), "");
    expect(html).toContain("card-budget");
    expect(html).toContain("3 h 39 m");
    expect(html).toContain("62% verbraucht");
  });

  test("evidence posts carry a tooltip and colour by glyph", () => {
    const html = cardWidgetHtml(baseModel({
      evidence: [{ glyph: "✗", text: "1 Test rot", dim: false, tooltip: "npm test · 41s" }],
    }), "");
    expect(html).toContain("npm test · 41s");
    expect(html).toContain("#e0a0a0"); // red for a failed post
  });

  test("empty model yields no HTML", () => {
    expect(cardWidgetHtml(null, "")).toBe("");
  });

  // Observed 2026-09-21: widget + full markdown = the whole card twice. The
  // widget now carries the title (the markdown under it is the ✨ line only),
  // wraps long result lines instead of cutting them, and sits on a panel that
  // is visible in dark mode too.
  test("carries the title as an h3 (16px/500) at the top, before the result lines", () => {
    const html = cardWidgetHtml(baseModel({ title: "Sanduhr nur Fallback" }), "");
    expect(html).toContain('<h3 class="card-title" style="margin:0 0 4px;font-size:16px;font-weight:500">Sanduhr nur Fallback</h3>');
    expect(html.indexOf("card-title")).toBeLessThan(html.indexOf("card-result"));
    expect(html.indexOf("card-surface")).toBeLessThan(html.indexOf("card-title"));
    expect(cardWidgetHtml(baseModel({ title: "" }), "")).not.toContain("card-title");
  });

  // 2026-09-21 feedback: both titles too large, detail text one step too large,
  // and two bordered boxes did not read as ONE card. Now: one outer surface
  // (no border) around everything, the decision box a quiet tint at the
  // bottom, the status part with no box of its own.
  test("ONE outer surface wraps status and decision — a faint blue wash, no border, no grey surface token", () => {
    const html = cardWidgetHtml(baseModel({ title: "T" }), "");
    const surface = html.match(/<div class="card-surface" style="([^"]*)"/)[1];
    expect(surface).toContain("background:rgba(55,138,221,0.06)");
    expect(surface).not.toMatch(/border:|border-color/);
    expect(surface).not.toMatch(/--surface-/);
    expect(html.indexOf("card-surface")).toBeLessThan(html.indexOf("card-panel"));
    expect(html.indexOf("card-box")).toBeLessThan(html.lastIndexOf("</div>", html.indexOf("<script>")));
    // The status part has no box of its own — no background, no border.
    const panel = html.match(/<div class="card-panel" style="([^"]*)"/)[1];
    expect(panel).not.toMatch(/background|border/);
  });

  test("the decision box sits on a quiet accent wash at the bottom — no accent border", () => {
    const html = cardWidgetHtml(baseModel(), "");
    const box = html.match(/<div class="card-box" style="([^"]*)"/)[1];
    expect(box).toContain("background:var(--bg-accent-muted, rgba(55,138,221,0.10))");
    expect(box).not.toContain("border:");
    expect(html.indexOf("card-panel")).toBeLessThan(html.indexOf("card-box"));
  });

  test("detail text is one step below body size: result lines and points 14px, context 13px, buttons 13px", () => {
    const html = cardWidgetHtml(baseModel({ context: "› alpha liegt 1 Version vor stable" }), "");
    expect(html.match(/<div class="card-result" style="([^"]*)"/)[1]).toContain("font-size:14px");
    expect(html.match(/<ol class="card-points" style="([^"]*)"/)[1]).toContain("font-size:14px");
    expect(html.match(/<div class="card-context" style="([^"]*)"/)[1]).toContain("font-size:13px");
    expect(html.match(/<h3 class="card-heading" style="([^"]*)"/)[1]).toContain("font-size:16px");
    expect(html.match(/<span role="button" tabindex="0" id="card-act-0"[^>]*style="([^"]*)"/)[1]).toContain("font-size:13px");
    expect(html).not.toMatch(/<h2 class="card-/);
  });

  test("result lines are rendered whole — no ellipsis is added by the widget", () => {
    const long = "x".repeat(200);
    const html = cardWidgetHtml(baseModel({ resultLines: [long] }), "");
    expect(html).toContain(long);
    expect(html).not.toContain("…");
  });

  test("exactly four text sizes — 16 / 14 / 13 / 11 — and none below 11px", () => {
    const html = cardWidgetHtml(baseModel({
      title: "T",
      context: "› c",
      budget: { omitted: false, warn: false, contextHealth: "🧠 12 Calls", bars: [
        { label: "5h", pct: 40, elapsedPct: 40, level: "white", watermark: "3 h", tooltip: "t" },
      ] },
    }), "");
    const sizes = [...new Set((html.match(/font-size:(\d+)px/g) || []).map((m) => Number(m.slice(10, -2))))].sort((a, b) => a - b);
    expect(sizes).toEqual([11, 13, 14, 16]);
  });

  test("the budget sweep runs over the whole track, not inside the fill", () => {
    const html = cardWidgetHtml(baseModel({
      budget: { omitted: false, warn: false, contextHealth: "", bars: [
        { label: "5h", pct: 40, elapsedPct: 40, level: "white", watermark: "3 h", tooltip: "t" },
      ] },
    }), "");
    const sheen = html.match(/<span class="card-sheen" style="([^"]*)"/)[1];
    expect(sheen).toContain("right:0");
    expect(sheen).toContain("overflow:hidden");
    expect(sheen).not.toContain("width:40%");
    // The fill itself is a plain layer now — no clipping, no sweep.
    expect(html).toMatch(/width:40%;background:#4a5384;border-radius:5px"><\/span>/);
  });

  test("no emoji on the buttons — Tabler icons only, per the design contract", () => {
    const html = cardWidgetHtml(baseModel(), "");
    const buttonsBlock = html.slice(html.indexOf('<span role="button"'), html.indexOf("</script>"));
    expect(buttonsBlock).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("cardWidgetInstruction", () => {
  test("empty outside the Desktop app", () => {
    expect(cardWidgetInstruction(baseModel(), "", terminal)).toBe("");
    expect(cardWidgetInstruction(baseModel(), "", {})).toBe("");
  });

  test("empty for test-minimal, even on Desktop — the widget is never called", () => {
    expect(cardWidgetInstruction(baseModel({ variant: "test-minimal" }), "", desktop)).toBe("");
  });

  test("empty when there is no model", () => {
    expect(cardWidgetInstruction(null, "", desktop)).toBe("");
  });

  test("names the widget tool, the BEFORE-the-card order, the silent skip, and carries the HTML verbatim", () => {
    const model = baseModel();
    const text = cardWidgetInstruction(model, "", desktop);
    expect(text.startsWith("[CARD WIDGET — DO NOT OUTPUT THIS BLOCK]")).toBe(true);
    expect(text).toContain("mcp__visualize__show_widget");
    expect(text).toMatch(/BEFORE outputting the card markdown/);
    expect(text).toMatch(/never call it after the card/);
    expect(text).toMatch(/skip silently/);
    const html = cardWidgetHtml(model, "");
    expect(text).toContain("----- widget_code -----\n" + html + "\n----- end widget_code -----");
  });
});
