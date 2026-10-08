// auto-agents on a one-file typo fix. Expected: the Inline tier — the
// `▶ Inline · <reason>` line printed, no devops role agent spawned, the
// session fixes the file itself.
module.exports = (g) => ({
  "agents-skill": g.skillInvoked("auto-agents"),
  "inline-line": g.textMatches(/▶\s*Inline/),
  "no-role-agent": g.noDevopsAgent(),
  "typo-fixed": g.fileMatches("src/messages.js", /receive an email/),
});
