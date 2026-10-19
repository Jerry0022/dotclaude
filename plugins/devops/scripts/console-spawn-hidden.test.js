// Every plugin spawn of a console program (powershell, pwsh, cmd, schtasks)
// must pass windowsHide: true. Many callers run as detached, console-less
// Node processes (session-start sweeps, watchers); a console child of such a
// process gets a NEW, visible console window — the cmd/PowerShell windows
// that popped up after a PC start.
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGINS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONSOLE_EXE = /^\s*["'](?:powershell|pwsh|cmd|schtasks)(?:\.exe)?["']/i;
const CALL = /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "__fixtures__") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(c|m)?js$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

/** The full text of the call starting at `start` (balanced parentheses). */
function callText(src, start) {
  let i = src.indexOf("(", start) + 1;
  let depth = 1;
  while (i < src.length && depth) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") depth--;
    i++;
  }
  return src.slice(start, i);
}

function unhiddenConsoleSpawns() {
  const hits = [];
  for (const file of walk(PLUGINS)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(CALL)) {
      const call = callText(src, m.index);
      const firstArg = call.slice(call.indexOf("(") + 1);
      if (!CONSOLE_EXE.test(firstArg)) continue;
      // Options passed as a shared constant (e.g. SPAWN_OPTS) are checked at
      // their definition; only inline option objects are judged here.
      if (/windowsHide/.test(call) || /\bSPAWN_OPTS\b/.test(call)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      hits.push(`${path.relative(PLUGINS, file)}:${line}`);
    }
  }
  return hits;
}

describe("console spawns stay windowless", () => {
  test("every powershell/pwsh/cmd/schtasks spawn passes windowsHide", () => {
    expect(unhiddenConsoleSpawns()).toEqual([]);
  });
});
