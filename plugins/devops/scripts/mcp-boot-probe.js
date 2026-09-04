#!/usr/bin/env node
/**
 * @script mcp-boot-probe
 * @version 0.1.0
 * @plugin devops
 * @description Measure how long each devops MCP server needs to answer a
 *   JSON-RPC `initialize` on stdio — the exact handshake Claude Code performs,
 *   with the same 30 s budget, at session start.
 *
 *   Why it exists (#324): all three servers boot in well under 2.5 s in
 *   isolation, yet hit CONNECT_TIMEOUT in real sessions because SessionStart
 *   hooks saturate the machine in the same window. A regression that moves work
 *   back in front of `server.connect()` is invisible to unit tests and only
 *   shows up as a flaky "MCP server disconnected". This probe makes boot cost a
 *   measurable, assertable number.
 *
 *   CLI:
 *     node scripts/mcp-boot-probe.js [--budget-ms 5000] [--deps <node_modules>]
 *
 *   Prints one JSON line per server — {"server":…,"ok":true,"ms":842} — and
 *   exits 1 if any server fails or exceeds the budget.
 *
 *   Dependency resolution: the servers import @modelcontextprotocol/sdk from a
 *   `node_modules` that ss.mcp.deps.js junctions into each server dir at session
 *   start. In a bare source checkout that junction does not exist yet, so the
 *   CLI recreates it (same mechanism, same target) from CLAUDE_PLUGIN_DATA or a
 *   discovered ~/.claude/plugins/data/<id>/node_modules. Programmatic callers
 *   (the test) pass { link: false } and skip instead — a test must not mutate
 *   the checkout.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_ROOT_DEFAULT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const DEFAULT_BUDGET_MS = 5000;
// Hard stop per server. Deliberately larger than the budget so an over-budget
// server still reports a real number instead of a timeout.
const HARD_TIMEOUT_MS = 30_000;

const SERVERS = [
  { name: 'dotclaude-completion', entry: path.join('mcp-server', 'index.js') },
  { name: 'dotclaude-ship', entry: path.join('mcp-server', 'ship', 'index.js') },
  { name: 'dotclaude-issues', entry: path.join('mcp-server', 'issues', 'index.js') },
];

const REQUIRED_PKGS = ['@modelcontextprotocol/sdk', 'zod'];

/** Does `dir` look like a node_modules holding every runtime dep? */
function isCompleteModules(dir) {
  if (!dir) return false;
  return REQUIRED_PKGS.every((pkg) => fs.existsSync(path.join(dir, ...pkg.split('/'))));
}

/**
 * The node_modules a given server entry would resolve against, walking the
 * standard node_modules chain upward — the same lookup the ESM resolver does.
 * @returns {string|null}
 */
function resolvedModulesFor(entryFile) {
  let dir = path.dirname(entryFile);
  for (;;) {
    const candidate = path.join(dir, 'node_modules');
    if (isCompleteModules(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Find a complete shared node_modules to link against: the plugin-data dir the
 * runtime uses, else any ~/.claude/plugins/data/<id>/node_modules.
 * @returns {string|null}
 */
function discoverSharedModules() {
  const explicit = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'node_modules')
    : null;
  if (isCompleteModules(explicit)) return explicit;

  const dataRoot = path.join(os.homedir(), '.claude', 'plugins', 'data');
  let entries = [];
  try {
    entries = fs.readdirSync(dataRoot);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = path.join(dataRoot, entry, 'node_modules');
    if (isCompleteModules(candidate)) return candidate;
  }
  return null;
}

/**
 * Make sure `entryFile` can resolve its deps, junctioning a shared
 * node_modules into its directory when it cannot. Never throws.
 * @returns {{ok: boolean, modules: string|null, linked: boolean, reason?: string}}
 */
function ensureDeps(entryFile, { link = false, sharedModules = null } = {}) {
  const existing = resolvedModulesFor(entryFile);
  if (existing) return { ok: true, modules: existing, linked: false };
  if (!link) return { ok: false, modules: null, linked: false, reason: 'deps-unresolved' };

  const shared = sharedModules || discoverSharedModules();
  if (!shared) return { ok: false, modules: null, linked: false, reason: 'no-shared-node_modules' };

  const target = path.join(path.dirname(entryFile), 'node_modules');
  try {
    fs.symlinkSync(shared, target, 'junction');
    return { ok: true, modules: shared, linked: true };
  } catch (e) {
    // EPERM (no symlink privilege) / EEXIST race — a copy is not worth it here;
    // report honestly so the caller can say why the probe could not run.
    return { ok: false, modules: null, linked: false, reason: `link-failed: ${e.code || e.message}` };
  }
}

/** The JSON-RPC frame Claude Code opens every stdio MCP connection with. */
function initializeRequest(id = 1) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-boot-probe', version: '0.1.0' },
    },
  }) + '\n';
}

/**
 * Spawn one server, send `initialize`, measure time to its response line.
 *
 * @param {{name: string, entry: string}} server
 * @param {object} [opts]
 * @param {string} [opts.pluginRoot]  CLAUDE_PLUGIN_ROOT + cwd for the child
 * @param {boolean} [opts.link]       may create a node_modules junction
 * @param {number}  [opts.timeoutMs]  hard stop
 * @returns {Promise<{server: string, ok: boolean, ms: number|null, error?: string}>}
 */
function probeServer(server, opts = {}) {
  const pluginRoot = opts.pluginRoot || PLUGIN_ROOT_DEFAULT;
  const timeoutMs = opts.timeoutMs || HARD_TIMEOUT_MS;
  const entryFile = path.join(pluginRoot, server.entry);

  return new Promise((resolve) => {
    if (!fs.existsSync(entryFile)) {
      resolve({ server: server.name, ok: false, ms: null, error: `missing entry: ${entryFile}` });
      return;
    }
    const deps = ensureDeps(entryFile, { link: opts.link, sharedModules: opts.sharedModules });
    if (!deps.ok) {
      resolve({ server: server.name, ok: false, ms: null, error: deps.reason });
      return;
    }

    const started = Date.now();
    let settled = false;
    let stdout = '';
    let stderr = '';

    const child = spawn(process.execPath, [entryFile], {
      cwd: pluginRoot,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        // The completion server may shell out to the usage scraper; a boot
        // probe must never open a browser.
        DEVOPS_COMPLETION_NO_USAGE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        server: server.name,
        ok: false,
        ms: Date.now() - started,
        error: `no initialize response within ${timeoutMs}ms`,
        stderr: stderr.slice(-500),
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      let nl;
      while ((nl = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, nl).trim();
        stdout = stdout.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          finish({
            server: server.name,
            ok: false,
            ms: Date.now() - started,
            error: `non-JSON on stdout: ${line.slice(0, 120)}`,
          });
          return;
        }
        if (msg.id === 1 && msg.result) {
          finish({ server: server.name, ok: true, ms: Date.now() - started });
          return;
        }
        if (msg.id === 1 && msg.error) {
          finish({
            server: server.name,
            ok: false,
            ms: Date.now() - started,
            error: `initialize error: ${JSON.stringify(msg.error)}`,
          });
          return;
        }
      }
    });

    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    child.on('error', (e) => {
      finish({ server: server.name, ok: false, ms: Date.now() - started, error: e.message });
    });

    child.on('exit', (code) => {
      finish({
        server: server.name,
        ok: false,
        ms: Date.now() - started,
        error: `exited (code ${code}) before answering initialize`,
        stderr: stderr.slice(-500),
      });
    });

    try {
      child.stdin.write(initializeRequest(1));
    } catch (e) {
      finish({ server: server.name, ok: false, ms: Date.now() - started, error: e.message });
    }
  });
}

/**
 * Probe every server sequentially. Sequential on purpose: the number under test
 * is a single server's boot cost, not how three of them contend.
 */
async function probeAll(opts = {}) {
  const results = [];
  for (const server of SERVERS) {
    results.push(await probeServer(server, opts));
  }
  return results;
}

function parseArgs(argv) {
  const out = { budgetMs: DEFAULT_BUDGET_MS, deps: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--budget-ms' && argv[i + 1]) out.budgetMs = Number(argv[++i]);
    else if (argv[i] === '--deps' && argv[i + 1]) out.deps = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = await probeAll({
    pluginRoot: PLUGIN_ROOT_DEFAULT,
    link: true,
    sharedModules: args.deps,
  });

  let failed = 0;
  for (const r of results) {
    const overBudget = r.ok && r.ms > args.budgetMs;
    if (!r.ok || overBudget) failed++;
    // stdout-ok — this is a CLI report, not an MCP transport.
    process.stdout.write(JSON.stringify({ // stdout-ok
      server: r.server,
      ok: r.ok && !overBudget,
      ms: r.ms,
      ...(r.error ? { error: r.error } : {}),
      ...(overBudget ? { error: `over budget (${args.budgetMs}ms)` } : {}),
    }) + '\n');
    if (r.stderr && (!r.ok || overBudget)) console.error(`[mcp-boot-probe] ${r.server} stderr: ${r.stderr}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = {
  SERVERS,
  DEFAULT_BUDGET_MS,
  REQUIRED_PKGS,
  isCompleteModules,
  resolvedModulesFor,
  discoverSharedModules,
  ensureDeps,
  initializeRequest,
  probeServer,
  probeAll,
  parseArgs,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('[mcp-boot-probe] fatal:', e && e.message);
    process.exit(1);
  });
}
