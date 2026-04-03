import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("./resolve-root.js", () => ({ resolveGitRoot: vi.fn(() => null) }));

import { readFileSync } from "node:fs";
import { bumpVersion, detectProjectType, readVersion } from "./version.js";

// ---------------------------------------------------------------------------
// bumpVersion — pure semver math
// ---------------------------------------------------------------------------

describe("bumpVersion", () => {
  test("patch: 1.2.3 → 1.2.4", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  test("minor: 1.2.3 → 1.3.0", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  test("major: 1.2.3 → 2.0.0", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  test("none returns current version unchanged", () => {
    expect(bumpVersion("1.2.3", "none")).toBe("1.2.3");
  });

  test("unknown bump type returns current version", () => {
    expect(bumpVersion("1.2.3", "invalid")).toBe("1.2.3");
  });

  test("handles 0.x versions correctly", () => {
    expect(bumpVersion("0.22.0", "patch")).toBe("0.22.1");
    expect(bumpVersion("0.22.0", "minor")).toBe("0.23.0");
    expect(bumpVersion("0.22.0", "major")).toBe("1.0.0");
  });
});

// ---------------------------------------------------------------------------
// detectProjectType — file-based detection
// ---------------------------------------------------------------------------

describe("detectProjectType", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("returns 'plugin' when plugin.json exists", () => {
    readFileSync.mockImplementation((p) => {
      if (String(p).includes("plugin.json") && !String(p).includes("marketplace"))
        return "{}";
      throw new Error("ENOENT");
    });
    expect(detectProjectType("/test")).toBe("plugin");
  });

  test("returns 'npm' when only package.json exists", () => {
    readFileSync.mockImplementation((p) => {
      if (String(p).includes("package.json")) return "{}";
      throw new Error("ENOENT");
    });
    expect(detectProjectType("/test")).toBe("npm");
  });

  test("returns 'marketplace' when only marketplace.json exists", () => {
    readFileSync.mockImplementation((p) => {
      if (String(p).includes("marketplace.json")) return "{}";
      throw new Error("ENOENT");
    });
    expect(detectProjectType("/test")).toBe("marketplace");
  });

  test("returns null when no config files exist", () => {
    readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(detectProjectType("/test")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readVersion — reads from correct source of truth
// ---------------------------------------------------------------------------

describe("readVersion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("reads version from plugin.json for plugin type", () => {
    readFileSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes("plugin.json") && !s.includes("marketplace"))
        return JSON.stringify({ version: "0.22.0" });
      throw new Error("ENOENT");
    });
    const result = readVersion("/test");
    expect(result.version).toBe("0.22.0");
    expect(result.type).toBe("plugin");
  });

  test("reads version from package.json for npm type", () => {
    readFileSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes("plugin.json") && !s.includes("marketplace"))
        throw new Error("ENOENT");
      if (s.includes("package.json"))
        return JSON.stringify({ version: "2.1.0" });
      throw new Error("ENOENT");
    });
    const result = readVersion("/test");
    expect(result.version).toBe("2.1.0");
    expect(result.type).toBe("npm");
  });

  test("returns null version when no project detected", () => {
    readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = readVersion("/test");
    expect(result.version).toBeNull();
    expect(result.type).toBeNull();
  });
});
