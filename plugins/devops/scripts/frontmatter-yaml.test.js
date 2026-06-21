import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Guards against the class of bug where a skill/agent ships with frontmatter
// that fails to parse as YAML. The Claude Code harness does NOT error on this —
// it silently loads the document with EMPTY metadata (no name/description), so
// the skill never triggers and the agent never appears. Nothing in the release
// pipeline caught the local-llm-setup regression (a `phase: needs_api_key`
// backtick in an unquoted description), so this test is that safety net.

const ROOT = process.cwd();

/**
 * Every file whose YAML frontmatter the harness parses:
 *  - skills:  plugins/<plugin>/skills/<name>/SKILL.md
 *  - agents:  plugins/<plugin>/agents/<name>.md
 */
function collectFrontmatterFiles() {
  const files = [];
  const pluginsDir = path.join(ROOT, "plugins");
  for (const plugin of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    const base = path.join(pluginsDir, plugin.name);

    const skillsDir = path.join(base, "skills");
    if (fs.existsSync(skillsDir)) {
      for (const s of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        const f = path.join(skillsDir, s.name, "SKILL.md");
        if (fs.existsSync(f)) files.push(f);
      }
    }

    const agentsDir = path.join(base, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const a of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (a.isFile() && a.name.endsWith(".md")) {
          files.push(path.join(agentsDir, a.name));
        }
      }
    }
  }
  return files;
}

function extractFrontmatter(text) {
  if (!text.startsWith("---")) return null;
  const firstNl = text.indexOf("\n");
  if (firstNl === -1) return null;
  const close = text.indexOf("\n---", firstNl);
  if (close === -1) return null;
  return text.slice(firstNl + 1, close + 1);
}

/**
 * Conservatively flag the YAML hazard that silently drops all frontmatter: a
 * top-level PLAIN scalar value — unquoted and not a block scalar (`|`/`>`) —
 * that contains ": " (colon + space) or ends with ":". YAML reads that inner
 * colon as a mapping separator and the whole block fails to parse. Block
 * scalars (`key: >-`) and quoted values are safe and are skipped.
 */
export function findColonHazards(fm) {
  const lines = fm.split("\n");
  const hazards = [];
  let blockKeyIndent = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (blockKeyIndent !== null) {
      if (indent > blockKeyIndent) continue; // literal block-scalar / nested content
      blockKeyIndent = null;
    }
    const m = line.match(/^(\s*)([A-Za-z0-9_-]+):(.*)$/);
    if (!m) continue; // list items ("- x"), wrapped continuation lines
    const keyIndent = m[1].length;
    const rawValue = m[3];
    const value = rawValue.trim();
    // empty value (nested mapping / block scalar follows) or block scalar indicator
    if (value === "" || /^[|>][+-]?\d*\s*(#.*)?$/.test(value)) {
      blockKeyIndent = keyIndent;
      continue;
    }
    if (value.startsWith('"') || value.startsWith("'")) continue; // quoted — colons safe
    if (/:(\s|$)/.test(value)) {
      hazards.push({ key: m[2], line: i + 1, value });
    }
  }
  return hazards;
}

const FILES = collectFrontmatterFiles();

describe("plugin skill/agent frontmatter", () => {
  test("discovers frontmatter files", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  test.each(FILES.map((f) => [path.relative(ROOT, f), f]))(
    "%s parses as YAML (no unquoted-colon hazard)",
    (_rel, file) => {
      const fm = extractFrontmatter(fs.readFileSync(file, "utf8"));
      expect(fm, `${file}: missing or unterminated '---' frontmatter block`).not.toBeNull();
      const hazards = findColonHazards(fm);
      expect(
        hazards,
        `${file}: plain scalar contains ": " — breaks YAML and silently drops ALL frontmatter. ` +
          `Use a block scalar ("key: >-") or quote the value. Offenders: ${JSON.stringify(hazards)}`,
      ).toEqual([]);
    },
  );

  test.each(
    FILES.filter((f) => f.endsWith("SKILL.md")).map((f) => [path.relative(ROOT, f), f]),
  )("%s declares name and description", (_rel, file) => {
    const fm = extractFrontmatter(fs.readFileSync(file, "utf8")) ?? "";
    expect(/^name:\s*\S/m.test(fm), `${file}: missing 'name'`).toBe(true);
    expect(/^description:\s*(\S|[|>])/m.test(fm), `${file}: missing 'description'`).toBe(true);
  });
});

describe("findColonHazards detector", () => {
  test("flags the local-llm-setup regression (colon-space in plain scalar)", () => {
    const broken =
      "name: local-llm-setup\n" +
      "description: setup — reports `phase: needs_api_key`, `auth_failed`.\n";
    expect(findColonHazards(broken).map((h) => h.key)).toContain("description");
  });

  test("accepts the same value wrapped in a block scalar", () => {
    const fixed =
      "name: local-llm-setup\n" +
      "description: >-\n" +
      "  setup — reports `phase: needs_api_key`, `auth_failed`.\n";
    expect(findColonHazards(fixed)).toEqual([]);
  });

  test("accepts colons not followed by whitespace (URLs, /plugin:skill)", () => {
    expect(findColonHazards("description: see https://x.io and /devops:ship\n")).toEqual([]);
  });
});
