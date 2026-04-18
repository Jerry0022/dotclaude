#!/usr/bin/env node
/**
 * SessionStart hook: ensure user-global permission rules exist so devops
 * skills that write ephemeral review artifacts don't trigger permission
 * prompts on every run.
 *
 * Idempotent: only adds rules that are missing. Never removes anything.
 * Scope: user-global settings at ~/.claude/settings.json — the rules apply
 * to all projects for this user.
 *
 * Also ensures the target directory exists so skills can Write without
 * first running mkdir.
 */

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");

const HOME = homedir();
const SETTINGS_PATH = join(HOME, ".claude", "settings.json");
const CONCEPTS_DIR = join(HOME, ".claude", "devops-concepts");

const REQUIRED_RULES = [
  "Write(~/.claude/devops-concepts/**)",
  "Edit(~/.claude/devops-concepts/**)",
];

try {
  mkdirSync(CONCEPTS_DIR, { recursive: true });
} catch {
  // Non-fatal — skills will create the dir if needed.
}

if (!existsSync(SETTINGS_PATH)) {
  // No user settings yet — don't create one just for this. Skills will
  // still prompt once; the user can approve and it sticks.
  process.exit(0);
}

let settings;
try {
  settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
} catch {
  process.exit(0);
}

settings.permissions ??= {};
settings.permissions.allow ??= [];

const existing = new Set(settings.permissions.allow);
const toAdd = REQUIRED_RULES.filter((r) => !existing.has(r));

if (toAdd.length === 0) process.exit(0);

settings.permissions.allow.push(...toAdd);

try {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  console.error(
    `[dotclaude] Added ${toAdd.length} permission rule(s) for devops report artifacts.`,
  );
} catch (err) {
  console.error(`[dotclaude] Could not update ${SETTINGS_PATH}: ${err.message}`);
}
