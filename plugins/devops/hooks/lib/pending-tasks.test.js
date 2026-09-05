/**
 * Transcript shapes below are copied from a real session transcript — the exact
 * strings the harness writes for a background Agent launch, a backgrounded Bash
 * call, and the task-notification that reports either one stopping.
 */
import { describe, test, expect } from 'vitest';
import { scanOpenTasks, openTaskNames, labelFor } from './pending-tasks.js';

const AGENT_LAUNCH_TEXT =
  'Async agent launched successfully. (This tool result is internal metadata — never quote or ' +
  'paste any part of it, including the agentId below, into a user-facing reply.)\n' +
  "agentId: a75d674f7108dd6c8 (internal ID - do not mention to user. Use SendMessage with to: " +
  "'a75d674f7108dd6c8', summary: '<5-10 word recap>' to continue this agent.)\n" +
  'The agent is working in the background.';

const BASH_BG_TEXT =
  'Command running in background with ID: b68oycrr6. Output is being written to: ' +
  'C:\\Temp\\tasks\\b68oycrr6.output. You will be notified when it completes.';

/** One assistant line carrying a tool_use block. */
function toolUse(id, name, input) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  });
}

/** One user line carrying the tool_result for that tool_use. */
function toolResult(toolUseId, text) {
  return JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }] }],
    },
  });
}

/** The queue-operation entry the harness writes when a task stops. */
function notification(taskId, status = 'completed') {
  return JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    content:
      `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n` +
      '<summary>Agent "x" finished</summary>\n</task-notification>',
  });
}

const AGENT_START = [
  toolUse('toolu_1', 'Agent', { subagent_type: 'devops:frontend', run_in_background: true }),
  toolResult('toolu_1', AGENT_LAUNCH_TEXT),
];

describe('scanOpenTasks', () => {
  test('reports a launched background agent as open', () => {
    const open = scanOpenTasks(AGENT_START.join('\n'));
    expect(open).toEqual([{ id: 'a75d674f7108dd6c8', kind: 'agent', name: 'devops:frontend' }]);
  });

  test('a task-notification closes it again', () => {
    const open = scanOpenTasks([...AGENT_START, notification('a75d674f7108dd6c8')].join('\n'));
    expect(open).toEqual([]);
  });

  test('reports a backgrounded Bash task, labelled by its description', () => {
    const lines = [
      toolUse('toolu_2', 'Bash', { command: 'npm test', description: 'Run the suite', run_in_background: true }),
      toolResult('toolu_2', BASH_BG_TEXT),
    ];
    expect(scanOpenTasks(lines.join('\n')))
      .toEqual([{ id: 'b68oycrr6', kind: 'task', name: 'Run the suite' }]);
  });

  test('tracks agents and tasks side by side', () => {
    const lines = [
      ...AGENT_START,
      toolUse('toolu_2', 'Bash', { command: 'npm test', run_in_background: true }),
      toolResult('toolu_2', BASH_BG_TEXT),
    ];
    expect(scanOpenTasks(lines.join('\n')).map(t => t.kind)).toEqual(['agent', 'task']);
  });

  test('closes only the task the notification names', () => {
    const lines = [
      ...AGENT_START,
      toolUse('toolu_2', 'Bash', { command: 'npm test', run_in_background: true }),
      toolResult('toolu_2', BASH_BG_TEXT),
      notification('b68oycrr6'),
    ];
    expect(scanOpenTasks(lines.join('\n')).map(t => t.name)).toEqual(['devops:frontend']);
  });

  test('a SendMessage resume re-opens a completed agent', () => {
    const lines = [
      ...AGENT_START,
      notification('a75d674f7108dd6c8'),
      toolUse('toolu_3', 'SendMessage', { to: 'a75d674f7108dd6c8', message: 'keep going' }),
    ];
    // Re-opened, and still labelled by its type — never by the internal id.
    expect(scanOpenTasks(lines.join('\n')))
      .toEqual([{ id: 'a75d674f7108dd6c8', kind: 'agent', name: 'devops:frontend' }]);
  });

  test('a resumed agent closes again on its next notification', () => {
    const lines = [
      ...AGENT_START,
      notification('a75d674f7108dd6c8'),
      toolUse('toolu_3', 'SendMessage', { to: 'a75d674f7108dd6c8' }),
      notification('a75d674f7108dd6c8'),
    ];
    expect(scanOpenTasks(lines.join('\n'))).toEqual([]);
  });

  test('a foreground agent is never reported (no launch marker)', () => {
    const lines = [
      toolUse('toolu_1', 'Agent', { subagent_type: 'devops:qa', run_in_background: false }),
      toolResult('toolu_1', 'Here is what I found: the suite passes.'),
    ];
    expect(scanOpenTasks(lines.join('\n'))).toEqual([]);
  });

  test('survives malformed lines, blank lines and empty input', () => {
    expect(scanOpenTasks('')).toEqual([]);
    expect(scanOpenTasks(undefined)).toEqual([]);
    const lines = ['{ not json', '', ...AGENT_START, 'also not json'];
    expect(scanOpenTasks(lines.join('\n')).length).toBe(1);
  });

  test('a truncated leading line does not lose a later launch', () => {
    const lines = ['ent","message":{"content":[]}}', ...AGENT_START];
    expect(scanOpenTasks(lines.join('\n')).length).toBe(1);
  });

  test('a notification without a matching launch is harmless', () => {
    expect(scanOpenTasks(notification('unknown-id'))).toEqual([]);
  });

  test('falls back to a generic label when the launching tool_use is out of slice', () => {
    // Tail slice starts after the tool_use — the result is still counted.
    const open = scanOpenTasks(toolResult('toolu_gone', AGENT_LAUNCH_TEXT));
    expect(open).toEqual([{ id: 'a75d674f7108dd6c8', kind: 'agent', name: 'agent' }]);
  });
});

describe('openTaskNames', () => {
  test('returns names only — never the internal id', () => {
    const names = openTaskNames(scanOpenTasks(AGENT_START.join('\n')));
    expect(names).toEqual(['devops:frontend']);
    expect(names.join(' ')).not.toContain('a75d674f7108dd6c8');
  });

  test('deduplicates repeated names and preserves order', () => {
    expect(openTaskNames([
      { name: 'devops:qa' }, { name: 'devops:frontend' }, { name: 'devops:qa' },
    ])).toEqual(['devops:qa', 'devops:frontend']);
  });

  test('skips unnamed entries and tolerates no input', () => {
    expect(openTaskNames([{ name: '' }, null])).toEqual([]);
    expect(openTaskNames(undefined)).toEqual([]);
  });
});

describe('labelFor', () => {
  test('prefers subagent_type, then description', () => {
    expect(labelFor({ subagent_type: 'devops:qa', description: 'x' }, 'agent')).toBe('devops:qa');
    expect(labelFor({ description: 'Review the diff' }, 'agent')).toBe('Review the diff');
    expect(labelFor({}, 'agent')).toBe('agent');
  });

  test('truncates a long command used as a task label', () => {
    const label = labelFor({ command: 'x'.repeat(80) }, 'task');
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBe(41);
  });

  test('collapses whitespace in a multi-line command', () => {
    expect(labelFor({ command: 'npm  run\n  build' }, 'task')).toBe('npm run build');
  });
});
