/**
 * @module governor/libraries
 * @description Where games live, so a game gets priority from process start:
 *   Steam (libraryfolders.vdf), Epic (manifests), GOG / Ubisoft / EA
 *   (registry install dirs), Xbox (X:\XboxGames), the Windows Game Bar's
 *   GameConfigStore (exe paths), and the Linux/macOS Steam/Epic/Heroic dirs.
 *   Parsers are pure; reading is best-effort with short timeouts — a missing
 *   launcher is simply absent.
 *
 * @returns {{roots:string[], dirs:string[], exes:string[]}} roots = folders
 *   holding one game per subfolder; dirs = single game folders; exes = game exes
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function parseVdfPaths(text) {
  const out = [];
  const re = /"path"\s+"((?:[^"\\]|\\.)*)"/gi;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1].replace(/\\\\/g, '\\'));
  return out;
}

/** Values of `reg query … /s /v <name>` output: lines `    <name>    REG_SZ    <value>`. */
function parseRegValues(text, name) {
  const out = [];
  const re = new RegExp(`^\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'gim');
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1]);
  return out;
}

function regQuery(key, name, run) {
  try {
    const text = run('reg', ['query', key, '/s', '/v', name], { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return parseRegValues(text, name);
  } catch { return []; }
}

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }

function epicManifests(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.item')) continue;
    try { const j = JSON.parse(readText(path.join(dir, n))); if (j.InstallLocation) out.push(j.InstallLocation); } catch {}
  }
  return out;
}

function steamRoots(steamDir) {
  const roots = [path.join(steamDir, 'steamapps', 'common')];
  for (const p of parseVdfPaths(readText(path.join(steamDir, 'steamapps', 'libraryfolders.vdf')))) roots.push(path.join(p, 'steamapps', 'common'));
  return roots;
}

function windowsLibraries(run = execFileSync) {
  const roots = [];
  const dirs = [];
  const exes = [];
  const steamDirs = new Set([...regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath', run).map((p) => p.replace(/\//g, '\\')), 'C:\\Program Files (x86)\\Steam']);
  for (const d of steamDirs) roots.push(...steamRoots(d));
  dirs.push(...epicManifests('C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'));
  dirs.push(...regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', 'path', run));
  dirs.push(...regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs', 'InstallDir', run));
  dirs.push(...regQuery('HKLM\\SOFTWARE\\WOW6432Node\\EA Games', 'Install Dir', run));
  roots.push('C:\\Program Files\\EA Games', 'C:\\Program Files (x86)\\Origin Games', 'C:\\Program Files (x86)\\GOG Galaxy\\Games', 'C:\\Program Files\\Epic Games');
  for (let c = 67; c <= 90; c++) roots.push(`${String.fromCharCode(c)}:\\XboxGames`);
  exes.push(...regQuery('HKCU\\System\\GameConfigStore\\Children', 'MatchedExeFullPath', run));
  return { roots, dirs, exes };
}

function unixLibraries(home = os.homedir(), platform = process.platform) {
  const roots = [];
  const dirs = [];
  const steamDirs = platform === 'darwin'
    ? [path.join(home, 'Library', 'Application Support', 'Steam')]
    : [path.join(home, '.local', 'share', 'Steam'), path.join(home, '.steam', 'steam'), path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')];
  for (const d of steamDirs) roots.push(...steamRoots(d));
  roots.push(path.join(home, 'Games', 'Heroic'), path.join(home, 'Games'));
  if (platform === 'darwin') dirs.push(...epicManifests(path.join(home, 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')));
  return { roots, dirs, exes: [] };
}

/** Keep only entries that exist (cheap stat), de-duplicated case-insensitively on Windows. */
function existing(list, platform = process.platform) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p) continue;
    const k = platform === 'win32' ? p.toLowerCase() : p;
    if (seen.has(k)) continue;
    seen.add(k);
    try { fs.statSync(p); out.push(p); } catch {}
  }
  return out;
}

function discover(platform = process.platform) {
  try {
    const l = platform === 'win32' ? windowsLibraries() : unixLibraries(os.homedir(), platform);
    return { roots: existing(l.roots, platform), dirs: existing(l.dirs, platform), exes: l.exes.filter(Boolean) };
  } catch { return { roots: [], dirs: [], exes: [] }; }
}

module.exports = { parseVdfPaths, parseRegValues, windowsLibraries, unixLibraries, discover };
