// do-run audit mode (#734): `/do-run audit` in analyze form (scope all,
// result as concept) on a tiny scaffold repo. Under `claude -p` the router
// never reaches its follow-up questions (#719), so the case grades the
// observable path of the mode itself: the router hands over to
// `modes/audit.md`, the mode persists the requirement catalog and the
// findings under `.claude/audit/`, attempts the concept branch
// (`Skill("devops:auto-concept")`, no hand-built page), changes no source
// file, and calls no `ship_*` tool directly. Edit, Agent, gh, commit, push
// and do-ship are denied, so the lens agents never run and the run ends
// after the early steps.
module.exports = (g) => ({
  "run-skill": g.skillInvoked("do-run"),
  "mode-file-read": g.toolUsed(/^(Read|Bash|Grep)$/, { inputMatch: /modes[\\/]+audit\.md/ }),
  "requirements-persisted": g.toolUsed("Write", { inputMatch: /\.claude[\\/]+audit[\\/][^"]*requirements\.md/ }),
  "findings-persisted": g.toolUsed("Write", { inputMatch: /\.claude[\\/]+audit[\\/][^"]*findings\.json/ }),
  "concept-branch": (ctx) =>
    g.toolUsed("Skill", { inputMatch: /auto-concept/ })(ctx) === true ||
    g.toolUsed("Bash", { inputMatch: /concept-build\.js/ })(ctx) === true,
  "source-untouched": g.toolUsed(/^(Edit|Write)$/, { inputMatch: /src[\\/]+(notes|cli)\.js"/, min: 0, max: 0 }),
  "no-direct-ship-tools": g.toolUsed(/dotclaude-ship__ship_/, { min: 0, max: 0 }),
});
