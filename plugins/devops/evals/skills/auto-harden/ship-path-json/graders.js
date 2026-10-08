// auto-harden --invoked-by=ship on a diff with `debugger;`, `test.only(` and
// a TODO. Expected: the skill runs scripts/ship-harden.js and returns its
// JSON shape (applicable / fixed / findings), mechanical fixes applied
// (H1, H2), the TODO only reported (H7), no agent, no question while the
// skill runs (a question after the JSON answers the Stop hook's card flow).
const { happensBefore } = require("../../order.js");

const JSON_SHOWN = (e) => e.kind === "text" && /applicable/.test(e.text);
const ASK = (e) => e.kind === "tool" && e.name === "AskUserQuestion";

module.exports = (g) => ({
  "harden-ship-path": g.toolUsed("Skill", { inputMatch: /auto-harden[^}]*invoked-by=ship/ }),
  "script-run": g.toolUsed("Bash", { inputMatch: /ship-harden\.js/ }),
  "json-shape": (ctx) => /applicable/.test(ctx.parsed.assistantText.join("\n")) && /findings/.test(ctx.parsed.assistantText.join("\n")),
  "todo-reported": g.textMatches(/H7/),
  "debugger-removed": (ctx) => !g.fileMatches("src/math.js", /debugger;/)(ctx) && g.fileMatches("src/math.js", /return a \+ b/)(ctx),
  "no-role-agent": g.noDevopsAgent(),
  "no-question-in-skill": (ctx) => happensBefore(ctx.raw, JSON_SHOWN, ASK),
});
