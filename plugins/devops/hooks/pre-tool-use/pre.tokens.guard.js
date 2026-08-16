#!/usr/bin/env node
/**
 * @hook pre.tokens.guard
 * @version 0.9.0
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
 *   falls back to the pre-0.9 substring match rather than failing open.
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
        estimatedTokens = matchedFiles.reduce((sum, f) => sum + f.tokens, 0);
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

  // ── graphify hard-gate (enabled + graph within staleness tolerance) ──────
  // Graphify is default-ON (opt-out — see gstate.isEnabled): unless the user
  // has explicitly disabled it (.claude/graphify.json or ~/.claude/graphify.json
  // {"consent":false}), when a usable graph exists, force a broad raw-file
  // search through the graph first. This is a
  // BOUNDED-tolerance gate, not a strict fresh/stale one: a graph that lags a
  // small number of files behind the working tree is still useful, so the
  // gate still enforces on it (with a disclosure line + a kicked background
  // refresh) — see GRAPHIFY_STALE_TOLERANCE below. It must NEVER force Claude
  // onto a graph whose staleness cannot be bounded at all (missing, truncated
  // scan, nothing comparable — stalenessInfo reports newerCount:Infinity for
  // all of these); that self-heals silently instead. Two more safety
  // properties are preserved:
  //   1. Escape hatch — block at most once per (session, search); a retry of
  //      the same search falls through, so a question the graph cannot answer
  //      (exact string, new/uncommitted file, non-code asset) is never wedged.
  //   2. Relents entirely once `graphify query` has run this session (queryDone).
  // Fail-open: any error here must never block a search.
  //
  // Tolerance is a file COUNT, not a time window, because scanSources already
  // walks the tree per-search — comparing counts costs nothing extra and is
  // robust to editors touching files without changing them meaningfully.
  const GRAPHIFY_STALE_TOLERANCE = 25;
  if ((toolName === 'Grep' || toolName === 'Glob') && !toolInput.path) {
    try {
      const graphNudge = require('../lib/graph-nudge');
      const gstate = require('../lib/graphify-state');
      const metrics = require('../lib/graphify-metrics');
      const sid = hook.session_id || hook.sessionId || 'nosid';
      if (gstate.isEnabled(cwd) && graphNudge.hasGraph(cwd)) {
        const info = graphNudge.stalenessInfo(cwd);
        const withinTolerance = !info.truncated && info.newerCount <= GRAPHIFY_STALE_TOLERANCE;
        if (!withinTolerance) {
          // Demand-driven self-heal: a broad search arrived but the graph lags
          // too far behind (or its staleness cannot be bounded at all), so the
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
            if (gstate.bgWithSentinel('graphify', ['update', '.'], cwd)) {
              // Infinity is JSON-null; -1 keeps "unbounded" distinguishable in the log.
              const newerCount = Number.isFinite(info.newerCount) ? info.newerCount : -1;
              metrics.record('self_heal_kicked', { newerCount, truncated: info.truncated }, { cwd, sid });
            } else {
              gstate.releaseRefresh(cwd);
            }
          }
        } else if (!gstate.queryDone(sid, cwd)) {
          // Same keying discipline as the confirmation flag below: hashing the
          // whole tool_input made a retry that merely added `-i` or
          // `head_limit` look like a brand-new search, so the escape hatch
          // never opened.
          const gflag = flagPath(`graphgate:${sid}:${cwd}:${toolName}:${JSON.stringify(costFields(toolName, toolInput))}`);
          if (!fs.existsSync(gflag)) {
            try { fs.writeFileSync(gflag, Date.now().toString()); } catch {}
            // Within tolerance but still lagging by >0 files — enforce AND kick
            // a refresh in parallel so it converges toward newerCount 0.
            if (info.newerCount > 0 && gstate.markRefresh(cwd, 2 * 60 * 1000)) {
              if (gstate.bgWithSentinel('graphify', ['update', '.'], cwd)) {
                metrics.record('self_heal_kicked', { newerCount: info.newerCount, truncated: false }, { cwd, sid });
              } else {
                gstate.releaseRefresh(cwd); // declined — do not spend the cooldown (#291)
              }
            }
            const suggestion = graphNudge.suggestQuery(toolInput.pattern);
            console.error('\n⛔  GRAPHIFY GATE — broad search blocked (graph available)');
            console.error('─'.repeat(54));
            console.error('Query the knowledge graph instead of grepping raw files:');
            console.error(`  ${suggestion}`);
            if (info.newerCount > 0) {
              console.error('');
              console.error(`note: graph lags ${info.newerCount} file(s) behind — background refresh started`);
            }
            console.error('');
            console.error('If the graph cannot answer THIS search (exact string, a');
            console.error('new/uncommitted file, or a non-code asset), retry the same');
            console.error('search to proceed.');
            console.error('─'.repeat(54));
            metrics.record('gate_fired', { newerCount: info.newerCount }, { cwd, sid });
            process.exit(2);
          }
          // flag present → already gated this search; fall through (escape hatch)
          metrics.record('gate_bypassed', {}, { cwd, sid });
        }
      }
    } catch { /* fail open — never block on gate errors */ }
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
          sections.push(graphNudge.buildGraphNudge());
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
    if (fresh) process.exit(0); // User confirmed — allow
    // Expired: fall through and block again, re-arming the flag below.
  }

  // First time — block and warn
  try { fs.writeFileSync(flag, Date.now().toString()); } catch {}

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
