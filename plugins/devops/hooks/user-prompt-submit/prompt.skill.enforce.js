#!/usr/bin/env node
/**
 * @hook prompt.skill.enforce
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detects /devops-* skill commands mentioned INLINE in a user
 *   prompt (typed as text, not invoked as a real slash command) and injects a
 *   mandatory instruction to load the referenced skill via the Skill tool
 *   before answering.
 *
 *   Why (#235): when a user writes "/devops-concept lass uns das machen…"
 *   inside a longer message, the harness does not expand it as a slash
 *   command — no skill is loaded, and Claude predictably improvises the
 *   skill's workflow from memory, violating skill contracts (bridge server,
 *   decision panel, gates). Output-side gates (e.g. post.concept.gate) catch
 *   some of the damage after the fact; this hook closes the input side by
 *   nudging the skill load BEFORE any work happens.
 *
 *   A real slash-command invocation arrives with the skill already loaded
 *   (<command-name> tag in the expanded prompt) — those turns are skipped.
 *   Mentions that do not correspond to an existing skill directory under
 *   the plugin's skills/ are ignored (typos, hypothetical names).
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');

// A mention is "/devops-<name>" preceded by start-of-string, whitespace, or
// common opening punctuation — NOT by a path segment ("docs/devops-guide.md").
const MENTION_RE = /(^|[\s([{"'`>])\/(devops-[a-z][a-z0-9-]*)/gi;

/**
 * Extract inline /devops-* skill mentions from a user prompt.
 * @param {string} message — raw user prompt
 * @param {string[]} knownSkills — existing skill directory names
 * @returns {string[]} deduped skill names (lowercase) in order of appearance
 */
function detectInlineSkillMentions(message, knownSkills) {
  if (typeof message !== 'string' || !message) return [];
  // Already-expanded slash command → the skill is loaded this turn; a nudge
  // would only add noise (and "invoke again" would be wrong).
  if (message.includes('<command-name>')) return [];
  const known = new Set((knownSkills || []).map(s => String(s).toLowerCase()));
  const found = [];
  for (const m of message.matchAll(MENTION_RE)) {
    const name = m[2].toLowerCase().replace(/-+$/, '');
    if (known.has(name) && !found.includes(name)) found.push(name);
  }
  return found;
}

/**
 * Existing skill directory names under the plugin's skills/ root.
 * @returns {string[]}
 */
function listPluginSkills() {
  try {
    const dir = path.join(__dirname, '..', '..', 'skills');
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }

  const message = hook.prompt || hook.user_message || hook.message || '';
  const mentions = detectInlineSkillMentions(message, listPluginSkills());
  if (mentions.length === 0) process.exit(0);

  const calls = mentions.map(n => `  Skill("${n}")`).join('\n');
  process.stdout.write([
    `[prompt.skill.enforce] The user message references ${mentions.map(n => '/' + n).join(', ')} inline.`,
    '',
    'MANDATORY: invoke the Skill tool for each referenced skill BEFORE any other',
    'response or action this turn:',
    calls,
    '',
    'Do NOT improvise the skill\'s workflow from memory — a mentioned-but-not-loaded',
    'skill predictably violates its contract (bridge server, decision panel, gates).',
    'If a skill turns out not to fit the request after loading, you may set it aside.',
  ].join('\n') + '\n');
});

module.exports = { detectInlineSkillMentions, listPluginSkills, MENTION_RE };
