import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Characterization test for the copy primitive behind ss.plugin.update.js's
 * copyDir() — issue #190.
 *
 * The bug: copyDir() shelled out to `cp -a` / `cp -r`, which silently fails on
 * Windows (cp is not a cmd.exe builtin and Git's coreutils are usually off the
 * PATH that Node's execSync sees). A failed copy left a partial plugin cache —
 * missing mcp-server/*.js, .mcp.json, and hooks — that crashed every MCP server
 * with ERR_MODULE_NOT_FOUND. The fix replaces the shell-out with
 *   fs.cpSync(src, dst, { recursive: true, force: true })
 *
 * copyDir() is a non-exported internal of a SessionStart hook whose module body
 * self-executes (reads ~/.claude/plugins, can process.exit) on import. Importing
 * it would run that logic, and exporting copyDir purely to test it would contort
 * production code. So this test exercises the EXACT primitive the fix relies on,
 * with the EXACT options the production call passes, against a temp source tree
 * that reproduces the structures the old `cp` shell-out dropped:
 *   - dotfiles at the root (.mcp.json)
 *   - dot-directories (.claude-plugin/plugin.json)
 *   - a nested mcp-server/ tree (index.js + lib/ + ship/ + issues/)
 *   - the hooks/ + skills/ dirs the completeness guard asserts
 * and asserts the destination is a complete, byte-faithful mirror.
 *
 * This locks in the platform guarantee the fix depends on (fs.cpSync copies
 * dotfiles + nested dirs recursively here) without touching production code.
 */

// Mirror of the production call site in copyDir().
function copyTree(src, dst) {
  fs.cpSync(src, dst, { recursive: true, force: true });
}

let tmpRoot;
let src;
let dst;

// The MCP-critical files ss.plugin.update.js verifies post-copy (MCP_CRITICAL_FILES).
// A dropped copy of any of these is exactly the #190 breakage.
const MCP_CRITICAL_FILES = [
  ".mcp.json",
  path.join("mcp-server", "index.js"),
  path.join("mcp-server", "lib", "heartbeat.js"),
  path.join("mcp-server", "ship", "index.js"),
  path.join("mcp-server", "issues", "index.js"),
];

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-copydir-"));
  src = path.join(tmpRoot, "src");
  dst = path.join(tmpRoot, "dst");
  fs.mkdirSync(src, { recursive: true });

  // A realistic plugin source tree: dotfiles, dot-dirs, nested mcp-server,
  // hooks, skills — the shapes the old `cp` shell-out silently dropped.
  write(src, ".mcp.json", '{"mcpServers":{}}');
  write(src, path.join(".claude-plugin", "plugin.json"), '{"version":"9.9.9"}');
  write(src, path.join("mcp-server", "index.js"), "export const x = 1;");
  write(src, path.join("mcp-server", "lib", "heartbeat.js"), "export const hb = 1;");
  write(src, path.join("mcp-server", "ship", "index.js"), "export const ship = 1;");
  write(src, path.join("mcp-server", "issues", "index.js"), "export const issues = 1;");
  write(src, path.join("hooks", "hooks.json"), "{}");
  write(src, path.join("hooks", "session-start", "ss.x.js"), "// hook");
  write(src, path.join("skills", "devops-x", "SKILL.md"), "# skill");
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("ss.plugin.update copyDir primitive (fs.cpSync) — issue #190", () => {
  test("copies the .claude-plugin/plugin.json sentinel copyDir checks for", () => {
    copyTree(src, dst);
    // copyDir() returns true iff this file exists post-copy — its success signal.
    expect(fs.existsSync(path.join(dst, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(fs.readFileSync(path.join(dst, ".claude-plugin", "plugin.json"), "utf8")).toBe('{"version":"9.9.9"}');
  });

  test("copies root-level dotfile (.mcp.json) — dropped by the old cp glob", () => {
    copyTree(src, dst);
    expect(fs.existsSync(path.join(dst, ".mcp.json"))).toBe(true);
    expect(fs.readFileSync(path.join(dst, ".mcp.json"), "utf8")).toBe('{"mcpServers":{}}');
  });

  test("copies the full nested mcp-server tree (all MCP_CRITICAL_FILES present)", () => {
    copyTree(src, dst);
    const missing = MCP_CRITICAL_FILES.filter((rel) => !fs.existsSync(path.join(dst, rel)));
    expect(missing).toEqual([]);
  });

  test("copies hooks/ and skills/ dirs the completeness guard asserts", () => {
    copyTree(src, dst);
    expect(fs.existsSync(path.join(dst, "hooks"))).toBe(true);
    expect(fs.existsSync(path.join(dst, "skills"))).toBe(true);
    expect(fs.existsSync(path.join(dst, "hooks", "session-start", "ss.x.js"))).toBe(true);
    expect(fs.existsSync(path.join(dst, "skills", "devops-x", "SKILL.md"))).toBe(true);
  });

  test("destination mirrors the full source file set (no dropped paths)", () => {
    copyTree(src, dst);
    // Collect all file paths under `root`, relative to `base`, sorted.
    const walk = (root, base) => {
      const out = [];
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, e.name);
        if (e.isDirectory()) out.push(...walk(full, base));
        else out.push(path.relative(base, full));
      }
      return out.sort();
    };
    expect(walk(dst, dst)).toEqual(walk(src, src));
  });

  test("force:true overwrites a pre-existing partial cache (in-place repair path)", () => {
    // Simulate a stale/partial cache already present at the destination.
    write(dst, path.join(".claude-plugin", "plugin.json"), '{"version":"0.0.1-old"}');
    write(dst, "stale-only.txt", "leftover");
    copyTree(src, dst);
    // Overwritten with the new content...
    expect(fs.readFileSync(path.join(dst, ".claude-plugin", "plugin.json"), "utf8")).toBe('{"version":"9.9.9"}');
    // ...and the new tree is complete.
    expect(MCP_CRITICAL_FILES.every((rel) => fs.existsSync(path.join(dst, rel)))).toBe(true);
  });
});

/**
 * Regression guard for the #219 in-place repair: a real fs.cpSync THROW must
 * surface as a failed copy (copyDir → false), NOT be masked by a pre-existing
 * .claude-plugin/plugin.json the in-place overwrite leaves behind.
 *
 * Before the fix, copyDir caught any cpSync error and fell back to a `cp -a`
 * shell-out that is a no-op on Windows, then returned true because the OLD
 * plugin.json (from the dir being overwritten in place) still existed. That made
 * rebuildCache report ok:true over a half-copied cache and advance the registry
 * SHA — silently suppressing the self-healing retry next session. The fix gates
 * the shell fallback on fs.cpSync being UNAVAILABLE and returns false on a throw.
 */

// Mirror of production copyDir() AFTER the #219 hardening (cpSync injected so the
// throw path is testable; in real Node fs.cpSync is always a function).
function copyDirMirror(src, dst, cpSync) {
  if (typeof cpSync === "function") {
    try {
      cpSync(src, dst, { recursive: true, force: true });
    } catch {
      return false;
    }
  }
  return fs.existsSync(path.join(dst, ".claude-plugin", "plugin.json"));
}

describe("ss.plugin.update copyDir surfaces real cpSync failures — issue #219", () => {
  test("a successful copy still returns true", () => {
    write(src, path.join(".claude-plugin", "plugin.json"), '{"version":"9.9.9"}');
    expect(copyDirMirror(src, dst, fs.cpSync)).toBe(true);
    expect(fs.existsSync(path.join(dst, ".claude-plugin", "plugin.json"))).toBe(true);
  });

  test("a cpSync throw over an in-place dir with an OLD plugin.json returns false (failure not masked)", () => {
    // The in-place repair overwrites an existing version dir → the OLD sentinel
    // is already present and would mask a partial copy via the existence check.
    write(dst, path.join(".claude-plugin", "plugin.json"), '{"version":"0.0.1-old"}');
    const throwingCpSync = () => { throw new Error("EBUSY: resource busy or locked"); };
    // Even though the old sentinel exists, the throw must surface as false so the
    // caller returns ok:false and does NOT advance the registry SHA.
    expect(copyDirMirror(src, dst, throwingCpSync)).toBe(false);
  });

  test("a cpSync throw on an empty destination returns false", () => {
    const throwingCpSync = () => { throw new Error("EPERM: operation not permitted"); };
    expect(copyDirMirror(src, dst, throwingCpSync)).toBe(false);
  });
});
