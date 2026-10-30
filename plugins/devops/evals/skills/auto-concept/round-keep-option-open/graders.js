// auto-concept round 2 with a clear favourite (SQLite, 5) and a weaker
// variant the user explicitly keeps open (Markdown, 3: "noch nicht
// streichen", compare on sync between two laptops). Expected: round 2 does
// not collapse to the favourite — Markdown stays a decision next to SQLite and
// the two are compared on sync.
const { round, text, decisions, base, briefVerbatim } = require("../round-graders.js");

const has = (ctx, re) => decisions(round(ctx.workdir, 2)).some((d) => re.test(`${d.id} ${d.label}`));

module.exports = (g) => ({
  ...base(g),
  "markdown-still-open": (ctx) => has(ctx, /markdown|\bmd\b/i),
  "sqlite-still-open": (ctx) => has(ctx, /sqlite/i),
  "compared-on-sync": (ctx) => /sync/i.test(text(round(ctx.workdir, 2))),
  "brief-verbatim": briefVerbatim(["Noch nicht streichen", "zwei Laptops"]),
});
