import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// zod is not resolvable in this repo's test environment (see
// tools/preflight.test.js), so the CLI is checked as text: it must expose
// exactly the pipeline tools the MCP server registers, or the offline path
// silently lags behind the server it stands in for.
const here = dirname(fileURLToPath(import.meta.url));
const server = readFileSync(join(here, "index.js"), "utf8");
const cli = readFileSync(join(here, "cli.js"), "utf8");

const registered = [...server.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).filter((n) => n !== "health_check");
const offered = [...cli.matchAll(/^\s+(ship_[a-z_]+):\s*\[/gm)].map((m) => m[1]);

describe("offline ship CLI", () => {
  test("offers every pipeline tool the MCP server registers", () => {
    expect(registered.length).toBeGreaterThan(5);
    expect(offered.sort()).toEqual(registered.sort());
  });

  test("validates with the tool's own schema and records the checkpoint like the server", () => {
    expect(cli).toMatch(/schema\.safeParse\(params\)/);
    expect(cli).toMatch(/recordShipStep/);
  });

  test("exits 2 on bad input, 1 on a thrown handler", () => {
    expect(cli).toMatch(/fail\(2, `unknown tool/);
    expect(cli).toMatch(/process\.exit\(1\)/);
  });
});
