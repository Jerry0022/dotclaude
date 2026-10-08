// auto-issue: a fully specified bug report. `gh` is a sandbox stub
// (scaffold.sh, first on PATH via `path_prepend`) that answers
// `gh issue create` with a fixed URL and reaches no GitHub. Expected: the
// skill loads, the `gh issue create` carries the `# via auto-issue` marker,
// a `[BUG]` title, a `**User value:**` line in the body and no stdin heredoc
// body; pre.issue.guard lets it through although `claude -p
// --no-session-persistence` writes no transcript (per-turn skill marker),
// and the stub records the write.
// "gh issue create" followed by a flag or a line continuation: a real
// command, not a card payload that merely names it.
const CMD = String.raw`gh issue create\s+(--|\\)`;
const after = (tail) => new RegExp(CMD + String.raw`[\s\S]*` + tail);
const STUB_URL = String.raw`example-org/settings-demo/issues/4242`;

module.exports = (g) => ({
  "issue-skill": g.skillInvoked("auto-issue"),
  "create-attempted": g.toolUsed("Bash", { inputMatch: new RegExp(CMD) }),
  "via-marker": g.toolUsed("Bash", { inputMatch: after("# via auto-issue") }),
  "bug-title": g.toolUsed("Bash", { inputMatch: after(String.raw`\[BUG\] [A-Z]`) }),
  "user-value-line": g.toolUsed("Bash", { inputMatch: after(String.raw`\*\*User value:\*\*`) }),
  "no-stdin-body": g.toolUsed("Bash", { inputMatch: after("--body-file -"), min: 0, max: 0 }),
  // The guard's deny text never shows up in a tool result.
  "guard-passed": (ctx) => !g.traceMatches(/BLOCKED: Raw GitHub issue write/)(ctx),
  // The stub ran `issue create` and its URL came back as a tool result.
  "write-succeeded": (ctx) =>
    g.fileMatches("gh-calls.log", /(^|\s)issue create(\s|$)/m)(ctx) &&
    g.traceMatches(new RegExp(String.raw`"tool_result".*` + STUB_URL))(ctx),
});
