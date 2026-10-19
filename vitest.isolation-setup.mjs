/**
 * Give every test file a temp directory of its own (vitest setupFiles).
 *
 * Why: hooks and MCP tools keep cross-hook state as `dotclaude-*` files in
 * os.tmpdir(), and session-id.js's advisory read falls back to the NEWEST
 * file with a matching prefix from ANY session. In a shared tmpdir a test
 * therefore read state written by a parallel test file — or by the live
 * Claude session the developer ran `npm test` from — and the card, agent-
 * nudge and card-relay suites went red only inside a session (2026-10-12,
 * 15 failures that vanished in a plain shell). Every run also left its
 * markers behind (#699).
 *
 * os.tmpdir() reads TEMP/TMP (Windows) or TMPDIR (POSIX) on every call, and
 * spawned hooks inherit process.env, so pointing all three at a fresh
 * per-file directory isolates the test and every child it starts. The
 * directory is removed after the file; a child still holding a file there
 * only leaves it to the OS temp cleanup.
 *
 * The live session's identity is dropped as well: a test must never act on
 * the session that happens to run it.
 *
 * CLAUDE_PLUGIN_ROOT points at this checkout's plugin, as Claude Code sets it
 * for every hook it runs. Without it plugin-guard passes a spawned hook only
 * when the machine's ~/.claude/settings.json enables devops@dotclaude — a
 * cloud session (synced plugin) or a fresh CI box has no such entry, and
 * every hook test there exited 0 before its first line (2026-10-19, 97
 * failures). Suites that test the disabled path delete it per spawn.
 */

import { afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const realTmp = os.tmpdir();
const root = fs.mkdtempSync(path.join(realTmp, "vt-"));
for (const k of ["TEMP", "TMP", "TMPDIR"]) process.env[k] = root;
for (const k of ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_HOST_SESSION_ID", "CODEX_COMPANION_SESSION_ID"]) delete process.env[k];
process.env.CLAUDE_PLUGIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "plugins", "devops");

afterAll(() => {
  for (const k of ["TEMP", "TMP", "TMPDIR"]) process.env[k] = realTmp;
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* held by a child — the OS temp cleanup gets it */ }
});
