#!/usr/bin/env node
/**
 * Claude Code Pre-Tool-Use Cost Guard
 * Runs before Read, Bash, Glob, Grep tool calls.
 * If estimated token cost >= 2% of the estimated 5-hour session window limit,
 * blocks the operation and asks for confirmation.
 *
 * First call  → creates flag file, exits 2 (blocked with warning)
 * Second call → flag exists → deletes flag, exits 0 (allowed through)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'scripts', 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { estimatedLimitTokens: 1000000, confirmThresholdPct: 0.02, tokensPerByte: 0.25, expensiveFiles: [] }; }
}

function flagPath(key) {
  const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `claude_confirm_${hash}.flag`);
}

function estimateBytesToTokens(bytes, cfg) {
  return Math.ceil(bytes * (cfg.tokensPerByte || 0.25));
}

// ── read tool input from stdin ────────────────────────────────────────────────
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); } // can't parse → allow

  const toolName = hook.tool_name || '';
  const toolInput = hook.tool_input || {};
  const cfg = loadConfig();
  const LIMIT = cfg.estimatedLimitTokens;
  const THRESHOLD = Math.round(LIMIT * (cfg.confirmThresholdPct || 0.02));

  let estimatedTokens = 0;
  let description = '';

  // ── Per-tool estimation ───────────────────────────────────────────────────

  if (toolName === 'Read') {
    const filePath = toolInput.file_path || '';
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    try {
      const stat = fs.statSync(absPath);
      let est = estimateBytesToTokens(stat.size, cfg);
      // If a line limit is set, cap the estimate proportionally
      if (toolInput.limit && toolInput.limit > 0) {
        // Rough: limit lines / total lines * est tokens
        try {
          const content = fs.readFileSync(absPath, 'utf8');
          const totalLines = content.split('\n').length;
          if (totalLines > 0) est = Math.ceil(est * Math.min(toolInput.limit / totalLines, 1));
        } catch {}
      }
      estimatedTokens = est;
      description = `Read: ${path.relative(process.cwd(), absPath).replace(/\\/g, '/')}`;
    } catch {
      process.exit(0); // file not found → allow
    }
  }

  else if (toolName === 'Bash') {
    const cmd = toolInput.command || '';
    // Check if command references a known expensive file
    const expensiveFiles = cfg.expensiveFiles || [];
    let maxKnownCost = 0;
    let matchedFile = '';
    for (const ef of expensiveFiles) {
      if (cmd.includes(ef.path || ef) && (ef.estimatedTokens || 20000) > maxKnownCost) {
        maxKnownCost = ef.estimatedTokens || 20000;
        matchedFile = ef.path || ef;
      }
    }
    // Also flag broad npm install / ci (moderate cost from node exec)
    if (maxKnownCost > 0) {
      estimatedTokens = maxKnownCost;
      description = `Bash referencing large file: ${matchedFile}`;
    } else {
      process.exit(0); // can't estimate arbitrary bash → allow
    }
  }

  else if (toolName === 'Glob') {
    const pattern = toolInput.pattern || '';
    // Broad patterns on repo root are expensive
    if (/^\*\*\/\*$|^\*\*$|^\.\*\*/.test(pattern) || (pattern.includes('**') && !toolInput.path)) {
      estimatedTokens = THRESHOLD; // treat as exactly threshold to warn
      description = `Glob: broad pattern "${pattern}" on entire repo`;
    } else {
      process.exit(0);
    }
  }

  else if (toolName === 'Grep') {
    const searchPath = toolInput.path || '';
    // Grepping on root or very broad path
    if (!searchPath || searchPath === '.' || searchPath === '/') {
      estimatedTokens = THRESHOLD;
      description = `Grep: full-repo search`;
    } else {
      process.exit(0);
    }
  }

  else {
    process.exit(0); // unknown tool → allow
  }

  // ── Check threshold ───────────────────────────────────────────────────────

  if (estimatedTokens < THRESHOLD) {
    process.exit(0); // below threshold → allow
  }

  const pct = ((estimatedTokens / LIMIT) * 100).toFixed(1);
  const flagKey = `${toolName}:${JSON.stringify(toolInput)}`;
  const flag = flagPath(flagKey);

  if (fs.existsSync(flag)) {
    // User confirmed → allow this one time
    try { fs.unlinkSync(flag); } catch {}
    process.exit(0);
  }

  // First time → block and warn
  try { fs.writeFileSync(flag, Date.now().toString()); } catch {}

  const W = 54;
  const line = '─'.repeat(W);
  console.error(`\n⚠️  HIGH TOKEN COST — OPERATION BLOCKED`);
  console.error(line);
  console.error(`Tool:       ${toolName}`);
  console.error(`Operation:  ${description}`);
  console.error(`Est. cost:  ~${estimatedTokens.toLocaleString()} tokens  (${pct}% of ${(LIMIT/1000).toFixed(0)}K session window)`);
  console.error(`Threshold:  ${THRESHOLD.toLocaleString()} tokens (${(cfg.confirmThresholdPct * 100).toFixed(0)}% of session limit)`);
  console.error(line);
  console.error(`To proceed, reply: "yes, proceed"`);
  console.error(`I will retry the operation once you confirm.`);
  console.error('');

  process.exit(2);
});
