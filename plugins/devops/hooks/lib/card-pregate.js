/**
 * @module card-pregate
 * @version 0.2.0
 * @plugin devops
 * @description stop.flow.guard's payload gates, checked by
 *   render_completion_card BEFORE it renders.
 *
 *   The Stop gate reads the card after the turn: a title with a status word,
 *   a code-change card without `validation`, a requirement gap or an
 *   undeclared background task each cost a full second render plus its
 *   widget — ~3.5k output tokens per block, 102 blocks in two days
 *   (benchmark 2026-09-27). Every one of these is decidable from the tool's
 *   own input plus the session flags and the transcript, so the tool refuses
 *   the call instead and names what to fix; nothing is rendered or shown.
 *
 *   The Stop gate stays exactly as it is — this is an earlier copy of the
 *   same rules (same regex, same classify(), same transcript scan, same
 *   reason texts), never a replacement. The gates it checks:
 *     3  title status word        (card-guard TITLE_STATUS_WORD_RE on `summary`)
 *     4  validation owed          (validation-pending flag, no `validation`)
 *     4b requirement gaps         (validation-gaps.classify with the open-task count)
 *     5  undeclared background work (pending-tasks scan, no `pending`)
 *   plus stop.flow.browsertest's Light gate (#612):
 *     V  verification owed       (light-pending, no light-verified, no test
 *                                 running in the background, no `verification`
 *                                 skip) — asked BEFORE the card, so a skip
 *                                 lands on the card instead of as prose below it
 *   plus one check of its own (#624):
 *     A  `analysis` after a change — the variant claims nothing changed, but
 *        this turn ran a write-type tool (file edit, implementing agent,
 *        DB write, deploy, delete, push)
 *
 *   One refusal per identical finding: the same findings on the next call
 *   render anyway, so a false positive can never lock the card out — the
 *   Stop gate then decides, as before.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  titleStatusWordViolation, buildTitleStatusWordReason, buildValidationReason,
  buildValidationGapsReason, buildPendingReason, safeReadTranscript, PENDING_TAIL_BYTES,
} = require('./card-guard');
const validationGaps = require('./validation-gaps');
const { scanOpenTasks, openTaskNames } = require('./pending-tasks');
const { readSessionFile, sessionFile, writeSessionFile } = require('./session-id');
const {
  BG_RUN_MAX_MS, parseBackgroundRuns, VERIFICATION_EXEMPT_VARIANTS,
  cardSkipReason, buildCardVerificationReason,
} = require('./browsertest-guard');
const { BGRUN_FLAG } = require('./light-bgrun');
const { isPromptEntry } = require('./skill-invocations');

const EXACT = { exact: true };
const REFUSED_PREFIX = 'dotclaude-devops-card-pregate';

/** The session transcript: ~/.claude/projects/<any>/<sessionId>.jsonl, or null. */
function findTranscript(sessionId, home = os.homedir()) {
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) return null;
  const root = path.join(home, '.claude', 'projects');
  let dirs;
  try { dirs = fs.readdirSync(root); } catch { return null; }
  for (const d of dirs) {
    const p = path.join(root, d, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// #624 — tools whose use means the turn changed something, so `analysis`
// ("nothing changed anywhere") is the wrong card.
const FILE_WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const IMPLEMENTING_AGENT_RE = /(^|:)(core|frontend|feature|ai|designer)$/;
const WRITE_MCP_RE = /(apply_migration|deploy|delete|trash|merge_branch|merge_pull_request|create_or_update_file|push_files)/i;
const SQL_WRITE_RE = /\b(insert|update|delete|drop|alter|truncate|create)\b/i;
const SHELL_WRITE_RE = /(\brm\s|\bgit\s+push\b|\bDELETE\s+FROM\b|\bDROP\s+TABLE\b)/i;

/** The write-type tool a tool_use block counts as, or null. */
function writeToolLabel(block) {
  const name = String(block.name || '');
  const input = block.input && typeof block.input === 'object' ? block.input : {};
  if (FILE_WRITE_TOOLS.has(name)) return name;
  if ((name === 'Agent' || name === 'Task') && IMPLEMENTING_AGENT_RE.test(String(input.subagent_type || ''))) {
    return `${name} ${input.subagent_type}`;
  }
  if (name.startsWith('mcp__')) {
    const short = name.slice(name.lastIndexOf('__') + 2);
    if (/execute_sql/i.test(short)) return SQL_WRITE_RE.test(String(input.query || '')) ? short : null;
    if (WRITE_MCP_RE.test(short)) return short;
    return null;
  }
  if ((name === 'Bash' || name === 'PowerShell') && SHELL_WRITE_RE.test(String(input.command || ''))) return name;
  return null;
}

/**
 * Write-type tools used THIS turn (back to the turn's opening prompt),
 * deduplicated, in first-seen order from the end.
 * @param {string} transcript raw JSONL
 * @returns {string[]}
 */
function writeToolsThisTurn(transcript) {
  if (typeof transcript !== 'string' || !transcript) return [];
  const seen = new Set();
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type === 'user') {
      if (isPromptEntry(entry)) break;
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      const label = writeToolLabel(block);
      if (label) seen.add(label);
    }
  }
  return [...seen];
}

function buildAnalysisWriteReason(tools) {
  return [
    `[stop.flow.guard] Variant \`analysis\` but this turn changed something: ${tools.join(', ')}.`,
    '`analysis` means nothing changed anywhere — an answer or an investigation (#624).',
    'Work done outside the repo (DB op, delete, deploy, migration, settings) → `fallback`;',
    'implementation handed to agents still running → `ready`/`test` + `pending`;',
    'a mode activation (batch, concept) → its override. Pick the right variant and render again;',
    'if `analysis` really is right, the same call renders on the next try.',
  ].join('\n');
}

/**
 * The gate findings for a card payload. Pure apart from what it is handed.
 *
 * @param {object} input            — the render_completion_card params
 * @param {object} ctx
 * @param {boolean} ctx.validationPending — the session owes a validation (flag)
 * @param {string[]|null} ctx.openTasks   — running background work by name; null = unknown
 * @param {null|{ kind?: string, red?: boolean }} ctx.verificationOwed — the Light
 *   check is owed and no test runs in the background (flags); null = not owed
 * @param {string[]} ctx.writeTools — write-type tools used this turn (#624)
 * @returns {string[]} one reason per failed gate (card-guard wording)
 */
function findings(input, { validationPending = false, openTasks = null, verificationOwed = null, writeTools = [] } = {}) {
  const out = [];
  const word = titleStatusWordViolation(String(input.summary || ''));
  if (word) out.push(buildTitleStatusWordReason(word));

  const validation = Array.isArray(input.validation) ? input.validation : [];
  if (validationPending && validation.length === 0) out.push(buildValidationReason());

  if (!validationGaps.GAP_EXEMPT_VARIANTS.has(input.variant)) {
    const open = validationGaps.openItems(validation);
    if (open.length) {
      const { gaps } = validationGaps.classify(open, { openTasks: openTasks === null ? null : openTasks.length });
      if (gaps.length) out.push(buildValidationGapsReason(gaps, openTasks || []));
    }
  }

  const pending = Array.isArray(input.pending) ? input.pending.filter(Boolean) : [];
  if (openTasks && openTasks.length > 0 && pending.length === 0) out.push(buildPendingReason(openTasks));

  if (verificationOwed && !VERIFICATION_EXEMPT_VARIANTS.has(input.variant) && !cardSkipReason(input)) {
    out.push(buildCardVerificationReason(verificationOwed.kind, { red: verificationOwed.red === true }));
  }

  if (input.variant === 'analysis' && Array.isArray(writeTools) && writeTools.length > 0) {
    out.push(buildAnalysisWriteReason(writeTools));
  }
  return out;
}

/**
 * The Light check this session still owes, read from stop.flow.browsertest's
 * flags — or null. A test still running in the background owes nothing yet:
 * its result settles it (light-bgrun, BG_RUN_MAX_MS).
 */
function readVerificationOwed(sessionId) {
  const flag = (name) => readSessionFile(`dotclaude-devops-${name}`, sessionId, EXACT);
  if (!flag('light-pending') || flag('light-verified')) return null;
  const bgrun = readSessionFile(BGRUN_FLAG, sessionId, EXACT);
  if (bgrun) {
    const now = Date.now();
    if (parseBackgroundRuns(bgrun.content).some(r => now - r.at < BG_RUN_MAX_MS)) return null;
  }
  const kind = flag('light-kind');
  return { kind: (kind && kind.content.trim()) || 'any', red: flag('light-red') !== null };
}

/**
 * Decide whether render_completion_card refuses this call.
 * @returns {{ refuse: false } | { refuse: true, text: string }}
 */
function check(input, { home, tmp } = {}) {
  const sessionId = input && input.session_id;
  if (!sessionId || sessionId === 'unknown') return { refuse: false };
  // Render tests draw cards with gaps on purpose; the Stop gate is unaffected.
  if (process.env.DEVOPS_CARD_PREGATE === '0') return { refuse: false };
  try {
    const validationPending = readSessionFile('dotclaude-devops-validation-pending', sessionId, EXACT) !== null;
    const transcriptPath = findTranscript(sessionId, home);
    const transcript = transcriptPath ? safeReadTranscript(transcriptPath, PENDING_TAIL_BYTES) : '';
    const openTasks = transcript ? openTaskNames(scanOpenTasks(transcript)) : null;
    const verificationOwed = readVerificationOwed(sessionId);
    const writeTools = writeToolsThisTurn(transcript);
    const reasons = findings(input, { validationPending, openTasks, verificationOwed, writeTools });

    const file = tmp ? path.join(tmp, `${REFUSED_PREFIX}-${sessionId}`) : sessionFile(REFUSED_PREFIX, sessionId);
    if (reasons.length === 0) {
      try { fs.unlinkSync(file); } catch { /* none */ }
      return { refuse: false };
    }
    const sig = crypto.createHash('sha1').update(reasons.join('\n')).digest('hex');
    let prev = null;
    try { prev = fs.readFileSync(file, 'utf8').trim(); } catch { /* first time */ }
    if (prev === sig) {
      try { fs.unlinkSync(file); } catch { /* gone */ }
      return { refuse: false }; // same findings twice: render; the Stop gate decides
    }
    writeSessionFile(file, sig);
    return { refuse: true, text: refusalText(reasons) };
  } catch {
    return { refuse: false }; // never lose a card to the pre-check
  }
}

function refusalText(reasons) {
  const head = [
    '[card-pregate] Not rendered — this card would be blocked by stop.flow.guard after the turn.',
    'Fix the call and render again (nothing was shown, no widget is owed):',
  ];
  const body = reasons.length === 1
    ? [reasons[0]]
    : reasons.map((r, i) => `(${i + 1}/${reasons.length}) ${r}`);
  return [...head, '', ...body].join('\n').replace(/\[stop\.flow\.guard\] /g, '');
}

module.exports = { check, findings, findTranscript, readVerificationOwed, refusalText, writeToolsThisTurn, REFUSED_PREFIX };
