import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  markerPath, writeMarker, clearMarker, readMarker, MARKER_TTL_MS,
} = require("./ship-lockout-marker.js");

const dirs = [];
const mkrepo = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ship-lockout-marker-"));
  fs.mkdirSync(path.join(d, ".git"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) {
    try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("ship-lockout-marker", () => {
  test("anchors at the repo root, also from a subdirectory", () => {
    const d = mkrepo();
    const sub = path.join(d, "pkg", "src");
    fs.mkdirSync(sub, { recursive: true });
    expect(markerPath(sub)).toBe(path.join(d, ".claude", ".ship-lockout"));
  });

  test("write → read active → clear → read inactive", () => {
    const d = mkrepo();
    expect(writeMarker(d, { owner: "do-run", session: "s1" })).toBe(true);
    const r = readMarker(d);
    expect(r).toMatchObject({ active: true, owner: "do-run" });
    expect(clearMarker(d)).toBe(true);
    expect(readMarker(d)).toEqual({ active: false });
    expect(clearMarker(d)).toBe(false);
  });

  test("a marker past its TTL is stale: reported inactive and removed", () => {
    const d = mkrepo();
    const t0 = Date.now();
    writeMarker(d, { owner: "do-run" }, t0 - MARKER_TTL_MS - 1000);
    const r = readMarker(d, t0);
    expect(r).toMatchObject({ active: false, stale: true, removed: true });
    expect(fs.existsSync(markerPath(d))).toBe(false);
  });

  test("a fresh marker inside its TTL stays active", () => {
    const d = mkrepo();
    const t0 = Date.now();
    writeMarker(d, {}, t0 - MARKER_TTL_MS + 60_000);
    expect(readMarker(d, t0).active).toBe(true);
  });

  test("the legacy bare `1` marker ages by mtime", () => {
    const d = mkrepo();
    fs.mkdirSync(path.join(d, ".claude"), { recursive: true });
    fs.writeFileSync(markerPath(d), "1");
    const old = new Date(Date.now() - MARKER_TTL_MS - 60_000);
    fs.utimesSync(markerPath(d), old, old);
    expect(readMarker(d)).toMatchObject({ active: false, stale: true, removed: true });
  });

  test("missing cwd never throws", () => {
    expect(writeMarker("")).toBe(false);
    expect(clearMarker("")).toBe(false);
    expect(readMarker("")).toEqual({ active: false });
  });
});
