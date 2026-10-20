// auto-extend: scaffold a project extension for do-ship. Expected: reference.md
// only under .claude/skills/do-ship/ (a SKILL.md there would load as a skill of
// its own), as a minimal scaffold — a comment, no invented steps.
const fs = require("fs");
const path = require("path");

const REF = ".claude/skills/do-ship/reference.md";

module.exports = (g) => ({
  "extend-skill": g.skillInvoked("auto-extend"),
  "reference-md-scaffolded": g.fileExists(REF),
  "no-skill-md": (ctx) => !fs.existsSync(path.join(ctx.workdir, ".claude/skills/do-ship/SKILL.md")),
  "scaffold-minimal": (ctx) => {
    const p = path.join(ctx.workdir, REF);
    if (!fs.existsSync(p)) return false;
    return !/^#{2,3} (Step|Schritt)/im.test(fs.readFileSync(p, "utf8"));
  },
});
