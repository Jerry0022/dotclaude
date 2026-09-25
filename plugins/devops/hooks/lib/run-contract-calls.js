'use strict';
/**
 * @module run-contract-calls
 * @version 0.2.0
 * @plugin devops
 * @description What a tool call MEANS for the run contract — shared by
 *   pre.run.contract (gates) and post.run.contract (recording) so both read a
 *   call the same way. Pure parsing plus two small fs reads (card payload,
 *   transcript tail); no git, no contract state.
 *
 *   SHIP_RELEASE, RENDER_CARD, EDIT_TOOLS, SHELL_TOOLS   constants
 *   MACHINE_ARM_RE / MACHINE_TURN_RE / BACKLOG_AUTOSTART_RE   machine-prompt openers
 *     (arming: RUN_BACKLOG_AUTOSTART + AUTONOMOUS_AUTOSTART · a machine turn:
 *     those plus AUTONOMOUS_RESUME · backlog only)
 *   commandFacts(cmd, {tool})  → {commit, branch, branchName, renderCard, worktree, detach, release, pushHead}
 *     (the executable at command position: quoted paths, wrapper prefixes,
 *     sh -c / cmd /c / pwsh -Command / eval payloads — H-X4; xargs, env -S,
 *     Start-Process, $(…) / backtick substitutions — H-X4b; PowerShell
 *     assignments, shell / PowerShell keywords and blocks, iex, line
 *     continuations, heredocs and here-strings — RT3. The text parsed after
 *     heredoc bodies are removed is capped at MAX_PARSE = 256 KB — RT3-R9)
 *   splitSegments(cmd, ps) / commandAt(seg, lang)   the command-position parser behind it
 *   scanShell(cmd, lang) / substitutions(cmd, lang)   heredocs out, substitution payloads
 *   shellCallFacts(hook, root, cwd, {after}) → {commit, itemBranch, branchName, card, release, pushHead}
 *     (one Bash / PowerShell call as pre gates and post records it — H-A2)
 *   contractRoots(hook, projectRoot) → {root, inputRoot, roots[]} (H-B1)
 *   toolInput(hook)            → the call's tool_input object ({} when none)
 *   toolFilePath(tool, input)  → string | null
 *   isGatedPath(root, cwd, p)  → boolean (inside the work tree, not exempt)
 *   isGatedEdit(tool, input, root, cwd) → boolean (Edit/Write/NotebookEdit on a gated path)
 *   closesOf(body)             → ["473", …] from "Closes #473" / "Fixes #…"
 *   cardFacts(input)           → {variant, final}
 *   readCardPayload(file, cwd) → object | null
 *   releaseResult(response)    → {ok, merged} | null
 *   routerFromTranscript(transcriptPath, sinceIso, RC) → {questions, answers, followUps[], earlier[]} | null
 *   baseBranch(root, newName, after) → string | null  (git, 3 s timeout)
 *   isItemBranch(facts, hook, current) → boolean (backlog item boundary, R6)
 *   gitOut(root, args) → string | null · gitLines(root, args, {timeout}) → string[] (throws)
 *   readTail(file)             → transcript tail (AUD-015c: this list matches module.exports)
 *   linesBackward(file)        → generator: whole lines newest first, 2 MB chunks, ≤ 32 MB (QA-T1)
 */

const fs = require('fs');
const path = require('path');

const SHIP_RELEASE = 'mcp__plugin_devops_dotclaude-ship__ship_release';
const RENDER_CARD = 'mcp__plugin_devops_dotclaude-completion__render_completion_card';
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// H-A5: the machine-prompt openers, named once. Arming reads the two
// AUTOSTART forms; "did this turn open with a machine prompt" (R1) also
// counts a resume.
const MACHINE_ARM_RE = /^\s*(RUN_BACKLOG_AUTOSTART|AUTONOMOUS_AUTOSTART)\s*:/i;
const MACHINE_TURN_RE = /^\s*(AUTONOMOUS_AUTOSTART|AUTONOMOUS_RESUME|RUN_BACKLOG_AUTOSTART)\s*:/i;
const BACKLOG_AUTOSTART_RE = /^\s*RUN_BACKLOG_AUTOSTART\s*:/i;

const FINAL_VARIANTS = new Set(['ship-successful', 'ready', 'ready-files', 'released', 'test']);

/**
 * RT3-R9: the quoted-string spans of `s` in ONE linear pass — `"…"` (escape
 * `\`, PowerShell `` ` ``) and `'…'`. An unmatched quote is a literal
 * character. Once a `"` finds no close, no later one can (the escape pairs
 * line up the same way), so the scan never restarts: an unmatched `"`
 * followed by many `\"` stays linear.
 * @returns {Array<[number, number]>} [start, end) of each span
 */
function quoteSpans(s, ps) {
  const esc = ps ? '`' : '\\';
  const out = [];
  let noDq = false;
  let noSq = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && !noDq) {
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === esc) j++;
        else if (s[j] === '"') break;
      }
      if (j < s.length) { out.push([i, j + 1]); i = j; } else noDq = true;
    } else if (ch === "'" && !noSq) {
      const j = s.indexOf("'", i + 1);
      if (j >= 0) { out.push([i, j + 1]); i = j; } else noSq = true;
    }
  }
  return out;
}

/** `s` with every quoted span replaced by `fill(spanText)`. */
function mapQuotes(s, ps, fill) {
  const str = String(s || '');
  let res = '';
  let last = 0;
  for (const [a, b] of quoteSpans(str, ps)) {
    res += str.slice(last, a) + fill(str.slice(a, b));
    last = b;
  }
  return res + str.slice(last);
}

/** Quoted strings emptied, so `grep "git commit"` and `-m "a && b"` never split or match. */
function stripQuotes(cmd, ps) {
  return mapQuotes(cmd, ps, q => q[0] + q[0]);
}

/**
 * H-X4 / H-B16: the command split into segments at `&&`, `||`, `;`, `|`, a
 * lone `&` (not `2>&1` / `&>`) and newlines OUTSIDE quoted strings, so the
 * raw segment and its quote-stripped form always line up. An unmatched
 * quote is a literal character (same rule as stripQuotes).
 */
function splitSegments(cmd, ps) {
  const mask = mapQuotes(cmd, ps, q => '_'.repeat(q.length));
  const segs = [];
  // RT3-R3: PowerShell `{` / `}` open and close a block of statements
  // (`if ($x) { … } else { git commit }`); bash keeps them (`${v}`, `a{b,c}`).
  const re = ps ? /&&|\|\||[;|\n{}]|&(?!>)/g : /&&|\|\||[;|\n]|&(?!>)/g;
  let last = 0;
  let m;
  while ((m = re.exec(mask))) {
    // RT3-R9: one look back, not a copy of the prefix per `&`.
    if (m[0] === '&' && (mask[m.index - 1] === '<' || mask[m.index - 1] === '>')) continue;
    segs.push(cmd.slice(last, m.index));
    last = m.index + m[0].length;
  }
  segs.push(cmd.slice(last));
  return segs;
}

function unquote(tok, ps) {
  return mapQuotes(tok, ps, q => (q[0] === "'" ? q.slice(1, -1)
    : ps ? q.slice(1, -1).replace(/`(.)/g, '$1') : q.slice(1, -1).replace(/\\(["\\$`])/g, '$1')));
}

function tokensOf(s, ps) {
  const mask = mapQuotes(s, ps, q => '_'.repeat(q.length));
  return [...mask.matchAll(/\S+/g)].map(m => {
    const raw = s.slice(m.index, m.index + m[0].length);
    return { raw, value: unquote(raw, ps), end: m.index + m[0].length };
  });
}

// RT3-R5: heredoc / here-string / substitution scanner ─────────────────────

/** RT3-R9: the parsed text (after heredoc bodies are gone) is capped here. */
const MAX_PARSE = 256 * 1024;
const HEREDOC_RE = /<<([-~]?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|(\\?)([A-Za-z_][\w.-]*))/y;
const HERESTRING_RE = /@(['"])[ \t]*\r?\n/y;
// A heredoc that feeds a shell: its body is a script (`bash <<EOF`, `pwsh -Command - <<EOF`).
const FEED_SH_RE = /(?:^|[\s;&|({])(?:\S*[\\/])?["']?(?:bash|sh|zsh|dash|ksh)(?:\.exe)?["']?(?:\s+-{1,2}[\w-]+)*\s*$/i;
const FEED_PS_RE = /(?:^|[\s;&|({])(?:\S*[\\/])?["']?(?:pwsh|powershell)(?:\.exe)?["']?(?:\s+[-/][\w-]+)*?\s+[-/]c\w*\s+-\s*$/i;

/** Line start offsets by content (exact and tab-stripped) — built once per heredoc-bearing command. */
function lineIndex(s) {
  const exact = new Map();
  const tabbed = new Map();
  const add = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (let start = 0; start <= s.length;) {
    let nl = s.indexOf('\n', start);
    if (nl < 0) nl = s.length;
    if (nl - start <= 256) {
      const line = s.slice(start, nl).replace(/\r$/, '');
      const v = [start, nl + 1];
      add(exact, line, v);
      const t = line.replace(/^\t+/, '');
      if (t !== line) add(tabbed, t, v);
    }
    start = nl + 1;
  }
  return { exact, tabbed };
}

/** First [start, next) of a line equal to `word` at or after `from`, or null. */
function findLine(idx, word, dash, from) {
  const first = (arr) => {
    if (!arr) return null;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid][0] < from) lo = mid + 1; else hi = mid; }
    return lo < arr.length ? arr[lo] : null;
  };
  const a = first(idx.exact.get(word));
  const b = dash ? first(idx.tabbed.get(word)) : null;
  if (!a) return b;
  if (!b) return a;
  return a[0] <= b[0] ? a : b;
}

/**
 * RT3-R5 / R3 / R9: one linear pass over a command (lang `sh` = Bash, `ps` =
 * PowerShell, `any` = unknown: bash rules plus here-strings and `` ` ``
 * line continuations). Returns the text to parse — line continuations
 * joined, heredoc and here-string bodies removed — plus what else runs:
 *   subs   outermost `$(…)` / backtick payloads (quote-aware paren count;
 *          PowerShell: `$(…)` only, `` ` `` is its escape character), and
 *          the `$(…)` found in an unquoted heredoc / `@"…"@` body (bash and
 *          PowerShell expand those, the rest of the body is data)
 *   feeds  heredoc bodies fed to a shell (`bash <<EOF`), parsed as scripts
 * A heredoc with no terminator line is not stripped (parsed as before).
 * `hd`: scan a heredoc body — quotes are literal, only substitutions count.
 * @returns {{text:string, subs:string[], feeds:{body:string, lang:string}[]}}
 */
function scanShell(cmd, lang, hd = false) {
  const ps = lang === 'ps';
  const sh = !ps;
  const esc = ps ? '`' : '\\';
  const parts = [];
  let olen = 0;
  let mark = 0;
  const cut = (from, to, repl = '') => {
    if (from > mark) { parts.push(cmd.slice(mark, from)); olen += from - mark; }
    if (repl) { parts.push(repl); olen += repl.length; }
    mark = to;
  };
  const at = (i) => olen + (i - mark);
  const ranges = []; // [startOut, endOut, skip] outermost substitutions
  const bodySubs = [];
  const feeds = [];
  const stack = []; // 'dq' | 'sub' | 'par'
  let subDepth = 0;
  let pending = [];
  let idx = null;
  let lineStart = 0;
  const noHs = {};
  const openSub = (i) => {
    if (subDepth === 0) ranges.push([at(i), -1, false]);
    subDepth++;
    stack.push('sub');
  };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === '\n') lineStart = i + 1;
    const top = stack.length ? stack[stack.length - 1] : (hd ? 'hd' : 'top');
    const nl = cmd[i + 1] === '\n' ? 1 : (cmd[i + 1] === '\r' && cmd[i + 2] === '\n' ? 2 : 0);
    // Line continuations: bash `\⏎` vanishes, PowerShell `` `⏎ `` is a space.
    if (ch === '`' && nl && lang === 'any' && !hd) { cut(i, i + 1 + nl, ' '); i += nl; continue; }
    if (ch === esc) {
      if (nl && !hd) { cut(i, i + 1 + nl, ps ? ' ' : ''); i += nl; continue; }
      i++;
      continue;
    }
    if (ch === '$' && cmd[i + 1] === '(') { openSub(i + 2); i++; continue; }
    if (ch === '`' && sh) {
      let j = i + 1;
      while (j < cmd.length && (cmd[j] !== '`' || cmd[j - 1] === '\\')) j++;
      if (subDepth === 0) ranges.push([at(i + 1), at(Math.min(j, cmd.length)), false]);
      i = j;
      continue;
    }
    if (top === 'dq') { if (ch === '"') stack.pop(); continue; }
    if (top === 'hd') continue;
    if (ch === "'") { const j = cmd.indexOf("'", i + 1); if (j >= 0) i = j; continue; }
    if (ch === '"') { stack.push('dq'); continue; }
    if (ch === '(' && top !== 'top') { stack.push('par'); continue; }
    if (ch === ')' && (top === 'sub' || top === 'par')) {
      stack.pop();
      if (top === 'sub' && --subDepth === 0) ranges[ranges.length - 1][1] = at(i);
      continue;
    }
    if (sh && ch === '<' && cmd[i + 1] === '<') {
      if (cmd[i + 2] === '<') { i += 2; continue; } // `<<<` here-string: a word, no body
      HEREDOC_RE.lastIndex = i;
      const m = HEREDOC_RE.exec(cmd);
      if (!m) { i++; continue; }
      const word = m[2] ?? m[3] ?? m[5];
      if (word) {
        const prefix = cmd.slice(Math.max(lineStart, i - 200), i);
        const feed = FEED_SH_RE.test(prefix) ? 'sh' : FEED_PS_RE.test(prefix) ? 'ps' : null;
        pending.push({ word, dash: !!m[1], quoted: m[2] !== undefined || m[3] !== undefined || !!m[4], feed, sub: subDepth ? ranges.length - 1 : -1 });
      }
      i += m[0].length - 1;
      continue;
    }
    if (!sh || lang === 'any') {
      if (ch === '@' && (cmd[i + 1] === "'" || cmd[i + 1] === '"')) {
        HERESTRING_RE.lastIndex = i;
        const m = HERESTRING_RE.exec(cmd);
        const q = m && m[1];
        if (m && !noHs[q]) {
          const from = i + m[0].length;
          const k = cmd.indexOf(`\n${q}@`, from - 1);
          if (k < 0) noHs[q] = true;
          else {
            const body = cmd.slice(from, Math.max(from, k));
            cut(i, k + 3, q + q);
            if (q === '"') bodySubs.push(...scanShell(body, 'ps', true).subs);
            i = k + 2;
            continue;
          }
        }
      }
    }
    if (ch === '\n' && pending.length) {
      let p = i + 1;
      idx = idx || lineIndex(cmd);
      for (const h of pending) {
        const hit = findLine(idx, h.word, h.dash, p);
        if (!hit) {
          // No terminator: not stripped. A substitution holding it is text (H-X4b).
          if (h.sub >= 0) ranges[h.sub][2] = true;
          break;
        }
        const body = cmd.slice(p, hit[0]);
        if (h.feed) feeds.push({ body, lang: h.feed });
        else if (!h.quoted) bodySubs.push(...scanShell(body, 'sh', true).subs);
        p = hit[1];
      }
      pending = [];
      if (p > i + 1) {
        cut(i + 1, Math.min(p, cmd.length));
        i = p - 1;
        lineStart = p;
      }
    }
  }
  cut(cmd.length, cmd.length);
  const text = parts.join('');
  const subs = [];
  for (const [a, b, skip] of ranges) {
    const s = text.slice(a, b < 0 ? text.length : b);
    if (!skip && s.trim()) subs.push(s);
  }
  return { text, subs: subs.concat(bodySubs.filter(s => s.trim())), feeds };
}

/** Executable name of a token: basename, lower-cased, `.exe` dropped (`"C:\…\git.exe"` → `git`). */
function exeName(value) {
  return String(value).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const PWSH = new Set(['pwsh', 'powershell']);
const PWSH_COMMAND_RE = /^[-/]c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i;
const PWSH_ENCODED_RE = /^[-/](?:e|ec|enc|encodedcommand)$/i;
const PWSH_ARG_FLAG_RE = /^[-/](?:ex|ep|executionpolicy|wd|workingdirectory|configurationname|of|outputformat|if|inputformat|w|windowstyle|v|version|psconsolefile|custompipename|settingsfile)$/i;
// Wrapper prefix → its flags that take a separate argument.
const WRAPPERS = {
  sudo: /^-[ugCDpRrTUh]$/, doas: /^-[uC]$/, env: /^-[uCS]$/, command: null, exec: /^-a$/,
  time: /^-[fo]$/, nice: /^-n$/, nohup: null, timeout: /^-[sk]$/, builtin: null,
  // H-X4b: `… | xargs [flags] git commit …` runs git.
  xargs: /^-[ILnPdEsa]$/,
};
// H-X4b: PowerShell `Start-Process <file> [-ArgumentList] <args>` (alias saps).
const START_PROCESS = new Set(['start-process', 'saps']);
const SP_FILE_RE = /^-(?:f|fi|fil|file|filep|filepa|filepat|filepath|path|pspath|lp)$/i;
const SP_ARGS_RE = /^-(?:a|ar|arg|args|argu|argum|argume|argumen|argument|argumentl|argumentli|argumentlis|argumentlist)$/i;
const SP_VALUE_RE = /^-(?:wo\w*|verb|wi\w*|redirect\w*|cred\w*|env\w*)$/i;

/** `Start-Process` tokens after the name → the command it launches, or null. */
function startProcessPayload(t) {
  let file = null;
  let args = null;
  for (let j = 0; j < t.length; j++) {
    const v = t[j].value;
    if (SP_FILE_RE.test(v)) { file = t[++j] ? t[j].value : null; continue; }
    if (SP_ARGS_RE.test(v)) { args = t[++j] ? t[j].value : null; continue; }
    if (SP_VALUE_RE.test(v)) { j++; continue; }
    if (/^-/.test(v)) continue;
    if (file === null) file = v;
    else if (args === null) args = v;
  }
  if (!file) return null;
  // `'commit','-m','x'` is an array: the commas separate arguments.
  return `"${file.replace(/"/g, '')}" ${String(args || '').replace(/,/g, ' ')}`.trim();
}

/**
 * What runs at COMMAND POSITION of one raw segment (H-X4): leading `(`, `{`,
 * `!`, `&` (PowerShell call operator), `VAR=value` and the wrapper prefixes
 * (`sudo`, `doas`, `env`, `command`, `exec`, `time`, `nice`, `nohup`,
 * `timeout`, `builtin`, `xargs`) skipped, a quoted executable unquoted. A
 * shell payload (`sh -c`, `bash -c`, `cmd /c`, `pwsh -Command` /
 * `-EncodedCommand`, `eval`, `env -S`, PowerShell `Start-Process <file>
 * -ArgumentList …`) comes back as `{payload}` for the caller to parse again.
 * @returns {{exe:string, rest:string}|{payload:string}|null}
 */
const KEYWORD_RE = /^(?:if|then|else|elif|elseif|do|while|until|try|catch|finally|foreach|for)(?=$|[\s({;])/i;
const ASSIGN_RE = /^\$(?:\{[^}\n]*\}|[\w:]+)\s*[+]?=(?![=~])\s*/;

/** Index of the `)` closing the `(` at `open`, or -1 (plain count, first 4 KB). */
function closeParen(s, open) {
  let depth = 0;
  for (let j = open; j < Math.min(s.length, open + 4096); j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')' && --depth === 0) return j;
  }
  return -1;
}

/**
 * RT3-R3: what stands before the command — `(`, `{`, `}`, `!`, `&`, a
 * PowerShell assignment (`$r = `, `$x += `), a shell / PowerShell keyword
 * (`if then else elif elseif do while until try catch finally foreach for`)
 * and a PowerShell `(condition) {` before its block.
 */
function skipPrefix(seg) {
  let s = seg;
  for (let g = 0; g < 16; g++) {
    const before = s;
    s = s.replace(/^[\s({}!&]+/, '').replace(ASSIGN_RE, '');
    const k = s.match(KEYWORD_RE);
    if (k) {
      s = s.slice(k[0].length).replace(/^\s*\[[^\]\n]*\]/, '');
      const c = s.match(/^\s*\(/);
      if (c) {
        const e = closeParen(s, c[0].length - 1);
        // Only a PowerShell `(cond) {` — a bash `if ( … )` is a subshell that runs.
        if (e > 0 && /^\s*\{/.test(s.slice(e + 1))) s = s.slice(e + 1);
      }
    }
    if (s === before) break;
  }
  return s;
}

function commandAt(seg, lang) {
  const ps = lang === 'ps';
  const s = skipPrefix(seg);
  const t = tokensOf(s, ps);
  let i = 0;
  const skipFlags = (argFlag) => {
    while (i < t.length && /^-/.test(t[i].value)) {
      const f = t[i++].value;
      if (f === '--') break;
      if (argFlag && argFlag.test(f) && i < t.length) i++;
    }
  };
  const restFrom = (j) => s.slice(j < t.length ? t[j].end - t[j].raw.length : s.length).trim();
  for (let guard = 0; guard < 16 && i < t.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i].raw)) { i++; continue; }
    const name = exeName(t[i].value);
    if (Object.prototype.hasOwnProperty.call(WRAPPERS, name)) {
      i++;
      // `command -v git` only looks the name up.
      if (name === 'command' && i < t.length && /^-[vV]$/.test(t[i].value)) return null;
      // H-X4b: `env -S "git commit …"` splits its string into the command.
      if (name === 'env') {
        // Only env's own options (before the command) count — `git commit -S` signs.
        for (let j = i; j < t.length && /^-/.test(t[j].value) && t[j].value !== '--'; j++) {
          const v = t[j].value;
          if (v === '-S' || v === '--split-string') return j + 1 < t.length ? { payload: t.slice(j + 1).map(x => x.value).join(' ') } : null;
          if (v.startsWith('--split-string=')) return { payload: [v.slice(15), ...t.slice(j + 1).map(x => x.value)].join(' ') };
          if (/^-[uC]$/.test(v)) j++;
        }
      }
      skipFlags(WRAPPERS[name]);
      if (name === 'timeout' && i < t.length && /^\d/.test(t[i].value)) i++;
      continue;
    }
    if (SHELLS.has(name)) {
      for (let j = i + 1; j < t.length; j++) {
        const f = t[j].value;
        if (!/^-/.test(f) || f === '--') return null; // a script file
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(f)) return j + 1 < t.length ? { payload: t[j + 1].value, lang: 'sh' } : null;
        if (f === '-o' || f === '+o') j++;
      }
      return null;
    }
    if (name === 'cmd') {
      for (let j = i + 1; j < t.length; j++) {
        if (/^\/[ck]$/i.test(t[j].value)) {
          const rest = restFrom(j + 1);
          const rt = tokensOf(rest, ps);
          return { payload: rt.length === 1 ? rt[0].value : rest };
        }
      }
      return null;
    }
    if (PWSH.has(name)) {
      for (let j = i + 1; j < t.length; j++) {
        const f = t[j].value;
        if (PWSH_COMMAND_RE.test(f) || !/^[-/]/.test(f)) {
          const from = PWSH_COMMAND_RE.test(f) ? j + 1 : j;
          const rest = restFrom(from);
          const rt = tokensOf(rest, ps);
          return { payload: rt.length === 1 ? rt[0].value : rest, lang: 'ps' };
        }
        if (PWSH_ENCODED_RE.test(f)) {
          try { return j + 1 < t.length ? { payload: Buffer.from(t[j + 1].value, 'base64').toString('utf16le'), lang: 'ps' } : null; } catch { return null; }
        }
        if (/^[-/]f(?:ile)?$/i.test(f)) return null;
        if (PWSH_ARG_FLAG_RE.test(f)) j++;
      }
      return null;
    }
    if (name === 'eval') return { payload: t.slice(i + 1).map(x => x.value).join(' ') };
    // RT3-R3: `iex "…"` / `Invoke-Expression [-Command] "…"` run their string like eval.
    if (name === 'iex' || name === 'invoke-expression') {
      return { payload: t.slice(i + 1).filter(x => !/^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(x.value)).map(x => x.value).join(' '), lang: 'ps' };
    }
    // RT3-R3: `… | ForEach-Object { git commit … }` — the block's first command.
    if ((name === 'foreach-object' || name === '%') && /^\s*\{/.test(s.slice(t[i].end))) {
      return { payload: s.slice(t[i].end).replace(/^\s*\{/, ''), lang: 'ps' };
    }
    if (START_PROCESS.has(name)) {
      const payload = startProcessPayload(t.slice(i + 1));
      return payload ? { payload } : null;
    }
    return { exe: name, rest: s.slice(t[i].end) };
  }
  return null;
}

// `git` (already reduced from `git.exe`, `/usr/bin/git`, a quoted path), then
// git's global flags before the subcommand.
const GIT_RE = /^git(?:\s+(?:-[cC]\s+\S+|--no-pager|--paginate|-p|-P|--bare|--no-replace-objects|--literal-pathspecs|--(?:git-dir|work-tree|namespace|exec-path|config-env)(?:=\S+|\s+\S+)))*\s+(\S+)(.*)$/s;
const GH_MERGE_RE = /^\s+pr\s+merge\b/;
// RT3-R4: a forced push (`+main`, `+HEAD:main`) and a trailing `)` / `}` count too.
const PUSH_MAIN_RE = /(^|\s)\+?(?:[^\s:]*:)?(?:refs\/heads\/)?(main|master)[)}]*(\s|$)/;
// RT3-R4: `gh api -X PUT repos/o/r/pulls/N/merge` (REST merge) and the GraphQL mergePullRequest mutation.
const GH_API_PUT_RE = /(^|\s)(?:-X\s*|--method[\s=]+)PUT(\s|$)/i;
const GH_API_MERGE_PATH_RE = /(^|\s)\/?repos\/\S+\/pulls\/[^\s/]+\/merge(?=[\s?]|$)/;
// `git branch` forms that create nothing (RT3-R10).
const BRANCH_NO_CREATE_RE = /^(?:-[dDmMcClarvu]|--(?:delete|move|copy|list|all|remotes|show-current|verbose|set-upstream-to|unset-upstream|edit-description|contains|no-contains|merged|no-merged|points-at|sort|format|column|color)\b)/;
const PAYLOAD_DEPTH = 4;

/**
 * Facts of a Bash / PowerShell command line.
 * @param {string} cmd
 * @param {{tool?:string, lang?:string}} [opts] the tool (`Bash` / `PowerShell`) — RT3-R5:
 *   for PowerShell the backtick is an escape character, never a substitution
 * @returns {{commit:boolean, branch:boolean, branchName:string|null, renderCard:string|null,
 *   worktree:boolean, detach:boolean, release:boolean, pushHead:boolean}}
 *   pushHead (RT3-R4): a push of the current branch (`git push`, `git push origin
 *   [HEAD]`) — a release when that branch is main / master (pre asks git).
 */
const RENDER_CARD_FLAG_RE = /(^|\s)--render-card\b/;
const RENDER_CARD_RE = /index\.js["']?\s+--render-card\s+(?:"([^"]+)"|'([^']+)'|(\S+))/;

/** Non-flag words of a git argument string (trailing `)` / `}` dropped). */
function positionals(rest) {
  return rest.trim().split(/\s+/).filter(w => w && !w.startsWith('-')).map(w => w.replace(/[)}]+$/, '')).filter(Boolean);
}

/**
 * H-X4b / RT3-R5: the payloads of `$(…)` and backtick command substitutions
 * (see scanShell). Kept for callers of the old name.
 */
function substitutions(cmd, lang = 'any') {
  return scanShell(String(cmd || ''), lang).subs;
}

function langOf(opts) {
  if (opts && opts.lang) return opts.lang;
  const tool = opts && opts.tool;
  return tool === 'PowerShell' ? 'ps' : tool === 'Bash' ? 'sh' : 'any';
}

function commandFacts(cmd, opts = {}, depth = 0) {
  const out = { commit: false, branch: false, branchName: null, renderCard: null, worktree: false, detach: false, release: false, pushHead: false };
  if (typeof cmd !== 'string' || !cmd.trim()) return out;
  const lang = langOf(opts);
  const ps = lang === 'ps';
  // RT3-R5: heredoc / here-string bodies out, line continuations joined, then the 256 KB cap (R9).
  const scan = scanShell(cmd, lang);
  const text = scan.text.length > MAX_PARSE ? scan.text.slice(0, MAX_PARSE) : scan.text;
  if (depth < PAYLOAD_DEPTH) {
    let budget = MAX_PARSE;
    for (const p of scan.subs) {
      if ((budget -= p.length) < 0) break;
      mergeFacts(out, commandFacts(p, { lang }, depth + 1));
    }
    for (const f of scan.feeds) mergeFacts(out, commandFacts(f.body.slice(0, MAX_PARSE), { lang: f.lang }, depth + 1));
  }
  const created = new Set(); // RT3-R10: `git branch X` earlier in this command
  // H-B16 / RT2-R1: one quote-aware split, so the raw segment (branch
  // names, card payload paths) always belongs to the stripped one.
  for (const rawSeg of splitSegments(text, ps)) {
    const seg = stripQuotes(rawSeg, ps);
    // AUD-008: the --render-card FLAG must be a real, unquoted token on the
    // quote-stripped segment (so `grep "index.js --render-card x" file` —
    // both inside one quoted string — never matches). The renderer's own
    // path may legitimately be quoted (Windows paths with spaces), so
    // `index.js` and the payload path are read from the RAW segment.
    if (!out.renderCard && RENDER_CARD_FLAG_RE.test(seg) && /index\.js/i.test(rawSeg)) {
      const rc = rawSeg.match(RENDER_CARD_RE);
      if (rc) out.renderCard = rc[1] || rc[2] || rc[3];
    }
    const at = commandAt(rawSeg, lang);
    if (!at) continue;
    if (at.payload !== undefined) {
      if (depth < PAYLOAD_DEPTH) mergeFacts(out, commandFacts(at.payload, { lang: at.lang || lang }, depth + 1));
      continue;
    }
    if (at.exe === 'gh') {
      const r = stripQuotes(at.rest, ps);
      if (GH_MERGE_RE.test(r)) out.release = true;
      if (/^\s+api\b/.test(r)) {
        const u = at.rest.replace(/["']/g, '');
        if ((GH_API_PUT_RE.test(u) && GH_API_MERGE_PATH_RE.test(u)) || /\bmergePullRequest\b/.test(u)) out.release = true;
      }
      // RT3-R10: `gh issue develop N -c` checks a new branch out.
      if (/^\s+issue\s+develop\b/.test(r) && /(^|\s)(?:-c|--checkout)(\s|$)/.test(r)) {
        out.branch = true;
        const n = at.rest.match(/\s(?:-n|--name)(?:\s+|=)(\S+)/);
        if (n && !out.branchName) out.branchName = unquote(n[1], ps).replace(/[)}]+$/, '');
      }
      continue;
    }
    if (at.exe !== 'git') continue;
    const m = `git${stripQuotes(at.rest, ps)}`.match(GIT_RE);
    if (!m) continue;
    // H-X4b: `(cd x && git commit)` / `{ git commit;}` — the closing bracket is no part of the subcommand.
    const sub = m[1].replace(/[)}]+$/, '');
    const rest = m[2] || '';
    const dry = /(^|\s)--dry-run\b/.test(rest);
    if (sub === 'commit' && !dry) out.commit = true;
    if (sub === 'push' && !dry) {
      // A push straight onto main / master (`HEAD:main`, `:main`, `origin main`, `+main`) is a ship.
      if (PUSH_MAIN_RE.test(rest)) out.release = true;
      else {
        // RT3-R4: the current branch (`git push`, `git push [-u] origin [HEAD]`).
        const pos = positionals(rest);
        if (pos.length <= 1 || (pos.length === 2 && /^\+?HEAD$/.test(pos[1]))) out.pushHead = true;
      }
    }
    let name = null;
    let hit = false;
    const raw = `git${at.rest}`;
    if (sub === 'checkout' && /(^|\s)(-[a-zA-Z]*[bB]|--orphan)(\s|$)/.test(rest)) {
      hit = true;
      const n = raw.match(/\s(?:-[a-zA-Z]*[bB]|--orphan)\s+(\S+)/);
      name = n ? n[1] : null;
    } else if (sub === 'switch' && /(^|\s)(-[a-zA-Z]*[cC]|--create|--force-create)(\s|=|$)/.test(rest)) {
      hit = true;
      const n = raw.match(/\s(?:-[a-zA-Z]*[cC]|--create|--force-create)[\s=]+(\S+)/);
      name = n ? n[1] : null;
    } else if (sub === 'worktree' && /^\s+add\b/.test(rest)) {
      hit = true;
      out.worktree = true;
      const b = raw.match(/\s-[bB]\s+(\S+)/);
      if (b) name = b[1];
      else {
        const pos = raw.replace(/^.*?\badd\b/s, '').trim().split(/\s+/).filter(t => t && !t.startsWith('-'));
        name = pos[1] || (pos[0] ? path.basename(pos[0]) : null);
      }
    } else if (sub === 'branch') {
      // RT3-R10: remembered — creation happens when the same command switches to it.
      const words = rest.trim().split(/\s+/).filter(Boolean);
      if (!words.some(w => BRANCH_NO_CREATE_RE.test(w))) {
        const pos = positionals(rawRest(raw));
        if (pos[0]) created.add(pos[0]);
      }
    } else if ((sub === 'switch' || sub === 'checkout') && created.size) {
      const pos = positionals(rawRest(raw));
      if (pos[0] && created.has(pos[0])) { hit = true; name = pos[0]; }
    }
    if (hit) {
      out.branch = true;
      if (/(^|\s)--detach\b/.test(rest)) out.detach = true;
      if (name && !out.branchName) out.branchName = name.replace(/[)}]+$/, '').replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

/** The raw arguments after git's subcommand, quote characters dropped. */
function rawRest(raw) {
  const m = raw.match(GIT_RE);
  return m ? (m[2] || '').replace(/["']/g, '') : '';
}

function mergeFacts(out, f) {
  for (const k of ['commit', 'branch', 'worktree', 'detach', 'release', 'pushHead']) if (f[k]) out[k] = true;
  if (!out.branchName && f.branchName) out.branchName = f.branchName;
  if (!out.renderCard && f.renderCard) out.renderCard = f.renderCard;
}

/**
 * H-B1: the work-tree roots a call's contract may live in, in lookup order —
 * the session root, then (MCP tools only: ship_release and the card act on
 * it) `tool_input.cwd`'s root. `projectRoot` is passed in so this module
 * stays dependency-free. Pre (gates) and post (recording) both use it.
 * @returns {{root:string, inputRoot:string|null, roots:string[]}}
 */
function contractRoots(hook, projectRoot) {
  const root = projectRoot(hook.cwd || process.cwd());
  const input = toolInput(hook);
  const inputRoot = typeof input.cwd === 'string' && input.cwd.trim() && String(hook.tool_name || '').startsWith('mcp__')
    ? projectRoot(input.cwd) : null;
  return { root, inputRoot, roots: inputRoot && inputRoot !== root ? [root, inputRoot] : [root] };
}

/** The tool_input object of a hook payload ({} when missing / not an object). */
function toolInput(hook) {
  const i = hook && hook.tool_input;
  return i && typeof i === 'object' ? i : {};
}

function gitRun(root, args, timeout) {
  const { execFileSync } = require('child_process');
  return execFileSync('git', args, {
    cwd: root, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
}

/** Trimmed git stdout, or null on an error AND on empty output. */
function gitOut(root, args) {
  try { return gitRun(root, args, 3000).trim() || null; } catch { return null; }
}

/**
 * H-A6: git stdout as non-empty lines. THROWS on a git failure, so a caller
 * can tell "unknown" from "no lines" (pre's qa count).
 */
function gitLines(root, args, { timeout = 3000 } = {}) {
  return gitRun(root, args, timeout).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

/**
 * The branch a new branch is created FROM. PreToolUse: HEAD. PostToolUse
 * (`after`): HEAD already is the new branch → the previous one (`@{-1}`).
 */
function baseBranch(root, newName, after) {
  const head = gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (after && head && newName && head === newName) return gitOut(root, ['rev-parse', '--abbrev-ref', '@{-1}']);
  return head;
}

/**
 * Is a branch creation an ITEM boundary (backlog event + branch gate, R6)?
 * Not from a subagent (`agent_id`), not `git worktree add`, not `--detach`,
 * and not a sub-branch `<current>-…` / `<current>/…` (agents' own branches).
 */
function isItemBranch(facts, hook, current) {
  if (!facts || !facts.branch) return false;
  if (hook && hook.agent_id) return false;
  if (facts.worktree || facts.detach) return false;
  const name = facts.branchName;
  if (name && current && current !== 'HEAD' && (name.startsWith(`${current}-`) || name.startsWith(`${current}/`))) return false;
  return true;
}

/**
 * H-A2: one Bash / PowerShell call as pre gates it and post records it.
 * `itemBranch`: a branch creation that is a backlog item boundary — HEAD is
 * asked only for a plain main-session creation (a subagent, `git worktree
 * add` and `--detach` never are one). `after`: PostToolUse (HEAD already is
 * the new branch). `card`: the offline `--render-card` call; an unreadable
 * payload (`-` = stdin, `$VAR`, a missing file or one relative to a `cd` in
 * the same command) counts as a FINAL card (H-B3).
 * @returns {{commit:boolean, itemBranch:boolean, branchName:string|null,
 *   card:{readable:boolean, variant:string|null, final:boolean}|null, release:boolean}}
 */
function shellCallFacts(hook, root, cwd, { after = false } = {}) {
  // RT3-R5: the tool decides the dialect (PowerShell: `` ` `` escapes, no backtick substitution).
  const f = commandFacts(toolInput(hook).command, { tool: hook && hook.tool_name });
  let itemBranch = false;
  if (f.branch) {
    const plain = !(hook.agent_id || f.worktree || f.detach);
    itemBranch = isItemBranch(f, hook, plain ? baseBranch(root, f.branchName, after) : null);
  }
  let card = null;
  if (f.renderCard) {
    const payload = readCardPayload(f.renderCard, cwd);
    card = payload ? { readable: true, ...cardFacts(payload) } : { readable: false, variant: null, final: true };
  }
  return { commit: f.commit, itemBranch, branchName: f.branchName, card, release: f.release, pushHead: f.pushHead };
}

function toolFilePath(toolName, input) {
  if (!input || typeof input !== 'object') return null;
  if (toolName === 'NotebookEdit') return input.notebook_path || input.file_path || null;
  if (toolName === 'Edit' || toolName === 'Write') return input.file_path || null;
  return null;
}

/**
 * Is an Edit/Write target gated (spec D)? Inside the work tree and not
 * `.claude/**`, `.git/**`, `docs/concepts/**`, `BACKLOG-*`, `AUTONOMOUS-*`, `BURN-*`.
 */
function isGatedPath(root, cwd, file) {
  if (typeof file !== 'string' || !file.trim()) return false;
  const abs = path.resolve(cwd || root, file);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const p = rel.replace(/\\/g, '/');
  const low = p.toLowerCase();
  if (low === '.claude' || low.startsWith('.claude/')) return false;
  if (low === '.git' || low.startsWith('.git/')) return false;
  if (low.startsWith('docs/concepts/')) return false;
  if (/^(BACKLOG|AUTONOMOUS|BURN)-/i.test(path.posix.basename(p))) return false;
  return true;
}

/** H-A3: an Edit / Write / NotebookEdit call on a gated path. */
function isGatedEdit(tool, input, root, cwd) {
  return EDIT_TOOLS.has(tool) && isGatedPath(root, cwd, toolFilePath(tool, input));
}

/** Issue numbers a PR body closes. */
function closesOf(body) {
  const out = [];
  if (typeof body !== 'string') return out;
  for (const m of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi)) out.push(m[1]);
  return [...new Set(out)];
}

function nonEmpty(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.some(nonEmpty);
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return String(v).trim().length > 0;
}

/** Card variant and whether it is a final card the gate checks (spec D). */
function cardFacts(input) {
  const i = input && typeof input === 'object' ? input : {};
  const variant = typeof i.variant === 'string' ? i.variant.trim() : '';
  const final = FINAL_VARIANTS.has(variant) && !nonEmpty(i.pending) && !nonEmpty(i.concept);
  return { variant, final };
}

function readCardPayload(file, cwd) {
  try {
    const v = JSON.parse(fs.readFileSync(path.resolve(cwd || process.cwd(), file), 'utf8').replace(/^\uFEFF/, ''));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function responseText(r) {
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) return r.map(responseText).join('\n');
  if (r && typeof r === 'object') {
    if (typeof r.text === 'string') return r.text;
    if (r.content !== undefined) return responseText(r.content);
  }
  return '';
}

/** `{ok, merged}` of a ship_release result, or null when unreadable. */
function releaseResult(response) {
  let obj = null;
  if (response && typeof response === 'object' && !Array.isArray(response) && typeof response.success === 'boolean') obj = response;
  if (!obj) {
    const text = responseText(response).trim();
    try { obj = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { obj = JSON.parse(m[0]); } catch { obj = null; } }
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  return { ok: obj.success === true, merged: obj.merged === true };
}

const TAIL_BYTES = 2 * 1024 * 1024;

function readTail(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch { return ''; } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* closed */ } }
  }
}

const MAX_BACK_BYTES = 32 * 1024 * 1024;

/**
 * QA-T1: the file's complete lines, newest first, read backwards in
 * TAIL_BYTES chunks (at most MAX_BACK_BYTES). A line split by a chunk
 * boundary is carried over and yielded whole; the partial first line at the
 * cap is dropped. The caller stops the read by leaving the loop.
 */
function* linesBackward(file, { chunk = TAIL_BYTES, max = MAX_BACK_BYTES } = {}) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return; }
  try {
    const size = fs.fstatSync(fd).size;
    const floor = Math.max(0, size - max);
    let end = size;
    let carry = Buffer.alloc(0);
    while (end > floor) {
      const start = Math.max(floor, end - chunk);
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const all = carry.length ? Buffer.concat([buf, carry]) : buf;
      let hi = all.length;
      for (let k = all.lastIndexOf(0x0a, hi - 1); k >= 0; k = hi > 0 ? all.lastIndexOf(0x0a, hi - 1) : -1) {
        yield all.toString('utf8', k + 1, hi);
        hi = k;
      }
      carry = all.subarray(0, hi);
      end = start;
    }
    if (floor === 0 && carry.length) yield carry.toString('utf8');
  } catch { /* unreadable: no more lines */ } finally {
    try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

/**
 * Newest router answers in the transcript tail (spec B fallback), plus the
 * follow-up answer sets after the first router call of the chain. Lines
 * older than `sinceIso` are ignored. H-C2c: a PARTIAL newest router call (a
 * re-ask of some headers) does not hide the full answers before it — the
 * scan goes on to the preceding full router call; `earlier` holds the older
 * router calls, oldest first, for the caller to merge under (R7).
 * @param {string} transcriptPath
 * @param {string|null} sinceIso
 * @param {object} RC the run-contract lib (extractAnswers, isRouterCall, isPartialRouterCall, parseFollowUp)
 * @returns {{questions, answers, followUps:object[], earlier:{questions, answers}[]}|null}
 */
function routerFromTranscript(transcriptPath, sinceIso, RC) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  const since = sinceIso ? Date.parse(sinceIso) - 5000 : NaN;
  const seen = []; // newest first: {questions, answers} router calls and {followUp}
  // QA-T1: backwards in 2 MB chunks until a line older than sinceIso or a full router call (≤ 32 MB).
  for (const line of linesBackward(transcriptPath)) {
    if (!line.includes('toolUseResult')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || !obj.toolUseResult || typeof obj.toolUseResult !== 'object') continue;
    const t = Date.parse(obj.timestamp);
    if (Number.isFinite(since) && Number.isFinite(t) && t < since) break;
    const { questions, answers } = RC.extractAnswers(obj.toolUseResult, {});
    if (RC.isRouterCall(questions)) {
      seen.push({ questions, answers });
      if (!RC.isPartialRouterCall(questions)) break;
      continue;
    }
    const f = RC.parseFollowUp(questions, answers);
    if (f) seen.push({ followUp: f });
  }
  let oldest = -1;
  seen.forEach((e, i) => { if (!e.followUp) oldest = i; });
  if (oldest < 0) return null;
  // Follow-ups older than the chain's first router call belong to no run.
  const chain = seen.slice(0, oldest + 1).reverse();
  const calls = chain.filter(e => !e.followUp);
  const newest = calls[calls.length - 1];
  return {
    questions: newest.questions,
    answers: newest.answers,
    followUps: chain.filter(e => e.followUp).map(e => e.followUp),
    earlier: calls.slice(0, -1),
  };
}

module.exports = {
  SHIP_RELEASE, RENDER_CARD, EDIT_TOOLS, SHELL_TOOLS,
  MACHINE_ARM_RE, MACHINE_TURN_RE, BACKLOG_AUTOSTART_RE,
  commandFacts, splitSegments, commandAt, shellCallFacts, contractRoots,
  toolInput, toolFilePath, isGatedPath, isGatedEdit, closesOf, cardFacts, readCardPayload,
  releaseResult, routerFromTranscript, baseBranch, isItemBranch, gitOut, gitLines, readTail,
  scanShell, substitutions, linesBackward, MAX_PARSE,
};
