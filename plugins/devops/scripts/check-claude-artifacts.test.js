import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readCoveredEntries,
  isCovered,
  scanArtifacts,
  BLOCK_START,
  BLOCK_END,
} from "./check-claude-artifacts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "check-claude-artifacts.js");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const SKILL = path.join(PLUGIN_ROOT, "skills", "setup-project", "SKILL.md");

// Spawns a cold `node` while 70 other files do the same — see the note in
// pre.tokens.guard.graphgate.test.js. 30s catches a hang without flaking.
vi.setConfig({ testTimeout: 30_000 });

describe("check-claude-artifacts — the ignore list stays complete (#292)", () => {
  test("the repo currently passes its own guard", () => {
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, REPO_ROOT], { encoding: "utf8" }),
    ).not.toThrow();
  });

  test("the marked block is present and replaceable in place", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    // Exactly one marker pair — two would make in-place replacement ambiguous
    // and is how the "appending duplicates" problem reappears.
    expect(text.split(BLOCK_START).length - 1).toBe(1);
    expect(text.split(BLOCK_END).length - 1).toBe(1);
    expect(text.indexOf(BLOCK_START)).toBeLessThan(text.indexOf(BLOCK_END));
  });

  test("every artifact the plugin writes into a project is covered", () => {
    const covered = readCoveredEntries(SKILL);
    for (const name of scanArtifacts(PLUGIN_ROOT).keys()) {
      expect(isCovered(name, covered), `.claude/${name} is not ignored`).toBe(true);
    }
  });

  test("home-rooted state is NOT listed — it cannot dirty a repo", () => {
    const covered = readCoveredEntries(SKILL);
    for (const homeOnly of [
      "claude-batch.json", "graphify-metrics.jsonl", "usage-live.json",
      "usage-baseline.json", "edge-usage-profile", "concept-bridges",
      "devops-concepts",
    ]) {
      expect(isCovered(homeOnly, covered), `${homeOnly} lives under ~/.claude`).toBe(false);
    }
  });

  test("configuration stays tracked — never ignored", () => {
    const covered = readCoveredEntries(SKILL);
    for (const cfg of ["graphify.json", "settings.json"]) {
      expect(isCovered(cfg, covered), `${cfg} must stay tracked`).toBe(false);
    }
  });

  test("isCovered understands the wildcard entries", () => {
    expect(isCovered("debug.log", ["*.log"])).toBe(true);
    expect(isCovered("debug.log", ["*.json"])).toBe(false);
    expect(isCovered("batch-activity", ["batch-activity"])).toBe(true);
    // A wildcard must not cross a path segment.
    expect(isCovered("sub/x.log", ["*.log"])).toBe(false);
  });

  test("a new uncovered artifact fails the guard", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "artifacts-guard-"));
    const dir = path.join(fake, "plugins", "devops", "hooks");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(fake, "plugins", "devops", "skills", "setup-project"), { recursive: true });
    fs.copyFileSync(SKILL, path.join(fake, "plugins", "devops", "skills", "setup-project", "SKILL.md"));
    fs.writeFileSync(
      path.join(dir, "new-feature.js"),
      "const p = join(cwd, '.claude', 'brand-new-state.json');\n",
    );

    let failed = false, out = "";
    try {
      execFileSync(process.execPath, [SCRIPT, fake], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      failed = true;
      out = String(e.stderr || "");
    }
    expect(failed).toBe(true);
    expect(out).toContain("brand-new-state.json");
    fs.rmSync(fake, { recursive: true, force: true });
  });
});
