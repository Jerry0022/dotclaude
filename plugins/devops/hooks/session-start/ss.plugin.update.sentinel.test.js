import { describe, test, expect } from "vitest";
import path from "node:path";

/**
 * Characterization test for the MCP-stale sentinel decision in
 * ss.plugin.update.js — the fix that writes ~/.claude/plugins/.mcp-stale.json
 * whenever a rebuild MOVES the installPath, not only on a git-HEAD version bump.
 *
 * The bug: the sentinel was gated on `versionChanged` (= headChanged && version
 * differs). But a cacheStale rebuild can repoint the registry installPath to a
 * NEW version dir with headChanged=false — e.g. the marketplace clone was pulled
 * to the new version in an EARLIER session, but the cache/registry still point at
 * the old version dir. rebuildCache then deletes the old dir (the new version dir
 * doesn't exist yet → inPlace=false → fs.rmSync(pluginCache)) and registers the
 * new one. The running MCP servers, spawned from the now-deleted old installPath,
 * are stale — but no sentinel was written, so pre.mcp.health let their tool calls
 * through to read deleted/old files. Observed 2026-06-22: marketplace 0.104.1,
 * registry still installPath …\devops\0.104.0, no .mcp-stale.json.
 *
 * rebuildCache()/the rebuild loop are non-exported internals of a SessionStart
 * hook whose module body self-executes on import (see the #190 copydir and #219
 * inplace tests for the same constraint). So this mirrors the EXACT decision the
 * fix encodes — `installMoved && hasMcp` where installMoved compares the registry
 * installPath captured BEFORE the rebuild against rebuildCache's returned
 * installPath (newCache) — against realistic native-separator cache paths.
 */

// Mirror of the sentinel decision in the rebuild loop (post-fix).
//   previousInstallPath: registry installPath BEFORE rebuildCache (what the
//     running MCP server was spawned from), or null when there is no entry.
//   newInstallPath: rebuildCache result.installPath (newCache), or null on failure.
//   hasMcp: source plugin ships an .mcp.json.
function shouldFlagMcpStale({ resultOk, previousInstallPath, newInstallPath, hasMcp }) {
  const installMoved =
    resultOk &&
    previousInstallPath != null &&
    newInstallPath != null &&
    path.resolve(previousInstallPath) !== path.resolve(newInstallPath);
  return installMoved && hasMcp;
}

// Realistic cache layout: ~/.claude/plugins/cache/dotclaude/devops/<version>.
// Built with path.join so both sides use the SAME native separator — exactly as
// production does (registry stores installPath with path.sep; newCache comes from
// path.join). A same-version repair therefore yields byte-identical strings.
const CACHE = path.join("C:", "Users", "x", ".claude", "plugins", "cache", "dotclaude", "devops");
const v = (version) => path.join(CACHE, version);

describe("ss.plugin.update MCP-stale sentinel decision", () => {
  test("stale cache, HEAD did not move: rebuild moves 0.104.0 → 0.104.1 → sentinel IS written", () => {
    // The exact regression: marketplace already pulled to the new version in a
    // prior session, cache still on the old version dir. headChanged=false, so
    // the OLD code wrote no sentinel; the fix flags the move.
    expect(
      shouldFlagMcpStale({
        resultOk: true,
        previousInstallPath: v("0.104.0"),
        newInstallPath: v("0.104.1"),
        hasMcp: true,
      }),
    ).toBe(true);
  });

  test("version upgrade (HEAD moved): 0.104.0 → 0.105.0 still writes the sentinel", () => {
    expect(
      shouldFlagMcpStale({
        resultOk: true,
        previousInstallPath: v("0.104.0"),
        newInstallPath: v("0.105.0"),
        hasMcp: true,
      }),
    ).toBe(true);
  });

  test("same-version in-place repair: installPath unchanged → NO sentinel (#219 preserved)", () => {
    // The RAM-resident Node process keeps working; nuking it would needlessly
    // force a restart. previousInstallPath === newInstallPath → not a move.
    expect(
      shouldFlagMcpStale({
        resultOk: true,
        previousInstallPath: v("0.104.1"),
        newInstallPath: v("0.104.1"),
        hasMcp: true,
      }),
    ).toBe(false);
  });

  test("first install (no prior registry entry) → NO sentinel", () => {
    expect(
      shouldFlagMcpStale({
        resultOk: true,
        previousInstallPath: null,
        newInstallPath: v("0.104.1"),
        hasMcp: true,
      }),
    ).toBe(false);
  });

  test("plugin without an MCP server → NO sentinel even when the install moves", () => {
    expect(
      shouldFlagMcpStale({
        resultOk: true,
        previousInstallPath: v("0.104.0"),
        newInstallPath: v("0.104.1"),
        hasMcp: false,
      }),
    ).toBe(false);
  });

  test("failed rebuild (result.ok=false) → NO sentinel (registry not repointed)", () => {
    expect(
      shouldFlagMcpStale({
        resultOk: false,
        previousInstallPath: v("0.104.0"),
        newInstallPath: null,
        hasMcp: true,
      }),
    ).toBe(false);
  });
});
