import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { build, parseArgs } from "./build-concept-fixture.js";
import { findMappingIssues, findStructural, evaluate, findStaleEngine } from "../hooks/lib/concept-gate.js";

// The fixture builder's `--mapping` flag (Task 8): both modes gain an
// information mapping (templates.md § Information Mapping (engine)) that the
// deterministic gate accepts — a live one in the live round and a frozen one
// with a complete `submitted` in the round before it — so the engine can be
// looked at in a real browser. Without the flag the output is what it was.

const BASE = { mode: 'decision', mapping: true, rounds: 3, entries: 6, locale: 'en', out: '' };
const dom = html => new JSDOM(html).window.document;                                   // no scripts: markup only
const specOf = section => JSON.parse(section.querySelector('script[type="application/json"][data-mapping-spec]').textContent);
const frozenMapping = doc => doc.querySelector('section[data-iteration]:not([data-active]) section[data-mapping]');

describe("build-concept-fixture --mapping", () => {
  test("parseArgs: --mapping is a value-less boolean flag, off by default", () => {
    expect(parseArgs([]).mapping).toBe(false);
    expect(parseArgs(['--mapping']).mapping).toBe(true);
    const o = parseArgs(['--mapping', '--mode', 'design', '--rounds', '3']);
    expect(o).toMatchObject({ mapping: true, mode: 'design', rounds: 3 });
    expect(parseArgs(['--mode', 'design', '--mapping', '--out', 'x.html'])).toMatchObject({ mapping: true, mode: 'design', out: 'x.html' });
  });

  test("design mode: the live round carries a mapping view under its design, the gate passes", () => {
    const page = build({ ...BASE, mode: 'design' });
    expect(page).toContain('data-mapping=');
    expect(findStructural(page)).toEqual([]);
    expect(findMappingIssues(page)).toEqual([]);
    const doc = dom(page);
    const live = doc.querySelector('section[data-iteration][data-active]');
    expect(live.dataset.iterationTemplate).toBe('design');
    const view = live.querySelector('section[data-view][data-view-kind="mapping"]');
    expect(view).not.toBeNull();
    expect(view.dataset.viewFor).toBe('d3');                                           // the live design of a 3-round fixture
    expect(live.querySelector(`section[data-design="${view.dataset.viewFor}"]`)).not.toBeNull();
    expect(view.hasAttribute('hidden')).toBe(true);                                    // a DESIGN is the authored active item
    const map = view.querySelector('section[data-mapping]');
    expect(map.id).toBe(map.dataset.mapping);
    expect(map.querySelector('textarea[data-comment]')).toBeNull();                    // the dock's view note is the mapping note
    const spec = specOf(map);
    expect(spec.elements.length).toBeGreaterThan(0);
    expect(spec.context.values.map(v => v.id)).toEqual(['phone', 'desktop']);
    expect(spec.submitted).toBeUndefined();                                            // live: proposal, no submission
  });

  test("decision mode: the live round becomes a free round with the block + inline note, the gate passes", () => {
    const page = build({ ...BASE, mode: 'decision' });
    expect(page).toContain('data-mapping=');
    expect(findStructural(page)).toEqual([]);
    expect(findMappingIssues(page)).toEqual([]);
    const doc = dom(page);
    const live = doc.querySelector('section[data-iteration][data-active]');
    expect(live.dataset.iterationTemplate).toBe('free');
    expect(live.querySelector('.iteration-intro')).not.toBeNull();
    const map = live.querySelector(':scope > section[data-mapping]');
    expect(map).not.toBeNull();
    expect(map.id).toBe(map.dataset.mapping);
    const note = map.querySelector(`textarea[data-comment="map-${map.id}-note"]`);
    expect(note).not.toBeNull();
    expect(note.hasAttribute('data-attachable')).toBe(true);
    expect(note.hasAttribute('disabled')).toBe(false);
    // Plain context sections around it — a TOC with more than one entry.
    const plain = [...live.querySelectorAll(':scope > section[id][data-nav-label]:not([data-mapping])')];
    expect(plain.length).toBeGreaterThanOrEqual(2);
    expect(live.querySelector('.variant-evaluation')).toBeNull();                     // never inside a decision round
    const spec = specOf(map);
    expect(spec.axes.length).toBe(2);
    expect(spec.elements).toBeUndefined();                                             // matrix-only, no schematic
    expect(spec.submitted).toBeUndefined();
  });

  test.each(['design', 'decision'])("%s mode: the round before the live one carries a frozen mapping with a complete submitted", mode => {
    const page = build({ ...BASE, mode });
    const doc = dom(page);
    const map = frozenMapping(doc);
    expect(map).not.toBeNull();
    const round = map.closest('section[data-iteration]');
    expect(round.dataset.iteration).toBe('2');
    expect(round.hasAttribute('data-active')).toBe(false);
    expect(round.dataset.iterationTemplate).toBe(mode === 'design' ? 'design' : 'free');
    const spec = specOf(map);
    const ctxs = spec.context ? spec.context.values.map(v => v.id) : [null];
    const sources = [...(spec.elements || []), ...(spec.axes || [])];
    const matrixKeys = sources.flatMap(s => ctxs.map(c => s.id + (c ? '@' + c : '')));
    expect(spec.submitted).toBeTruthy();
    expect(Object.keys(spec.submitted.cells).sort()).toEqual(matrixKeys.sort());
    for (const key of matrixKeys) expect(Array.isArray(spec.submitted.cells[key])).toBe(true);
    const orderedKeys = (spec.elements || []).flatMap(e => e.parts.filter(p => p.ordered).flatMap(p => ctxs.map(c => `${e.id}.${p.id}` + (c ? '@' + c : ''))));
    for (const key of orderedKeys) expect(Array.isArray(spec.submitted.order[key])).toBe(true);
    expect(spec.submitted.adhoc).toEqual([]);
    expect(spec.submitted.slotNotes).toEqual({});
    // Mapping ids are DOM ids: unique page-wide.
    const ids = [...doc.querySelectorAll('section[data-mapping]')].map(s => s.dataset.mapping);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(2);                                                        // exactly: the frozen one + the live one
    if (mode === 'decision') {
      const note = map.querySelector(`textarea[data-comment="map-${map.id}-note"]`);
      expect(note).not.toBeNull();
      expect(note.hasAttribute('disabled')).toBe(true);
    }
  });

  test.each(['design', 'decision'])("%s mode: stripping the frozen submitted trips the gate's M9 (the frozen mapping is really frozen)", mode => {
    const page = build({ ...BASE, mode });
    const doc = dom(page);
    const map = frozenMapping(doc);
    const script = map.querySelector('script[data-mapping-spec]').textContent;
    const spec = JSON.parse(script);
    delete spec.submitted;
    const broken = page.replace(script, JSON.stringify(spec));
    expect(broken).not.toBe(page);
    const issues = findMappingIssues(broken);
    expect(issues.map(i => i.kind)).toEqual(['frozen-without-submitted']);
    expect(issues[0].why).toContain(`mapping "${map.id}"`);
  });

  test("without --mapping nothing changes: no mapping, no free round, no view", () => {
    for (const mode of ['design', 'decision']) {
      const page = build({ ...BASE, mode, mapping: false });
      // The engine JS / CSS mention `data-mapping` in every page — the MARKUP must not.
      const doc = dom(page);
      expect(doc.querySelector('section[data-mapping]')).toBeNull();
      expect(doc.querySelector('script[data-mapping-spec]')).toBeNull();
      expect(doc.querySelector('section[data-view-kind="mapping"]')).toBeNull();
      expect(doc.querySelector('section[data-iteration-template="free"]')).toBeNull();
      expect(findStructural(page)).toEqual([]);
      expect(findMappingIssues(page)).toEqual([]);
      // The flag defaults to off: an options object without the key builds the same page.
      const { mapping, ...rest } = { ...BASE, mode, mapping: false };
      void mapping;
      const stamp = /data-page-version="[^"]*"/;
      expect(build(rest).replace(stamp, '')).toBe(page.replace(stamp, ''));
    }
  });
});

describe("build-concept-fixture --designs", () => {
  test("parseArgs: --designs takes a number, default 1", () => {
    expect(parseArgs([]).designs).toBe(1);
    expect(parseArgs(['--designs', '2', '--mapping']).designs).toBe(2);
  });

  test("design mode with two designs: both designs render, only the first is active, the mapping view sits under the first", () => {
    const page = build({ ...BASE, mode: 'design', designs: 2 });
    expect(findStructural(page)).toEqual([]);
    expect(findMappingIssues(page)).toEqual([]);
    const doc = dom(page);
    const live = doc.querySelector('section[data-iteration][data-active]');
    const designs = [...live.querySelectorAll(':scope > section[data-design]')];
    expect(designs.length).toBe(2);
    expect(designs.map(d => d.dataset.design)).toEqual(['d3', 'd3b']);
    expect(designs[0].dataset.designActive).toBe('true');
    expect(designs[0].hasAttribute('hidden')).toBe(false);
    expect(designs[1].dataset.designActive).toBe('false');
    expect(designs[1].hasAttribute('hidden')).toBe(true);
    // every screen id and nav label is unique inside the round
    const ids = [...live.querySelectorAll('section[data-screen][id]')].map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(designs[1].querySelectorAll('section[data-screen]').length).toBeGreaterThan(0);
    expect(designs[1].querySelector('section[data-screen][data-screen-active="true"]')).not.toBeNull();
    const view = live.querySelector('section[data-view][data-view-kind="mapping"]');
    expect(view.dataset.viewFor).toBe('d3');
    // the frozen round keeps the same shape
    const frozen = doc.querySelector('section[data-iteration]:not([data-active]) section[data-view]').closest('section[data-iteration]');
    expect(frozen.querySelectorAll(':scope > section[data-design]').length).toBe(2);
  });

  test("--designs 1 (the default) leaves the design-mode output as it was", () => {
    expect(build({ ...BASE, mode: 'design', designs: 1 })).toBe(build({ ...BASE, mode: 'design' }));
    expect(dom(build({ ...BASE, mode: 'design' })).querySelectorAll('section[data-iteration][data-active] > section[data-design]').length).toBe(1);
  });
});

// #418: a design round's canvas is the whole viewport. The document column's
// `max-width: 1100px; padding: 2rem` letterboxed every fullscreen mock to
// 1164px on a 1680px display; the design-mode rule lifts it, and only there.
describe("build-concept-fixture — design canvas width (#418)", () => {
  const designRule = html => (html.match(/\[data-template="design"\] \.concept-layout\.design \.concept-content \{([^}]*)\}/) || [])[1] || '';
  const columnRule = html => (html.match(/\.concept-content \{\s*flex: 1;([^}]*)\}/) || [])[1] || '';  // the layout block, not the fixture's padding-only stub

  test("the design-mode rule lifts the column cap and padding", () => {
    const rule = designRule(build({ ...BASE, mode: 'design' }));
    expect(rule).toContain('max-width: none');
    expect(rule).toContain('padding: 0');
    expect(rule).toContain('inset: 0');
  });

  test("the document column keeps its 1100px cap for decision / free rounds", () => {
    const rule = columnRule(build({ ...BASE, mode: 'decision' }));
    expect(rule).toContain('max-width: 1100px');
    expect(rule).toContain('padding: 2rem');
  });
});

// #430 — the gate asserts the engine CSS/JS blocks are intact, per template.
// The fixture concatenates every css/js block of templates.md, so a built
// page of EITHER mode must carry every shared and template-scoped anchor;
// a fixture that fails here means the anchor list drifted from the engine.
describe("build-concept-fixture — engine integrity anchors (#430)", () => {
  for (const mode of ['decision', 'design']) {
    test(`${mode} mode: the built page passes the whole deterministic gate, no stale-engine anchor`, () => {
      const page = build({ ...BASE, mode, mapping: false });
      expect(page).toMatch(new RegExp(`<html[^>]*data-template="${mode}"`));
      expect(findStaleEngine(page)).toEqual([]);
      const r = evaluate('docs/concepts/fixture.html', page);
      expect(r.ok, JSON.stringify({ stale: r.stale, structural: r.structural, collisions: r.collisions })).toBe(true);
    });
  }

  test("REGRESSION: cutting the decision-panel rule out of a built design page turns the gate red", () => {
    const page = build({ ...BASE, mode: 'design', mapping: false });
    const cut = page.replace(/.concept-decision-panel {[^}]*}/, '');
    expect(cut).not.toBe(page);
    const r = evaluate('docs/concepts/fixture.html', cut);
    expect(r.ok).toBe(false);
    expect(r.stale.map(e => e.token)).toContain('.concept-decision-panel {');
  });
});
