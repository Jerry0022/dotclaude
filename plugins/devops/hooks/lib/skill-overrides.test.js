import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const L = require("./skill-overrides.js");

const NAMES = new Set(["do-ship", "do-run", "auto-fix", "auto-polish"]);

let tmp;
let home;
let project;

function put(base, dir, file, text) {
  const d = path.join(base, ".claude", "skills", dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, file), text);
  return path.join(d, file);
}

function block(skill, extra = {}) {
  return L.overrideBlock(skill, { cwd: project, home, skillNames: NAMES, ...extra });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-overrides-"));
  home = path.join(tmp, "home");
  project = path.join(tmp, "proj");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("parseOverride — the four directive kinds", () => {
  const text = [
    "# Ship Reference",
    "Always run the e2e suite.",
    "## Add after Step 4",
    "- run `npm run e2e`",
    "## Add before Step 2",
    "- warm the cache",
    "## Skip Step 3",
    "Not needed here.",
    "## Replace Step 5",
    "Deploy via scp instead.",
    "### a sub heading stays inside the Replace section",
    "## Step 8 — Self-update",
    "sync the plugin",
    "```bash",
    "## Skip Step 9   <- inside a fence: ignored",
    "```",
  ].join("\n");

  test("add (after/before), skip, replace, extend; fenced headings ignored", () => {
    const { directives, hasRules } = L.parseOverride(text);
    expect(directives.map(({ kind, step, position }) => [kind, step, position])).toEqual([
      ["add", "4", "after"],
      ["add", "2", "before"],
      ["skip", "3", undefined],
      ["replace", "5", undefined],
      ["extend", "8", undefined],
    ]);
    expect(hasRules).toBe(true);
  });

  test("a skip heading may list several steps", () => {
    expect(L.headingDirectives("Skip Steps 3, 5 and 6.5")).toEqual([
      { kind: "skip", step: "3" }, { kind: "skip", step: "5" }, { kind: "skip", step: "6.5" },
    ]);
  });

  test("German spellings parse the same", () => {
    expect(L.headingDirectives("Ergänze nach Schritt 4")).toEqual([{ kind: "add", step: "4", position: "after" }]);
    expect(L.headingDirectives("Überspringe Schritt 3")).toEqual([{ kind: "skip", step: "3" }]);
    expect(L.headingDirectives("Ersetze Schritt 2")).toEqual([{ kind: "replace", step: "2" }]);
    expect(L.headingDirectives("Schritt 1a — Vorab")).toEqual([{ kind: "extend", step: "1a" }]);
  });

  test("plain headings and unfilled scaffold placeholders are no directive", () => {
    expect(L.headingDirectives("Deploy target")).toEqual([]);
    expect(L.headingDirectives("Steps to reproduce")).toEqual([]);
    expect(L.headingDirectives("Skip Step {N}")).toEqual([]);
  });

  test("a file of headings and comments only carries no rules", () => {
    expect(L.parseOverride("# T\n<!-- hint -->\n## Rules\n<!-- free text -->\n").hasRules).toBe(false);
  });
});

describe("resolveOverrides / overrideBlock", () => {
  test("no files → null (the hook stays silent)", () => {
    expect(block("devops:do-ship")).toBeNull();
  });

  test("global + project: fixed order global → project, project wins, explicit orders", () => {
    put(home, "do-ship", "reference.md", "## Add after Step 4\nrun e2e\n");
    put(project, "do-ship", "reference.md", "## Skip Step 3\nno need\n## Replace Step 2\nscp deploy\n");
    const b = block("devops:do-ship");
    expect(b.text.split("\n")[0]).toBe("[skill-overrides] do-ship: global reference.md, project reference.md");
    expect(b.text).toMatch(/plugin defaults → global → project; on a conflict project wins/);
    expect(b.text).toContain("- ADD after Step 4 of do-ship (global override)");
    expect(b.text).toContain("- SKIP Step 3 of do-ship (project override) — do not run it");
    expect(b.text).toContain("- REPLACE Step 2 of do-ship (project override)");
    expect(b.text.indexOf("=== global:")).toBeLessThan(b.text.indexOf("=== project:"));
    expect(b.text).toContain("scp deploy");
    expect(b.record.entries.map((e) => e.scope)).toEqual(["global", "project"]);
  });

  test("a legacy SKILL.md is still found, flagged deprecated, frontmatter stripped", () => {
    put(project, "auto-fix", "SKILL.md", "---\nname: auto-fix\n---\nLogs at %APPDATA%/x\n");
    const b = block("devops:auto-fix");
    expect(b.text).toMatch(/Legacy: `.*auto-fix\/SKILL\.md` is a SKILL\.md override — deprecated; rename it to reference\.md/);
    expect(b.text).toContain("Logs at %APPDATA%/x");
    expect(b.text).not.toContain("name: auto-fix");
    expect(b.record.entries[0].legacy).toBe(true);
  });

  test("reference.md beats a legacy SKILL.md", () => {
    put(project, "auto-fix", "SKILL.md", "old");
    put(project, "auto-fix", "reference.md", "new");
    const b = block("devops:auto-fix");
    expect(b.text).toContain("new");
    expect(b.text).not.toMatch(/^old$/m);
  });

  test("a pre-PR-2 dir name is the fallback when the new one is missing", () => {
    put(project, "fix", "reference.md", "old-name rule");
    const b = block("devops:auto-fix");
    expect(b.text).toContain("old-name rule");
    expect(b.text).toMatch(/Pre-PR-2 dir: .* under the old name `fix\/`/);
    put(project, "auto-fix", "reference.md", "new-name rule");
    expect(block("devops:auto-fix").text).not.toContain("old-name rule");
  });

  test("an old namespaced skill name canonicalizes (devops:ship → do-ship)", () => {
    put(project, "do-ship", "reference.md", "x");
    expect(block("devops:ship").record.skill).toBe("do-ship");
  });

  test("folded modes: the old dir is read in addition, only the mode's when known", () => {
    put(project, "do-run", "reference.md", "run rule");
    put(project, "run-backlog", "reference.md", "backlog rule");
    put(project, "tune-audit", "reference.md", "audit rule");
    const known = block("devops:do-run", { args: "backlog --x" });
    expect(known.text).toContain("backlog rule");
    expect(known.text).not.toContain("audit rule");
    expect(known.text).toContain("project override, backlog mode only");
    const unknown = block("devops:do-run");
    expect(unknown.text).toContain("backlog rule");
    expect(unknown.text).toContain("audit rule");
    expect(block("devops:run-backlog").record.mode).toBe("backlog");
  });

  test("non-devops skills: a bare user skill is never an override; a foreign plugin's reference.md is", () => {
    put(project, "graphify", "SKILL.md", "the user skill itself");
    put(project, "graphify", "reference.md", "its own docs");
    expect(block("graphify")).toBeNull();
    put(project, "fix", "reference.md", "consumer skill under an old name");
    expect(block("fix")).toBeNull();
    put(project, "lint", "reference.md", "foreign override");
    put(project, "lint", "SKILL.md", "never a legacy fallback for a foreign skill");
    const b = block("other:lint");
    expect(b.text).toContain("foreign override");
    expect(b.record.entries).toHaveLength(1);
  });

  test("over the inline cap: the file is named for a Read, its directives still listed", () => {
    put(project, "do-ship", "reference.md", `## Skip Step 3\n${"x".repeat(300)}\n`);
    const b = block("devops:do-ship", { cap: 100 });
    expect(b.text).toContain("- SKIP Step 3 of do-ship");
    expect(b.text).toMatch(/over the 100-char inline cap: Read this file in full before Step 1/);
    expect(b.text).not.toContain("x".repeat(300));
  });

  test("the default cap is 6000 characters", () => {
    expect(L.INLINE_CAP).toBe(6000);
  });
});

describe("session record → card line", () => {
  test("record, re-record replaces the skill, rendered record starts over, clear after render", () => {
    const dir = tmp;
    put(project, "do-ship", "reference.md", "## Step 8 — sync\nx\n");
    const rec = block("devops:do-ship").record;
    L.recordOverrides("s1", rec, { dir });
    L.recordOverrides("s1", rec, { dir });
    const file = L.recordPath("s1", dir);
    expect(L.readRecordFile(file).skills).toHaveLength(1);
    expect(L.cardLine(L.readRecordFile(file), "de")).toBe("🧩 Override aktiv: Projekt do-ship (Step 8 ergänzt)");
    expect(L.cardLine(L.readRecordFile(file), "en")).toBe("🧩 Override active: project do-ship (Step 8 extended)");

    L.clearRendered("s1", { dir });
    expect(fs.existsSync(file)).toBe(true); // not shown yet → kept
    L.markRendered(file);
    L.clearRendered("s1", { dir });
    expect(fs.existsSync(file)).toBe(false);
  });

  test("labels per kind, scopes merged, rules fallback, several skills on one line", () => {
    const data = { skills: [
      { skill: "do-ship", entries: [
        { scope: "global", directives: [{ kind: "add", step: "4", position: "after" }] },
        { scope: "project", directives: [{ kind: "skip", step: "3" }, { kind: "replace", step: "2" }] },
      ] },
      { skill: "auto-fix", entries: [{ scope: "global", directives: [] }] },
    ] };
    expect(L.cardLine(data, "de")).toBe(
      "🧩 Override aktiv: Global + Projekt do-ship (nach Step 4 ergänzt, Step 3 übersprungen, Step 2 ersetzt) · Global auto-fix (Regeln)",
    );
    expect(L.cardLine(null)).toBeNull();
    expect(L.cardLine({ skills: [] })).toBeNull();
  });

  test("the card line stays one short line", () => {
    const many = { skills: Array.from({ length: 10 }, (_, i) => ({ skill: `skill-${i}`, entries: [{ scope: "project", directives: [] }] })) };
    const line = L.cardLine(many, "de");
    expect(line.length).toBeLessThanOrEqual(160);
    expect(line).not.toContain("\n");
  });
});

describe("file-name contract", () => {
  test("reference.md is the override file, SKILL.md only the legacy fallback", () => {
    expect(L.OVERRIDE_FILES).toEqual(["reference.md", "SKILL.md"]);
  });
});
