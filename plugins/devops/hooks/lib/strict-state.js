#!/usr/bin/env node
/**
 * @module strict-state
 * @version 0.2.0
 * @description State, switch detection and the canonical contract text for
 *   strict mode — literal scope, discretionary parameters. Strict is not a
 *   skill (skill restructure PR 3): the hooks prompt.strict.enforce,
 *   pre.strict.agent-gate and stop.strict.release do the mechanics, the
 *   judgment half lives in deep-knowledge/strict.md.
 *
 * The mode file is a WORKTREE file (`.claude/strict-mode.json`): every git
 * worktree has its own `.claude/`, so a mode armed in one worktree never leaks
 * into another worktree of the same repo — exactly the "this branch only, not
 * project-wide" scope the user asked for. It is gitignored via the
 * runtime ignore list (hooks/lib/runtime-ignores.js), like `batch-mode.json`.
 *
 * The stored `branch` is compared against the checked-out branch on every
 * read: switching branches inside the worktree deactivates the mode instead of
 * silently carrying it onto unrelated work.
 *
 * Three ways a mode comes to exist (`reason`):
 *   on          `strict on` / `strikt an` / `/claude-strict on` — lives until
 *               `off` or a branch switch.
 *   inline      `strict: <task>` / `/claude-strict <task>` / a literal-scope
 *               phrase / do-run "Nur das" (CLI `inline`) — this turn; the
 *               Stop hook either binds it to a workflow that the turn started
 *               or releases it.
 *   concept /   bound to a workflow state file (`boundTo`); released the moment
 *   autonomous  that file disappears. Safety expiry 24 h.
 *
 * Spec: docs/superpowers/specs/2026-09-04-claude-strict-design.md
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { projectRoot, projectClaudeDir } = require('./project-root');

const MODE_FILE = 'strict-mode.json';

/** Workflow state files an inline mode can be bound to, checked in order. */
const BINDINGS = [
  { reason: 'concept',    file: path.join('.claude', 'concept-active.json') },
  { reason: 'autonomous', file: 'AUTONOMOUS-LOCKOUT.flag' },
];

const INLINE_EXPIRY_HOURS = 2;
const BOUND_EXPIRY_HOURS  = 24;

const CONTRACT_OPEN  = '[claude-strict contract]';
const CONTRACT_CLOSE = '[/claude-strict contract]';

/**
 * The contract. deep-knowledge/strict.md carries the same block verbatim; a
 * doc-text test (strict-doc.test.js) asserts the two never drift. Keep it under 1 400 characters — it is
 * injected on every strict turn.
 */
const CONTRACT_BLOCK = [
  CONTRACT_OPEN,
  'SCOPE IS LITERAL — measured in the vocabulary of the request.',
  '- Only what the request names changes. No refactor, rename, doc update, new',
  '  test, reformatting of untouched lines, "while I\'m here", new file /',
  '  dependency / abstraction.',
  '- Visual request ("the box border") → only that visible element changes; the',
  '  technical route (import, selector) is yours if nothing else visible changes.',
  '  Technical request ("rename fn X") → only that symbol.',
  'DISCRETION covers ATTRIBUTES the request leaves open (colour, px, wording),',
  'never the OBJECT. Ambiguous object: interactive → ask; autonomous → touch the',
  'single most probable one; lead the report with the assumption.',
  'TESTS: an assertion pinning the exact old value may be updated. Any other',
  'failure → apply nothing, revert, report.',
  'PRECEDENCE (scope only): overrides doc-maintenance, pre-mortem outputs, "make',
  'reasonable decisions independently", concept zero-prompt invariant. Completion',
  'card, do-ship docs-sync and auto-polish approval stay.',
  'PROPAGATION: put this block verbatim at the top of every Agent prompt and',
  'every skill you invoke; it binds concept iterations and autonomous resumes.',
  'REPORT (≤4 lines, before the card, omit empty lines):',
  '  strict — requested: <literal ask>',
  '  done: <what changed, file:line>',
  '  chosen: <attribute = value (unspecified)>',
  '  untouched: <noticed but out of scope>',
  CONTRACT_CLOSE,
].join('\n');

// ── paths / io ─────────────────────────────────────────────────────────────

/** Anchored at the work-tree root, never the raw cwd — see project-root.js. */
function claudeDir(cwd) { return projectClaudeDir(cwd); }
function modePath(cwd)  { return path.join(claudeDir(cwd), MODE_FILE); }

function readMode(cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(modePath(cwd), 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function writeMode(cwd, mode) {
  fs.mkdirSync(claudeDir(cwd), { recursive: true });
  fs.writeFileSync(modePath(cwd), JSON.stringify(mode, null, 2) + '\n', 'utf8');
  return mode;
}

function deactivate(cwd) {
  try { fs.unlinkSync(modePath(cwd)); } catch { /* already gone */ }
}

// ── git ────────────────────────────────────────────────────────────────────

function gitOut(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Checked-out branch, or null outside a repo. Works on an unborn branch. */
function currentBranch(cwd) {
  const b = gitOut(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return b || null;
}

/** Directory of the repo's main worktree, or null. */
function mainWorktree(cwd) {
  const common = gitOut(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  return path.dirname(common);
}

// ── mode lifecycle ─────────────────────────────────────────────────────────

function hoursFrom(t, h) { return new Date(t + h * 3600_000).toISOString(); }

/**
 * @param {string} cwd
 * @param {{reason?:'on'|'inline'|'concept'|'autonomous', branch?:string|null,
 *          sessionId?:string, boundTo?:string|null, now?:number}} [opts]
 */
function activate(cwd, opts = {}) {
  const reason = opts.reason || 'inline';
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const branch = opts.branch !== undefined ? opts.branch : currentBranch(cwd);
  let expiresAt = null;
  if (reason === 'inline') expiresAt = hoursFrom(now, INLINE_EXPIRY_HOURS);
  else if (reason !== 'on') expiresAt = hoursFrom(now, BOUND_EXPIRY_HOURS);
  return writeMode(cwd, {
    active: true,
    reason,
    branch,
    boundTo: opts.boundTo || null,
    sessionId: opts.sessionId || null,
    startedAt: new Date(now).toISOString(),
    expiresAt,
    noticedBranches: [],
  });
}

/** Re-bind an existing mode to a workflow state file. */
function bind(cwd, reason, boundTo, now) {
  const mode = readMode(cwd) || activate(cwd, { reason: 'inline', now });
  const t = typeof now === 'number' ? now : Date.now();
  return writeMode(cwd, { ...mode, reason, boundTo, expiresAt: hoursFrom(t, BOUND_EXPIRY_HOURS) });
}

/**
 * Arm an inline mode for this turn — never over an active stronger mode: a
 * branch mode (`reason: 'on'`) or one bound to a running concept / autonomous
 * workflow already covers the turn and outlives it, so replacing it with an
 * inline mode would let the Stop hook release strict at turn end.
 * @param {string} cwd
 * @param {{sessionId?:string, now?:number}} [opts]
 * @returns {{mode:object, kept:boolean}} kept = the existing mode stayed
 */
function armInline(cwd, opts = {}) {
  const existing = readMode(cwd);
  if (existing && existing.reason && existing.reason !== 'inline' && evaluate(cwd, { now: opts.now }).active) {
    return { mode: existing, kept: true };
  }
  return { mode: activate(cwd, { reason: 'inline', sessionId: opts.sessionId, now: opts.now }), kept: false };
}

/** First workflow binding whose state file exists in `cwd`, or null. */
function findBinding(cwd) {
  for (const b of BINDINGS) {
    if (fs.existsSync(path.join(projectRoot(cwd), b.file))) return b;
  }
  return null;
}

/**
 * Is strict active here?
 *
 * @param {string} cwd
 * @param {{branch?:string|null, now?:number, inherit?:boolean}} [opts]
 *   inherit: when no mode exists in cwd, look at the main worktree (agents
 *   spawned with `isolation: worktree` run on a `<parent>-<role>` branch).
 * @returns {{active:boolean, mode:object|null, why:string|null, inherited?:boolean}}
 */
function evaluate(cwd, opts = {}) {
  let mode = readMode(cwd);
  let inherited = false;
  if (!mode && opts.inherit) {
    mode = resolveInherited(cwd);
    inherited = !!mode;
  }
  if (!mode || mode.active !== true) return { active: false, mode: null, why: 'off' };
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  if (mode.expiresAt && now >= Date.parse(mode.expiresAt)) return { active: false, mode, why: 'expired' };
  if (mode.boundTo && !fs.existsSync(path.join(inherited ? mainWorktree(cwd) || projectRoot(cwd) : projectRoot(cwd), mode.boundTo))) {
    return { active: false, mode, why: 'binding-gone' };
  }
  if (!inherited && mode.branch) {
    const b = opts.branch !== undefined ? opts.branch : currentBranch(cwd);
    if (b && b !== mode.branch) return { active: false, mode, why: 'branch-mismatch' };
  }
  return { active: true, mode, why: null, inherited };
}

function isActive(cwd, opts) { return evaluate(cwd, opts).active; }

/**
 * Mode of the main worktree, when this cwd is a sub-worktree on a branch
 * derived from it (`<parent>-<role>` or `<parent>/<role>`).
 */
function resolveInherited(cwd) {
  const main = mainWorktree(cwd);
  if (!main || path.resolve(main) === projectRoot(cwd)) return null;
  const mode = readMode(main);
  if (!mode || mode.active !== true || !mode.branch) return null;
  const b = currentBranch(cwd);
  if (!b) return null;
  if (b.startsWith(`${mode.branch}-`) || b.startsWith(`${mode.branch}/`)) return mode;
  return null;
}

function branchNoticed(cwd, branch) {
  const mode = readMode(cwd);
  return !!(mode && Array.isArray(mode.noticedBranches) && mode.noticedBranches.includes(branch));
}

function markBranchNoticed(cwd, branch) {
  const mode = readMode(cwd);
  if (!mode) return;
  const list = Array.isArray(mode.noticedBranches) ? mode.noticedBranches : [];
  if (!list.includes(branch)) list.push(branch);
  writeMode(cwd, { ...mode, noticedBranches: list });
}

// ── mention detection ──────────────────────────────────────────────────────

/**
 * `/claude-strict` (optionally `/devops:claude-strict`) as its own token:
 * preceded by start-of-string, whitespace or opening punctuation — never a
 * path segment (`docs/claude-strict.md`) and never inside backticks.
 */
const MENTION_RE = /(^|[\s([{"'>])\/(?:devops:)?claude-strict\b/i;
const EXPANDED_NAME_RE = /<command-name>\s*\/?(?:devops:)?claude-strict\s*<\/command-name>/i;
const EXPANDED_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/i;

const ROUTE_WORDS = {
  on: /^(on|an|start|ein)$/i,
  off: /^(off|aus|stop)$/i,
  status: /^status$/i,
};

function routeFor(rest) {
  const trimmed = (rest || '').trim();
  if (!trimmed) return { route: 'status', rest: '' };
  const first = trimmed.split(/\s+/)[0];
  for (const [route, re] of Object.entries(ROUTE_WORDS)) {
    if (re.test(first)) return { route, rest: trimmed.slice(first.length).trim() };
  }
  return { route: 'task', rest: trimmed };
}

/**
 * @param {string} text raw user prompt
 * @returns {{mentioned:boolean, route:'on'|'off'|'status'|'task'|null, rest:string}}
 */
function detectMention(text) {
  const none = { mentioned: false, route: null, rest: '' };
  if (typeof text !== 'string' || !text) return none;

  if (text.includes('<command-name>')) {
    // Expanded slash command: only OUR name counts; a mention inside another
    // command's args is that command's business.
    if (!EXPANDED_NAME_RE.test(text)) return none;
    const argsMatch = text.match(EXPANDED_ARGS_RE);
    const args = argsMatch ? argsMatch[1] : '';
    return { mentioned: true, ...routeFor(args) };
  }

  const m = MENTION_RE.exec(text);
  if (!m) return none;
  const start = m.index + m[1].length;           // index of the '/'
  const end = start + m[0].length - m[1].length;  // just past the token
  if (text[start - 1] === '`' || text[end] === '`') return none;
  return { mentioned: true, ...routeFor(text.slice(end)) };
}

/**
 * Plain-word switch — the WHOLE prompt, so prose never flips the mode:
 * `strict on`, `strikt an`, `strict mode off`, `strikt modus aus`,
 * `strict status`. These exist because a prompt that STARTS with a slash
 * name that is no longer a skill (`/claude-strict on`) may be rejected by the
 * harness before any hook runs (skill-restructure spec § Triggers).
 */
const WORD_SWITCH_RE = /^\s*(?:strict|strikt)(?:[\s-]*(?:mode|modus))?\s+(on|an|ein|start|off|aus|stop|status)\s*[.!]?\s*$/i;
/** Plain-word task: `strict: <task>` / `strikt: <task>` at the prompt start.
 *  `strict: true …` / `strict: false …` is config talk, not a task. */
const WORD_TASK_RE = /^\s*(?:strict|strikt)\s*:\s*(?!(?:true|false)\b)(\S[\s\S]*)$/i;
/** Literal-scope phrases that arm an inline mode wherever they stand in the
 *  user's prose (outside code and quotes). Former claude-strict triggers. */
const LITERAL_SCOPE_PHRASES = Object.freeze(['genau so und nicht mehr', 'nur das ändern', 'nichts anderes anfassen']);
const LITERAL_SCOPE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${LITERAL_SCOPE_PHRASES.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

/** Prompt with fenced code, inline code and quoted strings removed. */
function proseOnly(text) {
  try { return require('./skill-trigger-router').stripCodeAndQuotes(text); }
  catch { return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' '); }
}

/**
 * Every user-facing way to switch strict, in priority order:
 *   1. `/claude-strict …` (typed or expanded slash form) — detectMention;
 *   2. the whole prompt is a plain-word switch (`strict on`, `strikt aus`);
 *   3. `strict: <task>` / `strikt: <task>` at the start → inline task;
 *   4. a literal-scope phrase in the prose → inline task (the whole prompt).
 * Another command's expanded slash prompt only counts through (1).
 * @param {string} text raw user prompt
 * @returns {{mentioned:boolean, route:'on'|'off'|'status'|'task'|null, rest:string, via:'slash'|'word'|'phrase'|null}}
 */
function detectCommand(text) {
  const none = { mentioned: false, route: null, rest: '', via: null };
  if (typeof text !== 'string' || !text) return none;
  const slash = detectMention(text);
  if (slash.mentioned) return { ...slash, via: 'slash' };
  if (text.includes('<command-name>')) return none;

  const sw = WORD_SWITCH_RE.exec(text);
  if (sw) return { mentioned: true, ...routeFor(sw[1]), via: 'word' };

  const task = WORD_TASK_RE.exec(text);
  if (task) return { mentioned: true, route: 'task', rest: task[1].trim(), via: 'word' };

  if (LITERAL_SCOPE_RE.test(proseOnly(text))) {
    return { mentioned: true, route: 'task', rest: text.trim(), via: 'phrase' };
  }
  return none;
}

// ── contract ───────────────────────────────────────────────────────────────

function statusLine(mode, branch) {
  const reason = mode && mode.reason ? mode.reason : 'inline';
  const where = branch ? ` · branch ${branch}` : '';
  const bound = mode && mode.boundTo ? ` · bound to ${mode.boundTo}` : '';
  return `strict: ${reason}${where}${bound} · "strict off" ends it`;
}

/** Status line + contract block, ready for additionalContext. */
function contractText({ mode, branch } = {}) {
  return `${statusLine(mode, branch)}\n${CONTRACT_BLOCK}`;
}

function hasContract(text) {
  return typeof text === 'string' && text.includes(CONTRACT_OPEN);
}

// ── CLI ────────────────────────────────────────────────────────────────────

function cli(argv) {
  const cwd = process.cwd();
  const cmd = argv[0];
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  switch (cmd) {
    case 'on': {
      const mode = activate(cwd, { reason: 'on' });
      out({ ok: true, active: true, reason: mode.reason, branch: mode.branch, path: modePath(cwd) });
      return 0;
    }
    case 'inline': {
      // do-run "Nur das" (and a model-decided arm): arm for this turn/run,
      // never over a stronger mode. The contract is printed ONLY when the mode
      // is verifiably active afterwards — a printed block the model reads as
      // "strict is armed" while no mode file exists would make the Agent gate
      // and the Stop hook silently disagree with it.
      let armed;
      try { armed = armInline(cwd); } catch (err) {
        process.stderr.write(`strict-state inline: could not arm strict mode — ${err && err.message ? err.message : err}\n`);
        return 1;
      }
      const ev = evaluate(cwd);
      if (!ev.active) {
        process.stderr.write(`strict-state inline: mode not active after arming (${ev.why || 'unknown'}) — strict is NOT on\n`);
        return 1;
      }
      const { mode, kept } = armed;
      out({ ok: true, active: true, reason: mode.reason, kept, branch: mode.branch, boundTo: mode.boundTo || null, expiresAt: mode.expiresAt, path: modePath(cwd) });
      process.stdout.write(CONTRACT_BLOCK + '\n');
      return 0;
    }
    case 'off': {
      const had = !!readMode(cwd);
      deactivate(cwd);
      out({ ok: true, active: false, removed: had });
      return 0;
    }
    case 'status': {
      const ev = evaluate(cwd);
      out({
        active: ev.active,
        why: ev.why,
        reason: ev.mode ? ev.mode.reason : null,
        branch: ev.mode ? ev.mode.branch : null,
        currentBranch: currentBranch(cwd),
        boundTo: ev.mode ? ev.mode.boundTo : null,
        expiresAt: ev.mode ? ev.mode.expiresAt : null,
        path: modePath(cwd),
      });
      return 0;
    }
    case 'contract': {
      process.stdout.write(CONTRACT_BLOCK + '\n');
      return 0;
    }
    default:
      process.stderr.write('usage: strict-state.js on|off|status|inline|contract\n');
      return 1;
  }
}

if (require.main === module) {
  process.exit(cli(process.argv.slice(2)));
}

module.exports = {
  MODE_FILE, BINDINGS, INLINE_EXPIRY_HOURS, BOUND_EXPIRY_HOURS,
  CONTRACT_OPEN, CONTRACT_CLOSE, CONTRACT_BLOCK,
  modePath, readMode, deactivate, activate, armInline, bind, findBinding,
  currentBranch, mainWorktree, evaluate, isActive, resolveInherited,
  branchNoticed, markBranchNoticed,
  detectMention, MENTION_RE, detectCommand, LITERAL_SCOPE_PHRASES,
  statusLine, contractText, hasContract,
};
