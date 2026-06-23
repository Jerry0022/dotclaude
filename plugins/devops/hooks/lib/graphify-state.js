'use strict';
/**
 * @lib graphify-state
 * @version 0.1.0
 * @plugin devops
 * @description Consent + session-state helpers for the graphify enforcement
 *   layer (devops-graph). The consent record lives at `.claude/graphify.json`
 *   in the consumer project and is written ONLY after the user explicitly opts
 *   in (consent:true) or out (consent:false) — hooks never write it silently.
 *   Also tracks a per-session "graphify query already ran" flag so the
 *   PreToolUse hard-gate can relent once Claude has consulted the graph.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const CONSENT_REL = path.join('.claude', 'graphify.json');

function consentPath(cwd) {
  return path.join(cwd, CONSENT_REL);
}

/** Parsed consent record, or null if absent/unreadable. Never throws. */
function readState(cwd) {
  try {
    const obj = JSON.parse(fs.readFileSync(consentPath(cwd), 'utf8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/** True iff the user explicitly opted IN for this project. */
function hasConsent(cwd) {
  const s = readState(cwd);
  return !!(s && s.consent === true);
}

/** True iff the user explicitly opted OUT for this project. */
function isDeclined(cwd) {
  const s = readState(cwd);
  return !!(s && s.consent === false);
}

function queryFlagPath(sessionId, cwd) {
  const key = crypto.createHash('md5').update(`${sessionId || 'nosid'}:${cwd}`).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `dotclaude-graphq-${key}.flag`);
}

/** Record that `graphify query` ran this session (relaxes the gate). */
function markQueryDone(sessionId, cwd) {
  try {
    fs.writeFileSync(queryFlagPath(sessionId, cwd), String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** Has `graphify query` already run this session for this project? */
function queryDone(sessionId, cwd) {
  try {
    return fs.existsSync(queryFlagPath(sessionId, cwd));
  } catch {
    return false;
  }
}

/**
 * True iff `cmd` actually RUNS `graphify query` (not merely mentions it).
 * Matches only when a command segment STARTS with `graphify query`, so
 * `echo "graphify query"`, `grep -r "graphify query"`, and commit messages like
 * `git commit -m "add graphify query"` do NOT falsely relent the gate.
 */
function isGraphifyQueryCommand(cmd) {
  if (typeof cmd !== 'string') return false;
  return cmd
    .split(/&&|\|\||[;\n|]/)
    .some((seg) => /^\s*graphify\s+query\b/.test(seg));
}

module.exports = {
  CONSENT_REL,
  consentPath,
  readState,
  hasConsent,
  isDeclined,
  queryFlagPath,
  markQueryDone,
  queryDone,
  isGraphifyQueryCommand,
};
