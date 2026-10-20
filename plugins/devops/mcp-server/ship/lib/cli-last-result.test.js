import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeLastResult, LAST_RESULT_FILE } from "./cli-last-result.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cli-last-"));
  mkdirSync(join(dir, ".git"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("D3: the CLI's last result on disk", () => {
  test("writes {tool, at, root, result} under <repo root>/.claude, from a subdirectory too", () => {
    mkdirSync(join(dir, "sub"));
    const now = Date.parse("2026-10-20T10:00:00Z");
    const file = writeLastResult("ship_release", { cwd: join(dir, "sub") }, { success: true, merged: "main" }, { now });
    expect(file).toBe(join(dir, ".claude", LAST_RESULT_FILE));
    const entry = JSON.parse(readFileSync(file, "utf8"));
    expect(entry).toMatchObject({ tool: "ship_release", at: "2026-10-20T10:00:00.000Z", result: { success: true, merged: "main" } });
    expect(entry.root.toLowerCase()).toBe(dir.toLowerCase());
    expect(readdirSync(join(dir, ".claude")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("no cwd → nothing written, never throws", () => {
    expect(writeLastResult("ship_release", {}, { success: true })).toBeNull();
    expect(writeLastResult("ship_release", null, { success: true })).toBeNull();
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  test("the CLI writes it after every handler result", () => {
    const cli = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "cli.js"), "utf8");
    expect(cli).toMatch(/writeLastResult\(tool, parsed\.data, result\)/);
  });
});
