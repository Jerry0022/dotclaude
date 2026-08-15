/**
 * @module bash-context-cost
 * @version 0.2.0
 * @plugin devops
 * @description Decide which large-file references inside a Bash command
 *   actually cost Claude context. Used by pre.tokens.guard to stop blocking
 *   commands that merely PASS a big file's path as an argument (server start,
 *   `ls`, `mv`, `echo`) while still blocking commands that READ the file into
 *   context (`cat`, `grep`, `jq`, `python -c`).
 *
 *   Three verdicts, and the difference between two of them carries the whole
 *   safety argument:
 *   - `reader`  — content demonstrably flows out, OR the segment could not be
 *                 reasoned about (assignments only, an unparsable tail, a
 *                 stdout sink). ALWAYS costly.
 *   - `passer`  — positively recognised as content-free.
 *   - `unknown` — a command whose behaviour cannot be reasoned about at all:
 *                 an unrecognised binary, or a recognised interpreter running
 *                 a SCRIPT. Costly, EXCEPT under `run_in_background: true`.
 *
 *   That background exemption is the single deliberate hole, and it rests on
 *   something narrower than "detached output never reaches context" — Claude
 *   can pull a background buffer with BashOutput. What it actually rests on:
 *   every recognised content emitter — including a known multiplexer in a
 *   non-allowlisted mode (`git diff`, `gh api`, `npm exec`) — is classified
 *   `reader` and stays blocked regardless of backgrounding. So the residual
 *   exposure is exactly the `unknown` set above: something we cannot reason
 *   about that dumps a large file AND is then deliberately read back. That is
 *   accepted; blocking every detached server start is the worse trade
 *   (issue #277). Fail-safe verdicts must never route through `unknown`.
 *
 *   Design rule — fail safe. Anything not positively recognised as
 *   content-free is treated as context-reading, so the guard is never weaker
 *   than the plain substring match it replaces. That includes an unrecognised
 *   command head, a segment that is only variable assignments, and the tail of
 *   a command too pathological to parse.
 *
 *   Known limits (deliberate, documented rather than half-fixed):
 *   - Path matching is still a substring test, so `cd docs && cat big.html`
 *     evades it. Splitting the path across `cd` boundaries is out of scope.
 *   - A trailing shell `&` is not treated as backgrounding: `cat f &` still
 *     inherits stdout, so it is genuinely NOT free. Use the tool's
 *     `run_in_background` flag, which is the signal this module honours.
 *   - stdout redirection (`> out.txt`) is not credited as free. Detecting it
 *     without quote-aware parsing of every `>` would be an evasion vector
 *     (`grep "a>b" big.html`), and the gain does not justify that risk.
 *   - An unterminated apostrophe outside double quotes (`echo don't $(cat f)`)
 *     swallows the rest of the line. That command is invalid shell and never
 *     runs, so nothing reaches context.
 */

// Segments too pathological to parse get this synthetic head. It is in
// READER_HEADS so an unparsed tail is always costly — never silently dropped.
const OVERFLOW_HEAD = '__unparsed__';

// Commands whose stdout contains file CONTENT.
const READER_HEADS = new Set([
  OVERFLOW_HEAD,
  'cat', 'bat', 'tac', 'head', 'tail', 'less', 'more', 'nl', 'fold',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'select-string', 'sls',
  'jq', 'yq', 'xmllint', 'awk', 'gawk', 'mawk', 'sed', 'cut', 'paste',
  'sort', 'uniq', 'tr', 'column', 'diff', 'comm', 'join',
  'strings', 'od', 'xxd', 'hexdump', 'base64', 'zcat', 'gunzip',
  'type', 'get-content', 'gc', 'import-csv', 'convertfrom-json',
]);

// Commands that only ever take a path as an operand — their output never
// contains the file's contents.
const PASSER_HEADS = new Set([
  'ls', 'dir', 'stat', 'file', 'du', 'basename', 'dirname', 'realpath',
  'readlink', 'pwd', 'cd', 'pushd', 'popd',
  'touch', 'mkdir', 'rmdir', 'rm', 'del', 'erase', 'cp', 'copy', 'mv',
  'move', 'ren', 'rename', 'ln', 'mklink', 'chmod', 'chown', 'attrib',
  'echo', 'true', 'false', 'which', 'where', 'test', 'sleep',
  'start', 'explorer', 'open', 'cygpath', 'kill', 'taskkill',
]);

// Wrappers: the real command head is the next token.
const WRAPPER_HEADS = new Set([
  'sudo', 'nohup', 'command', 'builtin', 'exec', 'env', 'time', 'nice',
  'stdbuf', 'timeout', 'winpty', 'xargs', 'setsid',
]);

// Interpreters and shells: safe when running a SCRIPT, context-reading when
// handed inline code, which can print a file to stdout.
const INTERPRETER_HEADS = new Set([
  'python', 'python3', 'py', 'node', 'deno', 'bun', 'perl', 'ruby', 'php',
  'bash', 'sh', 'zsh', 'ksh', 'dash', 'pwsh', 'powershell', 'cmd',
]);
const INLINE_CODE_FLAG = /^(-c|-e|-w|--eval|--command|-command|-encodedcommand|\/c|\/k)$/i;

// Writing a file to a stdout-equivalent sink defeats any head-based reasoning
// (`cp big.html /dev/stdout`), so a segment naming one is always a reader.
// stderr counts too — the Bash tool captures it into the same result.
const STDOUT_SINK = /(^|[\s=("'>])(\/dev\/(stdout|stderr|fd\/[12])|\/proc\/self\/fd\/[12])(["')\s]|$)/i;

// git subcommands that emit no file content — provided patch mode is off.
// `git show|diff|log|blame|cat-file` are deliberately absent.
const GIT_SAFE_SUB = /^(push|fetch|remote|prune|worktree|branch|checkout|switch|pull|merge|rebase|tag|stash|rm|add|commit|status|init|clone|config|reset|restore|mv)$/;
const GIT_PATCH_FLAG = /^(-p|--patch)$/;

// gh is allowlisted at VERB granularity: the nouns alone are far too broad
// (`gh pr diff`, `gh run view --log`, `gh release view`, `gh repo view` and
// `gh api .../contents/<path>` all emit content). `gh api` is never safe.
const GH_SAFE_SUB = {
  pr: /^(create|comment|merge|close|reopen|edit|ready|checkout|lock|unlock)$/,
  issue: /^(create|comment|close|reopen|edit|pin|unpin|transfer|lock|unlock|develop)$/,
  release: /^(create|upload|delete|edit)$/,
  repo: /^(create|clone|fork|rename|delete|archive|unarchive|sync|set-default)$/,
  run: /^(rerun|cancel|delete)$/,
  auth: /^(status|login|logout|refresh|setup-git)$/,
  label: /^(create|delete|edit|clone)$/,
  workflow: /^(enable|disable|run)$/,
  project: /^(create|edit|close|copy|link|unlink|item-add|item-edit|item-archive|item-delete)$/,
};

/** Strip a leading directory and a trailing `.exe`, then lowercase. */
function baseName(token) {
  const bare = String(token).replace(/^["']|["']$/g, '');
  const tail = bare.split(/[\\/]/).pop() || '';
  return tail.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/**
 * Index of the `)` closing the `(` at `open`, skipping quoted spans so a
 * literal paren inside quotes (`grep ')' f`) cannot end the body early.
 * Returns -1 when unbalanced.
 */
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
 * Pull every command-substitution body out of `text`, quote-aware. The bodies
 * become segments in their own right so `echo "$(cat big.json)"` is still
 * recognised as a read even though its outer head (`echo`) is a passer.
 * Returns the text with each substitution replaced by a space.
 */
function extractSubstitutions(text, sink) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && quote !== "'") {
      out += ch;
      if (i + 1 < text.length) out += text[++i];
      continue;
    }
    if (quote === "'") {           // single quotes suppress expansion entirely
      if (ch === "'") quote = null;
      out += ch;
      continue;
    }
    if (ch === '$' && text[i + 1] === '(') {
      const close = matchingParen(text, i + 1);
      const end = close === -1 ? text.length : close;
      sink.push(text.slice(i + 2, end));
      out += ' ';
      i = end;
      continue;
    }
    if (ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== '`') { if (text[j] === '\\') j++; j++; }
      sink.push(text.slice(i + 1, Math.min(j, text.length)));
      out += ' ';
      i = j;
      continue;
    }
    if (ch === '"') { quote = quote === '"' ? null : '"'; out += ch; continue; }
    // An apostrophe INSIDE double quotes is literal — opening single-quote
    // state here would swallow every later `$(...)` in the string, e.g.
    // `gh pr create --title "Claude's fix" --body "$(cat big.html)"`.
    if (ch === "'" && quote === null) { quote = "'"; out += ch; continue; }
    out += ch;
  }
  return out;
}

const SPLIT_RE = /\s*(?:&&|\|\||[|;&\n])\s*/;
const MAX_PASSES = 2000;
// Second bound, on work rather than iterations: this hook runs before every
// Bash call, so a pathological command must not cost more than a fixed budget.
const MAX_CHARS = 200_000;

/** Split a command into individually classifiable segments. */
function segmentize(command) {
  const pending = [String(command || '')];
  const segments = [];
  let passes = 0;
  let chars = 0;
  while (pending.length) {
    if (passes++ >= MAX_PASSES || chars >= MAX_CHARS) {
      // Never silently drop the tail — keep it, forced costly.
      for (const rest of pending) {
        if (rest.trim()) segments.push(`${OVERFLOW_HEAD} ${rest.trim()}`);
      }
      break;
    }
    const next = pending.shift();
    chars += next.length;
    const nested = [];
    const flat = extractSubstitutions(next, nested);
    for (const part of flat.split(SPLIT_RE)) {
      if (part.trim()) segments.push(part.trim());
    }
    pending.push(...nested);
  }
  return segments;
}

/** Resolve a segment's effective command head, skipping env vars and wrappers. */
function commandHead(segment) {
  const tokens = segment.split(/\s+/).filter(Boolean);
  let strippedAssignment = false;
  let strippedWrapper = false;
  let consumedWrapperFlag = false;
  while (tokens.length) {
    const head = tokens[0];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {   // VAR=value prefixes
      tokens.shift();
      strippedAssignment = true;
      continue;
    }
    if (WRAPPER_HEADS.has(baseName(head))) {
      tokens.shift();
      strippedWrapper = true;
      // Skip the wrapper's own flags AND their numeric values, plus bare
      // durations/limits (`timeout -k 2 30 cat f`, `nice -n 10 cat f`).
      while (tokens.length && (/^-/.test(tokens[0]) || /^\d+(\.\d+)?[smhd]?$/i.test(tokens[0]))) {
        // A FLAG may have taken the real command as its value
        // (`sudo -u root cat f` leaves `root` as the head). A bare number is
        // just a duration and derails nothing, so it must not poison the
        // verdict for `timeout 3600 ./server`.
        if (tokens[0].startsWith('-')) consumedWrapperFlag = true;
        tokens.shift();
      }
      continue;
    }
    break;
  }
  return {
    head: tokens.length ? baseName(tokens[0]) : '',
    args: tokens.slice(1),
    strippedAssignment,
    strippedWrapper,
    consumedWrapperFlag,
  };
}

/** First non-flag argument — a command's subcommand, when it has one. */
function subCommand(args) {
  return (args.find(a => !a.startsWith('-')) || '').toLowerCase();
}

// git global flags that take a SEPARATE value, so the next token is not the
// subcommand: `git -C dir status`, `git -c user.name=x commit`.
const GIT_GLOBAL_WITH_VALUE = /^(-C|-c|--git-dir|--work-tree|--exec-path|--namespace|--super-prefix)$/;

/** git's subcommand, skipping global flags and the values they consume. */
function gitSubCommand(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (GIT_GLOBAL_WITH_VALUE.test(a)) { i++; continue; }   // flag + its value
    if (a.startsWith('-')) continue;
    return a.toLowerCase();
  }
  return '';
}

/**
 * gh accepts global flags before the noun (`gh --repo o/r pr create`), so the
 * noun cannot be "first non-flag token". Scan for the first token that IS a
 * known noun instead; the next non-flag token after it is the verb.
 */
function ghNounVerb(args) {
  const idx = args.findIndex(a =>
    Object.prototype.hasOwnProperty.call(GH_SAFE_SUB, a.toLowerCase()));
  if (idx === -1) return { noun: '', verb: '' };
  return { noun: args[idx].toLowerCase(), verb: subCommand(args.slice(idx + 1)) };
}

/**
 * Classify one segment.
 *
 * `reader` is not only "this command prints file contents" — it is also the
 * verdict for anything we could not reason about, because `unknown` carries
 * the `run_in_background` exemption and a fail-safe path must never be
 * defeatable by backgrounding the command.
 *
 * @returns {'reader'|'passer'|'unknown'}
 */
function classifySegment(segment) {
  const kind = baseClassify(segment);
  // Monotone upgrade: naming a stdout/stderr sink defeats any head-based
  // reasoning (`cp big.html /dev/stdout`), so it can only make a segment
  // costlier, never cheaper.
  if (kind !== 'reader' && STDOUT_SINK.test(segment)) return 'reader';
  return kind;
}

function baseClassify(segment) {
  const { head, args, strippedAssignment, strippedWrapper, consumedWrapperFlag } = commandHead(segment);
  // A segment that is nothing but assignments (`FILE=big.html`) hands the path
  // to a later segment via `$FILE`, which this module cannot follow. Costly,
  // and deliberately `reader` so backgrounding cannot free it. Same for a
  // wrapper whose real command never materialised.
  if (!head) return (strippedAssignment || strippedWrapper) ? 'reader' : 'passer';
  if (READER_HEADS.has(head)) return 'reader';
  if (INTERPRETER_HEADS.has(head)) {
    return args.some(a => INLINE_CODE_FLAG.test(a)) ? 'reader' : 'unknown';
  }
  // git and gh are tools we KNOW can print file contents — that is why their
  // subcommands are allowlisted at all. A form outside the allowlist is a
  // recognised emitter in an unrecognised mode, so it is `reader`, not
  // `unknown`: `git diff`, `git show`, `git add -p` and
  // `gh api …/contents/<path>` must not become free by backgrounding them.
  if (head === 'git') {
    // Args are whitespace-split, so a `-p` inside a commit message counts too
    // (`git commit -m "add -p support"`). Over-blocks only, and only when the
    // same command also carries an expensive path — accepted.
    if (args.some(a => GIT_PATCH_FLAG.test(a))) return 'reader';   // `git add -p`, `git stash show -p`
    return GIT_SAFE_SUB.test(gitSubCommand(args)) ? 'passer' : 'reader';
  }
  if (head === 'gh') {
    const { noun, verb } = ghNounVerb(args);
    return noun && GH_SAFE_SUB[noun].test(verb) ? 'passer' : 'reader';
  }
  // Package managers are multiplexers that can run arbitrary code
  // (`npm exec -- cat f`, `npm run <script>`), so they get the same treatment
  // as git/gh: allowlisted form or `reader`, never `unknown`.
  if (head === 'npm' || head === 'pnpm' || head === 'yarn') {
    return subCommand(args) === 'publish' ? 'passer' : 'reader';
  }
  if (PASSER_HEADS.has(head)) return 'passer';
  // A head we could not resolve because a wrapper FLAG took a separate value
  // (`sudo -u root cat f` resolves to `root`) is a parse failure, not an
  // unrecognised command — it must not inherit the background exemption. A
  // wrapper stripped cleanly onto an unrecognised binary
  // (`nohup ./server --html big.html`) is a genuine unknown and keeps it.
  return consumedWrapperFlag ? 'reader' : 'unknown';
}

/**
 * True when no segment of the command can pull anything into context.
 * Deliberately ignores `run_in_background` so verbose-output detection
 * downstream is never skipped for a backgrounded command.
 */
function isFreeOfContextCost(command) {
  const segments = segmentize(command);
  return segments.length > 0 && segments.every(s => classifySegment(s) === 'passer');
}

/** Compare paths on forward slashes so a Windows-style command still matches. */
function normalizeSlashes(text) {
  return String(text).replace(/\\/g, '/');
}

/**
 * Which of the known expensive files does this command actually read?
 *
 * @param {string} command                 the Bash command text
 * @param {Array<{path:string,estimatedTokens?:number}>} expensiveFiles
 * @param {{runInBackground?:boolean}} [opts]
 * @returns {Array<{path:string,tokens:number}>}
 */
function matchCostlyFiles(command, expensiveFiles, opts = {}) {
  const runInBackground = !!opts.runInBackground;
  const segments = segmentize(command);
  const costly = segments
    .filter(seg => {
      const kind = classifySegment(seg);
      if (kind === 'reader') return true;   // background does not save a reader
      if (kind === 'passer') return false;
      return !runInBackground;              // unknown: safe by default, free when detached
    })
    .map(normalizeSlashes);
  // A reader can consume a path that lives in another segment —
  // `echo big.html | xargs cat`, `find . -name x | cat`. Once anything reads,
  // fall back to matching the whole command, exactly as the pre-0.9 substring
  // check did. Strictly no wider than that check, so it adds no new
  // false positives relative to the behaviour it replaces.
  if (segments.some(seg => classifySegment(seg) === 'reader')) {
    costly.push(normalizeSlashes(command));
  }
  const files = Array.isArray(expensiveFiles) ? expensiveFiles : [];
  const matched = [];
  for (const ef of files) {
    if (!ef || !ef.path) continue;
    const needle = normalizeSlashes(ef.path);
    if (costly.some(seg => seg.includes(needle))) {
      matched.push({ path: ef.path, tokens: ef.estimatedTokens || 20000 });
    }
  }
  return matched;
}

module.exports = {
  baseName,
  segmentize,
  commandHead,
  classifySegment,
  isFreeOfContextCost,
  matchCostlyFiles,
};
