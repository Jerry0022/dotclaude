/**
 * Transcript shapes below are copied from a real session transcript — the exact
 * strings the harness writes for a background Agent launch, a backgrounded Bash
 * call, and the task-notification that reports either one stopping.
 */
import { describe, test, expect } from 'vitest';
import { scanOpenTasks, openTaskNames, labelFor, isConceptInfra } from './pending-tasks.js';

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

/**
 * Workflow launches, and the two directions in which QUOTED text must not be
 * mistaken for an event. Strings below are copied from real transcripts.
 */
const WORKFLOW_LAUNCH_TEXT =
  'Workflow launched in background. Task ID: w5rketv6j\n' +
  'Summary: Research how a quest binds to the island it was started on\n' +
  'Transcript dir: C:\\Users\\x\\.claude\\projects\\p\\s\\subagents\\workflows\\wf_c6511141-adc\n' +
  'Script file: C:\\Users\\x\\.claude\\projects\\p\\s\\workflows\\scripts\\quest-island-scope-wf_c6511141-adc.js';

const WF_SCRIPT =
  "export const meta = {\n  name: 'quest-island-scope',\n" +
  "  description: 'Research the quest/island binding',\n};\n" +
  "const DIMENSIONS = [{ name: 'not-the-workflow-name' }];\n";

describe('scanOpenTasks — workflows', () => {
  test('reports a launched workflow as open, named from its meta literal', () => {
    const open = scanOpenTasks([
      toolUse('toolu_w', 'Workflow', { script: WF_SCRIPT }),
      toolResult('toolu_w', WORKFLOW_LAUNCH_TEXT),
    ].join('\n'));
    expect(open).toEqual([{ id: 'w5rketv6j', kind: 'workflow', name: 'quest-island-scope' }]);
  });

  test('prefers meta.name over an agent label defined earlier in the script', () => {
    const script = "const AGENTS = [{ name: 'reviewer' }];\n" + WF_SCRIPT;
    const open = scanOpenTasks([
      toolUse('toolu_w', 'Workflow', { script }),
      toolResult('toolu_w', WORKFLOW_LAUNCH_TEXT),
    ].join('\n'));
    expect(open[0].name).toBe('quest-island-scope');
  });

  test('accepts double and backtick quotes in the meta literal', () => {
    for (const q of ['"', '`']) {
      const script = 'export const meta = {\n  name: ' + q + 'harden-pass' + q + ',\n};';
      const open = scanOpenTasks([
        toolUse('toolu_w', 'Workflow', { script }),
        toolResult('toolu_w', WORKFLOW_LAUNCH_TEXT),
      ].join('\n'));
      expect(open[0].name).toBe('harden-pass');
    }
  });

  test('falls back to the script path, stripped of extension and run id', () => {
    const open = scanOpenTasks([
      toolUse('toolu_w', 'Workflow', {
        scriptPath: 'C:\\Users\\x\\.claude\\projects\\p\\workflows\\scripts\\quest-island-scope-wf_c6511141-adc.js',
      }),
      toolResult('toolu_w', WORKFLOW_LAUNCH_TEXT),
    ].join('\n'));
    expect(open[0].name).toBe('quest-island-scope');
  });

  test('falls back to a saved workflow name, then to the Summary line', () => {
    const saved = scanOpenTasks([
      toolUse('toolu_w', 'Workflow', { name: 'code-review' }),
      toolResult('toolu_w', WORKFLOW_LAUNCH_TEXT),
    ].join('\n'));
    expect(saved[0].name).toBe('code-review');

    const summary = scanOpenTasks([
      toolUse('toolu_w', 'Workflow', {}),
      toolResult('toolu_w', WORKFLOW_LAUNCH_TEXT),
    ].join('\n'));
    expect(summary[0].name)
      .toBe('Research how a quest binds to the island it was');
  });

  test('a notification with the launch task id closes the workflow', () => {
    for (const status of ['completed', 'failed', 'stopped']) {
      const open = scanOpenTasks([
        toolUse('toolu_w', 'Workflow', { script: WF_SCRIPT }),
        toolResult('toolu_w', WORKFLOW_LAUNCH_TEXT),
        notification('w5rketv6j', status),
      ].join('\n'));
      expect(open).toEqual([]);
    }
  });

  test('workflows, agents and tasks are reported side by side', () => {
    const open = scanOpenTasks([
      ...AGENT_START,
      toolUse('toolu_w', 'Workflow', { script: WF_SCRIPT }),
      toolResult('toolu_w', WORKFLOW_LAUNCH_TEXT),
    ].join('\n'));
    expect(open.map(o => o.kind)).toEqual(['agent', 'workflow']);
  });
});

describe('scanOpenTasks — quoted text is not an event', () => {
  test('a Grep result quoting the workflow marker opens nothing', () => {
    const open = scanOpenTasks([
      toolUse('toolu_g', 'Grep', { pattern: 'Workflow launched' }),
      toolResult('toolu_g', WORKFLOW_LAUNCH_TEXT),
    ].join('\n'));
    expect(open).toEqual([]);
  });

  test('a Read result quoting the agent marker opens nothing', () => {
    const open = scanOpenTasks([
      toolUse('toolu_r', 'Read', { file_path: 'pending-tasks.test.js' }),
      toolResult('toolu_r', AGENT_LAUNCH_TEXT),
    ].join('\n'));
    expect(open).toEqual([]);
  });

  test('a tool_result quoting a notification does NOT close running work', () => {
    const quoted = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_g',
          content: '<task-notification>\n<task-id>a75d674f7108dd6c8</task-id>\n</task-notification>',
        }],
      },
    });
    const open = scanOpenTasks([...AGENT_START, quoted].join('\n'));
    expect(open.length).toBe(1);
  });

  test('an assistant message quoting a notification does NOT close running work', () => {
    const quoted = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'text',
          text: 'It reported <task-notification>\n<task-id>a75d674f7108dd6c8</task-id>\n</task-notification>',
        }],
      },
    });
    expect(scanOpenTasks([...AGENT_START, quoted].join('\n')).length).toBe(1);
  });

  test('the real orphan-summary notification closes every id it names', () => {
    const orphan = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      content:
        '<task-notification>\n<task-id>a75d674f7108dd6c8</task-id>' +
        '<task-id>w5rketv6j</task-id><task-id>__orphan_summary__:shell</task-id>' +
        '\n<status>stopped</status>\n</task-notification>',
    });
    const open = scanOpenTasks([
      ...AGENT_START,
      toolUse('toolu_w', 'Workflow', { script: WF_SCRIPT }),
      toolResult('toolu_w', WORKFLOW_LAUNCH_TEXT),
      orphan,
    ].join('\n'));
    expect(open).toEqual([]);
  });
});

describe('labelFor — sanitization', () => {
  test('strips what would break a code span, a hook reason or a JSON example', () => {
    const raw = 'a' + String.fromCharCode(96) + 'b"c|d<e>f\ng\\h';
    expect(labelFor({ subagent_type: raw }, 'agent')).toBe('abcdef gh');
  });

  test('clamps an overlong workflow name', () => {
    const script = "export const meta = {\n  name: '" + 'w'.repeat(120) + "',\n};";
    expect(labelFor({ script }, 'workflow').length).toBeLessThanOrEqual(48);
  });

  test('never returns an empty label', () => {
    expect(labelFor({}, 'workflow')).toBe('workflow');
    expect(labelFor({}, 'agent')).toBe('agent');
    expect(labelFor({}, 'task')).toBe('task');
  });
});

/**
 * The two guards a synthetic fixture cannot motivate — both were found by
 * running the scanner over a real session transcript, where routine work
 * (a `sed` of this very test file, a node script printing a launch line) had
 * opened phantom items that no notification could ever close.
 */
describe('scanOpenTasks — Bash output is not a launch announcement', () => {
  /** stdout of a command that printed the fixture above, not a real launch. */
  function bashStdout(body) {
    return 'const AGENT_LAUNCH_TEXT =\n' + body + '\nShell cwd was reset to C:\\repo';
  }

  test('a Bash result quoting the AGENT marker opens nothing', () => {
    const open = scanOpenTasks([
      toolUse('toolu_b', 'Bash', { description: 'Read pending-tasks test helpers' }),
      toolResult('toolu_b', bashStdout(AGENT_LAUNCH_TEXT)),
    ].join('\n'));
    expect(open).toEqual([]);
  });

  test('a Bash result quoting the WORKFLOW marker opens nothing', () => {
    const open = scanOpenTasks([
      toolUse('toolu_b', 'Bash', { description: 'Scan transcripts for workflow launches' }),
      toolResult('toolu_b', bashStdout(WORKFLOW_LAUNCH_TEXT)),
    ].join('\n'));
    expect(open).toEqual([]);
  });

  test('a Bash result quoting the BASH marker mid-output opens nothing', () => {
    // Only the launcher binding would let this through: Bash may announce its
    // own task, so the marker's POSITION is what separates event from quote.
    const open = scanOpenTasks([
      toolUse('toolu_b', 'Bash', { description: 'Print the test fixture' }),
      toolResult('toolu_b', bashStdout(BASH_BG_TEXT)),
    ].join('\n'));
    expect(open).toEqual([]);
  });

  test('a real backgrounded Bash task — marker first — is still reported', () => {
    const open = scanOpenTasks([
      toolUse('toolu_b', 'Bash', { description: 'Baseline test run' }),
      toolResult('toolu_b', BASH_BG_TEXT),
    ].join('\n'));
    expect(open).toEqual([{ id: 'b68oycrr6', kind: 'task', name: 'Baseline test run' }]);
  });

  test('an Agent launch reported by a non-launching tool opens nothing', () => {
    const open = scanOpenTasks([
      toolUse('toolu_e', 'Edit', { file_path: 'pending-tasks.test.js' }),
      toolResult('toolu_e', AGENT_LAUNCH_TEXT),
    ].join('\n'));
    expect(open).toEqual([]);
  });
});

describe('scanOpenTasks — concept bridge infrastructure is not work', () => {
  const SERVER_CMD =
    'PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-server.py | head -1); ' +
    'python "$PLUGIN_ROOT" 8840 "C:/repo" --html "docs/concepts/2026-09-06-eve.html"';
  const PULSER_CMD =
    'node "$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-watch.js | head -1)" ' +
    '--mode pulse --port 8840 --state "C:/repo/.claude/concept-active.json"';
  const WAKER_CMD = PULSER_CMD.replace('--mode pulse', '--mode watch');

  function bgLaunch(id, taskId, input) {
    return [
      toolUse(id, 'Bash', input),
      toolResult(id, BASH_BG_TEXT.replace('b68oycrr6', taskId)),
    ];
  }

  test('the bridge server, pulser and waker open nothing', () => {
    const open = scanOpenTasks([
      ...bgLaunch('toolu_s', 'srv1', { command: SERVER_CMD, description: 'Start the concept bridge server on port 8840' }),
      ...bgLaunch('toolu_p', 'pls1', { command: PULSER_CMD, description: 'Launch the keepalive pulser for the concept bridge' }),
      ...bgLaunch('toolu_w', 'wkr1', { command: WAKER_CMD, description: 'Launch the pickup waker' }),
    ].join('\n'));
    expect(open).toEqual([]);
  });

  test('recognized by the script alone when the description says nothing', () => {
    const open = scanOpenTasks(
      bgLaunch('toolu_p', 'pls1', { command: PULSER_CMD, description: 'Background poller' }).join('\n'),
    );
    expect(open).toEqual([]);
  });

  test('recognized by the role alone when the script path is resolved in a variable', () => {
    const open = scanOpenTasks(
      bgLaunch('toolu_s', 'srv1', {
        command: 'python "$SERVER" 8840 "C:/repo" --html "docs/concepts/x.html"',
        description: 'Start the concept bridge server on port 8840',
      }).join('\n'),
    );
    expect(open).toEqual([]);
  });

  test('real work launched alongside the plumbing is still reported', () => {
    const open = scanOpenTasks([
      ...bgLaunch('toolu_s', 'srv1', { command: SERVER_CMD, description: 'Start the concept bridge server' }),
      ...bgLaunch('toolu_w', 'wkr1', { command: WAKER_CMD, description: 'Launch the pickup waker' }),
      ...AGENT_START,
      ...bgLaunch('toolu_t', 'tst1', { command: 'npm test', description: 'Baseline test run' }),
    ].join('\n'));
    expect(open).toEqual([
      { id: 'a75d674f7108dd6c8', kind: 'agent', name: 'devops:frontend' },
      { id: 'tst1', kind: 'task', name: 'Baseline test run' },
    ]);
  });

  test('an ordinary task whose command merely mentions a concept page is still work', () => {
    const open = scanOpenTasks(
      bgLaunch('toolu_t', 'tst1', {
        command: 'node scripts/concept-gate.js docs/concepts/x.html',
        description: 'Validate the concept page',
      }).join('\n'),
    );
    expect(open).toEqual([{ id: 'tst1', kind: 'task', name: 'Validate the concept page' }]);
  });
});

describe('isConceptInfra', () => {
  test('matches the three bridge scripts and their role names', () => {
    expect(isConceptInfra({ command: 'python x/concept-server.py 8840 .' })).toBe(true);
    expect(isConceptInfra({ command: 'node x/concept-watch.js --mode pulse' })).toBe(true);
    expect(isConceptInfra({ description: 'Launch the keepalive pulser' })).toBe(true);
    expect(isConceptInfra({ description: 'Re-launch the pickup waker' })).toBe(true);
    expect(isConceptInfra({ description: 'Restart the concept bridge on the same port' })).toBe(true);
  });

  test('does not match unrelated work or empty input', () => {
    expect(isConceptInfra({ command: 'npm test', description: 'Run the suite' })).toBe(false);
    expect(isConceptInfra({ command: 'node scripts/concept-drift.js --capture' })).toBe(false);
    expect(isConceptInfra({})).toBe(false);
    expect(isConceptInfra(undefined)).toBe(false);
  });
});
