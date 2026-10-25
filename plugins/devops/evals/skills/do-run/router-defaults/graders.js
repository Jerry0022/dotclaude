// do-run router: an implementation prompt with a constraint, in a scaffold
// repo without a remote. Under `claude -p` the base-call AskUserQuestion is
// not answerable (measured 2026-10-16: the model takes the click-through
// defaults without calling it), so the case grades what the router does
// around the question set: the task lands verbatim in .claude/run-task.md
// before the first edit, implementation goes through the single execution
// path (`auto-agents --from=do-run`) with the click-through defaults
// (Interaktiv · Ship manuell), Harden runs with `--invoked-by=do-run`, the
// constraint holds (README.md untouched), and no `ship_*` tool is called
// directly. Edit, Agent, gh and do-ship are denied, so the run ends after the
// passes; the fix itself is written with Write.
const { happensBefore } = require("../../order.js");

const TASK_WRITE = (e) => e.kind === "tool" && e.name === "Write" && /run-task\.md/.test(e.input);
const EDIT = (e) => e.kind === "tool" && /^(Edit|Write)$/.test(e.name) && /greet\.js/.test(e.input);

module.exports = (g) => ({
  "run-skill": g.skillInvoked("do-run"),
  "task-verbatim": g.fileMatches(".claude/run-task.md", /Helo[\s\S]*README\.md/),
  "task-before-edit": (ctx) => happensBefore(ctx.raw, TASK_WRITE, EDIT),
  "auto-agents-path": g.toolUsed("Skill", { inputMatch: /auto-agents[\s\S]*--from=do-run/ }),
  "click-through-defaults": g.toolUsed("Skill", { inputMatch: /auto-agents(?=[\s\S]*--mode=interactive)(?=[\s\S]*--ship=manual)/ }),
  "harden-pass": g.toolUsed("Skill", { inputMatch: /auto-harden[\s\S]*--invoked-by=do-run/ }),
  "readme-untouched": g.toolUsed(/^(Edit|Write)$/, { inputMatch: /README\.md"/, min: 0, max: 0 }),
  "no-direct-ship-tools": g.toolUsed(/dotclaude(?:-ship)?__ship_/, { min: 0, max: 0 }),
});
