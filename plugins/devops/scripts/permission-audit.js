#!/usr/bin/env node
/**
 * @script permission-audit
 * @version 0.1.0
 * @plugin devops
 * @description Pre-flight permission audit. Scans recent Claude Code sessions
 *   for tool calls that are NOT covered by the current ~/.claude/settings.json
 *   allow-list, and suggests safe additions to reduce mid-run prompts.
 *
 *   Used by /devops-autonomous (Step 0.7) and /devops-agents (Step 1.5).
 *
 *   Output: JSON to stdout for skill consumption.
 *   Stderr: human-readable summary (suppress with --quiet).
 *
 *   Args:
 *     --days=N    Lookback window in days (default: 7)
 *     --quiet     Suppress stderr summary
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith('--days=')) || '--days=7';
const days = Math.max(1, parseInt(daysArg.split('=')[1], 10) || 7);
const quiet = args.includes('--quiet');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');
const CUTOFF = Date.now() - days * 24 * 60 * 60 * 1000;

let allowList = [];
try {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  allowList = settings.permissions?.allow || [];
} catch {}

function isMcpAllowed(toolName) {
  for (const rule of allowList) {
    if (rule === toolName) return true;
    if (rule.endsWith('*')) {
      const prefix = rule.slice(0, -1);
      if (toolName.startsWith(prefix)) return true;
    }
    if (toolName.startsWith(rule + '__')) return true;
  }
  return false;
}

function isTamperProtected(p) {
  if (!p) return null;
  const norm = p.replace(/\\/g, '/');
  if (/\.claude\/settings(\.local)?\.json$/i.test(norm)) return '.claude/settings*.json';
  if (/\.claude\/hooks\//i.test(norm)) return '.claude/hooks/**';
  if (/\.claude\/commands\//i.test(norm)) return '.claude/commands/**';
  if (/\.claude\/agents\//i.test(norm)) return '.claude/agents/**';
  return null;
}

const stats = {
  unallowedMcp: new Map(),
  tamperPaths: new Map(),
  totalSessions: 0,
  totalEvents: 0,
};

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function processEvent(evt) {
  const msg = evt.message;
  if (!msg || msg.role !== 'assistant') return;
  const content = msg.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    stats.totalEvents++;
    const tool = block.name;
    const inp = block.input || {};

    if (tool && tool.startsWith('mcp__')) {
      const parts = tool.split('__');
      const baseNs = parts.length >= 2 ? `${parts[0]}__${parts[1]}` : tool;
      if (!isMcpAllowed(tool) && !isMcpAllowed(baseNs)) {
        bump(stats.unallowedMcp, baseNs);
      }
    }

    if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') {
      const tamper = isTamperProtected(inp.file_path);
      if (tamper) bump(stats.tamperPaths, tamper);
    }
  }
}

function walk(dir) {
  let files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      files = files.concat(walk(fp));
    } else if (e.name.endsWith('.jsonl')) {
      try {
        const stat = fs.statSync(fp);
        if (stat.mtimeMs >= CUTOFF) files.push(fp);
      } catch {}
    }
  }
  return files;
}

const files = walk(PROJECTS_DIR);
stats.totalSessions = files.length;

for (const f of files) {
  let content;
  try {
    content = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = evt.timestamp ? new Date(evt.timestamp).getTime() : 0;
    if (ts && ts < CUTOFF) continue;
    processEvent(evt);
  }
}

const suggestions = [];
for (const [ns, count] of [...stats.unallowedMcp.entries()].sort((a, b) => b[1] - a[1])) {
  const isPluginMcp = ns.startsWith('mcp__plugin_') || ns.startsWith('mcp__ccd_');
  suggestions.push({
    rule: ns,
    count,
    risk: isPluginMcp ? 'low' : 'medium',
    rationale: isPluginMcp
      ? 'User-installed plugin/runtime MCP server'
      : 'External or third-party MCP server — verify before allowing',
  });
}

const result = {
  scanned_sessions: stats.totalSessions,
  total_events: stats.totalEvents,
  lookback_days: days,
  current_allow_count: allowList.length,
  suggestions,
  tamper_protected_writes: Object.fromEntries(stats.tamperPaths),
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');

if (!quiet) {
  process.stderr.write(`\n=== Permission Audit — last ${days}d (${stats.totalSessions} sessions, ${stats.totalEvents} tool calls) ===\n`);
  if (suggestions.length === 0) {
    process.stderr.write('✓ No unallowed MCP tools detected — current allow-list covers recent activity.\n');
  } else {
    process.stderr.write(`⚠ ${suggestions.length} MCP tool namespace(s) used recently are NOT in allow-list:\n`);
    for (const s of suggestions.slice(0, 15)) {
      const marker = s.risk === 'low' ? '🟢' : '🟡';
      process.stderr.write(`  ${marker} ${String(s.count).padStart(5)}×  ${s.rule}\n`);
    }
  }
  const tamperKeys = Object.keys(result.tamper_protected_writes);
  if (tamperKeys.length > 0) {
    process.stderr.write(`\nTamper-protected writes detected (cannot be allow-listed by design):\n`);
    for (const k of tamperKeys) {
      process.stderr.write(`  ${k}: ${result.tamper_protected_writes[k]}× — will always prompt\n`);
    }
  }
}
