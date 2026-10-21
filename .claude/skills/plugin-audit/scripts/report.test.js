import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderFragment, fallbackSuggestions, curveSvg } = require('./report.js');

const check = (id, status, findings = []) => ({ id, title: id, status, findings, durationMs: 5 });
const results = {
  version: '0.290.0', ranAt: '2026-10-20T10:00:00Z', trigger: 'manual',
  footprint: { totalTokens: 12000, components: [{ name: 'skills', count: 2, tokens: 900 }], notes: ['n'] },
  mining: { window: { since: '2026-10-01T00:00:00Z', until: '2026-10-20T00:00:00Z' }, totals: { sessions: 3, tokens: 1000000, pluginShare: 0.01 } },
  benefit: {
    delegation: { spawns: 2, savedOpusEquivalentTokens: 500 }, tokenGuard: { blocks: 0, note: 'not measurable' }, localLlm: { note: 'not measurable' },
    rework: { repeatedBashFailures: 1, autoFixLoads: 0, frustrationPrompts: 2, perSession: 1 },
    gateCatches: { note: 'frequency, not savings', byRule: { 'card-last': 4 } },
  },
  integrity: [check('references', 'yellow', [{ msg: 'dead link', file: 'a.md', line: 3 }]), check('deps', 'green')],
  hygiene: [check('ci', 'red', [{ msg: 'red run' }])],
  net: { costTokens: 2000, benefitTokens: 500, estimate: null, comparable: false, uncertainty: 'Schätzung: Unsicherheit' },
};

describe('plugin-audit report fragment', () => {
  const sugg = { suggestions: [{ id: 'dead-links', title: 'Dead <links>', priority: 'high', group: 'Integrität', evidence: ['a.md:3'], change: 'fix them' }] };
  const html = renderFragment(results, sugg, []);

  it('is one free-mode round with the five navigable sections', () => {
    expect(html).toMatch(/^<section data-iteration="1" data-iteration-template="free"/);
    for (const id of ['overview', 'benefit', 'catalog', 'hygiene', 'suggestions']) {
      expect(html).toMatch(new RegExp(`<section id="${id}" data-nav-label="[^"]+"`));
    }
  });

  it('emits the bi-state markup per suggestion, include checked, with the comment row', () => {
    expect(html).toContain('<div class="variant-evaluation" data-decision="sug-dead-links"');
    expect(html).toContain('name="eval-sug-dead-links" value="discard"');
    expect(html).toMatch(/name="eval-sug-dead-links" value="include" checked/);
    expect(html).toContain('class="field-row decision-comment-row"');
    expect(html).toContain('data-comment="sug-dead-links-note" data-attachable');
    expect(html).toContain('Dead &lt;links&gt;'); // escaped
  });

  it('namespaces every round CSS class selector with .d1-', () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
    const selectors = [...css.matchAll(/(^|\})\s*([^{}]+)\{/g)].flatMap((m) => m[2].split(','));
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) expect(sel.trim()).toMatch(/^\.d1-/);
  });

  it('shows gate catches separately as frequency and the uncertainty note', () => {
    expect(html).toContain('Gate-Treffer (nur Häufigkeit, keine Token-Ersparnis)');
    expect(html).toContain('Schätzung: Unsicherheit');
  });

  it('falls back to rule-based suggestions for red/yellow checks', () => {
    const fb = fallbackSuggestions(results);
    expect(fb.map((s) => s.id)).toEqual(['fix-ci', 'fix-references']);
    expect(fb[0].priority).toBe('high');
    expect(renderFragment(results, null, [])).toContain('data-decision="sug-fix-ci"');
  });

  it('draws the curve over past audit runs only, needing two points', () => {
    expect(curveSvg([{ version: '0.280.0', footprintTokens: 10000 }])).not.toContain('<svg');
    const svg = curveSvg([{ version: '0.280.0', footprintTokens: 10000 }, { version: '0.290.0', footprintTokens: 12000 }]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('0.290.0');
  });
});
