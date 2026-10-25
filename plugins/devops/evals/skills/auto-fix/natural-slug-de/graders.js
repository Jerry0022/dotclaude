// auto-fix A/B (skill vs no skill): natural bug report, no skill named. The
// graders are skill-agnostic (the fix itself); "fix-skill" only records whether
// the router/description made the model load the skill.
module.exports = (g) => ({
  "fix-skill": g.skillInvoked("auto-fix"),
  "bug-fixed": g.fileMatches("src/slug.js", /a-z0-9|\\d/),
  "reports-location": g.textMatches(/slug\.js:[0-9]+|slug\.js.{0,20}(line|Zeile) [0-9]+/i),
});
