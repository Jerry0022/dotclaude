'use strict';
/**
 * @module frustrated-guard
 * @version 0.1.0
 * @plugin devops
 * @feature frustrated-mode (alpha)
 * @description Read-only marker and rules of the frustrated analysis
 *   (hook `pre.frustrated.readonly`, CLI `scripts/frustrated-guard.js`).
 *
 *   Marker: `os.tmpdir()/dotclaude-devops-frustrated-guard-<session_id>`,
 *   JSON `{armedAt, expiresAt, cwd, target}`, 2 h expiry of its own. Read
 *   with the exact session id only (it is an enforcement flag). Subagent
 *   hook payloads carry the parent's `session_id` (umbrella spec, F1), so
 *   one marker covers the main thread and every analyst.
 *
 *   While armed, `decide()` denies changes to the app's source and config:
 *   Edit / Write / NotebookEdit / MultiEdit outside the allowed write areas,
 *   Bash / PowerShell that is not read-only, a test run, or a plugin state
 *   script, any `Workflow`, and mutating ship / GitHub MCP tools.
 *   Allowed write areas (decision d6): the temp dir (scratchpad included),
 *   `.claude/` state (not its settings, agents, skills, commands, hooks,
 *   worktrees or plugins), `~/.claude/` state on the same terms, and test
 *   artifacts (snapshots, coverage, caches, test reports).
 *
 *   Every exported entry point that acts checks
 *   featureAllowed('frustrated-mode') first.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FEATURE = 'frustrated-mode';
const PREFIX = 'dotclaude-devops-frustrated-guard';
const EXPIRY_MS = 2 * 60 * 60 * 1000;

function allowed(opts = {}) {
  if (opts.featureOn !== undefined) return !!opts.featureOn;
  return require('./features').featureAllowed(FEATURE, opts.features);
}

// ── Marker ──────────────────────────────────────────────────────────────────

function markerPath(sessionId, opts = {}) {
  if (opts.file) return opts.file;
  const key = String(sessionId || '').replace(/[^\w.-]/g, '');
  if (!key) return null;
  return path.join(opts.tmpDir || os.tmpdir(), `${PREFIX}-${key}`);
}

/** The marker, or null when missing, corrupt, expired or the feature is off. */
function readMarker(sessionId, opts = {}) {
  if (!allowed(opts)) return null;
  const file = markerPath(sessionId, opts);
  if (!file) return null;
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const now = opts.nowMs || Date.now();
    if (!m || typeof m !== 'object' || !Number.isFinite(m.expiresAt) || now >= m.expiresAt) {
      try { fs.unlinkSync(file); } catch { /* gone */ }
      return null;
    }
    return m;
  } catch { return null; }
}

function isArmed(sessionId, opts = {}) {
  return !!readMarker(sessionId, opts);
}

/** Arm (or re-arm, which restarts the 2 h). Returns the marker or null. */
function arm(sessionId, info = {}, opts = {}) {
  if (!allowed(opts)) return null;
  const file = markerPath(sessionId, opts);
  if (!file) return null;
  const now = opts.nowMs || Date.now();
  const m = { armedAt: now, expiresAt: now + EXPIRY_MS, cwd: info.cwd || null, target: info.target ? String(info.target).slice(0, 200) : null };
  try {
    require('./session-id').writeSessionFile(file, JSON.stringify(m));
    return m;
  } catch { return null; }
}

function disarm(sessionId, opts = {}) {
  if (!allowed(opts)) return false;
  const file = markerPath(sessionId, opts);
  if (!file) return false;
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

// ── Paths ───────────────────────────────────────────────────────────────────

const slash = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
const lower = (p) => slash(p).toLowerCase();

/** Git-Bash style `/c/Users/...` → `c:/Users/...`. */
function fromMsys(p) {
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
  return m && process.platform === 'win32' ? `${m[1]}:${m[2] || '/'}` : p;
}

function unquote(s) {
  const t = String(s || '').trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1);
  return t;
}

const TMP_VAR_RE = /^\$\{?(?:TMP|TEMP|TMPDIR|CLAUDE_SCRATCHPAD|SCRATCHPAD)\}?(?:[/\\]|$)/i;
const CLAUDE_DENY = /^(?:settings(?:\.local)?\.json|devops-config\.json|claude\.md|(?:agents|skills|commands|hooks|worktrees|plugins|workflows|rules)(?:\/|$))/i;
const ARTIFACT_SEG = new Set(['__snapshots__', 'coverage', '.nyc_output', 'test-results', 'playwright-report', '.pytest_cache',
  '.cache', '.vitest', '.jest-cache', 'htmlcov', '.mypy_cache', '.ruff_cache', '.hypothesis', '.turbo', 'blob-report']);

function tmpRoots(opts) {
  const roots = [opts.tmpDir || os.tmpdir(), '/tmp', process.env.TEMP, process.env.TMP, process.env.TMPDIR].filter(Boolean);
  return roots.map(lower).filter(Boolean);
}

/**
 * May the analysis write here? Relative paths resolve against `cwd`.
 * @param {string} p
 * @param {{cwd?:string, tmpDir?:string, home?:string}} [opts]
 */
function isAllowedWritePath(p, opts = {}) {
  let raw = unquote(p);
  if (!raw) return false;
  if (/^(?:\/dev\/null|nul|\$null|NUL:?)$/i.test(raw) || /^\/dev\/(?:stdout|stderr|fd\/\d)$/.test(raw)) return true;
  if (TMP_VAR_RE.test(raw)) return !/(^|\/)\.\.(\/|$)/.test(slash(raw));
  if (raw.startsWith('~')) raw = path.join(opts.home || os.homedir(), raw.slice(1));
  if (/[$`*?]/.test(raw)) return false; // unexpanded variable / glob: cannot prove where it lands
  const abs = lower(path.resolve(opts.cwd || process.cwd(), fromMsys(slash(raw))));
  for (const t of tmpRoots(opts)) {
    const tr = lower(path.resolve(fromMsys(t)));
    if (abs === tr || abs.startsWith(tr + '/')) return true;
  }
  const segs = abs.split('/');
  if (abs.endsWith('.snap') || segs.some((s) => ARTIFACT_SEG.has(s))) return true;
  const i = abs.lastIndexOf('/.claude/');
  if (i >= 0) return !CLAUDE_DENY.test(abs.slice(i + '/.claude/'.length));
  return false;
}

// ── Shell ───────────────────────────────────────────────────────────────────

const READ_HEADS = new Set(['cat', 'head', 'tail', 'wc', 'ls', 'dir', 'pwd', 'echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag',
  'sort', 'uniq', 'cut', 'tr', 'jq', 'diff', 'cmp', 'stat', 'file', 'which', 'where', 'type', 'command', 'date', 'basename',
  'dirname', 'realpath', 'readlink', 'tree', 'du', 'df', 'test', '[', 'true', 'false', 'hostname', 'whoami', 'uname', 'id',
  'ps', 'tasklist', 'nl', 'column', 'od', 'xxd', 'hexdump', 'md5sum', 'sha1sum', 'sha256sum', 'cd', 'pushd', 'popd', 'export',
  'set', 'unset', 'local', 'sleep', 'wait', 'exit', 'return', ':', 'less', 'more', 'comm', 'paste', 'fold', 'rev', 'seq', 'env', 'printenv']);
const PS_READ_HEADS = new Set(['get-childitem', 'gci', 'get-content', 'gc', 'select-string', 'sls', 'test-path', 'get-item', 'gi',
  'get-location', 'gl', 'resolve-path', 'measure-object', 'measure', 'select-object', 'select', 'where-object', 'where', '?',
  'sort-object', 'sort', 'format-table', 'ft', 'format-list', 'fl', 'out-string', 'write-output', 'write-host', 'echo',
  'get-command', 'gcm', 'get-process', 'gps', 'get-date', 'get-filehash', 'join-path', 'split-path', 'set-location', 'cd', 'sl',
  'convertfrom-json', 'convertto-json', 'foreach-object', '%', 'group-object', 'cat', 'ls', 'dir', 'type', 'pwd']);
const GIT_READ = new Set(['log', 'show', 'diff', 'blame', 'reflog', 'rev-parse', 'ls-files', 'ls-tree', 'grep', 'merge-base',
  'cat-file', 'status', 'describe', 'shortlog', 'name-rev', 'rev-list', 'for-each-ref', 'count-objects', 'whatchanged',
  'show-ref', 'check-ignore', 'help', 'version', '--version']);
const TEST_WORD = /^(?:test|tests|t|lint|typecheck|type-check|check|vitest|jest|spec|e2e|coverage)(?:[:\w.-]*)$/i;
const FIX_WORD = /fix|format|write|prettier|update|clean|reset|seed|migrate|install/i;
const JS_TEST_TOOLS = new Set(['vitest', 'jest', 'mocha', 'playwright', 'cypress', 'ava', 'tap', 'c8', 'nyc', 'tsc', 'eslint', 'jasmine', 'karma', 'uvu']);
const PLUGIN_SCRIPTS = /\/(?:scripts\/(?:feature-flag|run-contract|frustrated-guard|frustrated-brief|frustration-replay)\.js|hooks\/lib\/run-contract\.js|mcp-server\/index\.js)$/i;

function words(seg) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(seg))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

/** Redirection targets of one raw segment (`>`, `>>`, `&>`, `N>`; not `>&N`). */
function redirectTargets(rawSeg) {
  const out = [];
  const stripped = rawSeg.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (q) => ' '.repeat(q.length));
  const re = /(?:^|[^<>&\d])(?:\d|&)?>>?(?!&)/g;
  let m;
  while ((m = re.exec(stripped))) {
    const start = m.index + m[0].length;
    const rest = rawSeg.slice(start).replace(/^\s+/, '');
    const t = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;&|<>]+)/.exec(rest);
    out.push(t ? t[1] : '');
  }
  return out;
}

/** A test/lint/typecheck run (never `--fix`). `ws` = words after env assignments. */
function isTestRun(ws) {
  const [h, a, b] = ws.map((w) => String(w || '').toLowerCase());
  const base = path.basename(h || '').replace(/\.(?:cmd|exe|bat)$/, '');
  if (ws.some((w) => /^--fix\b/.test(w))) return false;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(base)) {
    if (a === 'run' || a === 'run-script') return TEST_WORD.test(b || '') && !FIX_WORD.test(b || '');
    if (a === 'exec' || a === 'dlx' || a === 'x') return JS_TEST_TOOLS.has(b);
    if (base === 'bun' && a === 'test') return true;
    return TEST_WORD.test(a || '') || (base === 'yarn' && JS_TEST_TOOLS.has(a));
  }
  if (base === 'npx' || base === 'bunx') return JS_TEST_TOOLS.has(a === '--no-install' || a === '-y' ? b : a);
  if (JS_TEST_TOOLS.has(base)) return base !== 'tsc' || ws.includes('--noEmit') || ws.includes('--noemit');
  if (['pytest', 'py.test', 'ctest', 'phpunit', 'rspec', 'tox', 'nox'].includes(base)) return true;
  if (['python', 'python3', 'py'].includes(base)) return a === '-m' && ['pytest', 'unittest', 'mypy', 'ruff', 'flake8', 'pylint'].includes(b) && (b !== 'ruff' || ws[3] === 'check');
  if (base === 'go') return a === 'test' || a === 'vet';
  if (base === 'cargo') return ['test', 'check', 'clippy', 'nextest'].includes(a);
  if (base === 'dotnet') return a === 'test';
  if (base === 'mvn' || base === 'mvnw') return ['test', 'verify'].includes(a);
  if (base === 'gradle' || base === 'gradlew') return ['test', 'check'].includes(a);
  if (base === 'make') return ['test', 'check', 'lint'].includes(a);
  if (base === 'deno') return a === 'test' || a === 'lint' || a === 'check';
  if (base === 'bundle') return a === 'exec' && b === 'rspec';
  if (base === 'node') return a === '--test';
  return false;
}

function gitReadOnly(ws) {
  let i = 1;
  while (i < ws.length && /^-/.test(ws[i])) { i += (ws[i] === '-C' || ws[i] === '-c') ? 2 : 1; }
  const sub = ws[i];
  const rest = ws.slice(i + 1);
  if (!sub) return true;
  if (GIT_READ.has(sub)) {
    if (sub === 'diff' && rest.some((w) => /^--output\b/.test(w))) return false;
    if (sub === 'reflog' && rest.some((w) => /^(?:expire|delete)$/.test(w))) return false;
    return true;
  }
  if (sub === 'branch') return rest.every((w) => /^(?:-a|-r|-v|-vv|--list|-l|--show-current|--all|--remotes|--verbose|--contains|--merged|--no-merged|--no-color|--color)$/.test(w) || !/^-/.test(w) && rest.includes('--list'));
  if (sub === 'tag') return rest.length === 0 || rest.every((w) => /^(?:-l|--list|-n\d*)$/.test(w) || rest.includes('-l') || rest.includes('--list'));
  if (sub === 'remote') return rest.length === 0 || rest[0] === '-v' || rest[0] === 'show' || rest[0] === 'get-url';
  if (sub === 'config') return rest.some((w) => /^(?:--get|--get-all|--get-regexp|--list|-l)$/.test(w));
  if (sub === 'worktree') return rest[0] === 'list';
  if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show';
  return false;
}

/** Plugin state scripts (`node <own plugin root>/scripts/feature-flag.js …`). */
function isPluginScript(ws, opts) {
  const base = path.basename(String(ws[0] || '').toLowerCase()).replace(/\.exe$/, '');
  if (base !== 'node' || !ws[1]) return false;
  const script = lower(path.resolve(fromMsys(slash(ws[1]))));
  const root = lower(path.resolve(opts.pluginRoot || path.resolve(__dirname, '..', '..')));
  if (!script.startsWith(root + '/')) return false;
  if (!PLUGIN_SCRIPTS.test(script)) return false;
  if (/mcp-server\/index\.js$/i.test(script)) return ws.includes('--render-card');
  return true;
}

/** File operations whose every path operand is an allowed write area. */
const FILE_OPS = new Set(['mkdir', 'touch', 'rm', 'rmdir', 'cp', 'mv', 'tee', 'ln']);

/**
 * Classify one segment. @returns {string|null} null = allowed, else the reason.
 */
function segmentReason(rawSeg, opts, ps) {
  const seg = rawSeg.trim();
  if (!seg) return null;
  for (const t of redirectTargets(seg)) {
    if (!isAllowedWritePath(t, opts)) return `redirects output into ${t || 'an unknown target'}`;
  }
  let ws = words(seg.replace(/(?:^|\s)(?:\d|&)?>>?(?!&)\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;&|<>]+)/g, ' ').replace(/\d?>&\d/g, ' '));
  while (ws.length && /^[A-Za-z_]\w*=/.test(ws[0])) ws = ws.slice(1);
  if (!ws.length) return null;
  const head = ws[0];
  const base = path.basename(head.toLowerCase()).replace(/\.(?:exe|cmd|bat)$/, '');
  if (ps) {
    if (PS_READ_HEADS.has(base)) return null;
  } else if (READ_HEADS.has(base)) {
    if (base === 'env' && ws.length > 1) return segmentReason(ws.slice(1).join(' '), opts, ps);
    return null;
  }
  if (base === 'sed') return ws.slice(1).some((w) => /^--in-place/.test(w) || /^-[a-zA-Z]*i/.test(w)) ? 'edits a file in place (sed -i)' : null;
  if (base === 'awk' || base === 'gawk') return /system\s*\(|print[^|]*>|-i\s*inplace/.test(seg) ? 'awk writes or runs commands' : null;
  if (base === 'find') return ws.some((w) => /^-(?:delete|exec|execdir|ok|okdir|fprint\w*|fls)$/.test(w)) ? 'find with -delete/-exec' : null;
  if (base === 'git') return gitReadOnly(ws) ? null : `\`git ${ws.find((w, i) => i > 0 && !/^-/.test(w)) || ''}\` changes the repository`;
  if (base === 'xargs') {
    const inner = ws.slice(1).filter((w) => !/^-/.test(w));
    return inner.length && READ_HEADS.has(path.basename(inner[0])) ? null : 'xargs runs a command that is not read-only';
  }
  if (FILE_OPS.has(base)) {
    const operands = ws.slice(1).filter((w) => !/^-/.test(w));
    // cp / ln only write their destination; the sources are read
    const written = (base === 'cp' || base === 'ln') && operands.length > 1 ? operands.slice(-1) : operands;
    if (written.length && written.every((o) => isAllowedWritePath(o, opts))) return null;
    return `\`${base}\` touches a path outside the temp dir, .claude/ state and test artifacts`;
  }
  if (isTestRun(ws)) return null;
  if (isPluginScript(ws, opts)) return null;
  return `\`${base}\` is neither read-only, a test run nor a plugin state script`;
}

/**
 * @param {string} cmd
 * @param {{cwd?:string, tmpDir?:string, pluginRoot?:string, ps?:boolean}} [opts]
 * @returns {string|null} null = allowed, else the first reason
 */
function shellReason(cmd, opts = {}, depth = 0) {
  const calls = require('./run-contract-calls');
  const lang = opts.ps ? 'ps' : 'sh';
  const scan = calls.scanShell(String(cmd || ''), lang);
  if (depth < 4) {
    for (const s of scan.subs) { const r = shellReason(s, opts, depth + 1); if (r) return r; }
    for (const f of scan.feeds) { const r = shellReason(f.body, opts, depth + 1); if (r) return r; }
  }
  for (const seg of calls.splitSegments(scan.text, !!opts.ps)) {
    const r = segmentReason(seg, opts, !!opts.ps);
    if (r) return r;
  }
  return null;
}

// ── Decision ────────────────────────────────────────────────────────────────

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const MCP_WRITE_RE = /^mcp__.*(?:ship_|__(?:create|update|delete|merge|push|add|remove|close|reopen|assign|label|fork|issue_write|sub_issue_write)[\w-]*$)/i;
const ARM_CMD_RE = /frustrated-guard\.js["']?\s+(arm|disarm)\b/;

/**
 * @param {object} hook PreToolUse payload
 * @param {object} [opts] test injection: featureOn, features, file, tmpDir, nowMs, pluginRoot, home
 * @returns {{block:boolean, reason?:string, armed:boolean}}
 */
function decide(hook, opts = {}) {
  const none = { block: false, armed: false };
  if (!allowed(opts)) return none;
  if (!hook || typeof hook !== 'object') return none;
  const sid = hook.session_id || '';
  const marker = readMarker(sid, opts);
  if (!marker) return none;
  const tool = hook.tool_name || '';
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const ctx = { ...opts, cwd: hook.cwd || marker.cwd || process.cwd() };
  const deny = (reason) => ({ block: true, armed: true, reason });

  if (EDIT_TOOLS.has(tool)) {
    const p = input.file_path || input.notebook_path || input.path || '';
    return isAllowedWritePath(p, ctx) ? { block: false, armed: true } : deny(`${tool} of ${p || 'a file'} changes the app's source or config`);
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    const r = shellReason(cmd, { ...ctx, ps: tool === 'PowerShell' });
    return r ? deny(`${tool}: ${r}`) : { block: false, armed: true };
  }
  if (tool === 'Workflow') return deny('the analysis runs its fixed roles as Agent spawns; workflows (also under ultracode) stay off until a plan is approved');
  if (MCP_WRITE_RE.test(tool) && !/render_completion_card/.test(tool)) return deny(`${tool} changes remote or release state`);
  return { block: false, armed: true };
}

/** The hook side of `frustrated-guard.js arm|disarm`: the payload's session_id is authoritative. */
function armCommand(hook) {
  if (!hook || (hook.tool_name !== 'Bash' && hook.tool_name !== 'PowerShell')) return null;
  const cmd = hook.tool_input && typeof hook.tool_input.command === 'string' ? hook.tool_input.command : '';
  const m = ARM_CMD_RE.exec(cmd);
  return m ? m[1] : null;
}

/**
 * Full hook decision: applies an `arm` / `disarm` command with the payload's
 * session id (main thread only), else `decide()`.
 * @returns {{block:boolean, reason?:string, armed:boolean, applied?:string}}
 */
function hookDecision(hook, opts = {}) {
  if (!allowed(opts)) return { block: false, armed: false };
  const cmd = armCommand(hook);
  const sid = hook && hook.session_id;
  if (cmd && sid) {
    if (hook.agent_id) {
      if (cmd === 'disarm' && isArmed(sid, opts)) return { block: true, armed: true, reason: 'only the main thread may end the analysis guard' };
      return decide(hook, opts);
    }
    if (cmd === 'arm') arm(sid, { cwd: hook.cwd }, opts);
    else disarm(sid, opts);
    return { block: false, armed: cmd === 'arm', applied: cmd };
  }
  return decide(hook, opts);
}

function denyText(reason) {
  return [
    `[pre.frustrated.readonly] BLOCKED: ${reason}.`,
    'A read-only frustrated analysis is active in this session: the app\'s source and config must not change until the user approves a plan.',
    'Allowed: reading, git read commands, running tests/lint/typecheck (no --fix), writing into the temp dir/scratchpad,',
    '.claude/ state, snapshots, coverage and caches, and the plugin scripts feature-flag.js, run-contract.js (plan …), frustrated-guard.js, frustrated-brief.js.',
    'Record what this change would do as a plan step instead. The guard ends after the user approved the plan',
    '(`run-contract.js plan approve`, then `frustrated-guard.js disarm`), when the user ends the analysis, or after 2 h.',
  ].join('\n') + '\n';
}

module.exports = {
  FEATURE, PREFIX, EXPIRY_MS,
  featureOn: allowed, hookDecision,
  markerPath, readMarker, isArmed, arm, disarm,
  isAllowedWritePath, isTestRun, gitReadOnly, shellReason, redirectTargets,
  decide, armCommand, denyText,
};
