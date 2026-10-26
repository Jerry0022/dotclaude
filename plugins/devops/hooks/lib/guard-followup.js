'use strict';
/**
 * @module guard-followup
 * @description Did a token-guard block make the next call cheaper? `mark` leaves
 *   a small pending note when the guard blocks; `check` (first thing in the next
 *   guard run) compares the following call with it and logs op `narrowed` when
 *   it is demonstrably narrower (Read with limit, Grep/Glob scoped by path or
 *   head_limit, Bash with a head/tail/count cut). That the follow-up WAS
 *   narrower is a fact (`estimate:false`); the tokens figure stays an upper
 *   bound (blocked estimate minus the narrow call's own estimate). An identical
 *   retry logs nothing (the guard logs `released`). Never throws.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const TOKENS_PER_LINE = 12;

function pendingFile(cwd) {
  const h = crypto.createHash('sha1').update(String(cwd)).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `devops-guard-pending-${h}.json`);
}

function sameCall(a, b) {
  return a.tool === b.tool && JSON.stringify(a.input) === JSON.stringify(b.input);
}

function trim(p) { return String(p).replace(/[\\/]+$/, ''); }

/** @returns {{by:string, newEst:number}|null} how the call is narrower, null if not */
function narrowing(tool, input, cwd) {
  const i = input || {};
  if (tool === 'Read') {
    const n = Number(i.limit);
    return n > 0 ? { by: 'limit', newEst: n * TOKENS_PER_LINE } : null;
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const scoped = i.path && i.path !== '.' && i.path !== '/' && trim(path.resolve(cwd, i.path)) !== trim(path.resolve(cwd));
    if (scoped) return { by: 'path', newEst: 2000 };
    if (Number(i.head_limit) > 0) return { by: 'head_limit', newEst: Number(i.head_limit) * 30 };
    return null;
  }
  if (tool === 'Bash') {
    const cmd = String(i.command || '');
    if (/\|\s*(head|tail)\b|\s-n\s*\d+|--max-count|\s-\d+\b|\s-m\s*\d+/.test(cmd)) return { by: 'cut', newEst: 2000 };
  }
  return null;
}

function mark(cwd, tool, input, estTokens, kind) {
  try {
    fs.writeFileSync(pendingFile(cwd), JSON.stringify({ ts: Date.now(), tool, input, estTokens, kind }));
  } catch { /* never blocks */ }
}

/** @returns {boolean} true when a `narrowed` line was logged */
function check(cwd, tool, input, log) {
  try {
    const file = pendingFile(cwd);
    if (!fs.existsSync(file)) return false;
    let p;
    try { p = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { p = null; }
    try { fs.unlinkSync(file); } catch { /* gone */ }
    if (!p || Date.now() - p.ts > TTL_MS) return false;
    if (sameCall(p, { tool, input })) return false;
    const search = t => t === 'Grep' || t === 'Glob';
    if (p.tool !== tool && !(search(p.tool) && search(tool))) return false;
    const n = narrowing(tool, input, cwd);
    if (!n) return false;
    const saved = Math.max(0, Math.round(p.estTokens - n.newEst));
    if (!saved) return false;
    log('narrowed', saved, { tool, blockedTool: p.tool, kind: p.kind, narrowedBy: n.by, estimate: false, measured: 'followup' });
    return true;
  } catch {
    return false;
  }
}

module.exports = { mark, check, narrowing, pendingFile };
