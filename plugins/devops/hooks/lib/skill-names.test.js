import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  RENAMED,
  FOLDED,
  FOLDED_TRIGGERS,
  canonicalSkillName,
  foldedMode,
  legacyNamesOf,
  isSkill,
  modeForPhrase,
  extensionNameCandidates,
  resolveExtensionFile,
} = require("./skill-names.js");

describe("canonicalSkillName", () => {
  test.each([
    ["ship", "do-ship"],
    ["devops:ship", "do-ship"],
    ["/devops:ship", "do-ship"],
    ["do-ship", "do-ship"],
    ["fix", "auto-fix"],
    ["Concept", "auto-concept"],
    ["run-backlog", "do-run"],
    ["tune-audit", "do-run"],
    ["promote", "do-ship"],
    ["claude-strict", "claude-strict"],
    ["some-consumer-skill", "some-consumer-skill"],
  ])("%s → %s", (raw, expected) => {
    expect(canonicalSkillName(raw)).toBe(expected);
  });

  test("non-string → ''", () => {
    expect(canonicalSkillName(null)).toBe("");
  });
});

describe("folds and legacy names", () => {
  test("foldedMode names the mode of a folded skill only", () => {
    expect(foldedMode("run-burn")).toBe("burn");
    expect(foldedMode("devops:promote")).toBe("promote");
    expect(foldedMode("ship")).toBeNull();
  });

  test("legacyNamesOf lists renames and folds", () => {
    expect(legacyNamesOf("do-ship").sort()).toEqual(["promote", "ship"]);
    expect(legacyNamesOf("do-run").sort()).toEqual(["run-autonomous", "run-backlog", "run-burn", "tune-audit", "tune-rethink"]);
    expect(legacyNamesOf("setup-project")).toEqual([]);
  });

  test("isSkill treats old and new names alike", () => {
    expect(isSkill("devops:setup-issue", "auto-issue")).toBe(true);
    expect(isSkill("auto-issue", "setup-issue")).toBe(true);
    expect(isSkill("fix", "auto-issue")).toBe(false);
  });

  test("every FOLDED_TRIGGERS entry is a folded skill", () => {
    for (const oldName of Object.keys(FOLDED_TRIGGERS)) expect(FOLDED[oldName], oldName).toBeTruthy();
    for (const oldName of Object.keys(FOLDED)) expect(FOLDED_TRIGGERS[oldName], oldName).toBeTruthy();
  });

  test("modeForPhrase maps an old trigger to its mode (case-insensitive)", () => {
    expect(modeForPhrase("do-run", "Arbeite den Backlog ab")).toBe("backlog");
    expect(modeForPhrase("do-ship", "promote to stable")).toBe("promote");
    expect(modeForPhrase("do-ship", "ship it")).toBeNull();
    expect(modeForPhrase("auto-fix", "stuck")).toBeNull();
  });

  test("no new name is itself an old name (no chains)", () => {
    const olds = new Set([...Object.keys(RENAMED), ...Object.keys(FOLDED)]);
    for (const n of Object.values(RENAMED)) expect(olds.has(n), n).toBe(false);
    for (const f of Object.values(FOLDED)) expect(olds.has(f.skill), f.skill).toBe(false);
  });
});

describe("extension fallback — new name first, old name second", () => {
  test("candidates for a rename", () => {
    expect(extensionNameCandidates("do-ship")).toEqual(["do-ship", "ship"]);
    expect(extensionNameCandidates("ship")).toEqual(["do-ship", "ship"]);
    expect(extensionNameCandidates("auto-polish")).toEqual(["auto-polish", "tune-polish"]);
  });

  test("candidates for a mode add the folded skill's old name", () => {
    expect(extensionNameCandidates("do-run", "backlog")).toEqual(["do-run", "run-backlog"]);
    expect(extensionNameCandidates("do-ship", "promote")).toEqual(["do-ship", "ship", "promote"]);
    expect(extensionNameCandidates("do-run")).toEqual(["do-run"]);
  });

  function tmpProject(dirs) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-names-"));
    for (const d of dirs) {
      fs.mkdirSync(path.join(root, ".claude", "skills", d), { recursive: true });
      fs.writeFileSync(path.join(root, ".claude", "skills", d, "reference.md"), `# ${d}\n`);
    }
    return root;
  }

  test("resolves the old dir when only it exists", () => {
    const root = tmpProject(["tune-polish"]);
    expect(resolveExtensionFile(root, "auto-polish", "reference.md")).toBe(
      path.join(root, ".claude", "skills", "tune-polish", "reference.md"),
    );
  });

  test("the new dir wins when both exist", () => {
    const root = tmpProject(["tune-polish", "auto-polish"]);
    expect(resolveExtensionFile(root, "auto-polish", "reference.md")).toBe(
      path.join(root, ".claude", "skills", "auto-polish", "reference.md"),
    );
  });

  test("a mode falls back to the folded skill's dir", () => {
    const root = tmpProject(["run-backlog"]);
    expect(resolveExtensionFile(root, "do-run", "reference.md", { mode: "backlog" })).toBe(
      path.join(root, ".claude", "skills", "run-backlog", "reference.md"),
    );
    expect(resolveExtensionFile(root, "do-run", "reference.md")).toBeNull();
  });

  test("nothing found / bad base → null", () => {
    expect(resolveExtensionFile(tmpProject([]), "do-ship", "reference.md")).toBeNull();
    expect(resolveExtensionFile("", "do-ship", "reference.md")).toBeNull();
  });
});
