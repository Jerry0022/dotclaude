// do-ship: "ship it" in a scaffold repo with one committed change; every real
// side effect is denied (push, gh, node, the ship MCP server). Expected: the
// skill loads, ship_preflight is attempted with the scaffold's cwd before any
// later ship step, no raw `git push` / `gh pr create|merge` is attempted as a
// fallback, and the run ends with a completion-card render attempt.
const path = require("path");
const { happensBefore } = require("../../order.js");

const isShip = (tool) => (e) => e.kind === "tool" && new RegExp(`dotclaude-ship__${tool}$`).test(e.name);
const LATER = (e) => e.kind === "tool" && /dotclaude-ship__ship_(build|version_bump|release|cleanup|hygiene)$/.test(e.name);
const RAW_SHIP = /git\s+(?:-C\s+\S+\s+)?push\b|gh\s+pr\s+(?:create|merge)\b/;
const norm = (s) => String(s).replace(/\\+/g, "/").toLowerCase();

module.exports = (g) => ({
  "ship-skill": g.skillInvoked("do-ship"),
  "schemas-or-direct": (ctx) => ctx.parsed.toolCalls.some((c) => !c.subagent && (
    (c.name === "ToolSearch" && /ship_preflight/.test(JSON.stringify(c.input || {}))) || /dotclaude-ship__ship_preflight$/.test(c.name))),
  "preflight-with-cwd": (ctx) => {
    const base = norm(path.basename(ctx.workdir || ""));
    return ctx.parsed.toolCalls.some((c) => !c.subagent && /dotclaude-ship__ship_preflight$/.test(c.name) &&
      c.input && typeof c.input.cwd === "string" && (!base || norm(c.input.cwd).includes(base)));
  },
  "preflight-first": (ctx) => happensBefore(ctx.raw, isShip("ship_preflight"), LATER),
  "no-raw-push-or-pr": g.toolUsed("Bash", { inputMatch: RAW_SHIP, min: 0, max: 0 }),
  "card-attempt": g.cardRendered(),
});
