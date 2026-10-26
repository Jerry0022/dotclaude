// Every {{key}} the final-report example uses must be substitutable by
// concept-build.js, whose matcher is /\{\{([a-z_.]+)\}\}/ — a key with a
// digit (final.level_5) survived the build as raw braces on the page.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dk = path.join(__dirname, 'deep-knowledge');
const read = (f) => fs.readFileSync(path.join(dk, f), 'utf8');

describe('final report locale keys', () => {
  const example = read('templates-final-report.md');
  const table = new Set([...read('templates-common.md').matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]));
  const used = [...new Set([...example.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]))];

  it('uses only keys the build substitutes', () => {
    const bad = used.filter((k) => !/^[a-z_.]+$/.test(k));
    expect(bad).toEqual([]);
  });

  it('defines every final.* key in the locale table', () => {
    const missing = used.filter((k) => k.startsWith('final.') && !table.has(k));
    expect(missing).toEqual([]);
  });

  it('defines no locale key the build cannot substitute', () => {
    const bad = [...table].filter((k) => !/^[a-z_.]+$/.test(k));
    expect(bad).toEqual([]);
  });
});
