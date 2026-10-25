'use strict';
/**
 * @module dispatch/lanes
 * @version 0.1.0
 * @plugin devops
 * @description Which of an event's modules may run at the same time inside
 *   the one dispatcher process. Separate hook processes ran fully parallel;
 *   worker threads of one process share ONE pid, and a lib that names its
 *   temp file `<target>.${process.pid}.tmp` (no random part) would then let
 *   two threads interleave writes into the same temp file. Such a file is a
 *   "pid-tmp writer". Two modules whose require graphs reach the same
 *   pid-tmp writer go into the same lane; lanes run in parallel, modules in a
 *   lane run one after another in manifest order. Everything else keeps the
 *   parallelism it had as separate processes.
 *
 *   The analysis is static and conservative (sharing a writer lib does not
 *   prove both modules write — it only rules the race out). build-hooks-json
 *   stores the result in dispatch/lanes.json; manifest.test.js fails when it
 *   is stale. Without a usable lanes.json the dispatcher runs every module in
 *   ONE lane (sequential: safe, slower).
 */

const fs = require('fs');
const path = require('path');

const PID_TMP = /\$\{process\.pid\}/;
const RANDOM = /Math\.random|randomBytes|randomUUID/;
const PATHISH = /tmp|stale|taken|lock|claim|junk|index|\.json|path\.join|\$\{(?:file|f|p|target|filePath|full)\}/i;

/** True when `text` names a temp/aside file by the pid alone. */
function isPidTmpWriter(text) {
  return String(text).split('\n').some((line) => PID_TMP.test(line) && !RANDOM.test(line) && PATHISH.test(line));
}

function resolveLocal(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const p of [base, `${base}.js`, `${base}.cjs`, path.join(base, 'index.js')]) {
    try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

/** Every local file `file` requires, transitively (itself included). */
function requireGraph(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return seen; }
  const re = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    const p = resolveLocal(file, m[1]);
    if (p && /\.c?js$/.test(p)) requireGraph(p, seen);
  }
  return seen;
}

/**
 * @param {Array<{name:string, file:string}>} modules in manifest order
 * @param {string} rootForNames paths in `writers` are relative to it
 * @returns {{lanes: string[][], writers: Record<string,string[]>}}
 */
function computeLanes(modules, rootForNames) {
  const writerCache = new Map();
  const isWriter = (f) => {
    if (!writerCache.has(f)) {
      let t = '';
      try { t = fs.readFileSync(f, 'utf8'); } catch { /* missing */ }
      writerCache.set(f, isPidTmpWriter(t));
    }
    return writerCache.get(f);
  };
  const writers = {};
  const parent = modules.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map(); // writer file → first module index
  modules.forEach((m, i) => {
    const ws = [...requireGraph(m.file)].filter(isWriter).sort();
    writers[m.name] = ws.map((w) => path.relative(rootForNames, w).replace(/\\/g, '/'));
    for (const w of ws) {
      if (!owner.has(w)) owner.set(w, i);
      else parent[find(i)] = find(owner.get(w));
    }
  });
  const byRoot = new Map();
  modules.forEach((m, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(m.name);
  });
  const lanes = [...byRoot.entries()].sort((a, b) => a[0] - b[0]).map(([, names]) => names);
  return { lanes, writers };
}

module.exports = { computeLanes, isPidTmpWriter, requireGraph };
