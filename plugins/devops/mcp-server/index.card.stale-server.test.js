import { describe, test, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staleServerLine, installedVersion, semverGreater, LOADED_VERSION } from "./lib/server-version.js";

// A session keeps the MCP server it started with: when the installed plugin is
// newer, the card says so in one info line (footer area, widget `ov` slot).
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
process.env.DEVOPS_CARD_PREGATE = "0";
process.env.CLAUDE_CODE_ENTRYPOINT = "cli";

const captured = vi.hoisted(() => ({ handlers: {} }));
// the SDK is mocked, so the #824 dependency guard must not wait for it on disk
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
  return { z: new Proxy({}, { get: () => () => node }) };
});

const dir = mkdtempSync(join(tmpdir(), "stale-server-"));
function registry(entries) {
  const f = join(dir, "installed_plugins.json");
  writeFileSync(f, JSON.stringify({ version: 2, plugins: { "devops@dotclaude": entries } }));
  process.env.DEVOPS_INSTALLED_PLUGINS_FILE = f;
}
const entry = (version, lastUpdated = "2026-10-21T10:00:00Z", scope = "user") => ({ scope, version, lastUpdated });

let render;
beforeAll(async () => {
  await import("./index.js");
  render = captured.handlers["render_completion_card"];
}, 60_000);

const text = async (lang, entrypoint = "cli") => {
  process.env.CLAUDE_CODE_ENTRYPOINT = entrypoint;
  const res = await render({ variant: "analysis", summary: "Stale", lang, session_id: "test-stale-" + lang });
  return res.content.map((c) => c.text).join("\n");
};

describe("stale session server notice", () => {
  test("loaded version is read from plugin.json", () => {
    expect(LOADED_VERSION).toBe(JSON.parse(readFileSync(join(import.meta.dirname, "..", ".claude-plugin", "plugin.json"), "utf8")).version);
  });

  test("semver compare", () => {
    expect(semverGreater("0.10.0", "0.9.9")).toBe(true);
    expect(semverGreater("0.9.9", "0.9.9")).toBe(false);
    expect(semverGreater("x", "0.1.0")).toBe(false);
  });

  test("installedVersion: newest user-scope entry, never throws", () => {
    registry([entry("1.0.0", "2026-01-01T00:00:00Z"), entry("1.2.0", "2026-02-01T00:00:00Z"), entry("9.9.9", "2026-03-01T00:00:00Z", "project")]);
    expect(installedVersion(process.env.DEVOPS_INSTALLED_PLUGINS_FILE)).toBe("1.2.0");
    expect(installedVersion(join(dir, "missing.json"))).toBe("");
  });

  test("line text de + en", () => {
    expect(staleServerLine("de", { loaded: "0.286.0", installed: "0.289.0" })).toBe("ℹ Session-Server v0.286.0 — ein Neustart der Session lädt v0.289.0.");
    expect(staleServerLine("en", { loaded: "0.286.0", installed: "0.289.0" })).toBe("ℹ Session server v0.286.0 — restarting the session loads v0.289.0.");
  });

  test("card: newer installed -> line in de and en, also in the widget", async () => {
    registry([entry("999.0.0")]);
    expect(await text("de")).toContain(`ℹ Session-Server v${LOADED_VERSION} — ein Neustart der Session lädt v999.0.0.`);
    expect(await text("en")).toContain(`ℹ Session server v${LOADED_VERSION} — restarting the session loads v999.0.0.`);
    expect(await text("de", "claude-desktop")).toContain("lädt v999.0.0");
  });

  test("card: same, older or missing registry -> no line", async () => {
    registry([entry(LOADED_VERSION)]);
    expect(await text("de")).not.toContain("Session-Server v");
    registry([entry("0.0.1")]);
    expect(await text("de")).not.toContain("Session-Server v");
    process.env.DEVOPS_INSTALLED_PLUGINS_FILE = join(dir, "nope.json");
    expect(await text("de")).not.toContain("Session-Server v");
  });
});
