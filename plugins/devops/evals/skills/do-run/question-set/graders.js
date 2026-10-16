// do-run router: an implementation prompt with a constraint, in a scaffold
// repo without a remote (so the Backlog probe finds nothing). Edit and Agent
// are denied, so the run stops at the router's own work. Graded: the task is
// written verbatim to .claude/run-task.md BEFORE the base call; the base call
// is one AskUserQuestion with the headers "Was?", "Ablauf?", "Umfang?" in that
// order, the agnostic recommendation first, Q4 ending on "Nichts davon", no
// Backlog option without open issues; no edit attempt precedes the question.
const { happensBefore } = require("../../order.js");

const TASK_WRITE = (e) => e.kind === "tool" && e.name === "Write" && /run-task\.md/.test(e.input);
const ASK = (e) => e.kind === "tool" && e.name === "AskUserQuestion";
const EDIT = (e) => e.kind === "tool" && /^(Edit|Write)$/.test(e.name) && /greet\.js/.test(e.input);

module.exports = (g) => ({
  "run-skill": g.skillInvoked("do-run"),
  "task-verbatim": g.fileMatches(".claude/run-task.md", /Helo[\s\S]*README\.md/),
  "task-before-question": (ctx) => happensBefore(ctx.raw, TASK_WRITE, ASK),
  "base-call-headers": g.toolUsed("AskUserQuestion", { inputMatch: /Was\?[\s\S]*Ablauf\?[\s\S]*Umfang\?/ }),
  "recommended-first": g.toolUsed("AskUserQuestion", { inputMatch: /Prompt umsetzen \(Recommended\)[\s\S]*Interaktiv · Ship manuell \(Recommended\)[\s\S]*Flexibel \(Recommended\)/ }),
  "q4-nichts-davon": g.toolUsed("AskUserQuestion", { inputMatch: /Durchgänge\?[\s\S]*Nichts davon/ }),
  "no-backlog-option": g.toolUsed("AskUserQuestion", { inputMatch: /"label":\s*"Backlog/, min: 0, max: 0 }),
  "question-before-edit": (ctx) => happensBefore(ctx.raw, ASK, EDIT),
});
