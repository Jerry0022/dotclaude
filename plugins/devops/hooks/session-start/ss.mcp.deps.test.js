import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * ss.mcp.deps must never leave a server dir linked to a truncated install:
 * a stale junction to an install whose @modelcontextprotocol/sdk lost its
 * package.json (only LICENSE + dist/ left) is relinked to the healthy data dir.
 * The fixture data dir is complete and its package.json matches the source, so
 * no `npm install` runs.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "ss.mcp.deps.js");
const SOURCE_PKG = path.join(HERE, "..", "..", "mcp-server", "package.json");

function makeModules(dir, { complete }) {
  for (const pkg of ["@modelcontextprotocol/sdk", "zod"]) {
    const p = path.join(dir, ...pkg.split("/"));
    fs.mkdirSync(path.join(p, "dist"), { recursive: true });
    if (complete || pkg === "zod") fs.writeFileSync(path.join(p, "package.json"), "{}");
  }
}

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-deps-")); });
afterEach(() => {
  // Unlink junctions first so rmSync can never reach through them.
  for (const sub of ["", "ship", "issues"]) {
    const link = path.join(root, "plugin", "mcp-server", sub, "node_modules");
    try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch { /* absent */ }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ss.mcp.deps", () => {
  test("relinks a junction that points at a truncated install", () => {
    const pluginRoot = path.join(root, "plugin");
    const data = path.join(root, "data-good");
    const bad = path.join(root, "data-bad", "node_modules");
    for (const sub of ["", "ship", "issues"]) fs.mkdirSync(path.join(pluginRoot, "mcp-server", sub), { recursive: true });
    fs.copyFileSync(SOURCE_PKG, path.join(pluginRoot, "mcp-server", "package.json"));
    fs.mkdirSync(data, { recursive: true });
    fs.copyFileSync(SOURCE_PKG, path.join(data, "package.json"));
    makeModules(path.join(data, "node_modules"), { complete: true });
    makeModules(bad, { complete: false });
    const shipLink = path.join(pluginRoot, "mcp-server", "ship", "node_modules");
    fs.symlinkSync(bad, shipLink, "junction");

    const r = spawnSync(process.execPath, [HOOK], {
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: data },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    for (const sub of ["", "ship", "issues"]) {
      const link = path.join(pluginRoot, "mcp-server", sub, "node_modules");
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(link, "@modelcontextprotocol", "sdk", "package.json"))).toBe(true);
    }
    // The truncated install itself is untouched: unlink drops only the link.
    expect(fs.existsSync(path.join(bad, "@modelcontextprotocol", "sdk", "dist"))).toBe(true);
  });
});
