/**
 * @module skill-meta
 * @version 0.1.0
 * @description Minimal frontmatter reader for `skills/*\/SKILL.md`.
 *
 *   The repo has no YAML dependency in `hooks/` (see CONVENTIONS.md → Script
 *   Conventions), so this is a small hand-rolled parser for exactly the
 *   frontmatter shapes the devops skills use:
 *     - plain scalars:        `name: ship`
 *     - folded block scalars: `description: >-` followed by indented lines
 *     - flow lists:           `invokes: [auto-polish, do-ship]` / `invokes: []`
 *     - nested flow-list maps: `triggers:` / `  en: ["a", "b"]` / `triggers: {}`
 *     - booleans:              `user-invocable: false`
 *
 *   Deliberately narrow: it does not attempt general YAML (no anchors, no
 *   multi-line flow collections, no comments-in-values). Every devops
 *   SKILL.md's frontmatter fits the shapes above; `frontmatter-yaml.test.js`
 *   is the guard against a shape this parser cannot read.
 *
 * Usage:
 *   const { readSkillMeta, loadAllSkills } = require('../lib/skill-meta');
 *   const meta = readSkillMeta(path.join(skillsRoot, 'ship'));
 *   const all = loadAllSkills(skillsRoot); // { ship: {...}, concept: {...}, ... }
 */

const fs = require('fs');
const path = require('path');

/** Split a YAML flow-list body ("a, b, \"c, d\"") on top-level commas. */
function splitFlowItems(body) {
  const items = [];
  let current = '';
  let inQuote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuote) {
      if (ch === '\\' && i + 1 < body.length) {
        current += body[i + 1];
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === ',') {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') items.push(current.trim());
  return items;
}

/** Parse a flow-list scalar value, e.g. "[auto-polish, do-ship]" or "[]". */
function parseFlowList(value) {
  const trimmed = value.trim();
  const m = trimmed.match(/^\[(.*)\]$/s);
  if (!m) return null;
  const body = m[1].trim();
  if (body === '') return [];
  return splitFlowItems(body).map(unquote);
}

function unquote(s) {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseScalar(value) {
  const t = value.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  return unquote(t);
}

/** Extract the frontmatter block (between the first `---` and the next). */
function extractFrontmatter(text) {
  if (typeof text !== 'string') return null;
  // A UTF-8 BOM (some Windows editors add one) must not hide the frontmatter.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n') && normalized.trim() !== '---') return null;
  const firstNl = normalized.indexOf('\n');
  if (firstNl === -1) return null;
  const close = normalized.indexOf('\n---', firstNl);
  if (close === -1) return null;
  return normalized.slice(firstNl + 1, close);
}

/**
 * Parse the frontmatter text into a plain object. Recognizes the shapes
 * documented at module top; unknown keys are returned as best-effort scalars.
 */
function parseFrontmatter(fmText) {
  const lines = fmText.split('\n');
  const result = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rawValue = m[2].trim();
    const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

    if (rawValue === '' ) {
      // Nested block: folded scalar continuation (description) or a nested
      // map (triggers). Peek at the next non-empty line's indent.
      let j = i + 1;
      const nested = [];
      let nestedIndent = null;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === '') { j++; continue; }
        const indent = l.length - l.trimStart().length;
        if (indent === 0) break; // back to top-level
        if (nestedIndent === null) nestedIndent = indent;
        if (indent < nestedIndent) break;
        nested.push(l.slice(nestedIndent));
        j++;
      }
      if (key === 'triggers') {
        const triggers = {};
        for (const nl of nested) {
          const nm = nl.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
          if (!nm) continue;
          const lang = nm[1];
          const list = parseFlowList(nm[2]);
          triggers[lang] = list === null ? [] : list;
        }
        result[camelKey] = triggers;
      } else {
        // Treat as a folded block scalar (e.g. description): join lines with
        // a single space, matching YAML `>-` folding semantics.
        result[camelKey] = nested.map((l) => l.trim()).join(' ').trim();
      }
      i = j;
      continue;
    }

    if (rawValue === '{}' ) {
      result[camelKey] = {};
      i++;
      continue;
    }
    if (rawValue === '>-' || rawValue === '|' || rawValue === '|-' || /^[|>][+-]?\d*$/.test(rawValue)) {
      // Folded/literal block scalar with an explicit indicator on the key line.
      let j = i + 1;
      const nested = [];
      let nestedIndent = null;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === '') { j++; continue; }
        const indent = l.length - l.trimStart().length;
        if (nestedIndent === null) {
          if (indent === 0) break;
          nestedIndent = indent;
        }
        if (indent < nestedIndent) break;
        nested.push(l.slice(nestedIndent));
        j++;
      }
      result[camelKey] = nested.map((l) => l.trim()).join(' ').trim();
      i = j;
      continue;
    }

    const flowList = parseFlowList(rawValue);
    if (flowList !== null) {
      result[camelKey] = flowList;
      i++;
      continue;
    }

    result[camelKey] = parseScalar(rawValue);
    i++;
  }

  return result;
}

/**
 * Read and parse a single skill's frontmatter.
 * @param {string} skillDir - absolute path to `skills/<name>`
 * @returns {object|null} `{ name, description, layer, invokes, triggers,
 *   userInvocable, disableModelInvocation, ... }` or null if SKILL.md is
 *   missing/unparsable.
 */
function readSkillMeta(skillDir) {
  const file = path.join(skillDir, 'SKILL.md');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const fm = extractFrontmatter(text);
  if (fm === null) return null;
  const parsed = parseFrontmatter(fm);

  return {
    name: parsed.name != null ? parsed.name : path.basename(skillDir),
    description: parsed.description != null ? parsed.description : '',
    layer: parsed.layer != null ? parsed.layer : null,
    invokes: Array.isArray(parsed.invokes) ? parsed.invokes : [],
    triggers: parsed.triggers && typeof parsed.triggers === 'object' ? parsed.triggers : {},
    userInvocable: parsed.userInvocable != null ? parsed.userInvocable : true,
    disableModelInvocation:
      parsed.disableModelInvocation != null ? parsed.disableModelInvocation : false,
  };
}

/**
 * Load every skill under `skillsRoot` (a `skills/` directory).
 * @param {string} skillsRoot - absolute path to the plugin's `skills/` dir
 * @returns {Record<string, object>} keyed by skill directory name
 */
function loadAllSkills(skillsRoot) {
  const out = {};
  let entries;
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readSkillMeta(path.join(skillsRoot, entry.name));
    if (meta) out[entry.name] = meta;
  }
  return out;
}

module.exports = {
  readSkillMeta,
  loadAllSkills,
  parseFrontmatter,
  extractFrontmatter,
};
