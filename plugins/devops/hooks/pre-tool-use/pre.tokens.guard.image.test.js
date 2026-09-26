import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.tokens.guard.js");

/**
 * 2026-09-26: the guard priced every Read at bytes × tokensPerByte and
 * blocked Playwright screenshots — an 81 KB 760×900 JPEG as ~20.7K tokens,
 * a 238 KB full-page PNG as ~60.9K — although an image is billed by its
 * pixels (hooks/lib/image-tokens). Every retry then went through.
 */

// Isolate ~/.claude from the machine running the tests (same idiom as the
// other pre.tokens.guard.*.test.js files).
const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tokguard-img-home-"));
fs.mkdirSync(path.join(HOME_DIR, ".claude"), { recursive: true });
const METRICS_FILE = path.join(HOME_DIR, "graphify-metrics-isolated.jsonl");

const dirs = [];
afterAll(() => { for (const d of [HOME_DIR, ...dirs]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** Temp project on max_20: 200K context, 10 % threshold = 20K tokens. */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokguard-img-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.writeFileSync(path.join(dir, ".claude", "token-config.json"), JSON.stringify({
    plan: "max_20", estimatedLimitTokens: 200000, confirmThresholdPct: 0.1, tokensPerByte: 0.25, expensiveFiles: [],
  }));
  return dir;
}

function runRead(dir, sid, filePath) {
  // A loaded machine can fail to start the child at all (status null): that
  // is harness pressure, not a verdict — retry, but never a child that ran.
  for (let attempt = 0; ; attempt++) {
    const tmp = path.join(dir, ".tmp");
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: filePath }, session_id: sid }),
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

const u16be = (v) => Buffer.from([(v >> 8) & 0xff, v & 0xff]);
const u32be = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };

/** A JPEG of `width × height` px padded to many bytes: metadata first, then scan data. */
function bigJpeg(width, height) {
  const parts = [Buffer.from([0xff, 0xd8])];
  for (let i = 0; i < 3; i++) parts.push(Buffer.from([0xff, 0xe1]), u16be(60000), Buffer.alloc(59998, 0x45));
  parts.push(Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(height), u16be(width), Buffer.alloc(10));
  parts.push(Buffer.from([0xff, 0xda]), u16be(12), Buffer.alloc(10), Buffer.alloc(80000, 0x55), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

/** A PNG header of `width × height` px followed by `padding` bytes. */
function bigPng(width, height, padding) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13), Buffer.from("IHDR", "latin1"), u32be(width), u32be(height), Buffer.from([8, 6, 0, 0, 0]), u32be(0),
    Buffer.alloc(padding, 0x41),
  ]);
}

describe("pre.tokens.guard — a Read of an image is priced by pixels", () => {
  test("a 260 KB JPEG of 100 × 80 px goes through (bytes alone would be ~65K tokens)", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, "shot.jpg"), bigJpeg(100, 80));
    expect(fs.statSync(path.join(dir, "shot.jpg")).size).toBeGreaterThan(260000);
    const r = runRead(dir, "img-jpeg", path.join(dir, "shot.jpg"));
    expect(r.status).toBe(0);
    expect(blocked(r)).toBe(false);
  });

  test("a 300 KB full-page PNG of 4000 × 3000 px goes through (at most ~4.8K tokens)", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, "page.png"), bigPng(4000, 3000, 300000));
    const r = runRead(dir, "img-png", path.join(dir, "page.png"));
    expect(r.status).toBe(0);
  });

  test("an image whose header cannot be read goes through at the per-image cap", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, "broken.webp"), Buffer.alloc(300000, 0x41));
    expect(runRead(dir, "img-broken", path.join(dir, "broken.webp")).status).toBe(0);
  });
});

describe("pre.tokens.guard — everything else keeps the byte estimate", () => {
  test("a 400 KB text file is still blocked", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, "big.txt"), "x".repeat(400000));
    expect(blocked(runRead(dir, "img-text", path.join(dir, "big.txt")))).toBe(true);
  });

  test("a 300 KB .bmp is still blocked — the Read tool shows no bitmap as an image", () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, "old.bmp"), Buffer.concat([Buffer.from("BM", "latin1"), Buffer.alloc(300000, 0x41)]));
    expect(blocked(runRead(dir, "img-bmp", path.join(dir, "old.bmp")))).toBe(true);
  });
});
