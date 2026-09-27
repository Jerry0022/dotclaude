import { describe, test, expect, vi, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Density-specific assertions for the "one page, three lines, one decision"
// card (§ 2.4 budget line, § 2.6 points cap, test-minimal's minimal form).
// Same mock preamble as index.card.test.js.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
// Terminal markdown is what these tests assert (on Desktop it is the title line only, § 4).
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

let render, renderBudgetLineMd, buildBudgetModel, sanitizeSessionId, ctaInput;

beforeAll(async () => {
  const mod = await import("./index.js");
  render = captured.handlers["render_completion_card"];
  renderBudgetLineMd = mod.renderBudgetLineMd;
  buildBudgetModel = mod.buildBudgetModel;
  sanitizeSessionId = mod.sanitizeSessionId;
  ctaInput = mod.ctaInput;
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

  // Wk: 10080 min window. resetInMinutes 5040 → 50 % of the week elapsed.
  const wkLabels = (weekly) => buildBudgetModel(
    { timestamp: fresh(), session: { pct: 20, resetInMinutes: 200 }, weekly }, 0, 0, "",
  ).bars.map((b) => b.label);

  test("weekly on pace → hidden, even at a high absolute percent", () => {
    expect(wkLabels({ pct: 58, resetInMinutes: 5040 })).toEqual([]);
    expect(wkLabels({ pct: 60, resetInMinutes: 5040 })).toEqual([]);
  });

  test("weekly more than 10 pp ahead of time (yellow) → shown, even below 50 %", () => {
    expect(wkLabels({ pct: 61, resetInMinutes: 5040 })).toEqual(["Wk"]);
    // Day 1: 10 % of the week elapsed, 25 % used.
    expect(wkLabels({ pct: 25, resetInMinutes: 9072 })).toEqual(["Wk"]);
  });

  test("weekly within 24 h of the reset → shown regardless of pace", () => {
    expect(wkLabels({ pct: 30, resetInMinutes: 1440 })).toEqual(["Wk"]);
    expect(wkLabels({ pct: 30, resetInMinutes: 1441 })).toEqual([]);
  });

  test("terminal fallback uses ▰ (elapsed) / │ (usage marker) / ▱ (left) glyphs", () => {
    const usage = { timestamp: fresh(), session: { pct: 90, resetInMinutes: 30 }, weekly: null };
    const model = buildBudgetModel(usage, 0, 0, "");
    const line = renderBudgetLineMd(model);
    expect(line).toMatch(/▰/);
    expect(line).toMatch(/│/);
  });
});

describe("AUD-035 — the budget tooltip speaks the card's language", () => {
  const usage = () => ({ timestamp: new Date().toISOString(), session: { pct: 62, resetInMinutes: 30 }, weekly: { pct: 70, resetInMinutes: 50 } });

  test("en card → English tooltips", () => {
    const model = buildBudgetModel(usage(), 0, 0, "", "en");
    for (const b of model.bars) {
      expect(b.tooltip).toMatch(/^\d+% used · resets in /);
      expect(b.tooltip).not.toContain("verbraucht");
    }
  });

  test("de card (and the default) keep the German tooltip", () => {
    expect(buildBudgetModel(usage(), 0, 0, "", "de").bars[0].tooltip).toMatch(/^62% verbraucht · Reset in /);
    expect(buildBudgetModel(usage(), 0, 0, "").bars[0].tooltip).toMatch(/^62% verbraucht · Reset in /);
  });
});

describe("AUD-010 — the session id never steers a file write out of tmpdir", () => {
  const RUN = `${process.pid}-${Date.now().toString(36)}`;

  test("sanitizeSessionId keeps real ids and maps anything else to 'unknown'", () => {
    expect(sanitizeSessionId({ session_id: "local_3f2a9c1e-0b4d-4a33-8ae3-7bdac9359d4c" }).session_id)
      .toBe("local_3f2a9c1e-0b4d-4a33-8ae3-7bdac9359d4c");
    expect(sanitizeSessionId({ session_id: "self" }).session_id).toBe("self");
    expect(sanitizeSessionId({ session_id: "w3-1/../../x" }).session_id).toBe("unknown");
    expect(sanitizeSessionId({ session_id: ".." }).session_id).toBe("unknown");
    expect(sanitizeSessionId({}).session_id).toBeUndefined();
  });

  test("the MCP handler sanitises before writing the card-rendered flag", async () => {
    const escaped = `w3-escape-${RUN}`;
    const params = { variant: "analysis", summary: "x", lang: "en", session_id: `w3-2/../../${escaped}` };
    await render(params);
    expect(params.session_id).toBe("unknown");
    // The unsanitised join would have landed one level ABOVE tmpdir.
    expect(existsSync(join(tmpdir(), "..", escaped))).toBe(false);
    expect(existsSync(join(tmpdir(), escaped))).toBe(false);
  });
});

describe("cta input — a plain string never fails the card", () => {
  test("a sentence becomes the info placeholder", () => {
    expect(ctaInput("Subagent-Ship umsetzen?")).toEqual({ info: "Subagent-Ship umsetzen?" });
  });
  test("a JSON object string still parses, objects pass through", () => {
    expect(ctaInput('{"reason":"Limit"}')).toEqual({ reason: "Limit" });
    expect(ctaInput({ version: "1.2.3" })).toEqual({ version: "1.2.3" });
  });
  test("blank or JSON non-object strings do not become garbage", () => {
    expect(ctaInput("  ")).toBeUndefined();
    expect(ctaInput("42")).toEqual({ info: "42" });
  });
});
