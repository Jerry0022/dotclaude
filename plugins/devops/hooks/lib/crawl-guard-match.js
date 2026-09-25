/**
 * @module crawl-guard-match
 * @version 0.2.0
 * @plugin devops
 * @description Pure matcher for pre.crawl.guard. Finds shell commands that
 *   recursively walk a filesystem root, a drive root, or the whole home
 *   directory.
 *
 *   Incident (2026-09-24): devops subagents could not resolve
 *   `{PLUGIN_ROOT}` and ran `find / -maxdepth 6 -iname ui-defaults.md`,
 *   `find / -maxdepth 8 -iname pre-mortem.md` and
 *   `find / -iname materials -type d`. In Git Bash `/` is the Git install
 *   plus every mounted drive (network drives too). Each call hit the Bash
 *   tool's 120 s timeout, was moved to the background instead of killed, and
 *   the orphaned find.exe crawled for hours after its agent had finished.
 *
 *   What counts as a crawl: a recursive walker whose START PATH is
 *     - a root: `/`, `/c`, `/cygdrive/c`, `/mnt/c`, `C:`, `C:\`, `\`, a UNC
 *       share, `/home`, `/Users`, `C:\Users` (every user's home), a
 *       PSDrive's `.Root`, and any of these followed by `/*`;
 *     - the home directory: `~`, `$HOME`, `$env:USERPROFILE`,
 *       `/c/Users/<name>`, `C:\Users\<name>`, `/home/<name>`.
 *   Walkers: find, tree (GNU and Windows tree.com), du, `ls -R`, `grep -r`,
 *   rg / ag / ack, fd, `where /r`, robocopy `/s|/e`, `dir /s` (cmd),
 *   Get-ChildItem / gci / ls / dir with -Recurse / -s / -Depth, and
 *   `[IO.Directory]::Get*|Enumerate*(…, AllDirectories)` (PowerShell).
 *   `bash -c`, `pwsh -Command` and `cmd /c` bodies, heredocs fed to a shell,
 *   and `$(…)` / backtick substitutions are analysed as commands too.
 *
 *   Start paths are resolved the way the shell would see them:
 *     - a relative path (`.`, `*`, `..`, no path at all) is joined to the
 *       working directory: the hook's `cwd`, then every `cd` / `pushd` /
 *       `Set-Location` / `Push-Location` earlier in the same command. So
 *       `cd / && find .` and `find .` in a home-directory session are crawls;
 *     - `$(cygpath [-u|-w] X)` becomes X; a variable set earlier in the
 *       command (`D=/c`, `for d in /c /h`, `$d = 'C:\'`) expands to its value;
 *     - `$CLAUDE_PLUGIN_ROOT` / `$CLAUDE_PLUGIN_DATA` are empty in the Bash and
 *       PowerShell tools (set only in hook and MCP processes), so
 *       `"$CLAUDE_PLUGIN_ROOT/"` is `/`; `$SYSTEMDRIVE/` is `C:/`.
 *
 *   Depth: a root is allowed only at depth ≤ 1 (a plain listing). The home
 *   directory is allowed at depth ≤ 3: that is enough to see ~/.claude/plugins
 *   or ~/IdeaProjects/<repo>, while a deeper walk of home reaches AppData,
 *   every node_modules, every worktree and the session transcripts —
 *   hundreds of thousands of entries, the incident's second crawl
 *   (`find C:\Users\Jerem -maxdepth 8`) also hit the timeout. du, `ls -R`
 *   and `grep -r` have no traversal limit, so they are never allowed there.
 *
 *   Not a crawl: any subdirectory (`/tmp/x`, `/c/Users/me/IdeaProjects/x`,
 *   `~/.claude`, `./src` in a project), and text that only mentions `find /`
 *   inside quotes (a commit message, an echo, a grep pattern) or inside a
 *   data heredoc / PowerShell here-string body. The quoted START PATH of a
 *   real walker still counts: `find "/" -name x`. A token counts as an
 *   option only when it does not START with a quote, so `--include="*.js"`
 *   is an option and `"-x"` is an operand.
 *
 *   A nudge, not a security boundary: eval, scripts, variables set in an
 *   earlier tool call and paths computed at runtime are not followed.
 */

const os = require('os');

const WRAPPERS = new Set([
  'sudo', 'nohup', 'command', 'builtin', 'exec', 'env', 'time', 'nice',
  'stdbuf', 'timeout', 'winpty', 'xargs', 'setsid', 'ionice', 'doas',
]);
/** Shell keywords that precede a command in the same segment. */
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'return']);
const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const PS_SHELLS = new Set(['pwsh', 'powershell']);
const GCI_HEADS = new Set(['get-childitem', 'gci']);
const GREP_HEADS = new Set(['grep', 'egrep', 'fgrep']);
const RG_HEADS = new Set(['rg', 'ag', 'ack']);
const FD_HEADS = new Set(['fd', 'fdfind']);
const CD_HEADS = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location']);
const POP_HEADS = new Set(['popd', 'pop-location']);

/** Depth up to which a start path of each kind may still be walked. */
const MAX_ALLOWED_DEPTH = { root: 1, home: 3 };
const MAX_NESTING = 4;
const SUB = '$SUB';

/** Strip a leading directory and a trailing `.exe`, then lowercase. */
function baseName(token) {
  const tail = String(token).split(/[\\/]/).pop() || '';
  return tail.replace(/\.(exe|cmd|bat|ps1|com)$/i, '').toLowerCase();
}

/** Index of the `)` closing the `(` at `open`, quote-aware; -1 if unbalanced. */
function matchingParen(text, open) {
  let depth = 1;
  let quote = null;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && quote !== "'") { i++; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

/**
 * The shell a heredoc body is fed to, or null when the body is data.
 * `bash <<'EOF'`, `sudo sh -s <<EOF`, `cat <<EOF | bash`.
 */
function heredocShell(before, rest, shell) {
  const cut = Math.max(
    before.lastIndexOf('\n'), before.lastIndexOf(';'), before.lastIndexOf('|'),
    before.lastIndexOf('&'), before.lastIndexOf('('),
  );
  const segs = tokenize(before.slice(cut + 1), shell, []);
  const last = segs[segs.length - 1];
  const r = last ? resolveHead(last, shell) : null;
  let head = r ? r.head : null;
  if (!head || !(POSIX_SHELLS.has(head) || PS_SHELLS.has(head))) {
    const m = /\|\s*(?:sudo\s+)?([\w./\\:-]+)/.exec(rest);
    head = m ? baseName(m[1]) : null;
  }
  if (head && POSIX_SHELLS.has(head)) return 'bash';
  if (head && PS_SHELLS.has(head)) return 'powershell';
  return null;
}

/**
 * Join line continuations and blank heredoc / here-string bodies: those
 * bodies are data (a file being written, a commit message), not commands.
 * A heredoc fed to a shell (`bash <<'EOF'`) IS a command: its body is pushed
 * to `bodies` for separate analysis.
 * @param {string} cmd
 * @param {string} shell
 * @param {Array<{text:string, shell:string}>} [bodies]
 */
function prepare(cmd, shell, bodies) {
  let s = String(cmd);
  s = shell === 'powershell' ? s.replace(/`\r?\n/g, ' ') : s.replace(/\\\r?\n/g, ' ');
  s = s.replace(/@"[\s\S]*?"@/g, ' ').replace(/@'[\s\S]*?'@/g, ' ');
  const src = s;
  s = src.replace(
    /<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1([^\n]*)\n(?:([\s\S]*?)\n)?[ \t]*\2(?![\w])/g,
    (m, _q, _tag, rest, body, offset) => {
      const target = heredocShell(src.slice(0, offset), rest, shell);
      if (target && bodies) bodies.push({ text: body || '', shell: target });
      return ' ' + rest + '\n';
    },
  );
  return s;
}

/** `$(cygpath [-u|-w|-m] X)` → X: the substitution only converts a path. */
function cygpathArg(body) {
  const m = /^\s*cygpath(?:\s+-[A-Za-z-]+)*\s+(?:"([^"]*)"|'([^']*)'|([^\s"'`$()]+|\$\{?\w+\}?))\s*$/.exec(body);
  if (!m) return null;
  const arg = m[1] ?? m[2] ?? m[3];
  return arg.includes('$(') ? null : arg;
}

/**
 * Split a command into segments of word tokens, honouring quotes, escapes,
 * separators, comments and redirections. Command substitutions are cut out
 * into `subs` (analysed separately) and leave a `$SUB` marker in the word.
 * `q`: some part of the word was quoted. `lq`: the word STARTS with a quote
 * (so it can never be an option, whatever follows).
 * @returns {Array<Array<{v:string,q:boolean,lq:boolean}>>}
 */
function tokenize(src, shell, subs) {
  const esc = shell === 'bash' ? '\\' : shell === 'powershell' ? '`' : '^';
  const segments = [];
  let tokens = [];
  let word = null;
  let dropNext = false;
  const cur = () => (word || (word = { v: '', q: false, lq: false }));
  const push = () => {
    if (word === null) return;
    if (dropNext) dropNext = false;
    else tokens.push(word);
    word = null;
  };
  const endSeg = () => {
    push();
    dropNext = false;
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };
  const takeSub = (open) => {
    const close = matchingParen(src, open);
    const end = close === -1 ? src.length : close;
    const body = src.slice(open + 1, end);
    const arg = cygpathArg(body);
    if (arg !== null) cur().v += arg;
    else { subs.push(body); cur().v += SUB; }
    return end + 1;
  };
  const takeBacktick = (i) => {
    const j = src.indexOf('`', i + 1);
    const end = j === -1 ? src.length : j;
    const body = src.slice(i + 1, end);
    const arg = cygpathArg(body);
    if (arg !== null) cur().v += arg;
    else { subs.push(body); cur().v += SUB; }
    return end + 1;
  };
  const openQuote = () => {
    const fresh = word === null;
    cur().q = true;
    if (fresh) word.lq = true;
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === esc) {
      if (i + 1 < n && src[i + 1] !== '\n') cur().v += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'") {
      const j = src.indexOf("'", i + 1);
      const end = j === -1 ? n : j;
      openQuote();
      word.v += src.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      openQuote();
      i++;
      while (i < n && src[i] !== '"') {
        const c = src[i];
        if (shell === 'bash' && c === '\\' && i + 1 < n && '"\\$`'.includes(src[i + 1])) {
          word.v += src[i + 1]; i += 2; continue;
        }
        if (shell === 'powershell' && c === '`' && i + 1 < n) { word.v += src[i + 1]; i += 2; continue; }
        if (c === '$' && src[i + 1] === '(') { i = takeSub(i + 1); continue; }
        if (shell === 'bash' && c === '`') { i = takeBacktick(i); continue; }
        word.v += c;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '$' && src[i + 1] === '(') { i = takeSub(i + 1); continue; }
    if (ch === '$' && src[i + 1] === '{') {
      const j = src.indexOf('}', i + 2);
      const end = j === -1 ? n : j;
      cur().v += src.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (shell === 'bash' && ch === '`') { i = takeBacktick(i); continue; }
    if (ch === '#' && word === null) {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '>' || ch === '<') {
      // Redirection: `2>/dev/null`, `>> log`, `2>&1`, `< in`. The fd number
      // and the target are not operands of the command.
      if (word !== null && /^\d*$/.test(word.v) && !word.q) word = null;
      else push();
      while (i < n && (src[i] === '>' || src[i] === '<')) i++;
      if (src[i] === '&') {
        i++;
        while (i < n && /[\d-]/.test(src[i])) i++;
        continue;
      }
      dropNext = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { push(); i++; continue; }
    if (ch === '\n' || ch === ';' || ch === '&' || ch === '|' || ch === '(' || ch === ')') {
      endSeg(); i++; continue;
    }
    if ((ch === '{' || ch === '}') && word === null) { endSeg(); i++; continue; }
    cur().v += ch;
    i++;
  }
  endSeg();
  return segments;
}

/** Plugin variables that are empty in the Bash / PowerShell tools. */
const EMPTY_PLUGIN_VAR = /^(\$\{?(env:)?CLAUDE_PLUGIN_(ROOT|DATA)\}?|%CLAUDE_PLUGIN_(ROOT|DATA)%)(?=\/)/i;

/**
 * Classify a start path: 'root', 'home' or null (anything narrower).
 * @param {string} value
 * @returns {'root'|'home'|null}
 */
function classifyPath(value) {
  let p = String(value).trim();
  if (!p || p.includes(SUB)) return null;
  p = p.replace(/\\/g, '/');
  // `"$CLAUDE_PLUGIN_ROOT/"` is `/` in the Bash tool: the variable is unset there.
  p = p.replace(EMPTY_PLUGIN_VAR, '');
  // `C:/*`, `/c/.`, `~/` → the directory itself.
  let prev;
  do { prev = p; p = p.replace(/\/(\*|\.)$/, '/'); } while (p !== prev);
  if (p.length > 1) p = p.replace(/(.)\/+$/, '$1');
  const lower = p.toLowerCase();

  if (lower === '/' || lower === '//' || lower === '/.') return 'root';
  if (/^\/[a-z]$/.test(lower)) return 'root';                         // /c (MSYS drive)
  if (/^\/(cygdrive|mnt)(\/[a-z])?$/.test(lower)) return 'root';      // /cygdrive/c, /mnt/c
  if (/^[a-z]:$/.test(lower)) return 'root';                           // C:, C:\, C:/
  if (/^\/\/[^/]+(\/[^/]+)?$/.test(lower)) return 'root';             // \\server\share
  if (/^(\$\{?(env:)?(systemdrive|homedrive)\}?|%(systemdrive|homedrive)%)$/.test(lower)) return 'root';
  if (/^\$[\w:]+\.root$/.test(lower)) return 'root';                   // $_.Root of Get-PSDrive
  if (/^(\/[a-z]|[a-z]:|\/cygdrive\/[a-z]|\/mnt\/[a-z])?\/users$/.test(lower) || lower === '/home') return 'root';

  if (/^~[\w.-]*$/.test(lower)) return 'home';
  if (/^(\$home|\$\{home\}|\$\{?env:(userprofile|home)\}?|%userprofile%|\$userprofile|\$\{userprofile\})$/.test(lower)) {
    return 'home';
  }
  if (/^(\/[a-z]|[a-z]:|\/cygdrive\/[a-z]|\/mnt\/[a-z])?\/users\/[^/]+$/.test(lower)) return 'home';
  if (/^\/home\/[^/]+$/.test(lower)) return 'home';
  const home = homeDir();
  if (home && lower === home.toLowerCase()) return 'home';
  return null;
}

/** os.homedir() with forward slashes and no trailing slash, or ''. */
function homeDir() {
  try {
    return os.homedir().replace(/\\/g, '/').replace(/\/+$/, '');
  } catch { return ''; }
}

/** An absolute path (drive, MSYS, UNC) with `.` / `..` folded; never climbs above its root. */
function normDir(p) {
  const s = String(p).replace(/\\/g, '/');
  let prefix = '';
  let rest = s;
  const drive = /^([a-z]:)(?=\/|$)/i.exec(s);
  const unc = /^\/\/[^/]+\/[^/]+/.exec(s);
  if (drive) { prefix = drive[1]; rest = s.slice(prefix.length); }
  else if (unc) { prefix = unc[0]; rest = s.slice(prefix.length); }
  const out = [];
  for (const seg of rest.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return `${prefix}/${out.join('/')}`;
}

/** `base` + `/` + `rel` without doubling the slash after a root (`/` + `x` ≠ `//x`, a UNC share). */
function joinPath(base, rel) {
  return base.endsWith('/') ? base + rel : `${base}/${rel}`;
}

/** True for a path the shell does not resolve against the working directory. */
function isAnchored(p) {
  return /^[/~$%]/.test(p) || /^[a-z]:/i.test(p) || p.includes(SUB);
}

/** `$HOME/x`, `~/x`, `$env:USERPROFILE\x` → <home>/x; null when not home-anchored. */
function expandHome(p) {
  const m = /^(~|\$home|\$\{home\}|\$\{?env:(?:userprofile|home)\}?|%userprofile%|\$userprofile|\$\{userprofile\})(\/.*)?$/i.exec(p);
  const home = homeDir();
  return m && home ? home + (m[2] || '') : null;
}

/** Expand a variable set earlier in the same command; one path per value. */
function expandVars(p, vars) {
  const m = /^\$\{?([A-Za-z_]\w*)\}?(.*)$/.exec(p);
  if (!m || !vars.has(m[1].toLowerCase())) return [p];
  return vars.get(m[1].toLowerCase()).map(v => v + m[2]);
}

/**
 * The directory a `cd` / `Set-Location` operand leads to, given the current
 * one. undefined target = bare `cd` (home in bash and PowerShell).
 * @returns {string|null} absolute path, or null when unknown
 */
function resolveDir(base, target, shell, vars) {
  if (target === undefined) return shell === 'cmd' ? base : homeDir() || null;
  if (target === null || target === '-' || target === '+' || target.includes(SUB)) return null;
  let p = expandVars(target, vars)[0].replace(/\\/g, '/').replace(EMPTY_PLUGIN_VAR, '');
  const home = expandHome(p);
  if (home) return normDir(home);
  if (classifyPath(p) === 'home') return normDir(p.startsWith('/') || /^[a-z]:/i.test(p) ? p : homeDir());
  if (/^[/]/.test(p) || /^[a-z]:/i.test(p)) return normDir(p);
  if (/^[~$%]/.test(p)) return null;
  if (base === null) return null;
  return normDir(joinPath(base, p));
}

/** Operand of cd / pushd / Set-Location; undefined when there is none. */
function cdTarget(args, shell) {
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    const v = t.v;
    if (!t.lq && /^-(path|literalpath|lp|pspath)(:|$)/i.test(v)) {
      const c = v.indexOf(':');
      if (c !== -1) return v.slice(c + 1);
      return i + 1 < args.length ? args[i + 1].v : null;
    }
    if (!t.lq && shell === 'cmd' && /^\/{1,2}d$/i.test(v)) continue;
    if (!t.lq && v.length > 1 && v.startsWith('-')) continue;
    return v;
  }
  return undefined;
}

function num(v) {
  const m = /^\d+$/.exec(String(v));
  return m ? Number(v) : null;
}

/** Operands of a GNU-style command, skipping options and their values. */
function gnuOperands(args, valueShort, valueLong) {
  const operands = [];
  const values = {};
  let endOpts = false;
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    const v = t.v;
    if (endOpts || t.lq || !v.startsWith('-') || v === '-') { operands.push(v); continue; }
    if (v === '--') { endOpts = true; continue; }
    if (v.startsWith('--')) {
      const eq = v.indexOf('=');
      const name = eq === -1 ? v : v.slice(0, eq);
      if (eq !== -1) { values[name] = v.slice(eq + 1); continue; }
      if (valueLong.has(name) && i + 1 < args.length) { values[name] = args[++i].v; }
      else values[name] = true;
      continue;
    }
    for (let k = 1; k < v.length; k++) {
      const letter = v[k];
      if (valueShort.includes(letter)) {
        const rest = v.slice(k + 1);
        if (rest) values['-' + letter] = rest;
        else if (i + 1 < args.length) values['-' + letter] = args[++i].v;
        break;
      }
      values['-' + letter] = true;
    }
  }
  return { operands, values };
}

function findStarts(args) {
  let i = 0;
  while (i < args.length) {
    const v = args[i].v;
    if (args[i].lq) break;
    if (v === '-H' || v === '-L' || v === '-P' || /^-O\d$/.test(v)) { i++; continue; }
    if (v === '-D') { i += 2; continue; }
    break;
  }
  const paths = [];
  for (; i < args.length; i++) {
    const t = args[i];
    if (!t.lq && (/^[-(!,]/.test(t.v))) break;
    paths.push(t.v);
  }
  let depth = Infinity;
  for (let k = 0; k < args.length - 1; k++) {
    if (!args[k].lq && args[k].v === '-maxdepth') {
      const d = num(args[k + 1].v);
      if (d !== null) depth = Math.min(depth, d);
    }
  }
  return { paths: paths.length ? paths : ['.'], depth };
}

function grepStarts(args) {
  const { operands, values } = gnuOperands(
    args, 'efmABCdD',
    new Set(['--regexp', '--file', '--max-count', '--context', '--after-context', '--before-context',
      '--directories', '--devices', '--label', '--color', '--colour', '--binary-files', '--include',
      '--exclude', '--exclude-dir', '--exclude-from', '--group-separator']),
  );
  const recursive = values['-r'] || values['-R'] || values['--recursive'] || values['--dereference-recursive']
    || values['-d'] === 'recurse' || values['--directories'] === 'recurse';
  if (!recursive) return null;
  const hasPattern = values['-e'] !== undefined || values['-f'] !== undefined
    || values['--regexp'] !== undefined || values['--file'] !== undefined;
  const paths = hasPattern ? operands : operands.slice(1);
  return { paths: paths.length ? paths : ['.'], depth: Infinity };
}

function rgStarts(args) {
  const { operands, values } = gnuOperands(
    args, 'efgtTmABCdMjE',
    new Set(['--regexp', '--file', '--glob', '--iglob', '--type', '--type-not', '--max-count', '--context',
      '--after-context', '--before-context', '--max-depth', '--maxdepth', '--depth', '--max-filesize',
      '--threads', '--encoding', '--ignore-file', '--type-add', '--sort', '--sortr', '--pre', '--color',
      '--colors', '--max-columns', '--replace', '--path-separator', '--glob-case-insensitive']),
  );
  const listFiles = values['--files'] === true;
  const hasPattern = values['-e'] !== undefined || values['-f'] !== undefined
    || values['--regexp'] !== undefined || values['--file'] !== undefined;
  const paths = listFiles || hasPattern ? operands : operands.slice(1);
  const d = num(values['--max-depth'] ?? values['--maxdepth'] ?? values['--depth'] ?? values['-d']);
  return { paths: paths.length ? paths : ['.'], depth: d === null ? Infinity : d };
}

function fdStarts(args) {
  const { operands, values } = gnuOperands(
    args, 'eEtdxXSjcCo',
    new Set(['--extension', '--exclude', '--type', '--max-depth', '--min-depth', '--exact-depth', '--exec',
      '--exec-batch', '--size', '--changed-within', '--changed-before', '--owner', '--threads',
      '--search-path', '--base-directory', '--color', '--max-results', '--ignore-file', '--format']),
  );
  const paths = operands.slice(1);
  for (const key of ['--search-path', '--base-directory']) {
    if (typeof values[key] === 'string') paths.push(values[key]);
  }
  const d = num(values['--max-depth'] ?? values['-d'] ?? values['--exact-depth']);
  return { paths: paths.length ? paths : ['.'], depth: d === null ? Infinity : d };
}

function lsStarts(args) {
  const { operands, values } = gnuOperands(args, 'ITw', new Set(['--ignore', '--hide', '--width', '--tabsize',
    '--format', '--sort', '--time', '--time-style', '--color', '--block-size', '--quoting-style', '--indicator-style']));
  if (!values['-R'] && !values['--recursive']) return null;
  return { paths: operands.length ? operands : ['.'], depth: Infinity };
}

function duStarts(args) {
  const { operands } = gnuOperands(args, 'dBtX', new Set(['--max-depth', '--block-size', '--threshold',
    '--exclude', '--exclude-from', '--time', '--time-style', '--files0-from']));
  // du walks the whole tree even with --max-depth (that only trims output).
  return { paths: operands.length ? operands : ['.'], depth: Infinity };
}

/** Windows cmd-style switch: `/f`, `/A`, `//s` (Git Bash escaping), `/lev:2`. */
const CMD_SWITCH = /^\/{1,2}([a-z?]+)(:\S*)?$/i;

/**
 * GNU tree, or Windows tree.com (`tree [path] [/f] [/a]`, the one PowerShell
 * and cmd resolve). tree.com's `/f` is a switch, not the MSYS drive root F:.
 */
function treeStarts(args, windows) {
  if (windows) {
    const paths = args.filter(t => !/^\/{1,2}[a-z?]$/i.test(t.v)).map(t => t.v);
    return { paths: paths.length ? paths : ['.'], depth: Infinity };
  }
  const { operands, values } = gnuOperands(args, 'LIPoHT', new Set(['--filelimit', '--timefmt', '--sort',
    '--charset', '--fromfile', '--gitfile', '--hintro', '--houtro']));
  const d = num(values['-L']);
  return { paths: operands.length ? operands : ['.'], depth: d === null ? Infinity : d };
}

/** `robocopy <src> <dst> [files] /S|/E|/MIR [/LEV:n]` walks <src>. */
function robocopyStarts(args) {
  let recursive = false;
  let depth = Infinity;
  const operands = [];
  for (const t of args) {
    const m = CMD_SWITCH.exec(t.v);
    if (!m) { operands.push(t.v); continue; }
    const name = m[1].toLowerCase();
    if (name === 's' || name === 'e' || name === 'mir') recursive = true;
    if (name === 'lev' && m[2]) { const d = num(m[2].slice(1)); if (d !== null) depth = d; }
  }
  if (!recursive || !operands.length) return null;
  return { paths: [operands[0]], depth };
}

const WILDCARD_LEAF = /[\\/][^\\/]*[*?][^\\/]*$/;
const FILE_OR_WILDCARD_LEAF = /[\\/](?:[^\\/]*[*?][^\\/]*|[^\\/]+\.[A-Za-z0-9]{1,5})$/;

/*
 * `leaf`: a recursive Windows listing whose path ends in a name pattern
 * (`C:\*.md`, `C:\ui-defaults.md` under `dir /s`) walks the parent
 * directory, so analyze() adds that parent as a start path too.
 */

const GCI_VALUE_PARAMS = [
  'path', 'literalpath', 'lp', 'pspath', 'filter', 'include', 'exclude', 'depth', 'attributes', 'erroraction',
  'ea', 'errorvariable', 'ev', 'outvariable', 'ov', 'outbuffer', 'ob', 'warningaction', 'wa',
  'informationaction', 'infa', 'pipelinevariable', 'pv',
];

/** Get-ChildItem / gci / (PowerShell) ls / dir. */
function gciStarts(args) {
  const paths = [];
  let recurse = false;
  let depth = null;
  let positional = 0;
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (!t.lq && /^-[A-Za-z]/.test(t.v)) {
      const colon = t.v.indexOf(':');
      const name = (colon === -1 ? t.v.slice(1) : t.v.slice(1, colon)).toLowerCase();
      let value = colon === -1 ? undefined : t.v.slice(colon + 1);
      // `-s` is a built-in alias of -Recurse (cmd's `dir /s` habit).
      if (name === 's' || 'recurse'.startsWith(name)) {
        if (value === undefined || !/^\$?false$/i.test(value)) recurse = true;
        continue;
      }
      const param = GCI_VALUE_PARAMS.find(p => p === name) || (name.length >= 2 ? GCI_VALUE_PARAMS.find(p => p.startsWith(name)) : null);
      if (!param) continue; // a switch (-Force, -File, -Directory, -Name …)
      if (value === undefined && i + 1 < args.length) value = args[++i].v;
      if (value === undefined) continue;
      if (param === 'depth') { depth = num(value); recurse = true; }
      else if (param === 'path' || param === 'literalpath' || param === 'lp' || param === 'pspath') {
        paths.push(...String(value).split(','));
      }
      continue;
    }
    if (positional === 0) paths.push(...t.v.split(','));
    positional++;
  }
  if (!recurse) return null;
  // -Depth 0 lists the directory itself: one level, find's -maxdepth 1.
  return { paths: paths.length ? paths : ['.'], depth: depth === null ? Infinity : depth + 1, leaf: WILDCARD_LEAF };
}

/** cmd.exe `dir /s <path>`. */
function cmdDirStarts(args) {
  if (!args.some(t => /^\/{1,2}s$/i.test(t.v))) return null;
  const paths = args.filter(t => !/^\/{1,2}[a-z]/i.test(t.v)).map(t => t.v);
  // `dir /s C:\ui-defaults.md` searches all of C:\ for that name.
  return { paths: paths.length ? paths : ['.'], depth: Infinity, leaf: FILE_OR_WILDCARD_LEAF };
}

/** `where /r <dir> <pattern>` (where.exe). */
function whereStarts(args) {
  const k = args.findIndex(t => /^\/{1,2}r$/i.test(t.v));
  if (k === -1 || k + 1 >= args.length) return null;
  return { paths: [args[k + 1].v], depth: Infinity };
}

/**
 * Resolve the command head past env assignments, shell keywords, wrappers
 * and (PowerShell) `$var =` / `$var in` prefixes.
 * @returns {{head:string, args:Array, index:number, raw:string}|null}
 */
function resolveHead(tokens, shell) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.lq && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t.v)) { i++; continue; }
    if (shell === 'powershell' && !t.lq) {
      // `$f = Get-ChildItem …`, `[string[]]$f += …`, `foreach ($f in Get-ChildItem …)`
      const next = tokens[i + 1];
      if (/^(?:\[[\w.[\]]*\])?\$[\w:]+$/.test(t.v) && next && !next.lq && /^([+\-*/%]|\?\?)?=$|^in$/i.test(next.v)) {
        i += 2; continue;
      }
      const glued = /^(?:\[[\w.[\]]*\])?\$[\w:]+(?:[+\-*/%]|\?\?)?=(.+)$/.exec(t.v);
      if (glued) {
        const rest = { v: glued[1], q: t.q, lq: false };
        return resolveHead([rest, ...tokens.slice(i + 1)], shell);
      }
    }
    const base = baseName(t.v);
    if (!t.lq && KEYWORDS.has(base)) { i++; continue; }
    if (WRAPPERS.has(base)) {
      i++;
      while (i < tokens.length && !tokens[i].lq
        && (/^-/.test(tokens[i].v) || /^\d+(\.\d+)?[smhd]?$/.test(tokens[i].v) || /^[A-Za-z_]\w*=/.test(tokens[i].v))) i++;
      continue;
    }
    return { head: base, args: tokens.slice(i + 1), index: i, raw: t.v };
  }
  return null;
}

/** Start paths + depth for one resolved command, or null if it does not walk. */
function walkerStarts(head, args, shell, rawHead) {
  if (head === 'find') {
    // Outside bash a bare `find` may be Windows find.exe, a text search:
    // `find /i "text" file.txt` — its `/i` switch is not a start path.
    if (shell !== 'bash' && !/[\\/]/.test(rawHead) && args.length
      && (args[0].q || /^\/[a-z]$/i.test(args[0].v))) return null;
    return findStarts(args);
  }
  if (GREP_HEADS.has(head)) return grepStarts(args);
  if (RG_HEADS.has(head)) return rgStarts(args);
  if (FD_HEADS.has(head)) return fdStarts(args);
  if (head === 'du') return duStarts(args);
  if (head === 'tree') return treeStarts(args, shell !== 'bash' || /\.com$/i.test(rawHead));
  if (head === 'where') return whereStarts(args);
  if (head === 'robocopy') return robocopyStarts(args);
  if (GCI_HEADS.has(head)) return gciStarts(args);
  if (head === 'ls' || head === 'dir') {
    if (shell === 'powershell') return gciStarts(args);
    if (shell === 'cmd' && head === 'dir') return cmdDirStarts(args);
    return lsStarts(args);
  }
  return null;
}

/** `[IO.Directory]::GetFiles('C:\', '*', 'AllDirectories')` and its siblings. */
const DOTNET_WALK = /\[(?:System\.)?IO\.Directory\]::(?:Get|Enumerate)(?:Files|Directories|FileSystemEntries)\s*\(\s*(?:'([^']*)'|"([^"]*)"|([^,\s)]+))([^)]*)\)/gi;

/** Record `NAME=value`, `for NAME in …`, `$name = value`, `$name in a,b`. */
function recordVars(tokens, shell, vars) {
  if (shell === 'bash') {
    if (tokens[0].v === 'for' && tokens.length > 2 && tokens[2].v === 'in' && /^[A-Za-z_]\w*$/.test(tokens[1].v)) {
      vars.set(tokens[1].v.toLowerCase(), tokens.slice(3).map(t => t.v));
      return;
    }
    if (tokens.every(t => !t.lq && /^[A-Za-z_]\w*=/.test(t.v))) {
      for (const t of tokens) {
        const eq = t.v.indexOf('=');
        vars.set(t.v.slice(0, eq).toLowerCase(), [t.v.slice(eq + 1)]);
      }
    }
    return;
  }
  if (shell === 'powershell' && tokens.length >= 3 && /^\$\w+$/.test(tokens[0].v)
    && (tokens[1].v === '=' || /^in$/i.test(tokens[1].v))) {
    const rhs = tokens.slice(2);
    // Only literal values: `$d = 'C:\'`, `foreach ($d in 'C:\', 'D:\')`.
    if (rhs.some(t => /^[A-Za-z][\w-]*-[A-Za-z]/.test(t.v) && !t.lq)) return;
    const values = rhs.map(t => t.v).join('').split(',').filter(Boolean);
    if (values.length) vars.set(tokens[0].v.slice(1).toLowerCase(), values);
  }
}

function newCtx(cwd, vars) {
  return { cwd, stack: [], vars: new Map(vars || []) };
}

function analyze(cmd, shell, nesting, out, ctx) {
  if (nesting > MAX_NESTING || typeof cmd !== 'string' || !cmd.trim()) return;
  const subs = [];
  const bodies = [];
  const entry = newCtx(ctx.cwd, ctx.vars);
  const prepared = prepare(cmd, shell, bodies);
  const segments = tokenize(prepared, shell, subs);

  const resolve = (p) => {
    const norm = p.replace(/\\/g, '/');
    return !isAnchored(norm) && ctx.cwd !== null ? normDir(joinPath(ctx.cwd, norm)) : p;
  };
  const report = (head, rawPaths, depth, leaf) => {
    for (const p of rawPaths) {
      for (const expanded of expandVars(p, ctx.vars)) {
        // The name-pattern parent is taken from the path as written, so a
        // dotted directory name in the cwd is never mistaken for a pattern.
        const raws = [expanded];
        if (leaf) {
          const slashed = /[\\/]/.test(expanded);
          if (leaf.test(slashed ? expanded : `/${expanded}`)) {
            raws.push(slashed ? expanded.replace(/[\\/][^\\/]*$/, '/') : '.');
          }
        }
        for (const c of raws.map(resolve)) {
          const kind = classifyPath(c);
          if (!kind || depth <= MAX_ALLOWED_DEPTH[kind]) continue;
          const crawl = { head, path: p, kind, depth };
          if (c !== p) crawl.resolved = c;
          out.push(crawl);
          break;
        }
      }
    }
  };

  for (const tokens of segments) {
    recordVars(tokens, shell, ctx.vars);
    const resolved = resolveHead(tokens, shell);
    if (!resolved) continue;
    const { head, args, raw } = resolved;

    if (CD_HEADS.has(head)) {
      if (head === 'pushd' || head === 'push-location') ctx.stack.push(ctx.cwd);
      ctx.cwd = resolveDir(ctx.cwd, cdTarget(args, shell), shell, ctx.vars);
      continue;
    }
    if (POP_HEADS.has(head)) {
      ctx.cwd = ctx.stack.length ? ctx.stack.pop() : null;
      continue;
    }

    // Nested shells: the body string is a command in its own right.
    if (POSIX_SHELLS.has(head)) {
      const k = args.findIndex(t => !t.lq && /^-[a-z]*c$/.test(t.v));
      if (k !== -1 && k + 1 < args.length) analyze(args[k + 1].v, 'bash', nesting + 1, out, newCtx(ctx.cwd, ctx.vars));
      continue;
    }
    if (PS_SHELLS.has(head)) {
      const k = args.findIndex(t => !t.lq && /^-(c|command)$/i.test(t.v));
      if (k !== -1 && k + 1 < args.length) {
        analyze(args.slice(k + 1).map(t => t.v).join(' '), 'powershell', nesting + 1, out, newCtx(ctx.cwd, ctx.vars));
      }
      continue;
    }
    if (head === 'cmd') {
      const k = args.findIndex(t => /^\/{1,2}[ck]$/i.test(t.v));
      if (k !== -1 && k + 1 < args.length) {
        analyze(args.slice(k + 1).map(t => t.v).join(' '), 'cmd', nesting + 1, out, newCtx(ctx.cwd, ctx.vars));
      }
      continue;
    }

    const starts = walkerStarts(head, args, shell, raw);
    if (starts) report(head, starts.paths, starts.depth, starts.leaf);
  }

  if (shell === 'powershell') {
    for (const m of prepared.matchAll(DOTNET_WALK)) {
      if (!/AllDirectories/i.test(m[4])) continue;
      report('[IO.Directory]', [m[1] ?? m[2] ?? m[3]], Infinity);
    }
  }
  for (const b of bodies) analyze(b.text, b.shell, nesting + 1, out, newCtx(ctx.cwd, ctx.vars));
  for (const body of subs) analyze(body, shell, nesting + 1, out, entry);
}

/** An absolute working directory (forward slashes), or null. */
function startDir(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return null;
  const s = cwd.trim().replace(/\\/g, '/');
  if (!/^([a-z]:)?\//i.test(s)) return null;
  return normDir(s);
}

/**
 * Every root / home crawl in a command.
 * @param {string} cmd
 * @param {{shell?: 'bash'|'powershell', cwd?: string}} [opts] cwd: the
 *   directory the command starts in (the hook's `cwd`); relative start paths
 *   are resolved against it.
 * @returns {Array<{head:string, path:string, resolved?:string, kind:'root'|'home', depth:number}>}
 */
function findRootCrawls(cmd, opts = {}) {
  const shell = opts.shell === 'powershell' ? 'powershell' : 'bash';
  const out = [];
  try { analyze(cmd, shell, 0, out, newCtx(startDir(opts.cwd))); } catch { return []; }
  return out;
}

/**
 * Inline bypass: `DEVOPS_ALLOW_ROOT_CRAWL=1 find / …` (bash) or
 * `$env:DEVOPS_ALLOW_ROOT_CRAWL=1; …` (PowerShell). The hook process never
 * sees a per-command env prefix, so it is read from the command text.
 */
function hasBypass(cmd) {
  return /(?:^|[\s;&|(:])DEVOPS_ALLOW_ROOT_CRAWL\s*=\s*["']?1\b/.test(String(cmd || ''));
}

module.exports = { findRootCrawls, hasBypass, classifyPath, tokenize, prepare, MAX_ALLOWED_DEPTH };
