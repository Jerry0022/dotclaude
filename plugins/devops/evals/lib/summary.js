// A-vs-B comparison over per-run result JSONs: pass rate per case+grader per
// variant (null grades excluded from the denominator), token totals, cost
// and mean duration per variant.

"use strict";

const { emptyUsage, addUsage, totalTokens } = require("./stream");

function summarize(results) {
  const variants = {};
  const graders = {};
  for (const r of results) {
    const v = (variants[r.variant] ||= { runs: 0, errors: 0, usage: emptyUsage(), costUsd: 0, durationMs: 0 });
    v.runs++;
    if (r.exitCode !== 0 || r.isError) v.errors++;
    addUsage(v.usage, r.usage);
    v.costUsd += Number(r.costUsd) || 0;
    v.durationMs += Number(r.durationMs) || 0;
    for (const [name, grade] of Object.entries(r.grades || {})) {
      const key = `${r.case}::${name}`;
      const g = (graders[key] ||= { case: r.case, grader: name, variants: {} });
      const gv = (g.variants[r.variant] ||= { pass: 0, graded: 0, undecided: 0, rate: null });
      if (grade === null || grade === undefined) gv.undecided++;
      else { gv.graded++; if (grade) gv.pass++; }
    }
  }
  for (const v of Object.values(variants)) {
    v.totalTokens = totalTokens(v.usage);
    v.meanDurationMs = v.runs ? Math.round(v.durationMs / v.runs) : 0;
    v.costUsd = Math.round(v.costUsd * 10000) / 10000;
  }
  for (const g of Object.values(graders)) {
    for (const gv of Object.values(g.variants)) gv.rate = gv.graded ? gv.pass / gv.graded : null;
  }
  return { variants, graders: Object.values(graders) };
}

function pct(rate) {
  return rate === null || rate === undefined ? "n/a" : `${Math.round(rate * 100)}%`;
}

function formatSummary(summary) {
  const names = Object.keys(summary.variants).sort();
  const lines = [];
  lines.push(["case :: grader", ...names].join(" | "));
  for (const g of summary.graders) {
    const cells = names.map((n) => {
      const gv = g.variants[n];
      return gv ? `${pct(gv.rate)} (${gv.pass}/${gv.graded}${gv.undecided ? `, ${gv.undecided} n/a` : ""})` : "-";
    });
    lines.push([`${g.case} :: ${g.grader}`, ...cells].join(" | "));
  }
  lines.push("");
  for (const n of names) {
    const v = summary.variants[n];
    lines.push(`${n}: runs=${v.runs} errors=${v.errors} tokens=${v.totalTokens} (in=${v.usage.input_tokens} out=${v.usage.output_tokens} cacheRead=${v.usage.cache_read_input_tokens} cacheWrite=${v.usage.cache_creation_input_tokens}) cost=$${v.costUsd} meanDuration=${v.meanDurationMs}ms`);
  }
  return lines.join("\n");
}

module.exports = { summarize, formatSummary, pct };
