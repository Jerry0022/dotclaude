#!/usr/bin/env node
'use strict';
/**
 * @module run-contract
 * @version 0.3.0
 * @plugin devops
 * @description State, answer parsing, obligations and CLI of the do-run RUN
 *   CONTRACT: what the user chose in the do-run router (passes, ship mode,
 *   auto-agents, qa, backlog triage + refine) is recorded by hooks and every
 *   tool call that would walk past an open obligation is refused.
 *
 *   Spec: docs/superpowers/specs/2026-09-24-run-contract-design.md (A, B, C, D, J).
 *
 *   This file is a thin FACADE (AUD-016): the state / io / lifecycle lives in
 *   `run-contract-store.js`, the router / follow-up / machine-prompt answer
 *   parsing in `run-contract-answers.js`, the segments / obligations / gate
 *   evaluation / messages in `run-contract-obligations.js`, and the CLI
 *   (`status | skip | park | done | abort | batch-clear | arm`) in
 *   `run-contract-cli.js`. Every export below is re-exported unchanged —
 *   callers (hooks, mcp-server/lib/mode-state.js via hookRequire, tests)
 *   need no changes. This file stays the CLI entry point
 *   (`node run-contract.js status` etc., via the `require.main` guard below).
 *
 * Exports (the hook wave imports these names — kept in sync with the bottom
 * `module.exports`; AUD-016: grep the sibling `run-contract-*.js` files for
 * the implementation of each):
 *   OTHER_PLACEHOLDERS                            the "Other" answer tokens (post.ask.answers imports them)
 *   LIB_PATH / rearmHint()                        this file's path / the `arm` re-arm command line
 *   disabled()                                    → boolean  kill switch on
 *   contractPath(cwd) / eventsPath(cwd) / prevPath(cwd) / pendingPath(cwd) / batchHandoffPath(cwd) → string
 *   readContract(cwd, {now})                      → header | null (active only)
 *   readContractForCard(cwd, {now})               → header | null (active, or closed ≤ 15 min ago)
 *   readRawContract(cwd)                          → header | null (as on disk, no checks)
 *   expiryNotice(cwd, {sessionId, now})           → string | null (once: this session's contract expired unclosed)
 *   claim(cwd, sessionId, {now})                  → header | null (adopts a session-less fresh contract)
 *   arm(cwd, header, {now})                       → header | null (archives an existing one)
 *   update(cwd, patch, {now})                     → header | null
 *   record(cwd, event, {now})                     → event | null (adds t, c; dedupes edit/measure runs; retries once)
 *   close(cwd, reason, {aborted, now})             → header | null
 *   events(cwd)                                   → event[] of the current contract
 *   markPendingArm(cwd, {sessionId, args, now}) / pendingArm(cwd, {now}) / clearPendingArm(cwd)
 *   markBatchHandoff(cwd, {sessionId, now}) / batchHandoffPending(cwd, {now}) / clearBatchHandoff(cwd)
 *   extractAnswers(toolResponse, toolInput)       → {questions, answers}
 *   isRouterCall(questions)                       → boolean
 *   parseRouterAnswers(questions, answers, {doRunArgs}) → header fields | null
 *   isPartialRouterCall(questions)                → boolean (router-shaped, lacks Ablauf / Umfang / Durchgänge)
 *   answeredFields(fields)                        → only the fields a router call answered (R7)
 *   mergeRouterAnswers(cwd, questions, fields, {sessionId, now}) → header | null (R7 merge)
 *   parseFollowUp(questions, answers)             → patch | null
 *   followUpModeHint(questions)                   → 'backlog' | 'audit' | null
 *   applyFollowUp(cwd, patch, {sessionId, now})   → header | null
 *   hasHeader(questions, header)                  → boolean
 *   parseMachinePrompt(text)                      → header fields | null
 *   machinePatch(active, text)                    → patch (a machine prompt over an active contract)
 *   skillName(raw)                                → current skill name
 *   segments(contract, events)                    → event[][]
 *   currentSegment(contract, events)              → event[]
 *   segmentHasWork(seg)                           → boolean
 *   openObligations(contract, events, gate, ctx)  → [{ob, why, fix, item?}]
 *   formatBlock(contract, open, gate, {libPath})  → string (stderr block, spec D)
 *   chosenLine(contract)                          → string ("Backlog · Autonom · Ship automatisch · Harden + Polish")
 *   summaryForCard(contract, events, lang, ctx)   → string | null (card line, spec J)
 *   cli(argv, {cwd, now})                         → exit code (prints one JSON line)
 *
 * Deviations from the spec text (documented in the commit):
 *   - A backlog `branch` event is an item boundary only when the segment holds
 *     an edit or commit; `auto-agents` skill events after the last edit/commit
 *     move into the new segment (auto-agents usually creates the item branch).
 *     The branch gate likewise needs an edit/commit in the segment.
 *   - At release / card gates every segment obligation needs work in the
 *     segment (else the card after a successful release would re-block).
 *   - Events carry the contract id (`c`); `events()` ignores foreign lines.
 *   - The archive holds the header plus its last 200 events.
 *   - `card` events, like `block` / `measure`, are no idle-expiry activity;
 *     `measure` / `block` dedup within the current segment only (H-B5, H-B10).
 *   - The card gate owes `triage` too (backlog + presence) once the
 *     contract has work (H-B2).
 *   - Headers are normalised on read (`sanitize()`, H-B6). A marker read
 *     but unparseable is deleted; a read error keeps it (H-B14, H-B14b).
 *   - Follow-ups: only the exact `Issues` / `Milestones` headers and their
 *     numbered continuations (`Issues 2`, `Issues (2)`, `Issues 2/3`,
 *     `Milestones 2`), merged within one call; an empty / Other answer
 *     leaves the list unchanged (H-B7, RT3-R7).
 *   - A partial router call merges into this session's active contract of
 *     any age (no 30-min window); the post hook arms instead after a fresh
 *     do-run marker and reports an unrecordable one (RT3-R8).
 *   - A `skip` never finishes a backlog item; only `park N` or an ok
 *     release closing #N does (post.run.contract, RT3-R1).
 *   - An unreadable offline card closes a prompt / audit run only with work
 *     and nothing open at the card gate (post.run.contract, RT3-R2).
 *   - An expired, unclosed contract of the session is announced once
 *     (`expiryNotice`, header flag `expiryAnnounced`, RT3-X2).
 *   - Command reading (run-contract-calls.js, RT3): PowerShell assignments,
 *     bash compound one-liners, `{ }` blocks, `iex`, joined continuations,
 *     shell-aware backticks, heredoc bodies as data, a 256 KB parse cap;
 *     `gh api -X PUT …/merge`, `git push +main`, a bare push on main and the
 *     GitHub MCP merge count as releases under `ship: auto`.
 *   - Pending, batch and archive writes and event appends retry once (AUD-009).
 */

const store = require('./run-contract-store');
const answers = require('./run-contract-answers');
const obligations = require('./run-contract-obligations');
const cliModule = require('./run-contract-cli');

module.exports = {
  OTHER_PLACEHOLDERS: answers.OTHER_PLACEHOLDERS, LIB_PATH: store.LIB_PATH, rearmHint: store.rearmHint,
  disabled: store.disabled, contractPath: store.contractPath, eventsPath: store.eventsPath,
  prevPath: store.prevPath, pendingPath: store.pendingPath, batchHandoffPath: store.batchHandoffPath,
  claim: store.claim, applyFollowUp: answers.applyFollowUp, answeredFields: answers.answeredFields,
  isPartialRouterCall: answers.isPartialRouterCall, mergeRouterAnswers: answers.mergeRouterAnswers,
  hasHeader: answers.hasHeader, followUpModeHint: answers.followUpModeHint, machinePatch: answers.machinePatch,
  readContract: store.readContract, readContractForCard: store.readContractForCard, readRawContract: store.readRawContract,
  expiryNotice: store.expiryNotice, arm: store.arm, update: store.update, record: store.record, close: store.close,
  events: store.events,
  markPendingArm: store.markPendingArm, pendingArm: store.pendingArm, clearPendingArm: store.clearPendingArm,
  markBatchHandoff: store.markBatchHandoff, batchHandoffPending: store.batchHandoffPending, clearBatchHandoff: store.clearBatchHandoff,
  extractAnswers: answers.extractAnswers, isRouterCall: answers.isRouterCall, parseRouterAnswers: answers.parseRouterAnswers,
  parseFollowUp: answers.parseFollowUp, parseMachinePrompt: answers.parseMachinePrompt,
  skillName: obligations.skillName, segments: obligations.segments, currentSegment: obligations.currentSegment,
  segmentHasWork: obligations.segmentHasWork, openObligations: obligations.openObligations,
  formatBlock: obligations.formatBlock, chosenLine: obligations.chosenLine, summaryForCard: obligations.summaryForCard,
  cli: cliModule.cli,
};

if (require.main === module) {
  process.exit(cliModule.cli(process.argv.slice(2)));
}
