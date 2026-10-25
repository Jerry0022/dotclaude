// auto-fix A/B (skill vs no skill): natural bug report, no skill named. The
// graders are skill-agnostic (the fix itself); "fix-skill" only records whether
// the router/description made the model load the skill.
module.exports = (g) => ({
  "fix-skill": g.skillInvoked("auto-fix"),
  "bug-fixed": g.fileMatches("src/discount.js", /total\s*>=\s*100/),
  "reports-location": g.textMatches(/discount\.js:[0-9]+|discount\.js.{0,20}line [0-9]+/i),
});
