import { describe, test, expect, vi, beforeAll } from "vitest";

// Same mock preamble as index.card.test.js: index.js boots an MCP server over
// stdio at import time. Mock the SDK + zod so the pure meter helpers can be
// imported and asserted on directly.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool() {}
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

let renderBar, renderUsageLine, formatResetShort, renderUsageMeterForCard;

beforeAll(async () => {
  ({ renderBar, renderUsageLine, formatResetShort, renderUsageMeterForCard } =
    await import("./index.js"));
});

const BAR = 14;
const MARKER = "\u254f";
const ELAPSED = "\u2501";
const LEFT = "\u2500";

describe("renderBar — time window with usage marker", () => {
  test("bar is always exactly 14 glyphs", () => {
    for (const [pct, el] of [[0, 0], [7, 0.6], [62, 9], [100, 100], [50, 50]]) {
      expect(renderBar(pct, el)).toHaveLength(BAR);
    }
  });

  test("marker sits at the usage position, not the elapsed position", () => {
    // 62% usage, 9% elapsed -> marker at round(.62*14) = 9
    expect(renderBar(62, 9).indexOf(MARKER)).toBe(9);
  });

  test("heavy = elapsed time, light = time left", () => {
    const bar = renderBar(0, 50); // marker at 0, half the window elapsed
    expect(bar.slice(1, 7)).toBe(ELAPSED.repeat(6));
    expect(bar.slice(7)).toBe(LEFT.repeat(7));
  });

  test("marker at 100% stays inside the bar", () => {
    expect(renderBar(100, 100).indexOf(MARKER)).toBe(BAR - 1);
  });

  test("non-finite input degrades to 0 instead of NaN glyphs", () => {
    expect(renderBar(undefined, undefined)).toHaveLength(BAR);
    expect(renderBar(undefined, undefined).indexOf(MARKER)).toBe(0);
  });
});

describe("renderUsageLine — fixed column grid", () => {
  const rows = () => [
    renderUsageLine("5h", 62, 9, 0, 273),
    renderUsageLine("Wk", 7, 0.6, 12, 10020),
  ];

  test("every column starts at the same offset on both rows", () => {
    const [a, b] = rows();
    expect(a.indexOf("%")).toBe(b.indexOf("%"));
    expect(a.indexOf("+")).toBe(b.indexOf("+"));
    expect(a.indexOf("\u00b7")).toBe(b.indexOf("\u00b7"));
  });

  test("padding uses plain spaces only — no NBSP or filler glyphs", () => {
    for (const line of rows()) {
      expect(line).not.toContain("\u00a0");
      const stripped = line.split(MARKER).join("").split(ELAPSED).join("").split(LEFT).join("");
      expect(stripped).not.toMatch(/[._]/);
    }
  });

  test("Pace warning only when usage outruns the clock by >10pp", () => {
    expect(renderUsageLine("5h", 62, 9, 0, 273)).toContain("Pace!");
    expect(renderUsageLine("5h", 12, 9, 0, 273)).not.toContain("Pace!");
  });
});

describe("formatResetShort", () => {
  test("space-pads the trailing number so digits align", () => {
    expect(formatResetShort(273)).toBe("4h 33m");
    expect(formatResetShort(245)).toBe("4h  5m");
    expect(formatResetShort(10020)).toBe("6d 23h");
    expect(formatResetShort(8700)).toBe("6d  1h");
  });
});

describe("renderUsageMeterForCard", () => {
  const usage = () => ({
    timestamp: new Date().toISOString(),
    session: { pct: 62, resetInMinutes: 273 },
    weekly: { pct: 7, resetInMinutes: 10020 },
  });

  test("bars render inside a code fence so the grid holds in a proportional font", () => {
    const lines = renderUsageMeterForCard(usage(), 0, 0, "").split("\n");
    expect(lines[0]).toBe("```");
    expect(lines[lines.length - 1]).toBe("```");
    expect(lines[1].startsWith("5h  ")).toBe(true);
    expect(lines[2].startsWith("Wk  ")).toBe(true);
  });

  test("health line stays a dim blockquote above the fence", () => {
    const out = renderUsageMeterForCard(usage(), 0, 0, "150 calls \u00b7 consider /compact");
    expect(out.startsWith("> 150 calls")).toBe(true);
    expect(out).toContain("\n\n```\n");
  });

  test("no trailing pad whitespace leaks into the fence", () => {
    const out = renderUsageMeterForCard(usage(), 0, 0, "");
    for (const line of out.split("\n")) expect(line).toBe(line.replace(/\s+$/, ""));
  });
});
