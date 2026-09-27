/**
 * @module bash-grep
 * @version 0.1.0
 * @plugin devops
 * @description Read a recursive `grep -r` / `rg` / `git grep` Bash command as
 *   the Grep search it is, so pre.tokens.guard's graphify answer-in-gate
 *   covers it too. Before, only the Grep tool went through the gate, and a
 *   search typed as Bash skipped the graph entirely.
 *
 *   Deliberately narrow — anything it is not sure about returns null and the
 *   command is left alone:
 *     - one command, optionally piped into `head` / `head -n N` / `wc -l`;
 *       no other pipes, `;`, `&&`, `||`, subshells, redirects other than
 *       `2>/dev/null`;
 *     - `grep` only with a recursive flag (-r / -R / --recursive, also inside
 *       a flag cluster like -rn); `rg` and `git grep` are always recursive;
 *     - one pattern (the first operand, or -e PATTERN) and at most one path.
 */

const VALUE_FLAGS = new Set([
  '-e', '--regexp', '-f', '--file', '-m', '--max-count', '-A', '-B', '-C',
  '--after-context', '--before-context', '--context', '-g', '--glob', '-t', '--type',
  '-T', '--type-not', '--include', '--exclude', '--exclude-dir', '-d', '--directories',
  '--max-depth', '--maxdepth',
]);

/** Shell-ish split honouring single and double quotes; null on anything odd. */
function words(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (quote === '"' && ch === '\\' && i + 1 < cmd.length) { cur += cmd[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (ch === ' ' || ch === '\t') {
      if (started) { out.push(cur); cur = ''; started = false; }
      continue;
    }
    if ('`$(){}<>;&'.includes(ch)) return null;
    cur += ch;
    started = true;
  }
  if (quote) return null;
  if (started) out.push(cur);
  return out;
}

/**
 * @param {string} command
 * @returns {{ pattern: string, path: string|undefined, tool: string } | null}
 */
function parseBashGrep(command) {
  let cmd = String(command || '').trim();
  if (!cmd || cmd.length > 500) return null;
  cmd = cmd.replace(/\s+2>\s*\/dev\/null\b/g, '');
  // One allowed pipe tail.
  const pipe = cmd.split('|');
  if (pipe.length > 2) return null;
  if (pipe.length === 2 && !/^\s*(head(\s+-n\s*\d+|\s+-\d+)?|wc\s+-l)\s*$/.test(pipe[1])) return null;
  const w = words(pipe[0]);
  if (!w || w.length < 2) return null;

  let i = 0;
  let tool;
  if (w[0] === 'git' && w[1] === 'grep') { tool = 'git grep'; i = 2; }
  else if (w[0] === 'rg') { tool = 'rg'; i = 1; }
  else if (w[0] === 'grep' || w[0] === 'egrep') { tool = 'grep'; i = 1; }
  else return null;

  let recursive = tool !== 'grep';
  let pattern;
  const operands = [];
  for (; i < w.length; i++) {
    const a = w[i];
    if (a === '--') { operands.push(...w.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      if (a === '--recursive' || a === '--dereference-recursive') recursive = true;
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(0, eq) : a;
      if ((name === '--regexp') && eq > 0) pattern = a.slice(eq + 1);
      else if (name === '--regexp') pattern = w[++i];
      else if (eq < 0 && VALUE_FLAGS.has(name)) i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (a === '-e') { pattern = w[++i]; continue; }
      if (VALUE_FLAGS.has(a)) { i++; continue; }
      if (/^-[a-zA-Z]+$/.test(a) && /[rR]/.test(a)) recursive = true;
      continue;
    }
    operands.push(a);
  }
  if (!recursive) return null;
  if (pattern === undefined) pattern = operands.shift();
  if (typeof pattern !== 'string' || !pattern) return null;
  if (operands.length > 1) return null;
  return { pattern, path: operands[0], tool };
}

module.exports = { parseBashGrep, words };
