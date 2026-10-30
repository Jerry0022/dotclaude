// Shared graders of the round-2 cases (round-scaffold.sh): the skill loads,
// round 1 is baked, round 2 is written as a fragment and built by
// `concept-build.js`, it is no premature final report, and — when the round
// went to the concept-author agent — the brief carries the user's comments
// verbatim (the author's only view of the conversation, agents/concept-author.md).
"use strict";
const fs = require("fs");
const path = require("path");

const NAME = "20261030-1200-notes-storage";

function roots(workdir) {
  const out = [workdir];
  const wt = path.join(workdir, ".claude", "worktrees");
  try { for (const n of fs.readdirSync(wt)) out.push(path.join(wt, n)); } catch { /* no worktrees */ }
  return out;
}
function readFirst(workdir, rel) {
  for (const r of roots(workdir)) {
    try { return fs.readFileSync(path.join(r, rel), "utf8"); } catch { /* next root */ }
  }
  return "";
}
const round = (workdir, n) => readFirst(workdir, `docs/concepts/${NAME}/rounds/${String(n).padStart(2, "0")}.html`);
const brief = (workdir) => readFirst(workdir, `docs/concepts/${NAME}/briefs/02.md`);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// Every decision group of a round: { id, label } from `data-decision` /
// `data-label`, in any attribute order.
function decisions(html) {
  const out = [];
  for (const m of html.matchAll(/<[^>]*\sdata-decision="([^"]+)"[^>]*>/g)) {
    const label = /\sdata-label="([^"]*)"/.exec(m[0]);
    out.push({ id: m[1], label: label ? label[1] : "" });
  }
  return out;
}

function base(g) {
  return {
    "concept-skill": g.skillInvoked("auto-concept"),
    "round1-baked": (ctx) => /<section[^>]*\sdata-baked/.test(round(ctx.workdir, 1)),
    "round2-written": (ctx) => /data-iteration="2"/.test(round(ctx.workdir, 2)),
    "built-by-script": g.toolUsed("Bash", { inputMatch: /concept-build\.js\S*\s+build\b/, min: 1 }),
    "no-final-report": (ctx) => {
      const r2 = round(ctx.workdir, 2);
      return r2 !== "" && !/data-final-report/.test(r2);
    },
  };
}

// `needles` = distinctive fragments of the user's comments. With no brief the
// round was written inline and the grader does not apply.
const briefVerbatim = (needles) => (ctx) => {
  const b = brief(ctx.workdir);
  return b === "" || needles.every((n) => b.includes(n));
};

module.exports = { NAME, round, brief, text, decisions, base, briefVerbatim };
