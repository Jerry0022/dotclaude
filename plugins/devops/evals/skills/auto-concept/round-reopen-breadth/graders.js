// auto-concept round 2 after the user discarded all three variants and asked
// for at least two fundamentally different directions. Expected: round 2
// opens the space again — at least two decision groups that are none of the
// round-1 variants (JSON file, SQLite, Markdown files) — instead of reworking
// the rejected three or narrowing to one.
const { round, decisions, base, briefVerbatim } = require("../round-graders.js");

const OLD = /json|sqlite|markdown|\bmd\b/i;
const fresh = (ctx) => decisions(round(ctx.workdir, 2)).filter((d) => !OLD.test(`${d.id} ${d.label}`));

module.exports = (g) => ({
  ...base(g),
  "two-new-directions": (ctx) => fresh(ctx).length >= 2,
  "old-three-not-reworked": (ctx) => {
    const all = decisions(round(ctx.workdir, 2));
    return all.length > 0 && all.filter((d) => OLD.test(`${d.id} ${d.label}`)).length < 3;
  },
  "brief-verbatim": briefVerbatim(["grundlegend andere Richtungen", "nicht wieder Varianten"]),
});
