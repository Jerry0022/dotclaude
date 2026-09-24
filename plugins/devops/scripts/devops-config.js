#!/usr/bin/env node
/**
 * @script devops-config
 * @version 0.1.0
 * @plugin devops
 * @description Read and change the user-tunable plugin settings
 *   (hooks/lib/devops-config.js) — the tool Claude uses when a user says in
 *   plain words how the plugin should behave, per project or globally.
 *   Runbook: deep-knowledge/devops-config.md.
 *
 *   Usage:
 *     node devops-config.js list  [--cwd <dir>] [--json]
 *     node devops-config.js get   <section.key> [--cwd <dir>]
 *     node devops-config.js set   <section.key> <value> --project|--global [--cwd <dir>]
 *     node devops-config.js unset <section.key> --project|--global [--cwd <dir>]
 *
 *   `set`/`unset` demand an explicit scope: which one applies is the user's
 *   call, never a default. Exit 0 on success, 1 on a usage or validation error.
 */

'use strict';

const cfg = require('../hooks/lib/devops-config');

function parseArgs(argv) {
  const out = { positional: [], cwd: process.cwd(), scope: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') out.cwd = argv[++i];
    else if (a.startsWith('--cwd=')) out.cwd = a.slice('--cwd='.length);
    else if (a === '--project') out.scope = 'project';
    else if (a === '--global') out.scope = 'global';
    else if (a === '--json') out.json = true;
    else out.positional.push(a);
  }
  return out;
}

function fail(msg) {
  process.stderr.write(`[devops-config] ${msg}\n`);
  process.exit(1);
}

function list(args) {
  const { values, sources, files } = cfg.load(args.cwd);
  if (args.json) {
    process.stdout.write(JSON.stringify({ values, sources, files }, null, 2) + '\n');
    return;
  }
  const lines = [`project: ${files.project}`, `global:  ${files.global}`, ''];
  for (const fullKey of cfg.listKeys()) {
    const { section, key, spec } = cfg.specOf(fullKey);
    lines.push(`${fullKey} = ${values[section][key]}  (${sources[fullKey]}; default ${spec.default})`);
    lines.push(`    ${spec.doc}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, key, value] = args.positional;
  try {
    switch (cmd) {
      case 'list':
        list(args);
        break;
      case 'get': {
        const hit = cfg.specOf(key);
        if (!hit) fail(`unknown setting "${key}" — valid: ${cfg.listKeys().join(', ')}`);
        const { values, sources } = cfg.load(args.cwd);
        process.stdout.write(`${key} = ${values[hit.section][hit.key]}  (${sources[key]})\n`);
        break;
      }
      case 'set': {
        if (value === undefined) fail('usage: set <section.key> <value> --project|--global');
        if (!args.scope) fail('set needs --project or --global — which one is the user\'s call');
        const r = cfg.setValue(key, value, args.scope, args.cwd);
        process.stdout.write(`${r.key} = ${r.value}  (${args.scope}: ${r.file})\n`);
        break;
      }
      case 'unset': {
        if (!args.scope) fail('unset needs --project or --global');
        const r = cfg.unsetValue(key, args.scope, args.cwd);
        process.stdout.write(r.removed
          ? `${r.key} removed from ${args.scope} (${r.file})\n`
          : `${r.key} was not set in ${args.scope} (${r.file})\n`);
        break;
      }
      default:
        fail('usage: list | get <key> | set <key> <value> --project|--global | unset <key> --project|--global');
    }
  } catch (e) {
    fail(e.message);
  }
}

if (require.main === module) main();

module.exports = { parseArgs };
