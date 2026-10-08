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
 *       `git update-ref -d refs/heads/…`, `git worktree remove` — whose target
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

function answerFor(q, answers) {
  if (!answers || typeof answers !== 'object') return undefined;
  if (q && typeof q.question === 'string' && Object.prototype.hasOwnProperty.call(answers, q.question)) return answers[q.question];
  if (q && typeof q.header === 'string' && Object.prototype.hasOwnProperty.call(answers, q.header)) return answers[q.header];
  return undefined;
}

/**
 * Fold one answered AskUserQuestion into the state (mutates and returns it).
 * Dry-Run: a yes adds an approval, anything else revokes all of them.
 * Unmerged: a yes adds that question's scope; a no adds nothing.
 */
function recordAnswers(state, questions, answers, nowMs = Date.now()) {
  if (!state) return state;
  for (const q of (Array.isArray(questions) ? questions : [])) {
    const header = q && typeof q.header === 'string' ? q.header : '';
    const dry = DRY_RUN_HEADER_RE.test(header);
    const unm = !dry && UNMERGED_HEADER_RE.test(header);
    if (!dry && !unm) continue;
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

/**
 * The deletions one segment's tokens perform.
 * @returns {{dir: string|null, kind: 'branch'|'remote'|'worktree', target: string, remote?: string}[]|{unresolved: string}|null}
 */
function deletesInTokens(tokens) {
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
  if (dir !== null && !literal(dir)) return { unresolved: `the repo path "${dir}" is not literal` };
  const sub = tokens[i];
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
  for (const seg of segments(command)) {
    const t = seg.tokens;
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
function hasLanded(git, d) {
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
  return Boolean(merged && baseTree && merged.split('\n')[0].trim() === baseTree);
}

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
function decide({ command, cwd, state, gitFor }) {
  if (!state) return null;
  const { deletes, unresolved } = parseDeletes(command, cwd);
  if (!deletes.length && !unresolved.length) return null;
  const head = '[cleanup-gate] BLOCKED — /auto-cleanup is running in this session.';
  if (unresolved.length) {
    return { block: [head, `The gate cannot verify what this deletes: ${unresolved[0]}.`,
      'Name every branch / worktree literally, one delete per name.', NO_ANSWER_RULE].join('\n') };
  }
  const dryScopes = state.dryRun.map(a => a.scope);
  const missing = deletes.filter(d => !dryScopes.some(s => d.kind === 'worktree'
    ? namesWorktree(s, d.target, d.dir)
    : namesBranch(s, d.target)));
  if (missing.length) {
    const names = [...new Set(missing.map(d => d.target))].join(', ');
    const why = dryScopes.length
      ? `the confirmed Dry-Run does not name ${names}.`
      : `no Dry-Run-Confirm was answered "Ja" for ${names}.`;
    return { block: [head, `Delete refused: ${why}`, NO_ANSWER_RULE, HOW_TO_CONFIRM].join('\n') };
  }
  const unmScopes = state.unmerged.map(a => a.scope);
  const notLanded = deletes.filter(d => d.kind !== 'worktree'
    && !unmScopes.some(s => namesBranch(s, d.target))
    && !hasLanded(gitFor(d.dir), d));
  if (notLanded.length) {
    const names = [...new Set(notLanded.map(d => d.target))];
    return { block: [head,
      `Delete refused: ${names.join(', ')} has content that is not in the default branch (unmerged work).`,
      'An unmerged branch needs its own yes: one AskUserQuestion per branch, header "Unmerged",',
      'the question names the branch, options "Ja, löschen" and "Behalten". No yes → keep it.',
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
