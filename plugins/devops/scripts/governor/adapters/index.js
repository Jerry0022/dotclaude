/**
 * @module governor/adapters
 * @description Picks the OS adapter. Only Windows has one in v1; every other
 *   platform gets null and the governor is a no-op there (reported shortfall).
 */
'use strict';

function createAdapter(platform, cfg) {
  if (platform === 'win32') return require('./win32').createWin32Adapter(cfg);
  return null;
}

function hasAdapter(platform = process.platform) { return platform === 'win32'; }

module.exports = { createAdapter, hasAdapter };
