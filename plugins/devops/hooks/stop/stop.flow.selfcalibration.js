#!/usr/bin/env node
/**
 * @hook stop.flow.selfcalibration
 * @version 1.1.0
 * @event Stop
 * @plugin devops
 * @description Run self-calibration when Claude finishes a response turn.
 *   Only fires if >10 minutes have passed since the last calibration in
 *   the current worktree.
 *
 *   Step 4 (Skill Internalization) batch math runs in the hook itself —
 *   discovery, cycle rotation, and persistence are deterministic JS, so
 *   they no longer depend on the LLM following SKILL.md prose. The hook
 *   emits the current batch's file paths in its prompt; Claude just reads
 *   them silently.
 *
 *   Worktree-specific cooldown: timestamp is keyed to process.cwd(), so
 *   parallel worktrees have independent cooldowns.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PLUGIN_DIR = path.resolve(__dirname, '..', '..');
const COOLDOWN_MS = 10 * 60 * 1000;
const CYCLE_FILE = path.join(os.tmpdir(), 'dotclaude-devops-calibration-cycle.json');

function worktreeKey() {
  const cwd = process.cwd().replace(/\\/g, '/');
  return crypto.createHash('md5').update(cwd).digest('hex').slice(0, 12);
}

function lastRunFile() {
  return path.join(os.tmpdir(), `dotclaude-devops-calibration-wt-${worktreeKey()}`);
}

function discoverDeepKnowledge() {
  const files = [];

  const pluginDk = path.join(PLUGIN_DIR, 'deep-knowledge');
  try {
    for (const f of fs.readdirSync(pluginDk)) {
      if (f.endsWith('.md') && f !== 'INDEX.md') {
        files.push(path.join(pluginDk, f));
      }
    }
  } catch {}

  const skillsDir = path.join(PLUGIN_DIR, 'skills');
  try {
    for (const skill of fs.readdirSync(skillsDir)) {
      const skillDk = path.join(skillsDir, skill, 'deep-knowledge');
      try {
        for (const f of fs.readdirSync(skillDk)) {
          if (f.endsWith('.md')) {
            files.push(path.join(skillDk, f));
          }
        }
      } catch {}
    }
  } catch {}

  return files.sort();
}

function readCycle() {
  try {
    const raw = fs.readFileSync(CYCLE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (Number.isInteger(data.cycle) && data.cycle >= 0) return data.cycle;
  } catch {}
  return 0;
}

function writeCycle(cycle) {
  try {
    fs.writeFileSync(CYCLE_FILE, JSON.stringify({ cycle }), 'utf8');
  } catch {}
}

function pickBatch(files, cycle) {
  const total = files.length;
  if (total === 0) return { batch: [], total: 0, batchSize: 0, startIndex: 0 };
  const batchSize = Math.ceil(total * 0.25);
  const startIndex = (cycle * batchSize) % total;
  const batch = [];
  for (let i = 0; i < batchSize; i++) {
    batch.push(files[(startIndex + i) % total]);
  }
  return { batch, total, batchSize, startIndex };
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  const file = lastRunFile();

  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs < COOLDOWN_MS) {
      process.exit(0);
    }
  } catch {}

  const skillPath = path.join(PLUGIN_DIR, 'scheduled-tasks', 'self-calibration', 'SKILL.md');
  try {
    fs.readFileSync(skillPath, 'utf8');
  } catch {
    process.exit(0);
  }

  try {
    fs.writeFileSync(file, String(Date.now()), 'utf8');
  } catch {}

  const allFiles = discoverDeepKnowledge();
  const cycle = readCycle();
  const { batch, total, batchSize, startIndex } = pickBatch(allFiles, cycle);
  writeCycle(cycle + 1);

  const skillPathFwd = skillPath.replace(/\\/g, '/');
  const batchList = batch.length
    ? batch.map(f => `  - ${f.replace(/\\/g, '/')}`).join('\n')
    : '  (no deep-knowledge files discovered — skip Step 4)';

  process.stdout.write(
    `Execute self-calibration: Read ${skillPathFwd} and run ALL steps (0 through 5).\n` +
    `Use the file's parent of scheduled-tasks/ as the plugin root.\n\n` +
    `Step 4 batch — cycle ${cycle}, files ${startIndex}..${startIndex + batchSize - 1} of ${total}:\n` +
    `${batchList}\n\n` +
    `The hook has already advanced the cycle index and persisted it to ` +
    `${CYCLE_FILE.replace(/\\/g, '/')} — just silently read the listed files for Step 4.\n`
  );
});
