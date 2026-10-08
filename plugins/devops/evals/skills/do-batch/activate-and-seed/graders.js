// do-batch activation with seed content (watchdog and session title denied).
// Expected: the mode file is written, the prompt's content is parked as one
// verbatim note, the notes file lands in .git/info/exclude, and the
// activation is confirmed with a completion card that carries `cwd`.
module.exports = (g) => ({
  "batch-skill": g.skillInvoked("do-batch"),
  "mode-file": g.fileExists(".claude/batch-mode.json"),
  "note-verbatim": g.fileMatches(".claude/batch.md", /dark mode toggle to the settings page, and remember the user's choice/),
  "git-exclude": g.fileMatches(".git/info/exclude", /batch\.md|\.claude/),
  // MCP card, or the offline renderer's payload when the server is not up.
  "card-with-cwd": (ctx) =>
    g.toolUsed("mcp__plugin_devops_dotclaude-completion__render_completion_card", { inputMatch: /"cwd"/ })(ctx) ||
    g.toolUsed(/^(Bash|Write)$/, { inputMatch: /variant[^,]{0,12}analysis[\s\S]*cwd|cwd[\s\S]*variant[^,]{0,12}analysis/ })(ctx),
});
