#!/usr/bin/env node
/**
 * @module dotclaude-ship-cli
 * @version 0.1.0
 * @plugin devops
 * @description Offline entry point to the ship pipeline tools — the same
 *   handlers the dotclaude-ship MCP server registers, called without MCP.
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
 *   Exit codes: 0 the handler returned (its result may still say ok:false),
 *   1 the handler threw, 2 unknown tool or invalid params.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { schema as preflightSchema, handler as preflightHandler } from "./tools/preflight.js";
import { schema as buildSchema, handler as buildHandler } from "./tools/build.js";
import { schema as versionBumpSchema, handler as versionBumpHandler } from "./tools/version-bump.js";
import { schema as releaseSchema, handler as releaseHandler } from "./tools/release.js";
import { schema as promoteSchema, handler as promoteHandler } from "./tools/promote.js";
import { schema as cleanupSchema, handler as cleanupHandler } from "./tools/cleanup.js";
import { schema as hygieneSchema, handler as hygieneHandler } from "./tools/hygiene.js";

export const TOOLS = {
  ship_preflight: [preflightSchema, preflightHandler],
  ship_build: [buildSchema, buildHandler],
  ship_version_bump: [versionBumpSchema, versionBumpHandler],
  ship_release: [releaseSchema, releaseHandler],
  ship_promote: [promoteSchema, promoteHandler],
  ship_cleanup: [cleanupSchema, cleanupHandler],
  ship_hygiene: [hygieneSchema, hygieneHandler],
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

try {
  const result = await handler(parsed.data);
  recordStep(tool, parsed.data, result);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n"); // stdout-ok — CLI result
  process.exit(0);
} catch (e) {
  process.stdout.write(JSON.stringify({ error: true, message: e && e.message }) + "\n"); // stdout-ok
  process.exit(1);
}
