import { describe, test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, detectComponents } from "./components.js";

describe("parseManifest", () => {
  test("package.json name and version", () => {
    expect(parseManifest("package.json", '{"name":"uploader","version":"1.3.0"}')).toEqual({ name: "uploader", version: "1.3.0" });
  });

  test("Cargo.toml reads [package] only, never a dependency's version", () => {
    const toml = '[package]\nname = "desktop-app"\nversion = "0.10.0"\n\n[dependencies]\nserde = { version = "1" }\n';
    expect(parseManifest("Cargo.toml", toml)).toEqual({ name: "desktop-app", version: "0.10.0" });
  });

  test("Cargo.toml with a workspace-inherited version has no own version", () => {
    expect(parseManifest("Cargo.toml", '[package]\nname = "x"\nversion.workspace = true\n').version).toBe("");
  });

  test("pyproject.toml [project] and [tool.poetry]", () => {
    expect(parseManifest("pyproject.toml", '[project]\nname = "tool"\nversion = "2.0.1"\n').version).toBe("2.0.1");
    expect(parseManifest("pyproject.toml", '[tool.poetry]\nname = "tool"\nversion = "0.4.0"\n').version).toBe("0.4.0");
  });

  test("unreadable JSON yields nothing", () => {
    expect(parseManifest("package.json", "{nope")).toEqual({ name: "", version: "" });
  });
});

describe("detectComponents", () => {
  function repo(files) {
    const dir = mkdtempSync(join(tmpdir(), "components-"));
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
    return dir;
  }

  test("reports a sub-app manifest whose version changed; ignores root and unchanged ones", () => {
    const cwd = repo({
      "package.json": '{"name":"web","version":"2.5.0"}',
      "desktop/Cargo.toml": '[package]\nname = "desktop-app"\nversion = "0.10.0"\n',
      "tools/deps/package.json": '{"name":"deps","version":"0.1.0"}',
    });
    try {
      const base = {
        "package.json": '{"name":"web","version":"2.4.0"}',
        "desktop/Cargo.toml": '[package]\nname = "desktop-app"\nversion = "0.9.2"\n',
        "tools/deps/package.json": '{"name":"deps","version":"0.1.0"}',
      };
      const out = detectComponents(
        ["package.json", "desktop/Cargo.toml", "desktop/src/main.rs", "tools/deps/package.json"],
        { cwd, readBase: (p) => base[p] ?? null },
      );
      expect(out).toEqual([
        { dir: "desktop", manifest: "Cargo.toml", name: "desktop-app", version: "0.10.0", previousVersion: "0.9.2" },
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a new sub-app manifest counts, with previousVersion null; a deleted one is skipped", () => {
    const cwd = repo({ "apps/uploader/pyproject.toml": '[project]\nname = "uploader"\nversion = "0.1.0"\n' });
    try {
      const out = detectComponents(
        ["apps/uploader/pyproject.toml", "apps/gone/package.json"],
        { cwd, readBase: () => null },
      );
      expect(out).toEqual([
        { dir: "apps/uploader", manifest: "pyproject.toml", name: "uploader", version: "0.1.0", previousVersion: null },
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("no files, no components", () => {
    expect(detectComponents(null, { cwd: ".", readBase: () => null })).toEqual([]);
  });
});
