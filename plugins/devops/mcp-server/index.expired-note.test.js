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

let renderExpiredNote, formatLastReading, buildBudgetModel;

beforeAll(async () => {
  ({ renderExpiredNote, formatLastReading, buildBudgetModel } = await import("./index.js"));
});

// 2026-10-01: the card said "last reading 2026-09-30 20:48 UTC, ~21h old (not
// logged in)" — a UTC ISO stamp and the scraper's internal reason, which read
// as "your Claude login is broken" although only the scraper's own Edge profile
// had been signed out by claude.ai.
describe("stale usage note — local time, plain words", () => {
  const now = new Date(2026, 9, 1, 19, 0).getTime();   // local 01.10. 19:00
  const lastEvening = new Date(2026, 8, 30, 22, 48);   // local 30.09. 22:48
  const data = { session: { pct: 7 }, timestamp: lastEvening.toISOString(), _cached: true, _failureReason: "not logged in" };

  test("German: 'gestern 22:48 (vor 20 h)', no UTC stamp, signed-out reason in user words", () => {
    const note = renderExpiredNote(data, { ageMinutes: 1212 }, "de", now);
    expect(note).toContain("Keine aktuellen Usage-Daten — Stand gestern 22:48 (vor 20 h)");
    expect(note).not.toMatch(/UTC|\d{4}-\d{2}-\d{2}/);
    expect(note).not.toContain("(not logged in)");
    expect(note).toContain("dein Claude-Login ist nicht betroffen");
    expect(note).toContain("»refresh usage«");
  });

  test("English keeps its own words", () => {
    const note = renderExpiredNote(data, { ageMinutes: 1212 }, "en", now);
    expect(note).toContain("No current usage data — last reading yesterday 22:48 (20 h ago)");
    expect(note).toContain("your Claude login is fine");
  });

  test("today / older dates and an unknown reason passed through", () => {
    expect(formatLastReading(new Date(2026, 9, 1, 8, 5).getTime(), now, "de")).toBe("heute 08:05");
    expect(formatLastReading(new Date(2026, 8, 28, 22, 48).getTime(), now, "de")).toBe("28.09. 22:48");
    expect(formatLastReading(new Date(2026, 8, 28, 22, 48).getTime(), now, "en")).toBe("Sep 28, 22:48");
    const other = renderExpiredNote({ ...data, _failureReason: "CDP scrape failed" }, { ageMinutes: 90 }, "de", now);
    expect(other).toMatch(/— CDP scrape failed$/);
  });

  test("the card budget model renders the note in the card's language", () => {
    const old = { session: { pct: 7, resetInMinutes: 81 }, weekly: { pct: 64, resetInMinutes: 4931 },
      timestamp: new Date(Date.now() - 21 * 3600 * 1000).toISOString(), _cached: true, _ageMinutes: 1260, _failureReason: "not logged in" };
    const model = buildBudgetModel(old, 0, 0, "", "de");
    expect(model.expiredNote).toContain("Keine aktuellen Usage-Daten — Stand");
    expect(model.expiredNote).toContain("(vor 21 h)");
  });
});
