import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Scripts the hooks spawn detached and console-less (`detached: true`,
// stdio 'ignore'). A child_process call there without windowsHide opens a
// visible console window per child on Windows (#777).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = [
  "scripts/orphan-scan.js",
  "scripts/autonomous-watchdog.js",
  "scripts/mcp-reap.js",
  "scripts/batch-watchdog.js",
  "scripts/post-merge-watcher.js",
  "scripts/git-sync.js",
  "scripts/refresh-usage-headless.js",
  "scripts/governor/watcher.js",
  "hooks/lib/mcp-reaper.js",
  "hooks/lib/cache-rebuild-runner.js",
];

const CALL = /(?<![\w$.])(?:(?:child_process|cp)\.)?(execFileSync|execFile|execSync|spawnSync|spawn|exec|fork)\s*\(/g;
const HIDDEN = /windowsHide\s*:\s*(?:true|!\w+)|\bSPAWN_OPTS\b/;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, "$1");
}

/** Text of the balanced (...) starting at the "(" at `open`. */
function args(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

function offenders(source, label) {
  const src = stripComments(source);
  const out = [];
  for (const m of src.matchAll(CALL)) {
    if (/function\s+$/.test(src.slice(0, m.index))) continue;
    if (!HIDDEN.test(args(src, m.index + m[0].length - 1))) {
      out.push(`${label}:${src.slice(0, m.index).split("\n").length} ${m[1]}`);
    }
  }
  return out;
}

describe("detached, console-less scripts hide their child consoles (#777)", () => {
  test.each(SCRIPTS)("%s passes windowsHide: true to every child_process call", (file) => {
    const p = path.join(root, file);
    expect(fs.existsSync(p), `${file} exists`).toBe(true);
    expect(offenders(fs.readFileSync(p, "utf8"), file)).toEqual([]);
  });

  test("the scanner flags a call without windowsHide and accepts one with it", () => {
    expect(offenders("execFileSync('x', [], { cwd });", "t")).toHaveLength(1);
    expect(offenders("cp.spawn('x', [], { windowsHide: true });", "t")).toEqual([]);
    expect(offenders("const r = /a/.exec(s);", "t")).toEqual([]);
  });
});
