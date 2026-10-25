import { describe, test, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// One server carries every devops tool, so a long ship step must not block the
// card or usage tools: ship_* runs out of process (ship/server.js → ship/cli.js
// via lib/run-child.js). This drives the real server module with a fake ship
// CLI that takes 12 s and proves the other tools answer while it runs.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
process.env.DEVOPS_CARD_PREGATE = "0";
process.env.CLAUDE_CODE_ENTRYPOINT = "cli";

// Long on purpose: the assertion is ordering (the answers land before the
// step ends), and the margin must survive a machine at 100 % CPU.
const STEP_MS = 12000;
const dir = mkdtempSync(join(tmpdir(), "async-ship-"));
const fakeCli = join(dir, "fake-cli.mjs");
writeFileSync(fakeCli, [
  "let raw = ''; process.stdin.on('data', (d) => { raw += d; });",
  "process.stdin.on('end', () => {",
  `  setTimeout(() => { process.stdout.write(JSON.stringify({ ok: true, tool: process.argv[2], params: JSON.parse(raw || '{}') })); }, ${STEP_MS});`,
  "});",
].join("\n"));
process.env.DOTCLAUDE_SHIP_CLI_TEST = fakeCli;

const captured = vi.hoisted(() => ({ handlers: {} }));
vi.mock("./lib/ensure-deps.js", () => ({ ensureDeps: async () => {} }));
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

beforeAll(async () => {
  await import("./index.js");
  // Pay the cold render cost (git, module warm-up) outside the timed test.
  await captured.handlers.render_completion_card({ variant: "analysis", summary: "warmup", lang: "en", session_id: "test-async-warm" });
}, 120_000);
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe("one server — ship steps never block the other tools", () => {
  test("every tool group registers on the one server", () => {
    for (const t of ["health_check", "get_usage", "render_completion_card", "ship_preflight", "ship_build", "ship_release", "match_issues"]) {
      expect(captured.handlers[t], t).toBeTypeOf("function");
    }
  });

  test("render_completion_card and get_usage answer while a ship_build is still running", async () => {
    const t0 = Date.now();
    let shipDoneAt = 0;
    const ship = captured.handlers.ship_build({ buildIdOnly: true }).then((r) => { shipDoneAt = Date.now(); return r; });

    const usage = await captured.handlers.get_usage({});
    const card = await captured.handlers.render_completion_card({ variant: "analysis", summary: "parallel", lang: "en", session_id: "test-async-ship" });
    const health = await captured.handlers.health_check({});
    const answeredAt = Date.now();

    expect(shipDoneAt).toBe(0); // the ship step is still running
    expect(answeredAt - t0).toBeLessThan(STEP_MS);
    console.error(`[async-ship] card+usage+health answered after ${answeredAt - t0} ms of a ${STEP_MS} ms ship step`);
    expect(usage.content[0].text).toBeTruthy();
    expect(card.isError).not.toBe(true);
    expect(JSON.parse(health.content[0].text).runningChildren).toBe(1);

    const res = await ship;
    expect(shipDoneAt - t0).toBeGreaterThanOrEqual(STEP_MS - 200);
    expect(res.isError).not.toBe(true);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ ok: true, tool: "ship_build", params: { buildIdOnly: true } });
  }, 60_000);

  test("a throwing handler is an error result, not a dead server", async () => {
    const res = await captured.handlers.match_issues({ query: "x", cwd: join(dir, "does-not-exist") });
    expect(res.isError).toBe(true);
  });
});
