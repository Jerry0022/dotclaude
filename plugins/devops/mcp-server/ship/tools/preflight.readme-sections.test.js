import { describe, test, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  return { z: { object: () => node, string: () => node, boolean: () => node, array: () => node } };
});

const { readmeSectionsToCheck } = await import("./preflight.js");

const REAL_MAP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "readme-doc-map.json");

function tmpMap(sections) {
  const dir = mkdtempSync(join(tmpdir(), "doc-map-"));
  const file = join(dir, "map.json");
  writeFileSync(file, JSON.stringify({ sections }));
  return { file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("readmeSectionsToCheck — README sections whose sources changed", () => {
  test("names the section of a changed source", () => {
    const m = tmpMap([{ section: "Token math", sources: ["plugins/devops/hooks/pre-tool-use/pre.tokens.guard.js"] }]);
    expect(readmeSectionsToCheck(m.file, ["plugins/devops/hooks/pre-tool-use/pre.tokens.guard.js"])).toEqual(["Token math"]);
    m.done();
  });

  test("** reaches nested files, tests never count", () => {
    const m = tmpMap([{ section: "Skills", sources: ["plugins/devops/skills/**"] }]);
    expect(readmeSectionsToCheck(m.file, ["plugins/devops/skills/do-run/modes/autonomous.md"])).toEqual(["Skills"]);
    expect(readmeSectionsToCheck(m.file, ["plugins/devops/skills/x/helper.test.js"])).toEqual([]);
    m.done();
  });

  test("silent when the branch already touched README.md", () => {
    const m = tmpMap([{ section: "Skills", sources: ["plugins/devops/skills/**"] }]);
    expect(readmeSectionsToCheck(m.file, ["README.md", "plugins/devops/skills/do-run/SKILL.md"])).toEqual([]);
    m.done();
  });

  test("silent without a map, a diff, or with an unreadable map", () => {
    expect(readmeSectionsToCheck(join(tmpdir(), "no-such-map.json"), ["a.js"])).toEqual([]);
    const m = tmpMap([{ section: "S", sources: ["a.js"] }]);
    expect(readmeSectionsToCheck(m.file, [])).toEqual([]);
    writeFileSync(m.file, "{ not json");
    expect(readmeSectionsToCheck(m.file, ["a.js"])).toEqual([]);
    m.done();
  });

  test("the shipped map catches the card design doc", () => {
    expect(readmeSectionsToCheck(REAL_MAP, ["plugins/devops/deep-knowledge/completion-card-design.md"]))
      .toEqual(["Completion card (prose around the generated examples)"]);
  });
});
