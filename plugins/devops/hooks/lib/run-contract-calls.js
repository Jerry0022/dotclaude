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
 *   SHIP_RELEASE, RENDER_CARD, EDIT_TOOLS, SHELL_TOOLS, FINAL_VARIANTS   constants
 *   commandFacts(cmd)          → {commit, branch, branchName, renderCard, worktree, detach, release}
 *     (the executable at command position: quoted paths, wrapper prefixes,
 *     sh -c / cmd /c / pwsh -Command / eval payloads — H-X4)
 *   contractRoots(hook, projectRoot) → {root, inputRoot, roots[]} (H-B1)
 *   toolFilePath(tool, input)  → string | null
 *   isGatedPath(root, cwd, p)  → boolean (inside the work tree, not exempt)
 *   closesOf(body)             → ["473", …] from "Closes #473" / "Fixes #…"
 *   cardFacts(input)           → {variant, final}
 *   readCardPayload(file, cwd) → object | null
 *   releaseResult(response)    → {ok, merged} | null
 *   routerFromTranscript(transcriptPath, sinceIso, RC) → {questions, answers, followUps[]} | null
 *   baseBranch(root, newName, after) → string | null  (git, 3 s timeout)
 *   isItemBranch(facts, hook, current) → boolean (backlog item boundary, R6)
 *   stripQuotes(cmd) / gitOut(root, args) / readTail(file)   helpers (AUD-015c: kept in sync with module.exports)
 */

const fs = require('fs');
const path = require('path');

const SHIP_RELEASE = 'mcp__plugin_devops_dotclaude-ship__ship_release';
const RENDER_CARD = 'mcp__plugin_devops_dotclaude-completion__render_completion_card';
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const FINAL_VARIANTS = new Set(['ship-successful', 'ready', 'ready-files', 'released', 'test']);

/** Quoted strings emptied, so `grep "git commit"` and `-m "a && b"` never split or match. */
function stripQuotes(cmd) {
  return String(cmd || '').replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
}

const QUOTED_RE = /"(?:[^"\\]|\\.)*"|'[^']*'/g;

/**
 * H-X4 / H-B16: the command split into segments at `&&`, `||`, `;`, `|`, a
 * lone `&` (not `2>&1` / `&>`) and newlines OUTSIDE quoted strings, so the
 * raw segment and its quote-stripped form always line up. An unmatched
 * quote is a literal character (same rule as stripQuotes).
 */
function splitSegments(cmd) {
  const mask = cmd.replace(QUOTED_RE, m => '_'.repeat(m.length));
  const segs = [];
  const re = /&&|\|\||[;|\n]|&(?!>)/g;
  let last = 0;
  let m;
  while ((m = re.exec(mask))) {
    if (m[0] === '&' && /[<>]$/.test(mask.slice(0, m.index))) continue;
    segs.push(cmd.slice(last, m.index));
    last = m.index + m[0].length;
  }
  segs.push(cmd.slice(last));
  return segs;
}

const TOKEN_RE = /(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"']|["'])+/g;

function unquote(tok) {
  return tok.replace(QUOTED_RE, q => (q[0] === "'" ? q.slice(1, -1) : q.slice(1, -1).replace(/\\(["\\$`])/g, '$1')));
}

function tokensOf(s) {
  return [...s.matchAll(TOKEN_RE)].map(m => ({ raw: m[0], value: unquote(m[0]), end: m.index + m[0].length }));
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
};

/**
 * What runs at COMMAND POSITION of one raw segment (H-X4): leading `(`, `{`,
 * `!`, `&` (PowerShell call operator), `VAR=value` and the wrapper prefixes
 * (`sudo`, `env`, `command`, `exec`, `time`, `nice`, `nohup`, `timeout`)
 * skipped, a quoted executable unquoted. A shell payload (`sh -c`, `bash
 * -c`, `cmd /c`, `pwsh -Command` / `-EncodedCommand`, `eval`) comes back as
 * `{payload}` for the caller to parse again.
 * @returns {{exe:string, rest:string}|{payload:string}|null}
 */
function commandAt(seg) {
  const s = seg.replace(/^[\s({!&]+/, '');
  const t = tokensOf(s);
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
      skipFlags(WRAPPERS[name]);
      if (name === 'timeout' && i < t.length && /^\d/.test(t[i].value)) i++;
      continue;
    }
    if (SHELLS.has(name)) {
      for (let j = i + 1; j < t.length; j++) {
        const f = t[j].value;
        if (!/^-/.test(f) || f === '--') return null; // a script file
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(f)) return j + 1 < t.length ? { payload: t[j + 1].value } : null;
        if (f === '-o' || f === '+o') j++;
      }
      return null;
    }
    if (name === 'cmd') {
      for (let j = i + 1; j < t.length; j++) {
        if (/^\/[ck]$/i.test(t[j].value)) {
          const rest = restFrom(j + 1);
          const rt = tokensOf(rest);
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
          const rt = tokensOf(rest);
          return { payload: rt.length === 1 ? rt[0].value : rest };
        }
        if (PWSH_ENCODED_RE.test(f)) {
          try { return j + 1 < t.length ? { payload: Buffer.from(t[j + 1].value, 'base64').toString('utf16le') } : null; } catch { return null; }
        }
        if (/^[-/]f(?:ile)?$/i.test(f)) return null;
        if (PWSH_ARG_FLAG_RE.test(f)) j++;
      }
      return null;
    }
    if (name === 'eval') return { payload: t.slice(i + 1).map(x => x.value).join(' ') };
    return { exe: name, rest: s.slice(t[i].end) };
  }
  return null;
}

// `git` (already reduced from `git.exe`, `/usr/bin/git`, a quoted path), then
// git's global flags before the subcommand.
const GIT_RE = /^git(?:\s+(?:-[cC]\s+\S+|--no-pager|--paginate|-p|-P|--bare|--no-replace-objects|--literal-pathspecs|--(?:git-dir|work-tree|namespace|exec-path|config-env)(?:=\S+|\s+\S+)))*\s+(\S+)(.*)$/s;
const GH_MERGE_RE = /^\s+pr\s+merge\b/;
const PUSH_MAIN_RE = /(^|\s)(?:[^\s:]*:)?(?:refs\/heads\/)?(main|master)(\s|$)/;
const PAYLOAD_DEPTH = 4;

/**
 * Facts of a Bash / PowerShell command line.
 * @param {string} cmd
 * @returns {{commit:boolean, branch:boolean, branchName:string|null, renderCard:string|null, worktree:boolean, detach:boolean, release:boolean}}
 */
const RENDER_CARD_FLAG_RE = /(^|\s)--render-card\b/;
const RENDER_CARD_RE = /index\.js["']?\s+--render-card\s+(?:"([^"]+)"|'([^']+)'|(\S+))/;

function commandFacts(cmd, depth = 0) {
  const out = { commit: false, branch: false, branchName: null, renderCard: null, worktree: false, detach: false, release: false };
  if (typeof cmd !== 'string' || !cmd.trim()) return out;
  // H-B16 / RT2-R1: one quote-aware split, so the raw segment (branch
  // names, card payload paths) always belongs to the stripped one.
  for (const rawSeg of splitSegments(cmd)) {
    const seg = stripQuotes(rawSeg);
    // AUD-008: the --render-card FLAG must be a real, unquoted token on the
    // quote-stripped segment (so `grep "index.js --render-card x" file` —
    // both inside one quoted string — never matches). The renderer's own
    // path may legitimately be quoted (Windows paths with spaces), so
    // `index.js` and the payload path are read from the RAW segment.
    if (!out.renderCard && RENDER_CARD_FLAG_RE.test(seg) && /index\.js/i.test(rawSeg)) {
      const rc = rawSeg.match(RENDER_CARD_RE);
      if (rc) out.renderCard = rc[1] || rc[2] || rc[3];
    }
    const at = commandAt(rawSeg);
    if (!at) continue;
    if (at.payload !== undefined) {
      if (depth < PAYLOAD_DEPTH) mergeFacts(out, commandFacts(at.payload, depth + 1));
      continue;
    }
    if (at.exe === 'gh') {
      if (GH_MERGE_RE.test(stripQuotes(at.rest))) out.release = true;
      continue;
    }
    if (at.exe !== 'git') continue;
    const m = `git${stripQuotes(at.rest)}`.match(GIT_RE);
    if (!m) continue;
    const sub = m[1];
    const rest = m[2] || '';
    if (sub === 'commit' && !/(^|\s)--dry-run\b/.test(rest)) out.commit = true;
    // A push straight onto main / master (`HEAD:main`, `:main`, `origin main`) is a ship.
    if (sub === 'push' && PUSH_MAIN_RE.test(rest) && !/(^|\s)--dry-run\b/.test(rest)) out.release = true;
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
    }
    if (hit) {
      out.branch = true;
      if (/(^|\s)--detach\b/.test(rest)) out.detach = true;
      if (name && !out.branchName) out.branchName = name.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function mergeFacts(out, f) {
  for (const k of ['commit', 'branch', 'worktree', 'detach', 'release']) if (f[k]) out[k] = true;
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
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const inputRoot = typeof input.cwd === 'string' && input.cwd.trim() && String(hook.tool_name || '').startsWith('mcp__')
    ? projectRoot(input.cwd) : null;
  return { root, inputRoot, roots: inputRoot && inputRoot !== root ? [root, inputRoot] : [root] };
}

function gitOut(root, args) {
  try {
    const { execFileSync } = require('child_process');
    return execFileSync('git', args, {
      cwd: root, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    }).trim() || null;
  } catch { return null; }
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

/**
 * Newest router answers in the transcript tail (spec B fallback), plus the
 * follow-up answer sets after it. Lines older than `sinceIso` are ignored.
 * @param {string} transcriptPath
 * @param {string|null} sinceIso
 * @param {object} RC the run-contract lib (extractAnswers, isRouterCall, parseFollowUp)
 */
function routerFromTranscript(transcriptPath, sinceIso, RC) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  const text = readTail(transcriptPath);
  if (!text) return null;
  const since = sinceIso ? Date.parse(sinceIso) - 5000 : NaN;
  const lines = text.split('\n');
  const followUps = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('toolUseResult')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || !obj.toolUseResult || typeof obj.toolUseResult !== 'object') continue;
    const t = Date.parse(obj.timestamp);
    if (Number.isFinite(since) && Number.isFinite(t) && t < since) break;
    const { questions, answers } = RC.extractAnswers(obj.toolUseResult, {});
    if (RC.isRouterCall(questions)) return { questions, answers, followUps: followUps.reverse() };
    const f = RC.parseFollowUp(questions, answers);
    if (f) followUps.push(f);
  }
  return null;
}

module.exports = {
  SHIP_RELEASE, RENDER_CARD, EDIT_TOOLS, SHELL_TOOLS, FINAL_VARIANTS,
  commandFacts, toolFilePath, isGatedPath, closesOf, cardFacts, readCardPayload,
  releaseResult, routerFromTranscript, stripQuotes, gitOut, baseBranch, isItemBranch, readTail,
  splitSegments, commandAt, contractRoots,
};
