#!/usr/bin/env node
/**
 * @script ship-carddata
 * @plugin devops
 * @description CLI over hooks/lib/ship-carddata.js (#712 R6). A delegated
 *   `--card-data` ship writes its `done` payload here before it returns, so a
 *   compaction in the parent cannot lose the card input; the parent clears it
 *   after the render (render_completion_card also consumes it).
 *
 *   node ship-carddata.js write --cwd <dir> --session <parent id> < done.json
 *   node ship-carddata.js show  --cwd <dir> --session <parent id>
 *   node ship-carddata.js clear --cwd <dir> --session <parent id>
 */

const lib = require('../hooks/lib/ship-carddata');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const cmd = process.argv[2];
  const cwd = arg('cwd') || process.cwd();
  const sid = arg('session');
  let out;
  if (cmd === 'write') {
    let payload = null;
    try { payload = JSON.parse(require('fs').readFileSync(0, 'utf8')); } catch { payload = null; }
    out = { ok: lib.writeCardData(cwd, sid, payload || {}), path: lib.cardDataPath(cwd, sid) };
  } else if (cmd === 'show') {
    const data = lib.readCardData(cwd, sid);
    out = data ? { open: true, ...data } : { open: false };
  } else if (cmd === 'clear') {
    lib.clearCardData(cwd, sid);
    out = { ok: true };
  } else {
    process.stderr.write('usage: ship-carddata.js write|show|clear --cwd <dir> --session <id>\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (out.ok === false) process.exit(1);
}

if (require.main === module) main();
