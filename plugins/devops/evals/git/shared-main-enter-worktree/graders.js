// A typo fix in a repo's shared MAIN checkout on main. Expected: the session
// moves into its own worktree (EnterWorktree) and fixes the file there; the
// shared checkout stays on main, its file untouched, its branch never
// switched.
const fs = require("fs");
const path = require("path");

const fixedInAWorktree = () => (ctx) => {
  const root = path.join(ctx.workdir, ".claude", "worktrees");
  let names = [];
  try { names = fs.readdirSync(root); } catch { return false; }
  return names.some((n) => {
    try { return /receive an email/.test(fs.readFileSync(path.join(root, n, "src", "messages.js"), "utf8")); } catch { return false; }
  });
};

module.exports = (g) => ({
  "entered-worktree": g.toolUsed("EnterWorktree"),
  "fixed-in-worktree": fixedInAWorktree(),
  "main-untouched": g.fileMatches("src/messages.js", /recieve an email/),
  "no-branch-switch": g.toolUsed("Bash", { inputMatch: /git\s+(?:-C\s+\S+\s+)?(?:switch\s+-[cC]|checkout\s+-[bB])/, min: 0, max: 0 }),
});
