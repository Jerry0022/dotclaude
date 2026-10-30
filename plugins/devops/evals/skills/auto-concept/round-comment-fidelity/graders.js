// auto-concept round 2 after four specific comments (one general, one per
// variant). Expected: round 2 answers every comment on its own — the git-diff
// constraint is applied to all three variants, concurrent writes, FTS5 vs.
// grep, and a concrete Markdown note file with front matter — instead of a
// summary that drops the details; a brief for concept-author quotes them.
const { round, text, base, briefVerbatim } = require("../round-graders.js");

const r2 = (ctx) => text(round(ctx.workdir, 2));

module.exports = (g) => ({
  ...base(g),
  "answers-git-diff": (ctx) => /git[ -]?diff/i.test(r2(ctx)),
  "answers-concurrency": (ctx) => /gleichzeitig|parallel|concurren|zwei Terminals|Sperr|lock/i.test(r2(ctx)),
  "answers-fts": (ctx) => /FTS5/i.test(r2(ctx)) && /grep/i.test(r2(ctx)),
  "answers-front-matter-example": (ctx) => {
    const html = round(ctx.workdir, 2);
    return /front[ -]?matter/i.test(text(html)) && /<(pre|code)[\s>][\s\S]*?---[\s\S]*?(tags?|Tags?):/i.test(html);
  },
  "brief-verbatim": briefVerbatim(["harte Bedingung", "zwei Terminals", "FTS5", "Front Matter"]),
});
