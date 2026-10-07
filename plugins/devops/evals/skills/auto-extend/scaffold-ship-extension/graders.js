// auto-extend: scaffold a project extension for do-ship. Expected: both files
// under .claude/skills/do-ship/ (the current skill name), and a minimal
// SKILL.md scaffold — frontmatter plus a comment, no invented steps.
const fs = require("fs");
const path = require("path");

const SKILL = ".claude/skills/do-ship/SKILL.md";

module.exports = (g) => ({
  "extend-skill": g.skillInvoked("auto-extend"),
  "skill-md-scaffolded": g.fileMatches(SKILL, /name:\s*do-ship/),
  "reference-md-scaffolded": g.fileExists(".claude/skills/do-ship/reference.md"),
  "scaffold-minimal": (ctx) => {
    const p = path.join(ctx.workdir, SKILL);
    if (!fs.existsSync(p)) return false;
    return !/^#{2,3} (Step|Schritt)/im.test(fs.readFileSync(p, "utf8"));
  },
});
