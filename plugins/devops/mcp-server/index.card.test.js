import { describe, test, expect, vi, beforeAll } from "vitest";

// index.js boots an MCP server over stdio at import time and pulls in the
// @modelcontextprotocol SDK + zod (neither is a devDependency of this repo).
// Mock all three so the module imports cleanly and we can capture the
// render_completion_card handler to exercise the pure card renderer.
// Never spawn the real headless usage scraper (Edge) from a unit test — it is
// slow and flaky under parallel load. The card renders without a usage meter.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";

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
});

async function cardText(params) {
  const res = await render(params);
  // content[0] is the DO-NOT-OUTPUT instruction; content[1] is the card markdown.
  return res.content.map((c) => c.text).join("\n");
}

describe("render_completion_card — out-of-band deploy gate (#243)", () => {
  const baseParams = {
    variant: "ship-successful",
    summary: "Test ship",
    lang: "de",
    buildId: "abc1234",
    session_id: "test-oob",
    state: { branch: "main", pushed: true, merged: "main", commit: "abc1234" },
  };

  test("no deployGate → renders 'Alles ERLEDIGT', no deploy warning", async () => {
    const text = await cardText(baseParams);
    expect(text).toMatch(/Alles ERLEDIGT/);
    expect(text).not.toMatch(/DEPLOY erforderlich/);
    expect(text).not.toMatch(/noch NICHT live/);
  });

  test("deployGate + deployPending → loud deploy block AND CTA flips off 'all done'", async () => {
    const text = await cardText({
      ...baseParams,
      state: { ...baseParams.state, deployPending: true },
      deployGate: [
        { artifact: "supabase/migrations/20260708_token_revoked.sql", kind: "migration", action: "apply_migration" },
        { artifact: "supabase/functions/desktop-latest/index.ts", kind: "function", action: "deploy_edge_function desktop-latest" },
      ],
    });
    // Loud gate block names each artifact + its deploy action.
    expect(text).toMatch(/DEPLOY erforderlich — noch NICHT live/);
    expect(text).toMatch(/migration · supabase\/migrations\/20260708_token_revoked\.sql — apply_migration/);
    expect(text).toMatch(/function · supabase\/functions\/desktop-latest\/index\.ts — deploy_edge_function desktop-latest/);
    // CTA must NOT read as finished.
    expect(text).toMatch(/DEPLOY erforderlich \(noch nicht live\)/);
    expect(text).not.toMatch(/Alles ERLEDIGT/);
  });

  test("English deploy gate localizes header + CTA", async () => {
    const text = await cardText({
      ...baseParams,
      lang: "en",
      state: { ...baseParams.state, deployPending: true },
      deployGate: [{ artifact: "db/migrations/1.sql", kind: "migration", action: "run migration" }],
    });
    expect(text).toMatch(/DEPLOY required — NOT live yet/);
    expect(text).toMatch(/DEPLOY REQUIRED \(not live yet\)/);
    expect(text).not.toMatch(/All DONE/);
  });

  test("plain-string deploy items render as bullets", async () => {
    const text = await cardText({
      ...baseParams,
      state: { ...baseParams.state, deployPending: true },
      deployGate: ["Apply the token_revoked migration to prod"],
    });
    expect(text).toMatch(/Apply the token_revoked migration to prod/);
  });
});
