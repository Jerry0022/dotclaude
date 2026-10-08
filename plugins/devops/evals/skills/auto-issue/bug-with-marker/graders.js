// auto-issue: a fully specified bug report, real gh writes denied. Expected:
// the skill loads, the attempted `gh issue create` carries the `# via
// auto-issue` marker, a `[BUG]` title, a `**User value:**` line in the body,
// and no stdin heredoc body (the guard would block it).
// "gh issue create" followed by a flag or a line continuation: a real
// command, not a card payload that merely names it.
const CMD = String.raw`gh issue create\s+(--|\\)`;
const after = (tail) => new RegExp(CMD + String.raw`[\s\S]*` + tail);

module.exports = (g) => ({
  "issue-skill": g.skillInvoked("auto-issue"),
  "create-attempted": g.toolUsed("Bash", { inputMatch: new RegExp(CMD) }),
  "via-marker": g.toolUsed("Bash", { inputMatch: after("# via auto-issue") }),
  "bug-title": g.toolUsed("Bash", { inputMatch: after(String.raw`\[BUG\] [A-Z]`) }),
  "user-value-line": g.toolUsed("Bash", { inputMatch: after(String.raw`\*\*User value:\*\*`) }),
  "no-stdin-body": g.toolUsed("Bash", { inputMatch: after("--body-file -"), min: 0, max: 0 }),
});
