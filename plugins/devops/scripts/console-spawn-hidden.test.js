// Every child_process call in the plugins (spawn, spawnSync, exec, execSync,
// execFile, execFileSync, fork) must pass `windowsHide: true`. Many callers run
// as detached or MCP-server Node processes without a console; a console child
// of such a process gets a NEW, visible console window that steals focus.
//
// Accepted forms:
//   - an inline options object containing the literal `windowsHide: true`
//   - a shared options constant defined in the same file whose definition
//     contains `windowsHide: true` (SPAWN_OPTS, GIT_PROBE_OPTS, opts ...)
//   - a deliberate exception: a `// windowsHide: opt-out <reason>` comment on
//     the line of the call or the line above it
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGINS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FNS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];
const FN_SET = new Set(FNS);
const FN_ALT = FNS.join("|");

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

/** Local names under which this file imports child_process functions / the module. */
function childProcessBindings(src) {
  const names = new Set();
  const spaces = new Set(["child_process", "cp"]);
  const MOD = String.raw`['"](?:node:)?child_process['"]`;
  const lists = [
    ...src.matchAll(new RegExp(String.raw`\{([^}]*)\}\s*=\s*require\(\s*${MOD}\s*\)`, "g")),
    ...src.matchAll(new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s*${MOD}`, "g")),
  ];
  for (const m of lists) {
    for (const part of m[1].split(",")) {
      const [orig, alias] = part.split(/\s+as\s+|\s*:\s*/).map((x) => x.trim());
      if (FN_SET.has(orig)) names.add(alias || orig);
    }
  }
  for (const m of src.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*${MOD}\s*\)`, "g"))) spaces.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`import\s*\*\s*as\s+(\w+)\s+from\s*${MOD}`, "g"))) spaces.add(m[1]);
  return { names, spaces };
}

/** True when a constant named `id` is defined in `src` with windowsHide: true. */
function constantHides(src, id) {
  const m = new RegExp(String.raw`(?:const|let|var)\s+${id}\s*=\s*\{([^;]*)`).exec(src);
  return !!m && /windowsHide\s*:\s*true/.test(m[1]);
}

/** 1-based line numbers of child_process calls without windowsHide: true. */
export function unhiddenCalls(src) {
  const { names, spaces } = childProcessBindings(src);
  const lines = src.split("\n");
  const spaceAlt = [...spaces].join("|");
  const parts = [String.raw`require\(\s*['"](?:node:)?child_process['"]\s*\)\s*\.\s*(?:${FN_ALT})`];
  parts.push(String.raw`(?:${spaceAlt})\s*\.\s*(?:${FN_ALT})`);
  if (names.size) parts.push(String.raw`(?<![\w$.])(?:${[...names].join("|")})`);
  const re = new RegExp(String.raw`(?:${parts.join("|")})\s*\(`, "g");
  const hits = [];
  for (const m of src.matchAll(re)) {
    const line = src.slice(0, m.index).split("\n").length;
    const text = lines[line - 1];
    if (/^\s*(\/\/|\*|\/\*)/.test(text)) continue;
    if (/function\s+\w*$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
    const marker = /windowsHide:\s*opt-out/;
    if (marker.test(text) || (line > 1 && marker.test(lines[line - 2]))) continue;
    const call = callText(src, m.index + m[0].length - 1);
    if (/windowsHide\s*:\s*true/.test(call)) continue;
    const args = call.slice(call.indexOf("(") + 1);
    const ids = [...args.matchAll(/(?<![\w$]\.)(?<![\w$])([A-Za-z_$][\w$]*)\s*(?=[,)}]|$)/g)].map((x) => x[1]);
    if (ids.some((id) => constantHides(src, id))) continue;
    hits.push(line);
  }
  return hits;
}

describe("child_process calls stay windowless", () => {
  test("every spawn/exec/fork call passes windowsHide: true", () => {
    const hits = [];
    for (const file of walk(PLUGINS)) {
      for (const line of unhiddenCalls(fs.readFileSync(file, "utf8"))) {
        hits.push(`${path.relative(PLUGINS, file)}:${line}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("unhiddenCalls scanner", () => {
  const head = "const { execFileSync, execSync, spawn } = require('child_process');\n";
  test("flags a call whose first argument is a variable", () => {
    expect(unhiddenCalls(head + "execFileSync(exe, ['-v'], { cwd });")).toEqual([2]);
  });
  test("flags an execSync shell string", () => {
    expect(unhiddenCalls(head + "execSync('git status', { cwd });")).toEqual([2]);
  });
  test("flags a call without any options", () => {
    expect(unhiddenCalls(head + "spawn(cmd, args);")).toEqual([2]);
  });
  test("flags windowsHide: false", () => {
    expect(unhiddenCalls(head + "execSync('git status', { windowsHide: false });")).toEqual([2]);
  });
  test("flags a namespace call and fork", () => {
    const src = "import * as cp from 'node:child_process';\ncp.fork(file);\nrequire('child_process').exec('x');";
    expect(unhiddenCalls(src)).toEqual([2, 3]);
  });
  test("accepts windowsHide: true, also in a multi-line call", () => {
    const src = head + "execFileSync(\n  'git',\n  ['status'],\n  { cwd, encoding: 'utf8',\n    windowsHide: true },\n);";
    expect(unhiddenCalls(src)).toEqual([]);
  });
  test("accepts the opt-out marker on the same line or the line above", () => {
    expect(unhiddenCalls(head + "spawn(cmd); // windowsHide: opt-out visible terminal wanted")).toEqual([]);
    expect(unhiddenCalls(head + "// windowsHide: opt-out visible terminal wanted\nspawn(cmd);")).toEqual([]);
  });
  test("accepts a shared options constant that hides, rejects one that does not", () => {
    expect(unhiddenCalls(head + "const OPTS = { windowsHide: true, timeout: 5 };\nexecSync('x', OPTS);")).toEqual([]);
    expect(unhiddenCalls(head + "const OPTS = { timeout: 5 };\nexecSync('x', OPTS);")).toEqual([3]);
    expect(unhiddenCalls(head + "execSync('x', { ...OPTS, cwd });")).toEqual([2]);
  });
  test("ignores comments, regex exec and local functions of the same name", () => {
    const src = head + "// execSync('x')\n/\\d/.exec(s);\nfunction exec(a) {}\nexec('local');";
    expect(unhiddenCalls(src)).toEqual([]);
  });
});
