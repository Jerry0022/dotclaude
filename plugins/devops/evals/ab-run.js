#!/usr/bin/env node
// A/B runner: runs eval cases through `claude -p` against one or two plugin
// directories (variant A vs variant B) with the INSTALLED devops plugin
// disabled, writes one result JSON (+ raw stream) per run and an A-vs-B
// summary. See evals/README.md "A/B runner".
//
// Usage: node plugins/devops/evals/ab-run.js --case <dir|glob> [options]
//   --case <spec>     case dir or glob over ids under evals/ (repeatable)
//   --b <dir>         variant B plugin dir (default: this working tree's plugins/devops)
//   --a <dir>         variant A plugin dir
//   --a-ref <ref>     variant A materialised from a git ref (temp worktree)
//   --runs <n>        runs per case per variant (default 1)
//   --out <dir>       results root (default evals/results/)
//   --model <m>       pass --model to claude
//   --timeout-min <n> per-run timeout in minutes (default 5)
//   --disable <key>   enabledPlugins key to disable (repeatable, default devops@dotclaude)
//   --keep-workdir    keep each run's temp project dir
//   --dry-run         print the exact commands, call no model
//   --api-credit      bill the runs to the plan's monthly API credit (devops key,
//                     deep-knowledge/api-credits.md); default: on when apiCredit.enabled
//                     and a key is stored AND this runs from your own terminal
//   --no-api-credit   always bill the runs to the plan login
//   --summarize <dir> re-summarise an existing results run dir and exit

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { EVALS_DIR, loadCase, resolveCases } = require("./lib/case");
const {
  INSTALLED_PLUGIN_KEY, buildSettings, buildClaudeArgs, formatCommand,
  resolveClaudeBin, resolveBash, materializeRef,
} = require("./lib/command");
const { parseStream } = require("./lib/stream");
const { loadGraders, gradeRun } = require("./lib/graders");
const { summarize, formatSummary } = require("./lib/summary");

function parseArgs(argv) {
  const opts = { cases: [], runs: 1, out: path.join(EVALS_DIR, "results"), timeoutMin: 5, disable: [], dryRun: false, keepWorkdir: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--case": opts.cases.push(next()); break;
      case "--a": opts.a = path.resolve(next()); break;
      case "--a-ref": opts.aRef = next(); break;
      case "--b": opts.b = path.resolve(next()); break;
      case "--runs": opts.runs = Number(next()); break;
      case "--out": opts.out = path.resolve(next()); break;
      case "--model": opts.model = next(); break;
      case "--timeout-min": opts.timeoutMin = Number(next()); break;
      case "--disable": opts.disable.push(next()); break;
      case "--keep-workdir": opts.keepWorkdir = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--api-credit": opts.apiCredit = "on"; break;
      case "--no-api-credit": opts.apiCredit = "off"; break;
      case "--summarize": opts.summarize = path.resolve(next()); break;
      default: throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!opts.disable.length) opts.disable = [INSTALLED_PLUGIN_KEY];
  if (!opts.b) opts.b = path.join(EVALS_DIR, "..");
  if (opts.a && opts.aRef) throw new Error("use either --a or --a-ref, not both");
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Error("--runs must be a positive integer");
  if (!Number.isFinite(opts.timeoutMin) || opts.timeoutMin <= 0) throw new Error("--timeout-min must be a positive number");
  if (!opts.summarize && !opts.cases.length) throw new Error("--case is required");
  return opts;
}

// The calling session's CLAUDE*/ANTHROPIC* vars (nested-session marker, the
// Desktop host's ANTHROPIC_BASE_URL and auth-refresh flags) make the child CLI
// fail with "Not logged in" / 401 — strip them; the case env is added after.
// `pathPrepend` (absolute dirs) goes in front of PATH — under whatever
// casing the env spells it (`Path` on Windows), so no second PATH appears.
function childEnv(caseEnv, parentEnv = process.env, pathPrepend = [], apiKey = null) {
  const env = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    // DEVOPS_ANTHROPIC_API_KEY too: the plugin under test must not route its
    // own side work onto the credit (cost, and a skewed A/B comparison).
    if (!/^(CLAUDE|ANTHROPIC|DEVOPS_ANTHROPIC)/i.test(k)) env[k] = v;
  }
  const out = { ...env, ...caseEnv };
  // `-p` always uses ANTHROPIC_API_KEY when present — set only in the child.
  if (apiKey) out.ANTHROPIC_API_KEY = apiKey;
  if (pathPrepend.length) {
    const key = Object.keys(out).find((k) => k.toUpperCase() === "PATH") || "PATH";
    out[key] = [...pathPrepend, out[key]].filter(Boolean).join(path.delimiter);
  }
  return out;
}

// Runs started from inside a Claude Code session (desktop app, IDE, a
// nested `claude`) count as Claude Code usage, which the plan's API credit
// does not cover — measured 2026-10-19: such a child drew the purchased
// balance. Only a run the user starts from their own terminal is "run it
// yourself" (Help Center 17154008), so the credit is used only there.
function resolveApiCredit(mode = "auto", parentEnv = process.env, deps = {}) {
  const safe = deps.safe || require("../scripts/claude-api-safe");
  if (mode === "off") return { key: null, note: "plan login (--no-api-credit)" };
  const inSession = Boolean(parentEnv.CLAUDECODE || parentEnv.CLAUDE_CODE_ENTRYPOINT);
  const sw = safe.loadSwitches({});
  const keyInfo = safe.resolveKey({ env: parentEnv });
  if (mode === "on") {
    if (inSession) return { error: "--api-credit: started inside a Claude Code session — that counts as Claude Code usage, which the API credit does not cover. Run ab-run.js from your own terminal." };
    if (!keyInfo) return { error: "--api-credit: no DEVOPS_ANTHROPIC_API_KEY stored (deep-knowledge/api-credits.md § The key)." };
    return { key: keyInfo.key, note: "API credit (devops key)" };
  }
  if (!sw.enabled || !keyInfo) return { key: null, note: "plan login" };
  if (inSession) return { key: null, note: "plan login — inside a Claude Code session the API credit does not apply; run from your own terminal to use it" };
  return { key: keyInfo.key, note: "API credit (apiCredit.enabled, devops key)" };
}

// A failed run (auth error, crash, timeout) is no evidence either way:
// grade it as undecided instead of letting "nothing happened" pass.
function gradeOrUndecided(graders, exitCode, ctx) {
  if (exitCode !== 0 || ctx.parsed.isError) return Object.fromEntries(graders.map((g) => [g.name, null]));
  return gradeRun(graders, ctx);
}

function runOne({ caseDef, variant, run, opts, bin, bash, graders, runDir }) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-case-"));
  const args = buildClaudeArgs({
    prompt: caseDef.prompt, pluginDir: variant.pluginDir, allowedTools: caseDef.allowedTools,
    settings: buildSettings({ disable: opts.disable, deny: caseDef.denyTools }), model: opts.model,
  });
  if (caseDef.scaffold) {
    const s = spawnSync(bash, [caseDef.scaffold], { windowsHide: true, cwd: workdir, encoding: "utf8", stdio: "pipe" });
    if (s.status !== 0) {
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch { /* best effort */ }
      throw new Error(`scaffold failed for ${caseDef.id}: ${s.stderr || s.error}`);
    }
  }
  const pathPrepend = (caseDef.pathPrepend || []).map((d) => path.resolve(workdir, d));
  const started = Date.now();
  const proc = spawnSync(bin, args, {
    windowsHide: true, cwd: workdir, env: childEnv(caseDef.env, process.env, pathPrepend, opts.apiKey), encoding: "utf8", shell: false,
    stdio: ["ignore", "pipe", "pipe"], timeout: opts.timeoutMin * 60000, maxBuffer: 512 * 1024 * 1024,
  });
  const wallMs = Date.now() - started;
  const raw = proc.stdout || "";
  const parsed = parseStream(raw);
  const grades = gradeOrUndecided(graders, proc.status, { parsed, raw, workdir });
  const base = `${caseDef.id.replace(/\//g, "__")}__${variant.name}__r${run}`;
  fs.writeFileSync(path.join(runDir, `${base}.stream.jsonl`), raw);
  const result = {
    case: caseDef.id, variant: variant.name, pluginDir: variant.pluginDir, ref: variant.ref || null, sha: variant.sha || null,
    run, exitCode: proc.status, signal: proc.signal || null,
    timedOut: Boolean(proc.error && proc.error.code === "ETIMEDOUT"), spawnError: proc.error ? String(proc.error.message) : null,
    durationMs: wallMs, apiDurationMs: parsed.durationMs, numTurns: parsed.numTurns, maxTurnsNotEnforced: caseDef.maxTurns,
    isError: parsed.isError, resultSubtype: parsed.resultSubtype, model: parsed.model, plugins: parsed.plugins,
    finalText: parsed.finalText,
    toolCalls: parsed.toolCalls.map(({ name, key, subagent }) => ({ name, key, subagent })),
    skills: parsed.skills, agents: parsed.agents, usage: parsed.usage, costUsd: parsed.costUsd,
    grades, stderrTail: (proc.stderr || "").slice(-2000), workdir: opts.keepWorkdir ? workdir : null,
  };
  fs.writeFileSync(path.join(runDir, `${base}.json`), JSON.stringify(result, null, 2));
  if (!opts.keepWorkdir) {
    // A plugin process spawned by the run can still hold the dir on Windows.
    try { fs.rmSync(workdir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); }
    catch (err) { console.error(`[ab-run]   could not remove ${workdir}: ${err.code || err.message}`); }
  }
  return result;
}

// Windows STATUS_CONTROL_C_EXIT (0xC000013A), unsigned and signed.
const CTRL_C_EXIT_CODES = new Set([130, 0xC000013A, 0xC000013A - 0x100000000]);

/**
 * True when a run's child was ended by Ctrl-C / SIGINT (or a SIGTERM aimed at
 * the group). A --timeout-min kill is also SIGTERM (spawnSync's default
 * killSignal) but is a normal, recorded outcome, not an abort.
 */
function wasInterrupted(r) {
  if (!r || r.timedOut) return false;
  if (r.signal === "SIGINT" || r.signal === "SIGTERM") return true;
  return r.exitCode !== null && r.exitCode !== undefined && CTRL_C_EXIT_CODES.has(r.exitCode);
}

function readResults(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "summary.json")
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.summarize) {
    const summary = summarize(readResults(opts.summarize));
    fs.writeFileSync(path.join(opts.summarize, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(formatSummary(summary));
    return 0;
  }
  const caseDirs = [...new Set(opts.cases.flatMap((c) => resolveCases(c)))];
  if (!caseDirs.length) throw new Error(`no case matches ${opts.cases.join(", ")}`);
  const cases = caseDirs.map(loadCase);
  const bin = resolveClaudeBin();
  const bash = resolveBash();
  const credit = resolveApiCredit(opts.apiCredit);
  if (credit.error) throw new Error(credit.error);
  opts.apiKey = credit.key;
  console.log(`# billing: ${credit.note}`);

  const variants = [];
  const cleanups = [];
  if (opts.aRef) {
    if (opts.dryRun) {
      variants.push({ name: "A", ref: opts.aRef, pluginDir: "<tmp>/ab-variant-XXXX/plugins/devops" });
      console.log(`# variant A: git worktree add --detach <tmp>/ab-variant-XXXX ${opts.aRef}`);
    } else {
      const m = materializeRef(opts.aRef);
      cleanups.push(m.cleanup);
      variants.push({ name: "A", ref: opts.aRef, sha: m.sha, pluginDir: m.pluginDir });
    }
  } else if (opts.a) {
    variants.push({ name: "A", pluginDir: opts.a });
  }
  variants.push({ name: "B", pluginDir: opts.b });

  if (opts.dryRun) {
    for (const c of cases) {
      for (const v of variants) {
        const args = buildClaudeArgs({ prompt: c.prompt, pluginDir: v.pluginDir, allowedTools: c.allowedTools, settings: buildSettings({ disable: opts.disable, deny: c.denyTools }), model: opts.model });
        console.log(`# ${c.id} [${v.name}] x${opts.runs} (cwd <tmp>/ab-case-XXXX, env ${JSON.stringify(c.env)}${c.pathPrepend.length ? `, PATH += <cwd>/${c.pathPrepend.join(", <cwd>/")}` : ""})`);
        if (c.scaffold) console.log(formatCommand(bash, [c.scaffold]));
        console.log(formatCommand(bin, args));
      }
    }
    return 0;
  }

  const runDir = path.join(opts.out, `ab-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const results = [];
  // The run loop is synchronous (spawnSync), so a SIGINT listener only fires
  // once the loop is over. Ctrl-C reaches the child (same console/process
  // group) and ends it; wasInterrupted(r) turns that into an abort so the
  // remaining runs are not launched and `finally` removes the worktree. The
  // listener still covers a signal that lands outside a child run.
  const onSigint = () => { for (const fn of cleanups) { try { fn(); } catch { /* best effort */ } } process.exit(130); };
  process.once("SIGINT", onSigint);
  let interrupted = false;
  try {
    fs.mkdirSync(runDir, { recursive: true });
    outer: for (const c of cases) {
      const graders = loadGraders(c);
      for (let run = 1; run <= opts.runs; run++) {
        for (const v of variants) {
          console.error(`[ab-run] ${c.id} [${v.name}] run ${run}/${opts.runs}`);
          const r = runOne({ caseDef: c, variant: v, run, opts, bin, bash, graders, runDir });
          console.error(`[ab-run]   exit=${r.exitCode}${r.timedOut ? " TIMEOUT" : ""} ${Math.round(r.durationMs / 1000)}s grades=${JSON.stringify(r.grades)}`);
          results.push(r);
          if (wasInterrupted(r)) { interrupted = true; break outer; }
        }
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    for (const fn of cleanups) { try { fn(); } catch (err) { console.error(`[ab-run] cleanup failed: ${err.message}`); } }
  }
  const summary = summarize(results);
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(formatSummary(summary));
  console.log(`\nresults: ${runDir}`);
  if (interrupted) {
    console.error("[ab-run] interrupted (Ctrl-C) - remaining runs skipped, partial results above");
    return 130;
  }
  return results.some((r) => r.exitCode !== 0) ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`[ab-run] ${err.message}`);
    process.exitCode = 2;
  }
}

module.exports = { parseArgs, childEnv, resolveApiCredit, gradeOrUndecided, wasInterrupted, main };
