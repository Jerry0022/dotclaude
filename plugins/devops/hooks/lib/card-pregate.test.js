import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { check, findings, findTranscript, REFUSED_PREFIX } = require('./card-pregate.js');
const { decideAction } = require('./card-guard.js');

/**
 * The pre-check is an earlier copy of stop.flow.guard's payload gates 3, 4,
 * 4b and 5. The parity tests below feed the SAME situation to both and demand
 * the same verdict — the pre-check may never pass what the Stop gate blocks
 * for these gates, and never refuse what it passes.
 */

const AGENT_LAUNCH_TEXT =
  'Async agent launched successfully. (This tool result is internal metadata — never quote or ' +
  'paste any part of it, including the agentId below, into a user-facing reply.)\n' +
  "agentId: a75d674f7108dd6c8 (internal ID - do not mention to user. Use SendMessage with to: " +
  "'a75d674f7108dd6c8', summary: '<5-10 word recap>' to continue this agent.)\n" +
  'The agent is working in the background.';

function toolUse(id, name, input) {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
}
function toolResult(id, text) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: text, tool_use_id: id }] } });
}
const OPEN_AGENT = [
  toolUse('toolu_1', 'Agent', { subagent_type: 'devops:research', run_in_background: true }),
  toolResult('toolu_1', AGENT_LAUNCH_TEXT),
].join('\n');

let home;
let tmp;
let sid;
let n = 0;

function setup({ transcript = '', validationPending = false } = {}) {
  sid = `vitest-pregate-${process.pid}-${Date.now()}-${n++}`;
  if (transcript) {
    const dir = path.join(home, '.claude', 'projects', 'C--repo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${sid}.jsonl`), transcript + '\n');
  }
  if (validationPending) fs.writeFileSync(path.join(os.tmpdir(), `dotclaude-devops-validation-pending-${sid}`), '1');
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pregate-home-'));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pregate-tmp-'));
});

const ok = { variant: 'ready', summary: 'Login-Formular validiert jetzt E-Mails', validation: [{ requirement: 'r', status: 'met', evidence: 'e' }] };

describe('card-pregate — findings', () => {
  test('a clean payload has no findings', () => {
    expect(findings(ok, { validationPending: true, openTasks: [] })).toEqual([]);
  });

  test('status word in the title', () => {
    const r = findings({ ...ok, summary: '3 Agenten laufen noch' }, { openTasks: [] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/Title carries a status word/);
  });

  test('validation owed and missing', () => {
    const r = findings({ variant: 'ready', summary: 'x' }, { validationPending: true, openTasks: [] });
    expect(r.join()).toMatch(/Validation required/);
    // An empty array attests nothing — same as the MCP's attestation rule.
    expect(findings({ variant: 'ready', summary: 'x', validation: [] }, { validationPending: true }).join()).toMatch(/Validation required/);
  });

  test('requirement gap: partial without waitsOn', () => {
    const r = findings({ ...ok, validation: [{ requirement: 'mobile', status: 'partial', evidence: 'e' }] }, { openTasks: [] });
    expect(r.join()).toMatch(/Requirement gaps/);
  });

  test('aborted / paused cards are exempt from the gap gate', () => {
    for (const variant of ['aborted', 'paused']) {
      expect(findings({ ...ok, variant, validation: [{ requirement: 'x', status: 'unmet' }] }, { openTasks: [] })).toEqual([]);
    }
  });

  test('waitsOn pending with no open task is a gap only when the task count is known', () => {
    const v = [{ requirement: 'r', status: 'partial', waitsOn: 'pending', evidence: 'qa runs' }];
    expect(findings({ ...ok, validation: v }, { openTasks: [] }).join()).toMatch(/Requirement gaps/);
    expect(findings({ ...ok, validation: v }, { openTasks: null })).toEqual([]);
    expect(findings({ ...ok, validation: v, pending: [{ name: 'qa' }] }, { openTasks: ['qa'] })).toEqual([]);
  });

  test('open background work without `pending`', () => {
    expect(findings(ok, { openTasks: ['devops:research'] }).join()).toMatch(/STILL RUNNING/);
    expect(findings({ ...ok, pending: [{ name: 'devops:research', kind: 'agent' }] }, { openTasks: ['devops:research'] })).toEqual([]);
  });

  test('several findings are all named at once', () => {
    const r = findings({ variant: 'ready', summary: 'wartet' }, { validationPending: true, openTasks: ['x'] });
    expect(r).toHaveLength(3);
  });
});

describe('card-pregate — parity with stop.flow.guard', () => {
  const stopVerdict = (input, { validationPending = false, openTasks = [] } = {}) => decideAction({
    workHappened: true, cardRendered: true, stopHookActive: false, substantial: true, silent: false,
    validationPending,
    validationAttested: Array.isArray(input.validation) && input.validation.length > 0,
    validationOpen: ['aborted', 'paused'].includes(input.variant) ? [] : require('./validation-gaps.js').openItems(input.validation),
    openTasksKnown: true, openTaskNames: openTasks,
    pendingAttested: Array.isArray(input.pending) && input.pending.length > 0,
    cardText: `### **✨✨✨ ${input.summary} ✨✨✨**`, cardRelayed: true,
  }).action;

  const cases = [
    [ok, {}],
    [{ ...ok, summary: 'Noch nicht fertig' }, {}],
    [{ variant: 'ready', summary: 'x' }, { validationPending: true }],
    [{ ...ok, validation: [{ requirement: 'r', status: 'unmet' }] }, {}],
    [{ ...ok, validation: [{ requirement: 'r', status: 'partial', waitsOn: 'user', evidence: 'listen' }] }, {}],
    [{ ...ok, validation: [{ requirement: 'r', status: 'partial', waitsOn: 'pending', evidence: 'qa' }] }, { openTasks: [] }],
    [ok, { openTasks: ['devops:qa'] }],
    [{ ...ok, pending: [{ name: 'devops:qa' }] }, { openTasks: ['devops:qa'] }],
    [{ ...ok, variant: 'aborted', validation: [{ requirement: 'r', status: 'unmet' }] }, {}],
  ];

  test.each(cases.map((c, i) => [i, ...c]))('case %i: same verdict', (_i, input, ctx) => {
    const pre = findings(input, { validationPending: false, openTasks: [], ...ctx }).length > 0 ? 'block' : 'pass';
    expect(pre).toBe(stopVerdict(input, ctx));
  });
});

describe('card-pregate — check (flags, transcript, one refusal per finding)', () => {
  test('finds the transcript under any project dir', () => {
    setup({ transcript: OPEN_AGENT });
    expect(findTranscript(sid, home)).toMatch(new RegExp(`${sid}\\.jsonl$`));
    expect(findTranscript('../etc', home)).toBeNull();
  });

  test('an open agent in the transcript refuses a card without pending', () => {
    setup({ transcript: OPEN_AGENT });
    const r = check({ ...ok, session_id: sid }, { home, tmp });
    expect(r.refuse).toBe(true);
    expect(r.text).toMatch(/^\[card-pregate\] Not rendered/);
    expect(r.text).toMatch(/devops:research/);
    expect(r.text).not.toMatch(/\[stop\.flow\.guard\]/);
  });

  test('the same findings a second time render anyway — never a lock-out', () => {
    setup({ transcript: OPEN_AGENT });
    expect(check({ ...ok, session_id: sid }, { home, tmp }).refuse).toBe(true);
    expect(check({ ...ok, session_id: sid }, { home, tmp }).refuse).toBe(false);
    expect(fs.existsSync(path.join(tmp, `${REFUSED_PREFIX}-${sid}`))).toBe(false);
  });

  test('a fixed payload passes and clears the refusal record', () => {
    setup({ transcript: OPEN_AGENT });
    expect(check({ ...ok, session_id: sid }, { home, tmp }).refuse).toBe(true);
    expect(check({ ...ok, session_id: sid, pending: [{ name: 'devops:research', kind: 'agent' }] }, { home, tmp }).refuse).toBe(false);
    expect(fs.existsSync(path.join(tmp, `${REFUSED_PREFIX}-${sid}`))).toBe(false);
  });

  test('the validation-pending session flag is read', () => {
    setup({ validationPending: true });
    const r = check({ variant: 'ready', summary: 'x', session_id: sid }, { home, tmp });
    expect(r.refuse).toBe(true);
    expect(r.text).toMatch(/Validation required/);
  });

  test('no transcript: only the input gates apply; pending is taken at its word', () => {
    setup();
    const v = [{ requirement: 'r', status: 'partial', waitsOn: 'pending', evidence: 'qa' }];
    expect(check({ ...ok, validation: v, session_id: sid }, { home, tmp }).refuse).toBe(false);
    expect(check({ ...ok, summary: 'läuft noch', session_id: sid }, { home, tmp }).refuse).toBe(true);
  });

  test('no session id → never refuses', () => {
    expect(check({ ...ok, summary: 'läuft' }, { home, tmp }).refuse).toBe(false);
    expect(check({ ...ok, summary: 'läuft', session_id: 'unknown' }, { home, tmp }).refuse).toBe(false);
  });
});

// #612 — the Light check owed by stop.flow.browsertest is asked BEFORE the card,
// so a deliberate skip lands on the card instead of as prose below it.
describe('card-pregate — verification owed (#612)', () => {
  const owed = { kind: 'runner', red: false };
  const skip = { skipped: true, reason: 'plugin hook, no startable surface' };
  const light = (name, content = '1') => fs.writeFileSync(path.join(os.tmpdir(), `dotclaude-devops-${name}-${sid}`), content);
  const clearLight = () => {
    for (const name of ['light-pending', 'light-verified', 'light-kind', 'light-red', 'light-bgrun']) {
      try { fs.unlinkSync(path.join(os.tmpdir(), `dotclaude-devops-${name}-${sid}`)); } catch { /* not written */ }
    }
  };

  test('owed and no skip → one finding naming both ways out', () => {
    const r = findings(ok, { verificationOwed: owed });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/passing test run/);
    expect(r[0]).toMatch(/verification: \{ skipped: true, reason/);
  });

  test('a red run is named as such', () => {
    expect(findings(ok, { verificationOwed: { kind: 'runner', red: true } })[0]).toMatch(/FAILED/);
  });

  test('a skip with a reason satisfies it; a skip without one does not', () => {
    expect(findings({ ...ok, verification: skip }, { verificationOwed: owed })).toEqual([]);
    expect(findings({ ...ok, verification: { skipped: true, reason: '  ' } }, { verificationOwed: owed })).toHaveLength(1);
    expect(findings({ ...ok, verification: { skipped: false, reason: 'x' } }, { verificationOwed: owed })).toHaveLength(1);
  });

  test('cards that finish no code work are exempt', () => {
    for (const variant of ['analysis', 'aborted', 'paused', 'test-minimal', 'fallback']) {
      expect(findings({ ...ok, variant }, { verificationOwed: owed }), variant).toEqual([]);
    }
  });

  test('check reads the Light flags: owed → refused once, then rendered', () => {
    setup();
    try {
      light('light-pending', 'a.js');
      light('light-kind', 'runner');
      const first = check({ ...ok, session_id: sid }, { home, tmp });
      expect(first.refuse).toBe(true);
      expect(first.text).toMatch(/verification: \{ skipped: true/);
      expect(check({ ...ok, session_id: sid }, { home, tmp }).refuse).toBe(false);
    } finally { clearLight(); }
  });

  test('check: a skip on the card, a verified run or a running test owe nothing', () => {
    setup();
    try {
      light('light-pending', 'a.js');
      expect(check({ ...ok, session_id: sid, verification: skip }, { home, tmp }).refuse).toBe(false);
      light('light-bgrun', `b68oycrr6 ${Date.now()}`);
      expect(check({ ...ok, session_id: sid }, { home, tmp }).refuse).toBe(false);
      fs.unlinkSync(path.join(os.tmpdir(), `dotclaude-devops-light-bgrun-${sid}`));
      light('light-verified', 'npm test');
      expect(check({ ...ok, session_id: sid }, { home, tmp }).refuse).toBe(false);
    } finally { clearLight(); }
  });
});
