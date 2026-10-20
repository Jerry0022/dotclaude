import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const IM = createRequire(import.meta.url)("./issue-match.js");

describe("issue-match", () => {
  test("normalizeRemote: ssh and https of one repo are one key", () => {
    expect(IM.normalizeRemote("git@github.com:Acme/Widgets.git")).toBe("github.com/acme/widgets");
    expect(IM.normalizeRemote("https://github.com/acme/widgets")).toBe("github.com/acme/widgets");
    expect(IM.normalizeRemote("https://token@github.com/acme/widgets.git/")).toBe("github.com/acme/widgets");
    expect(IM.cacheFile("git@github.com:acme/widgets.git")).toBe(IM.cacheFile("https://github.com/acme/widgets"));
  });

  test("cacheDirSafe: POSIX rejects foreign, open or symlinked dirs; Windows is not checked", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-safe-"));
    const st = fs.lstatSync(dir);
    expect(IM.cacheDirSafe(dir, { platform: "win32", uid: 1 })).toBe(true);
    expect(IM.cacheDirSafe(path.join(dir, "missing"), { platform: "linux", uid: st.uid })).toBe(false);
    expect(IM.cacheDirSafe(dir, { platform: "linux", uid: st.uid + 1 })).toBe(false);
    if (process.platform !== "win32") {
      fs.chmodSync(dir, 0o700);
      expect(IM.cacheDirSafe(dir, { platform: "linux", uid: st.uid })).toBe(true);
      fs.chmodSync(dir, 0o770);
      expect(IM.cacheDirSafe(dir, { platform: "linux", uid: st.uid })).toBe(false);
      IM.writeCache("https://github.com/a/b", [], { dir });
      expect(fs.readdirSync(dir)).toEqual([]);
      fs.chmodSync(dir, 0o700);
      const link = `${dir}-link`;
      fs.symlinkSync(dir, link);
      expect(IM.cacheDirSafe(link, { platform: "linux", uid: st.uid })).toBe(false);
    }
  });

  test("cache round trip, stale and missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-"));
    const issues = [{ number: 1, title: "x", labels: [] }];
    expect(IM.readCache("https://github.com/a/b", { dir })).toBeNull();
    IM.writeCache("https://github.com/a/b", issues, { dir, now: 1000 });
    expect(IM.readCache("https://github.com/a/b", { dir, now: 2000 })).toEqual(issues);
    expect(IM.readCache("https://github.com/a/b", { dir, now: 1000 + IM.CACHE_MAX_AGE_MS + 1 })).toBeNull();
    expect(IM.readCache("", { dir })).toBeNull();
  });

  test("matchIssues: best first, threshold applies", () => {
    const issues = [
      { number: 1, title: "Dark mode toggle", labels: [] },
      { number: 2, title: "Toggle", labels: [] },
    ];
    const m = IM.matchIssues(issues, "dark mode toggle", { threshold: 0.6 });
    expect(m.map((i) => i.number)).toEqual([1]);
    expect(IM.matchIssues(issues, "", {})).toEqual([]);
  });
});
