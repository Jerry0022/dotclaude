import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// This file spawns a real detached process (that IS the contract under test).
// Process-start tail latency on a loaded machine easily exceeds vitest's 5s
// default, so give it the same headroom the other spawn-heavy suites use.
vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const lib = require("./cache-rebuild.js");

/**
 * Tests for the extracted plugin-cache rebuild (#324).
 *
 * Everything happens under os.tmpdir(): cacheDir and registryFile are injected
 * parameters precisely so the real ~/.claude/plugins is never touched. A test
 * that rewrote the developer's own installed_plugins.json would be worse than
 * no test at all.
 */

let root;
let src;
let cacheDir;
let registryFile;

function write(base, rel, content) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** A realistic plugin source tree, including a fat node_modules. */
function makeSource(dir, version = "1.2.3", deps = '{"dependencies":{"zod":"^3"}}') {
  write(dir, ".mcp.json", '{"mcpServers":{}}');
  write(dir, path.join(".claude-plugin", "plugin.json"), JSON.stringify({ version }));
  write(dir, path.join("mcp-server", "index.js"), "export const x = 1;");
  write(dir, path.join("mcp-server", "package.json"), deps);
  write(dir, path.join("mcp-server", "lib", "heartbeat.js"), "export const hb = 1;");
  write(dir, path.join("mcp-server", "ship", "index.js"), "export const ship = 1;");
  write(dir, path.join("mcp-server", "issues", "index.js"), "export const issues = 1;");
  write(dir, path.join("hooks", "hooks.json"), "{}");
  write(dir, path.join("skills", "demo", "SKILL.md"), "# demo");
  // The bulk the rebuild must never copy.
  for (let i = 0; i < 25; i++) {
    write(dir, path.join("mcp-server", "node_modules", "pkg" + i, "index.js"), "module.exports=1;");
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-cacherebuild-"));
  src = path.join(root, "src");
  cacheDir = path.join(root, "cache");
  registryFile = path.join(root, "installed_plugins.json");
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(registryFile, JSON.stringify({ plugins: {} }, null, 2));
  makeSource(src);
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows lock */ }
});

function rebuildOpts(overrides = {}) {
  return {
    marketplace: "acme",
    pluginName: "devops",
    pluginDir: src,
    version: "1.2.3",
    sha: "abc1234",
    channel: "stable",
    cacheDir,
    registryFile,
    ...overrides,
  };
}

describe("copyDir", () => {
  test("mirrors dotfiles and nested dirs but never node_modules", () => {
    const dst = path.join(root, "dst");
    expect(lib.copyDir(src, dst)).toBe(true);

    expect(fs.existsSync(path.join(dst, ".mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(dst, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(dst, "mcp-server", "lib", "heartbeat.js"))).toBe(true);
    expect(fs.existsSync(path.join(dst, "skills", "demo", "SKILL.md"))).toBe(true);

    // The whole point of #324: the 97% bulk stays out of the copy.
    expect(fs.existsSync(path.join(dst, "mcp-server", "node_modules"))).toBe(false);
  });

  test("reports failure when the source is not a plugin root", () => {
    const empty = path.join(root, "empty");
    fs.mkdirSync(empty);
    expect(lib.copyDir(empty, path.join(root, "dst2"))).toBe(false);
  });
});

describe("depsHash", () => {
  test("changes with the dependency manifest and is null without one", () => {
    const other = path.join(root, "other");
    makeSource(other, "1.2.3", '{"dependencies":{"zod":"^4"}}');
    expect(lib.depsHash(src)).not.toBe(lib.depsHash(other));
    expect(lib.depsHash(path.join(root, "nothing"))).toBeNull();
  });
});

describe("syncNodeModules", () => {
  test("gives the target a usable node_modules without copying the bulk", () => {
    const dst = path.join(root, "dst");
    lib.copyDir(src, dst);
    const report = lib.syncNodeModules(src, dst, { depsChanged: false });

    const linked = path.join(dst, "mcp-server", "node_modules");
    expect(fs.existsSync(linked)).toBe(true);
    expect(fs.existsSync(path.join(linked, "pkg0", "index.js"))).toBe(true);
    // Linked (cheap) on a machine that allows it, copied only as a fallback.
    expect(report.linked.length + report.copied.length).toBeGreaterThan(0);
  });

  test("reuses an existing node_modules when the deps are unchanged", () => {
    const dst = path.join(root, "dst");
    lib.copyDir(src, dst);
    const target = path.join(dst, "mcp-server", "node_modules");
    write(dst, path.join("mcp-server", "node_modules", "marker.txt"), "keep me");

    const report = lib.syncNodeModules(src, dst, { depsChanged: false });
    expect(fs.readFileSync(path.join(target, "marker.txt"), "utf8")).toBe("keep me");
    expect(report.linked).toEqual([]);
    expect(report.dropped).toEqual([]);
  });

  test("drops a stale node_modules when the deps changed", () => {
    const dst = path.join(root, "dst");
    lib.copyDir(src, dst);
    write(dst, path.join("mcp-server", "node_modules", "stale.txt"), "old");

    const report = lib.syncNodeModules(src, dst, { depsChanged: true });
    expect(report.dropped).toContain("mcp-server");
    expect(fs.existsSync(path.join(dst, "mcp-server", "node_modules", "stale.txt"))).toBe(false);
  });
});

describe("rebuildCache", () => {
  test("builds the version dir, verifies it and repoints the registry", () => {
    const result = lib.rebuildCache(rebuildOpts());
    expect(result.ok).toBe(true);

    const versionDir = path.join(cacheDir, "acme", "devops", "1.2.3");
    expect(result.installPath).toBe(versionDir);
    expect(fs.existsSync(path.join(versionDir, "mcp-server", "ship", "index.js"))).toBe(true);

    const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    const entry = registry.plugins["devops@acme"][0];
    expect(entry.version).toBe("1.2.3");
    expect(entry.gitCommitSha).toBe("abc1234");
    expect(entry.channel).toBe("stable");
    expect(path.resolve(entry.installPath)).toBe(path.resolve(versionDir));
  });

  test("fails loudly instead of registering a half-built cache", () => {
    const broken = path.join(root, "broken");
    fs.mkdirSync(broken, { recursive: true });
    const result = lib.rebuildCache(rebuildOpts({ pluginDir: broken }));
    expect(result.ok).toBe(false);
    expect(result.missing).toMatch(/copy failed/);

    // Registry untouched — the next session must retry, not trust this.
    const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    expect(registry.plugins["devops@acme"]).toBeUndefined();
  });

  test("prunes an unclaimed older version dir", () => {
    const old = path.join(cacheDir, "acme", "devops", "1.0.0");
    fs.mkdirSync(old, { recursive: true });
    lib.rebuildCache(rebuildOpts());
    expect(fs.existsSync(old)).toBe(false);
  });
});

describe("targetIsLive", () => {
  test("an unclaimed version dir is not live", () => {
    expect(lib.targetIsLive(rebuildOpts())).toBe(false);
  });

  test("a dir claimed by this very process is live", () => {
    const versionDir = path.join(cacheDir, "acme", "devops", "1.2.3");
    fs.mkdirSync(path.join(versionDir, ".in_use"), { recursive: true });
    fs.writeFileSync(
      path.join(versionDir, ".in_use", String(process.pid)),
      JSON.stringify({ pid: process.pid }),
    );
    expect(lib.targetIsLive(rebuildOpts())).toBe(true);
  });
});

describe("deferRebuild", () => {
  test("returns immediately and the detached child does the work", async () => {
    const doneMarker = path.join(root, "done.json");
    const startedAt = Date.now();
    const handoff = lib.deferRebuild(rebuildOpts({ doneMarker }), { delayMs: 0 });

    // The parent must not wait — the SessionStart hook that calls this has to
    // exit, or deferring would be worse than the bug it fixes.
    expect(handoff.deferred).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_000);

    const versionDir = path.join(cacheDir, "acme", "devops", "1.2.3");
    for (let i = 0; i < 200 && !fs.existsSync(doneMarker); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.existsSync(doneMarker)).toBe(true);
    expect(JSON.parse(fs.readFileSync(doneMarker, "utf8")).ok).toBe(true);
    expect(fs.existsSync(path.join(versionDir, ".mcp.json"))).toBe(true);
  });

  test("the delay is honoured — nothing is written before it elapses", async () => {
    const doneMarker = path.join(root, "late.json");
    lib.deferRebuild(rebuildOpts({ doneMarker }), { delayMs: 3_000 });
    await new Promise((r) => setTimeout(r, 800));
    expect(fs.existsSync(path.join(cacheDir, "acme", "devops", "1.2.3", ".mcp.json"))).toBe(false);
  });

  test("the default delay clears a 30s MCP connect window", () => {
    expect(lib.DEFER_DELAY_MS).toBeGreaterThanOrEqual(60_000);
  });
});

/**
 * The cooldown-bypass probe (#324 follow-up).
 *
 * ss.plugin.update's 6 h gate sits in front of the local cache-integrity checks,
 * so without this probe a cache that broke mid-window stays broken for six hours
 * — including the exact case ss.mcp.verify tells the user a restart repairs.
 * marketplacesDir/registryFile are injected so these run entirely under tmpdir.
 */
describe("cacheBroken", () => {
  let marketplacesDir;
  let clone;
  let installPath;

  /** A marketplace clone + a registry entry pointing at a healthy cache copy. */
  function makeInstalled({ version = "1.2.3", cachedVersion = version } = {}) {
    marketplacesDir = path.join(root, "marketplaces");
    clone = path.join(marketplacesDir, "acme");
    fs.mkdirSync(path.join(clone, ".git"), { recursive: true });
    makeSource(path.join(clone, "plugins", "devops"), version);

    installPath = path.join(cacheDir, "acme", "devops", cachedVersion);
    makeSource(installPath, cachedVersion);

    fs.writeFileSync(registryFile, JSON.stringify({
      plugins: { "devops@acme": [{ scope: "user", installPath, version: cachedVersion }] },
    }, null, 2));
  }

  function probe() {
    return lib.cacheBroken({ marketplacesDir, registryFile });
  }

  test("a healthy cache is not broken — the cooldown stands", () => {
    makeInstalled();
    expect(probe()).toEqual({ broken: false, reason: null });
  });

  test("a registry installPath that no longer exists bypasses the cooldown", () => {
    makeInstalled();
    fs.rmSync(installPath, { recursive: true, force: true });
    const result = probe();
    expect(result.broken).toBe(true);
    expect(result.reason).toContain("installPath missing");
  });

  test("a cached version that drifted from the clone bypasses the cooldown", () => {
    makeInstalled({ version: "1.2.3", cachedVersion: "1.0.0" });
    const result = probe();
    expect(result.broken).toBe(true);
    expect(result.reason).toContain("1.0.0");
    expect(result.reason).toContain("1.2.3");
  });

  test("an MCP-critical file missing from the cache bypasses the cooldown", () => {
    makeInstalled();
    fs.rmSync(path.join(installPath, ".mcp.json"), { force: true });
    const result = probe();
    expect(result.broken).toBe(true);
    expect(result.reason).toContain(".mcp.json");
  });

  test("a root-level single-plugin marketplace is enumerated too", () => {
    marketplacesDir = path.join(root, "marketplaces");
    clone = path.join(marketplacesDir, "solo");
    fs.mkdirSync(path.join(clone, ".git"), { recursive: true });
    makeSource(clone, "2.0.0");
    fs.writeFileSync(registryFile, JSON.stringify({
      plugins: { "solo@solo": [{ installPath: path.join(cacheDir, "gone"), version: "2.0.0" }] },
    }, null, 2));
    expect(probe().broken).toBe(true);
  });

  test("a plugin with no registry entry is not a breakage", () => {
    makeInstalled();
    fs.writeFileSync(registryFile, JSON.stringify({ plugins: {} }, null, 2));
    expect(probe().broken).toBe(false);
  });

  test("an unreadable registry or missing marketplaces dir leaves the gate closed", () => {
    marketplacesDir = path.join(root, "does-not-exist");
    expect(probe().broken).toBe(false);
    fs.writeFileSync(registryFile, "{ not json");
    expect(probe().broken).toBe(false);
  });

  test("the probe never shells out — no git, no network", () => {
    makeInstalled();
    const spy = vi.spyOn(require("node:child_process"), "execSync");
    probe();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
