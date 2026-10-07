// do-learn in a consumer project with a project-only rule → branch C: the
// rule lands in this project's own instructions (.claude/** or CLAUDE.md),
// no upstream issue, no write to feedback memory.
const fs = require("fs");
const path = require("path");

function projectRuleFiles(root) {
  const hits = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.md$/.test(e.name) && /migration/i.test(fs.readFileSync(p, "utf8"))) hits.push(p);
    }
  };
  walk(path.join(root, ".claude"));
  for (const f of ["CLAUDE.md", "CLAUDE.local.md"]) {
    const p = path.join(root, f);
    if (fs.existsSync(p) && /migration/i.test(fs.readFileSync(p, "utf8"))) hits.push(p);
  }
  return hits;
}

module.exports = (g) => ({
  "learn-skill": g.skillInvoked("do-learn"),
  "rule-in-project": (ctx) => projectRuleFiles(ctx.workdir).length > 0,
  "no-issue": (ctx) => g.skillNotInvoked("auto-issue")(ctx) && g.toolUsed(/^mcp__plugin_devops_dotclaude-issues__/, { min: 0, max: 0 })(ctx),
  "no-memory-write": (ctx) =>
    g.toolUsed("Write", { inputMatch: /memory|feedback_/i, min: 0, max: 0 })(ctx) &&
    g.toolUsed("Edit", { inputMatch: /memory|feedback_/i, min: 0, max: 0 })(ctx),
});
