#!/usr/bin/env node
/**
 * @hook pre.tokens.guard
 * @version 0.13.0
 * @event PreToolUse
 * @plugin devops
 * @description Block Read/Bash/Glob/Grep operations that would consume a
 *   significant percentage of the ~200K context window. Threshold scales
 *   with the user's Claude plan (pro/max_5/max_20). Uses a flag-file
 *   mechanism: first call blocks with warning, retry allows through.
 *
 *   For Bash, a large file only counts when a command actually READS it
 *   (`hooks/lib/bash-context-cost`): passing the path as an argument — a
 *   server start, `ls`, `mv`, `echo` — costs nothing. Unrecognised command
 *   heads stay costly (fail safe); the one relaxation is a detached
 *   `run_in_background` non-reader. Any failure in that classification
 *   falls back to the pre-0.9 substring match rather than failing open. Every
 *   Bash cost estimate is also capped at what the harness can put into
 *   context (`BASH_MAX_OUTPUT_LENGTH`, default 30000 chars) — a command that
 *   only PASSES a huge file's path was measured estimating that file's full
 *   on-disk size even after being correctly classified as free of read cost.
 *   R10: at the harness's REAL default (30000 chars → a 7500-token cap on
 *   pro/max_5/max_20's usual thresholds), this branch therefore CANNOT block
 *   at all — every capped estimate sits below every plan's threshold. It
 *   only blocks once a user raises `BASH_MAX_OUTPUT_LENGTH` themselves. The
 *   code is kept as-is (a raised limit is a real, if uncommon, configuration;
 *   see `pre.tokens.guard.bash.test.js`'s dedicated cap describe block for
 *   the raised-limit coverage) rather than removed.
 *
 *   Grep only (never Glob) carries a separate graphify "answer-in-gate": an
 *   ELIGIBLE search (see `hooks/lib/graph-nudge.isEligibleSearch`) is
 *   answered from the knowledge graph directly instead of merely blocked —
 *   see the gate section below for the full policy.
 *
 *   The retry flag is keyed on the cost-determining fields plus cwd, so a
 *   reworded `description` or a flipped `run_in_background` no longer
 *   defeats "retry to proceed", and a block in one project no longer
 *   pre-authorises another.
 *
 *   Session-start injection: on the FIRST broad Grep/Glob (no `path`) of a
 *   session, attaches orientation as additionalContext and ALLOWS the search,
 *   so Claude can scope subsequent calls with a `path` instead of only being
 *   nagged after a block. Injected at most once per session (temp flag); later
 *   broad searches still hit the normal block. The injection combines:
 *     - `.claude/project-map.md` (file-structure re-scoping hint), and
 *     - an ambient graphify nudge when `graphify-out/graph.json` exists
 *       (steer toward `graphify query` over grepping — see hooks/lib/graph-nudge).
 *   Fires if EITHER source is present.
 */

// Every sibling require here is guarded. A consumer's plugin cache can update
// this hook before (or without) a lib landing; an unguarded throw would exit
// non-2, which PreToolUse treats as non-blocking, so the guard would fail OPEN
// on every tool call while printing a stack trace each time.
try { require('../lib/plugin-guard'); } catch { process.exit(0); }

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const cwd = process.cwd();
const CONFIG_DIR = path.join(cwd, '.claude');
const CONFIG_PATH = path.join(CONFIG_DIR, 'token-config.json');

// Note: background graphify spawns (self-heal refresh) go through
// `gstate.bgWithSentinel` (hooks/lib/graphify-state.js) rather than a local
// bg() helper — it wraps the same detached/stdio:'ignore' spawn shape but
// also records ok/fail to a sentinel file so a silent failure (Gap #5) can
// be surfaced at the next SessionStart instead of vanishing.

let PLAN_DEFAULTS;
try {
  PLAN_DEFAULTS = require('../lib/plan-defaults');
} catch {
  PLAN_DEFAULTS = {
    pro:    { estimatedLimitTokens: 200000, confirmThresholdPct: 0.05 },
    max_5:  { estimatedLimitTokens: 200000, confirmThresholdPct: 0.08 },
    max_20: { estimatedLimitTokens: 200000, confirmThresholdPct: 0.10 },
  };
}
// Falls back to the pre-0.9 substring match rather than failing open.
let bashCost = null;
try { bashCost = require('../lib/bash-context-cost'); } catch { /* fallback below */ }

// Telemetry only — never lets a metrics failure affect the guard's verdict.
let metricsLib = null;
try { metricsLib = require('../lib/graphify-metrics'); } catch { /* telemetry unavailable */ }
function recordMetric(event, extra, ctx) {
  try { if (metricsLib) metricsLib.record(event, extra, ctx); } catch { /* fail-silent */ }
}

// A confirmation is meant to cover the retry that follows seconds later, not
// to pre-authorise the same command indefinitely. Without an expiry the flag
// would silently approve a command the user abandoned weeks ago.
// Accepted: a forward clock jump larger than this window costs one extra
// retry. That is the harmless direction — the alternative is a stale approval.
const CONFIRM_TTL_MS = 30 * 60 * 1000;

/** Pre-0.9 behaviour: any expensive path mentioned anywhere counts. */
function substringMatch(cmd, expensiveFiles) {
  const matched = [];
  for (const ef of expensiveFiles) {
    if (ef && ef.path && cmd.includes(ef.path)) {
      matched.push({ path: ef.path, tokens: ef.estimatedTokens || 20000 });
    }
  }
  return matched;
}

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // Ensure plan-specific limits are applied even if config was written
    // before plan-awareness existed (migration from v0.1 configs)
    if (cfg.estimatedLimitTokens === 1000000) {
      const plan = cfg.plan || 'max_20';
      const defaults = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.max_20;
      cfg.estimatedLimitTokens = defaults.estimatedLimitTokens;
      cfg.confirmThresholdPct = defaults.confirmThresholdPct;
    }
    // A hand-edited config must never crash the guard downstream.
    if (!Array.isArray(cfg.expensiveFiles)) cfg.expensiveFiles = [];
    return cfg;
  } catch {
    // No config yet — use most conservative defaults (pro)
    const defaults = PLAN_DEFAULTS.pro;
    return { ...defaults, tokensPerByte: 0.25, expensiveFiles: [] };
  }
}

function flagPath(key) {
  const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `claude_confirm_${hash}.flag`);
}

// The graphify-query spawn mechanism (shell:false-first, strict-quoted-shell
// ENOENT fallback) lives in its own lib — see hooks/lib/graphify-query-spawn
// for why (unit-testable with a real spawnable `.js` stub, not just the live
// binary) — and is lazy-required alongside graph-nudge/graphify-state below,
// after the cheap pre-filter, so it costs nothing on the hot path.

/**
 * The subset of a tool input that actually determines the token cost, in a
 * fixed key order. Everything else (`description`, `run_in_background`,
 * `timeout`) is noise that used to break the retry-to-proceed release.
 */
function costFields(toolName, toolInput) {
  switch (toolName) {
    case 'Read':
      return { file_path: toolInput.file_path || '', limit: toolInput.limit || 0, offset: toolInput.offset || 0 };
    case 'Bash':
      return { command: toolInput.command || '' };
    case 'Glob':
      return { pattern: toolInput.pattern || '', path: toolInput.path || '' };
    case 'Grep':
      return {
        pattern: toolInput.pattern || '',
        path: toolInput.path || '',
        glob: toolInput.glob || '',
        type: toolInput.type || '',
        output_mode: toolInput.output_mode || '',
      };
    default:
      return { tool: toolName };
  }
}

// Read hook input from stdin
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  const toolInput = hook.tool_input || {};
  const cfg = loadConfig();
  const LIMIT = cfg.estimatedLimitTokens;
  const THRESHOLD = Math.round(LIMIT * (cfg.confirmThresholdPct || 0.02));

  let estimatedTokens = 0;
  let description = '';
  // Kept local — never written back onto toolInput. The retry flag key is
  // derived from the tool input, so mutating it here used to change the key
  // between the block and the retry and the confirmation never released.
  let verboseSuggestion = '';
  let matchedFilesOut = null;

  // ── graphify answer-in-gate (Grep only; enabled + graph within tolerance) ─
  // Graphify is default-ON (opt-out — see gstate.isEnabled): unless the user
  // has explicitly disabled it (.claude/graphify.json or ~/.claude/graphify.json
  // {"consent":false}), an ELIGIBLE Grep (graphNudge.isEligibleSearch — Glob
  // is NOT eligible at all here, it keeps only the classic broad-search block
  // below) is answered from the graph itself instead of merely blocked: the
  // hook runs `graphify query "<terms>" --budget 400` (argv array, shell:false
  // — see hooks/lib/graphify-query-spawn for why that is load-bearing, not
  // cosmetic), hard-timeout ~4s. A real answer (`Traversal: … | N nodes found`, N>0)
  // blocks the search and puts that answer directly in the message — usable
  // without Claude making a second call. No answer, a timeout, a spawn error,
  // or the machine-wide query slot being busy ALLOWS the search silently.
  //
  // HOT PATH: this runs before every Grep, so the cheap/pure checks below
  // (tool name, session id present, pattern shape, path/output_mode shape) run
  // FIRST with zero `require()`s beyond the Node builtins already loaded at
  // the top of this file and at most nothing more than that — no stat, no
  // `require('../lib/graph-nudge')` — so the overwhelming majority of Grep
  // calls (and 100% of Glob calls, which skip this whole block) pay close to
  // nothing extra. `graph-nudge`/`graphify-state`/`graphify-metrics` are
  // lazy-required, and `resolveGraphJson`/`stalenessInfo` (which walks the
  // whole tree) only ever run, once that cheap pre-filter passes.
  //
  // Runs BEFORE the per-tool threshold estimation below, deliberately: an
  // eligible Grep scoped to an existing DIRECTORY (not a `path`-less "broad"
  // search) is still worth answering from the graph even though it would
  // never trip the classic full-repo-search threshold block on its own — so
  // this must not sit behind that block's early `process.exit(0)`.
  //
  // BOUNDED-tolerance gate, not a strict fresh/stale one: a graph that lags a
  // small number of files behind the working tree is still useful, so the
  // gate still enforces on it (with a disclosure line + a kicked background
  // refresh) — see GRAPHIFY_STALE_TOLERANCE below. It must NEVER force Claude
  // onto a graph whose staleness cannot be bounded at all (missing, truncated
  // scan, nothing comparable — stalenessInfo reports newerCount:Infinity for
  // all of these); that self-heals silently instead. Safety properties:
  //   1. Escape hatch — block at most once per (session, search); a retry of
  //      the same search falls through (gate_bypassed) and ALSO pre-releases
  //      the classic confirm flag for the same key, but ONLY when that search
  //      is path-less/`.`/`/` — the only shapes the classic check itself ever
  //      acts on (R6/R8 — without this, a bypassed gate fell straight into
  //      the classic full-repo-search threshold block a SECOND time).
  //   2. Declined marker — a query that timed out, had no hit, errored, or
  //      was skipped for a busy concurrency slot is NOT a block, so it must
  //      not leave the escape-hatch flag unwritten AND undeclared: a retry of
  //      that exact search would otherwise re-run the query from scratch,
  //      which can flip the outcome between the two calls — live-observed as
  //      a path-less search that timed out on call 1 and was BLOCKED on the
  //      identical call 2 (R1). The declined marker (gstate.markDeclined/
  //      getDeclined, same ~12h TTL) makes a repeat of that exact search skip
  //      the query entirely — zero latency — and is deliberately inert: no
  //      gate_bypassed, no streak movement, no classic-flag pre-write.
  //   3. Both the escape-hatch flag AND the declined marker are checked
  //      immediately after eligibility (R3/R4) — before `isEnabled`,
  //      `resolveGraphJson`, or `stalenessInfo` (a full directory walk) ever
  //      run — so a retry of an already-decided search costs next to nothing,
  //      and the graph cannot be rewritten mid-retry in a way that changes
  //      the outcome. The graph is also resolved exactly ONCE per invocation
  //      (previously re-resolved by `hasGraph`, `stalenessInfo`, and the
  //      query's own `--graph` argument separately) and threaded through.
  //   4. Adaptive relent — 3 consecutive bypasses with no accepted answer in
  //      between (tracked ACROSS different searches via gstate's
  //      last-blocked record, not just retries of one) disables the gate for
  //      the rest of the session (gate_relented). The streak only advances on
  //      the FIRST bypass of a given block (R2) — repeating an
  //      already-bypassed retry must not keep inflating it, or one search
  //      retried three times relents the gate as if three DIFFERENT searches
  //      had each declined an answer.
  //   5. The gate flag itself is only ever WRITTEN when a real block happens
  //      (never on a no-answer or a busy-slot skip) — writing it
  //      unconditionally used to let a single no-answer permanently "use up"
  //      the escape hatch for a search the gate never actually blocked.
  //   6. Every flag here (gate flag, declined marker, bypass streak, relent,
  //      last-blocked) carries a ~12h TTL so a long-running machine cannot
  //      accumulate state that outlives any session it could plausibly still
  //      describe — and an opportunistic, bounded sweep in the SessionStart
  //      graphify hook (gstate.sweepStaleGateState) proactively cleans up
  //      expired entries rather than waiting for that exact search to recur.
  //   7. A missing/unstable session id (`sid === 'nosid'`) skips this WHOLE
  //      block — same instability lib/session-id.js documents for the classic
  //      confirm flag below (issue #10); this gate's state is
  //      session-scoped, so an unstable id could wedge or leak it in ways the
  //      classic flag deliberately avoids by not keying on session at all.
  //   8. A machine-wide concurrency cap (gstate.acquireGateQuerySlot, default
  //      2 in-flight, ~10s stale window) bounds how many real `graphify
  //      query` children can run at once; over the cap skips the gate
  //      entirely (gate_skipped_busy, and records a declined marker per #2)
  //      rather than queuing. The lagging-but-within-tolerance self-heal kick
  //      runs AFTER the query, not before, so it does not compete with the
  //      query itself for CPU (a likely contributor to observed ~5s timeouts).
  // Fail-open: any error here must never block a search.
  //
  // Tolerance is a file COUNT, not a time window, because scanSources already
  // walks the tree per-search — comparing counts costs nothing extra and is
  // robust to editors touching files without changing them meaningfully.
  const GRAPHIFY_STALE_TOLERANCE = 25;
  const GRAPHIFY_QUERY_TIMEOUT_MS = 4000;
  const GRAPHIFY_QUERY_BUDGET = 400;
  const GRAPHIFY_RELENT_AFTER_BYPASSES = 3;
  const GRAPHGATE_FLAG_TTL_MS = 12 * 60 * 60 * 1000;

  if (toolName === 'Grep') {
    const sid = hook.session_id || hook.sessionId || '';
    const pattern = toolInput.pattern;
    const searchPath = toolInput.path;
    // Cheap, zero-require pre-filter mirroring graph-nudge.isSemanticPattern's
    // cheap rejects closely enough to skip the require+stat cost for the vast
    // majority of calls — the AUTHORITATIVE check is still
    // graphNudge.isEligibleSearch below, invoked only once this passes.
    const cheapPatternMaybeOk = typeof pattern === 'string'
      && pattern.length >= 3 && pattern.length <= 200
      && !/[/\\[\](){}^$*+?]/.test(pattern)
      && pattern.trim().split(/[|\s]+/).filter(Boolean).length <= 4;
    const cheapPathMaybeOk = !searchPath || toolInput.output_mode === 'content';

    if (sid && cheapPatternMaybeOk && cheapPathMaybeOk) {
      try {
        const graphNudge = require('../lib/graph-nudge');
        const gstate = require('../lib/graphify-state');
        const patternForLog = String(pattern || '').slice(0, 120);
        const outputMode = toolInput.output_mode || '';
        const eligible = graphNudge.isEligibleSearch(toolName, toolInput, cwd);

        if (eligible && !gstate.isRelented(sid, cwd)) {
          // The SAME key the classic confirm flag below is keyed on (R6/R8) —
          // sharing it is what lets the bypass branch pre-release that flag.
          const costFieldsJson = JSON.stringify(costFields(toolName, toolInput));
          const searchKey = `${toolName}:${cwd}:${costFieldsJson}`;
          const gflag = flagPath(`graphgate:${sid}:${searchKey}`);

          // R3/R4 ordering: the escape-hatch flag AND the declined marker are
          // checked FIRST — before anything that costs a `require()`, a
          // consent-file read, or (worst) the full `stalenessInfo` directory
          // walk — so a retry of an already-decided search costs next to
          // nothing, and a graph being rewritten mid-retry cannot change the
          // outcome between the block and its retry.
          let gflagFresh = false;
          if (fs.existsSync(gflag)) {
            try {
              const written = parseInt(fs.readFileSync(gflag, 'utf8'), 10);
              gflagFresh = Number.isFinite(written) && (Date.now() - written) < GRAPHGATE_FLAG_TTL_MS;
            } catch { /* stays stale */ }
            if (!gflagFresh) { try { fs.unlinkSync(gflag); } catch {} }
          }

          if (gflagFresh) {
            // Escape hatch: already gated this exact search — fall through.
            const metrics = require('../lib/graphify-metrics');
            const keyHash = graphNudge.gateKeyHash(toolName, cwd, costFieldsJson);
            metrics.record('gate_bypassed', { tool: toolName, pattern: patternForLog, outputMode, keyHash }, { cwd, sid });
            // R6/R8 double-block fix: the classic full-repo-search threshold
            // check further below is keyed on the SAME `searchKey` and would
            // otherwise block a SECOND time on this exact retry (it has never
            // seen a confirmation yet — the graphify gate answered first).
            // Pre-write a fresh classic flag now so that check finds it
            // already confirmed — but ONLY when this search is the kind the
            // classic check would otherwise ever act on (path-less, or `.`/
            // `/`); a directory+content-mode search never reaches that check
            // at all (see the per-tool Grep branch below), so writing its
            // flag there would just be a stray file for no behavioural gain.
            if (!searchPath || searchPath === '.' || searchPath === '/') {
              try { fs.writeFileSync(flagPath(searchKey), Date.now().toString()); } catch {}
            }
            // Bypass streak: only counts when this IS the most recently
            // blocked search AND it has not already been counted as bypassed
            // once (R2) — without the `!last.bypassed` guard, repeating the
            // SAME already-bypassed retry kept incrementing the streak
            // (relenting the gate off of ONE search retried three times,
            // rather than three DIFFERENT searches each declining the
            // answer).
            const last = gstate.getLastBlocked(sid, cwd);
            if (last && last.key === searchKey && !last.bypassed) {
              gstate.markLastBlockedBypassed(sid, cwd);
              if (gstate.noteBypass(sid, cwd) >= GRAPHIFY_RELENT_AFTER_BYPASSES) {
                gstate.markRelented(sid, cwd);
                metrics.record('gate_relented', { tool: toolName }, { cwd, sid });
              }
            }
          } else {
            const declined = gstate.getDeclined(sid, cwd, searchKey);
            if (declined) {
              // R1: this exact search already timed out / had no hit / errored
              // / was skipped for a busy slot. Skip the query ENTIRELY (zero
              // latency) — deliberately inert otherwise: no gate_bypassed, no
              // streak movement, no classic-flag pre-write, because nothing
              // was ever actually blocked the first time.
            } else if (gstate.isEnabled(cwd)) {
              // R3/R4: resolve the graph exactly ONCE per invocation and
              // thread it through every call that would otherwise re-resolve
              // it (hasGraph / stalenessInfo / the query's own --graph flag).
              const resolved = graphNudge.resolveGraphJson(cwd);
              if (resolved) {
                const metrics = require('../lib/graphify-metrics');
                const { spawnGraphifySync } = require('../lib/graphify-query-spawn');
                const keyHash = graphNudge.gateKeyHash(toolName, cwd, costFieldsJson);
                const info = graphNudge.stalenessInfo(cwd, { resolved });
                const withinTolerance = !info.truncated && info.newerCount <= GRAPHIFY_STALE_TOLERANCE;

                const kickSelfHeal = (newerCount, truncated) => {
                  // Demand-driven self-heal: kick a throttled background AST
                  // refresh (free, sentinel-tracked — see Gap #5) so the graph
                  // converges and the gate can enforce on LATER searches.
                  // Never blocks.
                  if (gstate.markRefresh(cwd, 2 * 60 * 1000)) {
                    if (gstate.bgWithSentinel(gstate.graphifyBin(), ['update', '.'], cwd)) {
                      metrics.record('self_heal_kicked', { newerCount, truncated }, { cwd, sid });
                    } else {
                      gstate.releaseRefresh(cwd); // declined — do not spend the cooldown (#291)
                    }
                  }
                };

                if (!withinTolerance) {
                  // Graph lags too far behind (or its staleness cannot be
                  // bounded at all) — the gate must not fire on THIS search.
                  // No query runs, so there is nothing to compete with the
                  // self-heal spawn for CPU; kick it right away.
                  const newerCount = Number.isFinite(info.newerCount) ? info.newerCount : -1;
                  kickSelfHeal(newerCount, info.truncated);
                } else {
                  const release = gstate.acquireGateQuerySlot();
                  if (!release) {
                    metrics.record('gate_skipped_busy', { tool: toolName, pattern: patternForLog }, { cwd, sid });
                    gstate.markDeclined(sid, cwd, searchKey, 'busy'); // R1
                  } else {
                    let queryOut = '';
                    let queryOk = false;
                    // Why a query produced nothing, and what it cost in
                    // wall-clock — the latency is the gate's only price on a
                    // no-answer search.
                    let reason = 'nohit';
                    const queryStart = Date.now();
                    try {
                      const question = graphNudge.questionFromPattern(pattern);
                      if (!question) reason = 'noquestion';
                      else {
                        const queryArgs = ['query', question, '--budget', String(GRAPHIFY_QUERY_BUDGET)];
                        if (resolved.source !== 'local') queryArgs.push('--graph', resolved.file);
                        const res = spawnGraphifySync(gstate.graphifyBin(), queryArgs, {
                          cwd, timeout: GRAPHIFY_QUERY_TIMEOUT_MS, windowsHide: true, encoding: 'utf8',
                        });
                        if (!res.error && res.status === 0) { queryOut = res.stdout || ''; queryOk = true; }
                        else reason = res.error && res.error.code === 'ETIMEDOUT' ? 'timeout' : 'error';
                      }
                    } catch { reason = 'error'; /* treat as no answer — fail open */ }
                    finally { release(); }
                    const queryMs = Date.now() - queryStart;

                    // R3/R4: kick the lagging-but-within-tolerance self-heal
                    // AFTER the query, not before — running it first made the
                    // background build compete with the query for CPU, a
                    // likely contributor to observed ~5s query timeouts.
                    if (info.newerCount > 0) kickSelfHeal(info.newerCount, false);

                    if (!queryOk || !graphNudge.hasGraphAnswer(queryOut)) {
                      metrics.record('gate_noanswer', { tool: toolName, pattern: patternForLog, outputMode, reason, ms: queryMs }, { cwd, sid });
                      gstate.markDeclined(sid, cwd, searchKey, reason); // R1 — no gflag write, this was never a block
                    } else {
                      // R5 (streak): write the gate flag only now — a genuine block.
                      try { fs.writeFileSync(gflag, Date.now().toString()); } catch {}
                      // Reset the bypass streak only when the PREVIOUS block
                      // was never retried (an accepted answer) — see gstate's
                      // doc comment for why this is what lets 3 bypasses on 3
                      // DIFFERENT searches still relent the gate.
                      const prevLast = gstate.getLastBlocked(sid, cwd);
                      if (prevLast && !prevLast.bypassed) gstate.clearBypassStreak(sid, cwd);
                      gstate.setLastBlocked(sid, cwd, searchKey);

                      const answer = graphNudge.trimToTraversalHeader(queryOut).slice(0, 2000);
                      console.error('\n⛔  GRAPHIFY GATE — broad search blocked (graph available)');
                      console.error('─'.repeat(54));
                      console.error(answer);
                      if (info.newerCount > 0) {
                        console.error('');
                        console.error(`note: graph lags ${info.newerCount} file(s) behind — background refresh started`);
                      }
                      console.error('');
                      console.error('retry the same search if you need exact matches.');
                      console.error('─'.repeat(54));
                      // R9: answerChars reflects what was actually SHOWN
                      // (trimmed to the traversal header, capped at 2000),
                      // not graphify's raw, potentially much larger stdout.
                      metrics.record('gate_fired', {
                        newerCount: info.newerCount, tool: toolName, pattern: patternForLog,
                        answerChars: answer.length, outputMode, keyHash, ms: queryMs,
                      }, { cwd, sid });
                      process.exit(2);
                    }
                  }
                }
              }
            }
          }
        }
      } catch { /* fail open — never block on gate errors */ }
    }
  }

  // Per-tool estimation
  if (toolName === 'Read') {
    const filePath = toolInput.file_path || '';
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    try {
      const stat = fs.statSync(absPath);
      let est = Math.ceil(stat.size * (cfg.tokensPerByte || 0.25));
      if (toolInput.limit && toolInput.limit > 0) {
        try {
          const content = fs.readFileSync(absPath, 'utf8');
          const totalLines = content.split('\n').length;
          if (totalLines > 0) est = Math.ceil(est * Math.min(toolInput.limit / totalLines, 1));
        } catch {}
      }
      estimatedTokens = est;
      description = `Read: ${path.relative(process.cwd(), absPath).replace(/\\/g, '/')}`;
    } catch {
      process.exit(0);
    }
  }

  else if (toolName === 'Bash') {
    const cmd = toolInput.command || '';
    // Commands that don't produce output Claude needs to process — no token
    // cost. Per-segment command-head classification (bash-context-cost):
    // a path handed to `ls`/`mv`/`echo`/`git add` never reaches context.
    // Any failure here falls through to the conservative path below.
    try {
      if (bashCost && bashCost.isFreeOfContextCost(cmd)) process.exit(0);
    } catch { /* classify conservatively */ }

    // --- Verbose command detection (output bloat guard) ---
    // Detect commands that produce unbounded output and suggest limited alternatives.
    const verbosePatterns = [
      {
        test: /\bgit\s+log\b/,
        guard: /--oneline|-n\s*\d+|--max-count[= ]\d+|-\d+|--format|--pretty=oneline|head\b/,
        suggestion: 'git log --oneline -20',
      },
      {
        test: /\bnpm\s+ls\b/,
        guard: /--depth[= ]\d+/,
        suggestion: 'npm ls --depth=0',
      },
      {
        test: /\bfind\s+[./]/,
        guard: /-maxdepth\s+\d+|head\b|-name\b.*-quit/,
        suggestion: 'find . -maxdepth 3 -name "pattern"',
      },
      {
        test: /\bdocker\s+logs\b/,
        guard: /--tail[= ]\d+|-n\s*\d+|head\b/,
        suggestion: 'docker logs --tail 50 <container>',
      },
    ];

    let verboseMatch = null;
    for (const vp of verbosePatterns) {
      if (vp.test.test(cmd) && !vp.guard.test(cmd)) {
        verboseMatch = vp;
        break;
      }
    }

    if (verboseMatch) {
      estimatedTokens = THRESHOLD;
      description = 'Bash: unbounded output — may flood context';
      verboseSuggestion = verboseMatch.suggestion;
    }

    // Check whether the command actually READS a known expensive file, rather
    // than merely mentioning its path. A detached (`run_in_background`)
    // non-reader — a server start — streams nothing into context; a
    // backgrounded reader still does, so it stays blocked.
    if (!verboseMatch) {
      const known = cfg.expensiveFiles;
      let matchedFiles;
      try {
        matchedFiles = bashCost
          ? bashCost.matchCostlyFiles(cmd, known, { runInBackground: !!toolInput.run_in_background })
          : substringMatch(cmd, known);
      } catch {
        matchedFiles = substringMatch(cmd, known);   // never fail open on a parse bug
      }
      if (matchedFiles.length > 0) {
        // Cap at what the harness can actually put into context. The Bash
        // tool's own output cap (BASH_MAX_OUTPUT_LENGTH, default 30000 chars)
        // bounds what a Bash call can ever return — larger output is
        // truncated/persisted to a file with a preview — so a filesize-based
        // estimate above that cap is fiction. Measured false positive: a
        // command that only PASSED a ~1.1M-token file's path (never read it,
        // see bash-context-cost matchCostlyFiles) was still estimated at its
        // full on-disk size once misclassified as costly. Cap, don't just
        // clip the display — the threshold/pct math must see the real ceiling
        // too, or a capped-looking number still blocks on the old total.
        const bashCap = Math.ceil((Number(process.env.BASH_MAX_OUTPUT_LENGTH) || 30000) * (cfg.tokensPerByte || 0.25));
        matchedFiles = matchedFiles.map(f => ({ ...f, tokens: Math.min(f.tokens, bashCap) }));
        estimatedTokens = Math.min(matchedFiles.reduce((sum, f) => sum + f.tokens, 0), bashCap);
        description = 'Bash referencing large file(s)';
        matchedFilesOut = matchedFiles;
      } else {
        process.exit(0);
      }
    }
  }

  else if (toolName === 'Glob') {
    const pattern = toolInput.pattern || '';
    if (/^\*\*\/\*$|^\*\*$|^\.\*\*/.test(pattern) || (pattern.includes('**') && !toolInput.path)) {
      estimatedTokens = THRESHOLD;
      description = `Glob: broad pattern "${pattern}" on entire repo`;
    } else {
      process.exit(0);
    }
  }

  else if (toolName === 'Grep') {
    const searchPath = toolInput.path || '';
    if (!searchPath || searchPath === '.' || searchPath === '/') {
      estimatedTokens = THRESHOLD;
      description = 'Grep: full-repo search';
    } else {
      process.exit(0);
    }
  }

  else {
    process.exit(0);
  }

  // ── Proactive project-map injection (once per session) ──────────────
  // Audit finding: the map was never read proactively (0/30 sessions) — only
  // reactively, after this guard blocked a broad search. Fix: on the FIRST
  // broad Grep/Glob of a session, attach the project structure as
  // additionalContext and ALLOW the search, so Claude can scope the next
  // calls with a `path`. Falls through to the normal block on later broad
  // searches (map already in context by then).
  if ((toolName === 'Grep' || toolName === 'Glob') && !toolInput.path) {
    const projectMap = path.join(cwd, '.claude', 'project-map.md');
    const sid = hook.session_id || hook.sessionId || 'nosid';
    const mapKey = crypto.createHash('md5').update(`${sid}:${cwd}`).digest('hex').slice(0, 12);
    const mapFlag = path.join(os.tmpdir(), `devops_mapinject_${mapKey}.flag`);
    // Guarded like every other sibling require — a missing lib must degrade to
    // "no graph nudge", never crash the guard into failing open.
    let graphNudge = null;
    try { graphNudge = require('../lib/graph-nudge'); } catch { /* map-only */ }
    const hasMap = fs.existsSync(projectMap);
    let hasGraph = false;
    try { hasGraph = !!graphNudge && graphNudge.hasGraph(cwd); } catch { /* map-only */ }
    // Fire once per session if EITHER the project-map or a graphify graph exists.
    if ((hasMap || hasGraph) && !fs.existsSync(mapFlag)) {
      try {
        const sections = [];
        if (hasMap) {
          const mapBody = fs.readFileSync(projectMap, 'utf8').trim();
          sections.push([
            `[project-map] Before this broad ${toolName} (no \`path\` set), here is the project's file structure.`,
            'Use it to re-scope: pick the directory that contains your target and pass it as the `path`',
            'parameter on this and future Grep/Glob calls instead of scanning the whole repo.',
            '',
            mapBody,
          ].join('\n'));
        }
        if (hasGraph) {
          sections.push(graphNudge.buildGraphNudge(cwd));
          try { require('../lib/graphify-metrics').record('nudge_injected', {}, { cwd, sid }); } catch {}
        }
        fs.writeFileSync(mapFlag, Date.now().toString());
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: sections.join('\n\n'),
          },
        }));
        process.exit(0); // allow the search; map/graph hint now in context for the next one
      } catch {}
    }
  }

  // Check threshold
  if (estimatedTokens < THRESHOLD) {
    process.exit(0);
  }

  const pct = ((estimatedTokens / LIMIT) * 100).toFixed(1);
  // Key the confirmation on the fields that determine the token cost — and
  // nothing else. Hashing the whole tool_input made the flag miss whenever
  // Claude reworded the model-authored `description`, flipped
  // `run_in_background`, or the key order changed, so the documented
  // "retry to proceed" never released.
  //
  // `cwd` scopes it, so a block in one project no longer pre-authorises
  // another. `session_id` is deliberately NOT in the key: lib/session-id.js
  // documents that Claude Code may deliver a different or missing session_id
  // between hook invocations (issue #10), and this path has no escape hatch —
  // an unstable id would wedge the retry forever, which is the very failure
  // being fixed. The residual over-share is one project's own later session
  // inheriting a confirmation; that is strictly narrower than the previous
  // behaviour, which leaked across projects too.
  const flagKey = `${toolName}:${cwd}:${JSON.stringify(costFields(toolName, toolInput))}`;
  const flag = flagPath(flagKey);

  // Telemetry classification — cheap, string-only, no extra work on the hot path.
  const sidForMetrics = hook.session_id || hook.sessionId || 'nosid';
  const guardKind = toolName === 'Read' ? 'read'
    : (toolName === 'Bash' && verboseSuggestion) ? 'bash-verbose'
    : (toolName === 'Bash' && matchedFilesOut) ? 'bash-file'
    : (toolName === 'Grep' || toolName === 'Glob') ? 'broad'
    : 'other';

  if (fs.existsSync(flag)) {
    // Unreadable or unparsable (interrupted write, full disk) counts as
    // expired, not fresh — the flag is re-armed below, so the cost is one
    // extra retry rather than an unearned approval.
    let fresh = false;
    try {
      const written = parseInt(fs.readFileSync(flag, 'utf8'), 10);
      if (Number.isFinite(written)) fresh = (Date.now() - written) < CONFIRM_TTL_MS;
    } catch { /* stays expired */ }
    try { fs.unlinkSync(flag); } catch {}
    if (fresh) {
      recordMetric('guard_released', { tool: toolName, kind: guardKind }, { cwd, sid: sidForMetrics });
      process.exit(0); // User confirmed — allow
    }
    // Expired: fall through and block again, re-arming the flag below.
  }

  // First time — block and warn
  try { fs.writeFileSync(flag, Date.now().toString()); } catch {}
  recordMetric('guard_blocked', { tool: toolName, kind: guardKind, est: estimatedTokens }, { cwd, sid: sidForMetrics });

  const W = 54;
  const line = '─'.repeat(W);
  console.error(`\n⚠️  HIGH TOKEN COST — OPERATION BLOCKED`);
  console.error(line);
  console.error(`Tool:       ${toolName}`);
  console.error(`Operation:  ${description}`);
  const planLabel = cfg.plan || 'unknown';
  console.error(`Est. cost:  ~${estimatedTokens.toLocaleString()} tokens  (${pct}% of ${(LIMIT / 1000).toFixed(0)}K context window)`);
  console.error(`Threshold:  ${THRESHOLD.toLocaleString()} tokens (${(cfg.confirmThresholdPct * 100).toFixed(0)}% of context · ${planLabel})`);

  if (toolName === 'Read') {
    const fp = toolInput.file_path || '';
    const absP = path.isAbsolute(fp) ? fp : path.join(process.cwd(), fp);
    try {
      const kb = (fs.statSync(absP).size / 1024).toFixed(1);
      console.error(`\nLarge file:`);
      console.error(`  ${path.relative(process.cwd(), absP).replace(/\\/g, '/')}  (${kb} KB → ~${estimatedTokens.toLocaleString()} tokens)`);
    } catch {}
  } else if (verboseSuggestion) {
    console.error(`\nUnbounded output — command has no limit flag.`);
    console.error(`Try instead:  ${verboseSuggestion}`);
  } else if (matchedFilesOut) {
    console.error(`\nLarge files referenced:`);
    for (const f of matchedFilesOut) {
      console.error(`  ${f.path}  (~${f.tokens.toLocaleString()} tokens)`);
    }
  }

  // Project map hint for broad searches
  if (toolName === 'Grep' || toolName === 'Glob') {
    const projectMap = path.join(cwd, '.claude', 'project-map.md');
    if (fs.existsSync(projectMap)) {
      console.error(`\nHint: Read .claude/project-map.md to find the right path first.`);
    }
  }

  console.error(line);
  console.error('To proceed, retry the same operation.');
  console.error('');
  process.exit(2);
});
