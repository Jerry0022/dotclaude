import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDeps } from "./ensure-deps.js";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "ensure-deps.js");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ensure-deps-"));
  const mcpRoot = join(root, "mcp-server");
  const data = join(root, "data");
  mkdirSync(mcpRoot, { recursive: true });
  mkdirSync(data, { recursive: true });
  return { root, mcpRoot, data };
}

function installInto(modules) {
  for (const pkg of ["@modelcontextprotocol/sdk", "zod"]) {
    const d = join(modules, ...pkg.split("/"));
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "package.json"), "{}");
  }
}

describe("ensureDeps (#824)", () => {
  test("happy path returns immediately", async () => {
    const f = fixture();
    installInto(join(f.mcpRoot, "node_modules"));
    const t = Date.now();
    await ensureDeps({ mcpRoot: f.mcpRoot, pluginData: f.data, exit: () => { throw new Error("exit"); } });
    expect(Date.now() - t).toBeLessThan(100);
    rmSync(f.root, { recursive: true, force: true });
  });

  test("deps that appear 1.5 s late in PLUGIN_DATA are relinked and picked up", async () => {
    const f = fixture();
    setTimeout(() => installInto(join(f.data, "node_modules")), 1500);
    await ensureDeps({ mcpRoot: f.mcpRoot, pluginData: f.data, timeoutMs: 10_000, pollMs: 50, exit: () => { throw new Error("exit"); } });
    expect(existsSync(join(f.mcpRoot, "node_modules", "zod", "package.json"))).toBe(true);
    rmSync(f.root, { recursive: true, force: true });
  });

  test("deps that appear late directly in the plugin copy are picked up", async () => {
    const f = fixture();
    setTimeout(() => installInto(join(f.mcpRoot, "node_modules")), 800);
    await ensureDeps({ mcpRoot: f.mcpRoot, pluginData: f.data, timeoutMs: 10_000, pollMs: 50, exit: () => { throw new Error("exit"); } });
    rmSync(f.root, { recursive: true, force: true });
  });

  test("never appearing: one stderr line, exit 1, stdout clean", () => {
    const f = fixture();
    const script = `import { ensureDeps } from ${JSON.stringify("file:///" + LIB.replace(/\\/g, "/"))};
await ensureDeps({ mcpRoot: ${JSON.stringify(f.mcpRoot)}, pluginData: ${JSON.stringify(f.data)}, timeoutMs: 600, pollMs: 50, installAfterMs: 999999 });
console.error("SHOULD NOT REACH");`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    const lines = r.stderr.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/dependencies .*@modelcontextprotocol\/sdk.* not found/);
    rmSync(f.root, { recursive: true, force: true });
  });
});
