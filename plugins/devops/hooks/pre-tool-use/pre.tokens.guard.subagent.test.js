import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.tokens.guard.js");

const BIG = "docs/concepts/big.html";

// Isolate ~/.claude from the machine running the tests (same idiom as
// the former graphgate test) so no global record can flip a verdict.
const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tokguard-home-"));
fs.mkdirSync(path.join(HOME_DIR, ".claude"), { recursive: true });

/** Temp project with one known expensive file, well above the 20K threshold. */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokguard-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  // Private tmpdir for THIS project's confirmation flags. The hook writes them
  // to `os.tmpdir()`, which honours TMPDIR/TEMP/TMP, so pointing those at a
  // per-project directory keeps each test's flags to itself. Without it every
  // test in the suite drops `claude_confirm_*` into the one shared system
  // tmpdir, and the flag-lookup tests below — which pick the first file that
  // appeared since a `before` snapshot — could grab a PARALLEL test's flag,
  // expire that one, and then see their own confirmation still valid.
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  fs.writeFileSync(
    path.join(dir, ".claude", "token-config.json"),
    JSON.stringify({
      plan: "max_20",
      estimatedLimitTokens: 200000,
      confirmThresholdPct: 0.05,
      tokensPerByte: 0.25,
      expensiveFiles: [{ path: BIG, estimatedTokens: 49557 }],
    })
  );
  return dir;
}

// Requirement A1 caps every Bash cost estimate at
// `BASH_MAX_OUTPUT_LENGTH * tokensPerByte` — with the harness's real default
// (30000) that is 7500 tokens, BELOW this suite's 20000-token threshold, so a
// blocking test would silently stop blocking. These tests are about the
// large-file MATCHING logic (bash-context-cost) and the retry-to-proceed
// mechanics, not the cap itself (that has its own describe block below), so
// they raise the env var to a value that keeps the pre-cap behaviour intact.
const UNCAPPED_OUTPUT_LEN = "1000000";

// Requirement 8: every hook spawn points DOTCLAUDE_GRAPHIFY_METRICS at an
// isolated temp file — never the real `~/.claude/graphify-metrics.jsonl`.
const METRICS_FILE = path.join(HOME_DIR, "graphify-metrics-isolated.jsonl");

function run(dir, extra, file) {
  const tmp = path.join(dir, ".tmp");
  const res = spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    input: JSON.stringify({
      tool_name: "Read", tool_input: { file_path: path.join(dir, file) },
      session_id: "sub-" + path.basename(dir), ...extra,
    }),
    encoding: "utf8",
    env: {
      ...process.env, HOME: HOME_DIR, USERPROFILE: HOME_DIR,
      TMPDIR: tmp, TEMP: tmp, TMP: tmp,
      DOTCLAUDE_GRAPHIFY_METRICS: path.join(HOME_DIR, "m.jsonl"),
    },
  });
  return { status: res.status, stderr: res.stderr || "" };
}
const blocked = r => r.status === 2 && /HIGH TOKEN COST/.test(r.stderr);
const cleanup = dir => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort temp cleanup; a locked file must not fail the test */ } };

// Config: 200K window, main 5% = 10K tokens, sub-agent default 4x = 40K.
// Files: 60 KB ~ 15K tokens (between), 240 KB ~ 60K tokens (above both).
function withFiles(cfgExtra = {}) {
  const dir = project();
  const cfgPath = path.join(dir, ".claude", "token-config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.expensiveFiles = [
    { path: "mid.txt", estimatedTokens: 15000 },
    { path: "huge.txt", estimatedTokens: 60000 },
  ];
  Object.assign(cfg, cfgExtra);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, "mid.txt"), "x".repeat(60 * 1024));
  fs.writeFileSync(path.join(dir, "huge.txt"), "x".repeat(240 * 1024));
  return dir;
}

describe("pre.tokens.guard - sub-agent threshold", () => {
  test("main thread blocks at the main threshold", () => {
    const dir = withFiles();
    try {
      const r = run(dir, {}, "mid.txt");
      expect(blocked(r)).toBe(true);
      expect(r.stderr).not.toMatch(/sub-agent threshold/);
    } finally { cleanup(dir); }
  });

  test("sub-agent call between the two thresholds passes", () => {
    const dir = withFiles();
    try {
      expect(run(dir, { agent_id: "a1", agent_type: "Explore" }, "mid.txt").status).toBe(0);
    } finally { cleanup(dir); }
  });

  test("sub-agent call above the sub-agent threshold still blocks and says so", () => {
    const dir = withFiles();
    try {
      const r = run(dir, { agent_id: "a1" }, "huge.txt");
      expect(blocked(r)).toBe(true);
      expect(r.stderr).toMatch(/sub-agent threshold/);
      expect(r.stderr).toMatch(/40[.,]000 tokens/);
    } finally { cleanup(dir); }
  });

  test("per-agent_type override applies only to that type", () => {
    const dir = withFiles({ subagentTypeThresholdPct: { strict: 0.05 } });
    try {
      expect(blocked(run(dir, { agent_id: "a1", agent_type: "strict" }, "mid.txt"))).toBe(true);
      expect(run(dir, { agent_id: "a2", agent_type: "other" }, "mid.txt").status).toBe(0);
    } finally { cleanup(dir); }
  });

  test("explicit subagentConfirmThresholdPct overrides the default", () => {
    const dir = withFiles({ subagentConfirmThresholdPct: 0.1 });
    try {
      expect(blocked(run(dir, { agent_id: "a1" }, "mid.txt"))).toBe(false);
      expect(blocked(run(dir, { agent_id: "a1" }, "huge.txt"))).toBe(true);
    } finally { cleanup(dir); }
  });
});
