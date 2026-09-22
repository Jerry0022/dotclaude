#!/usr/bin/env node
/**
 * @hook pre.tokens.guard
 * @version 0.11.0
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
 *
 *   Grep/Glob carries a separate graphify "answer-in-gate": an ELIGIBLE
 *   search (see `hooks/lib/graph-nudge.isEligibleSearch`) is answered from
 *   the knowledge graph directly instead of merely blocked — see the gate
 *   section below for the full policy.
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

  // ── graphify answer-in-gate (enabled + graph within staleness tolerance) ─
  // Graphify is default-ON (opt-out — see gstate.isEnabled): unless the user
  // has explicitly disabled it (.claude/graphify.json or ~/.claude/graphify.json
  // {"consent":false}), an ELIGIBLE search (graphNudge.isEligibleSearch — see
  // that module for why eligibility is narrow: a default-budget query costs
  // more than most scoped grep results, so the gate must not fire on every
  // search) is answered from the graph itself instead of merely suggesting a
  // query: the hook runs `graphify query "<question>" --budget 400`
  // (argument array only — the pattern is untrusted, never interpolated into
  // a shell string), hard-timeout ~4s. A real answer (one or more nodes)
  // blocks the search and puts that answer directly in the message — usable
  // without Claude making a second call. No answer (empty, "No matching nodes
  // found.", a timeout, or a spawn error) ALLOWS the search silently; the
  // graph genuinely could not help, so there is nothing to show.
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
  //      the same search falls through (gate_bypassed), so a question the
  //      graph cannot answer (exact string, new/uncommitted file, non-code
  //      asset) is never wedged.
  //   2. Adaptive relent — 3 consecutive bypasses in a session with no
  //      accepted answer in between disables the gate for the rest of that
  //      session (gate_relented). Replaces the old "relent for the whole
  //      session after ANY `graphify query` ran" policy: the gate now answers
  //      eligible searches itself, so a manual query elsewhere no longer
  //      needs to disable it wholesale.
  // Fail-open: any error here must never block a search.
  //
  // Tolerance is a file COUNT, not a time window, because scanSources already
  // walks the tree per-search — comparing counts costs nothing extra and is
  // robust to editors touching files without changing them meaningfully.
  const GRAPHIFY_STALE_TOLERANCE = 25;
  const GRAPHIFY_QUERY_TIMEOUT_MS = 4000;
  const GRAPHIFY_QUERY_BUDGET = 400;
  const GRAPHIFY_RELENT_AFTER_BYPASSES = 3;
  if (toolName === 'Grep' || toolName === 'Glob') {
    try {
      const graphNudge = require('../lib/graph-nudge');
      const gstate = require('../lib/graphify-state');
      const metrics = require('../lib/graphify-metrics');
      const { spawnSync } = require('child_process');
      const sid = hook.session_id || hook.sessionId || 'nosid';
      const patternForLog = String(toolInput.pattern || '').slice(0, 120);
      const eligible = graphNudge.isEligibleSearch(toolName, toolInput, cwd);
      if (eligible && gstate.isEnabled(cwd) && graphNudge.hasGraph(cwd) && !gstate.isRelented(sid, cwd)) {
        const info = graphNudge.stalenessInfo(cwd);
        const withinTolerance = !info.truncated && info.newerCount <= GRAPHIFY_STALE_TOLERANCE;
        if (!withinTolerance) {
          // Demand-driven self-heal: a search arrived but the graph lags too
          // far behind (or its staleness cannot be bounded at all), so the
          // gate below must not fire and the graph would just rot until the
          // next SessionStart. Kick a throttled background AST refresh (free,
          // sentinel-tracked — see Gap #5) so the graph converges and the gate
          // can enforce on LATER searches this session. Never blocks.
          if (gstate.markRefresh(cwd, 2 * 60 * 1000)) {
            // Release the throttle slot when the spawn is declined (PID lock /
            // global cap) — otherwise the cooldown is spent on a build that
            // never ran and the graph cannot converge (issue #291). The metric
            // must only record a spawn that actually issued, or the log claims
            // self-heals that never happened.
            if (gstate.bgWithSentinel(gstate.graphifyBin(), ['update', '.'], cwd)) {
              // Infinity is JSON-null; -1 keeps "unbounded" distinguishable in the log.
              const newerCount = Number.isFinite(info.newerCount) ? info.newerCount : -1;
              metrics.record('self_heal_kicked', { newerCount, truncated: info.truncated }, { cwd, sid });
            } else {
              gstate.releaseRefresh(cwd);
            }
          }
        } else {
          // Same keying discipline as the confirmation flag below: hashing the
          // whole tool_input made a retry that merely added `-i` or
          // `head_limit` look like a brand-new search, so the escape hatch
          // never opened.
          const gflag = flagPath(`graphgate:${sid}:${cwd}:${toolName}:${JSON.stringify(costFields(toolName, toolInput))}`);
          if (!fs.existsSync(gflag)) {
            // Within tolerance but still lagging by >0 files — enforce AND kick
            // a refresh in parallel so it converges toward newerCount 0.
            if (info.newerCount > 0 && gstate.markRefresh(cwd, 2 * 60 * 1000)) {
              if (gstate.bgWithSentinel(gstate.graphifyBin(), ['update', '.'], cwd)) {
                metrics.record('self_heal_kicked', { newerCount: info.newerCount, truncated: false }, { cwd, sid });
              } else {
                gstate.releaseRefresh(cwd); // declined — do not spend the cooldown (#291)
              }
            }

            const question = graphNudge.questionFromPattern(toolInput.pattern) || 'What defines or uses this?';
            const resolved = graphNudge.resolveGraphJson(cwd);
            const queryArgs = ['query', question, '--budget', String(GRAPHIFY_QUERY_BUDGET)];
            if (resolved && resolved.source !== 'local') queryArgs.push('--graph', resolved.file);

            let queryOut = '';
            let queryOk = false;
            try {
              const res = spawnSync(gstate.graphifyBin(), queryArgs, {
                cwd,
                timeout: GRAPHIFY_QUERY_TIMEOUT_MS,
                windowsHide: true,
                encoding: 'utf8',
                // .cmd/.bat shims on Windows cannot be exec'd without a shell
                // (a plain argv spawn, the safe default, throws ENOENT/EINVAL
                // for those); the args stay an ARRAY either way — Node quotes
                // each element for the shell itself, so the untrusted pattern
                // is never hand-interpolated into a command string.
                shell: process.platform === 'win32',
              });
              if (!res.error && res.status === 0) { queryOut = res.stdout || ''; queryOk = true; }
            } catch { /* treat as no answer — fail open */ }

            // Mark this exact search gated EITHER way, so an identical retry
            // never re-runs the query (the escape hatch below still bypasses).
            try { fs.writeFileSync(gflag, Date.now().toString()); } catch {}

            if (!queryOk || !graphNudge.hasGraphAnswer(queryOut)) {
              metrics.record('gate_noanswer', { tool: toolName, pattern: patternForLog }, { cwd, sid });
              // No answer — nothing to show, fall through and allow.
            } else {
              const answer = queryOut.trim().slice(0, 2000);
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
              metrics.record('gate_fired', {
                newerCount: info.newerCount, tool: toolName, pattern: patternForLog, answerChars: queryOut.length,
              }, { cwd, sid });
              gstate.clearBypassStreak(sid, cwd); // an answer was delivered — reset the bypass streak
              process.exit(2);
            }
          } else {
            // flag present → already gated this search; fall through (escape hatch)
            metrics.record('gate_bypassed', { tool: toolName, pattern: patternForLog }, { cwd, sid });
            if (gstate.noteBypass(sid, cwd) >= GRAPHIFY_RELENT_AFTER_BYPASSES) {
              gstate.markRelented(sid, cwd);
              metrics.record('gate_relented', { tool: toolName }, { cwd, sid });
            }
          }
        }
      }
    } catch { /* fail open — never block on gate errors */ }
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
