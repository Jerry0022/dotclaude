'use strict';
/**
 * @module dispatch/merge
 * @version 0.1.0
 * @plugin devops
 * @description Folds the results of an event's modules into the ONE reply the
 *   dispatcher process gives Claude Code, so that Claude Code reacts exactly
 *   as it did to the separate hook processes. The rules follow Claude Code
 *   2.1.270's hook runner (read from the shipped binary):
 *     - a hook's stdout is JSON when its trimmed text starts with `{` and
 *       parses; otherwise it is plain text
 *     - JSON is honoured whatever the exit code; with exit 2 and no JSON
 *       verdict, stderr becomes the blocking error; a JSON verdict
 *       (`decision:"block"`, `permissionDecision:"deny"`) REPLACES the exit-2
 *       stderr of the same reply — so a merged exit-2 reply never carries a
 *       JSON verdict
 *     - plain stdout on exit 0 reaches the model only for SessionStart and
 *       UserPromptSubmit; plain stdout with any other exit code is dropped
 *     - permission precedence across hooks: deny > defer > ask > allow
 *     - every hook's blocking error, systemMessage and additionalContext is
 *       delivered (none short-circuits another)
 *
 *   Merge table (one test per row in merge.test.js):
 *   | inputs                                   | merged reply                                   |
 *   |------------------------------------------|------------------------------------------------|
 *   | nothing written, all exit 0              | no output, exit 0                              |
 *   | exactly one module wrote/failed          | that module's stdout, stderr, exit code verbatim |
 *   | several plain stdouts, no JSON           | plain texts joined by "\n", exit 0             |
 *   | several additionalContext (+ plain on    | one additionalContext, parts joined by "\n\n"  |
 *   |   SessionStart/UserPromptSubmit)         |   in manifest order                            |
 *   | several systemMessage                    | joined by "\n"                                 |
 *   | any exit 2                               | exit 2; stderr = every exit-2 stderr + every   |
 *   |                                          |   JSON block/deny reason, joined "\n\n"; stdout|
 *   |                                          |   JSON keeps only non-verdict fields (context, |
 *   |                                          |   systemMessage, continue/stopReason, …)       |
 *   | JSON decision:"block" (no exit 2)        | decision:"block", reasons joined "\n\n"        |
 *   | PreToolUse permissionDecision mix        | deny > defer > ask > allow; reasons of the     |
 *   |                                          |   winning decision joined; updatedInput only   |
 *   |                                          |   with an allow/ask winner                     |
 *   | continue:false anywhere                  | continue:false, stopReasons joined "\n"        |
 *   | other hookSpecificOutput keys            | booleans OR-ed, other values first wins        |
 *   | exit 1 (non-blocking error) + JSON       | the JSON is merged (Claude Code honours it)    |
 *   | exit 1 + plain stdout                    | stdout dropped, stderr kept on exit-0 stderr   |
 *   | timed out / skipped module               | contributes nothing (a killed hook today)      |
 *   | top-level decision:"approve"             | PreToolUse: allow; elsewhere kept as approve   |
 */

const PLAIN_IS_CONTEXT = new Set(['SessionStart', 'UserPromptSubmit']);
const PERMISSION_RANK = { deny: 4, defer: 3, ask: 2, allow: 1 };

function parseJson(stdout) {
  const t = String(stdout || '').trim();
  if (!t.startsWith('{')) return null;
  try {
    const j = JSON.parse(t);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch { return null; }
}

function str(v) { return typeof v === 'string' ? v : ''; }

/**
 * @typedef {{name:string, code:number, stdout:string, stderr:string, timedOut?:boolean, skipped?:boolean}} ModuleResult
 * @param {string} event
 * @param {ModuleResult[]} results in manifest order
 * @returns {{code:number, stdout:string, stderr:string}}
 */
function mergeResults(event, results) {
  const ran = results.filter((r) => r && !r.timedOut && !r.skipped);
  const relevant = ran.filter((r) => String(r.stdout || '').trim() || (r.code || 0) !== 0);
  const quietStderr = ran.filter((r) => !relevant.includes(r) && str(r.stderr).trim()).map((r) => r.stderr.trim());

  if (!relevant.length) {
    return { code: 0, stdout: '', stderr: quietStderr.length ? `${quietStderr.join('\n')}\n` : '' };
  }
  if (relevant.length === 1) {
    const r = relevant[0];
    const code = r.code || 0;
    let stderr = str(r.stderr);
    if (code !== 2 && quietStderr.length) stderr = [stderr.trim(), ...quietStderr].filter(Boolean).join('\n') + '\n';
    return { code, stdout: str(r.stdout), stderr };
  }

  const isPre = event === 'PreToolUse';
  const anyExit2 = relevant.some((r) => r.code === 2);
  const blockTexts = [];
  const contexts = [];
  const systemMessages = [];
  const stopReasons = [];
  const plains = [];
  const errStderr = [];
  const perms = []; // {decision, reason, updatedInput}
  const loneUpdatedInputs = [];
  const extraHso = {};
  let anyJson = false;
  let stopContinue = false;
  let approve = false;
  let suppressAll = true;

  for (const r of relevant) {
    const code = r.code || 0;
    const json = parseJson(r.stdout);
    if (code === 2) blockTexts.push(str(r.stderr).trim() || 'No stderr output');
    else if (str(r.stderr).trim()) errStderr.push(r.stderr.trim());
    if (!json) {
      const plain = str(r.stdout).trim();
      if (plain && code === 0) plains.push(plain);
      continue;
    }
    anyJson = true;
    if (json.suppressOutput !== true) suppressAll = false;
    if (json.continue === false) {
      stopContinue = true;
      if (str(json.stopReason)) stopReasons.push(json.stopReason);
    }
    if (str(json.systemMessage)) systemMessages.push(json.systemMessage);
    const hso = json.hookSpecificOutput && typeof json.hookSpecificOutput === 'object' ? json.hookSpecificOutput : {};
    if (str(hso.additionalContext)) contexts.push(hso.additionalContext);

    // the module's verdict
    let decision = null;
    let reason = '';
    if (json.decision === 'block') { decision = 'deny'; reason = str(json.reason); }
    else if (json.decision === 'approve') { decision = 'allow'; reason = str(json.reason); approve = true; }
    if (isPre && PERMISSION_RANK[hso.permissionDecision]) {
      decision = hso.permissionDecision;
      reason = str(hso.permissionDecisionReason) || str(json.reason);
    }
    if (decision) perms.push({ decision, reason, updatedInput: hso.updatedInput, block: decision === 'deny' });
    else if (hso.updatedInput && typeof hso.updatedInput === 'object') loneUpdatedInputs.push(hso.updatedInput);

    for (const [k, v] of Object.entries(hso)) {
      if (['hookEventName', 'additionalContext', 'permissionDecision', 'permissionDecisionReason', 'updatedInput'].includes(k)) continue;
      if (typeof v === 'boolean') extraHso[k] = extraHso[k] === true || v;
      else if (!(k in extraHso)) extraHso[k] = v;
    }
  }

  const plainContext = PLAIN_IS_CONTEXT.has(event);
  const useJson = anyJson || (anyExit2 && plainContext && plains.length > 0);
  if (useJson && plainContext) {
    // plain stdout of these events is model context — keep it, as context, in order
    contexts.length = 0;
    for (const r of relevant) {
      const json = parseJson(r.stdout);
      if (json) {
        const hso = json.hookSpecificOutput && typeof json.hookSpecificOutput === 'object' ? json.hookSpecificOutput : {};
        if (str(hso.additionalContext)) contexts.push(hso.additionalContext);
      } else if ((r.code || 0) === 0 && str(r.stdout).trim()) contexts.push(r.stdout.trim());
    }
  }

  const out = {};
  const hsoOut = {};
  let code = 0;
  let stderr = '';

  if (anyExit2) {
    for (const p of perms) if (p.block) blockTexts.push(p.reason || 'Blocked by hook');
    code = 2;
    stderr = `${blockTexts.join('\n\n')}\n`;
  } else if (perms.length) {
    const top = perms.reduce((m, p) => Math.max(m, PERMISSION_RANK[p.decision]), 0);
    const winners = perms.filter((p) => PERMISSION_RANK[p.decision] === top);
    const decision = winners[0].decision;
    const reasons = winners.map((p) => p.reason).filter(Boolean);
    if (isPre) {
      hsoOut.permissionDecision = decision;
      if (reasons.length) hsoOut.permissionDecisionReason = reasons.join('\n\n');
      if (decision === 'allow' || decision === 'ask') {
        const ui = Object.assign({}, ...winners.map((p) => (p.updatedInput && typeof p.updatedInput === 'object' ? p.updatedInput : {})));
        if (Object.keys(ui).length) hsoOut.updatedInput = ui;
      }
    } else if (decision === 'deny') {
      out.decision = 'block';
      out.reason = reasons.join('\n\n') || 'Blocked by hook';
    } else if (approve) {
      out.decision = 'approve';
      if (reasons.length) out.reason = reasons.join('\n\n');
    }
  }
  if (!anyExit2 && !hsoOut.updatedInput && loneUpdatedInputs.length && !(isPre && hsoOut.permissionDecision === 'deny')) {
    hsoOut.updatedInput = Object.assign({}, ...loneUpdatedInputs);
  }

  if (!useJson) {
    // plain texts only (or plain + exit 2): keep the plain channel
    const stdout = !anyExit2 && plains.length ? `${plains.join('\n')}\n` : '';
    if (!anyExit2 && errStderr.length) stderr = `${errStderr.join('\n')}\n`;
    return { code, stdout, stderr };
  }

  // plain stdout of other events is transcript-only: dropped next to JSON
  if (contexts.length) hsoOut.additionalContext = contexts.join('\n\n');
  Object.assign(hsoOut, extraHso);
  if (stopContinue) {
    out.continue = false;
    if (stopReasons.length) out.stopReason = stopReasons.join('\n');
  }
  if (suppressAll && anyJson) out.suppressOutput = true;
  if (systemMessages.length) out.systemMessage = systemMessages.join('\n');
  if (Object.keys(hsoOut).length) out.hookSpecificOutput = { hookEventName: event, ...hsoOut };
  if (!anyExit2 && errStderr.length) stderr = `${errStderr.join('\n')}\n`;
  return { code, stdout: Object.keys(out).length ? `${JSON.stringify(out)}\n` : '', stderr };
}

module.exports = { mergeResults, parseJson, PLAIN_IS_CONTEXT, PERMISSION_RANK };
