import { describe, test, expect } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * The boot probe, run in-process against the REAL servers (#324).
 *
 * This is the regression net for "nothing runs before server.connect()". A unit
 * test cannot see that violation — only a real handshake can — so this file
 * spawns each server exactly the way Claude Code does and asserts it answers
 * `initialize` well inside the connect window.
 *
 * Graceful skip: the servers import @modelcontextprotocol/sdk from a
 * node_modules that ss.mcp.deps.js junctions in at session start. A bare
 * checkout (CI, fresh clone) has none, and a TEST must not create one — that
 * would mutate the working tree. So when deps are unresolvable the assertions
 * are skipped and only the pure helpers are exercised.
 */

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..");

const probe = require("./mcp-boot-probe.js");

// A budget with headroom over the 5000 ms the CLI enforces: the full vitest run
// starts dozens of node processes in parallel on this machine, and this test
// must fail on a boot-discipline regression, not on load.
const TEST_BUDGET_MS = 15_000;

/** Can every server resolve its runtime deps without us linking anything? */
function depsAvailable() {
  return probe.SERVERS.every((s) =>
    probe.resolvedModulesFor(path.join(PLUGIN_ROOT, s.entry)) !== null,
  );
}

const HAVE_DEPS = depsAvailable();

describe("mcp-boot-probe helpers", () => {
  test("covers all three plugin servers", () => {
    expect(probe.SERVERS.map((s) => s.name).sort()).toEqual([
      "dotclaude-completion",
      "dotclaude-issues",
      "dotclaude-ship",
    ]);
  });

  test("the initialize frame is a single newline-terminated JSON-RPC line", () => {
    const raw = probe.initializeRequest(1);
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.trimEnd().includes("\n")).toBe(false);
    const msg = JSON.parse(raw);
    expect(msg).toMatchObject({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(msg.params.protocolVersion).toBeTruthy();
  });

  test("an incomplete node_modules is not accepted as resolved", () => {
    expect(probe.isCompleteModules(null)).toBe(false);
    expect(probe.isCompleteModules(path.join(HERE, "__does_not_exist__"))).toBe(false);
  });

  test("ensureDeps never links when link:false", () => {
    const res = probe.ensureDeps(path.join(HERE, "__nowhere__", "index.js"), { link: false });
    expect(res.ok).toBe(false);
    expect(res.linked).toBe(false);
  });

  test("parseArgs reads the budget and deps overrides", () => {
    expect(probe.parseArgs([])).toEqual({ budgetMs: probe.DEFAULT_BUDGET_MS, deps: null });
    expect(probe.parseArgs(["--budget-ms", "1234", "--deps", "/x/nm"]))
      .toEqual({ budgetMs: 1234, deps: "/x/nm" });
  });

  test("a missing entry file fails instead of hanging", async () => {
    const res = await probe.probeServer(
      { name: "ghost", entry: path.join("mcp-server", "__ghost__.js") },
      { pluginRoot: PLUGIN_ROOT, link: false },
    );
    expect(res).toMatchObject({ server: "ghost", ok: false });
    expect(res.error).toMatch(/missing entry/);
  });
});

describe.skipIf(!HAVE_DEPS)("mcp-boot-probe against the real servers", () => {
  for (const server of probe.SERVERS) {
    test(`${server.name} answers initialize inside the connect window`, async () => {
      const res = await probe.probeServer(server, {
        pluginRoot: PLUGIN_ROOT,
        link: false,
        timeoutMs: TEST_BUDGET_MS + 5_000,
      });
      expect(res.error).toBeUndefined();
      expect(res.ok).toBe(true);
      expect(res.ms).toBeLessThan(TEST_BUDGET_MS);
    }, 40_000);
  }
});
