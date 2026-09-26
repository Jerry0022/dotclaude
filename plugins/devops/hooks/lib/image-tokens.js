/**
 * @module image-tokens
 * @version 0.1.0
 * @plugin devops
 * @description Context cost of an image the Read tool shows the model. An
 *   image is billed by its pixels, not by its bytes: pre.tokens.guard used to
 *   price every Read at bytes × tokensPerByte and blocked a 81 KB 760×900
 *   screenshot as ~20.7K tokens and a 238 KB full-page PNG as ~60.9K
 *   (2026-09-26), while an image costs a few thousand at most.
 *
 *   Only the Read tool's own image types count (Claude Code 2.1.281: png,
 *   jpg, jpeg, gif, webp); any other file, `.bmp` included, reaches the model
 *   as text and keeps the byte estimate. The pixel size comes from the file
 *   header — PNG IHDR, JPEG SOFn, GIF logical screen, WebP VP8/VP8L/VP8X — with
 *   no dependency and without reading the image data.
 *
 *   The estimate follows the vision limits of the high-resolution models
 *   (Opus 4.7+, Sonnet 5, Opus 5 / 5.5, Fable 5 / 5.1): the long edge scaled
 *   down to 2576 px, at most 3.75 MP, about width × height / 750 tokens and
 *   ~4784 per image at the limit. Older models cap at 1568 px and ~1600
 *   tokens, so this is the upper bound for every current model. An image
 *   whose header cannot be read is priced at that per-image cap.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** The Read tool's image extensions; everything else is read as text. */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const MAX_LONG_EDGE = 2576;
const MAX_PIXELS = 3.75e6;
const PIXELS_PER_TOKEN = 750;
const MAX_IMAGE_TOKENS = 4784;

/** Bytes enough for the PNG, GIF and WebP headers. */
const HEAD_BYTES = 32;
/** A JPEG's metadata segments come first; stop walking after this many. */
const MAX_JPEG_SEGMENTS = 4096;

/** SOFn markers that carry the frame size (not DHT C4, JPG C8, DAC CC). */
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return n === len ? buf : buf.subarray(0, n);
}

function pngSize(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b) {
  if (b.length < 10 || !/^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webpSize(b) {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}

/** Walk the segments from SOI to the first SOFn, reading only their headers. */
function jpegSize(fd, fileSize) {
  let pos = 2;
  for (let i = 0; i < MAX_JPEG_SEGMENTS && pos + 4 <= fileSize; i++) {
    const head = readAt(fd, pos, 4);
    if (head.length < 4 || head[0] !== 0xff) return null;
    const marker = head[1];
    if (marker === 0xff) { pos += 1; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { pos += 2; continue; } // no length
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / scan data before any frame header
    const len = head.readUInt16BE(2);
    if (len < 2) return null;
    if (JPEG_SOF.has(marker)) {
      const sof = readAt(fd, pos + 4, 5);
      if (sof.length < 5) return null;
      return { width: sof.readUInt16BE(3), height: sof.readUInt16BE(1) };
    }
    pos += 2 + len;
  }
  return null;
}

/**
 * Pixel size of a PNG, JPEG, GIF or WebP file, from its magic bytes.
 * @param {string} file
 * @returns {{ width: number, height: number } | null}
 */
function imageSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const b = readAt(fd, 0, HEAD_BYTES);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpegSize(fd, size);
    return pngSize(b) || gifSize(b) || webpSize(b);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

/**
 * Tokens an image of this pixel size costs once the API has scaled it down.
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function imageTokens(width, height) {
  let w = width;
  let h = height;
  const longEdge = Math.max(w, h);
  if (longEdge > MAX_LONG_EDGE) { const s = MAX_LONG_EDGE / longEdge; w *= s; h *= s; }
  if (w * h > MAX_PIXELS) { const s = Math.sqrt(MAX_PIXELS / (w * h)); w *= s; h *= s; }
  return Math.min(Math.ceil((w * h) / PIXELS_PER_TOKEN), MAX_IMAGE_TOKENS);
}

/**
 * The Read cost of `file` when the Read tool shows it as an image, or null
 * when it is read as text (not one of IMAGE_EXTS).
 * @param {string} file
 * @returns {number | null}
 */
function readImageTokens(file) {
  if (!IMAGE_EXTS.has(path.extname(String(file)).toLowerCase())) return null;
  const dims = imageSize(file);
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) return MAX_IMAGE_TOKENS;
  return imageTokens(dims.width, dims.height);
}

module.exports = { IMAGE_EXTS, MAX_IMAGE_TOKENS, imageSize, imageTokens, readImageTokens };
