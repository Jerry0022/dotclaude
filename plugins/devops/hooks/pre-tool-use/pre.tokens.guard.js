#!/usr/bin/env node
/**
 * @hook pre.tokens.guard
 * @version 0.5.0
 * @event PreToolUse
 * @plugin devops
 * @description Block Read/Bash/Glob/Grep operations that would consume a
 *   significant percentage of the ~200K context window. Threshold scales
 *   with the user's Claude plan (pro/max_5/max_20). Uses a flag-file
 *   mechanism: first call blocks with warning, retry allows through.
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

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const cwd = process.cwd();
const CONFIG_DIR = path.join(cwd, '.claude');
const CONFIG_PATH = path.join(CONFIG_DIR, 'token-config.json');

// Note: background graphify spawns (self-heal refresh) go through
// `gstate.bgWithSentinel` (hooks/lib/graphify-state.js) rather than a local
// bg() helper — it wraps the same detached/stdio:'ignore' spawn shape but
// also records ok/fail to a sentinel file so a silent failure (Gap #5) can
// be surfaced at the next SessionStart instead of vanishing.

function isGitRepo() {
  try {
    return execSync('git rev-parse --is-inside-work-tree', {
      cwd, encoding: 'utf8', timeout: 4000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim() === 'true';
  } catch {
    return false;
  }
}

const PLAN_DEFAULTS = require('../lib/plan-defaults');

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
    // Commands that don't produce output Claude needs to process — no token cost
    const noTokenCostPattern = /^\s*(cd\s|git\s+(push|fetch|remote|prune|worktree|branch\s+-[dD]|checkout|switch|pull|merge|rebase|tag|stash|rm|add|commit)|gh\s+(pr|issue|project|api)|npm\s+publish|rm\s|mkdir\s|cp\s|mv\s)/;
    const segments = cmd.split(/\s*(?:&&|;)\s*/);
    if (segments.every(seg => noTokenCostPattern.test(seg))) {
      process.exit(0);
    }

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
      toolInput._verboseSuggestion = verboseMatch.suggestion;
    }

    // Check if command references known expensive files
    if (!verboseMatch) {
      const expensiveFiles = cfg.expensiveFiles || [];
      const matchedFiles = [];
      for (const ef of expensiveFiles) {
        if (cmd.includes(ef.path)) {
          matchedFiles.push({ path: ef.path, tokens: ef.estimatedTokens || 20000 });
        }
      }
      if (matchedFiles.length > 0) {
        estimatedTokens = matchedFiles.reduce((sum, f) => sum + f.tokens, 0);
        description = 'Bash referencing large file(s)';
        toolInput._matchedFiles = matchedFiles;
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

  // ── graphify hard-gate (consented + graph within staleness tolerance) ────
  // When the user has opted graphify in for this project AND a usable graph
  // exists, force a broad raw-file search through the graph first. This is a
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
      if (gstate.hasConsent(cwd) && graphNudge.hasGraph(cwd)) {
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
            gstate.bgWithSentinel('graphify', ['extract', '.', '--update'], cwd);
            metrics.record('self_heal_kicked', { newerCount: info.newerCount, truncated: info.truncated }, { cwd, sid });
          }
        } else if (!gstate.queryDone(sid, cwd)) {
          const gflag = flagPath(`graphgate:${sid}:${cwd}:${toolName}:${JSON.stringify(toolInput)}`);
          if (!fs.existsSync(gflag)) {
            try { fs.writeFileSync(gflag, Date.now().toString()); } catch {}
            // Within tolerance but still lagging by >0 files — enforce AND kick
            // a refresh in parallel so it converges toward newerCount 0.
            if (info.newerCount > 0 && gstate.markRefresh(cwd, 2 * 60 * 1000)) {
              gstate.bgWithSentinel('graphify', ['extract', '.', '--update'], cwd);
              metrics.record('self_heal_kicked', { newerCount: info.newerCount, truncated: false }, { cwd, sid });
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
    const graphNudge = require('../lib/graph-nudge');
    const hasMap = fs.existsSync(projectMap);
    const hasGraph = graphNudge.hasGraph(cwd);
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
  const flagKey = `${toolName}:${JSON.stringify(toolInput)}`;
  const flag = flagPath(flagKey);

  if (fs.existsSync(flag)) {
    try { fs.unlinkSync(flag); } catch {}
    process.exit(0); // User confirmed — allow
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
  } else if (toolInput._verboseSuggestion) {
    console.error(`\nUnbounded output — command has no limit flag.`);
    console.error(`Try instead:  ${toolInput._verboseSuggestion}`);
  } else if (toolInput._matchedFiles) {
    console.error(`\nLarge files referenced:`);
    for (const f of toolInput._matchedFiles) {
      console.error(`  ${f.path}  (~${f.tokens.toLocaleString()} tokens)`);
    }
  }

  // Project map hint for broad searches
  if (toolName === 'Grep' || toolName === 'Glob') {
    const projectMap = path.join(cwd, '.claude', 'project-map.md');
    if (fs.existsSync(projectMap)) {
      console.error(`\nHint: Read .claude/project-map.md to find the right path first.`);
    }

    // Value-moment graphify offer: a broad search just got blocked in a git
    // project that has no graphify decision yet and no graph. This is where the
    // token cost is concrete, so conversion is far higher than the passive
    // SessionStart offer. Throttled once per week per project (shares nothing
    // with the SessionStart offer key, so at most two low-cost offers/week).
    try {
      const gstate = require('../lib/graphify-state');
      const graphNudge = require('../lib/graph-nudge');
      if (gstate.isUndecided(cwd) && !graphNudge.hasGraph(cwd) && isGitRepo()) {
        const { runOnce } = require('../lib/run-once');
        const cwdKey = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 12);
        if (runOnce('graphify-block-offer', cwdKey, { cooldownMs: 7 * 24 * 60 * 60 * 1000 })) {
          console.error('');
          console.error(graphNudge.buildGraphifyOffer());
          try { require('../lib/graphify-metrics').record('offer_shown', { source: 'value_moment' }, { cwd }); } catch {}
        }
      }
    } catch { /* never let the offer break the block */ }
  }

  console.error(line);
  console.error('To proceed, retry the same operation.');
  console.error('');
  process.exit(2);
});
