import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

/**
 * The bug: `claude plugin eval` (and `claude --plugin-dir`) load the plugin
 * without writing it into any settings.json, and the eval sandbox runs with a
 * fresh HOME — so plugin-guard exited every hook silently and behavioral
 * evals could never see hook-injected context (observed 2026-09-14: all
 * SessionStart hooks returned "" in an eval trace). A hook running from a
 * path outside ~/.claude/plugins/cache/ is by definition an explicit load.
 */

const GUARD = path.resolve(import.meta.dirname, "plugin-guard.js");

function runGuard({ home, cwd, pluginRoot }) {
  const probe = path.join(cwd, "probe.cjs");
  fs.writeFileSync(
    probe,
    `require(${JSON.stringify(GUARD)}); process.stdout.write("alive");`,
  );
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  if (pluginRoot === undefined) delete env.CLAUDE_PLUGIN_ROOT;
  else env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  const r = spawnSync(process.execPath, [probe], { cwd, env, encoding: "utf8" });
  return r.stdout;
}

function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guard-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guard-cwd-"));
  return { home, cwd };
}

describe("plugin-guard", () => {
  test("fresh HOME, no settings, no plugin root → hook is silenced (unchanged)", () => {
    const { home, cwd } = freshHome();
    expect(runGuard({ home, cwd, pluginRoot: undefined })).toBe("");
  });

  test("fresh HOME, hook running from the install cache → still silenced", () => {
    const { home, cwd } = freshHome();
    const cached = path.join(home, ".claude", "plugins", "cache", "dotclaude", "devops", "0.1.0");
    expect(runGuard({ home, cwd, pluginRoot: cached })).toBe("");
  });

  test("fresh HOME, hook running from a source dir (--plugin-dir / eval) → passes", () => {
    const { home, cwd } = freshHome();
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "guard-src-"));
    expect(runGuard({ home, cwd, pluginRoot: src })).toBe("alive");
  });

  test("plugin enabled in project settings → passes regardless of plugin root", () => {
    const { home, cwd } = freshHome();
    fs.mkdirSync(path.join(cwd, ".claude"));
    fs.writeFileSync(
      path.join(cwd, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
    );
    const cached = path.join(home, ".claude", "plugins", "cache", "dotclaude", "devops", "0.1.0");
    expect(runGuard({ home, cwd, pluginRoot: cached })).toBe("alive");
  });

  test("project settings at the repo root still apply when the cwd is a subdirectory", () => {
    const { home, cwd: root } = freshHome();
    execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
    fs.mkdirSync(path.join(root, ".claude"));
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
    );
    const sub = path.join(root, "plugins", "devops", "scripts");
    fs.mkdirSync(sub, { recursive: true });
    const cached = path.join(home, ".claude", "plugins", "cache", "dotclaude", "devops", "0.1.0");
    expect(runGuard({ home, cwd: sub, pluginRoot: cached })).toBe("alive");
  });
});
