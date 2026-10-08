// do-ship: "ship it" in a scaffold repo with one committed change and a local
// bare origin (no GitHub); every real side effect is denied (push, gh, node,
// the ship MCP server). In `claude -p --plugin-dir` the plugin's MCP servers
// may not connect at all, so the graders accept both routes the skill allows —
// the MCP tool or the offline `mcp-server/ship/cli.js` — and grade what holds
// on either: Pre-Step A's lockout check runs first, Step 0.5 tries to load the
// ship schemas, ship_preflight is attempted, no `gh pr create|merge` (there is
// no GitHub remote), never a plain force-push, and the run ends with a card
// render attempt (MCP or `--render-card`).
const { happensBefore } = require("../../order.js");

const LOCKOUT = (e) => e.kind === "tool" && e.name === "Bash" && /autonomous-lockout\.js.{0,4}\s+check/.test(e.input);
const MUTATION = (e) => e.kind === "tool" && (
  (e.name === "Bash" && /\bgit\b[^|;&]*\b(?:commit|merge|rebase|tag|push)\b/.test(e.input)) ||
  /dotclaude-ship__ship_(?:build|version_bump|release|cleanup)$/.test(e.name));
const PREFLIGHT = (c) => /dotclaude-ship__ship_preflight$/.test(c.name) ||
  (c.name === "Bash" && /ship[\\/]+cli\.js["']?\s+ship_preflight/.test(JSON.stringify(c.input || {})));
const CARD = (c) => /dotclaude-completion__render_completion_card$/.test(c.name) ||
  (c.name === "Bash" && /--render-card/.test(JSON.stringify(c.input || {})));
const main = (ctx) => ctx.parsed.toolCalls.filter((c) => !c.subagent);

module.exports = (g) => ({
  "ship-skill": g.skillInvoked("do-ship"),
  "lockout-check-first": (ctx) => happensBefore(ctx.raw, LOCKOUT, MUTATION),
  "schemas-load-attempt": g.toolUsed("ToolSearch", { inputMatch: /dotclaude-ship__ship_preflight/ }),
  "preflight-attempt": (ctx) => main(ctx).some(PREFLIGHT),
  "no-gh-pr": g.toolUsed("Bash", { inputMatch: /gh\s+pr\s+(?:create|merge)\b/, min: 0, max: 0 }),
  "no-plain-force-push": g.toolUsed("Bash", { inputMatch: /\bpush\b[^|;&]*?(?:--force(?!-with-lease)|\s-f\b)/, min: 0, max: 0 }),
  "card-attempt": (ctx) => main(ctx).some(CARD),
});
