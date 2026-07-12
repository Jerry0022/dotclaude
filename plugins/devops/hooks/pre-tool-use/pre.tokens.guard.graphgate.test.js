import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { markQueryDone, refreshFlagPath } from "../lib/graphify-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.tokens.guard.js");

const OLD = new Date(Date.now() - 60_000);
const NOW = new Date();

// Isolate the GLOBAL (~/.claude/graphify.json) consent record from whatever
// happens to exist on the machine running this test — without this, isEnabled()
// reads the real $HOME/graphify.json and a globally-opted-out dev machine makes
// every "gate fires" assertion below flake. Same HOME/USERPROFILE-override
// idiom as graphify-state.test.js. No graphify.json is written here, so the
// global record resolves to "absent" (enabled) for all tests below by default.
const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-home-"));
fs.mkdirSync(path.join(HOME_DIR, ".claude"), { recursive: true });

// Build a temp project. graph:"fresh"|"stale"|"none", consent:true|false|null.
function project({ consent, graph }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  // Enable the plugin so plugin-guard does not short-circuit.
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  if (consent !== null) {
    fs.writeFileSync(
      path.join(dir, ".claude", "graphify.json"),
      JSON.stringify({ consent })
    );
  }
  const src = path.join(dir, "a.js");
  fs.writeFileSync(src, "const x = 1;");
  if (graph !== "none") {
    const gp = path.join(dir, "graphify-out", "graph.json");
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    // Must clear hasGraph()'s size floor (MIN_GRAPH_BYTES) to count as present.
    fs.writeFileSync(gp, JSON.stringify({ nodes: Array(50).fill({ id: "x" }) }));
    if (graph === "fresh") {
      fs.utimesSync(src, OLD, OLD);
      fs.utimesSync(gp, NOW, NOW);
    } else { // stale: source newer than graph
      fs.utimesSync(gp, OLD, OLD);
      fs.utimesSync(src, NOW, NOW);
    }
  }
  return dir;
}

function runGrep(dir, sid, pattern, homeDir = HOME_DIR) {
  const res = spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    input: JSON.stringify({ tool_name: "Grep", tool_input: { pattern }, session_id: sid }),
    encoding: "utf8",
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
  });
  return { status: res.status, stderr: res.stderr || "" };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe("pre.tokens.guard — graphify hard-gate (integration)", () => {
  test("consent + fresh graph → first broad search is BLOCKED by the graph gate", () => {
    const dir = project({ consent: true, graph: "fresh" });
    const r = runGrep(dir, "s-block", "alpha");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("retry of the same search relents (escape hatch) — no longer the graph gate", () => {
    const dir = project({ consent: true, graph: "fresh" });
    const first = runGrep(dir, "s-retry", "beta");
    expect(first.stderr).toContain("GRAPHIFY GATE");
    const second = runGrep(dir, "s-retry", "beta");
    expect(second.stderr).not.toContain("GRAPHIFY GATE"); // fell through to the token guard
    cleanup(dir);
  });

  test("no consent record (default-on, opt-out model) → graph gate STILL fires", () => {
    const dir = project({ consent: null, graph: "fresh" });
    const r = runGrep(dir, "s-noconsent", "gamma");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("declined (consent:false) → graph gate never fires", () => {
    const dir = project({ consent: false, graph: "fresh" });
    const r = runGrep(dir, "s-declined", "delta");
    expect(r.stderr).not.toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("stale graph within tolerance (1 newer file) → STILL blocked, with a lag disclosure", () => {
    const dir = project({ consent: true, graph: "stale" });
    const r = runGrep(dir, "s-stale", "epsilon");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GRAPHIFY GATE");
    expect(r.stderr).toContain("graph lags");
    expect(fs.existsSync(refreshFlagPath(dir))).toBe(true); // refresh kicked alongside the block
    cleanup(dir);
  });

  test("after graphify query ran this session → gate relents", () => {
    const dir = project({ consent: true, graph: "fresh" });
    markQueryDone("s-queried", dir);
    const r = runGrep(dir, "s-queried", "zeta");
    expect(r.stderr).not.toContain("GRAPHIFY GATE");
    cleanup(dir);
  });

  test("globally declined (~/.claude/graphify.json consent:false) → gate never fires, even with no project record", () => {
    const dir = project({ consent: null, graph: "fresh" });
    const declinedHome = fs.mkdtempSync(path.join(os.tmpdir(), "graphgate-home-declined-"));
    fs.mkdirSync(path.join(declinedHome, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(declinedHome, ".claude", "graphify.json"),
      JSON.stringify({ consent: false })
    );
    const r = runGrep(dir, "s-global-declined", "eta", declinedHome);
    expect(r.stderr).not.toContain("GRAPHIFY GATE");
    cleanup(dir);
    cleanup(declinedHome);
  });

  test("stale graph BEYOND tolerance → self-heal refresh requested, not gated", () => {
    const dir = project({ consent: true, graph: "stale" });
    // Push well past GRAPHIFY_STALE_TOLERANCE (25) with more newer files.
    for (let i = 0; i < 30; i++) {
      const p = path.join(dir, `extra${i}.js`);
      fs.writeFileSync(p, "x");
      fs.utimesSync(p, NOW, NOW);
    }
    const r = runGrep(dir, "s-heal", "omega");
    expect(r.stderr).not.toContain("GRAPHIFY GATE"); // never block beyond tolerance
    expect(fs.existsSync(refreshFlagPath(dir))).toBe(true); // background refresh kicked
    cleanup(dir);
  });
});
