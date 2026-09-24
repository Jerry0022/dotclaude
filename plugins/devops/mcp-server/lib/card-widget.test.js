import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import {
  isDesktopSession,
  buttonsFor,
  cardWidgetHtml,
  cardWidgetInstruction,
  writeCardWidgetFile,
  WIDGET_FILE_PREFIX,
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

  test("ready offers Ship (primary, plain 'ship') and Ändern, in both languages", () => {
    const de = buttonsFor("ready", "de");
    expect(de.map((a) => a.label)).toEqual(["Ship", "Ändern"]);
    expect(de[0]).toMatchObject({ prompt: "ship", primary: true });
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

  test("ship-compact: one plain-text button, ship --no-compact — never a slash prompt", () => {
    // Live 2026-09-23: the host refuses a prefill starting with "/" (leading
    // space too), so /compact stays text in the card; plain text lands.
    for (const lang of ["de", "en"]) {
      const btns = buttonsFor("ship-compact", lang);
      expect(btns).toHaveLength(1);
      expect(btns[0]).toMatchObject({ prompt: "ship --no-compact", primary: true });
      expect(btns[0].prompt).not.toMatch(/^\s*\//);
    }
    expect(buttonsFor("ship-compact", "de")[0].label).toBe("Ohne Kompaktieren shippen");
  });

  test("vv-unverified offers Tests laufen lassen and Trotzdem shippen", () => {
    expect(buttonsFor("vv-unverified", "de").map((a) => a.label)).toEqual(["Tests laufen lassen", "Trotzdem shippen"]);
  });

  // Live 2026-09-23: the Desktop host refuses a prefill that starts with "/"
  // (leading space too); plain text lands. A slash prompt is a dead button.
  test("no button prompt starts with a slash — in any key, in any language", () => {
    for (const lang of ["de", "en"]) {
      for (const key of Object.keys(BUTTONS[lang])) {
        for (const b of buttonsFor(key, lang)) {
          expect(b.prompt, `${lang}/${key}/${b.label}`).not.toMatch(/^\s*\//);
        }
      }
    }
  });

  // Since the skill restructure PR 2 a promotion is a do-ship run too:
  // prompt.ship.detect routes "promote" / "promote stable" to do-ship with the
  // promotion argument — so the promote buttons are promotion requests, not
  // plain ships, and the blocker's Debug button is neither.
  test("plain-text prompts still route: ship buttons ship, promote buttons promote, the others neither", () => {
    const { isShipIntent, parseShipRequest } = createRequire(import.meta.url)("../../hooks/lib/ship-intent.js");
    for (const lang of ["de", "en"]) {
      for (const key of ["ready", "test"]) {
        expect(parseShipRequest(buttonsFor(key, lang)[0].prompt)).toMatchObject({ ship: true, promote: false });
      }
      const v = { version: "0.193.0" };
      expect(parseShipRequest(buttonsFor("ship-successful", lang, v)[0].prompt)).toMatchObject({ ship: true, promote: true, channel: "beta", version: "0.193.0" });
      expect(parseShipRequest(buttonsFor("ship-successful", lang, v)[1].prompt)).toMatchObject({ ship: true, promote: true, channel: "stable", version: "0.193.0" });
      expect(parseShipRequest(buttonsFor("released-beta", lang, v)[0].prompt)).toMatchObject({ ship: true, promote: true, channel: "stable", version: "0.193.0" });
      expect(isShipIntent(buttonsFor("ship-blocked", lang)[0].prompt), `${lang}/ship-blocked`).toBe(false);
      expect(buttonsFor("ship-successful", lang, v).map((b) => b.prompt)).toEqual(["promote beta 0.193.0", "promote stable 0.193.0"]);
      expect(buttonsFor("released-beta", lang, v)[0].prompt).toBe("promote stable 0.193.0");
      expect(buttonsFor("ship-blocked", lang)[0].prompt).toMatch(/^Debug\b/);
    }
  });

  // Red-team R2(b): a stale click on an old card must never ship edits made
  // after it — the promote button names its version (promotion-only in
  // prompt.ship.detect), and without a known version there is no button.
  test("promote buttons carry the card's version; without one they are dropped", () => {
    for (const lang of ["de", "en"]) {
      expect(buttonsFor("ship-successful", lang, { version: "v0.193.0" })[0].prompt).toBe("promote beta 0.193.0");
      expect(buttonsFor("ship-successful", lang)).toEqual([]);
      expect(buttonsFor("released-beta", lang, { version: "not-a-version" })).toEqual([]);
      // non-promote buttons are untouched by the version
      expect(buttonsFor("ready", lang, { version: "0.193.0" })[0].prompt).toBe("ship");
    }
  });

  // After an alpha ship both promotions are offered — beta as the main verb,
  // stable as the fast track. On beta only the stable step is left.
  test("ship-successful offers Promote beta (primary) and Promote stable; released-beta only Promote stable", () => {
    for (const lang of ["de", "en"]) {
      const shipped = buttonsFor("ship-successful", lang, { version: "0.193.0" });
      expect(shipped.map((b) => b.label)).toEqual(["Promote beta", "Promote stable"]);
      expect(shipped.map((b) => !!b.primary)).toEqual([true, false]);
      const onBeta = buttonsFor("released-beta", lang, { version: "0.193.0" });
      expect(onBeta.map((b) => b.label)).toEqual(["Promote stable"]);
      expect(onBeta[0].primary).toBe(true);
    }
  });

  test("the widget HTML puts the versioned prompt on the promote button", () => {
    const html = cardWidgetHtml({ lang: "de", heading: "x", buttonsKey: "released-beta", promoteVersion: "0.193.0" }, "");
    expect(html).toContain('data-prompt="promote stable 0.193.0"');
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
  // The visualize host opens any http(s) <a href> itself (ui/open-link), so a
  // generated URL must be an anchor — the concept page URL was plain text.
  test("URLs in the context line, points and result lines are clickable links", () => {
    const html = cardWidgetHtml(baseModel({
      context: "› http://localhost:8721/docs/concepts/plan.html",
      points: ["Siehe https://github.com/o/r/pull/7."],
      resultLines: ["Seite <b> auf https://example.com/a?x=1&y=2"],
    }), "");
    expect(html).toContain('<a href="http://localhost:8721/docs/concepts/plan.html" class="card-link"');
    expect(html).toContain('<a href="https://github.com/o/r/pull/7" class="card-link"');
    expect(html).toMatch(/pull\/7<\/a>\./);
    expect(html).toContain('href="https://example.com/a?x=1&amp;y=2"');
    expect(html).toContain("Seite &lt;b&gt; auf");
  });

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
    expect(html).toContain("method: 'ui/message'");
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
    expect(html.match(/<div class="card-point" style="([^"]*)"/)[1]).toContain("font-size:14px");
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

  // 2026-09-21 feedback: the › glyph was too faint and the text after it too
  // loud; the CTA points should speak the same › language, and every › line
  // should sit a little inset from the heading edge.
  test("every › line shows a lilac glyph, secondary text, a 6px inset — and the points are › lines, not numbers", () => {
    const html = cardWidgetHtml(baseModel({ context: "› alpha liegt 1 Version vor stable", points: ["Noch offen: Doku", "Nach dem Deploy testen"] }), "");
    expect(html).not.toContain("<ol");
    for (const cls of ["card-result", "card-context", "card-point"]) {
      const m = html.match(new RegExp(`<div class="${cls}" style="([^"]*)"><span style="([^"]*)">›</span>`));
      expect(m, cls).not.toBeNull();
      expect(m[1]).toContain("padding-left:6px");
      expect(m[1]).toContain("gap:4px");
      expect(m[2]).toContain("width:8px");
      expect(m[1]).toContain("color:var(--text-secondary)");
      expect(m[2]).toContain("color:#aab4e6");
      expect(m[2]).toContain("font-weight:500");
    }
    expect(html.match(/<div class="card-point"/g)).toHaveLength(2);
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

  test("the budget row and the pipeline line have room above and below", () => {
    const html = cardWidgetHtml(baseModel({
      budget: { omitted: false, warn: false, contextHealth: "", bars: [
        { label: "5h", pct: 40, elapsedPct: 40, level: "white", watermark: "3 h", tooltip: "t" },
      ] },
    }), "");
    expect(html.match(/<div class="card-budget-row" style="([^"]*)"/)[1]).toContain("padding:4px 0 2px");
    expect(html.match(/<div class="card-pipeline" style="([^"]*)"/)[1]).toContain("padding:4px 0");
    // Order in block 1: result lines → evidence → pipeline → budget (footer).
    expect(html.indexOf("card-evidence")).toBeLessThan(html.indexOf("card-pipeline"));
    expect(html.indexOf("card-pipeline")).toBeLessThan(html.indexOf("card-budget-row"));
    expect(html.indexOf("card-budget-row")).toBeLessThan(html.indexOf("card-box"));
  });

  test("the budget sweep is clipped to the elapsed fill — never over time that has not passed", () => {
    const html = cardWidgetHtml(baseModel({
      budget: { omitted: false, warn: false, contextHealth: "", bars: [
        { label: "5h", pct: 40, elapsedPct: 40, level: "white", watermark: "3 h", tooltip: "t" },
      ] },
    }), "");
    const sheen = html.match(/<span class="card-sheen" style="([^"]*)"/)[1];
    expect(sheen).toContain("width:40%");
    expect(sheen).toContain("background:#4a5384");
    expect(sheen).toContain("overflow:hidden");
    expect(html.match(/class="card-sheen"/g)).toHaveLength(1); // the fill alone carries the sweep
    expect(html).toContain("width:24px;background:rgba(255,255,255,.12)");
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

  test("names the widget tool, the last-action rule, the visible-title fallback, and carries the HTML verbatim", () => {
    const model = baseModel({ title: "Fertig" });
    const text = cardWidgetInstruction(model, "", desktop);
    expect(text.startsWith("[CARD WIDGET — DO NOT OUTPUT THIS BLOCK]")).toBe(true);
    expect(text).toContain("mcp__visualize__show_widget");
    // The widget is the whole card: last action, no markdown after it (#443, #470).
    expect(text).toMatch(/as the LAST action of the turn/);
    expect(text).toMatch(/there is no card markdown to output/);
    expect(text).toMatch(/Output NO text after the call/);
    // A failed widget call must not leave the turn with nothing visible.
    expect(text).toMatch(/no retry, no note/);
    expect(text).toMatch(/output the visible title line/);
    expect(text).toContain(`### **✨✨✨ ${model.title} ✨✨✨**`);
    expect(text).not.toMatch(/skip silently/);
    const html = cardWidgetHtml(model, "");
    expect(text).toContain("----- widget_code -----\n" + html + "\n----- end widget_code -----");
  });

  test("the fallback line reads as the error path, never a shortcut (#451)", () => {
    const text = cardWidgetInstruction(baseModel(), "", desktop);
    expect(text).toMatch(/mandatory, never optional/);
    expect(text).toMatch(/never grep, filter or skip the HTML/);
    expect(text).toMatch(/ONLY when the call itself fails, or the tool does not exist/);
    expect(text).toMatch(/never a shortcut/);
  });

  test("forbids a prose recap of the card before the widget, keeps room for side questions", () => {
    const text = cardWidgetInstruction(baseModel(), "", desktop);
    expect(text).toMatch(/No prose before the widget that restates the card/);
    expect(text).toMatch(/only answers to side questions or other topics of the user's prompt/);
  });

  test("names the saved widget file when one was written, and only then", () => {
    const withFile = cardWidgetInstruction(baseModel(), "", desktop, { widgetFile: "C:/tmp/dotclaude-devops-card-widget-s1" });
    expect(withFile).toContain("The same HTML is saved in C:/tmp/dotclaude-devops-card-widget-s1");
    expect(cardWidgetInstruction(baseModel(), "", desktop)).not.toContain("The same HTML is saved");
  });
});

describe("writeCardWidgetFile (#451)", () => {
  const dirs = [];
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), "card-widget-")); dirs.push(d); return d; };
  afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

  test("Desktop: writes the widget HTML per session and returns a forward-slash path", () => {
    const dir = tmp();
    const model = baseModel();
    const file = writeCardWidgetFile(model, "", "s-42", dir, desktop);
    expect(file).toBe(join(dir, `${WIDGET_FILE_PREFIX}-s-42`).replace(/\\/g, "/"));
    expect(readFileSync(file, "utf8")).toBe(cardWidgetHtml(model, ""));
  });

  test("nothing written outside Desktop, for test-minimal, or without a model", () => {
    const dir = tmp();
    expect(writeCardWidgetFile(baseModel(), "", "s", dir, terminal)).toBe("");
    expect(writeCardWidgetFile(baseModel({ variant: "test-minimal" }), "", "s", dir, desktop)).toBe("");
    expect(writeCardWidgetFile(null, "", "s", dir, desktop)).toBe("");
    expect(existsSync(join(dir, `${WIDGET_FILE_PREFIX}-s`))).toBe(false);
  });

  test("a failed write returns '' instead of throwing", () => {
    expect(writeCardWidgetFile(baseModel(), "", "s", join(tmp(), "missing", "dir"), desktop)).toBe("");
  });
});
