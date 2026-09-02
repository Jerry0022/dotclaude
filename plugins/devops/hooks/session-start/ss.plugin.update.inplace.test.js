import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Same CJS module rebuildCache() prunes through — exercised directly so this
// test cannot drift from the shipped decision.
import cacheInUse from "../lib/cache-inuse.js";

const { IN_USE_DIR, prunableEntries } = cacheInUse;

/**
 * Characterization test for the cache-cleanup decision in ss.plugin.update.js's
 * rebuildCache() — issues #219 and the MCP-disconnect regression.
 *
 * #219: a same-version cache REPAIR deleted the entire plugin cache dir
 * (`fs.rmSync(pluginCache, { recursive: true })`) and recreated it. The version
 * dir is exactly what Claude Code's already-loaded skill/slash-command registry
 * points at — nuking and recreating it mid-session changed the dir's identity
 * and de-registered every skill/slash-command for the rest of the session,
 * leaving `/devops-*` as "Unknown command".
 *
 * MCP disconnects: the version-UPGRADE branch still nuked every other version
 * dir. Those dirs are the CLAUDE_PLUGIN_ROOT (`cwd` + require() root) of the MCP
 * servers of every OTHER still-running Claude session, so upgrading in one
 * session broke all the others ("MCP server disconnected"). Claude Code
 * reference-counts loaded version dirs via `<dir>/.in_use/<pid>` markers.
 *
 * The fix collapses both branches into one rule: keep the version dir being
 * built, keep anything a live session still claims, prune the rest.
 *
 * rebuildCache() is a non-exported internal of a SessionStart hook whose module
 * body self-executes on import (see the #190 copydir test for the same
 * constraint), so the cleanup is expressed here via the lib it delegates to.
 */
function applyCacheCleanup(pluginCache, version, isAlive) {
  const newCache = path.join(pluginCache, version);
  // "In place" = the target dir already existed and survived the prune, so its
  // identity (and with it the loaded skill/command registry) is preserved.
  const inPlace = fs.existsSync(newCache);

  for (const entry of prunableEntries(pluginCache, version, isAlive)) {
    fs.rmSync(path.join(pluginCache, entry), { recursive: true, force: true });
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

const LIVE_PID = 4242;
const noneAlive = () => false;
const onlyLive = (pid) => pid === LIVE_PID;

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
  test("same-version repair keeps the version dir's identity", () => {
    const { inPlace } = applyCacheCleanup(pluginCache, VERSION, noneAlive);
    expect(inPlace).toBe(true);
    // The marker survives → dir was NOT deleted+recreated → registry stays valid.
    expect(fs.existsSync(path.join(pluginCache, VERSION, IDENTITY_MARKER))).toBe(true);
  });

  test("same-version repair still prunes OTHER (old) version dirs", () => {
    applyCacheCleanup(pluginCache, VERSION, noneAlive);
    expect(fs.existsSync(path.join(pluginCache, "0.100.0"))).toBe(false);
    // ...but the cache holds exactly the current version.
    expect(fs.readdirSync(pluginCache)).toEqual([VERSION]);
  });

  test("version change prunes every unclaimed dir incl. the marker", () => {
    const { inPlace } = applyCacheCleanup(pluginCache, "0.103.0", noneAlive);
    expect(inPlace).toBe(false);
    // Old version dirs are gone — nothing was standing on them, and a real
    // upgrade expects a restart anyway (new installPath).
    expect(fs.existsSync(path.join(pluginCache, VERSION))).toBe(false);
    expect(fs.existsSync(path.join(pluginCache, "0.100.0"))).toBe(false);
    expect(fs.existsSync(path.join(pluginCache, "0.103.0"))).toBe(true);
  });

  test("first build (cache dir absent) creates the version dir without error", () => {
    fs.rmSync(pluginCache, { recursive: true, force: true });
    const { inPlace, newCache } = applyCacheCleanup(pluginCache, VERSION, noneAlive);
    // No existing dir → not an in-place repair; the fresh dir is created.
    expect(inPlace).toBe(false);
    expect(fs.existsSync(newCache)).toBe(true);
  });
});

describe("ss.plugin.update rebuildCache — MCP servers of other live sessions", () => {
  test("a version change spares the old dir another live session is running from", () => {
    // Another open session loaded VERSION and left its reference-count marker.
    write(
      pluginCache,
      path.join(VERSION, IN_USE_DIR, String(LIVE_PID)),
      JSON.stringify({ pid: LIVE_PID, procStartFt: "134327528064993669" }),
    );

    applyCacheCleanup(pluginCache, "0.103.0", onlyLive);

    // That session's CLAUDE_PLUGIN_ROOT — its MCP servers' cwd and require()
    // root — must still be there, or it reports "MCP server disconnected".
    expect(fs.existsSync(path.join(pluginCache, VERSION, "skills", "ship", "SKILL.md"))).toBe(true);
    // Unclaimed leftovers are still collected.
    expect(fs.existsSync(path.join(pluginCache, "0.100.0"))).toBe(false);
    expect(fs.existsSync(path.join(pluginCache, "0.103.0"))).toBe(true);
  });

  test("once that session exits, the same upgrade collects its dir", () => {
    write(
      pluginCache,
      path.join(VERSION, IN_USE_DIR, String(LIVE_PID)),
      JSON.stringify({ pid: LIVE_PID, procStartFt: "134327528064993669" }),
    );

    applyCacheCleanup(pluginCache, "0.103.0", noneAlive);

    expect(fs.existsSync(path.join(pluginCache, VERSION))).toBe(false);
  });
});
