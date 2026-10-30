import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isRpmCopy, desktopCopyLag } = require("./desktop-copy");

function writePlugin(dir, name, version) {
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version }));
}

describe("desktop-copy", () => {
  let tmp, rpmRoot, marketplacesDir;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-copy-"));
    const userDir = path.join(tmp, "Claude-Data", "rpm", "2c09286c", "394def81");
    rpmRoot = path.join(userDir, "plugin_0182abc");
    writePlugin(rpmRoot, "devops", "0.326.0");
    fs.writeFileSync(path.join(userDir, "manifest.json"), JSON.stringify({
      plugins: [{ id: "plugin_0182abc", name: "devops", marketplaceName: "dotclaude", updatedAt: "2026-10-26T21:02:41Z" }],
    }));
    marketplacesDir = path.join(tmp, "marketplaces");
    writePlugin(path.join(marketplacesDir, "dotclaude", "plugins", "devops"), "devops", "0.334.1");
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test("isRpmCopy matches the Desktop rpm layout, not the CLI cache", () => {
    expect(isRpmCopy(rpmRoot)).toBe(true);
    expect(isRpmCopy("C:/Users/x/.claude/plugins/cache/dotclaude/devops/0.334.1")).toBe(false);
    expect(isRpmCopy("P:/Projects/rpm-tools/plugins/devops")).toBe(false);
  });

  test("reports an rpm copy that trails the marketplace clone", () => {
    expect(desktopCopyLag({ pluginRoot: rpmRoot, marketplacesDir })).toEqual({
      name: "devops",
      running: "0.326.0",
      latest: "0.334.1",
      marketplace: "dotclaude",
      updatedAt: "2026-10-26T21:02:41Z",
    });
  });

  test("silent when the rpm copy is current or ahead", () => {
    writePlugin(rpmRoot, "devops", "0.334.1");
    expect(desktopCopyLag({ pluginRoot: rpmRoot, marketplacesDir })).toBeNull();
    writePlugin(rpmRoot, "devops", "0.335.0");
    expect(desktopCopyLag({ pluginRoot: rpmRoot, marketplacesDir })).toBeNull();
  });

  test("silent for a CLI cache copy, even when older", () => {
    const cliRoot = path.join(tmp, ".claude", "plugins", "cache", "dotclaude", "devops", "0.300.0");
    writePlugin(cliRoot, "devops", "0.300.0");
    expect(desktopCopyLag({ pluginRoot: cliRoot, marketplacesDir })).toBeNull();
  });

  test("silent without a manifest entry or a matching marketplace clone", () => {
    fs.rmSync(path.join(marketplacesDir, "dotclaude"), { recursive: true });
    expect(desktopCopyLag({ pluginRoot: rpmRoot, marketplacesDir })).toBeNull();
    fs.rmSync(path.join(path.dirname(rpmRoot), "manifest.json"));
    expect(desktopCopyLag({ pluginRoot: rpmRoot, marketplacesDir })).toBeNull();
  });
});
