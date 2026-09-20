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

  test("ready-red offers Fix and Trotzdem shippen", () => {
    expect(buttonsFor("ready-red", "de").map((a) => a.label)).toEqual(["Fix", "Trotzdem shippen"]);
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
