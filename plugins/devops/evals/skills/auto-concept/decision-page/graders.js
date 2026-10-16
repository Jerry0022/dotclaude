// auto-concept, decision mode pinned by the prompt; the bridge, the browser,
// crons and kills are denied. Expected: the skill loads, skips the mode
// question, writes a round fragment and lets `concept-build.js` build the
// page under docs/concepts/ (never a hand-written page), the page carries
// the decision panel and no clipboard / paste-into-chat hand-off, and no
// preview / Playwright / browser tool is used to open it.
const fs = require("fs");
const path = require("path");
const { FORBIDDEN } = require("../../../../hooks/lib/concept-gate.js");

// The copy-out / paste-to-chat entries of the concept gate (not its
// locale-key check, which is a page-quality rule, not a hand-off).
const HANDOFF = FORBIDDEN.filter((f) => /clipboard|zwischenablage|chat/i.test(f.why)).map((f) => f.re);
const BUILT_PAGE = /docs[\\/]+concepts[\\/]+[^\\/]+\.html$/i;

// Built pages are docs/concepts/*.html; the source folder holds fragments.
function builtPages(workdir) {
  const dir = path.join(workdir, "docs", "concepts");
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".html")).map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  } catch { return []; }
}
const mainCalls = (ctx, name) => ctx.parsed.toolCalls.filter((c) => !c.subagent && c.name === name);

module.exports = (g) => ({
  "concept-skill": g.skillInvoked("auto-concept"),
  "no-mode-question": (ctx) => mainCalls(ctx, "AskUserQuestion").length === 0,
  "page-built": (ctx) => builtPages(ctx.workdir).length > 0,
  "built-by-script": g.toolUsed("Bash", { inputMatch: /concept-build\.js\S*\s+build\b/, min: 1 }),
  "no-hand-written-page": (ctx) => !mainCalls(ctx, "Write").some((c) => BUILT_PAGE.test(String((c.input || {}).file_path || ""))),
  "decision-panel": (ctx) => builtPages(ctx.workdir).some((html) => /id="decision-panel"/.test(html) && /concept-decision-panel/.test(html)),
  "no-clipboard-handoff": (ctx) => {
    const pages = builtPages(ctx.workdir);
    return pages.length > 0 && pages.every((html) => !HANDOFF.some((re) => re.test(html)));
  },
  "no-browser-tool": (ctx) => !ctx.parsed.toolCalls.some((c) => !c.subagent && /Claude_Browser|Claude_Preview|playwright|claude-in-chrome|computer-use/i.test(c.name)),
});
