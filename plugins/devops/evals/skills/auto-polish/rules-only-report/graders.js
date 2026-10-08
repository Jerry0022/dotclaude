// auto-polish --invoked-by=ship (rules-only path) on one JSX file with two
// icon-only buttons, a hardcoded colour and off-scale spacing. Expected:
// findings reported (tooltip rule), the file untouched, no devops agent.
const TOOLBAR_PATH = /"file_path":"[^"]*Toolbar\.jsx"/;

module.exports = (g) => ({
  "polish-ship-path": g.toolUsed("Skill", { inputMatch: /auto-polish[^}]*invoked-by=ship/ }),
  // file_path, not the whole input: a card JSON written elsewhere may name the file.
  "no-edit": (ctx) =>
    g.toolUsed("Edit", { inputMatch: TOOLBAR_PATH, min: 0, max: 0 })(ctx) &&
    g.toolUsed("Write", { inputMatch: TOOLBAR_PATH, min: 0, max: 0 })(ctx),
  "file-intact": g.fileMatches("src/Toolbar.jsx", /marginLeft: 13/),
  "tooltip-finding": g.textMatches(/\bR1\b|tooltip/i),
  "no-role-agent": g.noDevopsAgent(),
});
