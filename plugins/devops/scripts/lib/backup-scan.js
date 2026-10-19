'use strict';
/**
 * @module scripts/lib/backup-scan
 * @version 0.1.0
 * @plugin devops
 * @description Pure content scanners for the home backup: a secret scan
 *   (keys, tokens, private keys, credential assignments) and a private-data
 *   scan (e-mail, phone, IBAN, credit card). Strict by default; the only way
 *   past a hit is the user's own `~/.claude/.backupallow`:
 *     path-glob                 skip a file for every rule
 *     path-glob:rule-id         skip one rule in that file
 *     value-sha256:<hex>        allow one matched value, by hash only
 *   `#` starts a comment. A hit is `{file, line, rule}` — the matched value
 *   never leaves this module (not in hits, not in errors). Binary files and
 *   files over 2 MB cannot be read as text and are reported as `unscannable`.
 */

const crypto = require('crypto');

const MAX_BYTES = 2 * 1024 * 1024;
const UNSCANNABLE = 'unscannable';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const PLACEHOLDER = /^[<{$%]|^(?:process\.|os\.environ|env\.)|x{3,}|changeme|example|placeholder|your[_-]|\*{3,}|^\.{3}/i;

/** Value of an assignment is a real-looking literal, not a placeholder or a number. */
function plausibleSecretValue(v) {
  return v.length >= 12 && !PLACEHOLDER.test(v) && !/^\d+$/.test(v);
}

const SECRET_RULES = [
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'api-key-sk', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { id: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g },
  {
    id: 'credential-assignment',
    re: /(["']?)[\w.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|access[_-]?key|client[_-]?secret)[\w.-]*\1\s*[:=]\s*["']?([^\s"',;]{12,})/gi,
    value: (m) => m[2],
    accept: (v) => plausibleSecretValue(v),
  },
];

const IBAN_LENGTH = {
  DE: 22, AT: 20, CH: 21, FR: 27, GB: 22, NL: 18, ES: 24, IT: 27, BE: 16, LU: 20,
  PL: 28, DK: 18, SE: 24, NO: 15, FI: 18, IE: 22, PT: 25, CZ: 24, GR: 27, HU: 28,
};

function ibanValid(raw) {
  const s = raw.replace(/\s+/g, '');
  if (IBAN_LENGTH[s.slice(0, 2)] !== s.length) return false;
  const digits = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

function luhnValid(raw) {
  const d = raw.replace(/\D/g, '');
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return d.length >= 13 && d.length <= 19 && sum % 10 === 0;
}

const CARD_PREFIX = /^(?:4\d{12}(?:\d{3}){0,2}|5[1-5]\d{14}|2(?:2[2-9]\d|[3-6]\d\d|7[01]\d|720)\d{12}|3[47]\d{13}|6(?:011|5\d\d)\d{12}|35\d{14}|3[068]\d{12})$/;

function cardPlausible(raw) {
  const separated = /[ -]/.test(raw);
  const digits = raw.replace(/\D/g, '');
  return luhnValid(digits) && (separated || CARD_PREFIX.test(digits));
}

function phonePlausible(raw) {
  const n = raw.replace(/\D/g, '').length;
  return n >= 8 && n <= 15;
}

const PRIVATE_RULES = [
  { id: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    id: 'phone',
    re: /(?<![\w.+/-])(?:\+\d{1,3}[ .-]?\(?\d{1,5}\)?(?:[ .-]?\d{2,}){2,}|0\d{2,5}[ /-]\d{3,}(?:[ -]\d{1,}){0,3})(?![\w-])/g,
    accept: phonePlausible,
  },
  { id: 'iban', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, accept: ibanValid },
  {
    id: 'credit-card',
    re: /(?<![\w-])(?:\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}|\d{4}[ -]\d{6}[ -]\d{5}|\d{13,19})(?![\w-])/g,
    accept: cardPlausible,
  },
];

const RULES = [...SECRET_RULES, ...PRIVATE_RULES];
const RULE_IDS = Object.freeze([...RULES.map((r) => r.id), UNSCANNABLE]);

function globToRegExp(glob) {
  const anchored = glob.startsWith('/');
  const g = anchored ? glob.slice(1) : glob;
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i++;
      if (g[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const prefix = anchored || g.includes('/') ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${out}(?:/.*)?$`);
}

/** Parse `.backupallow` text into `{entries:[{re, rule}], hashes:Set}`. */
function parseAllow(text) {
  const allow = { entries: [], hashes: new Set() };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const h = /^value-sha256:([0-9a-fA-F]{64})$/.exec(line);
    if (h) { allow.hashes.add(h[1].toLowerCase()); continue; }
    const r = /^(.+):([a-z0-9-]+)$/.exec(line);
    const glob = r && RULE_IDS.includes(r[2]) ? r[1] : line;
    allow.entries.push({ re: globToRegExp(glob), rule: glob === line ? null : r[2] });
  }
  return allow;
}

const EMPTY_ALLOW = parseAllow('');

function pathAllowed(file, rule, allow) {
  const p = file.replace(/\\/g, '/');
  return allow.entries.some((e) => (e.rule === null || e.rule === rule) && e.re.test(p));
}

/** Hits (`{file, line, rule}`) for the text content of one file. */
function scanText(file, text, allow = EMPTY_ALLOW) {
  const hits = [];
  const seen = new Set();
  const lines = String(text).split(/\r?\n/);
  for (const rule of RULES) {
    if (pathAllowed(file, rule.id, allow)) continue;
    lines.forEach((content, i) => {
      for (const m of content.matchAll(rule.re)) {
        const value = rule.value ? rule.value(m) : m[0];
        if (rule.accept && !rule.accept(value)) continue;
        if (allow.hashes.has(sha256(value))) continue;
        const key = `${i}:${rule.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ file, line: i + 1, rule: rule.id });
      }
    });
  }
  return hits.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** Hits for one file's raw bytes; binary or oversized content is `unscannable`. */
function scanBuffer(file, buf, allow = EMPTY_ALLOW) {
  if (buf.length > MAX_BYTES || buf.includes(0)) {
    return pathAllowed(file, UNSCANNABLE, allow) ? [] : [{ file, line: 0, rule: UNSCANNABLE }];
  }
  return scanText(file, buf.toString('utf8'), allow);
}

module.exports = {
  MAX_BYTES, UNSCANNABLE, RULE_IDS,
  parseAllow, scanText, scanBuffer, sha256, ibanValid, luhnValid,
};
