import { describe, test, expect, vi, beforeAll } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Compact ship card (100-card analysis, 2026-09-13): character budgets on every
// body field, one "Belegt" block for gates + validation, an OFFEN block for
// non-test follow-ups, and a single bottom Delivery block that absorbs the 📌
// footer and the state line — so a ship card fits one screen instead of three.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
vi.setConfig({ testTimeout: 30_000 });

const captured = vi.hoisted(() => ({ handlers: {} }));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(name, _cfg, handler) { captured.handlers[name] = handler; }
    async connect() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  const z = new Proxy({}, { get: () => () => node });
  return { z };
});

let render;
beforeAll(async () => {
  await import("./index.js");
  render = captured.handlers["render_completion_card"];
  await render({ variant: "analysis", summary: "warmup", lang: "en", session_id: "compact-warmup" });
}, 60_000);

async function cardText(params) {
  const res = await render(params);
  return res.content.map((c) => c.text).join("\n");
}

const SHIP = {
  variant: "ship-successful", lang: "de", buildId: "51f918d", session_id: "compact-ship",
  summary: "Concept- und Batch-Modus im Session-Titel",
  state: { branch: "main", pushed: true, merged: "main", commit: "1ba280f" },
  cta: { vOld: "0.153.0", vNew: "0.154.0", bump: "minor" },
  delivery: {
    pr: { number: 366, title: "feat(concept,batch): session title prefix + mode-aware completion card" },
    ship: { version: "0.154.0", base: "main" },
    promote: { channels: { alpha: "0.154.0" }, current: "alpha" },
  },
};

describe("compact card — character budgets", () => {
  test("summary is clamped to 60 characters on a word boundary", async () => {
    const long = "Forensik durch: eine falsche Standing-Correction zurückgezogen, die Bilanz-Aussage widerrufen und mehr";
    const text = await cardText({ variant: "analysis", summary: long, lang: "de", session_id: "compact-sum" });
    const title = text.match(/^### \*\*✨✨✨ (.*) ✨✨✨\*\*$/m)[1];
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toBe("Forensik durch: eine falsche Standing-Correction");
  });

  test("changes: area ≤ 24 and description ≤ 90 characters, cut with an ellipsis", async () => {
    const text = await cardText({
      variant: "ready", summary: "Budgets", lang: "de", session_id: "compact-chg",
      changes: [{
        area: "Feedback-Panel Composer Anhänge-Zeile",
        description: "Anhänge- und Senden-Button haben jetzt überall dieselbe Höhe (38px), auch bei Rückfragen — vorher war der Senden-Button bei Rückfragen der kurze",
      }],
    });
    const line = text.split("\n").find((l) => l.startsWith("> * Feedback-Panel"));
    const [area, desc] = line.replace(/^> \* /, "").split(" → ");
    expect(area.length).toBeLessThanOrEqual(25);
    expect(area.endsWith("…")).toBe(true);
    expect(desc.length).toBeLessThanOrEqual(91);
    expect(desc.endsWith("…")).toBe(true);
    // cut on a word boundary: what is shown is a prefix ending where a separator followed
    const orig = "Anhänge- und Senden-Button haben jetzt überall dieselbe Höhe (38px), auch bei Rückfragen — vorher war der Senden-Button bei Rückfragen der kurze";
    const kept = desc.slice(0, -1);
    expect(orig.startsWith(kept)).toBe(true);
    expect(orig.charAt(kept.length)).toMatch(/[\s,;:\-–—]/);
  });

  test("more than three changes: three bullets plus an explicit +N tail", async () => {
    const changes = [1, 2, 3, 4, 5].map((i) => ({ area: "A" + i, description: "d" + i }));
    const de = await cardText({ variant: "ready", summary: "Tail", lang: "de", session_id: "compact-tail", changes });
    expect(de).toMatch(/^> \* A3 → d3$/m);
    expect(de).not.toMatch(/A4 → d4/);
    expect(de).toMatch(/^> \* \+2 weitere$/m);
    const en = await cardText({ variant: "ready", summary: "Tail", lang: "en", session_id: "compact-tail-en", changes });
    expect(en).toMatch(/^> \* \+2 more$/m);
  });
});

describe("compact card — Belegt block (gates + validation)", () => {
  const tests = [
    { method: "npm test", result: "1460 grün" },
    { method: "eslint", result: "sauber" },
    { method: "Codex-Review", result: "übersprungen — Limit" },
  ];

  test("tests collapse to one header line; no separate Tests or Validierung headers", async () => {
    const text = await cardText({
      variant: "ready", summary: "Belegt", lang: "de", session_id: "compact-belegt", tests,
      validation: [{ requirement: "Modus in der Sidebar sichtbar", status: "met", evidence: "set_session_title live geprüft" }],
    });
    expect(text).toMatch(/^> \*\*Belegt\*\* · npm test → 1460 grün · eslint → sauber · Codex-Review → übersprungen — Limit$/m);
    expect(text).toMatch(/^> \* ✅ Modus in der Sidebar sichtbar — set_session_title live geprüft$/m);
    expect(text).not.toMatch(/\*\*Tests\*\*/);
    expect(text).not.toMatch(/\*\*Validierung\*\*/);
  });

  test("English header reads Verified", async () => {
    const text = await cardText({ variant: "ready", summary: "Verified", lang: "en", session_id: "compact-belegt-en", tests });
    expect(text).toMatch(/^> \*\*Verified\*\* · npm test → 1460 grün/m);
  });

  test("an over-long gates line falls back to one bullet per test", async () => {
    const text = await cardText({
      variant: "ready", summary: "Overflow", lang: "de", session_id: "compact-overflow",
      tests: [
        { method: "npm run typecheck + Production-Build + npm test", result: "GATE_EXIT=0 · 2589 SUCCESS auf dem gemergten Stand" },
        { method: "Baseline auf main (Gegenprobe)", result: "2584 SUCCESS — beide Fehler gehörten zur geretteten Arbeit" },
      ],
    });
    expect(text).toMatch(/^> \*\*Belegt\*\*$/m);
    expect(text).toMatch(/^> \* npm run typecheck \+ Production-Build \+ npm test → GATE_EXIT=0 · 2589 SUCCESS auf dem gemergten Stand$/m);
  });

  test("validation: partial/unmet first, budgets on requirement and evidence, met overflow collapsed", async () => {
    const long = "x".repeat(60) + " " + "y".repeat(60);
    const validation = [
      { requirement: "erfüllt 1", status: "met", evidence: "e1" },
      { requirement: "erfüllt 2", status: "met", evidence: "e2" },
      { requirement: "teilweise " + long, status: "partial", evidence: "Beleg " + long },
      { requirement: "erfüllt 3", status: "met", evidence: "e3" },
      { requirement: "erfüllt 4", status: "met", evidence: "e4" },
      { requirement: "erfüllt 5", status: "met", evidence: "e5" },
    ];
    const text = await cardText({ variant: "ready", summary: "V", lang: "de", session_id: "compact-val", validation });
    const bullets = text.split("\n").filter((l) => /^> \* (✅|⚠️|❌)/.test(l));
    expect(bullets[0]).toMatch(/^> \* ⚠️ teilweise /);
    const [req, ev] = bullets[0].replace(/^> \* ⚠️ /, "").split(" — ");
    expect(req.length).toBeLessThanOrEqual(71);
    expect(ev.length).toBeLessThanOrEqual(101);
    expect(bullets[1]).toBe("> * ✅ erfüllt 1 — e1");
    expect(bullets[2]).toBe("> * ✅ erfüllt 2 — e2");
    expect(bullets[3]).toBe("> * ✅ 3 weitere Anforderungen erfüllt");
    expect(bullets.length).toBe(4);
  });

  test("a single leftover met item is shown, not collapsed", async () => {
    const validation = [1, 2, 3, 4].map((i) => ({ requirement: "r" + i, status: "met", evidence: "e" + i }));
    const text = await cardText({ variant: "ready", summary: "V4", lang: "de", session_id: "compact-val4", validation });
    expect(text).toMatch(/^> \* ✅ r4 — e4$/m);
    expect(text).not.toMatch(/weitere Anforderungen/);
  });
});

describe("compact card — OFFEN block", () => {
  test("open items render in their own ⚠ OFFEN block after the 🔬 test block, not as tests", async () => {
    const text = await cardText({
      ...SHIP, session_id: "compact-open",
      userFinalTest: ["Claude neu starten, dann /claude-batch on prüfen"],
      open: ["feat/harden-round-1 im Hauptrepo — entscheiden: committen oder verwerfen"],
    });
    expect(text).toMatch(/^⚠ \*\*OFFEN:\*\*\n\* feat\/harden-round-1 im Hauptrepo — entscheiden: committen oder verwerfen$/m);
    expect(text.indexOf("⚠ **OFFEN:**")).toBeGreaterThan(text.indexOf("🔬 **TESTE"));
  });

  test("English header reads OPEN", async () => {
    const text = await cardText({ ...SHIP, lang: "en", session_id: "compact-open-en", open: ["decide on the stale branch"] });
    expect(text).toMatch(/^⚠ \*\*OPEN:\*\*\n\* decide on the stale branch$/m);
  });
});

describe("compact card — bottom Delivery block replaces footer + state line", () => {
  test("PR line, ship line with bump + commit + build-id, horizontal channel ladder", async () => {
    const text = await cardText(SHIP);
    expect(text).toMatch(/^> \*\*Delivery\*\* ✅ PR \[#366\]\(https:\/\/github\.com\/[^)]+\/pull\/366\) · feat\(concept,batch\): session title prefix \+ mode-aware completion card$/m);
    expect(text).toMatch(/^> ✅ `main` 0\.153\.0 → 0\.154\.0 \(minor\) · \[1ba280f\]\(https:\/\/github\.com\/[^)]+\/commit\/1ba280f\) · `51f918d`$/m);
    expect(text).toMatch(/^> 🟢 alpha `v0\.154\.0` · ⚪ beta · ⚪ stable$/m);
    // The old vertical ladder, 📌 footer and "updated origin" state line are gone.
    expect(text).not.toMatch(/← hier/);
    expect(text).not.toMatch(/^> 📌/m);
    expect(text).not.toMatch(/updated \[origin\/main\]/);
    expect(text).not.toMatch(/◐ Promote/);
  });

  test("sits after the body and before the CTA separator", async () => {
    const text = await cardText({ ...SHIP, session_id: "compact-order", changes: [{ area: "A", description: "d" }] });
    const iChanges = text.indexOf("**Changes**");
    const iDelivery = text.indexOf("**Delivery**");
    const iCta = text.indexOf("## 🚀 SHIPPED");
    expect(iDelivery).toBeGreaterThan(iChanges);
    expect(iDelivery).toBeLessThan(iCta);
  });

  test("a PR title is cut to 70 characters", async () => {
    const title = "feat(codex): power dock — fixed order, pips fill upward, click sets the level and more words here";
    const text = await cardText({ ...SHIP, session_id: "compact-prtitle", delivery: { ...SHIP.delivery, pr: { number: 580, title } } });
    const line = text.split("\n").find((l) => l.startsWith("> **Delivery**"));
    const shown = line.split(") · ")[1];
    expect(shown.length).toBeLessThanOrEqual(71);
    expect(shown.endsWith("…")).toBe(true);
  });

  test("a non-semver ship version renders without a v prefix", async () => {
    const text = await cardText({
      ...SHIP, session_id: "compact-sha", cta: {},
      delivery: { ...SHIP.delivery, ship: { version: "b43bf60", base: "main" }, promote: null },
    });
    expect(text).toMatch(/^> ✅ `main` `b43bf60` · \[1ba280f\]/m);
    expect(text).not.toMatch(/vb43bf60/);
  });

  test("no promote stage → no ladder line and no hollow ⚪ Promote", async () => {
    const text = await cardText({ ...SHIP, session_id: "compact-nopromote", delivery: { ...SHIP.delivery, promote: null } });
    expect(text).not.toMatch(/Promote/);
    expect(text).not.toMatch(/alpha/);
  });

  test("passed and skipped channels keep their icons on the horizontal ladder", async () => {
    const text = await cardText({
      ...SHIP, session_id: "compact-ladder",
      delivery: { ...SHIP.delivery, promote: { channels: { alpha: "0.82.7", beta: "0.82.0", stable: "0.82.0" }, current: "alpha" } },
    });
    expect(text).toMatch(/^> 🟢 alpha `v0\.82\.7` · ✅ beta `v0\.82\.0` · ✅ stable `v0\.82\.0`$/m);
  });

  test("stableLag appends the promote nudge to the ladder line", async () => {
    const text = await cardText({
      ...SHIP, session_id: "compact-lag",
      delivery: { ...SHIP.delivery, promote: { ...SHIP.delivery.promote, stableLag: { versions: 8, days: 7 } } },
    });
    expect(text).toMatch(/^> 🟢 alpha `v0\.154\.0` · ⚪ beta · ⚪ stable · alpha 8 Versionen \/ 7 Tage vor stable → `\/promote`$/m);
    const en = await cardText({
      ...SHIP, lang: "en", session_id: "compact-lag-en",
      delivery: { ...SHIP.delivery, promote: { ...SHIP.delivery.promote, stableLag: { versions: 1 } } },
    });
    expect(en).toMatch(/· alpha 1 version ahead of stable → `\/promote`$/m);
  });

  test("kept branch is named on the ship line", async () => {
    const text = await cardText({ ...SHIP, session_id: "compact-kept", state: { ...SHIP.state, branch: "feat/x", kept: true } });
    expect(text).toMatch(/^> ✅ `main` 0\.153\.0 → 0\.154\.0 \(minor\) · \[1ba280f\]\([^)]+\) · `51f918d` · `feat\/x \(kept locally\)`$/m);
  });

  test("ready with delivery: ⚪ Ship line carries branch, commit and build-id", async () => {
    const text = await cardText({
      variant: "ready", summary: "Bereit", lang: "de", buildId: "abc1234", session_id: "compact-ready",
      state: { branch: "feat/video-filter", commit: "abc1234", pr: { number: 123, title: "video filter" } },
      delivery: { pr: { number: 123, title: "video filter" }, ship: null, promote: null },
    });
    expect(text).toMatch(/^> \*\*Delivery\*\* ✅ PR \[#123\]\([^)]+\) · video filter$/m);
    expect(text).toMatch(/^> ⚪ Ship · \[`feat\/video-filter`\]\([^)]+\) · \[abc1234\]\([^)]+\) · `abc1234`$/m);
    expect(text).not.toMatch(/Promote/);
  });

  test("without a delivery track the 📌 footer and state line still render", async () => {
    const text = await cardText({ variant: "analysis", summary: "Nur Analyse", lang: "de", buildId: "ad86c42", session_id: "compact-analysis" });
    expect(text).toMatch(/^> 📌 `ad86c42`$/m);
    expect(text).toMatch(/^> ➖ No changes to repo$/m);
  });
});

describe("compact card — CTA without the merge-target echo", () => {
  test("ring project: SHIPPED → alpha — Alles ERLEDIGT", async () => {
    const text = await cardText(SHIP);
    expect(text).toMatch(/^## 🚀 SHIPPED → alpha — Alles ERLEDIGT$/m);
    expect(text).not.toMatch(/merged → origin/);
  });

  test("plain project: SHIPPED → main", async () => {
    const text = await cardText({ ...SHIP, session_id: "compact-cta-main", delivery: { ...SHIP.delivery, promote: null } });
    expect(text).toMatch(/^## 🚀 SHIPPED → main — Alles ERLEDIGT$/m);
  });

  test("kept: SHIPPED → alpha — WEITER in branch", async () => {
    const text = await cardText({ ...SHIP, session_id: "compact-cta-kept", state: { ...SHIP.state, branch: "feat/x", kept: true } });
    expect(text).toMatch(/^## 🚀 SHIPPED → alpha — WEITER in `feat\/x`$/m);
  });

  test("English: SHIPPED → alpha — All DONE", async () => {
    const text = await cardText({ ...SHIP, lang: "en", session_id: "compact-cta-en" });
    expect(text).toMatch(/^## 🚀 SHIPPED → alpha — All DONE$/m);
  });
});

describe("compact card — context health thresholds", () => {
  const calls = (id, n) => writeFileSync(join(tmpdir(), "dotclaude-devops-toolcalls-" + id), String(n));

  test("561 calls: no health note", async () => {
    calls("compact-h1", 561);
    const text = await cardText({ variant: "analysis", summary: "H", lang: "de", session_id: "compact-h1" });
    expect(text).not.toMatch(/consider \//);
  });

  test("1001 calls: consider /compact; 2001 calls: consider /clear", async () => {
    calls("compact-h2", 1001);
    expect(await cardText({ variant: "analysis", summary: "H", lang: "de", session_id: "compact-h2" })).toMatch(/1001 calls · consider \/compact/);
    calls("compact-h3", 2001);
    expect(await cardText({ variant: "analysis", summary: "H", lang: "de", session_id: "compact-h3" })).toMatch(/2001 calls · consider \/clear/);
  });
});
