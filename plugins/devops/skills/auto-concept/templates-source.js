/**
 * @module templates-source
 * @description The concept engine reference, joined back into one text.
 *
 *   deep-knowledge/templates.md is only the index: the reference itself lives
 *   in the templates-*.md parts it links, in reading order. Each part opens
 *   with a two-line header ("# Concept templates, part NN of MM: …" and a
 *   blank line) that is stripped here, so the joined text is the reference
 *   exactly as it read before the split — the code blocks Claude copies into
 *   concept pages, the function sources the tests extract, and the skeleton
 *   scripts/build-concept-fixture.js assembles.
 *
 *   A code fence too long for one part is cut between two top-level
 *   statements or rule blocks: the part closes the fence (a closing line and
 *   a blank line) and the next part, titled "... (continued N)", reopens one
 *   of the same language as its first line. The join undoes exactly that, so
 *   the text is the same as if the fence had never been cut.
 *
 *   The part order has one source: the links in templates.md. A part missing
 *   there, or a part file without its header, throws instead of silently
 *   dropping part of the engine.
 */

const fs = require('fs');
const path = require('path');

const DK = path.join(__dirname, 'deep-knowledge');
const INDEX = path.join(DK, 'templates.md');
const PART_LINK = /\]\((templates-[a-z0-9-]+\.md)\)/g;
const PART_HEADER = /^# Concept templates, part \d+ of \d+: [^\n]*\n\n/;
const CONTINUED = /^# Concept templates, part \d+ of \d+: [^\n]*\(continued \d+\)\n\n```[a-z]+\n/;
const FENCE_CLOSE = '```\n\n';

/** The part files, in the reading order templates.md lists them. */
function templateParts() {
  const index = fs.readFileSync(INDEX, 'utf8');
  const parts = [];
  for (const m of index.matchAll(PART_LINK)) {
    if (!parts.includes(m[1])) parts.push(m[1]);
  }
  if (!parts.length) throw new Error('templates.md lists no templates-*.md parts');
  return parts;
}

function readPart(file) {
  const text = fs.readFileSync(path.join(DK, file), 'utf8');
  if (!PART_HEADER.test(text)) throw new Error(`${file}: missing the "# Concept templates, part …" header`);
  return { body: text.replace(PART_HEADER, ''), continued: CONTINUED.test(text) };
}

/** Parts → one text; a "(continued N)" part rejoins the fence the previous part closed. */
function joinParts(parts) {
  let out = '';
  for (const { body, continued } of parts) {
    if (!continued) { out += body; continue; }
    if (!out.endsWith('\n' + FENCE_CLOSE)) throw new Error('a "(continued N)" part must follow a part that closes its fence');
    out = out.slice(0, -FENCE_CLOSE.length) + '\n' + body.replace(/^```[a-z]+\n/, '');
  }
  return out;
}

let joined = null;

/** The whole reference as one string (read once per process). */
function readTemplates() {
  if (joined === null) joined = joinParts(templateParts().map(readPart));
  return joined;
}

module.exports = { readTemplates, templateParts, TEMPLATES_DIR: DK };
