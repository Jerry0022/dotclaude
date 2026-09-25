import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Red-team R9 (skill restructure PR 2): hidden skills (`user-invocable: false`)
// have no slash command, yet user-facing texts still told the USER to type
// one ("/auto-update ausführen", "run `/auto-update`", "Skills (`/auto-fix`,
// `/auto-concept`) are available"). A hidden skill is reached by its trigger
// words — the texts name those, and the router must really route them.
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const require = createRequire(import.meta.url);

function hiddenSkills() {
  return fs.readdirSync(here, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(here, d.name, "SKILL.md")))
    .map((d) => d.name)
    .filter((name) => /^user-invocable:\s*false\s*$/m.test(fs.readFileSync(path.join(here, name, "SKILL.md"), "utf8")));
}

function triggersOf(name) {
  const text = fs.readFileSync(path.join(here, name, "SKILL.md"), "utf8");
  const pick = (lang) => {
    const m = new RegExp(`^\\s+${lang}: (\\[.*\\])\\s*$`, "m").exec(text);
    return m ? JSON.parse(m[1]) : [];
  };
  return { en: pick("en"), de: pick("de") };
}

const read = (p) => fs.readFileSync(p, "utf8");

describe("user-facing texts never tell the user to type a hidden skill's slash command", () => {
  const hidden = hiddenSkills();

  test("the hidden set is what the spec keeps hidden", () => {
    for (const name of ["auto-update", "auto-fix", "auto-concept", "auto-extend"]) expect(hidden).toContain(name);
  });

  const userFacing = [
    ["INSTALL.md", read(path.join(repoRoot, "INSTALL.md"))],
    ["CLAUDE.md", read(path.join(repoRoot, "CLAUDE.md"))],
    // the project ship extension: only its card items and the one line its
    // finalizer writes before the card on a failed sync reach the user
    [".claude/skills/do-ship/SKILL.md (card items)",
      (read(path.join(repoRoot, ".claude", "skills", "do-ship", "SKILL.md")).match(/\{ (?:action|line): "[^"]*"/g) || []).join("\n")],
    ["pre.ship.guard.js", read(path.join(pluginRoot, "hooks", "pre-tool-use", "pre.ship.guard.js"))],
    ["ss.mcp.verify.js", read(path.join(pluginRoot, "hooks", "session-start", "ss.mcp.verify.js"))],
  ];

  test.each(userFacing)("%s names no hidden slash command", (label, text) => {
    for (const name of hidden) {
      expect(text, `${label}: /${name}`).not.toMatch(new RegExp(`(^|[\\s(\`"'])/(?:devops:)?${name}\\b`));
    }
  });

  test("the update hint names the one phrase the router still routes to auto-update", () => {
    const { routeMessage } = require("../hooks/lib/skill-trigger-router.js");
    const skills = { "auto-update": { name: "auto-update", triggers: triggersOf("auto-update") } };
    expect(routeMessage("devops update", skills).map((e) => e.skill)).toEqual(["auto-update"]);
    for (const [label, text] of userFacing.slice(1)) {
      if (/update/i.test(text) && /auto-update/.test(text)) expect(text, label).toContain('"devops update"');
    }
    expect(read(path.join(repoRoot, "INSTALL.md"))).toMatch(/```\r?\ndevops update\r?\n```/);
    expect(userFacing[2][1]).toContain("»devops update«");
  });

  test("the trigger words INSTALL.md names really route to their hidden skills", () => {
    const { routeMessage } = require("../hooks/lib/skill-trigger-router.js");
    const skills = {};
    for (const name of ["auto-fix", "auto-concept", "auto-extend"]) skills[name] = { name, triggers: triggersOf(name) };
    const install = read(path.join(repoRoot, "INSTALL.md"));
    for (const [phrase, skill] of [["funktioniert nicht", "auto-fix"], ["this is broken", "auto-fix"],
      ["concept page", "auto-concept"], ["extend skill", "auto-extend"], ["customize skill", "auto-extend"]]) {
      expect(install, phrase).toContain(phrase);
      expect(routeMessage(phrase, skills).map((e) => e.skill), phrase).toContain(skill);
    }
  });
});
