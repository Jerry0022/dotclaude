/**
 * @tool ship_build
 * @description Build project, run lint/tests, compute build-ID. Auto-detects
 * available scripts from package.json (build, lint, test) — only runs what
 * exists. Explicit params override auto-detection. Use buildIdOnly=true to
 * skip all commands and only hash.
 */

import { z } from "zod";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions } from "../lib/channels.js";
import { findGreen, recordResult, treeKey, usualDurationMs } from "../lib/test-results.js";
import { quotaKey, readRecord } from "../lib/ci-quota.js";
import {
  ciSuiteWorkflowPresent, changedVsBase, decideTestScope, hasGithubOrigin,
  buildLoad, buildPreRunWarning, classifyFailure, isEnvCleanupFailure, parseFailingTests, parseLockWait, readLockHolder, sampleCpu,
} from "../lib/test-step.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve plugin root at call time — survives cache rebuilds while MCP server is running.
 *
 * The problem: __dirname is set at import time and points to the cache version that existed
 * when the MCP server started. If the plugin updates mid-session, the old cache is deleted
 * and __dirname points to a non-existent path. process.cwd() has the same issue.
 *
 * Solution: walk up from __dirname to the cache parent dir, then find the current version.
 * Cache layout: .claude/plugins/cache/dotclaude/devops/{version}/
 */
function pluginRoot() {
  // 1. Env var (authoritative if set)
  if (process.env.CLAUDE_PLUGIN_ROOT && existsSync(process.env.CLAUDE_PLUGIN_ROOT)) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }
  // 2. Static path still valid (no update happened)
  const staticRoot = resolve(__dirname, "..", "..", "..");
  if (existsSync(join(staticRoot, "scripts", "build-id.js"))) {
    return staticRoot;
  }
  // 3. Cache was rebuilt — find current version in parent directory
  //    staticRoot was e.g. .../cache/dotclaude/devops/0.36.4/
  //    parent is          .../cache/dotclaude/devops/
  const cacheParent = dirname(staticRoot);
  try {
    const versions = readdirSync(cacheParent).filter(
      v => existsSync(join(cacheParent, v, "scripts", "build-id.js"))
    );
    const latest = latestCacheVersion(versions);
    if (latest) return join(cacheParent, latest);
  } catch { /* cacheParent doesn't exist or isn't readable */ }
  // 4. Give up — return stale path, caller will get existsSync guard
  return staticRoot;
}
/**
 * Newest cache folder name by numeric semver (lexicographic order put 0.183.9
 * above 0.183.12 — AUD-C047). Non-semver names only win when no semver one exists.
 */
export function latestCacheVersion(names) {
  const semver = names.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  if (semver.length > 0) return [...semver].sort(compareVersions).pop();
  return names.length > 0 ? [...names].sort().pop() : null;
}
function scriptPath(name) { return join(pluginRoot(), "scripts", name); }

// Lazy accessors — resolved at call time, not import time
const BUILD_ID_SCRIPT = () => scriptPath("build-id.js");
const DK_INDEX_SCRIPT = () => scriptPath("gen-dk-index.mjs");
const PROJECT_MAP_SCRIPT = () => scriptPath("gen-project-map.mjs");
const README_SECTIONS_SCRIPT = () => scriptPath("gen-readme-sections.mjs");

/** x.y.z from a plugin dir's .claude-plugin/plugin.json, or null when unreadable. */
function pluginVersion(dir) {
  try {
    const { version } = JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8"));
    const m = /^(\d+\.\d+\.\d+)/.exec(typeof version === "string" ? version : "");
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Pick the gen-readme-sections.mjs that rewrites the roster markers. The markers
 * live only in the plugin source repo, and that repo can be AHEAD of the plugin
 * version this MCP server was spawned from — servers keep the version the
 * session started with. A bundled generator that predates a new hook event drops
 * it from the roster (2026-09-25: a 0.201.4 server on a 0.203.0 repo wrote 57
 * instead of 58 hooks and removed the SubagentStart section).
 *   1. The repo ships its own generator → run that one (as ship_preflight does).
 *   2. The repo has plugins/devops but no generator → run the bundled copy only
 *      when it is provably not older than the repo's plugin; otherwise skip.
 *   3. Consumer repo (no plugins/devops) → bundled copy, which no-ops there.
 * Returns { script } or { skip: <reason> }.
 */
function readmeSectionsScript(cwd) {
  const repoPluginDir = join(cwd, "plugins", "devops");
  const repoScript = join(repoPluginDir, "scripts", "gen-readme-sections.mjs");
  if (existsSync(repoScript)) return { script: repoScript };
  const bundled = README_SECTIONS_SCRIPT();
  if (!existsSync(repoPluginDir)) return { script: bundled };
  const repoVersion = pluginVersion(repoPluginDir);
  const bundledVersion = pluginVersion(pluginRoot());
  if (repoVersion && bundledVersion && compareVersions(bundledVersion, repoVersion) >= 0) {
    return { script: bundled };
  }
  return {
    skip: `skipped — bundled generator (v${bundledVersion ?? "?"}) may be older than the repo's plugin ` +
      `(v${repoVersion ?? "?"}); roster markers left untouched`,
  };
}

/** Per-step limit; the former 120 s stopped full suites under load. */
export const DEFAULT_STEP_TIMEOUT_SEC = 300;

export const schema = z.object({
  buildCmd: z.string().nullable().default(null).describe("Build command (null = auto-detect from package.json)"),
  lintCmd: z.string().nullable().default(null).describe("Lint command (null = auto-detect from package.json)"),
  testCmd: z.string().nullable().default(null).describe("Test command (null = auto-detect from package.json)"),
  stepTimeoutSec: z.number().int().min(30).max(1800).default(DEFAULT_STEP_TIMEOUT_SEC).describe("Per-step limit (build, lint, test) in seconds. Default 300. A step stopped by it fails with failure: 'timeout' and the result names the limit (timeoutHit) — a harness stop, not a red test."),
  buildIdOnly: z.boolean().default(false).describe("Skip build, only compute build-ID"),
  reuseGreen: z.boolean().default(true).describe("Skip the test step when a green run of the same testCmd on the identical tree (git tree hash) is recorded and younger than 24 h — the result then carries testsReused. false = always run."),
  ciSuite: z.boolean().nullable().default(null).describe("Does a CI check run the FULL suite on the PR (job `suite`)? null = detect (.github/workflows declares job `suite` + github.com origin). true = assume it, false = never. With a CI suite and no known-exhausted Actions quota, the test step runs only the tests related to the diff (result: testScope \"related\", fullSuiteVia \"ci\"); otherwise the full suite runs locally and is recorded (testScope \"full\", fullSuiteVia \"local\"). An explicit testCmd always runs as given."),
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
});

/**
 * Read package.json scripts and return commands for available scripts.
 * Only returns a command if the script actually exists in package.json.
 */
function detectScripts(cwd) {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return { build: null, lint: null, test: null };
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const s = pkg.scripts || {};
    return {
      build: s.build ? "npm run build" : null,
      lint: s.lint ? "npm run lint" : null,
      test: s.test ? "npm run test" : null,
    };
  } catch {
    return { build: null, lint: null, test: null };
  }
}

/** `timeoutHit` for a step the limit stopped — so the caller raises stepTimeoutSec instead of debugging a green suite. */
function timeoutNote(step, res) {
  if (res.failure !== "timeout") return {};
  return {
    timeoutHit: {
      step,
      limitSec: res.limitSec,
      note: `${step} was stopped at the ${res.limitSec} s step limit (not a failing ${step}). Re-run ship_build with a higher stepTimeoutSec, or run the step separately and pass a narrower testCmd.`,
    },
  };
}

function run(cmd, cwd, limitSec = DEFAULT_STEP_TIMEOUT_SEC) {
  try {
    const output = execSync(cmd, { windowsHide: true,
      cwd,
      encoding: "utf8",
      timeout: limitSec * 1000,
      // Node's default maxBuffer (~1 MiB) kills a chatty-but-green test run
      // with ENOBUFS, which then read as a failed test step.
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output: output.slice(-2000) }; // tail 2k chars
  } catch (e) {
    const tail = (e.stderr || e.stdout || e.message || "").toString().slice(-2000);
    // Name the harness-side failure kinds so they are not mistaken for a red test.
    let failure;
    if (e.code === "ENOBUFS") failure = "output-overflow";
    else if (e.code === "ETIMEDOUT" || (e.killed && e.signal)) failure = "timeout";
    const out = { success: false, output: tail };
    if (failure) {
      out.failure = failure;
      if (failure === "timeout") out.limitSec = limitSec;
      out.output = `[${failure}: the command was stopped by the ship harness, not by a failing test — ${failure === "timeout" ? `${limitSec} s limit` : "output exceeded 64 MiB"}]\n` + tail;
    }
    return out;
  }
}

/** Tail kept of a red test step's output; failing test names are returned separately and in full. */
const RED_TAIL = 4000;

/**
 * The test step via spawnSync so stdout AND stderr are both kept on success
 * too — the suite-lock wait lines go to stderr, the vitest failure summary to
 * stdout. `full` is for parsing only and never returned.
 */
function runTest(cmd, cwd, limitSec) {
  const r = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: limitSec * 1000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = (r.stdout || "").toString();
  const stderr = (r.stderr || "").toString();
  const full = stderr ? `${stdout}\n${stderr}` : stdout;
  if (!r.error && r.status === 0) return { success: true, output: stdout.slice(-2000), full };
  let failure;
  if (r.error?.code === "ENOBUFS") failure = "output-overflow";
  else if (r.error?.code === "ETIMEDOUT" || (r.signal && r.status === null)) failure = "timeout";
  const tail = (full || r.error?.message || "").slice(-RED_TAIL);
  const out = { success: false, output: tail, full };
  if (failure) {
    out.failure = failure;
    if (failure === "timeout") out.limitSec = limitSec;
    out.output = `[${failure}: the command was stopped by the ship harness, not by a failing test — ${failure === "timeout" ? `${limitSec} s limit` : "output exceeded 64 MiB"}]\n` + tail;
  }
  return out;
}

/**
 * Test step with green-result reuse, one retry on an EPERM/EBUSY temp-cleanup
 * failure, failure classification and the load signal (#762). Returns
 * { step, extra } — extra holds testsReused / load / failureKind / failingTests.
 */
async function testStep(testCmd, cwd, limitSec, reuseGreen, planScope = null) {
  const fullScope = (reason) => ({ testScope: "full", fullSuiteVia: "local", testScopeReason: reason });
  const key = treeKey(cwd);
  if (reuseGreen !== false && key) {
    const hit = findGreen(cwd, { treeHash: key.treeHash, testCmd });
    if (hit) {
      return {
        step: {
          step: "test", cmd: testCmd, success: true, reused: true,
          output: `reused green run (${hit.source}, ${hit.at}) on tree ${key.treeHash.slice(0, 12)} — not re-run`,
        },
        extra: { ...fullScope("reused a recorded green full run on this exact tree"), testsReused: { treeHash: key.treeHash, at: hit.at, source: hit.source, testCmd: hit.testCmd } },
      };
    }
  }

  const plan = planScope ? planScope() : null;
  const scopeExtra = plan
    ? { testScope: plan.scope, fullSuiteVia: plan.fullSuiteVia, testScopeReason: plan.reason, ...(plan.files ? { relatedFiles: plan.files } : {}) }
    : fullScope("full suite run locally");
  if (plan?.scope === "related") {
    // Lint ran before; the full suite is the CI `suite` check. Never recorded
    // as a full run, never reuses one.
    if (plan.empty) {
      return { step: { step: "test", cmd: testCmd, success: true, skipped: true, output: plan.reason }, extra: scopeExtra };
    }
    const relStarted = Date.now();
    const res = runTest(plan.cmd, cwd, limitSec);
    const { full, ...stepRes } = res;
    const step = { step: "test", cmd: plan.cmd, ...stepRes, durationMs: Date.now() - relStarted };
    const extra = { ...scopeExtra };
    if (!res.success && !res.failure) {
      extra.failingTests = parseFailingTests(full);
      extra.failureKind = classifyFailure(full, extra.failingTests);
    }
    return { step, extra };
  }

  const holderAtStart = readLockHolder();
  const cpu = await sampleCpu();
  const preRun = buildPreRunWarning({ holder: holderAtStart, cpu, usualMs: usualDurationMs(cwd, testCmd) });
  if (preRun) console.error(`[ship_build] ${preRun.note}`);
  const started = Date.now();
  let res = runTest(testCmd, cwd, limitSec);
  let retried = null;
  if (!res.success && !res.failure && isEnvCleanupFailure(res.full)) {
    retried = { reason: "EPERM/EBUSY temp-cleanup pattern", firstOutput: res.output.slice(-1500) };
    res = runTest(testCmd, cwd, limitSec);
    retried.secondPassed = res.success;
  }
  const durationMs = Date.now() - started;
  const usualMs = usualDurationMs(cwd, testCmd);
  // A retried step ran twice — its duration says nothing about "slower than usual".
  const load = buildLoad({ lockWait: parseLockWait(res.full), holderAtStart, cpu, durationMs: retried ? null : durationMs, usualMs });

  const { full, ...stepRes } = res;
  const step = { step: "test", cmd: testCmd, ...stepRes, durationMs };
  if (retried) step.retried = retried;
  const extra = { ...scopeExtra };
  if (preRun) extra.preRunWarning = preRun;
  if (load) extra.load = load;

  if (res.success) {
    // Record only when the tree did not move during the run.
    const after = key ? treeKey(cwd) : null;
    if (after && after.treeHash === key.treeHash) {
      recordResult(cwd, { treeHash: key.treeHash, testCmd, passed: true, durationMs: retried ? null : durationMs, source: "ship_build" });
    }
  } else if (!res.failure) {
    extra.failingTests = parseFailingTests(full);
    extra.failureKind = classifyFailure(full, extra.failingTests);
  }
  return { step, extra };
}

/** A CI-quota record (GitHub Actions minutes out, #752) is active for this repo's account. */
function ciQuotaExhausted(cwd) {
  try { return !!readRecord(quotaKey(cwd)); } catch { return false; }
}

function getBuildId(cwd) {
  try {
    return execSync(
      `"${process.execPath}" "${BUILD_ID_SCRIPT()}"`,
      { windowsHide: true, cwd, encoding: "utf8", timeout: 10_000 }
    ).trim();
  } catch (err) {
    console.error(`[ship_build] build-id computation failed: ${err.message}`);
    return "no-build-id";
  }
}

export async function handler(params) {
  const cwd = params.cwd;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");
  const { buildIdOnly } = params;
  const limitSec = params.stepTimeoutSec ?? DEFAULT_STEP_TIMEOUT_SEC;

  if (buildIdOnly) {
    return { success: true, buildId: getBuildId(cwd), skipped: true };
  }

  // Auto-detect available scripts, then let explicit params override
  const detected = detectScripts(cwd);
  const buildCmd = params.buildCmd ?? detected.build;
  const lintCmd = params.lintCmd ?? detected.lint;
  const testCmd = params.testCmd ?? detected.test;

  const steps = [];
  let testExtra = {};

  // Generator failures are non-fatal to the build, but MUST NOT be swallowed
  // silently — a stale index that never regenerates is exactly the F5 bug.
  // Capture each run() and surface a warning when a generator fails.
  const genWarnings = [];
  const runGenerator = (label, cmd) => {
    const r = run(cmd, cwd);
    if (!r.success) {
      genWarnings.push({ generator: label, error: (r.output || "").slice(-300) });
    }
    return r;
  };

  // Regenerate deep-knowledge INDEX.md (idempotent, skips if unchanged)
  // 1. Plugin's own deep-knowledge
  runGenerator("dk-index:plugin", `"${process.execPath}" "${DK_INDEX_SCRIPT()}"`);
  // 2. Project's deep-knowledge (if it exists)
  const projectDk = join(cwd, "deep-knowledge");
  if (existsSync(projectDk)) {
    // DK_INDEX_SCRIPT is a lazy accessor — it MUST be CALLED. Interpolating the
    // bare function stringified its source into the command, so the project
    // deep-knowledge index never regenerated (F5). Match line above: DK_INDEX_SCRIPT().
    runGenerator("dk-index:project", `"${process.execPath}" "${DK_INDEX_SCRIPT()}" "${projectDk}"`);
  }
  // 3. Project map (full codebase index)
  runGenerator("project-map", `"${process.execPath}" "${PROJECT_MAP_SCRIPT()}" "${cwd}"`);
  // 4. README + architecture.html auto-marker sections (no-ops outside the
  //    plugin source repo, i.e. when cwd/plugins/devops is absent). Prefers the
  //    repo's own generator — see readmeSectionsScript().
  const readme = readmeSectionsScript(cwd);
  if (readme.script) {
    runGenerator("readme-sections", `"${process.execPath}" "${readme.script}" "${cwd}"`);
  } else {
    genWarnings.push({ generator: "readme-sections", error: readme.skip });
  }

  // Build (skip if no build script detected/provided)
  if (buildCmd) {
    const buildResult = run(buildCmd, cwd, limitSec);
    steps.push({ step: "build", cmd: buildCmd, ...buildResult });
    if (!buildResult.success) {
      return { success: false, buildId: null, steps, failedAt: "build", ...timeoutNote("build", buildResult), warnings: genWarnings };
    }
  }

  // Lint
  if (lintCmd) {
    const lintResult = run(lintCmd, cwd, limitSec);
    steps.push({ step: "lint", cmd: lintCmd, ...lintResult });
    if (!lintResult.success) {
      return { success: false, buildId: null, steps, failedAt: "lint", ...timeoutNote("lint", lintResult), warnings: genWarnings };
    }
  }

  // Tests
  if (testCmd) {
    // Related-only locally needs the auto-detected command: an explicit testCmd runs as given.
    const planScope = params.testCmd != null ? null : () => decideTestScope({
      ciSuite: params.ciSuite ?? null,
      workflowPresent: ciSuiteWorkflowPresent(cwd),
      githubOrigin: hasGithubOrigin(cwd),
      quotaExhausted: ciQuotaExhausted(cwd),
      changed: changedVsBase(cwd),
      cwd,
    });
    const { step: testResult, extra } = await testStep(testCmd, cwd, limitSec, params.reuseGreen, planScope);
    testExtra = extra;
    steps.push(testResult);
    if (!testResult.success) {
      return { success: false, buildId: null, steps, failedAt: "test", ...timeoutNote("test", testResult), ...testExtra, warnings: genWarnings };
    }
  }

  // Build-ID
  const buildId = getBuildId(cwd);

  return {
    success: true,
    buildId,
    steps,
    detected: { build: !!buildCmd, lint: !!lintCmd, test: !!testCmd },
    ...testExtra,
    warnings: genWarnings,
  };
}
