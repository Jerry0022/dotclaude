import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  readSkillMeta,
  loadAllSkills,
  parseFrontmatter,
  extractFrontmatter,
} = require("./skill-meta.js");

function writeSkill(root, name, content) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf8");
  return dir;
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-meta-test-"));
}

describe("extractFrontmatter", () => {
  test("extracts the block between the two '---' fences", () => {
    const text = "---\nname: x\n---\n\n# Body\n";
    expect(extractFrontmatter(text)).toBe("name: x");
  });

  test("returns null when there is no closing fence", () => {
    expect(extractFrontmatter("---\nname: x\n")).toBeNull();
  });

  test("returns null when the text does not start with '---'", () => {
    expect(extractFrontmatter("# Body\n")).toBeNull();
  });

  test("a UTF-8 BOM and CRLF line endings do not hide the frontmatter", () => {
    expect(extractFrontmatter("\uFEFF---\r\nname: x\r\n---\r\n# Body\r\n")).toBe("name: x");
  });

  test("non-string input → null", () => {
    expect(extractFrontmatter(null)).toBeNull();
  });

  test("is robust to CRLF line endings", () => {
    const text = "---\r\nname: x\r\n---\r\n\r\n# Body\r\n";
    expect(extractFrontmatter(text)).toBe("name: x");
  });
});

describe("parseFrontmatter", () => {
  test("parses plain scalars", () => {
    const fm = "name: ship\nlayer: 2\n";
    expect(parseFrontmatter(fm)).toEqual({ name: "ship", layer: 2 });
  });

  test("parses a folded (>-) description block", () => {
    const fm = [
      "name: ship",
      "description: >-",
      "  Full end-to-end shipping pipeline.",
      "  Second line of the same paragraph.",
      "layer: 2",
    ].join("\n");
    const parsed = parseFrontmatter(fm);
    expect(parsed.description).toBe(
      "Full end-to-end shipping pipeline. Second line of the same paragraph.",
    );
    expect(parsed.layer).toBe(2);
  });

  test("parses an empty invokes list", () => {
    expect(parseFrontmatter("invokes: []\n").invokes).toEqual([]);
  });

  test("parses a populated invokes list", () => {
    expect(parseFrontmatter("invokes: [auto-polish, ship]\n").invokes).toEqual([
      "auto-polish",
      "ship",
    ]);
  });

  test("parses an empty triggers map", () => {
    expect(parseFrontmatter("triggers: {}\n").triggers).toEqual({});
  });

  test("parses a triggers map with multiple languages", () => {
    const fm = [
      "triggers:",
      '  de: ["ship", "und dann ship"]',
      '  en: ["ship it", "push and merge"]',
    ].join("\n");
    expect(parseFrontmatter(fm).triggers).toEqual({
      de: ["ship", "und dann ship"],
      en: ["ship it", "push and merge"],
    });
  });

  test("converts kebab-case keys to camelCase", () => {
    const fm = "user-invocable: false\ndisable-model-invocation: true\n";
    const parsed = parseFrontmatter(fm);
    expect(parsed.userInvocable).toBe(false);
    expect(parsed.disableModelInvocation).toBe(true);
  });

  test("handles a trigger phrase containing an escaped quote", () => {
    const fm = 'triggers:\n  en: ["say \\"hi\\" to it"]\n';
    expect(parseFrontmatter(fm).triggers.en).toEqual(['say "hi" to it']);
  });
});

describe("readSkillMeta", () => {
  test("reads name/description/layer/invokes/triggers from a real-shaped SKILL.md", () => {
    const root = tmpRoot();
    const dir = writeSkill(
      root,
      "demo",
      [
        "---",
        "name: demo",
        "version: 1.0.0",
        "description: >-",
        "  Demo skill. Triggers on: \"demo it\", \"mach demo\".",
        "layer: 1",
        "invokes: [other-skill]",
        "triggers:",
        '  en: ["demo it"]',
        '  de: ["mach demo"]',
        "allowed-tools: Read, Write",
        "---",
        "",
        "# Demo",
      ].join("\n"),
    );
    const meta = readSkillMeta(dir);
    expect(meta.name).toBe("demo");
    expect(meta.layer).toBe(1);
    expect(meta.invokes).toEqual(["other-skill"]);
    expect(meta.triggers).toEqual({ en: ["demo it"], de: ["mach demo"] });
    expect(meta.description).toContain("Demo skill.");
    expect(meta.userInvocable).toBe(true);
    expect(meta.disableModelInvocation).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("respects explicit user-invocable / disable-model-invocation flags", () => {
    const root = tmpRoot();
    const dir = writeSkill(
      root,
      "hidden",
      [
        "---",
        "name: hidden",
        "description: >-",
        "  Hidden worker skill.",
        "layer: 2",
        "invokes: []",
        "triggers: {}",
        "user-invocable: false",
        "disable-model-invocation: true",
        "---",
        "",
        "# Hidden",
      ].join("\n"),
    );
    const meta = readSkillMeta(dir);
    expect(meta.userInvocable).toBe(false);
    expect(meta.disableModelInvocation).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns null when SKILL.md is missing", () => {
    const root = tmpRoot();
    expect(readSkillMeta(path.join(root, "nope"))).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns null when the frontmatter fence is unterminated", () => {
    const root = tmpRoot();
    const dir = writeSkill(root, "broken", "---\nname: broken\n# no closing fence\n");
    expect(readSkillMeta(dir)).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("is robust to CRLF line endings", () => {
    const root = tmpRoot();
    const dir = writeSkill(
      root,
      "crlf",
      ["---", "name: crlf", "layer: 0", "invokes: []", "triggers: {}", "---", "", "# CRLF"].join(
        "\r\n",
      ),
    );
    const meta = readSkillMeta(dir);
    expect(meta.name).toBe("crlf");
    expect(meta.layer).toBe(0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("loadAllSkills", () => {
  test("loads every skill directory under the given root", () => {
    const root = tmpRoot();
    writeSkill(
      root,
      "a",
      ["---", "name: a", "layer: 0", "invokes: [b]", "triggers: {}", "---", "", "# A"].join("\n"),
    );
    writeSkill(
      root,
      "b",
      ["---", "name: b", "layer: 1", "invokes: []", "triggers: {}", "---", "", "# B"].join("\n"),
    );
    const all = loadAllSkills(root);
    expect(Object.keys(all).sort()).toEqual(["a", "b"]);
    expect(all.a.invokes).toEqual(["b"]);
    expect(all.b.layer).toBe(1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("skips non-directory entries and directories without SKILL.md", () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, "stray-file.md"), "not a skill");
    fs.mkdirSync(path.join(root, "empty-dir"));
    writeSkill(
      root,
      "real",
      ["---", "name: real", "layer: 0", "invokes: []", "triggers: {}", "---", "", "# Real"].join(
        "\n",
      ),
    );
    const all = loadAllSkills(root);
    expect(Object.keys(all)).toEqual(["real"]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("returns an empty object for a missing root", () => {
    expect(loadAllSkills(path.join(os.tmpdir(), "definitely-not-a-real-dir-12345"))).toEqual({});
  });
});

describe("loadAllSkills against the real devops skills directory", () => {
  const REAL_ROOT = path.join(process.cwd(), "plugins", "devops", "skills");

  test("parses every real SKILL.md without throwing and yields 15 skills (PR 3 retired four)", () => {
    const all = loadAllSkills(REAL_ROOT);
    expect(Object.keys(all).length).toBe(15);
    for (const [name, meta] of Object.entries(all)) {
      expect(meta.name, `${name}: meta.name`).toBeTruthy();
      expect(typeof meta.layer, `${name}: layer type`).toBe("number");
      expect(Array.isArray(meta.invokes), `${name}: invokes type`).toBe(true);
      expect(typeof meta.triggers, `${name}: triggers type`).toBe("object");
    }
  });
});
