'use strict';
/**
 * @module deploy-parity
 * @version 0.1.0
 * @plugin devops
 * @description Deploy-parity build for /do-ship Step 2.5: build the commit
 *   being shipped the way the deploy host will, before it is merged.
 *
 *   A green ship pipeline does not mean a green deploy. The host runs a
 *   build the pipeline never ran: its own configured build command, the npm
 *   `prebuild`/`postbuild` lifecycle scripts around it, a fresh dependency
 *   install from the lockfile, and a clean clone without the untracked or
 *   generated files a warm local checkout has. A consumer project saw about
 *   30 production deploys fail in one month on exactly these gaps while
 *   every local ship was green.
 *
 *   This module closes that gap, stack-independent:
 *     1. detectBuildPlan() — a table of detectors (DETECTORS), first match
 *        wins: deploy-host configs first (vercel.json, netlify.toml,
 *        wrangler.*, render.yaml, firebase.json, fly.toml, GitHub Pages
 *        workflows), then ecosystem fallbacks (package.json build with its
 *        lifecycle hooks, Dockerfile, Makefile, Cargo, Go, pyproject). A new
 *        stack is one more table entry. Nothing detected → skipped, never
 *        failed.
 *     2. runDeployParity() — checks the commit out into a temporary
 *        `git worktree add --detach`, installs dependencies fresh (lockfile
 *        honoured, nothing linked in from the source checkout), runs the
 *        build with a withheld-secrets environment and one time budget, and
 *        always removes the temporary worktree again.
 *     3. classifyFailure() — failed vs. inconclusive. A build that dies for
 *        lack of something the host has and this machine must not hand over
 *        (secrets, a private registry token, a missing tool, the network, the
 *        time budget) is "inconclusive", never a hard block. Heuristic in
 *        deep-knowledge/deploy-parity.md.
 *
 *   Never links node_modules (or anything else) into the temp worktree: a
 *   `git worktree remove --force` deletes through a junction into the source
 *   checkout. Cleanup deletes the temp tree with fs.rmSync (which does not
 *   follow links) and then the worktree's admin dir — no `git worktree prune`,
 *   which would also drop other stale-looking worktrees.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const DEFAULT_TIMEOUT_SEC = 600;
const OUTPUT_TAIL = 3000;
const GIT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// File helpers (all relative to the checkout being inspected)
// ---------------------------------------------------------------------------

function readText(dir, rel) {
  try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return null; }
}

function readJson(dir, rel) {
  const text = readText(dir, rel);
  if (text == null) return null;
  try {
    // tolerate JSONC (wrangler.jsonc, hand-written configs): strip comments
    const stripped = text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const data = JSON.parse(stripped);
    return data && typeof data === 'object' ? data : null;
  } catch { return null; }
}

function exists(dir, rel) {
  try { return fs.existsSync(path.join(dir, rel)); } catch { return false; }
}

/**
 * Value of `key` inside `[section]` of a flat TOML file (string values only),
 * or null. Enough for `[build] command = "..."` style configs; nested tables
 * and arrays are out of scope.
 */
function tomlValue(text, section, key) {
  if (!text) return null;
  let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) { current = head[1].trim(); continue; }
    if (current !== section) continue;
    const m = new RegExp(`^${key}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)')`).exec(line);
    if (m) return (m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2]);
  }
  return null;
}

/** First `key: value` scalar anywhere in a YAML text (quotes stripped), or null. */
function yamlScalar(text, key) {
  if (!text) return null;
  const m = new RegExp(`^\\s*-?\\s*${key}:\\s*(.+?)\\s*$`, 'm').exec(text);
  if (!m) return null;
  const v = m[1].replace(/\s+#.*$/, '');
  if (v === '|' || v === '>' || v === '|-' || v === '>-') return null;
  return v.replace(/^(['"])(.*)\1$/, '$2');
}

// ---------------------------------------------------------------------------
// Node package manager + lockfile-honouring install
// ---------------------------------------------------------------------------

/** 'npm' | 'pnpm' | 'yarn' | 'yarn-berry' | 'bun' for the checkout at `dir`. */
function packageManager(dir, pkg) {
  const declared = pkg && typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
  if (/^pnpm@/.test(declared) || exists(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (/^bun@/.test(declared) || exists(dir, 'bun.lockb') || exists(dir, 'bun.lock')) return 'bun';
  if (/^yarn@/.test(declared) || exists(dir, 'yarn.lock')) {
    const berry = /^yarn@(?:[2-9]|\d{2,})/.test(declared) || exists(dir, '.yarnrc.yml');
    return berry ? 'yarn-berry' : 'yarn';
  }
  return 'npm';
}

function nodeInstallCmd(dir, pm) {
  switch (pm) {
    case 'pnpm': return 'pnpm install --frozen-lockfile';
    case 'bun': return 'bun install --frozen-lockfile';
    case 'yarn': return 'yarn install --frozen-lockfile';
    case 'yarn-berry': return 'yarn install --immutable';
    default:
      return exists(dir, 'package-lock.json') || exists(dir, 'npm-shrinkwrap.json')
        ? 'npm ci' : 'npm install';
  }
}

function nodeRunCmd(pm, script) {
  const bin = pm === 'yarn-berry' ? 'yarn' : pm;
  return `${bin} run ${script}`;
}

/**
 * The package.json build of `dir` as a partial plan, or null when there is no
 * package.json. `scripts` is the preference order (the first present wins).
 * `lifecycle` names the pre/post hooks npm runs around it — the gap that let
 * a guard script fail only on the host.
 */
function nodePlan(dir, scripts = ['build']) {
  const pkg = readJson(dir, 'package.json');
  if (!pkg) return null;
  const s = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const pm = packageManager(dir, pkg);
  const script = scripts.find((name) => typeof s[name] === 'string' && s[name].trim());
  const lifecycle = script ? [`pre${script}`, `post${script}`].filter((n) => typeof s[n] === 'string') : [];
  return {
    install: nodeInstallCmd(dir, pm),
    build: script ? nodeRunCmd(pm, script) : null,
    packageManager: pm,
    lifecycle,
  };
}

// ---------------------------------------------------------------------------
// Detectors — first match wins. Each returns a plan or null.
//   plan = { host, source, install, build, dir?, env?, requires?, note? }
// A detector that recognises the host but finds no explicit command falls
// back to the ecosystem build the host would run by default.
// ---------------------------------------------------------------------------

function withNodeFallback(dir, base, scripts) {
  if (base.build) return base;
  const node = nodePlan(path.join(dir, base.dir || ''), scripts);
  if (node && node.build) {
    return {
      ...base,
      install: base.install || node.install,
      build: node.build,
      lifecycle: node.lifecycle,
      packageManager: node.packageManager,
    };
  }
  return { ...base, note: base.note || 'host config found, but no build command (static deploy?)' };
}

const DETECTORS = [
  {
    id: 'vercel',
    match(dir) {
      const cfg = readJson(dir, 'vercel.json');
      if (!cfg) return null;
      const plan = {
        host: 'vercel',
        source: 'vercel.json',
        install: typeof cfg.installCommand === 'string' && cfg.installCommand.trim() ? cfg.installCommand : null,
        build: typeof cfg.buildCommand === 'string' && cfg.buildCommand.trim() ? cfg.buildCommand : null,
        env: { VERCEL: '1' },
        note: cfg.framework ? `framework: ${cfg.framework}` : undefined,
      };
      // Vercel prefers a `vercel-build` script over `build`.
      return withNodeFallback(dir, plan, ['vercel-build', 'build']);
    },
  },
  {
    id: 'netlify',
    match(dir) {
      const text = readText(dir, 'netlify.toml');
      if (text == null) return null;
      const base = tomlValue(text, 'build', 'base');
      const plan = {
        host: 'netlify',
        source: 'netlify.toml',
        install: null,
        build: tomlValue(text, 'build', 'command'),
        dir: base || undefined,
        env: { NETLIFY: 'true' },
      };
      return withNodeFallback(dir, plan);
    },
  },
  {
    id: 'cloudflare',
    match(dir) {
      let source = null;
      let build = null;
      if (exists(dir, 'wrangler.toml')) {
        source = 'wrangler.toml';
        build = tomlValue(readText(dir, 'wrangler.toml'), 'build', 'command');
      } else {
        for (const f of ['wrangler.jsonc', 'wrangler.json']) {
          const cfg = readJson(dir, f);
          if (cfg) {
            source = f;
            build = cfg.build && typeof cfg.build.command === 'string' ? cfg.build.command : null;
            break;
          }
        }
      }
      if (!source) return null;
      return withNodeFallback(dir, { host: 'cloudflare', source, install: null, build, env: { CF_PAGES: '1' } });
    },
  },
  {
    id: 'render',
    match(dir) {
      const text = readText(dir, 'render.yaml');
      if (text == null) return null;
      const count = (text.match(/^\s*-?\s*buildCommand:/gm) || []).length;
      const plan = {
        host: 'render',
        source: 'render.yaml',
        install: null,
        build: yamlScalar(text, 'buildCommand'),
        dir: yamlScalar(text, 'rootDir') || undefined,
        env: { RENDER: 'true' },
        note: count > 1 ? `${count} services — building the first; override with buildCmd for another` : undefined,
      };
      return withNodeFallback(dir, plan);
    },
  },
  {
    id: 'firebase',
    match(dir) {
      const cfg = readJson(dir, 'firebase.json');
      if (!cfg) return null;
      const hosting = Array.isArray(cfg.hosting) ? cfg.hosting[0] : cfg.hosting;
      let pre = hosting && hosting.predeploy;
      if (typeof pre === 'string') pre = [pre];
      const build = Array.isArray(pre) && pre.length
        ? pre.filter((c) => typeof c === 'string' && !/\$RESOURCE_DIR/.test(c)).join(' && ') || null
        : null;
      return withNodeFallback(dir, { host: 'firebase', source: 'firebase.json', install: null, build });
    },
  },
  {
    id: 'fly',
    match(dir) {
      const text = readText(dir, 'fly.toml');
      if (text == null) return null;
      if (tomlValue(text, 'build', 'image')) {
        return { host: 'fly', source: 'fly.toml', install: null, build: null, note: 'deploys a prebuilt image — nothing to build' };
      }
      const dockerfile = tomlValue(text, 'build', 'dockerfile') || 'Dockerfile';
      if (exists(dir, dockerfile)) {
        return {
          host: 'fly', source: 'fly.toml', install: null,
          build: `docker build -f "${dockerfile}" .`, requires: 'docker',
        };
      }
      return withNodeFallback(dir, { host: 'fly', source: 'fly.toml', install: null, build: null, note: 'buildpacks build — ecosystem build used instead' });
    },
  },
  {
    id: 'github-pages',
    match(dir) {
      const wfDir = path.join(dir, '.github', 'workflows');
      let files = [];
      try { files = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)); } catch { return null; }
      for (const f of files) {
        const text = readText(wfDir, f) || '';
        if (!/actions\/deploy-pages|actions\/upload-pages-artifact|peaceiris\/actions-gh-pages|JamesIves\/github-pages-deploy-action/.test(text)) continue;
        const runs = [];
        for (const m of text.matchAll(/^\s*(?:-\s*)?run:\s*(.+?)\s*$/gm)) {
          const cmd = m[1].replace(/^(['"])(.*)\1$/, '$2');
          if (cmd === '|' || cmd === '>' || cmd === '|-' || cmd === '>-') continue;
          runs.push(cmd);
        }
        const isInstall = (c) => /^(npm (ci|install)|pnpm install|yarn( install)?$|yarn install|bun install|pip install|bundle install)/.test(c);
        const install = runs.filter(isInstall).join(' && ') || null;
        const build = runs.filter((c) => !isInstall(c) && /\b(build|generate|export|jekyll|hugo|mkdocs|astro|docusaurus)\b/i.test(c)).join(' && ') || null;
        return withNodeFallback(dir, { host: 'github-pages', source: `.github/workflows/${f}`, install, build, env: { GITHUB_ACTIONS: 'true' } });
      }
      return null;
    },
  },
  // ---- ecosystem fallbacks: no host config found ----
  {
    id: 'node',
    match(dir) {
      const node = nodePlan(dir);
      if (!node || !node.build) return null;
      return { host: null, source: 'package.json', ...node };
    },
  },
  {
    id: 'docker',
    match(dir) {
      if (!exists(dir, 'Dockerfile')) return null;
      return { host: null, source: 'Dockerfile', install: null, build: 'docker build .', requires: 'docker' };
    },
  },
  {
    id: 'make',
    match(dir) {
      const text = readText(dir, 'Makefile');
      if (!text || !/^build\s*:/m.test(text)) return null;
      return { host: null, source: 'Makefile', install: null, build: 'make build' };
    },
  },
  {
    id: 'cargo',
    match(dir) {
      if (!exists(dir, 'Cargo.toml')) return null;
      const locked = exists(dir, 'Cargo.lock') ? ' --locked' : '';
      return { host: null, source: 'Cargo.toml', install: null, build: `cargo build --release${locked}` };
    },
  },
  {
    id: 'go',
    match(dir) {
      if (!exists(dir, 'go.mod')) return null;
      return { host: null, source: 'go.mod', install: 'go mod download', build: 'go build ./...' };
    },
  },
  {
    id: 'python',
    match(dir) {
      const text = readText(dir, 'pyproject.toml');
      if (!text || !/^\[build-system\]/m.test(text)) return null;
      return { host: null, source: 'pyproject.toml', install: null, build: 'python -m build' };
    },
  },
];

/**
 * The build the deploy host would run for the checkout at `dir`, or a
 * skipped plan (`build: null` + note) when no detector matches.
 * @param {string} dir
 * @param {{detectors?:Array}} [opts]
 */
function detectBuildPlan(dir, opts = {}) {
  const detectors = opts.detectors || DETECTORS;
  for (const d of detectors) {
    let plan = null;
    try { plan = d.match(dir); } catch { plan = null; }
    if (plan) return { detector: d.id, ...plan };
  }
  return { detector: null, host: null, source: null, install: null, build: null, note: 'no deploy host config or build definition found' };
}

// ---------------------------------------------------------------------------
// Environment — pass only what a build needs, withhold everything else
// ---------------------------------------------------------------------------

const ENV_ALLOW = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'OS',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'ALLUSERSPROFILE', 'PUBLIC',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LANGUAGE', 'TZ', 'TERM', 'SHELL', 'USER',
  'USERNAME', 'LOGNAME', 'HOSTNAME', 'COMPUTERNAME', 'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'MSYSTEM',
  'NVM_DIR', 'NVM_HOME', 'NVM_SYMLINK', 'VOLTA_HOME', 'PNPM_HOME', 'COREPACK_HOME',
  'BUN_INSTALL', 'DENO_DIR', 'JAVA_HOME', 'GOPATH', 'GOROOT', 'GOCACHE', 'GOMODCACHE',
  'CARGO_HOME', 'RUSTUP_HOME', 'PYENV_ROOT', 'VIRTUAL_ENV', 'CONDA_PREFIX',
  'DOCKER_HOST', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE',
]);
const ENV_ALLOW_PREFIX = ['LC_', 'XDG_'];
/** Names that read as a credential — withheld even under an allowed prefix. */
const SECRETISH = /(SECRET|TOKEN|PASSW|PWD$|KEY|CREDENTIAL|AUTH|PRIVATE|COOKIE|SESSION|DSN|DATABASE_URL|CONNECTION)/i;

/**
 * The child environment: allowlisted names from `env`, then `passEnv`
 * (explicitly released by the project), then `extra` (host marker vars and
 * CI=1). Returns the withheld NAMES — never values — for the inconclusive
 * heuristic.
 * @param {Object<string,string>} env
 * @param {string[]} [passEnv]
 * @param {Object<string,string>} [extra]
 */
function buildEnv(env, passEnv = [], extra = {}) {
  const out = {};
  const withheld = [];
  const pass = new Set(passEnv.map((n) => String(n).toUpperCase()));
  for (const [name, value] of Object.entries(env || {})) {
    if (value == null) continue;
    const upper = name.toUpperCase();
    const allowed = pass.has(upper)
      || ((ENV_ALLOW.has(upper) || ENV_ALLOW_PREFIX.some((p) => upper.startsWith(p))) && !SECRETISH.test(upper));
    if (allowed) out[name] = value;
    else withheld.push(name);
  }
  Object.assign(out, { CI: '1' }, extra);
  return { env: out, withheld };
}

/** Variable NAMES declared in a dotenv text (values are never read out). */
function dotenvNames(text) {
  const names = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * Names from `.env*` files that exist in the source checkout but not in the
 * clean one — local-only config the host gets from its own settings.
 */
function localOnlyEnvNames(sourceDir, cleanDir) {
  let entries = [];
  try { entries = fs.readdirSync(sourceDir).filter((f) => /^\.env(\..+)?$/.test(f)); } catch { return []; }
  const names = new Set();
  for (const f of entries) {
    if (/\.(example|sample|template|dist)$/.test(f)) continue;
    if (exists(cleanDir, f)) continue;
    for (const n of dotenvNames(readText(sourceDir, f))) names.add(n);
  }
  return [...names];
}

// ---------------------------------------------------------------------------
// Classification — failed vs. inconclusive
// ---------------------------------------------------------------------------

/** "<tool>: command not found" / "'<tool>' is not recognized" / "spawn <tool> ENOENT". */
function toolMissingRe(tool) {
  const t = escapeRe(tool);
  return new RegExp(`(?:^|[\\s:'"])${t}['"]?:\\s*(?:command )?not found|'${t}' is not recognized|spawn ${t} ENOENT`, 'im');
}
const NETWORK = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|getaddrinfo|Could not resolve host|network (?:error|timeout)|socket hang up|\bE401\b|\bE403\b|authentication required|Unauthorized/i;
const ENV_MISSING = [
  /(?:missing|required|not (?:set|defined|provided|configured)|is undefined)\b[^\n]{0,80}\b(?:env(?:ironment)?(?: var(?:iable)?s?)?|secrets?|api[_ -]?keys?|tokens?|credentials?)\b/i,
  /\b(?:env(?:ironment)? var(?:iable)?s?|secrets?|api[_ -]?keys?|tokens?|credentials?)\b[^\n]{0,80}\b(?:missing|required|not (?:set|defined|provided|configured)|is undefined)\b/i,
];

/** Withheld names specific enough that a mention in the output means something. */
function meaningfulNames(names) {
  return [...new Set(names)].filter((n) => n.length >= 5 && (n.includes('_') || SECRETISH.test(n)) && !/^npm_/i.test(n));
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * @param {{step:string, cmd?:string, tool?:string, code:number|null, timedOut?:boolean, output?:string, withheld?:string[], timeoutSec?:number}} r
 * @returns {{status:'passed'|'failed'|'inconclusive', reason:string|null, needsEnv?:string[]}}
 */
function classifyFailure(r) {
  if (r.code === 0 && !r.timedOut) return { status: 'passed', reason: null };
  const out = String(r.output || '');
  if (r.timedOut) return { status: 'inconclusive', reason: `${r.step} exceeded the ${r.timeoutSec || '?'} s budget` };
  const mentioned = meaningfulNames(r.withheld || []).filter((n) => new RegExp(`\\b${escapeRe(n)}\\b`).test(out));
  if (mentioned.length) {
    return { status: 'inconclusive', reason: `needs env the host provides: ${mentioned.slice(0, 5).join(', ')}`, needsEnv: mentioned };
  }
  if (ENV_MISSING.some((re) => re.test(out))) {
    return { status: 'inconclusive', reason: 'build reports a missing env var / secret' };
  }
  // Only the step's OWN tool counts as "not installed here" (pnpm, docker,
  // cargo, python's build module). A binary missing inside the build is a
  // real failure — the host would not have it either.
  if (r.tool && toolMissingRe(r.tool).test(out)) {
    return { status: 'inconclusive', reason: `${r.step}: ${r.tool} is not installed here` };
  }
  if (/No module named '?build'?\s*$/m.test(out) && /python\S*\s+-m\s+build\b/.test(r.cmd || '')) {
    return { status: 'inconclusive', reason: `${r.step}: python module "build" is not installed here` };
  }
  if (r.step === 'install' && NETWORK.test(out)) {
    return { status: 'inconclusive', reason: 'install: network or registry auth failed' };
  }
  return { status: 'failed', reason: `${r.step} failed (exit ${r.code})` };
}

// ---------------------------------------------------------------------------
// Process + git helpers
// ---------------------------------------------------------------------------

function git(args, cwd, timeout = GIT_TIMEOUT_MS) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }).trim();
}

function killTree(child) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}

/**
 * Run one shell command with a hard deadline; kills the whole process tree
 * on timeout (a surviving npm child would keep the temp worktree locked).
 * @returns {Promise<{code:number|null, timedOut:boolean, output:string, ms:number}>}
 */
function runCmd(cmd, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, { cwd, env, shell: true, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: 127, timedOut: false, output: String(e && e.message), ms: 0 });
      return;
    }
    const onData = (d) => { output = (output + d.toString()).slice(-4 * OUTPUT_TAIL); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, Math.max(1, timeoutMs));
    child.on('error', (e) => { output += `\n${e.message}`; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, timedOut, output: output.slice(-OUTPUT_TAIL), ms: Date.now() - started });
    });
  });
}

/** The program a shell command starts (`FOO=1 pnpm run build` → `pnpm`). */
function toolOf(cmd) {
  const tokens = String(cmd || '').trim().split(/\s+/);
  const first = tokens.find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) || '';
  return first.replace(/^["']|["']$/g, '');
}

/** Is `tool` resolvable on PATH (`where` / `command -v`)? */
function toolAvailable(tool, env) {
  if (!tool || /[\\/]/.test(tool)) return true; // a path — let the run decide
  try {
    if (process.platform === 'win32') execFileSync('where', [tool], { stdio: 'ignore', env, timeout: 10_000 });
    else execFileSync('sh', ['-c', `command -v "${tool.replace(/"/g, '')}"`], { stdio: 'ignore', env, timeout: 10_000 });
    return true;
  } catch { return false; }
}

function hasDocker() {
  try { execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore', timeout: 10_000 }); return true; } catch { return false; }
}

function removeTempWorktree(tmpRoot, adminDir) {
  let removed = true;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { removed = false; }
  if (adminDir) {
    try { fs.rmSync(adminDir, { recursive: true, force: true, maxRetries: 3 }); } catch { removed = false; }
  }
  return removed && !fs.existsSync(tmpRoot);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Build `sha` of the repo at `cwd` the way the deploy host would, in a clean
 * temporary worktree.
 * @param {object} o
 * @param {string} o.cwd            any directory inside the repo being shipped
 * @param {string} [o.sha]          commit to build (default HEAD)
 * @param {string} [o.buildCmd]     override the detected build command
 * @param {string} [o.installCmd]   override the detected install command ('' = no install)
 * @param {string} [o.dir]          subdirectory the build runs in (monorepo app)
 * @param {number} [o.timeoutSec]   budget for install + build together
 * @param {string[]} [o.passEnv]    env var names the project releases to the build
 * @param {Object} [o.env]          source environment (default process.env)
 * @param {Function} [o.hasDocker]  probe override (tests)
 * @param {Function} [o.toolAvailable] probe override (tests)
 * @returns {Promise<object>}       { status, reason, host, detector, source, plan, steps, outputTail, withheldCount, needsEnv, sha, durationMs, cleanup }
 */
async function runDeployParity(o) {
  const started = Date.now();
  const timeoutSec = Number.isInteger(o.timeoutSec) && o.timeoutSec > 0 ? o.timeoutSec : DEFAULT_TIMEOUT_SEC;
  const deadline = started + timeoutSec * 1000;
  const base = { status: 'skipped', reason: null, host: null, detector: null, source: null, plan: null, steps: [], outputTail: '', sha: null, timeoutSec };
  const finish = (extra) => ({ ...base, ...extra, durationMs: Date.now() - started });

  let top;
  let sha;
  try {
    top = git(['rev-parse', '--show-toplevel'], o.cwd);
    sha = git(['rev-parse', '--verify', `${o.sha || 'HEAD'}^{commit}`], top);
  } catch {
    return finish({ reason: 'not a git repository (or no commit to build)' });
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devops-parity-'));
  const workdir = path.join(tmpRoot, 'src');
  let adminDir = null;
  let result;
  try {
    try {
      git(['worktree', 'add', '--detach', '--quiet', workdir, sha], top, 120_000);
      adminDir = git(['rev-parse', '--absolute-git-dir'], workdir);
    } catch (e) {
      result = finish({ status: 'inconclusive', sha, reason: `could not create a clean checkout: ${String(e.stderr || e.message).trim().split('\n')[0]}` });
      return result;
    }
    if (exists(workdir, '.gitmodules')) {
      try { git(['submodule', 'update', '--init', '--recursive', '--depth', '1'], workdir, Math.max(1000, deadline - Date.now())); } catch {
        result = finish({ status: 'inconclusive', sha, reason: 'submodules could not be fetched' });
        return result;
      }
    }

    let plan = detectBuildPlan(workdir);
    if (o.buildCmd) {
      const node = nodePlan(path.join(workdir, o.dir || ''));
      plan = { ...plan, detector: 'custom', source: 'buildCmd', build: o.buildCmd, install: plan.install || (node && node.install) || null, requires: undefined, note: undefined };
    }
    if (o.installCmd !== undefined && o.installCmd !== null) plan = { ...plan, install: o.installCmd || null };
    if (o.dir) plan = { ...plan, dir: o.dir };
    const meta = { sha, host: plan.host, detector: plan.detector, source: plan.source, plan: { install: plan.install, build: plan.build, dir: plan.dir || null, lifecycle: plan.lifecycle || [], note: plan.note || null } };

    if (!plan.build) {
      result = finish({ ...meta, status: 'skipped', reason: plan.note || 'no build to run' });
      return result;
    }
    if (plan.requires === 'docker' && !(o.hasDocker || hasDocker)()) {
      result = finish({ ...meta, status: 'skipped', reason: 'needs docker, which is not available here' });
      return result;
    }

    const runDir = path.join(workdir, plan.dir || '');
    const { env, withheld } = buildEnv(o.env || process.env, o.passEnv || [], plan.env || {});
    const withheldAll = withheld.concat(localOnlyEnvNames(top, workdir));
    const steps = [];
    for (const [step, cmd] of [['install', plan.install], ['build', plan.build]]) {
      if (!cmd) continue;
      const left = deadline - Date.now();
      if (left <= 0) {
        result = finish({ ...meta, steps, status: 'inconclusive', reason: `${step} not reached within the ${timeoutSec} s budget` });
        return result;
      }
      const tool = toolOf(cmd);
      if (!(o.toolAvailable || toolAvailable)(tool, env)) {
        result = finish({ ...meta, steps, status: 'inconclusive', reason: `${step}: ${tool} is not installed here` });
        return result;
      }
      const r = await runCmd(cmd, { cwd: runDir, env, timeoutMs: left });
      steps.push({ step, cmd, code: r.code, timedOut: r.timedOut, ms: r.ms });
      const verdict = classifyFailure({ step, cmd, tool, code: r.code, timedOut: r.timedOut, output: r.output, withheld: withheldAll, timeoutSec });
      if (verdict.status !== 'passed') {
        result = finish({ ...meta, steps, status: verdict.status, reason: verdict.reason, needsEnv: verdict.needsEnv, outputTail: r.output, withheldCount: withheldAll.length });
        return result;
      }
    }
    result = finish({ ...meta, steps, status: 'passed', withheldCount: withheldAll.length });
    return result;
  } finally {
    const cleaned = removeTempWorktree(tmpRoot, adminDir);
    if (result) result.cleanup = { removed: cleaned, path: tmpRoot };
  }
}

module.exports = {
  DEFAULT_TIMEOUT_SEC, DETECTORS,
  detectBuildPlan, nodePlan, packageManager, tomlValue, yamlScalar,
  buildEnv, dotenvNames, localOnlyEnvNames, classifyFailure, meaningfulNames,
  toolOf, runCmd, runDeployParity,
};
