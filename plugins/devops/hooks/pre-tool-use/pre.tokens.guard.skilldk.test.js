import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.tokens.guard.js");

/**
 * The auto-concept extraction put the skill's procedure behind mandatory
 * "Read deep-knowledge/<file> completely" pointers. A low user threshold
 * must not block those reads with an "offset + limit" hint — that would
 * split the procedure the skill depends on.
 */

const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tokguard-skilldk-home-"));
fs.mkdirSync(path.join(HOME_DIR, ".claude"), { recursive: true });
const METRICS_FILE = path.join(HOME_DIR, "graphify-metrics-isolated.jsonl");

const dirs = [];
afterAll(() => { for (const d of [HOME_DIR, ...dirs]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** Temp project with a deliberately tiny threshold: 200K × 1 % = 2K tokens. */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokguard-skilldk-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.writeFileSync(path.join(dir, ".claude", "token-config.json"), JSON.stringify({
    plan: "max_20", estimatedLimitTokens: 200000, confirmThresholdPct: 0.01, tokensPerByte: 0.25, expensiveFiles: [],
  }));
  return dir;
}

/** A ~20 KB markdown file (~5K tokens) at `rel` inside `dir`. */
function bigMd(dir, rel) {
  const p = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "x".repeat(20000));
  return p;
}

function runRead(dir, filePath) {
  for (let attempt = 0; ; attempt++) {
    const tmp = path.join(dir, ".tmp");
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: filePath }, session_id: `skilldk-${Date.now()}-${attempt}` }),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: HOME_DIR, USERPROFILE: HOME_DIR,
        TMPDIR: tmp, TEMP: tmp, TMP: tmp,
        DOTCLAUDE_GRAPHIFY_METRICS: METRICS_FILE,
      },
    });
    if (res.status !== null || attempt >= 3) {
      if (res.status === null) throw new Error(`hook never started after ${attempt + 1} attempts: ${res.error}`);
      return { status: res.status, stderr: res.stderr || "" };
    }
  }
}

const blocked = (r) => r.status === 2 && /HIGH TOKEN COST/.test(r.stderr);

describe("pre.tokens.guard — skill deep-knowledge reads pass", () => {
  test("source repo: plugins/devops/skills/<skill>/deep-knowledge/*.md passes", () => {
    const dir = project();
    expect(blocked(runRead(dir, bigMd(dir, "plugins/devops/skills/auto-concept/deep-knowledge/step5-process.md")))).toBe(false);
  });

  test("plugin cache: devops/<version>/skills/<skill>/modes/*.md passes", () => {
    const dir = project();
    expect(blocked(runRead(dir, bigMd(dir, "cache/dotclaude/devops/0.245.4/skills/do-run/modes/backlog.md")))).toBe(false);
  });

  test("the same file size elsewhere is still blocked", () => {
    const dir = project();
    expect(blocked(runRead(dir, bigMd(dir, "docs/big.md")))).toBe(true);
  });

  test("a non-devops plugin's deep-knowledge is not exempt", () => {
    const dir = project();
    expect(blocked(runRead(dir, bigMd(dir, "plugins/other/skills/x/deep-knowledge/big.md")))).toBe(true);
  });
});
