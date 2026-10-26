'use strict';
/**
 * One matcher for the ship tools, shared by every hook that recognises a
 * release. `ship_run` drives preflight → build → bump → release → cleanup →
 * hygiene in one call, so for every hook it is a release attempt exactly like
 * `ship_release` (contract gate, merged-evidence, archive gate, completion).
 *
 * API
 *   shipToolName(name)          → "ship_release" | "ship_run" | … | null
 *                                 (both MCP prefixes: current and legacy `-ship`)
 *   isShipTool(name, kind)      → kind: "run" | "release" | "preflight" | "build" |
 *                                 "cleanup" | "hygiene". "release" is the
 *                                 release-capable set: ship_release AND ship_run.
 *   isReleaseTool(name)         → isShipTool(name, "release")
 *   parseShipResult(response)   → result object of an MCP envelope / JSON string /
 *                                 bare object, or null
 *   releaseResultOf(name, resp) → {ok, merged, decision} | null (unreadable)
 *                                 ship_release: ok = `success`; ship_run: a final
 *                                 result carries `merged`, {ok:false, needs} is a
 *                                 decision point — never merged, decision = needs
 *   partialOf(resp)             → ship_run's `partial` sub-results ({} if none)
 *   cliShipTool(seg, rawSeg)    → "ship_<kind>" when the segment is
 *                                 `node …/ship/cli.js ship_<kind>`, else null
 */

const PREFIXES = ['mcp__plugin_devops_dotclaude__', 'mcp__plugin_devops_dotclaude-ship__'];
const KINDS = ['run', 'release', 'preflight', 'build', 'cleanup', 'hygiene'];

/** Short ship tool name ("ship_run", …) of an MCP tool name, or null. */
function shipToolName(name) {
  if (typeof name !== 'string') return null;
  if (KINDS.some((k) => name === `ship_${k}`)) return name; // bare CLI name
  for (const p of PREFIXES) {
    if (!name.startsWith(p)) continue;
    const short = name.slice(p.length);
    if (KINDS.some((k) => short === `ship_${k}`)) return short;
  }
  return null;
}

/** @param {string} name MCP tool name  @param {string} kind see header ("release" also matches ship_run) */
function isShipTool(name, kind) {
  const short = shipToolName(name);
  if (!short) return false;
  if (kind === 'release') return short === 'ship_release' || short === 'ship_run';
  return short === `ship_${kind}`;
}

const isReleaseTool = (name) => isShipTool(name, 'release');

/** The result object of an MCP response ({content:[{text}]}, JSON string, bare object), or null. */
function parseShipResult(response) {
  let r = response;
  try {
    const blocks = r && Array.isArray(r.content) ? r.content : Array.isArray(r) ? r : null;
    if (blocks) {
      r = JSON.parse(blocks.filter((c) => c && c.type === 'text').map((c) => c.text).join(''));
    } else if (typeof r === 'string') {
      const t = r.trim();
      try { r = JSON.parse(t); } catch {
        const m = t.match(/\{[\s\S]*\}/);
        r = m ? JSON.parse(m[0]) : null;
      }
    }
  } catch { return null; }
  return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
}

/**
 * What a ship tool result says about a release. `merged` is the truthiness of
 * the result's `merged` (ship_release reports the base branch name there) —
 * never `success`, which the skipped shapes (file-only, no-remote) also set.
 * @returns {{ok:boolean, merged:boolean, decision:string|null}|null}
 */
function releaseResultOf(name, response) {
  const obj = parseShipResult(response);
  if (!obj) return null;
  const short = shipToolName(name) || (typeof name === 'string' ? name : '');
  if (short === 'ship_run') {
    if (obj.ok === false) {
      return { ok: false, merged: false, decision: typeof obj.needs === 'string' ? obj.needs : (obj.disabled ? 'disabled' : 'blocked') };
    }
    return { ok: obj.ok === true, merged: !!obj.merged, decision: null };
  }
  return { ok: obj.success === true, merged: !!obj.merged, decision: null };
}

/** ship_run's `partial` (sub-results gathered before a decision point), or {}. */
function partialOf(response) {
  const obj = parseShipResult(response);
  return obj && obj.partial && typeof obj.partial === 'object' ? obj.partial : {};
}

/**
 * The offline ship CLI (`node …/mcp-server/ship/cli.js <tool> p.json`). The
 * tool name is read from the quote-stripped segment (a quoted mention is no
 * call), the script path from the raw one (it may be quoted on Windows).
 */
function cliShipTool(seg, rawSeg) {
  if (!/ship[\\/]+cli\.js/i.test(rawSeg)) return null;
  const m = String(seg).match(/(?:^|\s)ship_(run|release|preflight|build|cleanup|hygiene)(?=\s|$)/);
  return m ? `ship_${m[1]}` : null;
}

module.exports = { PREFIXES, shipToolName, isShipTool, isReleaseTool, parseShipResult, releaseResultOf, partialOf, cliShipTool };
