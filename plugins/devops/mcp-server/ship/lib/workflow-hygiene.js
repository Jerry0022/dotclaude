/**
 * @module ship/lib/workflow-hygiene
 * @description Flag GitHub Actions habits that turn an account limit into a
 * blocked ship.
 *
 * The Actions artifact storage quota and the included minutes are shared by
 * every repo of the account. Once one repo fills the quota, an
 * `upload-artifact` step without `continue-on-error` fails a green test job in
 * ANY repo — and the ship's pre-merge checks gate blocks on it. Running each
 * ship's preflight over the workflows spreads three cheap defaults to every
 * consumer repo on its next ship, without a per-repo audit:
 *
 *   - upload-artifact-fatal      — a diagnostic upload (`if:` failure() /
 *                                  always() / !cancelled() — a report, not a
 *                                  build output) without `continue-on-error`.
 *                                  A hand-off upload (no such `if:`) stays
 *                                  fatal: the next job needs the files.
 *   - upload-artifact-retention  — an upload step without `retention-days`
 *                                  (the 90-day default holds quota for months)
 *   - pr-concurrency             — a pull_request workflow without a
 *                                  `concurrency:` group, so every push to an
 *                                  open PR keeps the superseded run going
 *
 * Text-based on purpose (no YAML dependency in the MCP server): the patterns
 * are line-shaped, and a miss only costs a warning, never a ship.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * Scan one workflow's text.
 * @returns {Array<{ line: number, rule: string, fix: string }>}
 */
export function scanWorkflowText(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const findings = [];

  lines.forEach((line, i) => {
    if (!/^\s*(-\s+)?uses:\s*actions\/upload-artifact@/.test(line)) return;
    // Step start: the `- ` item that owns this `uses:` line.
    let start = i;
    while (start >= 0 && !/^\s*-\s/.test(lines[start])) start--;
    if (start < 0) return;
    const stepIndent = indentOf(lines[start]);
    let end = start + 1;
    while (end < lines.length) {
      const l = lines[end];
      if (l.trim() && indentOf(l) <= stepIndent) break;
      end++;
    }
    const block = lines.slice(start, end).join("\n");
    const diagnostic = /^\s*(-\s+)?if:.*(failure\(\)|always\(\)|!\s*cancelled\(\))/m.test(block);
    if (diagnostic && !/^\s*continue-on-error:/m.test(block)) {
      findings.push({
        line: i + 1,
        rule: "upload-artifact-fatal",
        fix: "add `continue-on-error: true` to this report upload (a full account artifact quota must not fail a green job)",
      });
    }
    if (!/^\s*retention-days:/m.test(block)) {
      findings.push({
        line: i + 1,
        rule: "upload-artifact-retention",
        fix: "add `retention-days:` under `with:` (e.g. 7; 1 for a hand-off between jobs) — the default keeps it 90 days",
      });
    }
  });

  const hasPullRequest = lines.some((l) => /^\s{0,4}pull_request(_target)?\s*:?\s*$/.test(l) || /^on:\s*.*\bpull_request\b/.test(l));
  const hasConcurrency = lines.some((l) => /^concurrency\s*:/.test(l)) ||
    lines.some((l) => /^\s{2,4}concurrency\s*:/.test(l));
  if (hasPullRequest && !hasConcurrency) {
    findings.push({
      line: 1,
      rule: "pr-concurrency",
      fix: "add a top-level `concurrency: { group: <workflow>-${{ github.ref }}, cancel-in-progress: true }`",
    });
  }
  return findings;
}

/**
 * Scan `.github/workflows/*.yml|yaml` under `cwd`. Never throws.
 * @returns {{ findings: Array<{ file: string, line: number, rule: string, fix: string }> }}
 */
export function scanWorkflows(cwd) {
  const dir = join(cwd, ".github", "workflows");
  const findings = [];
  try {
    if (!existsSync(dir)) return { findings };
    for (const name of readdirSync(dir).sort()) {
      if (!/\.ya?ml$/i.test(name)) continue;
      let text;
      try { text = readFileSync(join(dir, name), "utf8"); } catch { continue; }
      for (const f of scanWorkflowText(text)) {
        findings.push({ file: `.github/workflows/${name}`, ...f });
      }
    }
  } catch { /* unreadable dir — no findings */ }
  return { findings };
}
