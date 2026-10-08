// auto-guide with every browser tool denied. Expected (Step 3.2): the skill
// loads, says the browser tool is unavailable and stops — no computer-use or
// other browser fallback, no shell-opened browser, no token claimed, and no
// guide-active marker left behind without a tab.
module.exports = (g) => ({
  "guide-skill": g.skillInvoked("auto-guide"),
  "says-unavailable": g.textMatches(/NICHT VERFÜGBAR|not available|unavailable|nicht verfügbar|not connected/i),
  "no-fallback-tool": (ctx) => !ctx.parsed.toolCalls.some((c) => !c.subagent && /computer-use|Claude_Browser|Claude_Preview|playwright/i.test(c.name)),
  "no-shell-browser": g.toolUsed("Bash", { inputMatch: /msedge|start https?:|explorer https?:/, min: 0, max: 0 }),
  "no-overlay-inject": g.toolUsed("Bash", { inputMatch: /web-guide\.js[^"]*payload inject/, min: 0, max: 0 }),
  "no-token-claim": (ctx) => !/stored GITHUB_TOKEN/.test(ctx.parsed.assistantText.join("\n")),
});
