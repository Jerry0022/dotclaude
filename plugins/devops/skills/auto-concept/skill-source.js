/**
 * @module skill-source
 * @description The auto-concept procedure, joined back into one text.
 *
 *   SKILL.md keeps the step skeleton and the decisions; the execution detail
 *   lives in deep-knowledge/step*.md. Every moved block is named by exactly one
 *   mandatory pointer line at the place it used to stand:
 *
 *     **Before executing this step, Read `deep-knowledge/<file>.md` § <section> completely** — <what it holds>.
 *
 *   Step 5 pointers say "Re-Read … completely on every round — even if read
 *   earlier in this session" instead: a long session compacts earlier reads.
 *
 *   readSkill() replaces each pointer with the body of that `## <section>`, so
 *   the result is the procedure exactly as it read before the split — what the
 *   text tests assert against. A pointer whose file or section is missing, or a
 *   section named twice, throws instead of silently dropping part of a step.
 */

const fs = require('fs');
const path = require('path');

const SKILL = path.join(__dirname, 'SKILL.md');
const DK = path.join(__dirname, 'deep-knowledge');
const POINTER = /^\*\*Before executing this step, (?:Read|Re-Read) `deep-knowledge\/([a-z0-9-]+\.md)` § (.+?) completely(?: on every round — even if read earlier in this session)?\*\* — .+\.$/;

/** The `## <name>` sections of one deep-knowledge file, body lines only. */
function sectionsOf(file) {
  const lines = fs.readFileSync(path.join(DK, file), 'utf8').split('\n');
  const sections = new Map();
  let name = null;
  let body = [];
  const close = () => {
    if (name === null) return;
    while (body.length && body[body.length - 1] === '') body.pop();
    if (sections.has(name)) throw new Error(`${file}: section "${name}" appears twice`);
    sections.set(name, body);
  };
  for (const line of lines) {
    if (line.startsWith('## ')) {
      close();
      name = line.slice(3);
      body = [];
    } else if (name !== null) {
      if (body.length === 0 && line === '') continue;
      body.push(line);
    }
  }
  close();
  return sections;
}

/** Every pointer in SKILL.md, in order: { line, file, section }. */
function skillPointers() {
  const out = [];
  fs.readFileSync(SKILL, 'utf8').split('\n').forEach((text, i) => {
    const m = POINTER.exec(text);
    if (m) out.push({ line: i + 1, file: m[1], section: m[2] });
  });
  return out;
}

/** SKILL.md with every pointer replaced by the section it names. */
function readSkill() {
  const cache = new Map();
  const out = [];
  for (const line of fs.readFileSync(SKILL, 'utf8').split('\n')) {
    const m = POINTER.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, file, name] = m;
    if (!cache.has(file)) {
      if (!fs.existsSync(path.join(DK, file))) throw new Error(`SKILL.md points at missing deep-knowledge/${file}`);
      cache.set(file, sectionsOf(file));
    }
    const body = cache.get(file).get(name);
    if (!body) throw new Error(`SKILL.md points at missing section deep-knowledge/${file} § ${name}`);
    out.push(...body);
  }
  return out.join('\n');
}

module.exports = { readSkill, skillPointers, sectionsOf, POINTER };
