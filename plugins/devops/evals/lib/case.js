// Eval case loading for the A/B runner (ab-run.js).
// Layout: evals/<set>/<case>/case.yaml + prompt.md (frontmatter + body),
// optional scaffold.sh, graders/*.md (frontmatter), optional graders.js.
// The YAML here is a flat subset (scalars, quoted strings, flow lists and
// flow maps), so a tiny parser replaces a yaml dependency.

"use strict";

const fs = require("fs");
const path = require("path");

const EVALS_DIR = path.join(__dirname, "..");

function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === "") return "";
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) return JSON.parse(v);
  if (v.startsWith("[") && v.endsWith("]")) return splitTopLevel(v.slice(1, -1)).map(parseScalar);
  if (v.startsWith("{") && v.endsWith("}")) {
    const obj = {};
    for (const part of splitTopLevel(v.slice(1, -1))) {
      const i = part.indexOf(":");
      if (i > 0) obj[part.slice(0, i).trim()] = parseScalar(part.slice(i + 1));
    }
    return obj;
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// Flat YAML: `key: value` lines; an indented block under `key:` becomes a
// nested object (one level, enough for case.yaml's `context:`).
function parseYaml(text) {
  const out = {};
  let parent = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^(\s*)([\w.-]+):(.*)$/);
    if (!m) continue;
    const [, indent, key, rest] = m;
    if (indent.length > 0 && parent) {
      out[parent][key] = parseScalar(rest);
    } else if (rest.trim() === "") {
      out[key] = {};
      parent = key;
    } else {
      out[key] = parseScalar(rest);
      parent = null;
    }
  }
  return out;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  return { meta: parseYaml(m[1]), body: m[2].trim() };
}

function loadCase(dir) {
  const caseYaml = parseYaml(fs.readFileSync(path.join(dir, "case.yaml"), "utf8"));
  const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, "prompt.md"), "utf8"));
  const scaffoldName = (caseYaml.context && caseYaml.context.scaffold_script) || null;
  const scaffold = scaffoldName && fs.existsSync(path.join(dir, scaffoldName)) ? path.join(dir, scaffoldName) : null;
  const gradersDir = path.join(dir, "graders");
  const mdGraders = fs.existsSync(gradersDir)
    ? fs.readdirSync(gradersDir).filter((f) => f.endsWith(".md")).sort().map((f) => ({
      name: f.replace(/\.md$/, ""),
      ...parseFrontmatter(fs.readFileSync(path.join(gradersDir, f), "utf8")).meta,
    }))
    : [];
  const jsGraders = path.join(dir, "graders.js");
  return {
    id: path.relative(EVALS_DIR, dir).split(path.sep).join("/"),
    dir,
    name: caseYaml.name || path.basename(dir),
    prompt: body,
    allowedTools: Array.isArray(meta.allowed_tools) ? meta.allowed_tools : [],
    denyTools: Array.isArray(meta.deny_tools) ? meta.deny_tools : [],
    maxTurns: meta.max_turns || null,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    env: meta.env && typeof meta.env === "object" ? meta.env : {},
    // Workdir-relative dirs put in front of the run's PATH (e.g. a scaffolded
    // `bin/` holding a stub CLI); resolved per run, after the scaffold.
    pathPrepend: Array.isArray(meta.path_prepend) ? meta.path_prepend.filter((d) => typeof d === "string" && d) : [],
    scaffold,
    mdGraders,
    jsGradersFile: fs.existsSync(jsGraders) ? jsGraders : null,
  };
}

function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") { re += ".*"; i++; }
    else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function listCaseIds(root = EVALS_DIR) {
  const ids = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "results" || e.name === "lib" || e.name === "node_modules") continue;
      const sub = path.join(dir, e.name);
      if (fs.existsSync(path.join(sub, "case.yaml"))) ids.push(path.relative(root, sub).split(path.sep).join("/"));
      else walk(sub);
    }
  };
  walk(root);
  return ids.sort();
}

// `spec` is a case directory (absolute or relative to cwd) or a glob over
// case ids relative to evals/ (e.g. `delegation/inline-*`).
function resolveCases(spec, root = EVALS_DIR) {
  const asDir = path.resolve(spec);
  if (fs.existsSync(path.join(asDir, "case.yaml"))) return [asDir];
  const underRoot = path.join(root, spec);
  if (fs.existsSync(path.join(underRoot, "case.yaml"))) return [underRoot];
  const re = globToRegex(spec.replace(/\\/g, "/").replace(/\/$/, ""));
  return listCaseIds(root).filter((id) => re.test(id)).map((id) => path.join(root, id));
}

module.exports = { EVALS_DIR, parseScalar, parseYaml, parseFrontmatter, loadCase, globToRegex, listCaseIds, resolveCases };
