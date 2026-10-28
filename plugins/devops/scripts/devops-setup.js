#!/usr/bin/env node
/**
 * @script devops-setup
 * @version 0.1.0
 * @plugin devops
 * @description The writer behind the setup guide (skills/auto-setup). Run only
 *   AFTER the user answered the matching question — never silently.
 *     node devops-setup.js check
 *     node devops-setup.js language <de|en>
 *     node devops-setup.js quiet
 *     node devops-setup.js delegation <auto|ask|off> --global|--project
 *   The API-credit keys go through devops-config.js, not here.
 *   Exit 0 on success, 1 on a usage or write error (message on stderr).
 */

'use strict';

const path = require('path');
const setup = require('../hooks/lib/devops-setup');

function run(argv) {
  const [cmd, arg] = argv;
  switch (cmd) {
    case 'check': return JSON.stringify(setup.checkPrereqs());
    case 'language': { const r = setup.setLanguage(arg); return `language = ${r.value} (${r.file})`; }
    case 'quiet': {
      const r = setup.installQuiet(path.resolve(__dirname, '..'));
      const how = r.copied ? 'installed' : r.keptCustom ? 'kept your customized copy' : 'already installed';
      return `outputStyle = Quiet (${how}) — start a new session`;
    }
    case 'delegation': {
      const scope = argv.includes('--project') ? 'project' : argv.includes('--global') ? 'global' : null;
      if (!scope) throw new Error('delegation needs --global or --project');
      const r = setup.setDelegation(arg, { scope });
      return `delegation = ${r.mode} (${r.file})`;
    }
    default:
      throw new Error('usage: devops-setup.js check | language <de|en> | quiet | delegation <auto|ask|off> --global|--project');
  }
}

if (require.main === module) {
  try {
    process.stdout.write(run(process.argv.slice(2)) + '\n');
  } catch (e) {
    process.stderr.write(`devops-setup: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { run };
