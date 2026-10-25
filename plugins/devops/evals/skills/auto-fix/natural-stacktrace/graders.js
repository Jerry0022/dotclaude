// auto-fix A/B (skill vs no skill): natural bug report, no skill named. The
// graders are skill-agnostic (the fix itself); "fix-skill" only records whether
// the router/description made the model load the skill.
module.exports = (g) => ({
  "fix-skill": g.skillInvoked("auto-fix"),
  "bug-fixed": g.fileMatches("src/user.js", /profile\s*(\?\.|&&|\|\|)|\?\.name|!\s*user\.profile|user\.profile\s*\?|\(user\.profile\s*\|\|/),
  "reports-location": g.textMatches(/user\.js:2\b|user\.js.{0,20}line 2\b/i),
});
