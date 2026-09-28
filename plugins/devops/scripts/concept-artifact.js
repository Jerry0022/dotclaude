#!/usr/bin/env node
/**
 * @script concept-artifact
 * @version 0.1.0
 * @plugin devops
 * @description The second-tier no-bridge fallback of `/auto-concept` (#589): turn
 *   a generated concept page into a claude.ai artifact copy whose decisions land
 *   in the artifact's `db` store instead of the localhost bridge.
 *
 *   The engine page stays byte-for-byte what `docs/concepts/` holds. The script
 *   inserts ONE wrapper `<script>` right after the opening `<head>` tag, so it
 *   runs before any engine code, and writes the copy next to the source as
 *   `<name>.artifact.html`. The wrapper:
 *
 *   - installs itself only when `window.claude.use` exists (an artifact
 *     viewer). A saved file, the bridge-served page or any other host has no
 *     `window.claude`, so the wrapper does nothing there and the local-bridge
 *     path is never touched.
 *   - diverts `POST /decisions` to `db.doc("concept/decisions").set(payload)`.
 *     A stored write answers `{durable:true}`; no `db` namespace or a refused
 *     write answers 507, so the engine keeps its `-pending` copy and tells the
 *     user — the same never-ack-what-is-not-stored rule as `concept-server.py`.
 *   - diverts the read-back `GET /decisions` (a reload restores a sent round)
 *     to the same document. Without a `db` namespace it rejects like an
 *     unreachable bridge, so the engine falls back to its local queue.
 *   - leaves every other request alone. `/heartbeat`, `/status`, `/draft` find
 *     no bridge on the artifact host, so the heartbeat stays honest ("not
 *     connected") — nobody live-monitors an artifact concept, no cron runs.
 *
 *   Claude reads the decisions back on its next turn with
 *   `ArtifactData { action: "get", collection: "concept", doc_id: "decisions" }`
 *   against the published artifact's url — the `readBack` field of the output.
 *
 *   Usage:
 *     concept-artifact.js --artifact <concept page .html> [--out <path>]
 *   Prints one JSON object on stdout: { ok, source, out, capabilities, readBack }.
 *   Exit 2 on bad arguments or a page without <head>/<html>.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const START = '<!-- concept-artifact:wrapper:start -->';
const END = '<!-- concept-artifact:wrapper:end -->';
const DOC_PATH = 'concept/decisions';

// Plain ES5-style functions: the wrapper is inlined verbatim into the page.
const WRAPPER_JS = `(function () {
  var claude = window.claude;
  if (!claude || typeof claude.use !== 'function' || typeof window.fetch !== 'function') return;
  var realFetch = window.fetch.bind(window);
  var dbPromise = null;
  function getDb() {
    if (!dbPromise) dbPromise = Promise.resolve().then(function () { return claude.use('db'); }).catch(function () { return null; });
    return dbPromise;
  }
  function reply(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  }
  function isDecisions(input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    try { return new URL(url, location.href).pathname === '/decisions'; } catch (e) { return false; }
  }
  window.fetch = function (input, init) {
    if (!isDecisions(input)) return realFetch(input, init);
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'POST') {
      return getDb().then(function (db) {
        if (!db) return reply(507, { durable: false, reason: 'no-artifact-db' });
        var data;
        try { data = JSON.parse((init && init.body) || '{}'); } catch (e) { return reply(400, { durable: false, reason: 'bad-json' }); }
        data._artifactStoredAt = new Date().toISOString();
        return db.doc('${DOC_PATH}').set(data).then(
          function () { return reply(200, { durable: true }); },
          function (e) { return reply(507, { durable: false, reason: (e && e.code) || 'write-failed' }); }
        );
      });
    }
    if (method === 'GET') {
      return getDb().then(function (db) {
        if (!db) throw new TypeError('concept-artifact: no artifact db');
        return db.doc('${DOC_PATH}').get().then(function (snap) {
          return reply(200, snap.exists ? snap.data() : {});
        });
      });
    }
    return Promise.resolve(reply(405, { reason: 'method-not-allowed' }));
  };
})();`;

function wrapperBlock() {
  return `${START}<script>${WRAPPER_JS}</script>${END}`;
}

/** Remove a previously inserted wrapper so a re-run replaces instead of stacking. */
function stripWrapper(html) {
  const s = html.indexOf(START);
  if (s < 0) return html;
  const e = html.indexOf(END, s);
  if (e < 0) return html;
  return html.slice(0, s) + html.slice(e + END.length);
}

/**
 * Insert the wrapper right after the opening <head> tag (else <html>).
 * @returns {{ok:true,html:string}|{ok:false,reason:string}}
 */
function wrap(source) {
  const html = stripWrapper(String(source));
  const m = /<head(\s[^>]*)?>/i.exec(html) || /<html(\s[^>]*)?>/i.exec(html);
  if (!m) return { ok: false, reason: 'no-head' };
  const at = m.index + m[0].length;
  return { ok: true, html: html.slice(0, at) + wrapperBlock() + html.slice(at) };
}

function defaultOut(src) {
  const ext = path.extname(src);
  return path.join(path.dirname(src), `${path.basename(src, ext)}.artifact${ext || '.html'}`);
}

function parseArgs(argv) {
  const opts = { artifact: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--artifact') opts.artifact = argv[++i] || null;
    else if (argv[i] === '--out') opts.out = argv[++i] || null;
  }
  return opts;
}

function run(opts) {
  if (!opts.artifact) return { ok: false, reason: 'missing --artifact <page.html>' };
  const src = path.resolve(opts.artifact);
  let source;
  try { source = fs.readFileSync(src, 'utf8'); } catch (e) { return { ok: false, reason: 'unreadable', error: e.message }; }
  const res = wrap(source);
  if (!res.ok) return res;
  const out = path.resolve(opts.out || defaultOut(src));
  fs.writeFileSync(out, res.html);
  return {
    ok: true,
    source: src,
    out,
    capabilities: { db: {} },
    readBack: { tool: 'ArtifactData', action: 'get', collection: 'concept', doc_id: 'decisions' },
    note: 'Publish `out` with the Artifact tool and capabilities {db:{}}; read the decisions on the next turn with readBack against the artifact url. No bridge, no crons.',
  };
}

module.exports = { wrap, stripWrapper, wrapperBlock, run, parseArgs, START, END, DOC_PATH, WRAPPER_JS };

if (require.main === module) {
  const result = run(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exit(2);
}
