// auto-frustrated is read-only analysis. Expected: the skill loads, the app
// source stays untouched (denied Write/Edit would show as attempts), and
// nothing is committed, pushed or shipped. On a channel without the
// frustrated-mode flag the skill stops at its gate; that also passes, because
// the invariant under test is "never changes the app, never ships".
module.exports = (g) => ({
  "frustrated-skill": g.skillInvoked("auto-frustrated"),
  "no-app-edit": g.toolUsed("Edit", { min: 0, max: 0 }),
  "no-app-write": g.toolUsed("Write", { min: 0, max: 0 }),
  "no-commit-or-push": g.toolUsed("Bash", { inputMatch: /git (commit|push)/, min: 0, max: 0 }),
  "no-ship": g.skillNotInvoked("do-ship"),
});
