/**
 * @tool ship_build
 * @description Build project, run lint/tests, compute build-ID. Auto-detects
 * available scripts from package.json (build, lint, test) — only runs what
 * exists. Explicit params override auto-detection. Use buildIdOnly=true to
 * skip all commands and only hash.
 */

import { z } from "zod";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
    if (versions.length > 0) {
      // Pick the latest version (lexicographic sort works for semver with same digit count)
      versions.sort();
      return join(cacheParent, versions[versions.length - 1]);
    }
  } catch { /* cacheParent doesn't exist or isn't readable */ }
  // 4. Give up — return stale path, caller will get existsSync guard
  return staticRoot;
}
function scriptPath(name) { return join(pluginRoot(), "scripts", name); }

// Lazy accessors — resolved at call time, not import time
const BUILD_ID_SCRIPT = () => scriptPath("build-id.js");
const DK_INDEX_SCRIPT = () => scriptPath("gen-dk-index.js");
const PROJECT_MAP_SCRIPT = () => scriptPath("gen-project-map.js");

export const schema = z.object({
  buildCmd: z.string().nullable().default(null).describe("Build command (null = auto-detect from package.json)"),
  lintCmd: z.string().nullable().default(null).describe("Lint command (null = auto-detect from package.json)"),
  testCmd: z.string().nullable().default(null).describe("Test command (null = auto-detect from package.json)"),
  buildIdOnly: z.boolean().default(false).describe("Skip build, only compute build-ID"),
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

function run(cmd, cwd) {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output: output.slice(-2000) }; // tail 2k chars
  } catch (e) {
    return { success: false, output: (e.stderr || e.stdout || e.message || "").slice(-2000) };
  }
}

function getBuildId(cwd) {
  try {
    return execSync(
      `"${process.execPath}" "${BUILD_ID_SCRIPT()}"`,
      { cwd, encoding: "utf8", timeout: 10_000 }
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

  if (buildIdOnly) {
    return { success: true, buildId: getBuildId(cwd), skipped: true };
  }

  // Auto-detect available scripts, then let explicit params override
  const detected = detectScripts(cwd);
  const buildCmd = params.buildCmd ?? detected.build;
  const lintCmd = params.lintCmd ?? detected.lint;
  const testCmd = params.testCmd ?? detected.test;

  const steps = [];

  // Regenerate deep-knowledge INDEX.md (idempotent, skips if unchanged)
  // 1. Plugin's own deep-knowledge
  run(`"${process.execPath}" "${DK_INDEX_SCRIPT()}"`, cwd);
  // 2. Project's deep-knowledge (if it exists)
  const projectDk = join(cwd, "deep-knowledge");
  if (existsSync(projectDk)) {
    run(`"${process.execPath}" "${DK_INDEX_SCRIPT}" "${projectDk}"`, cwd);
  }
  // 3. Project map (full codebase index)
  run(`"${process.execPath}" "${PROJECT_MAP_SCRIPT()}" "${cwd}"`, cwd);

  // Build (skip if no build script detected/provided)
  if (buildCmd) {
    const buildResult = run(buildCmd, cwd);
    steps.push({ step: "build", cmd: buildCmd, ...buildResult });
    if (!buildResult.success) {
      return { success: false, buildId: null, steps, failedAt: "build" };
    }
  }

  // Lint
  if (lintCmd) {
    const lintResult = run(lintCmd, cwd);
    steps.push({ step: "lint", cmd: lintCmd, ...lintResult });
    if (!lintResult.success) {
      return { success: false, buildId: null, steps, failedAt: "lint" };
    }
  }

  // Tests
  if (testCmd) {
    const testResult = run(testCmd, cwd);
    steps.push({ step: "test", cmd: testCmd, ...testResult });
    if (!testResult.success) {
      return { success: false, buildId: null, steps, failedAt: "test" };
    }
  }

  // Build-ID
  const buildId = getBuildId(cwd);

  return { success: true, buildId, steps, detected: { build: !!buildCmd, lint: !!lintCmd, test: !!testCmd } };
}
