// auto-polish --invoked-by=ship (rules-only path) on one JSX file with two
// icon-only buttons, a hardcoded colour and off-scale spacing. Expected:
// findings reported (tooltip rule), the file untouched, no devops agent.
module.exports = (g) => ({
  "polish-ship-path": g.toolUsed("Skill", { inputMatch: /auto-polish[^}]*invoked-by=ship/ }),
  "no-edit": (ctx) =>
    g.toolUsed("Edit", { inputMatch: /Toolbar/, min: 0, max: 0 })(ctx) &&
    g.toolUsed("Write", { inputMatch: /Toolbar/, min: 0, max: 0 })(ctx) &&
    g.fileMatches("src/Toolbar.jsx", /marginLeft: 13/)(ctx),
  "tooltip-finding": g.textMatches(/\bR1\b|tooltip/i),
  "no-role-agent": g.noDevopsAgent(),
});
