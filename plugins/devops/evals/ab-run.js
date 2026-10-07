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
      case "--summarize": opts.summarize = path.resolve(next()); break;
      default: throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!opts.disable.length) opts.disable = [INSTALLED_PLUGIN_KEY];
  if (!opts.b) opts.b = path.join(EVALS_DIR, "..");
  if (opts.a && opts.aRef) throw new Error("use either --a or --a-ref, not both");
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Error("--runs must be a positive integer");
  if (!opts.summarize && !opts.cases.length) throw new Error("--case is required");
  return opts;
}

function childEnv(caseEnv) {
  const env = { ...process.env, ...caseEnv };
  delete env.CLAUDECODE; // nested-session marker of the calling session
  return env;
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
    settings: buildSettings({ disable: opts.disable }), model: opts.model,
  });
  if (caseDef.scaffold) {
    const s = spawnSync(bash, [caseDef.scaffold], { cwd: workdir, encoding: "utf8", stdio: "pipe" });
    if (s.status !== 0) throw new Error(`scaffold failed for ${caseDef.id}: ${s.stderr || s.error}`);
  }
  const started = Date.now();
  const proc = spawnSync(bin, args, {
    cwd: workdir, env: childEnv(caseDef.env), encoding: "utf8", shell: false,
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
        const args = buildClaudeArgs({ prompt: c.prompt, pluginDir: v.pluginDir, allowedTools: c.allowedTools, settings: buildSettings({ disable: opts.disable }), model: opts.model });
        console.log(`# ${c.id} [${v.name}] x${opts.runs} (cwd <tmp>/ab-case-XXXX, env ${JSON.stringify(c.env)})`);
        if (c.scaffold) console.log(formatCommand(bash, [c.scaffold]));
        console.log(formatCommand(bin, args));
      }
    }
    return 0;
  }

  const runDir = path.join(opts.out, `ab-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(runDir, { recursive: true });
  const results = [];
  try {
    for (const c of cases) {
      const graders = loadGraders(c);
      for (let run = 1; run <= opts.runs; run++) {
        for (const v of variants) {
          console.error(`[ab-run] ${c.id} [${v.name}] run ${run}/${opts.runs}`);
          const r = runOne({ caseDef: c, variant: v, run, opts, bin, bash, graders, runDir });
          console.error(`[ab-run]   exit=${r.exitCode}${r.timedOut ? " TIMEOUT" : ""} ${Math.round(r.durationMs / 1000)}s grades=${JSON.stringify(r.grades)}`);
          results.push(r);
        }
      }
    }
  } finally {
    for (const fn of cleanups) fn();
  }
  const summary = summarize(results);
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(formatSummary(summary));
  console.log(`\nresults: ${runDir}`);
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

module.exports = { parseArgs, childEnv, gradeOrUndecided, main };
