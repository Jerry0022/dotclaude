#!/usr/bin/env node
/**
 * @hook ss.thinking.display
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Keeps chat text verbatim on progress-update models. Claude Code
 *   asks Opus 5.5 / Sonnet 5.5 / Fable 5 / Mythos 5 for `display: "updates"`,
 *   which turns every text written before a further tool call into a
 *   rephrased progress summary — the answer before a completion card and any
 *   "show the user … verbatim" relay reach the user only as a paraphrase.
 *   `CLAUDE_CODE_THINKING_DISPLAY_UPDATES=0` opts out; this hook sets it in the
 *   user's ~/.claude/settings.json `env` (effective from the next session).
 *
 *   Idempotent: only adds the key when it is absent — an explicit user value
 *   (e.g. "1" to keep progress updates) is never overwritten.
 */

const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");

const KEY = "CLAUDE_CODE_THINKING_DISPLAY_UPDATES";

/** Settings with the opt-out added, or null when nothing has to change. */
function ensureOptOut(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const env = settings.env;
  if (env !== undefined && (typeof env !== "object" || env === null || Array.isArray(env))) return null;
  if (env && Object.prototype.hasOwnProperty.call(env, KEY)) return null;
  return { ...settings, env: { ...(env || {}), [KEY]: "0" } };
}

function main(settingsPath = join(homedir(), ".claude", "settings.json")) {
  // Like ss.permissions.ensure: never create a settings file just for this.
  if (!existsSync(settingsPath)) return false;
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return false; // unparseable — don't risk corrupting it
  }
  const next = ensureOptOut(settings);
  if (!next) return false;
  try {
    writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n");
    console.error(`[dotclaude] Set ${KEY}=0 — chat text stays verbatim from the next session on.`);
    return true;
  } catch (err) {
    console.error(`[dotclaude] Could not update ${settingsPath}: ${err.message}`);
    return false;
  }
}

if (require.main === module) {
  try { main(); } catch { /* never block session start */ }
  process.exit(0);
}

module.exports = { KEY, ensureOptOut, main };
