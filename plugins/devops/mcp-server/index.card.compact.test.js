import { describe, test, expect, vi, beforeAll } from "vitest";

// Density-specific assertions for the "one page, three lines, one decision"
// card (§ 2.4 budget line, § 2.6 points cap, test-minimal's minimal form).
// Same mock preamble as index.card.test.js.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
// Terminal markdown is what these tests assert (on Desktop it is the title line only, § 4).
process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
vi.setConfig({ testTimeout: 30_000 });

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

let render, renderBudgetLineMd, buildBudgetModel;

beforeAll(async () => {
  const mod = await import("./index.js");
  render = captured.handlers["render_completion_card"];
  renderBudgetLineMd = mod.renderBudgetLineMd;
  buildBudgetModel = mod.buildBudgetModel;
  await render({ variant: "analysis", summary: "warmup", lang: "en", session_id: "test-compact-warmup" });
}, 60_000);

async function cardText(params) {
  const res = await render(params);
  return res.content[res.content.length - 1].text;
}

describe("test-minimal — title + one line + heading only", () => {
  test("no evidence row, no budget line, no pipeline line, no points", async () => {
    const text = await cardText({
      variant: "test-minimal", summary: "Dev-Server läuft", lang: "de", session_id: "test-compact-minimal",
      changes: [{ area: "Dev-Server", description: "läuft auf Port 3000" }],
    });
    expect(text).toMatch(/^### \*\*✨✨✨ Dev-Server läuft ✨✨✨\*\*/m);
    expect(text).toMatch(/^› Dev-Server läuft auf Port 3000$/m);
    expect(text).toMatch(/^## ▶️ Läuft — viel Spaß$/m);
    expect(text).not.toMatch(/^\d+\. /m); // no points
    expect(text.split("\n").filter((l) => l.startsWith("›")).length).toBe(1);
  });

  test("never calls the Desktop card widget", async () => {
    const res = await render({ variant: "test-minimal", summary: "x", session_id: "test-compact-minimal-widget" });
    const joined = res.content.map((c) => c.text).join("\n");
    expect(joined).not.toContain("CARD WIDGET");
  });
});

describe("points cap (§ 2.6) — ≤ 3 on the card, rest folded into the heading", () => {
  test("exactly 3 points render without a tail", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-compact-points-3",
      open: ["A", "B", "C"],
    });
    expect(text.split("\n").filter((l) => /^\d+\. /.test(l))).toHaveLength(3);
    expect(text).not.toContain("weitere");
  });

  test("5 points → 3 shown + '+2 weitere' in the heading", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-compact-points-5",
      open: ["A", "B", "C", "D", "E"],
    });
    const shown = text.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(shown).toHaveLength(3);
    expect(text).toMatch(/^## .*\+2 weitere\?$/m);
  });
});

describe("evidence deviation-first ordering (§ 2.3)", () => {
  test("a ✗/◐ post always sorts before dim ✓ posts, regardless of slot", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-compact-devfirst",
      validation: [{ requirement: "R1", status: "met", evidence: "ok" }],
      tests: [{ method: "npm test", result: "2 Tests rot" }],
    });
    const evidenceLine = text.split("\n").find((l) => /^[✓✗◐]/.test(l));
    expect(evidenceLine.indexOf("✗")).toBeGreaterThanOrEqual(0);
    expect(evidenceLine.indexOf("✓")).toBeGreaterThan(evidenceLine.indexOf("✗"));
  });
});

describe("pipeline line forms (§ 2.5)", () => {
  test("open pipeline before any commit", async () => {
    const text = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-compact-pipeline-open" });
    expect(text).toMatch(/^○ commit → ○ push → ○ PR → ○ merge/m);
  });

  test("a fully-merged ring project shows the reached channel and the base branch", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-compact-pipeline-ring",
      state: { branch: "main", pushed: true, merged: "main", pr: { number: 42, title: "x" } },
      delivery: { ship: { version: "0.2.0", base: "main" }, promote: { channels: { alpha: "0.2.0" }, current: "alpha" } },
    });
    expect(text).toMatch(/^✓ commit → ✓ push → ✓ PR #42 → ✓ merge {3}main/m);
    expect(text).toContain("alpha **v0.2.0** › beta — › stable —");
  });

  // alpha→stable pulls beta along (ship_promote tags beta/vN too), so the
  // ladder shows beta on the promoted version, merged with its neighbours.
  test("fastTrack lands every channel on the promoted version", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-compact-pipeline-fasttrack",
      state: { branch: "main", pushed: true, merged: "main" },
      delivery: { ship: { version: "0.2.0" }, promote: { channels: { alpha: "0.2.0", stable: "0.2.0" }, current: "stable", fastTrack: true } },
    });
    expect(text).toContain("alpha · beta · stable **v0.2.0** ✓");
  });
});

describe("budget line — omission and glyph-bar fallback (§ 2.4)", () => {
  const fresh = () => new Date().toISOString();

  test("both windows < 50% and > 1h from reset → the line is omitted entirely", () => {
    const usage = { timestamp: fresh(), session: { pct: 20, resetInMinutes: 200 }, weekly: { pct: 10, resetInMinutes: 5000 } };
    const model = buildBudgetModel(usage, 0, 0, "");
    expect(model.omitted).toBe(true);
    expect(renderBudgetLineMd(model)).toBe("");
  });

  test("one window over the threshold → only that window renders", () => {
    const usage = { timestamp: fresh(), session: { pct: 62, resetInMinutes: 273 }, weekly: { pct: 10, resetInMinutes: 5000 } };
    const model = buildBudgetModel(usage, 0, 0, "");
    expect(model.omitted).toBe(false);
    expect(model.bars.map((b) => b.label)).toEqual(["5h"]);
    const line = renderBudgetLineMd(model);
    expect(line).toContain("5h");
    expect(line).toMatch(/[▰▱│]/);
  });

  test("terminal fallback uses ▰ (elapsed) / │ (usage marker) / ▱ (left) glyphs", () => {
    const usage = { timestamp: fresh(), session: { pct: 90, resetInMinutes: 30 }, weekly: null };
    const model = buildBudgetModel(usage, 0, 0, "");
    const line = renderBudgetLineMd(model);
    expect(line).toMatch(/▰/);
    expect(line).toMatch(/│/);
  });
});
