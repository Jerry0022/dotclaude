import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Characterization test for the cache-cleanup decision in ss.plugin.update.js's
 * rebuildCache() — issue #219.
 *
 * The bug: a same-version cache REPAIR deleted the entire plugin cache dir
 * (`fs.rmSync(pluginCache, { recursive })`) and recreated it. The version dir is
 * exactly what Claude Code's already-loaded skill/slash-command registry points
 * at — nuking and recreating it mid-session changed the dir's identity and
 * de-registered every skill/slash-command for the rest of the session, leaving
 * `/devops-*` as "Unknown command". MCP tools (RAM) and agent types survived;
 * only skills/commands broke.
 *
 * The fix: branch on `versionChanged`. A version UPGRADE still nukes all old
 * version dirs (new installPath, restart needed anyway). A same-version REPAIR
 * overwrites IN PLACE — it keeps the current version dir (preserving its identity
 * so the registry stays valid) and only prunes OTHER (old) version dirs.
 *
 * rebuildCache() is a non-exported internal of a SessionStart hook whose module
 * body self-executes on import (see the #190 copydir test for the same
 * constraint). So this test mirrors the EXACT cleanup decision the fix encodes,
 * against a temp cache tree, and asserts the registry-referenced dir survives an
 * in-place repair but not a version change.
 */

// Mirror of the cleanup block in rebuildCache() (the part the #219 fix changed).
function applyCacheCleanup(pluginCache, version, versionChanged) {
  const newCache = path.join(pluginCache, version);
  const inPlace = !versionChanged && fs.existsSync(newCache);

  if (inPlace) {
    // Keep the current version dir (registry points at it); prune OTHER versions.
    for (const entry of fs.readdirSync(pluginCache)) {
      if (entry !== version) {
        fs.rmSync(path.join(pluginCache, entry), { recursive: true, force: true });
      }
    }
  } else if (fs.existsSync(pluginCache)) {
    // Version change / first build: clean ALL old version dirs.
    fs.rmSync(pluginCache, { recursive: true, force: true });
  }
  fs.mkdirSync(newCache, { recursive: true });
  return { inPlace, newCache };
}

let tmpRoot;
let pluginCache;

// A sentinel inside the version dir standing in for the dir's session identity:
// if it survives, the dir was overwritten in place (registry stays valid); if it
// vanishes, the dir was deleted + recreated (the #219 de-registration trigger).
const VERSION = "0.102.1";
const IDENTITY_MARKER = ".session-identity";

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-inplace-"));
  pluginCache = path.join(tmpRoot, "devops");
  // Current version dir, with a marker that proves dir identity across a repair.
  write(pluginCache, path.join(VERSION, IDENTITY_MARKER), "loaded-registry");
  write(pluginCache, path.join(VERSION, "skills", "ship", "SKILL.md"), "# old");
  // A leftover OLD version dir that any cleanup should prune.
  write(pluginCache, path.join("0.100.0", "skills", "ship", "SKILL.md"), "# stale");
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("ss.plugin.update rebuildCache cleanup decision — issue #219", () => {
  test("same-version repair (versionChanged=false) keeps the version dir's identity", () => {
    const { inPlace } = applyCacheCleanup(pluginCache, VERSION, false);
    expect(inPlace).toBe(true);
    // The marker survives → dir was NOT deleted+recreated → registry stays valid.
    expect(fs.existsSync(path.join(pluginCache, VERSION, IDENTITY_MARKER))).toBe(true);
  });

  test("same-version repair still prunes OTHER (old) version dirs", () => {
    applyCacheCleanup(pluginCache, VERSION, false);
    expect(fs.existsSync(path.join(pluginCache, "0.100.0"))).toBe(false);
    // ...but the cache holds exactly the current version.
    expect(fs.readdirSync(pluginCache)).toEqual([VERSION]);
  });

  test("version change (versionChanged=true) nukes all dirs incl. the marker", () => {
    const { inPlace } = applyCacheCleanup(pluginCache, "0.103.0", true);
    expect(inPlace).toBe(false);
    // Old version dir AND its identity marker are gone — a restart is expected
    // on a real upgrade anyway (new installPath).
    expect(fs.existsSync(path.join(pluginCache, VERSION))).toBe(false);
    expect(fs.existsSync(path.join(pluginCache, "0.100.0"))).toBe(false);
    expect(fs.existsSync(path.join(pluginCache, "0.103.0"))).toBe(true);
  });

  test("first build (cache dir absent) creates the version dir without error", () => {
    fs.rmSync(pluginCache, { recursive: true, force: true });
    const { inPlace, newCache } = applyCacheCleanup(pluginCache, VERSION, false);
    // No existing dir → not an in-place repair; the fresh dir is created.
    expect(inPlace).toBe(false);
    expect(fs.existsSync(newCache)).toBe(true);
  });
});
