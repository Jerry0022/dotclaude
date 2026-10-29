#!/usr/bin/env node
/**
 * @module dotclaude-ship-cli
 * @version 0.2.0
 * @plugin devops
 * @description Offline entry point to the ship pipeline tools — the same
 *   handlers the devops MCP server (`dotclaude`) offers, called without MCP.
 *   It is ALSO the server's executor: the server runs every ship_* call
 *   through this file in a child process (ship/server.js), so the long,
 *   synchronous git/gh/npm work never blocks the shared event loop. On that
 *   path (env DOTCLAUDE_SHIP_VIA_SERVER=1) the .ship-cli-last.json write is
 *   skipped — the hooks count the MCP result directly.
 *
 *     node mcp-server/ship/cli.js <tool> [<params.json> | -]
 *
 *   Reached when the MCP server is installed but this session never connected
 *   to it: Claude Code's machine-wide failure cache ("Skipping connection
 *   (recent failure cached …)") or a CONNECT_TIMEOUT under load. There is no
 *   in-session reconnect for plugin servers, so without this path a ship that
 *   was ready had to wait for a restart. Same tools, same zod validation, same
 *   checkpoint record as the server; the result JSON goes to stdout.
 *
 *   Each result is also written to <repo root>/.claude/.ship-cli-last.json
 *   (lib/cli-last-result.js) — the run-contract post hook's fallback when
 *   stdout was redirected to a file, so a CLI ship_release still counts.
 *
 *   Every call also appends one line (start, duration, outcome, repeat) to
 *   ~/.claude/ship-timings.jsonl (lib/ship-timings.js) — silent, never fails it.
 *
 *   Exit codes: 0 the handler returned (its result may still say ok:false),
 *   1 the handler threw, 2 unknown tool or invalid params.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { writeLastResult } from "./lib/cli-last-result.js";
import { recordTiming } from "./lib/ship-timings.js";
import { PROGRESS_PREFIX } from "./lib/progress.js";

import { schema as preflightSchema, handler as preflightHandler } from "./tools/preflight.js";
import { schema as buildSchema, handler as buildHandler } from "./tools/build.js";
import { schema as versionBumpSchema, handler as versionBumpHandler } from "./tools/version-bump.js";
import { schema as releaseSchema, handler as releaseHandler } from "./tools/release.js";
import { schema as promoteSchema, handler as promoteHandler } from "./tools/promote.js";
import { schema as cleanupSchema, handler as cleanupHandler } from "./tools/cleanup.js";
import { schema as hygieneSchema, handler as hygieneHandler } from "./tools/hygiene.js";
import { schema as runSchema, handler as runHandler } from "./tools/run.js";

export const TOOLS = {
  ship_preflight: [preflightSchema, preflightHandler],
  ship_build: [buildSchema, buildHandler],
  ship_version_bump: [versionBumpSchema, versionBumpHandler],
  ship_release: [releaseSchema, releaseHandler],
  ship_promote: [promoteSchema, promoteHandler],
  ship_cleanup: [cleanupSchema, cleanupHandler],
  ship_hygiene: [hygieneSchema, hygieneHandler],
  ship_run: [runSchema, runHandler],
};

function fail(code, message) {
  process.stderr.write(`[dotclaude-ship-cli] ${message}\n`);
  process.exit(code);
}

/** Parity with the server's recordStep: an interrupted ship resumes at the step that did not finish. */
function recordStep(name, params, result) {
  try {
    createRequire(import.meta.url)("../../hooks/lib/ship-checkpoint.js").recordShipStep(name, params, result);
  } catch { /* never fail the call it follows */ }
}

const [tool, source] = process.argv.slice(2);
const entry = TOOLS[tool];
if (!entry) fail(2, `unknown tool "${tool || ""}" — one of: ${Object.keys(TOOLS).join(", ")}`);

let raw = "{}";
if (source) {
  try { raw = readFileSync(source === "-" ? 0 : source, "utf8"); }
  catch (e) { fail(2, `cannot read params "${source}": ${e.message}`); }
}

let params;
try { params = JSON.parse(raw || "{}"); }
catch (e) { fail(2, `params are not valid JSON: ${e.message}`); }

const [schema, handler] = entry;
const parsed = schema.safeParse(params);
if (!parsed.success) {
  fail(2, `params do not match the ${tool} schema:\n` +
    parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"));
}

// Progress for the server's MCP heartbeat: one stderr line per message (ship/server.js reads them).
const progress = process.env.DOTCLAUDE_SHIP_VIA_SERVER === "1" && (tool === "ship_build" || tool === "ship_run")
  ? (msg) => process.stderr.write(`${PROGRESS_PREFIX}${msg}
`)
  : undefined;

const startedAt = Date.now();
try {
  const result = await handler(parsed.data, progress ? { progress } : undefined);
  recordTiming({ cwd: parsed.data.cwd || process.cwd(), tool, startedAt, durationMs: Date.now() - startedAt, result });
  recordStep(tool, parsed.data, result);
  if (process.env.DOTCLAUDE_SHIP_VIA_SERVER !== "1") writeLastResult(tool, parsed.data, result);
  // Exit only once stdout is flushed — a pipe reader (the server) must get the whole JSON.
  process.stdout.write(JSON.stringify(result, null, 2) + "\n", () => process.exit(0)); // stdout-ok — CLI result
} catch (e) {
  recordTiming({ cwd: parsed.data.cwd || process.cwd(), tool, startedAt, durationMs: Date.now() - startedAt, outcome: "error" });
  process.stdout.write(JSON.stringify({ error: true, message: e && e.message }) + "\n", () => process.exit(1)); // stdout-ok
}
