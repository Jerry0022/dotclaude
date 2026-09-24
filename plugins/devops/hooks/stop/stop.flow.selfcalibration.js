#!/usr/bin/env node
/**
 * @hook stop.flow.selfcalibration
 * @version 1.3.0
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
 *
 *   Persistence is best-effort with atomic write-temp-then-rename. There is
 *   no inter-process lock, so two Stop events that interleave their
 *   read-modify-write of the cycle file can lose one increment (worst case:
 *   one batch repeats — no crash, no data loss). On unwritable tmpdir the
 *   cooldown silently degrades to "fire every turn" — acceptable for a
 *   calibration loop, surfaced in SKILL.md.
 *
 *   Discovery walks every `deep-knowledge/` dir under `skills/` at any depth
 *   (≤ SKILL_DK_MAX_DEPTH): since the skill restructure PR 2 the folded modes
 *   keep theirs under `skills/<skill>/modes/<mode>/deep-knowledge/`, which the
 *   old one-level `skills/<skill>/deep-knowledge` scan silently dropped.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PLUGIN_DIR = path.resolve(__dirname, '..', '..');
const COOLDOWN_MS = 10 * 60 * 1000;
const CYCLE_FILE = path.join(os.tmpdir(), 'dotclaude-devops-calibration-cycle.json');
/** skills/ → <skill> → modes → <mode> → deep-knowledge is depth 3. */
const SKILL_DK_MAX_DEPTH = 4;

function worktreeKey() {
  const cwd = process.cwd().replace(/\\/g, '/');
  return crypto.createHash('md5').update(cwd).digest('hex').slice(0, 12);
}

function lastRunFile() {
  return path.join(os.tmpdir(), `dotclaude-devops-calibration-wt-${worktreeKey()}`);
}

// Atomic write: write to .tmp then rename. Prevents partial reads from
// concurrent Stop hooks observing a half-written file. Same pattern as
// hooks/lib/session-id.js#writeSessionFile.
function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
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

  // skills/<skill>/deep-knowledge and skills/<skill>/modes/<mode>/deep-knowledge
  // (any depth up to SKILL_DK_MAX_DEPTH) — never node_modules or dot dirs.
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const sub = path.join(dir, e.name);
      if (e.name === 'deep-knowledge') {
        try {
          for (const f of fs.readdirSync(sub)) {
            if (f.endsWith('.md')) files.push(path.join(sub, f));
          }
        } catch {}
      } else if (depth < SKILL_DK_MAX_DEPTH) {
        walk(sub, depth + 1);
      }
    }
  };
  walk(path.join(PLUGIN_DIR, 'skills'), 0);

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
  atomicWrite(CYCLE_FILE, JSON.stringify({ cycle }));
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

module.exports = { discoverDeepKnowledge };

if (require.main === module) {
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

  atomicWrite(file, String(Date.now()));

  const allFiles = discoverDeepKnowledge();
  const cycle = readCycle();
  const { batch, total, batchSize, startIndex } = pickBatch(allFiles, cycle);
  writeCycle(cycle + 1);

  const skillPathFwd = skillPath.replace(/\\/g, '/');
  const batchHeader = total === 0
    ? `Step 4 batch — no deep-knowledge files discovered, skip Step 4:`
    : `Step 4 batch — cycle ${cycle}, files ${startIndex}..${startIndex + batchSize - 1} of ${total}:`;
  const batchList = batch.length
    ? batch.map(f => `  - ${f.replace(/\\/g, '/')}`).join('\n')
    : '  (none)';

  process.stdout.write(
    `Execute self-calibration: Read ${skillPathFwd} and run ALL steps (0 through 5).\n` +
    `Use the file's parent of scheduled-tasks/ as the plugin root.\n\n` +
    `${batchHeader}\n` +
    `${batchList}\n\n` +
    `The hook has already advanced the cycle index and persisted it to ` +
    `${CYCLE_FILE.replace(/\\/g, '/')} — just silently read the listed files for Step 4.\n`
  );
});
}
