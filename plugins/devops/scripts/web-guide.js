#!/usr/bin/env node
/**
 * @script web-guide
 * @description CLI helper for the `/web-guide` skill. Builds the three
 *   `javascript_tool` payloads exchanged with `web-guide-overlay.js` (inject /
 *   step / wait) and manages the `store` command that upserts a secret the
 *   user typed into the overlay into a dotenv-style file, without ever
 *   printing the value. Zero dependencies, CommonJS.
 *
 *   Protocol reference: skills/web-guide/deep-knowledge/protocol.md
 *   (§ Payload helper, § Step, § Secrets).
 *
 *   Env vars:
 *   - WEB_GUIDE_OVERLAY — overrides the path to the overlay source file read
 *     by `payload inject` (default: sibling `web-guide-overlay.js`, resolved
 *     relative to this file's directory). Test-only escape hatch.
 *
 * Commands:
 *   payload inject [--raw]            → prints the overlay source, lean by
 *     default (see leanSource below); --raw prints it byte-for-byte
 *   payload step <step.json>|-        → prints window.claudeGuide.setStep(<json>)
 *   payload wait [ms]                 → prints the wait() eval snippet
 *   store --file <path> --key <KEY>   → upserts KEY=<stdin> into a dotenv file
 */

const fs = require('fs');
const path = require('path');

// All file operations here are synchronous and local (no network, no child
// processes), so no explicit timeout wrapper is needed per CONVENTIONS.md
// § General Rules (the 10s file-operation timeout targets async/child-proc I/O).
const WAIT_DEFAULT_MS = 35000;
const WAIT_MIN_MS = 1000;
const WAIT_MAX_MS = 40000;

const USAGE = `usage:
  node web-guide.js payload inject [--raw]
  node web-guide.js payload step <step.json>|-
  node web-guide.js payload wait [ms]
  node web-guide.js store --file <path> --key <KEY>   (value read from stdin)
  node web-guide.js --help

payload inject prints the overlay source lean by default (strips full-line
// comments, the leading /** JSDoc header and /* global */ directive block
comments, and per-line indentation, to cut token cost on re-injection); pass
--raw to print it byte-for-byte instead.`;

// ---------------------------------------------------------------------------
// payload inject
// ---------------------------------------------------------------------------

function overlayPath() {
  return process.env.WEB_GUIDE_OVERLAY || path.join(__dirname, 'web-guide-overlay.js');
}

/**
 * Conservative, tokenizer-free size reduction for the overlay source, applied
 * by default to `payload inject` output (opt out with `--raw`). Operates
 * strictly line-by-line — it never inspects what comes after code has
 * started on a line, so it never touches string/regex/template-literal
 * content mid-line. Rules:
 *   1. Drop lines whose first non-whitespace characters are `//`.
 *   2. Drop `/* ... *\/` block comments that start at the beginning of a
 *      line (after optional leading whitespace) — this removes the JSDoc
 *      header and the `/* global ... *\/` directive. A block comment that
 *      starts mid-line (after other code) is left untouched.
 *   3. Strip leading indentation from every remaining line; lines that
 *      become empty are dropped.
 * Convention this relies on: the overlay's CSS template literal (and any
 * other multi-line template literal) must not contain a line that starts
 * with `//` or `/*` — the overlay source honors this, so the line-based
 * rules above never need to reason about backtick nesting.
 * @param {string} src
 * @returns {string}
 */
function leanSource(src) {
  const hadTrailingNewline = src.endsWith('\n');
  const lines = src.split('\n');
  const out = [];
  let inBlockComment = false;

  for (const line of lines) {
    if (inBlockComment) {
      if (line.indexOf('*/') === -1) continue;
      inBlockComment = false;
      continue;
    }

    const trimmed = line.replace(/^[ \t]*/, '');

    if (trimmed.startsWith('//')) continue;

    if (trimmed.startsWith('/*')) {
      if (trimmed.indexOf('*/', 2) === -1) inBlockComment = true;
      continue;
    }

    if (trimmed.length === 0) continue;

    out.push(trimmed);
  }

  let result = out.join('\n');
  if (hadTrailingNewline) result += '\n';
  return result;
}

function payloadInject(args) {
  const file = overlayPath();
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    process.stderr.write(`overlay source not found: ${file}\n`);
    process.exitCode = 1;
    return;
  }
  const raw = Array.isArray(args) && args.includes('--raw');
  process.stdout.write(raw ? source : leanSource(source));
}

// ---------------------------------------------------------------------------
// payload step — validation
// ---------------------------------------------------------------------------

const INPUT_TYPES = ['text', 'secret', 'choice', 'confirm'];
const STEP_KEYS = new Set(['id', 'index', 'total', 'title', 'text', 'input', 'done']);
const INPUT_KEYS = new Set(['type', 'name', 'label', 'placeholder', 'options', 'required']);
const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate a Step object against protocol.md § Step.
 * @param {*} step
 * @returns {string[]} reasons; empty array means valid.
 */
function validateStep(step) {
  const errors = [];

  if (!isPlainObject(step)) {
    return ['step must be a JSON object'];
  }

  for (const key of Object.keys(step)) {
    if (!STEP_KEYS.has(key)) errors.push(`unknown key: ${key}`);
  }

  if (typeof step.id !== 'string' || step.id.length === 0) {
    errors.push('id must be a non-empty string');
  }

  if (!Number.isInteger(step.index) || step.index < 1) {
    errors.push('index must be an integer >= 1');
  }

  if (!Number.isInteger(step.total) || (Number.isInteger(step.index) && step.total < step.index)) {
    errors.push('total must be an integer >= index');
  }

  if (typeof step.title !== 'string' || step.title.length < 1 || step.title.length > 40) {
    errors.push('title must be a string of 1-40 chars');
  }

  if (typeof step.text !== 'string' || step.text.length === 0) {
    errors.push('text must be a non-empty string');
  } else if (step.text.includes('<') || step.text.includes('>')) {
    errors.push('text must not contain < or > (no HTML allowed)');
  }

  if (step.input !== undefined) {
    errors.push(...validateInput(step.input));
  }

  if (step.done !== undefined && typeof step.done !== 'boolean') {
    errors.push('done must be a boolean');
  }

  return errors;
}

function validateInput(input) {
  const errors = [];

  if (!isPlainObject(input)) {
    return ['input must be an object'];
  }

  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) errors.push(`unknown input key: ${key}`);
  }

  if (!INPUT_TYPES.includes(input.type)) {
    errors.push(`input.type must be one of: ${INPUT_TYPES.join(', ')}`);
  }

  if (typeof input.name !== 'string' || !NAME_RE.test(input.name)) {
    errors.push('input.name must match ^[a-z][a-z0-9_]{0,39}$');
  }

  if (typeof input.label !== 'string' || input.label.length === 0) {
    errors.push('input.label must be a non-empty string');
  }

  if (input.placeholder !== undefined && typeof input.placeholder !== 'string') {
    errors.push('input.placeholder must be a string');
  }

  const isChoice = input.type === 'choice';
  const hasOptions = input.options !== undefined;
  if (isChoice) {
    if (!Array.isArray(input.options) || input.options.length === 0
      || !input.options.every((o) => typeof o === 'string')) {
      errors.push('input.options must be a non-empty string array when type is choice');
    }
  } else if (hasOptions && !(Array.isArray(input.options) && input.options.length === 0)) {
    errors.push('input.options is only allowed (non-empty) when type is choice');
  }

  if (input.required !== undefined && typeof input.required !== 'boolean') {
    errors.push('input.required must be a boolean');
  }

  return errors;
}

function readStepArg(arg) {
  if (arg === '-' || arg === undefined) {
    return fs.readFileSync(0, 'utf8');
  }
  return fs.readFileSync(arg, 'utf8');
}

function payloadStep(arg) {
  let raw;
  try {
    raw = readStepArg(arg);
  } catch (err) {
    process.stderr.write(`cannot read step input: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  let step;
  try {
    step = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`invalid JSON: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const errors = validateStep(step);
  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`${e}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`window.claudeGuide.setStep(${JSON.stringify(step)})`);
}

// ---------------------------------------------------------------------------
// payload wait
// ---------------------------------------------------------------------------

function payloadWait(msArg) {
  const ms = msArg === undefined ? WAIT_DEFAULT_MS : Number(msArg);
  if (!Number.isInteger(ms) || ms < WAIT_MIN_MS || ms > WAIT_MAX_MS) {
    process.stderr.write(`ms must be an integer between ${WAIT_MIN_MS} and ${WAIT_MAX_MS}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`JSON.stringify(await window.claudeGuide.wait(${ms}))`);
}

// ---------------------------------------------------------------------------
// store — dotenv upsert
// ---------------------------------------------------------------------------

const KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const NEEDS_QUOTE_RE = /[\s#"'\\$=]/;

function quoteValue(value) {
  if (!NEEDS_QUOTE_RE.test(value)) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Upsert KEY=value into dotenv-style file content, preserving every other
 * line (comments, blanks) byte-for-byte, including an `export KEY=` form.
 * @param {string} content existing file content ('' for a new file)
 * @param {string} key
 * @param {string} value
 * @returns {string} new file content, always ending with a single trailing \n
 */
function upsertEnv(content, key, value) {
  const line = `${key}=${quoteValue(value)}`;
  const lineRe = new RegExp(`^(export\\s+)?${key}=`);

  const lines = content.length === 0 ? [] : content.replace(/\n$/, '').split('\n');

  let replaced = false;
  const next = lines.map((l) => {
    const m = l.match(lineRe);
    if (!m) return l;
    replaced = true;
    return `${m[1] || ''}${line}`;
  });

  if (!replaced) {
    next.push(line);
  }

  return `${next.join('\n')}\n`;
}

function parseStoreArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') opts.file = argv[++i];
    else if (argv[i] === '--key') opts.key = argv[++i];
  }
  return opts;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function store(argv) {
  const { file, key } = parseStoreArgs(argv);

  if (!file) {
    process.stderr.write('missing --file\n');
    process.exitCode = 1;
    return;
  }
  if (!key || !KEY_RE.test(key)) {
    process.stderr.write('missing/invalid --key (must match ^[A-Z][A-Z0-9_]{0,63}$)\n');
    process.exitCode = 1;
    return;
  }

  let raw = readStdin();
  if (raw.endsWith('\n')) raw = raw.slice(0, -1);
  if (raw.length === 0) {
    process.stderr.write('empty value\n');
    process.exitCode = 1;
    return;
  }

  const absFile = path.resolve(file);
  let existing = '';
  const fileExisted = fs.existsSync(absFile);
  if (fileExisted) {
    existing = fs.readFileSync(absFile, 'utf8');
  } else {
    fs.mkdirSync(path.dirname(absFile), { recursive: true });
  }

  const next = upsertEnv(existing, key, raw);

  if (fileExisted) {
    fs.writeFileSync(absFile, next);
  } else {
    fs.writeFileSync(absFile, next, { mode: 0o600 });
  }

  process.stdout.write(`stored ${key} \u2192 ${absFile}\n`);
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

function main(argv) {
  const [cmd, sub, ...rest] = argv;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (cmd === 'payload') {
    if (sub === 'inject') return payloadInject(rest);
    if (sub === 'step') return payloadStep(rest[0]);
    if (sub === 'wait') return payloadWait(rest[0]);
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  if (cmd === 'store') {
    return store([sub, ...rest].filter((v) => v !== undefined));
  }

  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 2;
}

module.exports = {
  validateStep,
  validateInput,
  upsertEnv,
  quoteValue,
  overlayPath,
  leanSource,
};

if (require.main === module) {
  main(process.argv.slice(2));
}
