// Same scaffold and graders as off-by-one-root-cause, but the prompt names the
// skill: in the natural-prompt case the model often fixes inline without
// loading auto-fix, which leaves the skill body untested.
// auto-fix: the loop in src/total.js:3 starts at index 1. Expected: the skill
// loads, names the root cause before the first edit, fixes the loop, and the
// report carries the file:line.
const { happensBefore } = require("../../order.js");

const ROOT_CAUSE = /root cause|ursache|off-by-one|index 1|i = 1|skips the first/i;
const EDIT_TOTAL = (e) => e.kind === "tool" && /^(Edit|Write|MultiEdit)$/.test(e.name) && /total\.js/.test(e.input);

module.exports = (g) => ({
  "fix-skill": g.skillInvoked("auto-fix"),
  "loop-fixed": g.fileMatches("src/total.js", /let i = 0/),
  "root-cause-before-edit": (ctx) => happensBefore(ctx.raw, (e) => e.kind === "text" && ROOT_CAUSE.test(e.text), EDIT_TOTAL),
  "reports-file-line": g.textMatches(/total\.js:3\b|total\.js.{0,20}line 3\b/i),
});
