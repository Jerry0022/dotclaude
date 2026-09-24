'use strict';
/**
 * @module run-contract-calls
 * @version 0.1.0
 * @plugin devops
 * @description What a tool call MEANS for the run contract — shared by
 *   pre.run.contract (gates) and post.run.contract (recording) so both read a
 *   call the same way. Pure parsing plus two small fs reads (card payload,
 *   transcript tail); no git, no contract state.
 *
 *   commandFacts(cmd)          → {commit, branch, branchName, renderCard}
 *   toolFilePath(tool, input)  → string | null
 *   isGatedPath(root, cwd, p)  → boolean (inside the work tree, not exempt)
 *   closesOf(body)             → ["473", …] from "Closes #473" / "Fixes #…"
 *   cardFacts(input)           → {variant, final}
 *   readCardPayload(file, cwd) → object | null
 *   releaseResult(response)    → {ok, merged} | null
 *   routerFromTranscript(transcriptPath, sinceIso) → {questions, answers, followUps[]} | null
 *   baseBranch(root, newName, after) → string | null  (git, 3 s timeout)
 *   isItemBranch(facts, hook, current) → boolean (backlog item boundary, R6)
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

/** Leading `(`, `{`, `VAR=value ` and `sudo ` removed from one segment. */
function bareSegment(seg) {
  let s = seg.trim().replace(/^[({\s]+/, '');
  for (;;) {
    const next = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '').replace(/^sudo\s+/, '');
    if (next === s) return s;
    s = next;
  }
}

const GIT_RE = /^git(?:\s+-[cC]\s+\S+)*\s+(\S+)(.*)$/s;

/**
 * Facts of a Bash / PowerShell command line.
 * @param {string} cmd
 * @returns {{commit:boolean, branch:boolean, branchName:string|null, renderCard:string|null}}
 */
function commandFacts(cmd) {
  const out = { commit: false, branch: false, branchName: null, renderCard: null, worktree: false, detach: false };
  if (typeof cmd !== 'string' || !cmd.trim()) return out;
  const rc = cmd.match(/index\.js["']?\s+--render-card\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (rc) out.renderCard = rc[1] || rc[2] || rc[3];
  const segs = stripQuotes(cmd).split(/&&|\|\||[;|\n]/);
  const rawSegs = cmd.split(/&&|\|\||[;|\n]/);
  segs.forEach((seg, i) => {
    const m = bareSegment(seg).match(GIT_RE);
    if (!m) return;
    const sub = m[1];
    const rest = m[2] || '';
    if (sub === 'commit' && !/(^|\s)--dry-run\b/.test(rest)) out.commit = true;
    let name = null;
    let hit = false;
    const raw = rawSegs.length === segs.length ? bareSegment(rawSegs[i]) : bareSegment(seg);
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
  });
  return out;
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
};
