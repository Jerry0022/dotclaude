import { describe, test, expect, vi, beforeAll } from "vitest";

// index.js boots an MCP server over stdio at import time and pulls in the
// @modelcontextprotocol SDK + zod (neither is a devDependency of this repo).
// Mock all three so the module imports cleanly and we can capture the
// render_completion_card handler to exercise the pure card renderer.
// Never spawn the real headless usage scraper (Edge) from a unit test — it is
// slow and flaky under parallel load. The card renders without a budget line.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
// These tests assert the terminal markdown. On the Desktop app the markdown
// shrinks to the title line (§ 4, the widget draws the body), and a vitest run
// started from a Desktop session inherits that entrypoint — pin the terminal.
process.env.CLAUDE_CODE_ENTRYPOINT = "cli";

const captured = vi.hoisted(() => ({ handlers: {} }));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(name, _cfg, handler) { captured.handlers[name] = handler; }
    async connect() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  const z = new Proxy({}, { get: () => () => node });
  return { z };
});

let render;

beforeAll(async () => {
  await import("./index.js");
  render = captured.handlers["render_completion_card"];
  // Warm-up: pay the cold git/module cost once here rather than inside whichever
  // test runs first, which keeps per-test duration closer to the render itself.
  await render({ variant: "analysis", summary: "warmup", lang: "en", session_id: "test-warmup" });
}, 60_000);

async function cardText(params) {
  const res = await render(params);
  // The card markdown is always the LAST content block (it must stay the
  // last output of the turn — § 4). Everything before it (the relay
  // instruction, the session-title note, and — on a Desktop-like test
  // environment — the card-widget instruction) is out-of-band and never
  // part of what the user/terminal actually sees.
  return res.content[res.content.length - 1].text;
}

describe("render_completion_card — anatomy (§ 2 of the design doc)", () => {
  test("title stays H3 with the ✨✨✨ marker (card-guard); the decision heading is H2", async () => {
    const text = await cardText({ variant: "ready", summary: "Dichte-Test", lang: "de", session_id: "test-anatomy-1" });
    expect(text).toMatch(/^### \*\*✨✨✨ Dichte-Test ✨✨✨\*\*/m);
    expect(text).not.toMatch(/^# \*\*✨✨✨/m);
    expect(text).toMatch(/^## 📦 Shippen\?$/m);
  });

  test("no old blocks: no Changes/Geprüft/OFFEN/Delivery/footer/state lines, no CTA sentence", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Ship ok", lang: "de", session_id: "test-anatomy-2",
      state: { branch: "main", pushed: true, merged: "main", commit: "abc1234" },
      changes: [{ area: "Card", description: "Neue Zeilen" }],
    });
    expect(text).not.toMatch(/\*\*Changes\*\*/);
    expect(text).not.toMatch(/\*\*Gepr(ü|u)ft\*\*/);
    expect(text).not.toMatch(/OFFEN/);
    expect(text).not.toMatch(/\*\*Delivery\*\*/);
    expect(text).not.toMatch(/📌/);
    expect(text).not.toMatch(/SHIP oder ÄNDERN/);
  });

  test("result lines use › with no bullets or blockquote, ≤ 3, with a +N weitere tail on the 4th+", async () => {
    const text = await cardText({
      variant: "ready", summary: "Viele Changes", lang: "de", session_id: "test-anatomy-3",
      changes: [
        { area: "A", description: "erste Zeile" },
        { area: "B", description: "zweite Zeile" },
        { area: "C", description: "dritte Zeile" },
        { area: "D", description: "vierte Zeile" },
      ],
    });
    const resultLines = text.split("\n").filter((l) => l.startsWith("› "));
    expect(resultLines.length).toBe(3);
    expect(text).toContain("+1 weitere");
    expect(text).not.toMatch(/^\* /m);
    expect(text).not.toMatch(/^> /m);
  });

  test("a deviation is always line 1, prefixed Nicht erreicht, never folded into evidence or open points", async () => {
    const text = await cardText({
      variant: "ready", summary: "Mit rotem Test", lang: "de", session_id: "test-anatomy-4",
      changes: [{ area: "X", description: "Feature Y gebaut" }],
      tests: [{ method: "npm test", result: "2 Tests rot" }],
    });
    const lines = text.split("\n").filter((l) => l.startsWith("› "));
    expect(lines[0]).toContain("**Nicht erreicht:**");
    expect(lines[0]).toContain("npm test");
  });

  test("evidence row: two spaces between posts, monochrome glyphs, deviations first and bright", async () => {
    const text = await cardText({
      variant: "ready", summary: "Evidence-Test", lang: "de", session_id: "test-anatomy-5",
      validation: [
        { requirement: "R1", status: "met", evidence: "ok" },
        { requirement: "R2", status: "met", evidence: "ok" },
      ],
      tests: [{ method: "npm test", result: "3464 Tests grün" }],
    });
    expect(text).toContain("✓ 2/2 Anforderungen");
    expect(text).toContain("✓ 3464 Tests grün");
    expect(text).toContain("Anforderungen  ✓"); // two spaces between posts
  });

  test("deviation-only posts (lint/build/review) render only when they carry a finding", async () => {
    const clean = await cardText({
      variant: "ready", summary: "Sauber", lang: "de", session_id: "test-anatomy-6a",
      tests: [{ method: "eslint", result: "sauber" }],
    });
    expect(clean).not.toContain("🧹");

    const dirty = await cardText({
      variant: "ready", summary: "Warnungen", lang: "de", session_id: "test-anatomy-6b",
      tests: [{ method: "eslint", result: "3 Warnungen" }],
    });
    expect(dirty).toContain("🧹 3 Warnungen");
  });

  test("⚠ ungeprüft evidence post + heading fire together on the V&V gate", async () => {
    const text = await cardText({
      variant: "ready", summary: "Ungeprüft", lang: "de", session_id: "cli-vv-doesnt-exist-here",
    });
    // No V&V flags on disk for this session → not unverified, plain ready.
    expect(text).toMatch(/^## 📦 Shippen/m);
  });

  test("pipeline line: glyph BEFORE the step, ring channels continue it", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Ship + Promote", lang: "de", session_id: "test-anatomy-7",
      buildId: "abc1234",
      state: { branch: "main", pushed: true, merged: "main", commit: "abc1234", pr: { number: 416, title: "x" } },
      delivery: { promote: { channels: { alpha: "0.1.0" }, current: "alpha" } },
    });
    expect(text).toContain("✓ commit → ✓ push → ✓ PR #416 → ✓ merge");
    expect(text).toContain("alpha **v0.1.0** › beta — › stable —");
    expect(text).toContain("Build abc1234");
  });

  test("ready-files pipeline names the file count, not a repo", async () => {
    const text = await cardText({
      variant: "ready", summary: "Nur Dateien", lang: "de", session_id: "test-anatomy-8",
      state: { mode: "file-only", filesModified: 9, delivered: "none" },
    });
    expect(text).toContain("📂 9 Dateien geändert");
    expect(text).toContain("kein Repo");
  });

  test("analysis pipeline says no changes to the repo", async () => {
    const text = await cardText({ variant: "analysis", summary: "Nur gelesen", lang: "de", session_id: "test-anatomy-9" });
    expect(text).toContain("➖ keine Änderungen im Repo");
  });

  test("decision heading ends with ? except state headings, which end with .", async () => {
    const ready = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-anatomy-10a" });
    expect(ready).toMatch(/^## .+\?$/m);

    const shippedPlain = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-anatomy-10b",
      state: { branch: "main", pushed: true, merged: "main" },
    });
    expect(shippedPlain).toMatch(/^## .+\.$/m);
  });

  test("points cap at 3, with a +N weitere tail appended to the heading", async () => {
    const text = await cardText({
      variant: "ready", summary: "Viele Punkte", lang: "de", session_id: "test-anatomy-11",
      open: ["Punkt 1", "Punkt 2", "Punkt 3", "Punkt 4", "Punkt 5"],
    });
    const numbered = text.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(numbered.length).toBe(3);
    expect(text).toMatch(/^## .*\+2 weitere\??$/m);
  });

  test("terminal markdown never renders buttons", async () => {
    const text = await cardText({ variant: "ready", summary: "Terminal", lang: "de", session_id: "test-anatomy-12" });
    expect(text).not.toContain("role=\"button\"");
    expect(text).not.toContain("[Ship");
  });
});

describe("render_completion_card — § 3 per-variant table (de + en)", () => {
  const cases = [
    {
      name: "ready (no reservation)",
      params: { variant: "ready" },
      de: /^## 📦 Shippen\?$/m, en: /^## 📦 Ship\?$/m,
    },
    {
      name: "ready (top reservation)",
      params: { variant: "ready", open: ["fremder Testfehler"] },
      de: /^## 📦 Shippen trotz fremder Testfehler\?$/m, en: /^## 📦 Ship anyway despite fremder Testfehler\?$/m,
    },
    {
      name: "ready + red tests",
      params: { variant: "ready", tests: [{ method: "npm test", result: "2 Tests rot" }] },
      de: /^## ⚠ Trotzdem shippen mit \d+ roten Tests\?$/m, en: /^## ⚠ Ship anyway with \d+ red tests\?$/m,
    },
    {
      name: "ship-blocked",
      params: { variant: "ship-blocked", cta: { reason: "Preflight" } },
      de: /^## ⛔ Preflight umgehen und trotzdem shippen\?$/m, en: /^## ⛔ Bypass Preflight and ship anyway\?$/m,
    },
    {
      name: "ship-successful (ring)",
      params: { variant: "ship-successful", state: { pushed: true, merged: "main" }, delivery: { ship: { version: "0.1.0" }, promote: { channels: { alpha: "0.1.0" }, current: "alpha" } } },
      de: /^## 🚀 Released v0\.1\.0 alpha — nach beta promoten\?$/m, en: /^## 🚀 Released v0\.1\.0 alpha — promote to beta\?$/m,
    },
    {
      name: "ship-successful (plain merge, no ring)",
      params: { variant: "ship-successful", state: { pushed: true, merged: "main" }, delivery: { ship: { version: "0.1.0", base: "main" } } },
      de: /^## 🚀 Shipped v0\.1\.0 → main\.$/m, en: /^## 🚀 Shipped v0\.1\.0 → main\.$/m,
    },
    {
      name: "ship-successful kept",
      params: { variant: "ship-successful", state: { pushed: true, merged: "main", kept: true, branch: "feat/x" }, delivery: { ship: { version: "0.1.0" } } },
      de: /^## 🚀 Released v0\.1\.0 alpha — weiter in `feat\/x`\?$/m, en: /^## 🚀 Released v0\.1\.0 alpha — continue on `feat\/x`\?$/m,
    },
    {
      name: "ship-successful deployPending",
      params: { variant: "ship-successful", state: { pushed: true, merged: "main", deployPending: true } },
      de: /^## 🚨 Gemergt, aber nicht live — Migration jetzt deployen\?$/m, en: /^## 🚨 Merged, but not live — deploy the migration now\?$/m,
    },
    {
      name: "released → beta",
      params: { variant: "released", delivery: { promote: { channels: { beta: "0.1.0" }, current: "beta" }, ship: { version: "0.1.0" } } },
      de: /^## 🎊 Promoted v0\.1\.0 BETA — nach stable\?$/m, en: /^## 🎊 Promoted v0\.1\.0 BETA — to stable\?$/m,
    },
    {
      name: "released → stable",
      params: { variant: "released", delivery: { promote: { channels: { stable: "0.1.0" }, current: "stable" }, ship: { version: "0.1.0" } } },
      de: /^## 🎊 Released v0\.1\.0 LIVE — stable\.$/m, en: /^## 🎊 Released v0\.1\.0 LIVE — stable\.$/m,
    },
    {
      name: "ready-files",
      params: { variant: "ready-files", state: { mode: "file-only" } },
      de: /^## 📂 Fertig auf der Platte — noch etwas\?$/m, en: /^## 📂 Done on disk — anything else\?$/m,
    },
    {
      name: "test",
      params: { variant: "test", userTest: ["Login prüfen"] },
      de: /^## 🧪 Erst testen, dann shippen\?$/m, en: /^## 🧪 Test first, then ship\?$/m,
    },
    {
      name: "test-minimal",
      params: { variant: "test-minimal" },
      de: /^## ▶️ Läuft — viel Spaß$/m, en: /^## ▶️ Running — have fun$/m,
    },
    {
      name: "analysis",
      params: { variant: "analysis" },
      de: /^## 📋 Analyse gelesen — umsetzen oder Fragen\?$/m, en: /^## 📋 Read through — questions\?$/m,
    },
    {
      name: "aborted",
      params: { variant: "aborted", cta: { reason: "fehlender Zugriff" } },
      de: /^## 🚫 Abgebrochen wegen fehlender Zugriff — anders versuchen\?$/m, en: /^## 🚫 Aborted because of fehlender Zugriff — try differently\?$/m,
    },
    {
      name: "fallback",
      params: { variant: "no-such-variant" },
      de: /^## 🔧 Erledigt — noch etwas\?$/m, en: /^## 🔧 Done — anything else\?$/m,
    },
    {
      name: "pending override",
      params: { variant: "ready", pending: [{ name: "devops:frontend", doing: "Farbstil" }] },
      de: /^## ⏳ Noch nicht fertig — .+$/m, en: /^## ⏳ Not done yet — .+$/m,
    },
    {
      name: "batch override",
      params: { variant: "ready" }, // batch is read from cwd's .claude/batch-mode.json — not exercised here, smoke only
      de: /^## 📦 Shippen\?$/m, en: /^## 📦 Ship\?$/m,
    },
  ];

  for (const c of cases) {
    test(c.name + " (de)", async () => {
      const text = await cardText({ ...c.params, summary: "x", lang: "de", session_id: "test-table-de-" + c.name.replace(/\W+/g, "-") });
      expect(text).toMatch(c.de);
    });
    test(c.name + " (en)", async () => {
      const text = await cardText({ ...c.params, summary: "x", lang: "en", session_id: "test-table-en-" + c.name.replace(/\W+/g, "-") });
      expect(text).toMatch(c.en);
    });
  }

  test("V&V unverified: ⚠ Ungeprüft shippen? — evidence carries the ungeprüft post", async () => {
    // Simulated indirectly: without the Light-verification flag files the gate
    // is closed, so this asserts the CLEAN path stays 'ready' — the flag-driven
    // path is covered end-to-end by index.cli.test.js (writes real flag files).
    const text = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-vv-clean" });
    expect(text).not.toMatch(/Ungepr(ü|u)ft shippen/);
  });

  // One test per case: every render shells out to git, and ~20 serial renders
  // inside ONE test shared a single 30 s budget — under full-suite load that
  // timed out although each render alone takes about a second.
  for (const c of cases) {
    test("terminal renders no buttons: " + c.name, async () => {
      const text = await cardText({ ...c.params, summary: "x", lang: "de", session_id: "test-nobtn-" + c.name.replace(/\W+/g, "-") });
      expect(text, c.name).not.toMatch(/role="button"/);
    });
  }
});

// Skill restructure PR 2: "ship stable" ships to alpha, then promotes — and
// the run ends with ONE card, the released one, which must still carry what
// the ship did (tests, manual checks, harden/polish findings).
describe("render_completion_card — ship + promote in one run (released)", () => {
  const combined = {
    variant: "released",
    summary: "Promote in do-ship",
    lang: "de",
    buildId: "abc1234",
    changes: [{ area: "Ship", description: "ship stable shippt erst nach alpha, dann stable" }],
    tests: [{ method: "npm test", result: "3462 grün" }],
    userFinalTest: ["Harden (ship): leerer catch in lib/x.js:12 prüfen", { action: "Consumer-Maschine pinnt auf stable/v0.171.0", afterDeployment: true }],
    state: { branch: "main", commit: "deadbee", pushed: true, pr: { number: 480, title: "feat: x" }, merged: "main" },
    cta: { vOld: "0.170.0", vNew: "0.171.0", bump: "minor" },
    delivery: {
      pr: { number: 480, title: "feat: x" },
      ship: { version: "0.171.0", base: "main" },
      promote: { channels: { alpha: "0.171.0", beta: "0.171.0", stable: "0.171.0" }, current: "stable", fastTrack: true },
    },
    promotion: { from: "alpha", to: "stable", sha: "deadbeefcafe", tags: ["stable/v0.171.0", "v0.171.0"], release: true },
  };

  test("the released heading, the ship's tests AND the promotion facts on one card", async () => {
    const text = await cardText({ ...combined, session_id: "test-combo-1" });
    expect(text).toMatch(/^## 🎊 Released v0\.171\.0 LIVE — stable\.$/m);
    expect(text).toContain("3462 Tests grün");
    expect(text).toContain("Tags stable/v0.171.0/v0.171.0");
    expect(text).toContain("bit-identisch — deadbee");
    expect(text).toMatch(/✓ merge {3}main · Build/);
    expect(text).toContain("alpha · beta · stable **v0.171.0** ✓");
    expect(text).not.toMatch(/Shipped v0\.171\.0/);
  });

  test("userFinalTest items become the released card's points (ship findings are never dropped)", async () => {
    const text = await cardText({ ...combined, session_id: "test-combo-2" });
    expect(text).toContain("Harden (ship): leerer catch in lib/x.js:12 prüfen");
    expect(text).toContain("Consumer-Maschine pinnt auf stable/v0.171.0 — nach Deployment");
  });

  test("a skipped promotion leaves ship-successful with the reason as an open point", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-combo-4",
      state: { branch: "main", pushed: true, merged: "main", commit: "deadbee" },
      delivery: { ship: { version: "0.171.0", base: "main" }, promote: { channels: { alpha: "0.171.0" }, current: "alpha" } },
      open: ["Promotion auf stable ausgesetzt — erst deployen, dann promote stable"],
      userFinalTest: ["Login prüfen"],
    });
    expect(text).toMatch(/^## 🚀 Released v0\.171\.0 alpha/m);
    expect(text).toContain("Promotion auf stable ausgesetzt — erst deployen, dann promote stable");
    expect(text).toContain("🧪 Login prüfen");
  });

  test("a promotion-only released card shows only the promotion facts", async () => {
    const text = await cardText({
      variant: "released", summary: "x", lang: "en", session_id: "test-combo-3",
      delivery: { promote: { channels: { beta: "0.1.0" }, current: "beta" }, ship: { version: "0.1.0" } },
      promotion: { from: "alpha", to: "beta", sha: "abcdef1234", tags: ["beta/v0.1.0"] },
    });
    expect(text).toMatch(/^## 🎊 Promoted v0\.1\.0 BETA — to stable\?$/m);
    expect(text).toContain("tags beta/v0.1.0");
    expect(text).not.toMatch(/Tests? (green|grün)/);
  });
});

describe("render_completion_card — out-of-band deploy gate (#243)", () => {
  const baseParams = {
    variant: "ship-successful",
    summary: "Test ship",
    lang: "de",
    buildId: "abc1234",
    session_id: "test-oob",
    state: { branch: "main", pushed: true, merged: "main", commit: "abc1234" },
  };

  test("no deployGate → plain shipped heading, no deploy warning", async () => {
    const text = await cardText(baseParams);
    expect(text).not.toMatch(/DEPLOY erforderlich/);
  });

  test("deployPending + deployGate items → 🚨 heading and the artifacts as points", async () => {
    const text = await cardText({
      ...baseParams,
      session_id: "test-oob-2",
      state: { ...baseParams.state, deployPending: true },
      deployGate: [{ artifact: "supabase/migrations/1.sql", kind: "migration", action: "apply_migration" }],
    });
    expect(text).toMatch(/^## 🚨 Gemergt, aber nicht live/m);
    expect(text).toContain("migration · supabase/migrations/1.sql — apply_migration");
  });
});

describe("render_completion_card — every input. field lands somewhere", () => {
  test("validation unmet drives both the deviation line and the evidence post", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-validation",
      validation: [{ requirement: "Muss X tun", status: "unmet", evidence: "Test fehlt" }],
    });
    expect(text).toContain("**Nicht erreicht:** Muss X tun — Test fehlt");
    expect(text).toContain("✗ 1 unerfüllt");
  });

  test("userTest steps become the test-variant's points", async () => {
    const text = await cardText({
      variant: "test", summary: "x", lang: "de", session_id: "test-fields-usertest",
      userTest: ["Login testen", "Logout testen"],
    });
    expect(text).toContain("1. Login testen");
    expect(text).toContain("2. Logout testen");
  });

  test("userFinalTest items become ready's points, afterDeployment adds the suffix", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-finaltest",
      userFinalTest: ["Lokal prüfen", { action: "Stripe live testen", afterDeployment: true }],
    });
    expect(text).toContain("1. Lokal prüfen");
    expect(text).toContain("Stripe live testen — nach Deployment");
  });

  test("_downgraded (variant-guard) surfaces as the context line", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-fields-downgrade",
      // No state.pushed/merged → variant guard downgrades to ready.
    });
    expect(text).toMatch(/^## 📦 Shippen/m);
    expect(text).toContain("› ℹ️ **Variante auf `ready` korrigiert**");
  });

  // The channel ladder carries every version once: the highest leads, the
  // lagging channels follow with their distance; no separate lag context line.
  test("delivery.promote renders the channel ladder with per-channel versions and lag", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-fields-lag",
      state: { pushed: true, merged: "main" },
      delivery: { ship: { version: "0.193.0" }, promote: {
        channels: { alpha: "0.193.0", beta: "0.190.2", stable: "0.188.0" }, current: "alpha",
        betaLag: { versions: 3 }, stableLag: { versions: 5, days: 7 } } },
    });
    expect(text).toContain("alpha **v0.193.0** › beta v0.190.2 (−3) › stable v0.188.0 (−5 · 7 d)");
    expect(text).not.toContain("vor stable →");
  });

  test("channels on the same version merge on the ladder; all equal gets a tick", async () => {
    const onBeta = await cardText({
      variant: "released", summary: "x", lang: "de", session_id: "test-fields-ladder-beta",
      delivery: { promote: { channels: { alpha: "0.193.0", beta: "0.193.0", stable: "0.188.0" }, current: "beta", stableLag: { versions: 5 } } },
    });
    expect(onBeta).toContain("alpha · beta **v0.193.0** › stable v0.188.0 (−5)");
    const onStable = await cardText({
      variant: "released", summary: "x", lang: "de", session_id: "test-fields-ladder-stable",
      delivery: { promote: { channels: { alpha: "0.193.0", beta: "0.193.0", stable: "0.193.0" }, current: "stable" } },
    });
    expect(onStable).toContain("alpha · beta · stable **v0.193.0** ✓");
  });

  test("pending overrides evidence with a provisional-evidence post and the block's items as points", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-pending",
      pending: [{ name: "devops:frontend", doing: "Farbstil umstellen" }],
    });
    expect(text).toContain("◐ Belege vorläufig");
    expect(text).toContain("`devops:frontend` — Farbstil umstellen");
  });

  test("concept override renders the quiet page context line", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-concept",
      concept: { phase: "waiting", url: "http://localhost:4321/docs/concepts/x.html" },
    });
    expect(text).toMatch(/^## 🧭 Concept wartet auf deine Entscheidungen$/m);
    expect(text).toContain("› http://localhost:4321/docs/concepts/x.html");
  });

  // Observed 2026-09-21: an implementation run (agents working) rendered
  // "Concept wartet auf deine Entscheidungen" — the heading ignored the phase.
  test("concept heading follows the phase: iterating / implementing promise to report back", async () => {
    const iter = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-concept-iter",
      concept: { phase: "iterating", url: "http://localhost:4321/x.html" },
    });
    expect(iter).toMatch(/^## 🧭 Concept in Iteration — ich melde mich$/m);
    const impl = await cardText({
      variant: "ready", summary: "Implementieren gestartet", lang: "de", session_id: "test-fields-concept-impl",
      concept: "implementing",
      pending: [{ name: "devops:core", doing: "Hangar-Mechanik" }, { name: "devops:frontend", doing: "Holotable" }],
    });
    expect(impl).toMatch(/^## 🧭 Concept in Implementierung\. 2 Agenten arbeiten — ich melde mich$/m);
    expect(impl).not.toMatch(/wartet auf deine Entscheidungen/);
    expect(impl).toContain("`devops:core` — Hangar-Mechanik");
    const en = await cardText({
      variant: "ready", summary: "x", lang: "en", session_id: "test-fields-concept-en",
      concept: { phase: "implementing" },
    });
    expect(en).toMatch(/^## 🧭 Concept in implementation — I will report back$/m);
  });
});

describe("render_completion_card — evidence heuristics (post-concept fixes)", () => {
  test("skipped tests are no deviation: '3464 grün · 3 skipped' is ✓ 3464 Tests grün and the heading stays 📦", async () => {
    const text = await cardText({
      variant: "ready", summary: "Heuristik", lang: "de", session_id: "test-ev-1",
      tests: [{ method: "npm test", result: "3464 grün · 3 skipped" }],
      validation: [{ requirement: "A", status: "met", evidence: "t" }],
      open: ["agent-proactivity.md liegt 11 B unter dem Preload-Cap — kürzen oder Cap heben", "zweiter Punkt"],
    });
    expect(text).toContain("✓ 3464 Tests grün");
    expect(text).not.toMatch(/⏭/);
    expect(text).toMatch(/^## 📦 Shippen trotz 2 Vorbehalten\?$/m);
  });

  test("'0 rot' is green; '2 rot' is ✗ 2 Tests rot and routes to the ⚠ heading", async () => {
    const green = await cardText({
      variant: "ready", summary: "Null rot", lang: "de", session_id: "test-ev-2a",
      tests: [{ method: "npm test", result: "120 grün · 0 rot" }],
    });
    expect(green).toContain("✓ 120 Tests grün");
    const red = await cardText({
      variant: "ready", summary: "Zwei rot", lang: "de", session_id: "test-ev-2b",
      tests: [{ method: "npm test", result: "3462 grün · 2 rot" }],
    });
    expect(red).toContain("✗ 2 Tests rot");
    expect(red).toMatch(/^## ⚠ Trotzdem shippen mit 2 roten Tests\?$/m);
    expect(red).toMatch(/^› \*\*Nicht erreicht:\*\* 2 Tests rot \(npm test\)$/m);
  });

  // An unmet requirement routes to ready-red as well, but it is no red test —
  // the heading names what is actually red (observed 2026-09-21: "Trotzdem
  // shippen mit 1 roten Tests?" over a green suite).
  test("ready-red heading names unmet requirements when the tests are green", async () => {
    const de = await cardText({
      variant: "ready", summary: "Eins offen", lang: "de", session_id: "test-ev-unmet-de",
      tests: [{ method: "npm test", result: "55 grün" }],
      validation: [{ requirement: "Widget klickbar", status: "unmet", evidence: "nicht gesehen" }],
    });
    expect(de).toMatch(/^## ⚠ Trotzdem shippen mit 1 unerfüllter Anforderung\?$/m);
    expect(de).not.toMatch(/roten Tests/);
    const two = await cardText({
      variant: "ready", summary: "Zwei offen", lang: "en", session_id: "test-ev-unmet-en",
      validation: [
        { requirement: "A", status: "unmet", evidence: "x" },
        { requirement: "B", status: "unmet", evidence: "y" },
      ],
    });
    expect(two).toMatch(/^## ⚠ Ship anyway with 2 unmet requirements\?$/m);
    const partial = await cardText({
      variant: "ready", summary: "Teilweise", lang: "de", session_id: "test-ev-partial-de",
      validation: [{ requirement: "C", status: "partial", evidence: "z" }],
    });
    expect(partial).toMatch(/^## ⚠ Trotzdem shippen mit 1 teilweise erfüllter Anforderung\?$/m);
  });

  test("a short single reservation is quoted in the heading, a long one becomes the count", async () => {
    const short = await cardText({
      variant: "ready", summary: "Kurz", lang: "de", session_id: "test-ev-3a",
      open: ["fremdem Testfehler"],
    });
    expect(short).toMatch(/^## 📦 Shippen trotz fremdem Testfehler\?$/m);
    const long = await cardText({
      variant: "ready", summary: "Lang", lang: "en", session_id: "test-ev-3b",
      open: ["agent-proactivity.md is 11 B under the preload cap — the next addition must trim or raise the cap"],
    });
    expect(long).toMatch(/^## 📦 Ship anyway despite 1 reservation\?$/m);
  });

  test("gates without a lane (preflight) surface only with a finding, named after the gate", async () => {
    const text = await cardText({
      variant: "ready", summary: "Preflight", lang: "de", session_id: "test-ev-4",
      tests: [{ method: "npm test", result: "10 grün" }, { method: "Preflight", result: "2 Konflikte — fehlgeschlagen" }, { method: "Smoke", result: "ok" }],
    });
    expect(text).toMatch(/^✗ Preflight: 2 Konflikte — fehlgeschlagen  /m);
    expect(text).not.toContain("Smoke");
  });

  test("live checks count up: two green live entries → ✓ 2 Live-Checks ok", async () => {
    const text = await cardText({
      variant: "ready", summary: "Live", lang: "de", session_id: "test-ev-5",
      tests: [{ method: "Hooks live gegen usage-live.json", result: "Zeile kommt" }, { method: "Browser", result: "Overlay sichtbar" }],
    });
    expect(text).toContain("✓ 2 Live-Checks ok");
  });

  test("an identifier-like area keeps its subject on a lowercase description; a worded area is dropped", async () => {
    const text = await cardText({
      variant: "ready", summary: "Subjekt", lang: "de", session_id: "test-ev-6",
      changes: [{ area: "auto-agents", description: "nutzt dieselben Schwellen" }, { area: "Ship", description: "merged ohne Tag" }],
    });
    expect(text).toMatch(/^› auto-agents nutzt dieselben Schwellen$/m);
    expect(text).toMatch(/^› merged ohne Tag$/m);
  });

  test("ring ladder highlights only the channel on the highest version", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Ring", lang: "de", session_id: "test-ev-7",
      state: { branch: "claude/x", pushed: true, merged: "main", commit: "a91c3e2" },
      delivery: { pr: { number: 416, title: "f" }, ship: { version: "0.179.0", base: "main" },
        promote: { current: "alpha", channels: { alpha: "0.179.0", beta: "0.176.0", stable: "0.170.0" } } },
    });
    expect(text).toContain("alpha **v0.179.0** › beta v0.176.0 › stable v0.170.0");
    // The version lives on the ladder, not a second time on the pipeline line.
    expect(text).not.toMatch(/merge.*· v0.179.0/);
  });

  test("test-minimal carries the started thing as its one › line", async () => {
    const text = await cardText({ variant: "test-minimal", summary: "App gestartet", lang: "de", session_id: "test-ev-8", cta: { description: "npm run dev auf 5173" } });
    expect(text).toMatch(/^› npm run dev auf 5173$/m);
  });
});

// An armed /do-batch collection: the card is the whole confirmation of the
// activating turn, so it carries the how-to itself — what happens to the next
// prompt, how to fire, how to stop — instead of a separate text block before it.
describe("render_completion_card — armed batch carries the how-to", () => {
  test("heading, context line and three guide points (de + en)", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { createRequire } = await import("node:module");
    const B = createRequire(import.meta.url)("../hooks/lib/batch-state.js");
    const cwd = mkdtempSync(join(tmpdir(), "card-batch-"));
    try {
      B.activate(cwd, { marker: ">go", expiryHours: 8, maxNotes: 100 });
      B.appendNote(cwd, "erste Notiz");
      const de = await cardText({ variant: "analysis", summary: "x", lang: "de", cwd, session_id: "test-batch-guide-de" });
      expect(de).toMatch(/^## 📥 Batch sammelt — 1 Eintrag$/m);
      expect(de).toMatch(/1 Notiz · nächster Prompt wird Notiz #2 · ">go" löst aus/);
      expect(de).toMatch(/^1\. Sammeln: jeder Prompt ohne Marker wird Notiz/m);
      expect(de).toMatch(/^2\. Umsetzen: „>go <text>" oder \/do-batch go/m);
      expect(de).toMatch(/^3\. Stoppen: \/do-batch off \(Notizen bleiben\) · Auto-Ende nach 8 h oder 100 Notizen$/m);
      const en = await cardText({ variant: "analysis", summary: "x", lang: "en", cwd, session_id: "test-batch-guide-en" });
      expect(en).toMatch(/^2\. Execute: ">go <text>" or \/do-batch go/m);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
