import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { imageSize, imageTokens, readImageTokens, MAX_IMAGE_TOKENS } = require("./image-tokens.js");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "image-tokens-"));
afterAll(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

let n = 0;
const file = (ext, buf) => {
  const p = path.join(DIR, `f${n++}${ext}`);
  fs.writeFileSync(p, buf);
  return p;
};

const u16be = (v) => Buffer.from([(v >> 8) & 0xff, v & 0xff]);
const u16le = (v) => Buffer.from([v & 0xff, (v >> 8) & 0xff]);
const u32be = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
const u32le = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u24le = (v) => Buffer.from([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]);

function png(width, height, padding = 0) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13), Buffer.from("IHDR", "latin1"), u32be(width), u32be(height),
    Buffer.from([8, 6, 0, 0, 0]), u32be(0),
    Buffer.alloc(padding, 0x41),
  ]);
}

/** SOI, `appSegments` APP1 segments of ~60 KB each, SOF0, SOS, scan data, EOI. */
function jpeg(width, height, { appSegments = 0, scanBytes = 0 } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];
  parts.push(Buffer.from([0xff, 0xe0]), u16be(16), Buffer.from("JFIF\0", "latin1"), Buffer.alloc(9));
  for (let i = 0; i < appSegments; i++) parts.push(Buffer.from([0xff, 0xe1]), u16be(60000), Buffer.alloc(59998, 0x45));
  parts.push(Buffer.from([0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
  parts.push(Buffer.from([0xff, 0xda]), u16be(12), Buffer.alloc(10));
  parts.push(Buffer.alloc(scanBytes, 0x55), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

const gif = (width, height) => Buffer.concat([Buffer.from("GIF89a", "latin1"), u16le(width), u16le(height), Buffer.alloc(20)]);

const riff = (chunk, body) => Buffer.concat([
  Buffer.from("RIFF", "latin1"), u32le(4 + 8 + body.length), Buffer.from("WEBP", "latin1"),
  Buffer.from(chunk, "latin1"), u32le(body.length), body,
]);
const webpVp8 = (width, height) => riff("VP8 ", Buffer.concat([Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a]), u16le(width), u16le(height), Buffer.alloc(8)]));
const webpVp8l = (width, height) => riff("VP8L", Buffer.concat([Buffer.from([0x2f]), u32le(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)), Buffer.alloc(8)]));
const webpVp8x = (width, height) => riff("VP8X", Buffer.concat([Buffer.from([0, 0, 0, 0]), u24le(width - 1), u24le(height - 1), Buffer.alloc(8)]));

describe("imageSize — reads the pixel size from the header", () => {
  test.each([
    ["PNG", ".png", png(760, 900)],
    ["JPEG", ".jpg", jpeg(760, 900)],
    ["JPEG behind 3 × 60 KB metadata segments", ".jpeg", jpeg(760, 900, { appSegments: 3 })],
    ["GIF", ".gif", gif(760, 900)],
    ["WebP lossy (VP8)", ".webp", webpVp8(760, 900)],
    ["WebP lossless (VP8L)", ".webp", webpVp8l(760, 900)],
    ["WebP extended (VP8X)", ".webp", webpVp8x(760, 900)],
  ])("%s", (_label, ext, buf) => {
    expect(imageSize(file(ext, buf))).toEqual({ width: 760, height: 900 });
  });

  test.each([
    ["random bytes", Buffer.from("not an image at all, just text")],
    ["a truncated PNG", png(760, 900).subarray(0, 18)],
    ["a JPEG with no frame header", Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0, 0xff, 0xd9])],
    ["an empty file", Buffer.alloc(0)],
  ])("%s → null", (_label, buf) => {
    expect(imageSize(file(".png", buf))).toBeNull();
  });

  test("a missing file → null", () => {
    expect(imageSize(path.join(DIR, "missing.png"))).toBeNull();
  });
});

describe("imageTokens — pixels / 750 after the high-resolution downscale", () => {
  test.each([
    [100, 80, 11],
    [760, 900, 912],
    [1920, 1080, 2765],
    [4000, 3000, MAX_IMAGE_TOKENS], // long edge → 2576, area → 3.75 MP, cap
    [20000, 200, 89], // 2576 × 25.76 after the long-edge scale
  ])("%i × %i → %i", (w, h, tokens) => {
    expect(imageTokens(w, h)).toBe(tokens);
  });

  test("never above the per-image cap", () => {
    expect(imageTokens(2576, 1456)).toBeLessThanOrEqual(MAX_IMAGE_TOKENS);
    expect(MAX_IMAGE_TOKENS).toBe(4784);
  });
});

describe("readImageTokens — only the Read tool's image types", () => {
  test("a 240 KB JPEG of 100 × 80 px costs 11 tokens, not 60K", () => {
    const p = file(".JPG", jpeg(100, 80, { appSegments: 3, scanBytes: 60000 }));
    expect(fs.statSync(p).size).toBeGreaterThan(240000);
    expect(readImageTokens(p)).toBe(11);
  });

  test("an image whose header cannot be read costs the per-image cap", () => {
    expect(readImageTokens(file(".png", Buffer.alloc(300000, 0x41)))).toBe(MAX_IMAGE_TOKENS);
  });

  test.each([".bmp", ".txt", ".pdf", ".svg", ""])("%s is read as text → null", (ext) => {
    expect(readImageTokens(file(ext, png(760, 900)))).toBeNull();
  });
});
