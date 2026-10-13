import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mod = createRequire(import.meta.url)("./ss.thinking.display.js");

describe("ss.thinking.display", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ss-thinking-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("adds the opt-out next to existing settings and env keys", () => {
    const next = mod.ensureOptOut({ model: "opus", env: { FOO: "1" } });
    expect(next).toEqual({ model: "opus", env: { FOO: "1", CLAUDE_CODE_THINKING_DISPLAY_UPDATES: "0" } });
    expect(mod.ensureOptOut({})).toEqual({ env: { CLAUDE_CODE_THINKING_DISPLAY_UPDATES: "0" } });
  });

  test("never overwrites an explicit user value", () => {
    for (const v of ["1", "0", "true", ""]) {
      expect(mod.ensureOptOut({ env: { CLAUDE_CODE_THINKING_DISPLAY_UPDATES: v } })).toBeNull();
    }
  });

  test("leaves malformed settings alone", () => {
    for (const s of [null, [], "x", { env: [] }, { env: "x" }, { env: null }]) {
      expect(mod.ensureOptOut(s)).toBeNull();
    }
  });

  test("writes the settings file once and is idempotent", () => {
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ permissions: { allow: ["Read"] } }));
    expect(mod.main(p)).toBe(true);
    const s = JSON.parse(readFileSync(p, "utf8"));
    expect(s.permissions.allow).toEqual(["Read"]);
    expect(s.env.CLAUDE_CODE_THINKING_DISPLAY_UPDATES).toBe("0");
    expect(mod.main(p)).toBe(false);
  });

  test("never creates a settings file and never touches an unparseable one", () => {
    const missing = join(dir, "none.json");
    expect(mod.main(missing)).toBe(false);
    expect(existsSync(missing)).toBe(false);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(mod.main(bad)).toBe(false);
    expect(readFileSync(bad, "utf8")).toBe("{ not json");
  });
});
