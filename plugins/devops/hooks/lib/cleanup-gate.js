'use strict';
/**
 * @module cleanup-gate
 * @version 0.1.0
 * @plugin devops
 * @description The /auto-cleanup deletion gate: no branch or worktree is
 *   deleted without an ANSWERED Dry-Run-Confirm, and a branch whose content
 *   has not landed in the default branch needs its own per-branch yes.
 *
 *   Measured 2026-10-08 (evals/skills/auto-cleanup/manifest-before-delete):
 *   under `claude -p` the skill judged the page "overkill" for two branches,
 *   ran `git branch -d feat/merged` before asking anything, and asked only
 *   after the delete was refused — in one run per variant it also tried
 *   `git branch -D feat/unmerged`. Prose alone did not hold, so the rule is a
 *   hook:
 *
 *     - post.cleanup.gate ARMS the gate when the auto-cleanup skill loads
 *       (a fresh arm drops every earlier confirmation) and RECORDS each
 *       answered AskUserQuestion whose header names a gate question
 *       (`Dry-Run…` = the manifest confirm, `Unmerged…` = one branch).
 *     - pre.cleanup.gate refuses every Bash/PowerShell delete — `git branch
 *       -d/-D/--delete`, `git push --delete` / `:ref` / `--prune` / `--mirror`,
 *       `git update-ref -d refs/heads/…`, `git worktree remove`, a recursive
 *       directory delete of a worktree (`cmd /c rmdir /s /q`, `rm -rf`,
 *       `Remove-Item -Recurse` — clean tree only, #829) — whose target
 *       is not named in the last yes-answered Dry-Run question, and every
 *       not-landed branch without its own yes.
 *
 *   Only a recorded ANSWER counts. An AskUserQuestion that errors ("Answer
 *   questions?" under -p), is denied or never runs fires no PostToolUse, so
 *   nothing is recorded — no answer reads as no. A Dry-Run answer that is not
 *   a "Ja"/"Yes" option label (Abbrechen, Other, free text) revokes the earlier
 *   Dry-Run approvals. A target the parser cannot resolve to a literal name
 *   (`$b`, a glob, `xargs`) is refused: the gate cannot tell what it deletes.
 *
 *   State: `<tmpdir>/dotclaude-cleanup-gate-<session>.json`, per session,
 *   expires ARM_TTL_MS after the last arm. Outside an armed session the gate
 *   is a no-op — ordinary branch deletes are none of its business.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ARM_TTL_MS = 6 * 60 * 60_000;
const SKILL_NAME = 'auto-cleanup';
const DRY_RUN_HEADER_RE = /^\s*dry[\s-]?run/i;
const UNMERGED_HEADER_RE = /^\s*unmerged/i;
const YES_LABEL_RE = /^(ja|yes)\b/i;

// ── state ──────────────────────────────────────────────────────────────────

function statePath(sessionId, tmpRoot = os.tmpdir()) {
  const id = String(sessionId || '').replace(/[^\w.-]/g, '_').slice(0, 120);
  return id ? path.join(tmpRoot, `dotclaude-cleanup-gate-${id}.json`) : null;
}

function readState(sessionId, { tmpRoot, nowMs = Date.now() } = {}) {
  const file = statePath(sessionId, tmpRoot);
  if (!file) return null;
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!s || typeof s !== 'object' || typeof s.armedAt !== 'number') return null;
  if (nowMs - s.armedAt > ARM_TTL_MS) return null;
  if (!Array.isArray(s.dryRun)) s.dryRun = [];
  if (!Array.isArray(s.unmerged)) s.unmerged = [];
  return s;
}

function writeState(sessionId, state, { tmpRoot } = {}) {
  const file = statePath(sessionId, tmpRoot);
  if (!file) return false;
  try { fs.writeFileSync(file, JSON.stringify(state)); return true; } catch { return false; }
}

/** A fresh arm: every confirmation of an earlier run is dropped. */
function arm(sessionId, { tmpRoot, nowMs = Date.now() } = {}) {
  return writeState(sessionId, { armedAt: nowMs, dryRun: [], unmerged: [] }, { tmpRoot });
}

/** `devops:auto-cleanup` / `auto-cleanup` (any namespace) → true. */
function isCleanupSkill(name) {
  if (typeof name !== 'string') return false;
  const s = name.trim().toLowerCase();
  return s.slice(s.lastIndexOf(':') + 1) === SKILL_NAME;
}

// ── answers ────────────────────────────────────────────────────────────────

function clean(s) {
  return String(s == null ? '' : s).replace(/\s*\((?:recommended|empfohlen)\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

function optionLabels(q) {
  return Array.isArray(q && q.options)
    ? q.options.map(o => clean(typeof o === 'string' ? o : o && o.label)).filter(Boolean)
    : [];
}

/** The text a question approves: its question text plus every option text. */
function questionScope(q) {
  const parts = [q && q.question, q && q.header];
  for (const o of (Array.isArray(q && q.options) ? q.options : [])) {
    if (typeof o === 'string') parts.push(o);
    else if (o) parts.push(o.label, o.description);
  }
  return parts.filter(p => typeof p === 'string').join('\n');
}

/**
 * Yes only when the answer IS an option label that starts with Ja/Yes — a
 * free-text Other answer, an empty one or any other option is no.
 */
function isYesAnswer(q, value) {
  const labels = optionLabels(q);
  const list = Array.isArray(value) ? value : [value];
  const picked = list.map(clean).filter(Boolean);
  if (picked.length !== 1) return false;
  const hit = labels.find(l => l.toLowerCase() === picked[0].toLowerCase());
  return Boolean(hit && YES_LABEL_RE.test(hit));
}

/**
 * multiSelect answer -> the ticked option labels (exact label matches only).
 * Accepts a list or a comma-joined string; Other/free text, empty and unknown
 * entries drop out.
 */
const BARE_BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
/** A multiSelect option that can only mean one branch: a plain token, not a Ja/Yes-style answer. */
function isBareBranch(label) {
  return BARE_BRANCH_RE.test(label) && !YES_LABEL_RE.test(label) && !/^(behalten|keep|abbrechen|cancel|nein|no)$/i.test(label);
}

function pickedLabels(q, value) {
  const labels = optionLabels(q);
  const parts = [];
  for (const v of (Array.isArray(value) ? value : [value])) {
    const c = clean(v);
    if (!c) continue;
    if (labels.some(l => l.toLowerCase() === c.toLowerCase())) parts.push(c);
    else if (typeof v === 'string') parts.push(...v.split(',').map(clean).filter(Boolean));
  }
  const out = [];
  for (const p of parts) {
    const hit = labels.find(l => l.toLowerCase() === p.toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

function answerFor(q, answers) {
  if (!answers || typeof answers !== 'object') return undefined;
  if (q && typeof q.question === 'string' && Object.prototype.hasOwnProperty.call(answers, q.question)) return answers[q.question];
  if (q && typeof q.header === 'string' && Object.prototype.hasOwnProperty.call(answers, q.header)) return answers[q.header];
  return undefined;
}

/**
 * Fold one answered AskUserQuestion into the state (mutates and returns it).
 * Dry-Run: a yes adds an approval, anything else revokes all of them.
 * Unmerged: a yes adds that question's scope; a no adds nothing. A multiSelect
 * Unmerged question adds one approval per ticked option label (a branch name).
 */
function recordAnswers(state, questions, answers, nowMs = Date.now()) {
  if (!state) return state;
  for (const q of (Array.isArray(questions) ? questions : [])) {
    const header = q && typeof q.header === 'string' ? q.header : '';
    const dry = DRY_RUN_HEADER_RE.test(header);
    const unm = !dry && UNMERGED_HEADER_RE.test(header);
    if (!dry && !unm) continue;
    if (unm && q.multiSelect === true) {
      // Batch form: every option is a bare branch name; each ticked one is
      // its yes, approving exactly that name. One option that is not a bare
      // name (prose, a comma, Ja/Yes) voids the whole question.
      const opts = optionLabels(q);
      if (!opts.length || !opts.every(isBareBranch)) continue;
      for (const label of pickedLabels(q, answerFor(q, answers))) {
        state.unmerged.push({ at: nowMs, scope: label, exact: true });
      }
      continue;
    }
    const yes = isYesAnswer(q, answerFor(q, answers));
    if (dry) {
      if (yes) state.dryRun.push({ at: nowMs, scope: questionScope(q) });
      else state.dryRun = [];
    } else if (yes) {
      state.unmerged.push({ at: nowMs, scope: questionScope(q) });
    }
  }
  return state;
}

// ── command parsing ────────────────────────────────────────────────────────

/** Shell-ish split into segments (`&&`, `||`, `;`, `|`, newline) of tokens. */
function segments(command) {
  const out = [];
  let cur = [];
  let tok = '';
  let has = false;
  let quote = null;
  let pipedFrom = false;
  const pushTok = () => { if (has) cur.push(tok); tok = ''; has = false; };
  const pushSeg = (piped) => {
    pushTok();
    if (cur.length) out.push({ tokens: cur, piped: pipedFrom });
    cur = [];
    pipedFrom = piped;
  };
  const s = String(command || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) tok += s[++i];
      else tok += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\n' || c === ';') { pushSeg(false); continue; }
    if (c === '&' && s[i + 1] === '&') { i++; pushSeg(false); continue; }
    if (c === '&') { pushSeg(false); continue; } // cmd's `a & b`, bash background, PowerShell call operator
    if (c === '|' && s[i + 1] === '|') { i++; pushSeg(false); continue; }
    if (c === '|') { pushSeg(true); continue; }
    if (c === '{' || c === '}') { pushTok(); continue; }
    if (/\s/.test(c)) { pushTok(); continue; }
    if (c === '>' || c === '<') {
      // a redirection: drop it, its fd (`2>`) and its target (`> out.txt`);
      // a dup (`2>&1`) has no separate target
      if (/^\d+$/.test(tok)) { tok = ''; has = false; } else pushTok();
      let dup = false;
      while (i + 1 < s.length && /[>&\d]/.test(s[i + 1])) { if (s[i + 1] === '&') dup = true; i++; }
      if (!dup) {
        while (i + 1 < s.length && /\s/.test(s[i + 1])) i++;
        while (i + 1 < s.length && !/[\s;&|]/.test(s[i + 1])) i++;
      }
      continue;
    }
    tok += c; has = true;
  }
  pushSeg(false);
  return out;
}

const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

function stripRefsHeads(name) { return name.replace(/^refs\/heads\//, ''); }

/** A target the gate can verify: a literal name, no expansion or glob. */
function literal(t) { return typeof t === 'string' && t !== '' && !/[$`*?()[\]{}]/.test(t); }

const DELETE_CMDS = new Set(['rm', 'rmdir', 'rd', 'remove-item', 'ri', 'del', 'erase']);
const PS_PATH_PARAM_RE = /^-(literal)?path$/i;

/**
 * A directory delete — `cmd /c rmdir /s /q <p>`, `rd /s`, `rm -rf <p>`,
 * `Remove-Item -Recurse <p>` — the native fast path for removing a worktree
 * (#829). Every target counts, whatever the flags: a flag form the parser does
 * not know must not let a worktree delete through, so the recursive switch is
 * not required. Whether a target is a worktree is decided in decide().
 * @returns {{dir: null, kind: 'dir', target: string}[]|{unresolved: string}|null}
 */
function dirDeletesInTokens(t) {
  const cmd = (t[0] || '').replace(/^.*[\\/]/, '').toLowerCase().replace(/\.exe$/, '');
  if (!DELETE_CMDS.has(cmd)) return null;
  const rest = t.slice(1);
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (/^(\/[a-z])+$/i.test(a)) continue; // cmd switches, also combined (`/s/q`)
    if (a.startsWith('-')) {
      const colon = a.indexOf(':');
      const name = colon === -1 ? a : a.slice(0, colon);
      if (PS_PATH_PARAM_RE.test(name)) {
        if (colon !== -1) args.push(a.slice(colon + 1));
        else if (i + 1 < rest.length) args.push(rest[++i]);
      }
      continue;
    }
    args.push(a);
  }
  if (!args.length) {
    // `Get-Item X | Remove-Item -Recurse` — the targets arrive on the pipe
    return /^(remove-item|ri)$/.test(cmd) ? { unresolved: `${cmd} gets its targets from a pipe` } : null;
  }
  // PowerShell `-Path A,B`; `%VAR%` and `~` are expanded by the shell, not here
  const paths = args.flatMap(a => a.split(',')).filter(Boolean);
  const bad = paths.find(a => !literal(a) || /%/.test(a) || a.startsWith('~'));
  if (bad) return { unresolved: `the delete target "${bad}" is not a literal path` };
  return paths.map(a => ({ dir: null, kind: 'dir', target: a }));
}

const PREFIX_CMDS = new Set(['env', 'command', 'sudo', 'time', 'nohup', 'exec', 'builtin', 'doas', 'nice', 'timeout']);
// prefix options that take a value: `sudo -u root rm …` must not read `root` as the command
const PREFIX_VALUE_OPTS = {
  sudo: /^-[ughpCDrtUT]$/, doas: /^-[uC]$/, env: /^-[uCS]$/, time: /^-[fo]$/, exec: /^-a$/, nice: /^-n$/,
};
const SHELL_WRAP_RE = /^(cmd|bash|sh|zsh|dash|ksh|powershell|pwsh)$/i;
const RUNS_SOMETHING_RE = /^(git|cmd|bash|sh|zsh|dash|ksh|powershell|pwsh|rm|rmdir|rd|remove-item|ri|del|erase)$/i;
const PS_COMMAND_RE = /^-c(o(m(m(a(n(d)?)?)?)?)?)?$|^--command$/i;
const PS_ENCODED_RE = /^-e(n(c(o(d(e(d(c(o(m(m(a(n(d)?)?)?)?)?)?)?)?)?)?)?)?)?$|^-ec$/i;
const PS_FILE_RE = /^-f(i(l(e)?)?)?$/i;

function baseName(tok) { return (tok || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, ''); }

/**
 * The commands one segment really runs: prefixes (`env A=1`, `sudo -u x`,
 * `nohup`) dropped, and a shell wrapper (`cmd /c "…"`, `bash -lc "…"`,
 * `powershell -Command "…"`) opened into every segment of its payload. What
 * the parser cannot open — an encoded command, a script file run by
 * PowerShell, nesting deeper than four wrappers, a prefix whose options it
 * does not know in front of a command — comes back as an unresolved marker,
 * so the gate refuses it instead of passing it.
 * @returns {string[][]}
 */
function unwrap(tokens, depth = 0, piped = false) {
  const unresolvedAs = (why) => [['__unresolved__', why]];
  let t = tokens.slice();
  let prefix = null;
  while (t.length) {
    if (t[0].startsWith('(')) { // `(rm -rf X)` subshell
      t[0] = t[0].slice(1);
      const last = t.length - 1;
      if (t[last].endsWith(')')) t[last] = t[last].slice(0, -1);
      if (t[last] === '' && last > 0) t.pop();
    }
    const h = t[0].toLowerCase();
    if (t[0] === '') t = t.slice(1);
    else if (PREFIX_CMDS.has(h)) { prefix = h; t = t.slice(1); }
    else if (/^\w+=/.test(t[0])) t = t.slice(1);
    else if (prefix && t[0].startsWith('-')) {
      // `env -S "rm -rf X"` runs its value as a command line
      // also bundled (`-iS`) and any prefix of --split-string (`--sp=…`)
      if (prefix === 'env' && (/^-[^-]*S/.test(t[0]) || /^--sp(l(i(t(-(s(t(r(i(n(g)?)?)?)?)?)?)?)?)?)?(=|$)/.test(t[0]))) {
        return unresolvedAs('env -S (a split command line)');
      }
      const re = PREFIX_VALUE_OPTS[prefix];
      const takesValue = re && re.test(t[0]);
      const value = takesValue ? t[1] || '' : '';
      if (/\s/.test(value) || RUNS_SOMETHING_RE.test(baseName(value))) {
        return unresolvedAs(`a "${prefix}" option value that is a command`);
      }
      t = t.slice(takesValue ? 2 : 1);
    } else if (prefix === 'timeout' && /^\d+[smhd]?$/.test(t[0])) t = t.slice(1);
    else break;
  }
  // a prefix option the table does not know may have eaten the real command
  if (prefix && !RUNS_SOMETHING_RE.test(baseName(t[0])) && t.slice(1).some(a => RUNS_SOMETHING_RE.test(baseName(a)))) {
    return unresolvedAs(`a "${prefix}" prefix with options the gate cannot read`);
  }
  // a command word with whitespace after a prefix is a quoted command line (`nohup "rm -rf X"`)
  if (prefix && /\s/.test(t[0] || '')) return unresolvedAs(`a "${prefix}" prefix in front of a quoted command line`);
  const name = baseName(t[0]);
  if (!SHELL_WRAP_RE.test(name)) return [t];
  // a shell fed by a pipe reads its commands from stdin (`echo "rm -rf X" | bash`)
  const fromStdin = () => (piped ? unresolvedAs(`a ${name} that reads its commands from a pipe`) : [t]);
  if (depth > 3) return unresolvedAs('too deeply nested shell wrappers');
  // a payload that starts with an option (`-c -- …`, `-Command -` = stdin) is not read
  const open = (parts) => {
    const p = parts[0] === '--' ? parts.slice(1) : parts;
    if (!p.length || p[0].startsWith('-')) return unresolvedAs(`a ${name} payload the gate cannot read`);
    return segments(p.join(' ')).flatMap(s => unwrap(s.tokens, depth + 1, s.piped));
  };
  let rest = t.slice(1);
  if (/^cmd$/i.test(name)) {
    const c = rest.findIndex(a => /^\/[ckr]/i.test(a));
    if (c === -1) return fromStdin();
    const glued = rest[c].slice(2); // `/c"rmdir …"` or `/crmdir`
    return open([glued, ...rest.slice(c + 1)].filter(Boolean));
  }
  if (/^(powershell|pwsh)$/i.test(name)) {
    rest = rest.map(a => a.replace(/^\/(?=[a-z])/i, '-')); // PowerShell takes `/Command` like `-Command`
    if (rest.some(a => PS_ENCODED_RE.test(a))) return unresolvedAs('an encoded command');
    if (rest.some(a => PS_FILE_RE.test(a))) return unresolvedAs('a script file');
    const c = rest.findIndex(a => PS_COMMAND_RE.test(a));
    if (c !== -1) return open(rest.slice(c + 1));
    // no -Command: PowerShell runs the first positional argument, after options
    // the gate cannot all model (any unambiguous prefix of a value parameter)
    if (rest.some(a => !a.startsWith('-'))) return unresolvedAs('a PowerShell command without -Command');
    return fromStdin();
  }
  // POSIX shells: `-c`, also bundled (`-lc`, `-ec`); without it a script file
  // runs, or the commands come from stdin (`-s`, or no argument at all)
  const c = rest.findIndex(a => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
  if (c === -1) return fromStdin();
  return open(rest.slice(c + 1));
}

/**
 * The deletions one segment's tokens perform.
 * @returns {{dir: string|null, kind: 'branch'|'remote'|'worktree'|'dir', target: string, remote?: string}[]|{unresolved: string}|null}
 */
function deletesInTokens(tokens) {
  const native = dirDeletesInTokens(tokens);
  if (native) return native;
  let i = tokens.findIndex(t => /(^|[\\/])git(\.exe)?$/i.test(t));
  if (i === -1) return null;
  const viaXargs = tokens.slice(0, i).some(t => /(^|[\\/])xargs(\.exe)?$/i.test(t));
  let dir = null;
  i++;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    const t = tokens[i];
    const eq = t.indexOf('=');
    const name = eq === -1 ? t : t.slice(0, eq);
    if (GIT_OPTS_WITH_VALUE.has(name) && eq === -1) {
      if (name === '-C') dir = tokens[i + 1] || null;
      i += 2;
    } else i++;
  }
  const sub = tokens[i];
  // A non-literal -C dir only matters for a delete subcommand (#827); read-only
  // ones fall through to `return null` below.
  const dirBad = dir !== null && !literal(dir) ? { unresolved: `the repo path "${dir}" is not literal` } : null;
  const rest = tokens.slice(i + 1);
  const flags = rest.filter(t => t.startsWith('-'));
  const args = rest.filter(t => !t.startsWith('-'));
  const out = [];
  if (sub === 'branch') {
    const del = flags.some(f => f === '--delete' || (/^-[a-zA-Z]+$/.test(f) && /[dD]/.test(f)));
    if (!del) return null;
    if (flags.some(f => f === '--remotes' || (/^-[a-zA-Z]+$/.test(f) && f.includes('r')))) return null; // remote-tracking refs only
    for (const a of args) out.push({ dir, kind: 'branch', target: stripRefsHeads(a) });
  } else if (sub === 'push') {
    if (flags.some(f => f === '--prune' || f === '--mirror')) return { unresolved: 'git push --prune/--mirror deletes remote branches it does not name' };
    const del = flags.some(f => f === '--delete' || f === '-d');
    const [remote, ...refs] = args;
    if (del) {
      for (const r of refs) out.push({ dir, kind: 'remote', remote, target: stripRefsHeads(r) });
    } else {
      for (const r of refs) {
        const m = /^\+?:(.+)$/.exec(r);
        if (m) out.push({ dir, kind: 'remote', remote, target: stripRefsHeads(m[1]) });
      }
    }
    if (!out.length) return null;
  } else if (sub === 'update-ref') {
    if (!flags.includes('-d')) return null;
    const ref = args[0] || '';
    if (!/^refs\/heads\//.test(ref)) return ref ? null : { unresolved: 'git update-ref -d without a ref' };
    out.push({ dir, kind: 'branch', target: stripRefsHeads(ref) });
  } else if (sub === 'worktree') {
    if (args[0] !== 'remove') return null;
    for (const a of args.slice(1)) out.push({ dir, kind: 'worktree', target: a });
  } else {
    return null;
  }
  if (dirBad) return dirBad;
  if (viaXargs || !out.length) return { unresolved: `git ${sub} gets its targets from a pipe or none at all` };
  const bad = out.find(d => !literal(d.target) || (d.remote !== undefined && !literal(d.remote)));
  if (bad) return { unresolved: `"${bad.target}" is not a literal name` };
  return out;
}

/**
 * Every deletion a command performs, with the directory git runs in.
 * `cd <dir>` earlier in the same command moves it, like the shell would.
 * @returns {{deletes: object[], unresolved: string[]}}
 */
function parseDeletes(command, cwd) {
  const deletes = [];
  const unresolved = [];
  let dir = cwd;
  for (const t of segments(command).flatMap(seg => unwrap(seg.tokens, 0, seg.piped))) {
    if (t[0] === '__unresolved__') { unresolved.push(`a shell wrapper runs ${t[1]}`); continue; }
    if (/^(cd|Set-Location|sl|pushd)$/i.test(t[0]) && t[1] && !t[1].startsWith('-')) {
      if (literal(t[1])) dir = path.resolve(dir, t[1]);
      continue;
    }
    const r = deletesInTokens(t);
    if (!r) continue;
    if (r.unresolved) { unresolved.push(r.unresolved); continue; }
    for (const d of r) {
      deletes.push({ ...d, dir: d.dir ? path.resolve(dir, d.dir) : dir });
    }
  }
  return { deletes, unresolved };
}

// ── landed check ───────────────────────────────────────────────────────────

/**
 * The base a branch must have landed in: origin/HEAD, else origin/main,
 * origin/master, main, master — the first that resolves.
 */
function defaultBase(git) {
  const head = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const candidates = [head, 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master'];
  for (const c of candidates) if (c && git(['rev-parse', '--verify', '--quiet', `${c}^{commit}`])) return c;
  return null;
}

/**
 * Has this branch's content landed in the base? Ancestor (merge/fast-forward)
 * or — for a squash merge — merging it into the base would not change the
 * base's tree. Unknown (no ref, no base, git too old for merge-tree
 * --write-tree, a timeout) is NOT landed.
 * @param {(args: string[]) => string|null} git trimmed stdout, null on a non-zero exit
 */
function hasLanded(git, d, opts = {}) {
  const refs = d.kind === 'remote'
    ? [`refs/remotes/${d.remote}/${d.target}`, `refs/heads/${d.target}`]
    : [`refs/heads/${d.target}`];
  const ref = refs.find(r => git(['rev-parse', '--verify', '--quiet', `${r}^{commit}`]));
  if (!ref) return false;
  const base = defaultBase(git);
  if (!base) return false;
  if (git(['merge-base', '--is-ancestor', ref, base]) !== null) return true;
  const merged = git(['merge-tree', '--write-tree', base, ref]);
  const baseTree = git(['rev-parse', `${base}^{tree}`]);
  if (merged && baseTree && merged.split('\n')[0].trim() === baseTree) return true;
  return landedBySquashChain(git, ref, base, opts);
}

/**
 * Same classifier as ship_hygiene's landedVia "chain" / "tree"
 * (scripts/lib/chain-landed.js, scripts/lib/content-landed.js): the tip sits
 * inside a merged PR head that still holds all its changes, or its content is
 * already in the base. Needs the repo directory (`opts.cwd`); anything
 * unknown — no cwd, no merged-PR data, a git error — is NOT landed.
 */
function landedBySquashChain(git, ref, base, opts = {}) {
  try {
    if (!opts.cwd) return false;
    if (opts.deadline && Date.now() > opts.deadline) return false;
    const sha = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (!sha) return false;
    const { contentInBase } = require('../../scripts/lib/content-landed');
    if (contentInBase(opts.cwd, sha, base).landed) return true;
    const baseBranch = base.replace(/^refs\/(remotes\/[^/]+|heads)\//, '');
    // One gh call per repo + base per decide() (opts.cache), not one per delete.
    const key = `${opts.cwd}\0${baseBranch}`;
    const cache = opts.cache || new Map();
    if (!cache.has(key)) cache.set(key, (opts.mergedHeads || defaultMergedHeads)(opts.cwd, baseBranch, opts.deadline));
    const heads = cache.get(key);
    if (!heads || heads.size === 0) return false;
    return require('../../scripts/lib/chain-landed').chainLanded(sha, { cwd: opts.cwd, baseRef: base, heads, deadline: opts.deadline });
  } catch {
    return false;
  }
}

function defaultMergedHeads(cwd, baseBranch, deadline) {
  const left = deadline ? deadline - Date.now() : 10_000;
  if (left < 1000) return null;
  return require('../../scripts/lib/chain-landed').fetchMergedHeadShas(cwd, baseBranch, { timeout: Math.min(10_000, left) });
}

// The chain proof shares one budget per decide() call, well inside the hook's
// 30 s timeout: past it every remaining target counts as not landed (Unmerged yes).
const CHAIN_BUDGET_MS = 18_000;

// ── decision ───────────────────────────────────────────────────────────────

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** The branch named as a whole token — `feat/x` never matches `feat/x-2`. */
function namesBranch(scope, branch) {
  return new RegExp(`(^|[^\\w./-])${escapeRe(branch)}(?![\\w/-]|\\.[\\w])`).test(scope);
}

function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function namesWorktree(scope, target, dir) {
  const s = normPath(scope);
  const raw = normPath(target);
  if (raw && s.includes(raw)) return true;
  const abs = normPath(path.resolve(dir || '.', target));
  if (abs && s.includes(abs)) return true;
  // 10b's temp worktrees: `.claude/worktrees/cleanup-pr-<n>` for a shipped `#<n>`
  const m = /(?:^|\/)cleanup-pr-(\d+)$/.exec(raw);
  return Boolean(m && new RegExp(`#${m[1]}(?!\\d)`).test(scope));
}

const NO_ANSWER_RULE =
  'A missing, unanswered, errored or non-"Ja" confirmation means NO deletion. ' +
  'Do not retry, do not route around it (another delete form, a script, a loop).';

const HOW_TO_CONFIRM =
  'Print the Apply-Manifest, then ask the Dry-Run-Confirm with AskUserQuestion: ' +
  'header "Dry-Run", the question lists every branch / worktree by full name, ' +
  'options "Ja, ausführen" and "Abbrechen". No yes → end the run with the ' +
  '`analysis` card, the manifest listed as open.';

/**
 * The gate's verdict for one Bash/PowerShell command.
 * @param {{command: string, cwd: string, state: object|null, gitFor: (dir: string) => ((args: string[]) => string|null)}} p
 * @returns {{block: string}|null}
 */
/**
 * A recursive directory delete is the gate's business only when it hits a
 * worktree: registered in `git worktree list`, carrying a `.git` file, or under
 * `.claude/worktrees/`. Such a delete skips git's own dirty-tree refusal, so
 * the gate re-checks it: never the main checkout, never the session's own
 * directory, and a live checkout only with a clean `git status`.
 * @returns {{skip: true}|{block: string}|{ok: true}}
 */
function checkDirDelete(d, cwd, gitFor) {
  const abs = normPath(path.resolve(d.dir, d.target));
  const listed = (gitFor(d.dir)(['worktree', 'list', '--porcelain']) || '')
    .split('\n').filter(l => l.startsWith('worktree ')).map(l => normPath(l.slice(9)));
  const hasGitFile = fs.existsSync(path.join(path.resolve(d.dir, d.target), '.git'));
  const inside = (p) => p === abs || p.startsWith(`${abs}/`);
  if (listed[0] && inside(listed[0])) return { block: `${d.target} is (or holds) the main checkout.` };
  if (inside(normPath(cwd))) return { block: `${d.target} holds this session's own directory.` };
  const held = listed.filter(p => p !== abs && inside(p));
  if (held.length) return { block: `${d.target} holds worktrees (${held.join(', ')}) — remove each one by its own path.` };
  // a worktree folder itself, never a subfolder of one (`rm -rf dist` in a session worktree)
  if (!listed.includes(abs) && !hasGitFile && !/\/\.claude\/worktrees\/[^/]+$/.test(abs)) return { skip: true };
  if (hasGitFile) {
    const status = gitFor(path.resolve(d.dir, d.target))(['status', '--porcelain']);
    if (status === null) return { block: `git status of ${d.target} could not be read — its tree is unverified.` };
    if (status !== '') return { block: `${d.target} has uncommitted or untracked changes.` };
  }
  return { ok: true };
}

function decide({ command, cwd, state, gitFor, mergedHeads }) {
  if (!state) return null;
  const parsed = parseDeletes(command, cwd);
  const { unresolved } = parsed;
  if (!parsed.deletes.length && !unresolved.length) return null;
  const head = '[cleanup-gate] BLOCKED — /auto-cleanup is running in this session.';
  if (unresolved.length) {
    return { block: [head, `The gate cannot verify what this deletes: ${unresolved[0]}.`,
      'Name every branch / worktree literally, one delete per name.', NO_ANSWER_RULE].join('\n') };
  }
  const deletes = [];
  for (const d of parsed.deletes) {
    if (d.kind !== 'dir') { deletes.push(d); continue; }
    const r = checkDirDelete(d, cwd, gitFor);
    if (r.block) return { block: [head, `Directory delete refused: ${r.block}`, NO_ANSWER_RULE].join('\n') };
    if (r.ok) deletes.push(d);
  }
  if (!deletes.length) return null;
  const dryScopes = state.dryRun.map(a => a.scope);
  const missing = deletes.filter(d => !dryScopes.some(s => d.kind === 'worktree' || d.kind === 'dir'
    ? namesWorktree(s, d.target, d.dir)
    : namesBranch(s, d.target)));
  if (missing.length) {
    const names = [...new Set(missing.map(d => d.target))].join(', ');
    const why = dryScopes.length
      ? `the confirmed Dry-Run does not name ${names}.`
      : `no Dry-Run-Confirm was answered "Ja" for ${names}.`;
    return { block: [head, `Delete refused: ${why}`, NO_ANSWER_RULE, HOW_TO_CONFIRM].join('\n') };
  }
  const headCache = new Map();
  const deadline = Date.now() + CHAIN_BUDGET_MS;
  const notLanded = deletes.filter(d => d.kind !== 'worktree' && d.kind !== 'dir'
    && !state.unmerged.some(a => (a.exact ? a.scope === d.target : namesBranch(a.scope, d.target)))
    && !hasLanded(gitFor(d.dir), d, { cwd: d.dir, mergedHeads, cache: headCache, deadline }));
  if (notLanded.length) {
    const names = [...new Set(notLanded.map(d => d.target))];
    return { block: [head,
      `Delete refused: ${names.join(', ')} has content that is not in the default branch (unmerged work).`,
      'An unmerged branch needs its own yes: one multiSelect AskUserQuestion, header "Unmerged",',
      'options = the full branch names (max 4 per question, several questions per call); only ticked names',
      'count. (Single form: one question naming the branch, options "Ja, löschen" / "Behalten".) No yes → keep it.',
      NO_ANSWER_RULE].join('\n') };
  }
  return null;
}

module.exports = {
  ARM_TTL_MS,
  statePath, readState, writeState, arm, isCleanupSkill,
  isYesAnswer, questionScope, recordAnswers,
  segments, parseDeletes, defaultBase, hasLanded,
  namesBranch, namesWorktree, decide,
};
